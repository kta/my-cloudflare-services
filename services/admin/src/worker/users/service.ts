import {
  AdministrablePermission,
  type AdminUserQuery,
  type AdminUserView,
  type PinResetStartRequest,
  type PinResetTicket,
  permissionDifference,
  type Role,
  type SetOwnPinRequest,
  STANDARD_ROLE_BASE_ROLE,
  STANDARD_ROLE_PERMISSIONS,
  StandardRole,
  type UserAdministrationAudit,
  type UserAssignmentUpdate,
} from '@app/contracts'
import { hashStretched, verifyStretched } from '@app/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { pinResetTickets, userAdminAudits, userStoreAssignments, users } from '../db/schema'

/**
 * 利用者・標準ロール・担当店舗の管理(UC-EYE-149)と個人 PIN(UC-EYE-151)。
 *
 * すべての読み書きは呼び出し元が JWT から取り出した `organizationId` でスコープ
 * する(リクエスト入力の組織 ID は決して受け取らない)。時刻は `deps.now` として
 * 注入し、この層で `new Date()` を呼ばない。
 */

type Db = DrizzleD1Database<Record<string, never>>
type BatchStatement = Parameters<Db['batch']>[0][number]

export type UserAdminDeps = {
  db: Db
  /** PIN 証明用の server-side pepper。値はログにも応答にも出さない。 */
  pepper: string
  now: Date
}

/** 再設定チケットの有効期間(発行から 60 分)。 */
export const PIN_RESET_TTL_SECONDS = 60 * 60

type UserRow = typeof users.$inferSelect
type AssignmentRow = typeof userStoreAssignments.$inferSelect

function standardRoleOf(row: Pick<UserRow, 'role' | 'standardRole'>): StandardRole {
  const parsed = StandardRole.safeParse(row.standardRole)
  if (parsed.success) return parsed.data
  // 既存行(標準ロール未設定)は認証ロールから最も狭い解釈で導出する。
  return row.role === 'admin' ? 'head_office_admin' : 'staff'
}

function parsePermissions(value: string): AdministrablePermission[] {
  const parsed = AdministrablePermission.array().safeParse(JSON.parse(value) as unknown)
  return parsed.success ? parsed.data : []
}

function toView(row: UserRow, assignments: AssignmentRow[]): AdminUserView {
  const standardRole = standardRoleOf(row)
  const active = assignments
    .map((a) => ({ storeId: a.storeId, permissions: parsePermissions(a.permissions) }))
    .filter((a) => a.permissions.length > 0)
  // 実効権限は担当店舗の和集合。担当が無い場合は標準ロールそのものを実効とみなす
  // (店舗を持たない本部担当者を「全権限が欠落」と表示しないため)。
  const effective =
    active.length === 0
      ? [...STANDARD_ROLE_PERMISSIONS[standardRole]]
      : [...new Set(active.flatMap((a) => a.permissions))]
  return {
    id: row.id,
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'staff',
    standardRole,
    assignments: active,
    permissionDifference: permissionDifference(standardRole, effective),
    hasPin: row.pinHash !== null && row.pinHash !== undefined,
    createdAt: row.createdAt,
  }
}

async function assignmentsFor(
  deps: UserAdminDeps,
  organizationId: string,
  userIds: string[],
): Promise<Map<string, AssignmentRow[]>> {
  const grouped = new Map<string, AssignmentRow[]>()
  if (userIds.length === 0) return grouped
  const rows = await deps.db
    .select()
    .from(userStoreAssignments)
    .where(
      and(
        eq(userStoreAssignments.organizationId, organizationId),
        inArray(userStoreAssignments.userId, userIds),
      ),
    )
  for (const row of rows) {
    const list = grouped.get(row.userId) ?? []
    list.push(row)
    grouped.set(row.userId, list)
  }
  return grouped
}

/** 自組織の利用者一覧(email 部分一致・標準ロール・担当店舗で絞り込み)。 */
export async function listUsers(
  deps: UserAdminDeps,
  organizationId: string,
  query: AdminUserQuery,
): Promise<AdminUserView[]> {
  const rows = await deps.db
    .select()
    .from(users)
    .where(eq(users.organizationId, organizationId))
    .orderBy(desc(users.createdAt))
  const grouped = await assignmentsFor(
    deps,
    organizationId,
    rows.map((r) => r.id),
  )
  const term = query.q?.toLowerCase()
  return rows
    .map((row) => toView(row, grouped.get(row.id) ?? []))
    .filter((view) => (term ? view.email.toLowerCase().includes(term) : true))
    .filter((view) => (query.standardRole ? view.standardRole === query.standardRole : true))
    .filter((view) =>
      query.storeId ? view.assignments.some((a) => a.storeId === query.storeId) : true,
    )
}

async function loadUser(
  deps: UserAdminDeps,
  organizationId: string,
  userId: string,
): Promise<UserRow | undefined> {
  const rows = await deps.db
    .select()
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.id, userId)))
  return rows[0]
}

export async function getUser(
  deps: UserAdminDeps,
  organizationId: string,
  userId: string,
): Promise<AdminUserView | null> {
  const row = await loadUser(deps, organizationId, userId)
  if (!row) return null
  const grouped = await assignmentsFor(deps, organizationId, [userId])
  return toView(row, grouped.get(userId) ?? [])
}

/** domain へ配る 1 件の membership(権限ゼロは担当解除を意味する)。 */
export type MembershipSnapshot = {
  id: string
  organizationId: string
  storeId: string
  userId: string
  permissions: AdministrablePermission[]
  createdAt: string
}

export type AssignmentChange = {
  view: AdminUserView
  /** 今回の変更で domain へ配るべき membership(解除分を含む)。 */
  memberships: MembershipSnapshot[]
}

function snapshotOf(row: UserRow, assignments: AssignmentRow[]) {
  return {
    standardRole: standardRoleOf(row),
    role: row.role,
    storeIds: assignments
      .filter((a) => parsePermissions(a.permissions).length > 0)
      .map((a) => a.storeId)
      .sort(),
    permissions: [...new Set(assignments.flatMap((a) => parsePermissions(a.permissions)))].sort(),
  }
}

/**
 * 標準ロール・担当店舗・例外権限の変更。admin D1 の書き込みが正本であり、
 * domain 同期は呼び出し側が `memberships` を使って行う(失敗しても正本は残る)。
 */
export async function updateAssignment(
  deps: UserAdminDeps,
  input: {
    organizationId: string
    actorUserId: string
    userId: string
    update: UserAssignmentUpdate
  },
): Promise<AssignmentChange | null> {
  const row = await loadUser(deps, input.organizationId, input.userId)
  if (!row) return null
  const existing =
    (await assignmentsFor(deps, input.organizationId, [input.userId])).get(input.userId) ?? []
  const before = snapshotOf(row, existing)

  const standardRole = input.update.standardRole ?? before.standardRole
  const role: Role = STANDARD_ROLE_BASE_ROLE[standardRole]
  const permissions: AdministrablePermission[] = input.update.permissions ?? [
    ...STANDARD_ROLE_PERMISSIONS[standardRole],
  ]
  const storeIds =
    input.update.storeIds !== undefined ? [...new Set(input.update.storeIds)] : before.storeIds
  const nowIso = deps.now.toISOString()

  const memberships: MembershipSnapshot[] = []
  const writes: BatchStatement[] = []

  for (const storeId of storeIds) {
    const current = existing.find((a) => a.storeId === storeId)
    const id = current?.id ?? crypto.randomUUID()
    const createdAt = current?.createdAt ?? nowIso
    memberships.push({
      id,
      organizationId: input.organizationId,
      storeId,
      userId: input.userId,
      permissions,
      createdAt,
    })
    writes.push(
      current
        ? deps.db
            .update(userStoreAssignments)
            .set({ permissions: JSON.stringify(permissions), updatedAt: nowIso })
            .where(eq(userStoreAssignments.id, current.id))
        : deps.db.insert(userStoreAssignments).values({
            id,
            organizationId: input.organizationId,
            userId: input.userId,
            storeId,
            permissions: JSON.stringify(permissions),
            createdAt,
            updatedAt: nowIso,
          }),
    )
  }

  // 担当から外れた店舗は行を消さず、権限ゼロの membership として配る。
  for (const current of existing) {
    if (storeIds.includes(current.storeId)) continue
    if (parsePermissions(current.permissions).length === 0) continue
    memberships.push({
      id: current.id,
      organizationId: input.organizationId,
      storeId: current.storeId,
      userId: input.userId,
      permissions: [],
      createdAt: current.createdAt,
    })
    writes.push(
      deps.db
        .update(userStoreAssignments)
        .set({ permissions: '[]', updatedAt: nowIso })
        .where(eq(userStoreAssignments.id, current.id)),
    )
  }

  const after = {
    standardRole,
    role,
    storeIds: [...storeIds].sort(),
    permissions: [...permissions].sort(),
  }
  writes.push(
    deps.db
      .update(users)
      .set({ role, standardRole })
      .where(and(eq(users.organizationId, input.organizationId), eq(users.id, input.userId))),
    deps.db.insert(userAdminAudits).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetUserId: input.userId,
      action: 'user.assignment_changed',
      before: JSON.stringify(before),
      after: JSON.stringify(after),
      createdAt: nowIso,
    }),
  )
  await deps.db.batch(writes as [BatchStatement, ...BatchStatement[]])

  const view = await getUser(deps, input.organizationId, input.userId)
  if (!view) return null
  return { view, memberships }
}

/** 再送用: 現在の担当店舗をそのまま membership スナップショットとして返す。 */
export async function membershipsFor(
  deps: UserAdminDeps,
  organizationId: string,
  userId: string,
): Promise<MembershipSnapshot[] | null> {
  const row = await loadUser(deps, organizationId, userId)
  if (!row) return null
  const rows = (await assignmentsFor(deps, organizationId, [userId])).get(userId) ?? []
  return rows.map((a) => ({
    id: a.id,
    organizationId,
    storeId: a.storeId,
    userId,
    permissions: parsePermissions(a.permissions),
    createdAt: a.createdAt,
  }))
}

export async function listAudits(
  deps: UserAdminDeps,
  organizationId: string,
  userId: string,
): Promise<UserAdministrationAudit[] | null> {
  const row = await loadUser(deps, organizationId, userId)
  if (!row) return null
  const rows = await deps.db
    .select()
    .from(userAdminAudits)
    .where(
      and(
        eq(userAdminAudits.organizationId, organizationId),
        eq(userAdminAudits.targetUserId, userId),
      ),
    )
    .orderBy(desc(userAdminAudits.createdAt))
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    actorUserId: r.actorUserId,
    targetUserId: r.targetUserId,
    action: r.action as UserAdministrationAudit['action'],
    before: r.before,
    after: r.after,
    createdAt: r.createdAt,
  }))
}

/**
 * 管理者による PIN 再設定の開始。本人確認の方法と根拠を監査へ残すだけで、
 * PIN 素材には一切触れない(管理者は PIN を読めない・設定できない)。
 */
export async function startPinReset(
  deps: UserAdminDeps,
  input: {
    organizationId: string
    actorUserId: string
    userId: string
    input: PinResetStartRequest
  },
): Promise<{ ok: true; ticket: PinResetTicket } | { ok: false; error: 'not_found' }> {
  const row = await loadUser(deps, input.organizationId, input.userId)
  if (!row) return { ok: false, error: 'not_found' }
  const createdAt = deps.now.toISOString()
  const expiresAt = new Date(deps.now.getTime() + PIN_RESET_TTL_SECONDS * 1000).toISOString()
  const id = crypto.randomUUID()
  await deps.db.batch([
    deps.db.insert(pinResetTickets).values({
      id,
      organizationId: input.organizationId,
      userId: input.userId,
      requestedByUserId: input.actorUserId,
      verificationMethod: input.input.verificationMethod,
      verificationNote: input.input.verificationNote,
      expiresAt,
      consumedAt: null,
      createdAt,
    }),
    deps.db.insert(userAdminAudits).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetUserId: input.userId,
      action: 'user.pin_reset_started',
      before: JSON.stringify({ hasPin: row.pinHash !== null }),
      after: JSON.stringify({
        ticketId: id,
        verificationMethod: input.input.verificationMethod,
        verificationNote: input.input.verificationNote,
        expiresAt,
      }),
      createdAt,
    }),
  ])
  return { ok: true, ticket: { id, userId: input.userId, status: 'pending', expiresAt, createdAt } }
}

export type SetOwnPinFailure = {
  ok: false
  error: 'not_found' | 'pin_current_required' | 'pin_verification_failed' | 'reset_ticket_invalid'
  status: 400 | 401 | 404
}

/**
 * 本人による PIN 設定・変更。受け取るのはクライアントでストレッチ済みの値だけで、
 * 保存するのは pepper 込みの HMAC 証明(復元不可)。失敗理由は資格情報の内容を
 * 明かさない粒度に留める。
 */
export async function setOwnPin(
  deps: UserAdminDeps,
  input: { organizationId: string; userId: string; input: SetOwnPinRequest },
): Promise<{ ok: true } | SetOwnPinFailure> {
  const row = await loadUser(deps, input.organizationId, input.userId)
  if (!row) return { ok: false, error: 'not_found', status: 404 }
  const nowIso = deps.now.toISOString()

  let consumeTicketId: string | null = null
  if (row.pinHash) {
    if (input.input.resetTicketId) {
      const tickets = await deps.db
        .select()
        .from(pinResetTickets)
        .where(
          and(
            eq(pinResetTickets.id, input.input.resetTicketId),
            eq(pinResetTickets.organizationId, input.organizationId),
            eq(pinResetTickets.userId, input.userId),
          ),
        )
      const ticket = tickets[0]
      const usable =
        ticket !== undefined &&
        ticket.consumedAt === null &&
        Date.parse(ticket.expiresAt) > deps.now.getTime()
      if (!usable || !ticket) return { ok: false, error: 'reset_ticket_invalid', status: 401 }
      consumeTicketId = ticket.id
    } else if (!input.input.currentStretchedPin) {
      return { ok: false, error: 'pin_current_required', status: 400 }
    } else if (
      !(await verifyStretched(input.input.currentStretchedPin, deps.pepper, row.pinHash))
    ) {
      return { ok: false, error: 'pin_verification_failed', status: 401 }
    }
  }

  const pinHash = await hashStretched(input.input.stretchedPin, deps.pepper)
  const writes: BatchStatement[] = [
    deps.db
      .update(users)
      .set({ pinHash })
      .where(and(eq(users.organizationId, input.organizationId), eq(users.id, input.userId))),
    deps.db.insert(userAdminAudits).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      actorUserId: input.userId,
      targetUserId: input.userId,
      action: 'user.pin_set',
      before: JSON.stringify({ hasPin: row.pinHash !== null }),
      after: JSON.stringify({ hasPin: true, viaResetTicket: consumeTicketId !== null }),
      createdAt: nowIso,
    }),
  ]
  if (consumeTicketId) {
    writes.push(
      deps.db
        .update(pinResetTickets)
        .set({ consumedAt: nowIso })
        .where(eq(pinResetTickets.id, consumeTicketId)),
    )
  }
  await deps.db.batch(writes as [BatchStatement, ...BatchStatement[]])
  return { ok: true }
}

/** 本人の PIN 設定有無だけを返す(値は決して返さない)。 */
export async function hasPin(
  deps: UserAdminDeps,
  organizationId: string,
  userId: string,
): Promise<boolean | null> {
  const row = await loadUser(deps, organizationId, userId)
  if (!row) return null
  return row.pinHash !== null && row.pinHash !== undefined
}
