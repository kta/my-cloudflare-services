import {
  AvailabilityQuery,
  type AvailabilityReason,
  AvailabilityResponse,
  AvailabilitySlot,
  BusinessHoursInput,
  BusinessHoursView,
  CalendarException,
  CalendarExceptionInput,
  CalendarExceptionQuery,
  CustomerCandidate,
  CustomerCreate,
  CustomerDetail,
  CustomerList,
  CustomerLookupQuery,
  CustomerMergeInput,
  CustomerMergePreview,
  CustomerMergePreviewRequest,
  CustomerMergeResult,
  CustomerNote,
  CustomerNoteInput,
  CustomerNotePatch,
  CustomerNotePublishInput,
  CustomerNoteQuery,
  CustomerPatch,
  CustomerSearchQuery,
  DeletedResult,
  Equipment,
  EquipmentInput,
  EquipmentListQuery,
  EquipmentMaintenance,
  EquipmentMaintenanceInput,
  EquipmentPatch,
  Hold,
  HoldInput,
  IssueTokenRequest,
  LedgerQuery,
  LedgerView,
  MaintenanceQuery,
  OrganizationSync,
  type Plan,
  PurposeListQuery,
  PurposeOrderInput,
  PurposeRequirementsInput,
  ReceptionHistoryDetail,
  ReceptionHistoryList,
  ReceptionHistoryQuery,
  ReceptionSession,
  ReceptionSessionClose,
  ReceptionSessionDraft,
  ReceptionSessionDraftPatch,
  ReceptionSessionStart,
  ReservationCancelInput,
  ReservationChangeHistory,
  ReservationChangeInput,
  ReservationDetail,
  ReservationList,
  ReservationSearchQuery,
  ReservationStatus,
  type SettingsImpactItem,
  SettingsImpactReport,
  SettingsImpactRequest,
  type SkillCode,
  SlotRulesInput,
  SlotRulesView,
  StaffListQuery,
  StaffMember,
  StaffMemberInput,
  StaffMemberPatch,
  StaffReservationCreate,
  StaffShift,
  StaffShiftQuery,
  StaffShiftsInput,
  StaffSkillsInput,
  Store,
  StoreDetail,
  StoreMembership,
  StorePatch,
  type StorePermission,
  VisitBoard,
  VisitBoardQuery,
  VisitEvent,
  VisitEventInput,
  VisitPurpose,
  VisitPurposeInput,
  VisitPurposePatch,
  type VisitStage,
  Walkin,
  WalkinCreate,
  WalkinListQuery,
  WalkinPatch,
} from '@app/contracts'
import {
  type AuthVariables,
  internalAuth,
  type OrgResolver,
  requireActiveOrg,
  signAccessToken,
  tenantAuth,
  toJstDateString,
} from '@app/shared'
import type {
  D1Database,
  D1PreparedStatement,
  Fetcher,
  KVNamespace,
  R2Bucket,
} from '@cloudflare/workers-types'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, gte, inArray, lt, lte } from 'drizzle-orm'
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { except } from 'hono/combine'
import { HTTPException } from 'hono/http-exception'
import {
  type AvailabilityDayRows,
  readAvailabilityDay,
  readLedgerDay,
  readReservationDetail,
} from './db/queries/ledger'
import {
  equipment,
  equipmentMaintenance,
  organizations,
  purposeRequirements,
  receptionSessions,
  staff,
  staffShifts,
  staffSkills,
  storeBlackoutWindows,
  storeBusinessHours,
  storeCalendarExceptions,
  storeMemberships,
  storeSettingsRevision,
  storeSlotRules,
  stores,
  visitPurposes,
} from './db/schema'
import { slotLockRequests } from './db/slot-locks'
import {
  type AvailabilityInput,
  computeAvailability,
  evaluateSlot,
  expandToSlotStarts,
  type HoldOccupancy,
} from './domain/availability'
import {
  type BookingPurposeLine,
  beginIdempotency,
  bookingStatements,
  constraintTable,
  type ReservationCodeAttempt,
  readIdempotencyKey,
  releaseIdempotency,
  requestHash,
  withReservationCode,
} from './domain/booking'
import {
  acceptHandwriting,
  acceptSheet,
  applyMerge,
  type CustomerFilter,
  type CustomerRow,
  decodeCursor,
  encodeCursor,
  last4,
  lookupFilter,
  type MergeCustomer,
  mergePreview,
  normalizePhone,
  type ResolvedMergeField,
  rankCandidates,
  sanitizeSvg,
  searchFilter,
  toCustomerSummary,
} from './domain/customers'
import { deleteHold, HOLD_RENEW_MAX, listHoldOccupancies, putHold } from './domain/holds'
import { buildLedgerView } from './domain/ledger'
import { buildHistoryList, type ReceptionHistoryRow } from './domain/reception-history'
import { buildCancelBatch, buildChangeBatch } from './domain/reservation-change'
import {
  type RelaxationCounts,
  type ReservationSearchInput,
  type ReservationSearchQueryLike,
  relaxationsFor,
  resolveSearch,
} from './domain/reservation-search'
import {
  type ImpactWebSlot,
  impactOfBusinessHours,
  impactOfEquipmentStop,
  impactOfPurposeDuration,
  readAffectedReservations,
  severityOf,
} from './domain/settings-impact'
import {
  addJstDays,
  businessDateOf,
  lastAcceptableByWeekday,
  lastAcceptableStart,
  resolveBusinessDay,
  validateHoursInput,
  warnBusinessHours,
} from './domain/store-settings'
import { type BoardSubjectRow, buildBoard } from './domain/visit-board'
import { jstVisitDate, nextTicketNo, waitedMinutes } from './domain/walkin'

// 明示的に import している（ambient global を使わない）ので、export した AppType は
// それ自体で完結し、web 側が Workers の型なしに読める。SPA も同じ Worker が静的資産
// として配る（同一オリジン）ため、このサービスに CORS は一行も無い。
export type Bindings = {
  DB: D1Database
  /** 短命な状態（冪等キー・受付中の下書き）だけを置く。正本は D1。 */
  SHORT_LIVED: KVNamespace
  /** 受付録音の本体。非公開のまま Worker が仲介し、ダウンロード URL を出さない。 */
  RECORDINGS: R2Bucket
  /** 予約確定メール等の同期送信先（notifier）。Queues は使わない。 */
  NOTIFIER: Fetcher
  /** /api/internal/* を守る共有鍵（admin からの service binding 呼び出し）。 */
  INTERNAL_KEY: string
  /** アクセス JWT の HS256 署名鍵。admin（認証の正本）と同じ値。 */
  JWT_SECRET: string
  /** credential 無しの dev トークングラントを開ける。本番では設定しない。 */
  AUTH_DEV_GRANT?: string
}

type Env = { Bindings: Bindings; Variables: AuthVariables }
type Db = DrizzleD1Database
/**
 * 設定の保存で `db.batch()` に並べる 1 文。
 * 読み取りは Drizzle のままだが、**保存だけは D1 の prepared statement を直に並べる**。
 * Drizzle の `db.batch()` は生の SQL 文（`db.run(sql\`\`)`）を受け取れず、
 * `INSERT ... SELECT ... WHERE EXISTS (...)` の形で版の条件を全文へ配れないためである。
 * 原子性は同じで、D1 の 1 バッチが 1 トランザクションになる。
 */
type Statement = D1PreparedStatement

const app = new Hono<Env>()

// 予期しない throw だけを 500 に畳む。投げられた HTTPException は自分の応答を保つ。
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse()
  console.error('unhandled', err)
  return c.json({ error: 'internal_error' }, 500)
})

// 内部エンドポイントは共有鍵で守る（admin Worker → service binding）。
// 鍵が未設定なら全拒否（fail close）。
app.use('/api/internal/*', internalAuth())

/** 同期された組織行 → 契約の形。null は「列が無かった頃の行」なので free / 有効として読む。 */
function toOrgFields(r: typeof organizations.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    plan: (r.plan ?? 'free') as Plan,
    isDisabled: r.isDisabled === '1',
    createdAt: r.createdAt,
    revision: Number(r.revision ?? '0'),
  }
}

// 現在のテナントの組織行を解決する。行が無い = admin からまだ届いていない
// （→ 503 not_synced。再試行できる）。無効化されていれば 403。
const orgResolver: OrgResolver = async (orgId, c) => {
  const db = drizzle((c.env as Bindings).DB)
  const rows = await db.select().from(organizations).where(eq(organizations.id, orgId))
  const row = rows[0]
  if (!row) return null
  const { plan, isDisabled } = toOrgFields(row)
  return { plan, isDisabled }
}

// default-deny。/api/* は例外に挙げたもの以外すべてテナント JWT と有効な組織を要求する。
// ルートを足しただけで守られるので、個別にミドルウェアを足して回らない。
// 公開の Web 予約（/api/public/*）は店舗 slug から自分でテナントを解決する。
app.use(
  '/api/*',
  except(
    ['/api/health', '/api/auth/*', '/api/internal/*', '/api/public/*'],
    tenantAuth(),
    requireActiveOrg(orgResolver),
  ),
)

/* ───────────────────────────────────────────────────────────────────────────
 * 受付条件（P1）が共有する道具
 * ─────────────────────────────────────────────────────────────────────────── */

/** 真偽値は D1 では '0' / '1' の text。 */
const isOn = (value: string): boolean => value === '1'
const flag = (value: boolean): '0' | '1' => (value ? '1' : '0')

/** 設定の版は 1 から始まる（行がまだ無い店舗も 1 として読ませる）。 */
const FIRST_VERSION = 1
/** 勤務の曜日テンプレートを日付へ展開する幅。日次 Cron が毎日 1 日ぶん先へ送る。 */
const SHIFT_WINDOW_DAYS = 62
/** 営業時間を変えたときに影響を数える幅（Web 予約の受付窓と同じ 30 日）。 */
const IMPACT_DAYS = 30
/** 止める帯の手前に始まって帯の中で終わるご予約を取りこぼさないための読み足し。 */
const LOOKBACK_MS = 12 * 60 * 60 * 1000
const MS_PER_MINUTE = 60_000
const JST_OFFSET_MS = 9 * 60 * MS_PER_MINUTE
const MINUTES_PER_DAY = 24 * 60

/** `HH:MM` → 0 時からの分。 */
const toMinutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** JST の暦日と 0 時からの分 → UTC の ISO8601。 */
const toInstant = (date: string, minutes: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000+09:00`) + minutes * MS_PER_MINUTE).toISOString()

/** UTC の瞬間 → JST の壁時計で 0 時から数えた分。 */
const toJstMinutes = (instant: string): number =>
  Math.floor(
    ((Date.parse(instant) + JST_OFFSET_MS) % (MINUTES_PER_DAY * MS_PER_MINUTE)) / MS_PER_MINUTE,
  )

/** 空白区切りの許可リストに含まれるか。知らない語は届かない（同期で fail close 済み）。 */
const allows = (permissions: string, perm: StorePermission): boolean =>
  permissions.split(' ').includes(perm)

/**
 * お客様に読み上げていただく Web のご予約番号（`EY-W-2608-0006`）。
 *
 * 正本は `web_bookings.public_code` で、その表を作るのは `011-web-booking`（P8）である。
 * それまでは業務側の予約番号（`reservations.code`）から機械的に作る。契約は
 * 「`source='web'` のご予約は必ずこの番号を持つ」形で決めてあり、ここで null を返すと
 * Web から入ったご予約は 1 件も詳細を開けない。**採番の系統を 2 つ持たない**ので、
 * P8 で表ができたらこの関数の中だけを読み替える。
 */
const webBookingCodeOf = (source: string, code: string): string | null =>
  source === 'web' ? code.replace('EY-', 'EY-W-') : null

/** 自分の組織の店舗だけを引く。他テナントの id は「無い」として扱う。 */
async function findStore(db: Db, org: string, storeId: string) {
  const rows = await db
    .select()
    .from(stores)
    .where(and(eq(stores.organizationId, org), eq(stores.id, storeId)))
  return rows[0] ?? null
}

/**
 * 店長だけの操作に付ける。
 *
 * パスに `:storeId` があるときは**まずその店舗が自分の組織のものか**を見て、
 * 無ければ 404 を返す（403 で他テナントの存在を漏らさない）。そのうえで
 * `store_memberships` の許可リストを見て、足りなければ 403（401 にしない）。
 * **body / query の `organizationId` や `storeId` を認可の根拠にしない。**
 * 店舗に紐づかない面（ご来店の目的）は、同じ組織のどこかの店舗で権限を持っていればよい。
 */
function requireStorePermission(perm: StorePermission): MiddlewareHandler<Env> {
  return async (c, next) => {
    const db = drizzle(c.env.DB)
    const { org, sub } = c.get('auth')
    const storeId: string | undefined = c.req.param('storeId')
    if (storeId !== undefined && !(await findStore(db, org, storeId))) {
      return c.json({ error: 'not_found' }, 404)
    }
    const rows = await db
      .select({ permissions: storeMemberships.permissions })
      .from(storeMemberships)
      .where(
        and(
          eq(storeMemberships.organizationId, org),
          eq(storeMemberships.userId, sub),
          storeId === undefined ? undefined : eq(storeMemberships.storeId, storeId),
        ),
      )
    if (!rows.some((row) => allows(row.permissions, perm))) {
      return c.json({ error: 'forbidden' }, 403)
    }
    await next()
  }
}

/**
 * クエリ文字列を契約で受け直す。**`schema.parse()` を直に呼ばない** —
 * 投げた `ZodError` は `HTTPException` ではないので `app.onError` が
 * 500 `internal_error` に畳んでしまい、打ち間違えたクエリがサーバの故障として画面に出る。
 *
 * 落ちたときに返すのは `zValidator` とまったく同じ形（`safeParse` の結果をそのまま 400）で、
 * 入力の型エラーを自前の code に翻訳しない（`04-api.md` §5）。
 * `zValidator('query', ...)` を使わないのは、RPC の型に `query` が必須で現れて
 * `$get({ param })` だけの呼び出しが型エラーになるためである。
 */
type QuerySchema<T> = {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: unknown }
}

function validQuery<T>(c: Context<Env>, schema: QuerySchema<T>, raw: Record<string, string>): T {
  const result = schema.safeParse(raw)
  if (!result.success) throw new HTTPException(400, { res: c.json(result, 400) })
  return result.data
}

/** 設定 6 面が共有する版。行が無い店舗は 1 として読む。 */
async function readVersion(db: Db, org: string, storeId: string): Promise<number> {
  const rows = await db
    .select({ version: storeSettingsRevision.version })
    .from(storeSettingsRevision)
    .where(
      and(
        eq(storeSettingsRevision.organizationId, org),
        eq(storeSettingsRevision.storeId, storeId),
      ),
    )
  return rows[0]?.version ?? FIRST_VERSION
}

/** 保存の直前に版の行を確かめる。無ければ version=1 で作る（バッチの前に済ませる）。 */
async function ensureVersion(db: Db, org: string, storeId: string, now: string): Promise<void> {
  await db
    .insert(storeSettingsRevision)
    .values({
      id: crypto.randomUUID(),
      organizationId: org,
      storeId,
      version: FIRST_VERSION,
      updatedAt: now,
      updatedBy: null,
      createdAt: now,
    })
    .onConflictDoNothing({
      target: [storeSettingsRevision.organizationId, storeSettingsRevision.storeId],
    })
}

/**
 * 版の条件。**`db.batch()` の全文に配る。**
 * D1 は 0 行しか当たらない UPDATE を失敗と見なさずバッチを続けるので、版を進める
 * 1 文だけに条件を置くと「409 を返しながら相手の変更を黙って巻き戻す」形になる。
 * `version` を送らない面（営業日・技能・点検・必要資源）は `1` を配って素通しにする。
 */
type Guard = { condition: string; params: unknown[] }

function versionGuard(org: string, storeId: string, version: number): Guard {
  return {
    condition:
      'EXISTS (SELECT 1 FROM store_settings_revision WHERE organization_id = ? AND store_id = ? AND version = ?)',
    params: [org, storeId, version],
  }
}

/**
 * 版の条件を末尾に配った 1 文を作る道具。`?` は**本文 → 版**の順に並ぶので、
 * `${writer.guard}` は必ず文の最後に置く。
 */
function settingsWriter(db: D1Database, guard: Guard) {
  return {
    guard: guard.condition,
    at: (query: string, params: unknown[]): Statement =>
      db.prepare(query).bind(...params, ...guard.params),
  }
}

/** 版を +1 する文。**必ずバッチの最後に置く**。この文の `meta.changes` が 409 の判定になる。 */
function bumpVersion(
  db: D1Database,
  org: string,
  storeId: string,
  version: number | null,
  now: string,
  by: string | null,
): Statement {
  const matches = version === null ? '1' : 'version = ?'
  const query = `UPDATE store_settings_revision SET version = version + 1, updated_at = ?, updated_by = ? WHERE organization_id = ? AND store_id = ? AND ${matches}`
  const params = version === null ? [now, by, org, storeId] : [now, by, org, storeId, version]
  return db.prepare(query).bind(...params)
}

/**
 * 版の条件を配った文を 1 トランザクションで流す。**全部通るか 1 行も変わらないか**の
 * どちらかになり、成功したかどうかは最後の文（版を +1 する UPDATE）が
 * 何行に当たったかだけで決める。**戻り値を捨てない**（捨てると 409 を 200 と言う）。
 */
async function commitSettings(
  db: D1Database,
  statements: [Statement, ...Statement[]],
): Promise<boolean> {
  const results = await db.batch(statements)
  const last = results[results.length - 1]
  return (last?.meta.changes ?? 0) > 0
}

/**
 * 版を条件にしない書き込み。**画面が `version` を送らない操作だけ**に使う
 * （営業日の日付タップ / 技能のチップ / 追加 / 点検）。`bumpVersion(..., null, ...)`
 * は必ず 1 行に当たる（`ensureVersion` が行を作ってある）ので `meta.changes` を
 * 見るところが無く、**戻り値を捨てているのではない**ことを名前で示す。
 * 版を送る操作にこれを使うと楽観ロックが素通りする。
 */
async function commitUnversioned(
  db: D1Database,
  statements: [Statement, ...Statement[]],
): Promise<void> {
  await db.batch(statements)
}

/** 監査に残す `staff.id`。個人ログインしていない共有端末では null になる。 */
async function actorStaffId(
  db: Db,
  org: string,
  storeId: string,
  sub: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: staff.id })
    .from(staff)
    .where(
      and(eq(staff.organizationId, org), eq(staff.storeId, storeId), eq(staff.adminUserId, sub)),
    )
  return rows[0]?.id ?? null
}

/** 契約で表せない拒否理由（帯が営業時間の外）を 2 文のまま返す。 */
function rejected(messages: string[]) {
  return { error: 'invalid_input' as const, messages }
}

/* --- 店舗の情報 ---------------------------------------------------------- */

function toStoreDetail(row: typeof stores.$inferSelect, version: number) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    phone: row.phone,
    address: row.address,
    accessNote: row.accessNote,
    isActive: isOn(row.isActive),
    createdAt: row.createdAt,
    namePublic: row.namePublic,
    nearestStation: row.nearestStation,
    parkingNote: row.parkingNote,
    introText: row.introText,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    settingsVersion: version,
  }
}

/* --- 営業時間と止める帯 --------------------------------------------------- */

/** 保存されている曜日の行と帯。行が欠けている曜日は定休として補う（7 行ちょうどにする）。 */
async function readHours(db: Db, org: string, storeId: string) {
  const saved = await db
    .select()
    .from(storeBusinessHours)
    .where(and(eq(storeBusinessHours.organizationId, org), eq(storeBusinessHours.storeId, storeId)))
  const bands = await db
    .select()
    .from(storeBlackoutWindows)
    .where(
      and(eq(storeBlackoutWindows.organizationId, org), eq(storeBlackoutWindows.storeId, storeId)),
    )
    .orderBy(asc(storeBlackoutWindows.weekday), asc(storeBlackoutWindows.startsAt))

  const rows = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const row = saved.find((candidate) => candidate.weekday === weekday)
    if (!row) {
      return { weekday, isClosed: true, opensAt: null, closesAt: null }
    }
    return {
      weekday,
      isClosed: isOn(row.isClosed),
      opensAt: row.opensAt,
      closesAt: row.closesAt,
    }
  })
  const blackouts = bands.map((band) => ({
    id: band.id,
    weekday: band.weekday,
    startsAt: band.startsAt,
    endsAt: band.endsAt,
    label: band.label,
    sortOrder: band.sortOrder,
  }))
  return { rows, blackouts }
}

async function readSlotRulesRow(db: Db, org: string, storeId: string) {
  const rows = await db
    .select()
    .from(storeSlotRules)
    .where(and(eq(storeSlotRules.organizationId, org), eq(storeSlotRules.storeId, storeId)))
  return rows[0] ?? null
}

/** 刻みと片付けの取り合わせに対する警告（保存は止めない）。行が無ければ何も言わない。 */
async function hoursWarnings(db: Db, org: string, storeId: string): Promise<string[]> {
  const rules = await readSlotRulesRow(db, org, storeId)
  if (!rules) return []
  return warnBusinessHours({
    slotMinutes: rules.slotMinutes,
    cleanupMinutes: rules.cleanupMinutes,
  })
}

async function hoursView(db: Db, org: string, storeId: string) {
  const { rows, blackouts } = await readHours(db, org, storeId)
  return BusinessHoursView.parse({
    rows,
    blackouts,
    version: await readVersion(db, org, storeId),
    warnings: await hoursWarnings(db, org, storeId),
  })
}

/** 最短のご用件の所要。目的が 1 件も無い店舗は刻みを代わりに使う。 */
async function shortestPurposeMinutes(
  db: Db,
  org: string,
  storeId: string,
  fallback: number,
): Promise<number> {
  const rows = await db
    .select({ durationMinutes: visitPurposes.durationMinutes, storeId: visitPurposes.storeId })
    .from(visitPurposes)
    .where(and(eq(visitPurposes.organizationId, org), eq(visitPurposes.isActive, '1')))
  const usable = rows
    .filter((row) => row.storeId === null || row.storeId === storeId)
    .map((row) => row.durationMinutes)
  return usable.length === 0 ? fallback : Math.min(...usable)
}

async function slotRulesView(
  db: Db,
  org: string,
  storeId: string,
  rules: { slotMinutes: number; cleanupMinutes: number; maxParallel: number; updatedAt: string },
) {
  const { rows, blackouts } = await readHours(db, org, storeId)
  const lastAcceptableAt = lastAcceptableByWeekday({
    rows,
    blackouts,
    shortestDurationMinutes: await shortestPurposeMinutes(db, org, storeId, rules.slotMinutes),
    cleanupMinutes: rules.cleanupMinutes,
  })
  return SlotRulesView.parse({
    ...rules,
    version: await readVersion(db, org, storeId),
    lastAcceptableAt,
    warnings: warnBusinessHours(rules),
  })
}

/* --- スタッフ ------------------------------------------------------------ */

async function readStaff(
  db: Db,
  org: string,
  storeId: string,
  query: { includeInactive: boolean; date?: string },
) {
  const rows = await db
    .select()
    .from(staff)
    .where(and(eq(staff.organizationId, org), eq(staff.storeId, storeId)))
    .orderBy(asc(staff.sortOrder), asc(staff.createdAt))
  const visible = query.includeInactive ? rows : rows.filter((row) => isOn(row.isActive))

  let listed = visible
  if (query.date !== undefined) {
    // LOGIN-STAFF の「本日の勤務」。その日に勤務の行がある担当だけを残す。
    const onDuty = await db
      .select({ staffId: staffShifts.staffId })
      .from(staffShifts)
      .where(
        and(
          eq(staffShifts.organizationId, org),
          eq(staffShifts.storeId, storeId),
          eq(staffShifts.date, query.date),
          eq(staffShifts.kind, 'work'),
        ),
      )
    const ids = new Set(onDuty.map((row) => row.staffId))
    listed = visible.filter((row) => ids.has(row.id))
  }
  if (listed.length === 0) return []

  const skills = await db
    .select({ staffId: staffSkills.staffId, skillCode: staffSkills.skillCode })
    .from(staffSkills)
    .where(
      and(
        eq(staffSkills.organizationId, org),
        inArray(
          staffSkills.staffId,
          listed.map((row) => row.id),
        ),
      ),
    )
  const held = new Map<string, SkillCode[]>()
  for (const row of skills) {
    const list = held.get(row.staffId) ?? []
    list.push(row.skillCode as SkillCode)
    held.set(row.staffId, list)
  }

  return listed.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    kana: row.kana,
    jobLabel: row.jobLabel,
    role: row.role === 'manager' ? ('manager' as const) : ('staff' as const),
    isActive: isOn(row.isActive),
    sortOrder: row.sortOrder,
    skills: held.get(row.id) ?? [],
    adminUserId: row.adminUserId,
    // ハッシュ自体は外へ出さない。設定してあるかどうかだけを毎回導出する。
    hasPin: row.pinHash !== null,
    maxParallelReservations: row.maxParallelReservations,
    pinUpdatedAt: row.pinUpdatedAt,
  }))
}

async function findStaffMember(db: Db, org: string, storeId: string, staffId: string) {
  const rows = await db
    .select()
    .from(staff)
    .where(and(eq(staff.organizationId, org), eq(staff.storeId, storeId), eq(staff.id, staffId)))
  return rows[0] ?? null
}

/** 保存した 1 名だけを契約の形で返す。「いま使える」を切った直後も返せるよう inactive を含める。 */
async function oneStaffMember(db: Db, org: string, storeId: string, staffId: string) {
  const members = await readStaff(db, org, storeId, { includeInactive: true })
  return members.find((member) => member.id === staffId) ?? null
}

/* --- 設備 ---------------------------------------------------------------- */

function toEquipment(row: typeof equipment.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as 'measure' | 'counter' | 'workbench',
    capacity: row.capacity,
    isActive: isOn(row.isActive),
    sortOrder: row.sortOrder,
    inactiveReason: row.inactiveReason,
    // 台帳の行名の下に出る小さい文字。列は NULL 可だが契約は必須なので、
    // 取り込み前の古い行だけは名前をそのまま出す（API から作った行は必ず持つ）。
    roleLabel: row.roleLabel ?? row.name,
    ledgerDisplay: row.ledgerDisplay === 'hide' ? ('hide' as const) : ('grey' as const),
  }
}

async function findEquipment(db: Db, org: string, storeId: string, equipmentId: string) {
  const rows = await db
    .select()
    .from(equipment)
    .where(
      and(
        eq(equipment.organizationId, org),
        eq(equipment.storeId, storeId),
        eq(equipment.id, equipmentId),
      ),
    )
  return rows[0] ?? null
}

/* --- ご来店の目的 -------------------------------------------------------- */

async function readPurposes(
  db: Db,
  org: string,
  query: { storeId?: string; includeInactive: boolean; webPublishedOnly: boolean },
) {
  const rows = await db
    .select()
    .from(visitPurposes)
    .where(eq(visitPurposes.organizationId, org))
    .orderBy(asc(visitPurposes.sortOrder), asc(visitPurposes.createdAt))
  const listed = rows
    .filter(
      (row) => query.storeId === undefined || row.storeId === null || row.storeId === query.storeId,
    )
    .filter((row) => query.includeInactive || isOn(row.isActive))
    .filter((row) => !query.webPublishedOnly || isOn(row.isWebPublished))
  if (listed.length === 0) return []

  const requirements = await db
    .select()
    .from(purposeRequirements)
    .where(
      and(
        eq(purposeRequirements.organizationId, org),
        inArray(
          purposeRequirements.purposeId,
          listed.map((row) => row.id),
        ),
      ),
    )
  const byPurpose = new Map<string, { kind: string; value: string }[]>()
  for (const row of requirements) {
    const list = byPurpose.get(row.purposeId) ?? []
    list.push({ kind: row.kind, value: row.value })
    byPurpose.set(row.purposeId, list)
  }

  return listed.map((row) => ({
    id: row.id,
    storeId: row.storeId,
    nameInternal: row.nameInternal,
    namePublic: row.namePublic,
    nameShort: row.nameShort,
    durationMinutes: row.durationMinutes,
    isWebPublished: isOn(row.isWebPublished),
    isActive: isOn(row.isActive),
    sortOrder: row.sortOrder,
    requirements: byPurpose.get(row.id) ?? [],
    version: row.version,
  }))
}

async function findPurpose(db: Db, org: string, purposeId: string) {
  const rows = await db
    .select()
    .from(visitPurposes)
    .where(and(eq(visitPurposes.organizationId, org), eq(visitPurposes.id, purposeId)))
  return rows[0] ?? null
}

async function onePurpose(db: Db, org: string, purposeId: string) {
  const listed = await readPurposes(db, org, { includeInactive: true, webPublishedOnly: false })
  return listed.find((purpose) => purpose.id === purposeId) ?? null
}

/* --- 保存の前に見せる影響 ------------------------------------------------- */

/**
 * 「60分に延ばすと受けられなくなるWeb枠」を数えるための候補枠。
 * P2 の空き枠エンジンが入るまでの最小の並べ方で、営業時間から止める帯を差し引いた区間を
 * 刻みで割り、**次のご予約（無ければ区間の終わり）までの空き** から片付けを引いた時間を
 * その枠の持ち時間とする。押さえの数え方（同時受付・設備の台数）は P2 が引き継ぐ。
 */
async function candidateWebSlots(
  db: Db,
  org: string,
  storeId: string,
  purposeId: string,
  from: string,
  to: string,
): Promise<ImpactWebSlot[]> {
  const rules = await readSlotRulesRow(db, org, storeId)
  if (!rules) return []
  const { rows, blackouts } = await readHours(db, org, storeId)
  const exceptions = await db
    .select()
    .from(storeCalendarExceptions)
    .where(
      and(
        eq(storeCalendarExceptions.organizationId, org),
        eq(storeCalendarExceptions.storeId, storeId),
        gte(storeCalendarExceptions.date, from),
        lte(storeCalendarExceptions.date, to),
      ),
    )
  const units = await db
    .select()
    .from(equipment)
    .where(
      and(
        eq(equipment.organizationId, org),
        eq(equipment.storeId, storeId),
        eq(equipment.isActive, '1'),
      ),
    )
    .orderBy(asc(equipment.sortOrder))
  const equipmentName = units[0]?.name ?? '設備'
  const booked = await readAffectedReservations(db, {
    organizationId: org,
    storeId,
    from: toInstant(from, 0),
    to: toInstant(addJstDays(to, 1), 0),
  })

  const slots: ImpactWebSlot[] = []
  for (let date = from; date <= to; date = addJstDays(date, 1)) {
    const day = resolveBusinessDay({
      date,
      weeklyRows: rows,
      exceptions: exceptions.map((row) => ({
        date: row.date,
        kind: row.kind === 'special' ? ('special' as const) : ('closed' as const),
        opensAt: row.opensAt,
        closesAt: row.closesAt,
      })),
      blackouts,
    })
    const taken = booked
      .filter((reservation) => businessDateOf(reservation.startsAt) === date)
      .map((reservation) => toJstMinutes(reservation.startsAt))
      .sort((a, b) => a - b)

    for (const window of day.windows) {
      const closes = toMinutes(window.endsAt)
      for (let at = toMinutes(window.startsAt); at < closes; at += rules.slotMinutes) {
        const next = taken.find((start) => start > at) ?? closes
        slots.push({
          purposeId,
          startsAt: toInstant(date, at),
          availableMinutes: Math.min(next, closes) - at - rules.cleanupMinutes,
          equipmentName,
        })
      }
    }
  }
  return slots
}

function toReport(input: {
  affectedReservations: SettingsImpactItem[]
  affectedWebSlots: SettingsImpactItem[]
  lastAcceptableAt: string | null
}) {
  return SettingsImpactReport.parse({ ...input, severity: severityOf(input) })
}

/* ───────────────────────────────────────────────────────────────────────────
 * ルート
 * ─────────────────────────────────────────────────────────────────────────── */

// dev 専用のトークン発行（RPC のルートには載せない）。credential を検査せずに
// 任意の organizationId のアクセス JWT を作る。AUTH_DEV_GRANT === 'true' の
// ときだけ開く（fail close）。実運用では admin の認証へ差し替える。
/* ───────────────────────────────────────────────────────────────────────────
 * 顧客台帳（P4）が共有する道具
 *
 * お客様の行は**組織単位で 1 本**である。他店で書かれた度数・手書き・履歴にも
 * 権限を足さず、絞るのは JWT の `org` だけにする（`03-data-model.md` §9.1）。
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * 手書きの筆跡の置き場。**録音と同じ `RECORDINGS` バケット**を使い、前置で用途を分ける
 * （録音は `recordings/`、手書きは `notes/`）。2 つ目の binding を足さないのは、
 * バケットを増やすのが決定ブリーフの変更になり人間の承認が要るからである。
 * 署名付き URL もダウンロード URL も出さず、読み出しは必ず Worker が仲介する。
 */
const handwritingKey = (org: string, customerId: string, noteId: string): string =>
  `notes/${org}/${customerId}/${noteId}.svg`

/** 「足を運ばれた」3 語。`done` だけが接客の終わった回数（`visit_count`）に入る。 */
const VISITED_STATUSES = "('arrived','serving','done')"

/** 一覧・詳細・候補が同じ形で読む列。別名は契約の欄名に揃える。 */
const CUSTOMER_COLUMNS =
  'id, customer_number AS customerNumber, name, kana, phone, phone_normalized AS phoneNormalized, ' +
  'phone_last4 AS phoneLast4, email, birth_date AS birthDate, address, memo, ' +
  'first_visit_at AS firstVisitAt, last_visit_at AS lastVisitAt, visit_count AS visitCount, ' +
  'merged_into_id AS mergedIntoId, version'

type CustomerRecord = {
  id: string
  customerNumber: string
  name: string
  kana: string | null
  phone: string | null
  phoneNormalized: string | null
  phoneLast4: string | null
  email: string | null
  birthDate: string | null
  address: string | null
  memo: string | null
  firstVisitAt: string | null
  lastVisitAt: string | null
  visitCount: number
  mergedIntoId: string | null
  version: number
}

/**
 * D1 の行 → ドメインの行。`first_visit_at` / `last_visit_at` は**瞬間**で持ち、
 * ここで JST の暦日へ落とす（契約の `lastVisitAt` は `LocalDate`）。
 * UTC のまま日付を読むと 15:00Z 以降のご来店が前日に落ちる。
 */
function toCustomerRow(row: CustomerRecord): CustomerRow {
  return {
    id: row.id,
    customerNumber: row.customerNumber,
    name: row.name,
    kana: row.kana ?? '',
    phoneNormalized: row.phoneNormalized,
    phoneLast4: row.phoneLast4,
    address: row.address,
    memo: row.memo ?? '',
    visitCount: row.visitCount,
    lastVisitAt: row.lastVisitAt === null ? null : toJstDateString(row.lastVisitAt),
    mergedIntoId: row.mergedIntoId,
  }
}

/** 自分の組織のお客様だけを引く。他テナントの id は「無い」として扱う（404）。 */
async function findCustomer(
  db: D1Database,
  org: string,
  customerId: string,
): Promise<CustomerRecord | null> {
  return db
    .prepare(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE organization_id = ? AND id = ?`)
    .bind(org, customerId)
    .first<CustomerRecord>()
}

/**
 * 受付が結びつけてよいお客様か。**まとめられて消えた行（`merged_into_id` が非 NULL）は
 * 「無い」として扱う。**残したまま結びつけられると、その来店は一覧にも検索にも出ない
 * お客様の来店回数に数えられ、残す側は増えないまま食い違う（`008-reception-and-walkin`）。
 */
async function findLiveCustomer(
  db: D1Database,
  org: string,
  customerId: string,
): Promise<CustomerRecord | null> {
  const found = await findCustomer(db, org, customerId)
  return found === null || found.mergedIntoId !== null ? null : found
}

/** 打ち込まれた番号 → 保存する 3 列。3 つとも入るか 3 つとも NULL のどちらかにする。 */
type PhoneColumns = { phone: string | null; normalized: string | null; last4: string | null }

function phoneColumns(raw: string | undefined): PhoneColumns | null {
  if (raw === undefined) return { phone: null, normalized: null, last4: null }
  const normalized = normalizePhone(raw)
  if (normalized === null) return null
  return { phone: raw, normalized, last4: last4(normalized) }
}

/** 検索語の当て方（下 4 桁の完全一致・前方一致・お名前の部分一致）を SQL の 1 句にする。 */
function customerFilterClause(filter: CustomerFilter | null): {
  clause: string
  params: unknown[]
} {
  if (filter === null) return { clause: '', params: [] }
  if (filter.column === 'phone_last4') {
    return { clause: ' AND phone_last4 = ?', params: [filter.value] }
  }
  if (filter.column === 'phone_normalized') {
    // 前方一致。`LIKE '%' || ?` は B-tree が効かず顧客表の全走査になるので書かない。
    return { clause: ' AND phone_normalized LIKE ?', params: [filter.pattern] }
  }
  return { clause: ' AND (name LIKE ? OR kana LIKE ?)', params: [filter.pattern, filter.pattern] }
}

/**
 * 一覧・検索の絞り込みを組み立てる。**まとめられた行（`merged_into_id` が非 NULL）は
 * 一覧からも検索からも外す。** 認可の根拠は JWT の `org` だけで、`storeId` は使わない。
 */
function customerScope(
  org: string,
  query: CustomerSearchQuery,
): { clause: string; params: unknown[] } {
  const parts = ['organization_id = ?', 'merged_into_id IS NULL']
  const params: unknown[] = [org]
  const typed = (query.query ?? '').trim()
  const filter = typed === '' ? null : searchFilter(typed)
  const built = customerFilterClause(filter)
  let clause = `${parts.join(' AND ')}${built.clause}`
  params.push(...built.params)
  if (query.visitCountMin !== undefined) {
    clause += ' AND visit_count >= ?'
    params.push(query.visitCountMin)
  }
  if (query.visitCountMax !== undefined) {
    clause += ' AND visit_count <= ?'
    params.push(query.visitCountMax)
  }
  if (query.lastVisitFrom !== undefined) {
    clause += ' AND last_visit_at >= ?'
    params.push(toInstant(query.lastVisitFrom, 0))
  }
  if (query.lastVisitTo !== undefined) {
    // 終わりの日は「その日の 24:00 JST より前」。暦日の境目を UTC で読み違えない。
    clause += ' AND last_visit_at < ?'
    params.push(toInstant(query.lastVisitTo, MINUTES_PER_DAY))
  }
  if (query.staffId !== undefined) {
    clause +=
      ' AND EXISTS (SELECT 1 FROM reservations r JOIN reservation_assignments a ON a.reservation_id = r.id' +
      " WHERE r.organization_id = customers.organization_id AND r.customer_id = customers.id AND a.kind = 'staff' AND a.target_id = ?)"
    params.push(query.staffId)
  }
  return { clause, params }
}

/** 手書きは R2 から取り、**許可リストで再直列化してから**返す（他店舗の端末が開くため）。 */
async function readHandwriting(bucket: R2Bucket, key: string): Promise<string | null> {
  const object = await bucket.get(key)
  if (object === null) return null
  return sanitizeSvg(await object.text())
}

type NoteRecord = {
  id: string
  customerId: string
  storeId: string
  kind: string
  body: string
  handwritingKey: string | null
  authorId: string | null
  revision: number
  status: string
  createdAt: string
}

const NOTE_COLUMNS =
  'id, customer_id AS customerId, store_id AS storeId, kind, body, ' +
  'handwriting_key AS handwritingKey, author_id AS authorId, revision, status, ' +
  'created_at AS createdAt'

type PrescriptionRecord = {
  id: string
  measuredAt: string
  rSph: number | null
  lSph: number | null
  rCyl: number | null
  lCyl: number | null
  rAxis: number | null
  lAxis: number | null
  rAdd: number | null
  lAdd: number | null
  pd: number | null
  note: string | null
  isCurrent: string
}

const PRESCRIPTION_COLUMNS =
  'id, measured_at AS measuredAt, r_sph AS rSph, l_sph AS lSph, r_cyl AS rCyl, l_cyl AS lCyl, ' +
  'r_axis AS rAxis, l_axis AS lAxis, r_add AS rAdd, l_add AS lAdd, pd, note, is_current AS isCurrent'

/** 度数 1 行を契約の形にする。**文字列に整形しない**（「R -2.25」は画面が作る）。 */
const toPrescription = (row: PrescriptionRecord) => ({
  id: row.id,
  measuredAt: row.measuredAt,
  rSph: row.rSph,
  lSph: row.lSph,
  rCyl: row.rCyl,
  lCyl: row.lCyl,
  rAxis: row.rAxis,
  lAxis: row.lAxis,
  rAdd: row.rAdd,
  lAdd: row.lAdd,
  pd: row.pd,
  note: row.note ?? '',
  isCurrent: row.isCurrent === '1',
})

type GlassesRecord = {
  id: string
  purchasedAt: string
  frameName: string | null
  lensName: string | null
  usageLabel: string | null
  note: string | null
  isCurrent: string
}

/**
 * メモを契約の形にする。**R2 のキーは契約に出さない** — 出すと画面がそのまま
 * `<img src>` に入れられる形になり、非公開のバケットを仲介なしで指す道ができる。
 */
async function toNotes(
  db: D1Database,
  bucket: R2Bucket,
  org: string,
  rows: NoteRecord[],
): Promise<unknown[]> {
  const authorIds = [...new Set(rows.map((row) => row.authorId).filter((id) => id !== null))]
  const names = new Map<string, string>()
  if (authorIds.length > 0) {
    const found = await db
      .prepare(
        `SELECT id, display_name AS displayName FROM staff WHERE organization_id = ? AND id IN (${authorIds.map(() => '?').join(',')})`,
      )
      .bind(org, ...authorIds)
      .all<{ id: string; displayName: string }>()
    for (const row of found.results) names.set(row.id, row.displayName)
  }
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      kind: row.kind,
      body: row.body,
      handwritingSvg:
        row.handwritingKey === null ? null : await readHandwriting(bucket, row.handwritingKey),
      authorId: row.authorId,
      authorName: row.authorId === null ? '' : (names.get(row.authorId) ?? ''),
      revision: row.revision,
      status: row.status,
      storeId: row.storeId,
      createdAt: row.createdAt,
    })),
  )
}

/**
 * お客様 1 名を契約の形で読む。**5 本の SELECT を 1 つの `db.batch()` にまとめる**
 * （度数・メガネ・メモ・次のご予約・よくご担当した者）。読むたびに往復を増やさない。
 */
async function readCustomerDetail(
  env: Bindings,
  org: string,
  customerId: string,
  now: Date,
): Promise<Record<string, unknown> | null> {
  const db = env.DB
  const nowIso = now.toISOString()
  const read = await db.batch([
    db
      .prepare(`SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE organization_id = ? AND id = ?`)
      .bind(org, customerId),
    db
      .prepare(
        `SELECT ${PRESCRIPTION_COLUMNS} FROM customer_prescriptions ` +
          'WHERE organization_id = ? AND customer_id = ? ORDER BY measured_at DESC, created_at DESC LIMIT 20',
      )
      .bind(org, customerId),
    db
      .prepare(
        'SELECT id, purchased_at AS purchasedAt, frame_name AS frameName, lens_name AS lensName, ' +
          'usage_label AS usageLabel, note, is_current AS isCurrent ' +
          'FROM customer_glasses WHERE organization_id = ? AND customer_id = ? ORDER BY purchased_at DESC',
      )
      .bind(org, customerId),
    db
      .prepare(
        `SELECT ${NOTE_COLUMNS} FROM customer_notes WHERE organization_id = ? AND customer_id = ? ORDER BY created_at DESC`,
      )
      .bind(org, customerId),
    db
      .prepare(
        'SELECT r.id, r.code, r.starts_at AS startsAt, r.duration_minutes AS durationMinutes, r.status, r.source, ' +
          "(SELECT group_concat(p.name_short, '・') FROM reservation_purposes rp JOIN visit_purposes p ON p.id = rp.purpose_id WHERE rp.reservation_id = r.id) AS purposeLabel, " +
          "(SELECT s.display_name FROM reservation_assignments a JOIN staff s ON s.id = a.target_id WHERE a.reservation_id = r.id AND a.kind = 'staff' LIMIT 1) AS staffName " +
          'FROM reservations r WHERE r.organization_id = ? AND r.customer_id = ? AND r.starts_at >= ? ' +
          "AND r.status IN ('confirmed','arrived','serving') ORDER BY r.starts_at ASC LIMIT 1",
      )
      .bind(org, customerId, nowIso),
    db
      .prepare(
        // 「よくご担当した者」は列を持たない。`done` の予約の担当で最も多い者、同数なら新しいほう。
        'SELECT s.display_name AS displayName, COUNT(*) AS times, MAX(r.starts_at) AS lastAt ' +
          "FROM reservations r JOIN reservation_assignments a ON a.reservation_id = r.id AND a.kind = 'staff' " +
          'JOIN staff s ON s.id = a.target_id ' +
          "WHERE r.organization_id = ? AND r.customer_id = ? AND r.status = 'done' " +
          'GROUP BY s.id ORDER BY times DESC, lastAt DESC LIMIT 1',
      )
      .bind(org, customerId),
  ])

  const customer = ((read[0]?.results ?? []) as CustomerRecord[])[0]
  if (customer === undefined) return null
  const row = toCustomerRow(customer)
  const next = (
    (read[4]?.results ?? []) as {
      id: string
      code: string
      startsAt: string
      durationMinutes: number
      status: string
      source: string
      purposeLabel: string | null
      staffName: string | null
    }[]
  )[0]

  return {
    ...toCustomerSummary(row),
    email: customer.email,
    birthDate: customer.birthDate,
    address: customer.address,
    memo: customer.memo ?? '',
    firstVisitAt: customer.firstVisitAt === null ? null : toJstDateString(customer.firstVisitAt),
    frequentStaffName:
      ((read[5]?.results ?? []) as { displayName: string }[])[0]?.displayName ?? null,
    prescriptions: ((read[1]?.results ?? []) as PrescriptionRecord[]).map(toPrescription),
    glasses: ((read[2]?.results ?? []) as GlassesRecord[]).map((item) => ({
      id: item.id,
      purchasedAt: item.purchasedAt,
      frameName: item.frameName ?? '',
      lensName: item.lensName ?? '',
      usageLabel: item.usageLabel ?? '',
      note: item.note ?? '',
      isCurrent: item.isCurrent === '1',
    })),
    notes: await toNotes(db, env.RECORDINGS, org, (read[3]?.results ?? []) as NoteRecord[]),
    nextReservation:
      next === undefined
        ? null
        : {
            id: next.id,
            code: next.code,
            startsAt: next.startsAt,
            durationMinutes: next.durationMinutes,
            status: next.status,
            source: next.source,
            customerName: customer.name,
            visitCount: customer.visitCount,
            purposeLabel: (next.purposeLabel ?? '').slice(0, 30),
            staffName: next.staffName,
          },
    mergedIntoId: customer.mergedIntoId,
    version: customer.version,
  }
}

/**
 * お客様番号（`G-NNNNN`）。おまとめで失った番号は再利用しないので、
 * **いまある最大値の次**を採る。衝突したら 5 回まで打ち直す（予約番号と同じ考え方）。
 */
const CUSTOMER_NUMBER_MAX = 99999
const formatCustomerNumber = (serial: number): string => `G-${String(serial).padStart(5, '0')}`

async function nextCustomerSerial(db: D1Database, org: string): Promise<number> {
  const row = await db
    .prepare(
      'SELECT customer_number AS customerNumber FROM customers WHERE organization_id = ? ORDER BY customer_number DESC LIMIT 1',
    )
    .bind(org)
    .first<{ customerNumber: string }>()
  return row === null ? 1 : Number(row.customerNumber.slice(2)) + 1
}

/** 来店回数の書き戻し 3 列。`done` の件数と、来店済みの最初と最後の**瞬間**。 */
type VisitCounters = { visitCount: number; firstVisitAt: string | null; lastVisitAt: string | null }

/**
 * お客様の予約の集合から来店回数を数え直す。**読むたびに数えない**ので、
 * この関数を呼ぶのは集合が変わった書き込みのバッチの中だけである。
 * 時刻は引数で受ける（これからのご予約を「ご来店」に数えないため）。
 */
async function countVisitsOf(
  db: D1Database,
  org: string,
  customerIds: readonly string[],
  now: Date,
): Promise<VisitCounters> {
  const holes = customerIds.map(() => '?').join(',')
  const row = await db
    .prepare(
      `SELECT COUNT(CASE WHEN status = 'done' THEN 1 END) AS done, ` +
        `MIN(CASE WHEN status IN ${VISITED_STATUSES} THEN starts_at END) AS firstAt, ` +
        `MAX(CASE WHEN status IN ${VISITED_STATUSES} THEN starts_at END) AS lastAt ` +
        `FROM reservations WHERE organization_id = ? AND customer_id IN (${holes}) AND starts_at <= ?`,
    )
    .bind(org, ...customerIds, now.toISOString())
    .first<{ done: number; firstAt: string | null; lastAt: string | null }>()
  return {
    visitCount: row?.done ?? 0,
    firstVisitAt: row?.firstAt ?? null,
    lastVisitAt: row?.lastAt ?? null,
  }
}

/**
 * 台帳の帯に出すお名前と来店回数（AC-CUST-24 / AC-CUST-25）。
 * P2 は `customer_id` が常に NULL だったので 2 欄を null のまま置いてあり、ここで埋める。
 * お客様の付いていないご予約（ウォークインの前身）は null のままにする。
 */
async function customerBands(
  db: D1Database,
  org: string,
  reservationIds: readonly string[],
): Promise<Map<string, { customerName: string; visitCount: number }>> {
  const bands = new Map<string, { customerName: string; visitCount: number }>()
  if (reservationIds.length === 0) return bands
  // 内側の輪は `customers`。お客様の付いていないご予約は JOIN で落ちるので、
  // その帯は null のままになる（`LedgerEntry` の既定値）。
  const found = await db
    .prepare(
      'SELECT r.id AS reservationId, c.name, c.visit_count AS visitCount FROM reservations r ' +
        'JOIN customers c ON c.id = r.customer_id AND c.organization_id = r.organization_id ' +
        `WHERE r.organization_id = ? AND r.id IN (${reservationIds.map(() => '?').join(',')})`,
    )
    .bind(org, ...reservationIds)
    .all<{ reservationId: string; name: string; visitCount: number }>()
  for (const row of found.results) {
    bands.set(row.reservationId, { customerName: row.name, visitCount: row.visitCount })
  }
  return bands
}

/**
 * おまとめの守り。**バッチの全文に一字一句同じで配る。**
 *
 * 条件に選んでいるのは「このバッチが最後の 1 文まで動かさない値」だけである
 * （残す側と残さない側の版・統合先・両者にまたがる予約とメモの件数）。
 * 予約とメモの付け替えは 2 人ぶんを合わせた件数を変えないので、①②が走っても条件は動かない。
 * ③は残す側の項目だけを書き、版は進めない。版を進めるのは最後の 1 文だけである。
 * D1 は 0 行しか当たらない UPDATE を失敗と見なさずバッチを続けるので、条件を 1 文目にだけ
 * 付けると「拒んだと言いながら付け替えだけは済んでいる」状態ができる（AC-CUST-15）。
 */
type MergeGuard = { clause: string; params: unknown[] }

function mergeGuard(input: {
  org: string
  primaryId: string
  secondaryId: string
  primaryVersion: number
  secondaryVersion: number
  reservationCount: number
  noteCount: number
}): MergeGuard {
  return {
    clause:
      'EXISTS (SELECT 1 FROM customers p JOIN customers s ON s.organization_id = p.organization_id ' +
      'WHERE p.organization_id = ? AND p.id = ? AND p.version = ? AND p.merged_into_id IS NULL ' +
      'AND s.id = ? AND s.version = ? AND s.merged_into_id IS NULL ' +
      'AND (SELECT COUNT(*) FROM reservations r WHERE r.organization_id = p.organization_id ' +
      'AND (r.customer_id = p.id OR r.customer_id = s.id)) = ? ' +
      'AND (SELECT COUNT(*) FROM customer_notes n WHERE n.organization_id = p.organization_id ' +
      'AND (n.customer_id = p.id OR n.customer_id = s.id)) = ?)',
    params: [
      input.org,
      input.primaryId,
      input.primaryVersion,
      input.secondaryId,
      input.secondaryVersion,
      input.reservationCount,
      input.noteCount,
    ],
  }
}

/** 下見が見た件数。実行はこの写しと突き合わせ、食い違えば下見からやり直させる。 */
type MergeSnapshot = { reservationCount: number; noteCount: number }

const mergeSnapshotKey = (org: string, primaryId: string, secondaryId: string): string =>
  `merge:${org}:${primaryId}:${secondaryId}`

/** 下見の写しの寿命。取り消せない操作の手前で読ませる面なので、再生チケットと同じ 900 秒。 */
const MERGE_SNAPSHOT_TTL_SECONDS = 900

async function countMergeSubjects(
  db: D1Database,
  org: string,
  primaryId: string,
  secondaryId: string,
): Promise<MergeSnapshot> {
  const row = await db
    .prepare(
      'SELECT (SELECT COUNT(*) FROM reservations WHERE organization_id = ?1 AND (customer_id = ?2 OR customer_id = ?3)) AS reservationCount, ' +
        '(SELECT COUNT(*) FROM customer_notes WHERE organization_id = ?1 AND (customer_id = ?2 OR customer_id = ?3)) AS noteCount',
    )
    .bind(org, primaryId, secondaryId)
    .first<MergeSnapshot>()
  return { reservationCount: row?.reservationCount ?? 0, noteCount: row?.noteCount ?? 0 }
}

/** 見比べ表の 1 項目を契約の形へ落とす（`value` / `display` は画面が持つ組み立て用）。 */
const toMergeField = (field: ResolvedMergeField) => ({
  field: field.field,
  primaryValue: field.primaryValue,
  secondaryValue: field.secondaryValue,
  choice: field.choice,
})

/** おまとめに要る 2 人ぶんの行（メモの件数まで）。片方でも無ければ 404。 */
async function readMergePair(
  db: D1Database,
  org: string,
  primaryId: string,
  secondaryId: string,
): Promise<{ primary: MergeCustomer; secondary: MergeCustomer } | null> {
  const [primary, secondary] = await Promise.all([
    findCustomer(db, org, primaryId),
    findCustomer(db, org, secondaryId),
  ])
  if (primary === null || secondary === null) return null
  const counts = await db
    .prepare(
      'SELECT customer_id AS customerId, COUNT(*) AS notes FROM customer_notes ' +
        'WHERE organization_id = ? AND customer_id IN (?, ?) GROUP BY customer_id',
    )
    .bind(org, primaryId, secondaryId)
    .all<{ customerId: string; notes: number }>()
  const noteCounts = new Map(counts.results.map((row) => [row.customerId, row.notes]))
  return {
    primary: { ...toCustomerRow(primary), noteCount: noteCounts.get(primaryId) ?? 0 },
    secondary: { ...toCustomerRow(secondary), noteCount: noteCounts.get(secondaryId) ?? 0 },
  }
}

/** 保存した 1 件を契約の形で読み直す。手書きは R2 から取って再直列化してから載せる。 */
async function oneNote(
  env: Bindings,
  org: string,
  customerId: string,
  noteId: string,
): Promise<unknown | null> {
  const row = await env.DB.prepare(
    `SELECT ${NOTE_COLUMNS} FROM customer_notes WHERE organization_id = ? AND customer_id = ? AND id = ?`,
  )
    .bind(org, customerId, noteId)
    .first<NoteRecord>()
  if (row === null) return null
  const [note] = await toNotes(env.DB, env.RECORDINGS, org, [row])
  return note ?? null
}

app.post('/api/auth/token', zValidator('json', IssueTokenRequest), async (c) => {
  if (c.env.AUTH_DEV_GRANT !== 'true') return c.json({ error: 'not_found' }, 404)
  const { organizationId, role, email } = c.req.valid('json')
  // dev の便宜: 同期行を作っておかないと業務 API が 503 になる。
  // 実際の経路では admin が service binding で押し込む。
  const db = drizzle(c.env.DB)
  await db
    .insert(organizations)
    .values({
      id: organizationId,
      name: organizationId,
      plan: 'free',
      isDisabled: '0',
      createdAt: new Date().toISOString(),
      revision: '0',
    })
    .onConflictDoNothing({ target: organizations.id })
  const token = await signAccessToken(
    { sub: `dev:${organizationId}`, org: organizationId, email, role },
    c.env.JWT_SECRET,
  )
  return c.json({ token })
})

// ルートはチェーンする。`typeof routes` が RPC クライアントの型になる。

/* ───────────────────────────────────────────────────────────────────────────
 * 電話・店頭からの予約受付（P3）が共有する道具
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * 8 条件（`domain/availability.ts`）のうち、**時間が経っても変わらない理由**だけを
 * 409 のコードへ写す。
 *
 * 埋まっているかどうか（`staff_busy` / `equipment_busy` / `max_parallel`）は
 * **ここで断らない。**断ると「読んで判定して書く」形になり、読んでから書くまでの窓に
 * 別の端末の書き込みが入る。枠が取れたかどうかを決めるのは確定のバッチだけである
 * （`03-data-model.md` §7.6）。
 */
const BLOCKING_REASON: Partial<Record<AvailabilityReason, 'store_closed' | 'purpose_unavailable'>> =
  {
    closed: 'store_closed',
    outside_hours: 'store_closed',
    break: 'store_closed',
    no_skill: 'purpose_unavailable',
    staff_off: 'purpose_unavailable',
    no_equipment: 'purpose_unavailable',
    maintenance: 'purpose_unavailable',
  }

/**
 * 空き枠の面と確定の面が**同じ材料で同じ 8 条件**を解くための盤面。
 * 式を 2 つ作らないので、「画面では置けたのに確定できない」が理由の食い違いから起きない。
 */
function bookingBoard(input: {
  date: string
  now: Date
  rows: AvailabilityDayRows
  isSuspended: boolean
  durationMinutes: number
  staffId: string | null
  equipmentIds: readonly string[]
  receptionSessionId: string | null
  holds: readonly HoldOccupancy[]
  preferredStartsAt: string
  /** 変更のとき、いま入っているご予約自身を塞がりに数えない（AC-CHANGE-25）。 */
  excludeReservationId?: string | null
}): AvailabilityInput {
  return {
    date: input.date,
    now: input.now,
    slotRules: input.rows.slotRules,
    weeklyHours: input.rows.hours,
    exceptions: input.rows.exceptions,
    blackouts: input.rows.blackouts,
    isSuspended: input.isSuspended,
    purposes: input.rows.purposes,
    durationMinutes: input.durationMinutes,
    staff: input.rows.staff,
    shifts: input.rows.shifts,
    equipment: input.rows.equipment,
    maintenances: input.rows.maintenances,
    occupied: input.rows.occupied,
    holds: input.holds,
    staffId: input.staffId,
    // 空の配列は「設備を絞らない」であって「どの設備も使えない」ではない。
    equipmentIds: input.equipmentIds.length > 0 ? input.equipmentIds : undefined,
    excludeReceptionSessionId: input.receptionSessionId,
    // 自分の予約が自分の変更を邪魔しない。確定のときは undefined のままである。
    excludeReservationId: input.excludeReservationId ?? null,
    preferredStartsAt: input.preferredStartsAt,
  }
}

/** ご用件の名前と所要（**予約した時点の写し**）。並びは送られてきた順そのまま。 */
async function readPurposeLines(db: Db, org: string, purposeIds: readonly string[]) {
  const rows = await db
    .select({
      id: visitPurposes.id,
      nameShort: visitPurposes.nameShort,
      nameInternal: visitPurposes.nameInternal,
      durationMinutes: visitPurposes.durationMinutes,
    })
    .from(visitPurposes)
    .where(and(eq(visitPurposes.organizationId, org), inArray(visitPurposes.id, [...purposeIds])))
  const byId = new Map(rows.map((row) => [row.id, row]))
  return purposeIds.flatMap((id) => {
    const row = byId.get(id)
    return row === undefined ? [] : [row]
  })
}

/** 自分の組織の受付だけを引く。他テナントの id は「無い」として扱う。 */
async function findReceptionSession(db: Db, org: string, sessionId: string) {
  const rows = await db
    .select()
    .from(receptionSessions)
    .where(and(eq(receptionSessions.organizationId, org), eq(receptionSessions.id, sessionId)))
  return rows[0] ?? null
}

/** 受付 1 行 → 契約の形。下書きは保存したときの形のまま読み直す。 */
function toReceptionSession(row: typeof receptionSessions.$inferSelect) {
  return {
    id: row.id,
    storeId: row.storeId,
    reservationId: row.reservationId,
    terminalId: row.terminalId,
    actorId: row.actorId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    outcome: row.outcome,
    draft: row.draftJson === null ? null : ReceptionSessionDraft.parse(JSON.parse(row.draftJson)),
    createdAt: row.createdAt,
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * 来店受付とウォークイン（P5）が共有する道具
 *
 * 芯は **顧客未特定のまま受付と接客が始まる**ことである。`customer_id` は最後まで
 * NULL を許し、あとから `PATCH /api/staff/walkins/:walkinId` で結び直す。
 * 待ち時間は列に持たず、`serverNow − arrived_at` を応答の側で出す
 * （端末の時計を読ませない。`domain/walkin.ts` の `waitedMinutes`）。
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * 枠が取れた予約にだけ後続の文を当てる条件。**`domain/booking.ts` の `LOCKED` と
 * 一字一句同じ形**である（あちらはモジュール内の const なので、写しはこの 1 か所だけ）。
 * 付け忘れると、枠が取れていないのに受付の行と整理番号だけが書かれる。
 */
const WALKIN_LOCKED =
  'EXISTS (SELECT 1 FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ?)'

/** 整理番号の打ち直し。予約番号（`RESERVATION_CODE_ATTEMPTS`）と同じ 5 回。 */
const WALKIN_TICKET_ATTEMPTS = 5

/** ご用件を伺えていない受付の所要。4 択を選べば目的の所要が優先される。 */
const WALKIN_DEFAULT_MINUTES = 30

/**
 * 「接客が始まった」工程。ここへ入った来店は待ちの帯から外れる（`walk_ins.status='serving'`）。
 * `received` と `waiting` を入れない — 受け付けただけの人を接客中に数えると、
 * 「お待たせ中」の分数が誰にも出なくなる。
 */
const SERVING_STAGES: ReadonlySet<string> = new Set([
  'consulting',
  'fitting',
  'measuring',
  'checkout',
  'handover',
])

/** 一覧・詳細が同じ形で読む列。別名は契約の欄名に揃える。 */
const WALKIN_COLUMNS =
  'id, store_id AS storeId, visit_date AS visitDate, ticket_no AS ticketNo, ' +
  'arrived_at AS arrivedAt, purpose_id AS purposeId, purpose_note AS purposeNote, ' +
  'customer_id AS customerId, reservation_id AS reservationId, status, ' +
  'left_at AS leftAt, version'

type WalkinRecord = {
  id: string
  storeId: string
  visitDate: string
  ticketNo: number
  arrivedAt: string
  purposeId: string | null
  purposeNote: string | null
  customerId: string | null
  reservationId: string
  status: string
  leftAt: string | null
  version: number
}

/** 自分の組織のウォークインだけを引く。他テナントの id は「無い」として扱う（404）。 */
async function findWalkin(
  db: D1Database,
  org: string,
  walkinId: string,
): Promise<WalkinRecord | null> {
  return db
    .prepare(`SELECT ${WALKIN_COLUMNS} FROM walk_ins WHERE organization_id = ? AND id = ?`)
    .bind(org, walkinId)
    .first<WalkinRecord>()
}

/** D1 の行 → 契約の `Walkin`。**待ち時間は列ではなく差から出す。** */
function toWalkin(row: WalkinRecord, now: Date) {
  return {
    id: row.id,
    ticketNo: row.ticketNo,
    arrivedAt: row.arrivedAt,
    purposeId: row.purposeId,
    purposeNote: row.purposeNote,
    customerId: row.customerId,
    reservationId: row.reservationId,
    status: row.status,
    waitedMinutes: waitedMinutes(row.arrivedAt, now),
    leftAt: row.leftAt,
    version: row.version,
  }
}

/**
 * 「いまお待ち N名」と「次の整理番号」を **1 文で**数える。
 *
 * **日付の条件を落とさない** — 落とすと昨日帰られたお客様が今朝の待ち行列に残り、
 * 待ち時間の目安まで狂う（`03-data-model.md` §7.4）。最大の整理番号が null なのは
 * その日がまだ 0 件のときで、`nextTicketNo(null)` が 1 を返す（日が変われば 1 に戻る）。
 */
async function readWalkinCounters(
  db: D1Database,
  org: string,
  storeId: string,
  visitDate: string,
): Promise<{ waiting: number; maxTicketNo: number | null }> {
  const row = await db
    .prepare(
      "SELECT COUNT(CASE WHEN status = 'waiting' THEN 1 END) AS waiting, MAX(ticket_no) AS maxTicket " +
        'FROM walk_ins WHERE organization_id = ? AND store_id = ? AND visit_date = ?',
    )
    .bind(org, storeId, visitDate)
    .first<{ waiting: number; maxTicket: number | null }>()
  return { waiting: row?.waiting ?? 0, maxTicketNo: row?.maxTicket ?? null }
}

/**
 * 来店回数の書き戻し 1 文。**接客が終わった行（`status='done'`）だけを数える。**
 *
 * `db.batch()` は 1 トランザクションを順に流すので、この文より前に置いた
 * 「ご予約を `done` にする」UPDATE の結果をそのまま読む。読み出してから足し算した値を
 * 書くと、同じ瞬間の別の退店と足し合わさって二重に増える。
 */
function bumpVisitCounters(db: D1Database, org: string, customerId: string, now: Date): Statement {
  const nowIso = now.toISOString()
  return db
    .prepare(
      "UPDATE customers SET visit_count = (SELECT COUNT(*) FROM reservations WHERE organization_id = ? AND customer_id = ? AND status = 'done'), " +
        `first_visit_at = (SELECT MIN(starts_at) FROM reservations WHERE organization_id = ? AND customer_id = ? AND status IN ${VISITED_STATUSES} AND starts_at <= ?), ` +
        `last_visit_at = (SELECT MAX(starts_at) FROM reservations WHERE organization_id = ? AND customer_id = ? AND status IN ${VISITED_STATUSES} AND starts_at <= ?), ` +
        'updated_at = ? WHERE organization_id = ? AND id = ?',
    )
    .bind(
      org,
      customerId,
      org,
      customerId,
      nowIso,
      org,
      customerId,
      nowIso,
      nowIso,
      org,
      customerId,
    )
}

/** 監査 1 行。受付の記録の端末欄は P10 まで NULL のまま置く（`013-terminals-and-audit`）。 */
function auditRow(
  db: D1Database,
  input: {
    organizationId: string
    /** 組織そのものへの操作（受付履歴の閲覧）だけ null になる。 */
    storeId: string | null
    actorId: string | null
    action: string
    targetType: string
    targetId: string
    after: unknown
    correlationId: string
    occurredAt: string
    /** 枠が取れた予約にだけ当てる条件（`reservationId` を渡したときだけ付く）。 */
    lockedFor?: string
  },
): Statement {
  const guard = input.lockedFor === undefined ? '' : ` WHERE ${WALKIN_LOCKED}`
  const lock = input.lockedFor === undefined ? [] : [input.organizationId, input.lockedFor]
  return db
    .prepare(
      'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
        `SELECT ?, ?, ?, 'staff', ?, NULL, ?, ?, ?, NULL, ?, ?, ?${guard}`,
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.storeId,
      input.actorId,
      input.action,
      input.targetType,
      input.targetId,
      JSON.stringify(input.after),
      input.correlationId,
      input.occurredAt,
      ...lock,
    )
}

/* --- 受付履歴 ------------------------------------------------------------- */

/** 一覧の 1 行を組み立てるために 4 表から読む列。 */
type HistoryEntryRecord = {
  reservationId: string
  startsAt: string
  reservationStatus: string
  createdAt: string
  walkinId: string | null
  ticketNo: number | null
  arrivedAt: string | null
  customerName: string | null
  customerKana: string | null
  visitCount: number | null
  sessionId: string | null
  sessionStartedAt: string | null
  actorId: string | null
  outcome: string | null
}

/** 「そのあとの変更」1 行の材料（`audit_events` × `staff`）。 */
type AuditChangeRecord = {
  action: string
  beforeJson: string | null
  afterJson: string | null
  occurredAt: string
  actorName: string | null
}

/** 受付そのものの行。工程は `after_json` の `stage` で読み分ける。 */
const RECEPTION_CHANGE_LABELS: Readonly<Record<string, string>> = {
  'reservation.created': '新しく受け付けました',
  'walkin.created': '店頭のお客様を受け付けました',
}

/** 工程 8 語の言い方。画面の列見出しと同じ言葉にする（覚え直しを作らない）。 */
const STAGE_CHANGE_LABELS: Readonly<Record<string, string>> = {
  received: 'ご来店を受け付けました',
  waiting: 'お待ちいただいています',
  consulting: 'ご相談を始めました',
  fitting: 'フレーム選びを始めました',
  measuring: '視力測定を始めました',
  checkout: 'レンズ・お会計を始めました',
  handover: 'お渡しを始めました',
  left: 'ご退店になりました',
}

/** JST の壁時計（`11:00`）。経緯の 1 行は時刻だけを読み上げる。 */
const jstClock = (iso: string): string =>
  new Date(Date.parse(iso) + 9 * 60 * MS_PER_MINUTE).toISOString().slice(11, 16)

/** 取り消しの理由 → 経緯の 1 行。`no_show` だけ言い方が変わる。 */
const CANCEL_CHANGE_LABELS: Readonly<Record<string, string>> = {
  no_show: 'ご来店がありませんでした',
  customer: 'ご予約を取り消しました（お客様のご都合）',
  store: 'ご予約を取り消しました（店舗の都合）',
  duplicate: 'ご予約を取り消しました（予約の重複）',
}

/**
 * 監査 1 行 → 「そのあとの変更」の文。**知らない `action` は出さない**（null）。
 * 出すと、まだ画面の無い操作の綴りがそのままお客様対応の場に出る。
 *
 * 変更（`reservation.rescheduled`）だけは前後の値を読んで 1 行にする
 * （AC-CHANGE-18「ご来店時刻を 11:00 から 14:00 へ」）。日時が動いていない変更は
 * 担当・場所・ご用件の置き直しなので、時刻を語らない 1 文にまとめる。
 */
function changeLabel(
  action: string,
  afterJson: string | null,
  beforeJson: string | null = null,
): string | null {
  if (action === 'reservation.rescheduled') {
    const before = beforeJson === null ? null : (JSON.parse(beforeJson) as { startsAt?: string })
    const after = afterJson === null ? null : (JSON.parse(afterJson) as { startsAt?: string })
    if (before?.startsAt === undefined || after?.startsAt === undefined) return null
    return before.startsAt === after.startsAt
      ? 'ご予約の内容を直しました'
      : `ご来店時刻を ${jstClock(before.startsAt)} から ${jstClock(after.startsAt)} へ`
  }
  if (action === 'reservation.cancelled') {
    const after = afterJson === null ? null : (JSON.parse(afterJson) as { reason?: string })
    return after?.reason === undefined ? null : (CANCEL_CHANGE_LABELS[after.reason] ?? null)
  }
  if (action !== 'visit.stage.changed') return RECEPTION_CHANGE_LABELS[action] ?? null
  const after = afterJson === null ? null : (JSON.parse(afterJson) as { stage?: string })
  return after?.stage === undefined ? null : (STAGE_CHANGE_LABELS[after.stage] ?? null)
}

/**
 * ご予約 1 件の詳細。台帳の帯と同じ 1 か所（`customerBands`）からお名前を引く。
 * 受付履歴の右側（`ReceptionHistoryDetail.reservation`）も同じものを読む。
 */
async function reservationDetailOf(env: Bindings, org: string, reservationId: string) {
  const db = drizzle(env.DB)
  const found = await readReservationDetail(db, { organizationId: org, reservationId })
  if (found === null) return null
  const { reservation, purposes, assignments } = found
  const band = (await customerBands(env.DB, org, [reservation.id])).get(reservation.id) ?? null
  return ReservationDetail.parse({
    id: reservation.id,
    code: reservation.code,
    storeId: reservation.storeId,
    source: reservation.source,
    status: reservation.status,
    startsAt: reservation.startsAt,
    endsAt: reservation.endsAt,
    durationMinutes: reservation.durationMinutes,
    customerId: reservation.customerId,
    customerName: band?.customerName ?? null,
    visitCount: band?.visitCount ?? null,
    purposes: purposes.map((row) => ({
      purposeId: row.purposeId,
      nameInternal: row.nameInternal,
      durationMinutes: row.durationMinutes,
      sortOrder: row.sortOrder,
    })),
    assignments: assignments.map((row) => ({
      kind: row.kind,
      targetId: row.targetId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    })),
    webBookingCode: webBookingCodeOf(reservation.source, reservation.code),
    // 台帳の帯は短い名前、詳細と復唱は業務の名前（`03-data-model.md` §6.1）。
    purposeLabel: purposes.map((row) => row.nameShort).join('・'),
    purposeLabelInternal: purposes.map((row) => row.nameInternal).join('・'),
    noteCustomer: reservation.noteCustomer ?? '',
    noteInternal: reservation.noteInternal ?? '',
    version: reservation.version,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
    createdBy: reservation.createdBy,
    cancelledAt: reservation.cancelledAt,
    cancelReason: reservation.cancelReason,
  })
}

/* --- 予約を探す・直す（P6） ------------------------------------------------ */

/**
 * 検索の外側の輪。**`reservations` を先に絞ってからお客様を引く。**
 * 逆にすると、お名前の部分一致が顧客表の全走査になってから予約へ広がる。
 */
const RESERVATION_SEARCH_FROM =
  'FROM reservations r LEFT JOIN customers c ON c.organization_id = r.organization_id AND c.id = r.customer_id'

/** 直せるご予約の状態。取り消した・ご来店がなかった・終わったご予約は直せない。 */
const CHANGEABLE_STATUS: ReadonlySet<string> = new Set(['confirmed', 'arrived', 'serving'])

/** お客様が Web の控えから読み上げるご予約番号の頭。 */
const WEB_CODE_HEAD = 'EY-W-'

/**
 * 契約のクエリ → 検索ドメインの入力。
 *
 * **組織と店舗はここでしか付かない。**呼び出し側がこの 2 つを外せる形にしないために、
 * 引数で受けて必ず入れる（`resolveSearch` も先頭 2 条件に据える）。
 * `EY-W-` のご予約番号は `web_bookings` を引かない — その表は P8 が作る。いまの番号は
 * `webBookingCodeOf` が業務側の番号から機械的に作っているので、同じ規則の逆を引く
 * （採番の系統を 2 つ持たない）。
 *
 * **番号を業務側へ直すだけでは足りない。**`EY-W-2608-0142` は Web のご予約にしか無い
 * 番号で、同じ連番の `EY-2608-0142` がお電話のご予約なら、その番号はどこにも存在しない。
 * 直しただけだとそのお電話のご予約が 1 件当たり、受付が別のお客様のご予約を開く。
 * だから出どころも Web に絞る。「お電話でのご予約だけ」と重なったときは空の並びになり、
 * `resolveSearch` がどの行にも当たらない条件を組み立てる（0 件で返り、
 * 「「お電話でのご予約だけ」を外す」が緩和候補に出る）。
 */
function reservationSearchInput(
  org: string,
  storeId: string,
  query: ReservationSearchQuery,
): ReservationSearchInput {
  const asked = query.source.length > 0 ? query.source : undefined
  const source =
    query.code?.startsWith(WEB_CODE_HEAD) === true
      ? (asked ?? ['web']).filter((word) => word === 'web')
      : asked
  return {
    organizationId: org,
    storeId,
    name: query.name,
    kana: query.kana,
    phone: query.phone,
    code: query.code?.replace(WEB_CODE_HEAD, 'EY-'),
    from: query.from,
    to: query.to,
    source,
    status: query.status.length > 0 ? query.status : undefined,
    staffId: query.staffId,
    includeCancelled: query.includeCancelled,
  }
}

/**
 * 緩和候補へ渡す条件。**そのまま再送できる欄だけ**を載せる。
 * `crossStore` / `limit` / `cursor` を混ぜると、案を押した再検索が
 * `?crossStore=false`（文字列）で 400 になる（契約は `z.literal(false)`）。
 */
function relaxableQuery(query: ReservationSearchQuery): ReservationSearchQueryLike {
  return {
    storeId: query.storeId,
    name: query.name,
    kana: query.kana,
    phone: query.phone,
    code: query.code,
    from: query.from,
    to: query.to,
    status: query.status.length > 0 ? query.status : undefined,
    source: query.source.length > 0 ? query.source : undefined,
    staffId: query.staffId,
    includeCancelled: query.includeCancelled,
  }
}

/** 条件を 1 本の `WHERE` に畳む。1 条件が複数の比較を持つので必ず括る。 */
const whereOf = (conditions: readonly { sql: string }[]): string =>
  conditions.map((condition) => `(${condition.sql})`).join(' AND ')

/** 条件に当たる件数。緩和候補の「5件」も画面の「結果 4件」もこの 1 か所で数える。 */
async function countReservations(
  db: D1Database,
  org: string,
  storeId: string,
  query: ReservationSearchQuery,
): Promise<number> {
  const resolved = resolveSearch(reservationSearchInput(org, storeId, query))
  const row = await db
    .prepare(`SELECT COUNT(*) AS n ${RESERVATION_SEARCH_FROM} WHERE ${whereOf(resolved.where)}`)
    .bind(...resolved.params)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/**
 * 0 件のときだけ付ける条件を 1 つ緩めた候補。
 *
 * 案ごとに `relaxationsFor` を 1 回ずつ空撃ちして**緩めたクエリそのもの**を受け取り、
 * その件数を数え直してからもう 1 度呼ぶ。期間を広げる幅の規則をドメインに 1 つだけ置き、
 * ルートが同じ計算を複製しないので、**案に出した件数と押したあとの件数が食い違わない**。
 */
async function relaxationsWithCounts(
  db: D1Database,
  org: string,
  storeId: string,
  query: ReservationSearchQuery,
) {
  const wire = relaxableQuery(query)
  const counts: RelaxationCounts = { total: 0 }
  for (const kind of ['period', 'source', 'cancelled'] as const) {
    const probe = relaxationsFor(wire, { total: 0, [kind]: 1 })[0]
    if (probe === undefined) continue
    const relaxed = ReservationSearchQuery.safeParse(probe.query)
    if (!relaxed.success) continue
    counts[kind] = await countReservations(db, org, storeId, relaxed.data)
  }
  return relaxationsFor(wire, counts)
}

/** 一覧の 1 行のご用件（`name_short` を「・」で連ねる）。台帳の帯と同じ言葉である。 */
async function purposeLabelsOf(
  db: D1Database,
  org: string,
  reservationIds: readonly string[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  if (reservationIds.length === 0) return labels
  const found = await db
    .prepare(
      'SELECT rp.reservation_id AS reservationId, p.name_short AS nameShort FROM reservation_purposes rp ' +
        'JOIN visit_purposes p ON p.organization_id = rp.organization_id AND p.id = rp.purpose_id ' +
        `WHERE rp.organization_id = ? AND rp.reservation_id IN (${reservationIds.map(() => '?').join(',')}) ` +
        'ORDER BY rp.reservation_id, rp.sort_order',
    )
    .bind(org, ...reservationIds)
    .all<{ reservationId: string; nameShort: string }>()
  for (const row of found.results) {
    const seen = labels.get(row.reservationId)
    labels.set(row.reservationId, seen === undefined ? row.nameShort : `${seen}・${row.nameShort}`)
  }
  return labels
}

/** 一覧の 1 行の担当。決まっていない行は null のまま返す（画面が「担当が未定」と描く）。 */
async function staffNamesOf(
  db: D1Database,
  org: string,
  reservationIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (reservationIds.length === 0) return names
  const found = await db
    .prepare(
      'SELECT ra.reservation_id AS reservationId, s.display_name AS displayName FROM reservation_assignments ra ' +
        'JOIN staff s ON s.organization_id = ra.organization_id AND s.id = ra.target_id ' +
        `WHERE ra.organization_id = ? AND ra.kind = 'staff' AND ra.reservation_id IN (${reservationIds.map(() => '?').join(',')})`,
    )
    .bind(org, ...reservationIds)
    .all<{ reservationId: string; displayName: string }>()
  for (const row of found.results) names.set(row.reservationId, row.displayName)
  return names
}

/**
 * 版が合わなかったときに載せる**相手の内容**（EX-CONFLICT の左側）。
 *
 * 1 行も書けていないので、ここで読み直して差し支えない。載せるのは画面が
 * 「相手の内容を残す」を描くのに要るものだけで、これが無いと 409 のたびに
 * 画面がご予約 1 件を取り直す往復を足すことになる。
 */
async function conflictingVersion(env: Bindings, org: string, reservationId: string) {
  const detail = await reservationDetailOf(env, org, reservationId)
  if (detail === null) return null
  const staffId = detail.assignments.find((band) => band.kind === 'staff')?.targetId ?? null
  const equipmentIds = detail.assignments.flatMap((band) =>
    band.kind === 'equipment' && band.targetId !== null ? [band.targetId] : [],
  )
  const staffName =
    staffId === null
      ? null
      : ((
          await env.DB.prepare(
            'SELECT display_name AS displayName FROM staff WHERE organization_id = ? AND id = ?',
          )
            .bind(org, staffId)
            .first<{ displayName: string }>()
        )?.displayName ?? null)
  const equipmentNames =
    equipmentIds.length === 0
      ? []
      : (
          await env.DB.prepare(
            `SELECT name FROM equipment WHERE organization_id = ? AND id IN (${equipmentIds.map(() => '?').join(',')})`,
          )
            .bind(org, ...equipmentIds)
            .all<{ name: string }>()
        ).results.map((row) => row.name)
  // 「受付iPad の 中村 彩 が 11:06 に保存しました。」の人。共有端末では null になる。
  const savedBy =
    (
      await env.DB.prepare(
        'SELECT s.display_name AS displayName FROM audit_events a ' +
          'LEFT JOIN staff s ON s.organization_id = a.organization_id AND s.id = a.actor_id ' +
          'WHERE a.organization_id = ? AND a.target_id = ? ORDER BY a.occurred_at DESC, a.id DESC LIMIT 1',
      )
        .bind(org, reservationId)
        .first<{ displayName: string | null }>()
    )?.displayName ?? null
  return {
    version: detail.version,
    startsAt: detail.startsAt,
    endsAt: detail.endsAt,
    staffName,
    equipmentNames,
    savedAt: detail.updatedAt,
    savedBy,
  }
}

const routes = app
  .get('/api/health', (c) => c.json({ status: 'ok' as const }))

  // admin からの組織スナップショット。revision は単調増加なので、自分が持つ
  // revision より小さい配信は無視して現在値を返す（古い配信で巻き戻さない）。
  .post('/api/internal/organizations/sync', zValidator('json', OrganizationSync), async (c) => {
    const db = drizzle(c.env.DB)
    const incoming = c.req.valid('json')
    const existing = (
      await db.select().from(organizations).where(eq(organizations.id, incoming.id))
    )[0]
    if (existing && Number(existing.revision ?? '0') > incoming.revision) {
      return c.json(OrganizationSync.parse(toOrgFields(existing)), 200)
    }
    const row = {
      id: incoming.id,
      name: incoming.name,
      plan: incoming.plan,
      isDisabled: incoming.isDisabled ? ('1' as const) : ('0' as const),
      createdAt: incoming.createdAt,
      revision: String(incoming.revision),
    }
    await db
      .insert(organizations)
      .values(row)
      .onConflictDoUpdate({
        target: organizations.id,
        set: {
          name: row.name,
          plan: row.plan,
          isDisabled: row.isDisabled,
          revision: row.revision,
        },
      })
    return c.json(OrganizationSync.parse(incoming), 200)
  })

  // admin の日次照合が読む。admin↔ドメインのずれを検出するための一覧。
  .get('/api/internal/organizations', async (c) => {
    const db = drizzle(c.env.DB)
    const rows = await db.select().from(organizations).orderBy(asc(organizations.createdAt))
    return c.json(OrganizationSync.array().parse(rows.map(toOrgFields)))
  })

  // admin からの担当店舗。担当解除は permissions が空の配信として届くので、
  // 削除の経路を持たずに収束する。
  .post('/api/internal/store-memberships/sync', zValidator('json', StoreMembership), async (c) => {
    const db = drizzle(c.env.DB)
    const membership = c.req.valid('json')
    const row = {
      id: membership.id,
      organizationId: membership.organizationId,
      storeId: membership.storeId,
      userId: membership.userId,
      permissions: membership.permissions.join(' '),
      createdAt: membership.createdAt,
    }
    await db
      .insert(storeMemberships)
      .values(row)
      .onConflictDoUpdate({
        target: storeMemberships.id,
        set: { storeId: row.storeId, userId: row.userId, permissions: row.permissions },
      })
    return c.json(membership, 200)
  })

  // 選択できる店舗の一覧。テナントの org でだけ絞る（店舗の選択はこの後の画面で行う）。
  .get('/api/staff/stores', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const rows = await db
      .select()
      .from(stores)
      .where(eq(stores.organizationId, org))
      .orderBy(asc(stores.createdAt))
    return c.json(
      Store.array().parse(
        rows.map((r) => ({
          id: r.id,
          organizationId: r.organizationId,
          name: r.name,
          slug: r.slug,
          phone: r.phone,
          address: r.address,
          accessNote: r.accessNote,
          isActive: r.isActive === '1',
          createdAt: r.createdAt,
        })),
      ),
    )
  })

  /* --- SETTINGS-STORE ---------------------------------------------------- */

  .get('/api/staff/stores/:storeId', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const storeId = c.req.param('storeId')
    const store = await findStore(db, org, storeId)
    if (!store) return c.json({ error: 'not_found' }, 404)
    return c.json(StoreDetail.parse(toStoreDetail(store, await readVersion(db, org, storeId))))
  })

  .patch(
    '/api/staff/stores/:storeId',
    requireStorePermission('settings.manage'),
    zValidator('json', StorePatch),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const store = await findStore(db, org, storeId)
      if (!store) return c.json({ error: 'not_found' }, 404)
      const patch = c.req.valid('json')
      const pick = <T>(value: T | undefined, current: T): T =>
        value === undefined ? current : value
      const next = {
        name: pick(patch.name, store.name),
        namePublic: pick(patch.namePublic, store.namePublic),
        phone: pick(patch.phone, store.phone),
        address: pick(patch.address, store.address),
        nearestStation: pick(patch.nearestStation, store.nearestStation),
        accessNote: pick(patch.accessNote, store.accessNote),
        parkingNote: pick(patch.parkingNote, store.parkingNote),
        introText: pick(patch.introText, store.introText),
        sortOrder: pick(patch.sortOrder, store.sortOrder),
      }

      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)
      const write = settingsWriter(c.env.DB, versionGuard(org, storeId, patch.version))
      const saved = await commitSettings(c.env.DB, [
        write.at(
          `UPDATE stores SET name = ?, name_public = ?, phone = ?, address = ?, nearest_station = ?, access_note = ?, parking_note = ?, intro_text = ?, sort_order = ?, updated_at = ?, updated_by = ? WHERE organization_id = ? AND id = ? AND ${write.guard}`,
          [
            next.name,
            next.namePublic,
            next.phone,
            next.address,
            next.nearestStation,
            next.accessNote,
            next.parkingNote,
            next.introText,
            next.sortOrder,
            now,
            by,
            org,
            storeId,
          ],
        ),
        bumpVersion(c.env.DB, org, storeId, patch.version, now, by),
      ])
      if (!saved) return c.json({ error: 'version_conflict' }, 409)

      const after = await findStore(db, org, storeId)
      if (!after) return c.json({ error: 'not_found' }, 404)
      return c.json(StoreDetail.parse(toStoreDetail(after, await readVersion(db, org, storeId))))
    },
  )

  /* --- SETTINGS-HOURS（営業時間と止める帯） ------------------------------- */

  .get('/api/staff/stores/:storeId/business-hours', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const storeId = c.req.param('storeId')
    if (!(await findStore(db, org, storeId))) return c.json({ error: 'not_found' }, 404)
    return c.json(await hoursView(db, org, storeId))
  })

  .put(
    '/api/staff/stores/:storeId/business-hours',
    requireStorePermission('settings.manage'),
    zValidator('json', BusinessHoursInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const input = c.req.valid('json')
      const rejections = validateHoursInput({ rows: input.rows, blackouts: input.blackouts })
      if (rejections.length > 0) {
        return c.json(rejected(rejections.map((rejection) => rejection.message)), 400)
      }

      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)
      const write = settingsWriter(c.env.DB, versionGuard(org, storeId, input.version))
      const saved = await commitSettings(c.env.DB, [
        write.at(
          `DELETE FROM store_business_hours WHERE organization_id = ? AND store_id = ? AND ${write.guard}`,
          [org, storeId],
        ),
        ...input.rows.map((row) =>
          write.at(
            `INSERT INTO store_business_hours (id, organization_id, store_id, weekday, is_closed, opens_at, closes_at, break_start, break_end, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ? WHERE ${write.guard}`,
            [
              crypto.randomUUID(),
              org,
              storeId,
              row.weekday,
              flag(row.isClosed),
              row.opensAt,
              row.closesAt,
              now,
            ],
          ),
        ),
        write.at(
          `DELETE FROM store_blackout_windows WHERE organization_id = ? AND store_id = ? AND ${write.guard}`,
          [org, storeId],
        ),
        ...input.blackouts.map((band) =>
          write.at(
            `INSERT INTO store_blackout_windows (id, organization_id, store_id, weekday, starts_at, ends_at, label, sort_order, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${write.guard}`,
            [
              crypto.randomUUID(),
              org,
              storeId,
              band.weekday,
              band.startsAt,
              band.endsAt,
              band.label,
              band.sortOrder,
              now,
            ],
          ),
        ),
        bumpVersion(c.env.DB, org, storeId, input.version, now, by),
      ])
      if (!saved) return c.json({ error: 'version_conflict' }, 409)
      return c.json(await hoursView(db, org, storeId))
    },
  )

  /* --- SETTINGS-CALENDAR（営業日） --------------------------------------- */

  .get(
    '/api/staff/stores/:storeId/calendar-exceptions',
    zValidator('query', CalendarExceptionQuery),
    async (c) => {
      const db = drizzle(c.env.DB)
      const org = c.get('auth').org
      const storeId = c.req.param('storeId')
      if (!(await findStore(db, org, storeId))) return c.json({ error: 'not_found' }, 404)
      const { from, to } = c.req.valid('query')
      const rows = await db
        .select()
        .from(storeCalendarExceptions)
        .where(
          and(
            eq(storeCalendarExceptions.organizationId, org),
            eq(storeCalendarExceptions.storeId, storeId),
            gte(storeCalendarExceptions.date, from),
            lte(storeCalendarExceptions.date, to),
          ),
        )
        .orderBy(asc(storeCalendarExceptions.date))
      return c.json(
        CalendarException.array().parse(
          rows.map((row) => ({
            id: row.id,
            date: row.date,
            kind: row.kind,
            opensAt: row.opensAt,
            closesAt: row.closesAt,
            note: row.note,
          })),
        ),
      )
    },
  )

  .post(
    '/api/staff/stores/:storeId/calendar-exceptions',
    requireStorePermission('settings.manage'),
    zValidator('json', CalendarExceptionInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const input = c.req.valid('json')
      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)

      // 同じ日を 2 度押しても行は 1 つ。日付の一意 index に載せて上書きする。
      await commitUnversioned(c.env.DB, [
        c.env.DB.prepare(
          'INSERT INTO store_calendar_exceptions (id, organization_id, store_id, date, kind, opens_at, closes_at, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (organization_id, store_id, date) DO UPDATE SET kind = excluded.kind, opens_at = excluded.opens_at, closes_at = excluded.closes_at, note = excluded.note',
        ).bind(
          crypto.randomUUID(),
          org,
          storeId,
          input.date,
          input.kind,
          input.opensAt,
          input.closesAt,
          input.note,
          now,
          by,
        ),
        bumpVersion(c.env.DB, org, storeId, null, now, by),
      ])

      const rows = await db
        .select()
        .from(storeCalendarExceptions)
        .where(
          and(
            eq(storeCalendarExceptions.organizationId, org),
            eq(storeCalendarExceptions.storeId, storeId),
            eq(storeCalendarExceptions.date, input.date),
          ),
        )
      const row = rows[0]
      if (!row) return c.json({ error: 'not_found' }, 404)
      return c.json(
        CalendarException.parse({
          id: row.id,
          date: row.date,
          kind: row.kind,
          opensAt: row.opensAt,
          closesAt: row.closesAt,
          note: row.note,
        }),
      )
    },
  )

  .delete(
    '/api/staff/stores/:storeId/calendar-exceptions/:exceptionId',
    requireStorePermission('settings.manage'),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const exceptionId = c.req.param('exceptionId')
      const rows = await db
        .select({ id: storeCalendarExceptions.id })
        .from(storeCalendarExceptions)
        .where(
          and(
            eq(storeCalendarExceptions.organizationId, org),
            eq(storeCalendarExceptions.storeId, storeId),
            eq(storeCalendarExceptions.id, exceptionId),
          ),
        )
      if (rows.length === 0) return c.json({ error: 'not_found' }, 404)

      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)
      await commitUnversioned(c.env.DB, [
        c.env.DB.prepare(
          'DELETE FROM store_calendar_exceptions WHERE organization_id = ? AND store_id = ? AND id = ?',
        ).bind(org, storeId, exceptionId),
        bumpVersion(c.env.DB, org, storeId, null, now, by),
      ])
      return c.json(DeletedResult.parse({ id: exceptionId, deleted: true }))
    },
  )

  /* --- SETTINGS-HOURS 右カラム（予約の間隔） ------------------------------ */

  .get('/api/staff/stores/:storeId/slot-rules', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const storeId = c.req.param('storeId')
    if (!(await findStore(db, org, storeId))) return c.json({ error: 'not_found' }, 404)
    const rules = await readSlotRulesRow(db, org, storeId)
    // 行が無い店舗は「設定未完」。暗黙の既定値を作らず、画面に決めさせる。
    if (!rules) return c.json({ error: 'not_found' }, 404)
    // 読むときも保存したときと同じ姿を返す。「木曜日に最後にお受けできるのは 18:20 です。」は
    // 画面を開いた直後から出す（AC-SET-07）。式は空き枠エンジンと 1 本である。
    return c.json(
      await slotRulesView(db, org, storeId, {
        slotMinutes: rules.slotMinutes,
        cleanupMinutes: rules.cleanupMinutes,
        maxParallel: rules.maxParallel,
        updatedAt: rules.updatedAt,
      }),
    )
  })

  .put(
    '/api/staff/stores/:storeId/slot-rules',
    requireStorePermission('settings.manage'),
    zValidator('json', SlotRulesInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const input = c.req.valid('json')
      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)
      const write = settingsWriter(c.env.DB, versionGuard(org, storeId, input.version))
      // 行の version は設定の版に合わせて進める（画面が版を 2 つ持たないようにする）。
      const nextVersion = input.version + 1
      const saved = await commitSettings(c.env.DB, [
        write.at(
          `INSERT INTO store_slot_rules (id, organization_id, store_id, slot_minutes, cleanup_minutes, max_parallel, version, updated_at, updated_by, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${write.guard} ON CONFLICT (organization_id, store_id) DO UPDATE SET slot_minutes = excluded.slot_minutes, cleanup_minutes = excluded.cleanup_minutes, max_parallel = excluded.max_parallel, version = excluded.version, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          [
            crypto.randomUUID(),
            org,
            storeId,
            input.slotMinutes,
            input.cleanupMinutes,
            input.maxParallel,
            nextVersion,
            now,
            by,
            now,
          ],
        ),
        bumpVersion(c.env.DB, org, storeId, input.version, now, by),
      ])
      if (!saved) return c.json({ error: 'version_conflict' }, 409)
      return c.json(
        await slotRulesView(db, org, storeId, {
          slotMinutes: input.slotMinutes,
          cleanupMinutes: input.cleanupMinutes,
          maxParallel: input.maxParallel,
          updatedAt: now,
        }),
      )
    },
  )

  /* --- SETTINGS-STAFF（スタッフと技能） ---------------------------------- */

  // 真偽値は `?includeInactive=true` の形で届く。契約側の `QueryFlag` が
  // `true` / `1` / `false` / `0` を受け、知らない語は `validQuery` が 400 にする。
  .get('/api/staff/stores/:storeId/staff', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const storeId = c.req.param('storeId')
    if (!(await findStore(db, org, storeId))) return c.json({ error: 'not_found' }, 404)
    const query = validQuery(c, StaffListQuery, c.req.query())
    return c.json(StaffMember.array().parse(await readStaff(db, org, storeId, query)))
  })

  .post(
    '/api/staff/stores/:storeId/staff',
    requireStorePermission('settings.manage'),
    zValidator('json', StaffMemberInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const input = c.req.valid('json')
      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)
      const id = crypto.randomUUID()
      await commitUnversioned(c.env.DB, [
        c.env.DB.prepare(
          'INSERT INTO staff (id, organization_id, store_id, admin_user_id, display_name, kana, job_label, role, max_parallel_reservations, pin_hash, pin_updated_at, is_active, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,?)',
        ).bind(
          id,
          org,
          storeId,
          input.adminUserId,
          input.displayName,
          input.kana,
          input.jobLabel,
          input.role,
          input.maxParallelReservations,
          flag(input.isActive),
          input.sortOrder,
          now,
          now,
        ),
        bumpVersion(c.env.DB, org, storeId, null, now, by),
      ])
      const member = await oneStaffMember(db, org, storeId, id)
      if (!member) return c.json({ error: 'not_found' }, 404)
      return c.json(StaffMember.parse(member))
    },
  )

  .patch(
    '/api/staff/stores/:storeId/staff/:staffId',
    requireStorePermission('settings.manage'),
    zValidator('json', StaffMemberPatch),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const staffId = c.req.param('staffId')
      const current = await findStaffMember(db, org, storeId, staffId)
      if (!current) return c.json({ error: 'not_found' }, 404)
      const patch = c.req.valid('json')
      const pick = <T>(value: T | undefined, fallback: T): T =>
        value === undefined ? fallback : value

      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)
      const write = settingsWriter(c.env.DB, versionGuard(org, storeId, patch.version))
      const saved = await commitSettings(c.env.DB, [
        write.at(
          `UPDATE staff SET display_name = ?, kana = ?, job_label = ?, role = ?, admin_user_id = ?, max_parallel_reservations = ?, is_active = ?, sort_order = ?, updated_at = ? WHERE organization_id = ? AND store_id = ? AND id = ? AND ${write.guard}`,
          [
            pick(patch.displayName, current.displayName),
            pick(patch.kana, current.kana),
            pick(patch.jobLabel, current.jobLabel),
            pick(patch.role, current.role),
            pick(patch.adminUserId, current.adminUserId),
            pick(patch.maxParallelReservations, current.maxParallelReservations),
            patch.isActive === undefined ? current.isActive : flag(patch.isActive),
            pick(patch.sortOrder, current.sortOrder),
            now,
            org,
            storeId,
            staffId,
          ],
        ),
        bumpVersion(c.env.DB, org, storeId, patch.version, now, by),
      ])
      if (!saved) return c.json({ error: 'version_conflict' }, 409)
      const member = await oneStaffMember(db, org, storeId, staffId)
      if (!member) return c.json({ error: 'not_found' }, 404)
      return c.json(StaffMember.parse(member))
    },
  )

  .put(
    '/api/staff/stores/:storeId/staff/:staffId/skills',
    requireStorePermission('settings.manage'),
    zValidator('json', StaffSkillsInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const staffId = c.req.param('staffId')
      if (!(await findStaffMember(db, org, storeId, staffId))) {
        return c.json({ error: 'not_found' }, 404)
      }
      const { skills } = c.req.valid('json')
      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)
      await commitUnversioned(c.env.DB, [
        c.env.DB.prepare(
          'DELETE FROM staff_skills WHERE organization_id = ? AND staff_id = ?',
        ).bind(org, staffId),
        ...skills.map((skill) =>
          c.env.DB.prepare(
            'INSERT INTO staff_skills (id, organization_id, store_id, staff_id, skill_code, created_at) VALUES (?,?,?,?,?,?)',
          ).bind(crypto.randomUUID(), org, storeId, staffId, skill, now),
        ),
        bumpVersion(c.env.DB, org, storeId, null, now, by),
      ])
      const member = await oneStaffMember(db, org, storeId, staffId)
      if (!member) return c.json({ error: 'not_found' }, 404)
      return c.json(StaffMember.parse(member))
    },
  )

  .get(
    '/api/staff/stores/:storeId/staff-shifts',
    zValidator('query', StaffShiftQuery),
    async (c) => {
      const db = drizzle(c.env.DB)
      const org = c.get('auth').org
      const storeId = c.req.param('storeId')
      if (!(await findStore(db, org, storeId))) return c.json({ error: 'not_found' }, 404)
      const { from, to, staffId } = c.req.valid('query')
      const rows = await db
        .select()
        .from(staffShifts)
        .where(
          and(
            eq(staffShifts.organizationId, org),
            eq(staffShifts.storeId, storeId),
            gte(staffShifts.date, from),
            lte(staffShifts.date, to),
            staffId === undefined ? undefined : eq(staffShifts.staffId, staffId),
          ),
        )
        .orderBy(asc(staffShifts.date), asc(staffShifts.startsAt))
      return c.json(
        StaffShift.array().parse(
          rows.map((row) => ({
            id: row.id,
            staffId: row.staffId,
            date: row.date,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            kind: row.kind,
          })),
        ),
      )
    },
  )

  .put(
    '/api/staff/stores/:storeId/staff-shifts',
    requireStorePermission('settings.manage'),
    zValidator('json', StaffShiftsInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const input = c.req.valid('json')
      if (!(await findStaffMember(db, org, storeId, input.staffId))) {
        return c.json({ error: 'not_found' }, 404)
      }

      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)
      const write = settingsWriter(c.env.DB, versionGuard(org, storeId, input.version))
      const until = addJstDays(input.effectiveFrom, SHIFT_WINDOW_DAYS - 1)
      const expandOne = `INSERT INTO staff_shifts (id, organization_id, store_id, staff_id, date, starts_at, ends_at, kind, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${write.guard}`

      // 曜日テンプレートが正本。日付の行はその展開結果なので、窓ぶんまとめて作り直す。
      const expansions: Statement[] = []
      for (let index = 0; index < SHIFT_WINDOW_DAYS; index += 1) {
        const date = addJstDays(input.effectiveFrom, index)
        const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
        const row = input.weekly.find((candidate) => candidate.weekday === weekday)
        if (!row || row.isOff || row.startsAt === null || row.endsAt === null) continue
        expansions.push(
          write.at(expandOne, [
            crypto.randomUUID(),
            org,
            storeId,
            input.staffId,
            date,
            row.startsAt,
            row.endsAt,
            'work',
            now,
          ]),
        )
        for (const rest of row.breaks) {
          expansions.push(
            write.at(expandOne, [
              crypto.randomUUID(),
              org,
              storeId,
              input.staffId,
              date,
              rest.startsAt,
              rest.endsAt,
              'break',
              now,
            ]),
          )
        }
      }

      const saved = await commitSettings(c.env.DB, [
        write.at(
          `DELETE FROM staff_weekly_shifts WHERE organization_id = ? AND staff_id = ? AND ${write.guard}`,
          [org, input.staffId],
        ),
        ...input.weekly.map((row) =>
          write.at(
            `INSERT INTO staff_weekly_shifts (id, organization_id, store_id, staff_id, weekday, is_off, starts_at, ends_at, break_start, break_end, effective_from, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${write.guard}`,
            [
              crypto.randomUUID(),
              org,
              storeId,
              input.staffId,
              row.weekday,
              flag(row.isOff),
              row.startsAt,
              row.endsAt,
              row.breaks[0]?.startsAt ?? null,
              row.breaks[0]?.endsAt ?? null,
              input.effectiveFrom,
              now,
            ],
          ),
        ),
        write.at(
          `DELETE FROM staff_shifts WHERE organization_id = ? AND staff_id = ? AND date >= ? AND date <= ? AND ${write.guard}`,
          [org, input.staffId, input.effectiveFrom, until],
        ),
        ...expansions,
        bumpVersion(c.env.DB, org, storeId, input.version, now, by),
      ])
      if (!saved) return c.json({ error: 'version_conflict' }, 409)

      const rows = await db
        .select()
        .from(staffShifts)
        .where(
          and(
            eq(staffShifts.organizationId, org),
            eq(staffShifts.storeId, storeId),
            eq(staffShifts.staffId, input.staffId),
            gte(staffShifts.date, input.effectiveFrom),
            lte(staffShifts.date, until),
          ),
        )
        .orderBy(asc(staffShifts.date), asc(staffShifts.startsAt))
      return c.json(
        StaffShift.array().parse(
          rows.map((row) => ({
            id: row.id,
            staffId: row.staffId,
            date: row.date,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            kind: row.kind,
          })),
        ),
      )
    },
  )

  /* --- SETTINGS-EQUIPMENT（設備と点検） ---------------------------------- */

  .get('/api/staff/stores/:storeId/equipment', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const storeId = c.req.param('storeId')
    if (!(await findStore(db, org, storeId))) return c.json({ error: 'not_found' }, 404)
    const query = validQuery(c, EquipmentListQuery, c.req.query())
    const rows = await db
      .select()
      .from(equipment)
      .where(
        and(
          eq(equipment.organizationId, org),
          eq(equipment.storeId, storeId),
          query.kind === undefined ? undefined : eq(equipment.kind, query.kind),
        ),
      )
      .orderBy(asc(equipment.sortOrder), asc(equipment.createdAt))
    const listed = query.includeInactive ? rows : rows.filter((row) => isOn(row.isActive))
    return c.json(Equipment.array().parse(listed.map(toEquipment)))
  })

  .post(
    '/api/staff/stores/:storeId/equipment',
    requireStorePermission('settings.manage'),
    zValidator('json', EquipmentInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const input = c.req.valid('json')
      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)
      const id = crypto.randomUUID()
      await commitUnversioned(c.env.DB, [
        c.env.DB.prepare(
          'INSERT INTO equipment (id, organization_id, store_id, name, kind, role_label, capacity, is_active, inactive_reason, ledger_display, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          id,
          org,
          storeId,
          input.name,
          input.kind,
          input.roleLabel,
          input.capacity,
          flag(input.isActive),
          input.inactiveReason,
          input.ledgerDisplay,
          input.sortOrder,
          now,
          now,
        ),
        bumpVersion(c.env.DB, org, storeId, null, now, by),
      ])
      const row = await findEquipment(db, org, storeId, id)
      if (!row) return c.json({ error: 'not_found' }, 404)
      return c.json(Equipment.parse(toEquipment(row)))
    },
  )

  .patch(
    '/api/staff/stores/:storeId/equipment/:equipmentId',
    requireStorePermission('settings.manage'),
    zValidator('json', EquipmentPatch),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const equipmentId = c.req.param('equipmentId')
      const current = await findEquipment(db, org, storeId, equipmentId)
      if (!current) return c.json({ error: 'not_found' }, 404)
      const patch = c.req.valid('json')
      const pick = <T>(value: T | undefined, fallback: T): T =>
        value === undefined ? fallback : value

      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)
      const write = settingsWriter(c.env.DB, versionGuard(org, storeId, patch.version))
      const saved = await commitSettings(c.env.DB, [
        write.at(
          `UPDATE equipment SET name = ?, kind = ?, role_label = ?, capacity = ?, is_active = ?, inactive_reason = ?, ledger_display = ?, sort_order = ?, updated_at = ? WHERE organization_id = ? AND store_id = ? AND id = ? AND ${write.guard}`,
          [
            pick(patch.name, current.name),
            pick(patch.kind, current.kind),
            pick(patch.roleLabel, current.roleLabel),
            pick(patch.capacity, current.capacity),
            patch.isActive === undefined ? current.isActive : flag(patch.isActive),
            pick(patch.inactiveReason, current.inactiveReason),
            pick(patch.ledgerDisplay, current.ledgerDisplay),
            pick(patch.sortOrder, current.sortOrder),
            now,
            org,
            storeId,
            equipmentId,
          ],
        ),
        bumpVersion(c.env.DB, org, storeId, patch.version, now, by),
      ])
      if (!saved) return c.json({ error: 'version_conflict' }, 409)
      const after = await findEquipment(db, org, storeId, equipmentId)
      if (!after) return c.json({ error: 'not_found' }, 404)
      return c.json(Equipment.parse(toEquipment(after)))
    },
  )

  .get(
    '/api/staff/stores/:storeId/equipment/:equipmentId/maintenance',
    zValidator('query', MaintenanceQuery),
    async (c) => {
      const db = drizzle(c.env.DB)
      const org = c.get('auth').org
      const storeId = c.req.param('storeId')
      const equipmentId = c.req.param('equipmentId')
      if (!(await findEquipment(db, org, storeId, equipmentId))) {
        return c.json({ error: 'not_found' }, 404)
      }
      const { from, to } = c.req.valid('query')
      const rows = await db
        .select()
        .from(equipmentMaintenance)
        .where(
          and(
            eq(equipmentMaintenance.organizationId, org),
            eq(equipmentMaintenance.equipmentId, equipmentId),
            // 期間は JST の暦日の半開区間 `[from 0:00, to+1 0:00)`。
            // 右端を含めると `to` の翌日 0:00 ちょうどに始まる点検まで数えてしまう。
            gte(equipmentMaintenance.startsAt, toInstant(from, 0)),
            lt(equipmentMaintenance.startsAt, toInstant(addJstDays(to, 1), 0)),
          ),
        )
        .orderBy(asc(equipmentMaintenance.startsAt))
      return c.json(
        EquipmentMaintenance.array().parse(
          rows.map((row) => ({
            id: row.id,
            equipmentId: row.equipmentId,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            note: row.note,
          })),
        ),
      )
    },
  )

  .post(
    '/api/staff/stores/:storeId/equipment/:equipmentId/maintenance',
    requireStorePermission('settings.manage'),
    zValidator('json', EquipmentMaintenanceInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const equipmentId = c.req.param('equipmentId')
      if (!(await findEquipment(db, org, storeId, equipmentId))) {
        return c.json({ error: 'not_found' }, 404)
      }
      const input = c.req.valid('json')
      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)
      const id = crypto.randomUUID()
      await commitUnversioned(c.env.DB, [
        c.env.DB.prepare(
          'INSERT INTO equipment_maintenance (id, organization_id, store_id, equipment_id, starts_at, ends_at, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)',
        ).bind(id, org, storeId, equipmentId, input.startsAt, input.endsAt, input.note, now, by),
        bumpVersion(c.env.DB, org, storeId, null, now, by),
      ])
      return c.json(
        EquipmentMaintenance.parse({
          id,
          equipmentId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          note: input.note,
        }),
      )
    },
  )

  .delete(
    '/api/staff/stores/:storeId/equipment/:equipmentId/maintenance/:maintenanceId',
    requireStorePermission('settings.manage'),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const equipmentId = c.req.param('equipmentId')
      const maintenanceId = c.req.param('maintenanceId')
      // パスが指す設備の点検だけを消す。別の設備の点検 id を渡されたら「無い」として扱う
      // （設備 A の画面から設備 B の点検が消えると、消した人にも消えた理由が分からない）。
      const rows = await db
        .select({ id: equipmentMaintenance.id })
        .from(equipmentMaintenance)
        .where(
          and(
            eq(equipmentMaintenance.organizationId, org),
            eq(equipmentMaintenance.storeId, storeId),
            eq(equipmentMaintenance.equipmentId, equipmentId),
            eq(equipmentMaintenance.id, maintenanceId),
          ),
        )
      if (rows.length === 0) return c.json({ error: 'not_found' }, 404)

      const now = new Date().toISOString()
      await ensureVersion(db, org, storeId, now)
      const by = await actorStaffId(db, org, storeId, sub)
      await commitUnversioned(c.env.DB, [
        c.env.DB.prepare(
          'DELETE FROM equipment_maintenance WHERE organization_id = ? AND store_id = ? AND equipment_id = ? AND id = ?',
        ).bind(org, storeId, equipmentId, maintenanceId),
        bumpVersion(c.env.DB, org, storeId, null, now, by),
      ])
      return c.json(DeletedResult.parse({ id: maintenanceId, deleted: true }))
    },
  )

  /* --- SETTINGS-PURPOSE（ご来店の目的） ---------------------------------- */

  .get('/api/staff/purposes', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const query = validQuery(c, PurposeListQuery, c.req.query())
    return c.json(VisitPurpose.array().parse(await readPurposes(db, org, query)))
  })

  .post(
    '/api/staff/purposes',
    requireStorePermission('settings.manage'),
    zValidator('json', VisitPurposeInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const org = c.get('auth').org
      const input = c.req.valid('json')
      // 店舗を指定した目的は、その店舗が自分の組織のものであることを確かめてから作る。
      if (input.storeId !== null && !(await findStore(db, org, input.storeId))) {
        return c.json({ error: 'not_found' }, 404)
      }
      const now = new Date().toISOString()
      const id = crypto.randomUUID()
      await db.insert(visitPurposes).values({
        id,
        organizationId: org,
        storeId: input.storeId,
        nameInternal: input.nameInternal,
        namePublic: input.namePublic,
        nameShort: input.nameShort,
        durationMinutes: input.durationMinutes,
        isWebPublished: flag(input.isWebPublished),
        isActive: flag(input.isActive),
        sortOrder: input.sortOrder,
        version: FIRST_VERSION,
        createdAt: now,
        updatedAt: now,
      })
      const created = await onePurpose(db, org, id)
      if (!created) return c.json({ error: 'not_found' }, 404)
      return c.json(VisitPurpose.parse(created))
    },
  )

  // 並べ替えは `:purposeId` より先に置く（`order` を id と読ませない）。
  .put(
    '/api/staff/purposes/order',
    requireStorePermission('settings.manage'),
    zValidator('json', PurposeOrderInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const org = c.get('auth').org
      const { purposeIds } = c.req.valid('json')
      const known = await db
        .select({ id: visitPurposes.id })
        .from(visitPurposes)
        .where(and(eq(visitPurposes.organizationId, org), inArray(visitPurposes.id, purposeIds)))
      // 1 つでも自分の組織の外を指していたら、並びを 1 行も動かさない。
      if (known.length !== purposeIds.length) return c.json({ error: 'not_found' }, 404)

      const now = new Date().toISOString()
      const [head, ...tail] = purposeIds.map((id, index) =>
        c.env.DB.prepare(
          'UPDATE visit_purposes SET sort_order = ?, updated_at = ? WHERE organization_id = ? AND id = ?',
        ).bind(index, now, org, id),
      )
      if (head !== undefined) await c.env.DB.batch([head, ...tail])
      return c.json(
        VisitPurpose.array().parse(
          await readPurposes(db, org, { includeInactive: true, webPublishedOnly: false }),
        ),
      )
    },
  )

  .patch(
    '/api/staff/purposes/:purposeId',
    requireStorePermission('settings.manage'),
    zValidator('json', VisitPurposePatch),
    async (c) => {
      const db = drizzle(c.env.DB)
      const org = c.get('auth').org
      const purposeId = c.req.param('purposeId')
      const current = await findPurpose(db, org, purposeId)
      if (!current) return c.json({ error: 'not_found' }, 404)
      const patch = c.req.valid('json')
      const pick = <T>(value: T | undefined, fallback: T): T =>
        value === undefined ? fallback : value

      // 目的はチェーン共通の行を持てるので、店舗の版ではなく行そのものの版で衝突を見る。
      const now = new Date().toISOString()
      const result = await c.env.DB.prepare(
        'UPDATE visit_purposes SET name_internal = ?, name_public = ?, name_short = ?, duration_minutes = ?, is_web_published = ?, is_active = ?, sort_order = ?, version = version + 1, updated_at = ? WHERE organization_id = ? AND id = ? AND version = ?',
      )
        .bind(
          pick(patch.nameInternal, current.nameInternal),
          pick(patch.namePublic, current.namePublic),
          pick(patch.nameShort, current.nameShort),
          pick(patch.durationMinutes, current.durationMinutes),
          patch.isWebPublished === undefined ? current.isWebPublished : flag(patch.isWebPublished),
          patch.isActive === undefined ? current.isActive : flag(patch.isActive),
          pick(patch.sortOrder, current.sortOrder),
          now,
          org,
          purposeId,
          patch.version,
        )
        .run()
      if (result.meta.changes === 0) return c.json({ error: 'version_conflict' }, 409)
      const after = await onePurpose(db, org, purposeId)
      if (!after) return c.json({ error: 'not_found' }, 404)
      return c.json(VisitPurpose.parse(after))
    },
  )

  .put(
    '/api/staff/purposes/:purposeId/requirements',
    requireStorePermission('settings.manage'),
    zValidator('json', PurposeRequirementsInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const org = c.get('auth').org
      const purposeId = c.req.param('purposeId')
      if (!(await findPurpose(db, org, purposeId))) return c.json({ error: 'not_found' }, 404)
      const { requirements } = c.req.valid('json')
      const now = new Date().toISOString()
      await c.env.DB.batch([
        c.env.DB.prepare(
          'DELETE FROM purpose_requirements WHERE organization_id = ? AND purpose_id = ?',
        ).bind(org, purposeId),
        ...requirements.map((requirement) =>
          c.env.DB.prepare(
            'INSERT INTO purpose_requirements (id, organization_id, purpose_id, kind, value, created_at) VALUES (?,?,?,?,?,?)',
          ).bind(crypto.randomUUID(), org, purposeId, requirement.kind, requirement.value, now),
        ),
        c.env.DB.prepare(
          'UPDATE visit_purposes SET version = version + 1, updated_at = ? WHERE organization_id = ? AND id = ?',
        ).bind(now, org, purposeId),
      ])
      const after = await onePurpose(db, org, purposeId)
      if (!after) return c.json({ error: 'not_found' }, 404)
      return c.json(VisitPurpose.parse(after))
    },
  )

  /* --- 保存の前に見せる影響（3 面が同じ器を使う。**何も保存しない**） ------ */

  .post('/api/staff/settings/impact', zValidator('json', SettingsImpactRequest), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const request = c.req.valid('json')
    if (!(await findStore(db, org, request.storeId))) return c.json({ error: 'not_found' }, 404)
    const now = new Date().toISOString()

    if (request.kind === 'equipment_stop') {
      const { equipmentId, startsAt, endsAt } = request.draft
      const affectedReservations = impactOfEquipmentStop({
        reservations: await readAffectedReservations(db, {
          organizationId: org,
          storeId: request.storeId,
          from: new Date(Date.parse(startsAt) - LOOKBACK_MS).toISOString(),
          to: endsAt,
        }),
        equipmentId,
        startsAt,
        endsAt,
        now,
      })
      return c.json(
        toReport({ affectedReservations, affectedWebSlots: [], lastAcceptableAt: null }),
      )
    }

    if (request.kind === 'purpose_duration') {
      const { purposeId, durationMinutes, from, to } = request.draft
      const purpose = await findPurpose(db, org, purposeId)
      if (!purpose) return c.json({ error: 'not_found' }, 404)
      const slots = await candidateWebSlots(db, org, request.storeId, purposeId, from, to)
      const affectedWebSlots = impactOfPurposeDuration({
        // いま出している枠だけを数える（もともと出せていない枠は「落ちる」とは言わない）。
        webSlots: slots.filter((slot) => slot.availableMinutes >= purpose.durationMinutes),
        purposeId,
        from,
        to,
        currentDurationMinutes: purpose.durationMinutes,
        durationMinutes,
      })
      return c.json(
        toReport({ affectedReservations: [], affectedWebSlots, lastAcceptableAt: null }),
      )
    }

    const draft = request.draft
    const today = businessDateOf(now)
    const exceptions = await db
      .select()
      .from(storeCalendarExceptions)
      .where(
        and(
          eq(storeCalendarExceptions.organizationId, org),
          eq(storeCalendarExceptions.storeId, request.storeId),
          gte(storeCalendarExceptions.date, today),
          lte(storeCalendarExceptions.date, addJstDays(today, IMPACT_DAYS)),
        ),
      )
    const days = Array.from({ length: IMPACT_DAYS }, (_, index) => {
      const date = addJstDays(today, index)
      const day = resolveBusinessDay({
        date,
        weeklyRows: draft.rows,
        exceptions: exceptions.map((row) => ({
          date: row.date,
          kind: row.kind === 'special' ? ('special' as const) : ('closed' as const),
          opensAt: row.opensAt,
          closesAt: row.closesAt,
        })),
        blackouts: draft.blackouts,
      })
      return { date, windows: day.windows, closesAt: day.closesAt }
    })
    const affectedReservations = impactOfBusinessHours({
      reservations: await readAffectedReservations(db, {
        organizationId: org,
        storeId: request.storeId,
        from: now,
        to: toInstant(addJstDays(today, IMPACT_DAYS), 0),
      }),
      days,
      now,
    })
    const rules = await readSlotRulesRow(db, org, request.storeId)
    const head = days[0]
    return c.json(
      toReport({
        affectedReservations,
        affectedWebSlots: [],
        // SETTINGS-HOURS の「木曜日に最後にお受けできるのは 18:20 です。」は今日の曜日で出す。
        lastAcceptableAt:
          head === undefined || rules === null
            ? null
            : lastAcceptableStart({
                windows: head.windows,
                shortestDurationMinutes: await shortestPurposeMinutes(
                  db,
                  org,
                  request.storeId,
                  rules.slotMinutes,
                ),
                cleanupMinutes: rules.cleanupMinutes,
                closesAt: head.closesAt,
              }),
      }),
    )
  })

  /* --- 予約台帳と空き枠（P2。読むだけで、1 件も書かない） ----------------- */

  /**
   * 置ける時刻。8 条件をすべて掛けた結果を返す。
   *
   * **定休日と受けられないご用件は 200 の本文で `slots: []` を返す**（409 にしない）。
   * 409 は「置けないと分かっている枠へ確定しようとしたとき」のために取っておく。
   * 日時を選んでいる最中に 409 を返すと、画面は枠を 1 つも描けないまま
   * 「エラー」だけを出すことになり、次にどの日を見ればよいかが伝わらない。
   */
  .get('/api/staff/availability', zValidator('query', AvailabilityQuery), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const query = c.req.valid('query')
    // 全クエリを JWT の `org` で絞る。他テナントの店舗 id は「無い」として 404。
    const store = await findStore(db, org, query.storeId)
    if (!store) return c.json({ error: 'not_found' }, 404)
    // 店舗まるごとの受付を止めた日は、定休日と同じく枠を 1 つも返さない（AC-LEDGER-22）。
    const isSuspended = store.isActive !== '1'

    // 現在時刻はハンドラの入口で 1 回だけ作り、以降は引数で配る。
    // **ドメイン層は `Date.now()` を 1 度も呼ばない。**
    const now = new Date()
    const rows = await readAvailabilityDay(db, {
      organizationId: org,
      storeId: query.storeId,
      date: query.date,
      purposeIds: query.purposeIds,
    })
    // 予約の間隔がまだ決まっていない店舗は 404。暗黙の既定値（刻み 30 分）を作らない。
    if (rows.slotRules === null) return c.json({ error: 'not_found' }, 404)
    const rules = rows.slotRules

    if (rows.missingPurposes > 0) {
      // 受けられないご用件（無い id・止めた目的・他店舗のもの）が 1 つでも混ざったら
      // 枠を出さない。既定の所要時間へ落として枠を出すと、受けられないご用件で
      // ご予約が取れてしまう。
      const day = resolveBusinessDay({
        date: query.date,
        weeklyRows: rows.hours,
        exceptions: rows.exceptions,
        isSuspended,
      })
      return c.json(
        AvailabilityResponse.parse({
          date: query.date,
          opensAt: day.opensAt,
          closesAt: day.closesAt,
          isClosed: day.isClosed,
          slotMinutes: rules.slotMinutes,
          cleanupMinutes: rules.cleanupMinutes,
          durationMinutes: query.durationMinutes ?? rules.slotMinutes,
          slots: [],
          lanes: [],
          alternatives: [],
          // 枠が 0 件の理由を本文で必ず伝える。理由を落とすと、画面は
          // 「定休日」も「お受けできないご用件」も同じ空の一覧として描くことになる。
          reason: 'purpose_unavailable',
          serverNow: now.toISOString(),
        }),
      )
    }

    const answer = computeAvailability({
      date: query.date,
      now,
      slotRules: rules,
      weeklyHours: rows.hours,
      exceptions: rows.exceptions,
      blackouts: rows.blackouts,
      isSuspended,
      purposes: rows.purposes,
      durationMinutes: query.durationMinutes,
      staff: rows.staff,
      shifts: rows.shifts,
      equipment: rows.equipment,
      maintenances: rows.maintenances,
      occupied: rows.occupied,
      // 仮の押さえ（KV）を塞がりに数える。`KV.list` は**空き枠 1 回につき 1 回だけ**で、
      // 自分の受付が置いた押さえは `excludeReceptionSessionId` が落とす
      // （落とさないと、11:00 に置いてから 11:30 へ動かしたとき 11:00 が 7 分間
      // だれにも取れなくなる）。**公開面（`/api/public/**`）ではここを読まない。**
      holds: await listHoldOccupancies(c.env.SHORT_LIVED, org, query.storeId, now),
      axis: query.axis,
      staffId: query.staffId ?? null,
      // 空の配列は「設備を絞らない」であって「どの設備も使えない」ではない。
      // そのまま渡すと 1 台も残らず、設備軸のレーンが 0 行になる。
      equipmentIds: query.equipmentIds.length > 0 ? query.equipmentIds : undefined,
      excludeReservationId: query.excludeReservationId ?? null,
      excludeReceptionSessionId: query.excludeReceptionSessionId ?? null,
    })
    return c.json(
      AvailabilityResponse.parse({
        date: answer.date,
        opensAt: answer.opensAt,
        closesAt: answer.closesAt,
        isClosed: answer.isClosed,
        slotMinutes: rules.slotMinutes,
        cleanupMinutes: rules.cleanupMinutes,
        durationMinutes: answer.durationMinutes,
        slots: answer.slots,
        lanes: answer.lanes,
        alternatives: answer.alternatives,
        // その日ぜんぶが同じ理由で落ちているときだけ載る（定休日は `closed`）。
        reason: answer.reason,
        serverNow: answer.serverNow,
      }),
    )
  })

  /**
   * 台帳 1 日分。`axis`（担当者／設備・場所）と `view`（タイムテーブル／予約リスト）は
   * **別の指定**で、4 通りすべてが有効な組み合わせである。1 日分は
   * `readLedgerDay` の **1 回の `db.batch()`** で読む（`04-api.md` §3.6。16 文以内）。
   *
   * 応答の `serverNow` は現在時刻の線と札の出どころなので必ず載せる
   * （端末の時計がずれた日に台帳が黙って嘘をつかないよう、iPad の時計は読ませない）。
   */
  .get('/api/staff/ledger', zValidator('query', LedgerQuery), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    // `filter`（すべて／これから／確認待ち）は応答の `counts` が 3 つとも載るので、
    // ここでは行を落とさない。落とすと札の数字と行数が食い違う。
    const { storeId, date, axis, view } = c.req.valid('query')
    const store = await findStore(db, org, storeId)
    if (!store) return c.json({ error: 'not_found' }, 404)

    const serverNow = new Date()
    const rows = await readLedgerDay(db, { organizationId: org, storeId, date })
    // 刻みが決まっていない店舗は台帳の格子を描けない。空き枠と同じく 404 にする。
    if (rows.slotRules === null) return c.json({ error: 'not_found' }, 404)
    // 定休日・臨時休業・**店舗まるごとの受付停止**は `opensAt` / `closesAt` が null に
    // なり、行を 1 本も返さない。3 つとも同じ型で描く（AC-LEDGER-22）。
    const day = resolveBusinessDay({
      date,
      weeklyRows: rows.hours,
      exceptions: rows.exceptions,
      isSuspended: store.isActive !== '1',
    })

    // 受付パネル（LEDGER-WALKIN）が props で受ける 3 欄。**画面のために API を増やさない。**
    // 人数と次の番号は同じ 1 文で数える（台帳 1 画面の D1 の文を 1 本しか増やさない）。
    const walkins = await readWalkinCounters(c.env.DB, org, storeId, date)
    const board = buildLedgerView({
      date,
      // 最下段の「ご来店お待ち」の行の副題（`${waitingCount}名`）と、受付パネルが props で
      // 受ける件数は**同じ 1 つの数**である。片方だけ渡すと帯が 0名 のまま固まる。
      waitingCount: walkins.waiting,
      walkinWaitingCount: walkins.waiting,
      /*
       * 「目安 15分」は**空き枠エンジンが返す「選んだご用件を受けられる担当が次に
       * 空く時刻 − 現在時刻」からしか出さない**。台帳を開いた時点ではご用件が
       * 決まっていないので、ここでは出せない（null）。待ち人数の掛け算で作った数字は
       * お客様に口で伝える約束になるので、担当の空きを見ない値をこの欄に載せない。
       */
      estimatedWaitMinutes: null,
      // 999 番まで出し切った日は、予告だけ 999 に据え置く（受け付けは 409 で断る）。
      nextTicketNo: nextTicketNo(walkins.maxTicketNo) ?? 999,
      axis,
      view,
      storeId,
      opensAt: day.opensAt,
      closesAt: day.closesAt,
      slotMinutes: rows.slotRules.slotMinutes,
      reservations: rows.reservations,
      purposes: rows.purposes,
      assignments: rows.assignments,
      staff: rows.staff,
      shifts: rows.shifts,
      equipment: rows.equipment,
      maintenance: rows.maintenance,
      // 「ご来店お待ち」の人数は `walk_ins` を作る `008-reception-and-walkin` から。
      // それまでは 0名 の器として出す（行そのものは最下段に常設する）。
      serverNow,
    })
    // 帯のお名前と来店回数（AC-CUST-24 / AC-CUST-25）。P2 は `customer_id` が常に
    // NULL だったので 2 欄を null のまま置いてあり、顧客台帳ができたここで埋める。
    // お客様の付いていないご予約は null のままにする（「決めてください」と同じ扱い）。
    const bands = await customerBands(
      c.env.DB,
      org,
      rows.reservations.map((row) => row.id),
    )
    return c.json(
      LedgerView.parse({
        ...board,
        lanes: board.lanes.map((lane) => ({
          ...lane,
          entries: lane.entries.map((entry) => ({
            ...entry,
            ...(bands.get(entry.reservationId) ?? {}),
          })),
        })),
      }),
    )
  })

  /**
   * ご予約 1 件（LEDGER-DETAIL）。他テナントの id は 404 にして、
   * 403 で存在を漏らさない。
   */
  .get('/api/staff/reservations/:reservationId', async (c) => {
    const org = c.get('auth').org
    const detail = await reservationDetailOf(c.env, org, c.req.param('reservationId'))
    if (detail === null) return c.json({ error: 'not_found' }, 404)
    return c.json(detail)
  })

  /* --- 予約を探す・直す（P6） --------------------------------------------- */

  /**
   * ご予約を探す（CHANGE-SEARCH「結果 4件」／EX-EMPTY-SEARCH）。
   *
   * **選択中店舗に固定する**（Q-04 のいまの前提）。店舗を選ぶ前の問い合わせは組織まるごとの
   * 走査になるうえ、他店舗のご予約を誤って触る道を開ける。断って画面に店舗を選ばせる。
   *
   * 条件を 1 つ緩めた候補は **0 件のときだけ**添える。1 件以上あるのに候補が並ぶと、
   * いま見えている一覧が信用できなくなる（`ReservationList` の refine が同じことを言う）。
   */
  .get('/api/staff/reservations', zValidator('query', ReservationSearchQuery), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const query = c.req.valid('query')
    const storeId = query.storeId
    if (storeId === undefined) {
      return c.json(rejected(['店舗を選んでからお探しください。']), 400)
    }
    // 全クエリを JWT の `org` で絞る。他テナントの店舗 id は「無い」として 404。
    const store = await findStore(db, org, storeId)
    if (!store) return c.json({ error: 'not_found' }, 404)

    const resolved = resolveSearch(reservationSearchInput(org, storeId, query))
    const where = whereOf(resolved.where)
    const found = await c.env.DB.prepare(
      'SELECT r.id AS id, r.code AS code, r.starts_at AS startsAt, ' +
        'r.duration_minutes AS durationMinutes, r.status AS status, r.source AS source, ' +
        `c.name AS customerName, c.visit_count AS visitCount ${RESERVATION_SEARCH_FROM} ` +
        `WHERE ${where} ORDER BY ${resolved.orderBy} LIMIT ?`,
    )
      .bind(...resolved.params, query.limit)
      .all<{
        id: string
        code: string
        startsAt: string
        durationMinutes: number
        status: string
        source: string
        customerName: string | null
        visitCount: number | null
      }>()

    const ids = found.results.map((row) => row.id)
    const [labels, staffNames] = await Promise.all([
      purposeLabelsOf(c.env.DB, org, ids),
      staffNamesOf(c.env.DB, org, ids),
    ])
    const total = await countReservations(c.env.DB, org, storeId, query)
    return c.json(
      ReservationList.parse({
        items: found.results.map((row) => ({
          id: row.id,
          code: row.code,
          startsAt: row.startsAt,
          durationMinutes: row.durationMinutes,
          status: row.status,
          source: row.source,
          customerName: row.customerName,
          visitCount: row.visitCount,
          purposeLabel: labels.get(row.id) ?? '',
          staffName: staffNames.get(row.id) ?? null,
        })),
        // 読み足しはまだ持たない（`limit` の既定 50 で 1 画面に収まる面である）。
        nextCursor: null,
        total,
        relaxations: total === 0 ? await relaxationsWithCounts(c.env.DB, org, storeId, query) : [],
      }),
    )
  })

  /**
   * ご予約を変更する（CHANGE-DIFF「変更を確定する」）。
   *
   * **変更先の枠を確保してから元の予約を切り替える。**バッチの 1 文目が新しい占有行の
   * 条件付き INSERT で、古い枠の DELETE はそのあと・版を +1 する UPDATE はいちばん最後
   * である（`domain/reservation-change.ts`）。元を先に空ける形だと、空けた瞬間に別の端末へ
   * 枠を取られたときに戻せない。
   *
   * 断るのは 2 通り。**枠が取れなかった**（1 文目が 0 行）＝ 409 `slot_taken`、
   * **版が合わなかった**（最後の文が 0 行）＝ 409 `version_conflict` で、どちらの場合も
   * 版のガードが全文に配ってあるので **D1 には 1 行も書かれていない**（AC-CHANGE-27）。
   *
   * `Idempotency-Key` は受け取らない。二重適用を止めるのは `version` の楽観ロックだけで、
   * 冪等キーを重ねると「版が合わないので 409」と「同じ鍵なので 200 を焼き直す」が
   * 同じ要求に同時に当たる（`04-api.md` §6.1）。
   */
  .patch(
    '/api/staff/reservations/:reservationId',
    zValidator('json', ReservationChangeInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const reservationId = c.req.param('reservationId')
      const input = c.req.valid('json')

      const found = await readReservationDetail(db, { organizationId: org, reservationId })
      if (found === null) return c.json({ error: 'not_found' }, 404)
      const { reservation, purposes: purposesBefore, assignments } = found
      // 取り消した・ご来店がなかった・終わったご予約は直せない。枠はもう返してあるので、
      // 版だけ進めると台帳と空き枠の見え方が食い違う。
      if (!CHANGEABLE_STATUS.has(reservation.status)) {
        return c.json({ error: 'invalid_transition' }, 409)
      }
      const store = await findStore(db, org, reservation.storeId)
      if (!store) return c.json({ error: 'not_found' }, 404)

      // 欄が無い＝そのまま。いまの姿を土台に、送られてきた欄だけを置き換える。
      const staffBefore = assignments.find((band) => band.kind === 'staff')?.targetId ?? null
      const equipmentBefore = assignments.flatMap((band) =>
        band.kind === 'equipment' && band.targetId !== null ? [band.targetId] : [],
      )
      const purposeIdsBefore = purposesBefore.map((line) => line.purposeId)
      const startsAt = input.startsAt ?? reservation.startsAt
      const staffId = input.staffId === undefined ? staffBefore : input.staffId
      const equipmentIds = input.equipmentIds ?? equipmentBefore
      const purposeIds = input.purposeIds ?? purposeIdsBefore

      const now = new Date()
      const date = toJstDateString(startsAt)
      const rows = await readAvailabilityDay(db, {
        organizationId: org,
        storeId: reservation.storeId,
        date,
        purposeIds,
      })
      const slotRules = rows.slotRules
      if (slotRules === null) return c.json({ error: 'not_found' }, 404)
      // 受けられないご用件（無い id・止めた目的・他店舗のもの）が混ざったら直さない。
      if (rows.missingPurposes > 0) return c.json({ error: 'purpose_unavailable' }, 409)

      /*
       * ご用件の所要は**予約した時点の写し**である（`03-data-model.md` §7.2）。
       * ご用件を入れ替えないときに `visit_purposes` を読み直すと、設定でご用件の所要を
       * 直したあとに日時だけを動かしただけで、そのご予約の凍結した所要が黙って
       * いまの値へ書き換わる（差分表は「ご用件は変わりません」と言ったままである）。
       * だから**入れ替えたときだけ**台帳を読み、そうでなければ今の行をそのまま積み直す。
       */
      const lines =
        input.purposeIds === undefined
          ? purposesBefore.map((line) => ({
              id: line.purposeId,
              durationMinutes: line.durationMinutes,
            }))
          : await readPurposeLines(db, org, purposeIds)
      // ご用件を入れ替えたときだけ所要を数え直す（日時だけの変更で所要が動かない）。
      const durationMinutes =
        input.durationMinutes ??
        (input.purposeIds === undefined
          ? reservation.durationMinutes
          : lines.reduce((total, line) => total + line.durationMinutes, 0))
      const endsAt = new Date(Date.parse(startsAt) + durationMinutes * MS_PER_MINUTE).toISOString()

      // 担当・設備は自分の組織・自分の店舗のものだけ。他テナントの id は「無い」として 404。
      const staffMember =
        staffId === null ? null : (rows.staff.find((m) => m.id === staffId) ?? null)
      if (staffId !== null && staffMember === null) return c.json({ error: 'not_found' }, 404)
      const units: { id: string; capacity: number }[] = []
      for (const equipmentId of equipmentIds) {
        const unit = rows.equipment.find((candidate) => candidate.id === equipmentId)
        if (unit === undefined) return c.json({ error: 'not_found' }, 404)
        units.push({ id: unit.id, capacity: unit.capacity })
      }

      const holds = await listHoldOccupancies(c.env.SHORT_LIVED, org, reservation.storeId, now)
      const boardOf = (source: AvailabilityDayRows) =>
        bookingBoard({
          date,
          now,
          rows: source,
          isSuspended: store.isActive !== '1',
          durationMinutes,
          staffId,
          equipmentIds,
          receptionSessionId: null,
          holds,
          preferredStartsAt: startsAt,
          // いま入っているご予約自身が自分の変更を邪魔しない（AC-CHANGE-25）。
          excludeReservationId: reservationId,
        })
      // 断るのは動かない事実だけ（定休・営業時間の外・技能や設備がそもそも無い）。
      // 枠が埋まっているかどうかはバッチの 1 文目が決める。
      const verdict = evaluateSlot(boardOf(rows), startsAt)
      const blocked = verdict.reason === null ? undefined : BLOCKING_REASON[verdict.reason]
      if (blocked !== undefined) return c.json({ error: blocked }, 409)

      /*
       * 古い枠と新しい枠は `created_at` で見分ける（⑤ の `created_at <> ?`）。
       * **同じミリ秒に 2 度直すと見分けが付かない** — 相手の版で送り直した直後などに
       * `now` が前回のバッチと同じ値になると、① が新しい枠を積んだあとで枠のガードが
       * 「要求本数より多い」と読んで ②〜⑥ を丸ごと落とし、409 を返しながら占有行だけが
       * 増える。ご予約の `updated_at` は前回のバッチの時刻そのものなので、必ず 1 ミリ秒
       * 後ろへ置いて、どちらの枠がこのバッチのものかを 1 通りに決める。
       */
      const batchAt = new Date(
        Math.max(now.getTime(), Date.parse(reservation.updatedAt) + 1),
      ).toISOString()
      const actorId = await actorStaffId(db, org, reservation.storeId, sub)
      const statements = buildChangeBatch({
        db: c.env.DB,
        organizationId: org,
        storeId: reservation.storeId,
        reservationId,
        version: input.version,
        batchAt,
        requests: slotLockRequests({
          slotStarts: expandToSlotStarts({
            startsAt,
            endsAt,
            slotMinutes: slotRules.slotMinutes,
            cleanupMinutes: slotRules.cleanupMinutes,
          }),
          staff:
            staffMember === null
              ? null
              : {
                  id: staffMember.id,
                  maxParallelReservations: staffMember.maxParallelReservations,
                },
          equipment: units,
          maxParallel: slotRules.maxParallel,
        }),
        after: {
          startsAt,
          endsAt,
          durationMinutes,
          noteCustomer: input.noteCustomer ?? reservation.noteCustomer ?? '',
          noteInternal: input.noteInternal ?? reservation.noteInternal ?? '',
        },
        purposes: lines.map((line, index) => ({
          purposeId: line.id,
          durationMinutes: line.durationMinutes,
          sortOrder: index,
        })),
        assignments: [
          { kind: 'staff', targetId: staffMember?.id ?? null },
          ...units.map((unit) => ({ kind: 'equipment' as const, targetId: unit.id })),
        ],
        actorId,
        correlationId: crypto.randomUUID(),
        // 監査は追記専用。平文のお名前・お電話番号を入れない（`07-nfr.md` §6.6）。
        audit: {
          before: {
            startsAt: reservation.startsAt,
            endsAt: reservation.endsAt,
            durationMinutes: reservation.durationMinutes,
            staffId: staffBefore,
            equipmentIds: equipmentBefore,
            purposeIds: purposeIdsBefore,
          },
          after: {
            startsAt,
            endsAt,
            durationMinutes,
            staffId: staffMember?.id ?? null,
            equipmentIds: units.map((unit) => unit.id),
            purposeIds,
          },
        },
      })
      // 並びはドメインが決めてある。**アプリ側で並べ替えない。**
      const results = await c.env.DB.batch(statements as [Statement, ...Statement[]])
      const applied = (results[results.length - 1]?.meta.changes ?? 0) > 0
      if (!applied) {
        // 版か枠かを見分ける。何も書けていないので読み直して差し支えない。
        const current = await c.env.DB.prepare(
          'SELECT version FROM reservations WHERE organization_id = ? AND id = ?',
        )
          .bind(org, reservationId)
          .first<{ version: number }>()
        if ((current?.version ?? 0) !== input.version) {
          return c.json(
            {
              error: 'version_conflict' as const,
              current: await conflictingVersion(c.env, org, reservationId),
            },
            409,
          )
        }
        // 代わりの時刻は**取られたあとの盤面**から採る（読んだあとに相手が確定している）。
        const fresh = await readAvailabilityDay(db, {
          organizationId: org,
          storeId: reservation.storeId,
          date,
          purposeIds,
        })
        const answer = computeAvailability(boardOf(fresh))
        return c.json(
          {
            error: 'slot_taken' as const,
            alternatives: AvailabilitySlot.array().max(3).parse(answer.alternatives),
          },
          409,
        )
      }

      const detail = await reservationDetailOf(c.env, org, reservationId)
      if (detail === null) return c.json({ error: 'not_found' }, 404)
      return c.json(detail)
    },
  )

  /**
   * ご予約を取り消す／ご来店がなかったとして残す（AC-RECEP-16）。
   *
   * **`reason='no_show'` だけが `status='no_show'` になる。**それ以外の理由は
   * `cancelled` である。受付履歴の「結果」の 3 語（成立／取消／ご来店なし）が分かれるのは
   * この 1 か所だけで、画面から `status` を直に受けない — 受けると、来ていないお客様の
   * ご予約を「成立」に書き換えられる。
   *
   * 当日の締めは 2 台の iPad が同時に流すので版で守る。**版を +1 する `UPDATE` は
   * バッチの最後**で、枠の DELETE も監査も送られてきた版を見る（`buildCancelBatch`）。
   * 版が合わなければ最後の 1 文が 0 行になり、そのとき D1 には 1 行も書かれていない
   * （AC-CHANGE-27。ここを「1 文目で版を +1 して 2 文目以降はその次の版を見る」形にすると、
   * 古い版で送った端末の枠だけが解けて **409 が二重予約を作る**）。
   *
   * 取り消し済み・ご来店なし・終わったご予約は、版が合っていても断る。版だけでは
   * 「同じ版のまま理由を上書きする」2 度目の取消を止められない。
   *
   * 枠の占有はここで解く。**解かないと、お帰りになった方の 11:00 が翌朝まで埋まったまま**
   * になり、同時受付の上限がその日ぶん狭くなる。ウォークインの受付は `left` にして
   * 待ちの帯から外す（`walk_ins.status='waiting'` のまま残すと「いまお待ち N名」が
   * 減らず、盤面にも出続ける）。取り消した来店であることは `reservations.status` に
   * 残るので、受付履歴からは消えない。
   */
  .post(
    '/api/staff/reservations/:reservationId/cancel',
    zValidator('json', ReservationCancelInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const reservationId = c.req.param('reservationId')
      const input = c.req.valid('json')
      const found = await c.env.DB.prepare(
        'SELECT store_id AS storeId, status FROM reservations WHERE organization_id = ? AND id = ?',
      )
        .bind(org, reservationId)
        .first<{ storeId: string; status: string }>()
      if (found === null) return c.json({ error: 'not_found' }, 404)

      // 版が合っていても、もう取り消したご予約は書き換えない（理由の上書きを作らない）。
      if (!CHANGEABLE_STATUS.has(found.status)) {
        return c.json(
          {
            error: 'version_conflict' as const,
            current: await conflictingVersion(c.env, org, reservationId),
          },
          409,
        )
      }

      const now = new Date()
      const nowIso = now.toISOString()
      const actorId = await actorStaffId(db, org, found.storeId, sub)
      const walkin = await c.env.DB.prepare(
        'SELECT id FROM walk_ins WHERE organization_id = ? AND reservation_id = ?',
      )
        .bind(org, reservationId)
        .first<{ id: string }>()

      /**
       * ウォークインの帯も同じバッチで閉じる。版のガードは**送られてきた版**を見る
       * （版を +1 する文は `buildCancelBatch` の最後にあるので、まだ進んでいない）。
       */
      const versionGuard =
        'EXISTS (SELECT 1 FROM reservations WHERE organization_id = ? AND id = ? AND version = ?)'
      const walkinStatements: Statement[] =
        walkin === null
          ? []
          : [
              c.env.DB.prepare(
                `UPDATE walk_ins SET status = 'left', left_at = ?, version = version + 1 WHERE organization_id = ? AND id = ? AND ${versionGuard}`,
              ).bind(nowIso, org, walkin.id, org, reservationId, input.version),
            ]
      const statements = [
        ...walkinStatements,
        ...buildCancelBatch({
          db: c.env.DB,
          organizationId: org,
          storeId: found.storeId,
          reservationId,
          version: input.version,
          reason: input.reason,
          now,
          actorId,
          correlationId: crypto.randomUUID(),
          audit: { before: { status: found.status } },
        }),
      ] as [Statement, ...Statement[]]
      const results = await c.env.DB.batch(statements)
      // 最後の 1 文が版を +1 する `UPDATE`。0 行なら 1 行も書かれていない。
      if ((results[results.length - 1]?.meta.changes ?? 0) === 0) {
        return c.json(
          {
            error: 'version_conflict' as const,
            current: await conflictingVersion(c.env, org, reservationId),
          },
          409,
        )
      }

      const detail = await reservationDetailOf(c.env, org, reservationId)
      if (detail === null) return c.json({ error: 'not_found' }, 404)
      return c.json(detail)
    },
  )

  /**
   * ご予約の経緯（HISTORY-LIST 右「そのあとの変更」）。
   *
   * `audit_events` を `target_id` で**古い順**に引く。**知らない `action` は出さない** —
   * 出せば、まだ画面の無い操作の綴りがそのままお客様対応の場に出る。
   */
  .get('/api/staff/reservations/:reservationId/history', async (c) => {
    const org = c.get('auth').org
    const reservationId = c.req.param('reservationId')
    const found = await c.env.DB.prepare(
      'SELECT id FROM reservations WHERE organization_id = ? AND id = ?',
    )
      .bind(org, reservationId)
      .first<{ id: string }>()
    if (found === null) return c.json({ error: 'not_found' }, 404)

    const rows = await c.env.DB.prepare(
      'SELECT a.action, a.before_json AS beforeJson, a.after_json AS afterJson, ' +
        'a.occurred_at AS occurredAt, s.display_name AS actorName FROM audit_events a ' +
        'LEFT JOIN staff s ON s.organization_id = a.organization_id AND s.id = a.actor_id ' +
        'WHERE a.organization_id = ? AND a.target_id = ? ORDER BY a.occurred_at, a.id',
    )
      .bind(org, reservationId)
      .all<AuditChangeRecord>()
    return c.json(
      ReservationChangeHistory.array().parse(
        rows.results
          .map((row) => ({
            occurredAt: row.occurredAt,
            what: changeLabel(row.action, row.afterJson, row.beforeJson),
            actorName: row.actorName,
          }))
          .filter((row) => row.what !== null),
      ),
    )
  })

  /* --- 電話・店頭からの予約受付（P3） ------------------------------------ */

  /**
   * 枠の仮の押さえ（BOOK-05-CONFIRM「仮の押さえ → 11:18 まで」）。**常に 200 を返す。**
   *
   * KV に CAS が無いので「取れなかった」を判定できず、409 `slot_taken` を返さない
   * （`04-api.md` §6.3）。二重予約を止めるのは確定の 1 バッチだけである。
   * 押さえは組織の鍵空間（`hold:<org>:<store>:`）にしか書かないので、店舗の実在を
   * D1 に問い合わせない — 実在しない店舗の押さえは 420 秒で消えるだけで、
   * 誰の枠も塞がない。
   *
   * **枠が取れないこと以外は断る。**取り直しの上限（Q-06 のいまの前提は 10 回）だけは
   * 409 `renew_limit` を返す。数えるのは受付の下書きに載った回数で、端末の state では
   * ない（タブを読み込み直すと 0 に戻り、上限が消える）。
   */
  .post('/api/staff/holds', zValidator('json', HoldInput), async (c) => {
    const org = c.get('auth').org
    const input = c.req.valid('json')
    const now = new Date()
    // 受付が分かっているときだけ D1 を 1 回引く。受付を持たない押さえ（工程 3 の下見）は
    // 取り直しの数えようが無いので、これまでどおり素通りさせる。
    // 下書きの回数は**いま押した 1 回を含む**（画面は打ち直しの前に下書きを送る）ので、
    // 10 回目ちょうどまでは通し、越えたぶんだけ断る。
    if (input.receptionSessionId !== null) {
      const session = await findReceptionSession(drizzle(c.env.DB), org, input.receptionSessionId)
      const draft =
        session?.draftJson == null
          ? null
          : ReceptionSessionDraft.parse(JSON.parse(session.draftJson))
      if ((draft?.holdRenewals ?? 0) > HOLD_RENEW_MAX) {
        return c.json({ error: 'renew_limit' }, 409)
      }
    }
    const endsAt = new Date(
      Date.parse(input.startsAt) + input.durationMinutes * MS_PER_MINUTE,
    ).toISOString()
    // id はルートが振る。応答の `Hold.id` になり、`DELETE` の宛先にもなる。
    const held = await putHold(
      c.env.SHORT_LIVED,
      {
        organizationId: org,
        storeId: input.storeId,
        holdId: crypto.randomUUID(),
        startsAt: input.startsAt,
        endsAt,
        staffId: input.staffId,
        equipmentIds: input.equipmentIds,
        receptionSessionId: input.receptionSessionId,
      },
      now,
    )
    return c.json(
      Hold.parse({
        id: held.id,
        startsAt: held.startsAt,
        endsAt: held.endsAt,
        expiresAt: held.expiresAt,
        staffId: held.staffId,
        equipmentIds: held.equipmentIds,
        receptionSessionId: held.receptionSessionId,
      }),
    )
  })

  /**
   * 押さえを返す（工程 3 で選び直したとき・BOOK-CONFLICT から戻ったとき）。
   *
   * 鍵は `hold:<org>:<store>:<holdId>` の 1 通りだけなので、**店舗をクエリで受ける**。
   * `KV.list` で店舗を探し当てない — list は無料枠 1,000 回/日で、この設計で最初に当たる
   * 上限である（`04-api.md` §6.3）。取り消しのたびに 1 回使うと、空き枠の表示ぶんが削られる。
   */
  .delete('/api/staff/holds/:holdId', async (c) => {
    const org = c.get('auth').org
    const holdId = c.req.param('holdId')
    // 店舗が分かっているなら渡してもらう（`KV.list` を 1 回節約できる）。
    // 分からなくても消せる — `holdId` だけの `DELETE` が経路として成り立つことが、
    // この API を `param` だけで書ける前提である（`04-api.md` §3.6）。
    const removed = await deleteHold(c.env.SHORT_LIVED, org, holdId, c.req.query('storeId'))
    if (!removed) return c.json({ error: 'not_found' }, 404)
    return c.json(DeletedResult.parse({ id: holdId, deleted: true }))
  })

  /**
   * ご予約の確定（BOOK-05-CONFIRM「復唱を終えて予約を確定する」）。
   *
   * 枠が取れたかどうかは**確定の 1 バッチの中だけ**で決まる。ここで枠を読み直して
   * 判定しない（`03-data-model.md` §7.6）。1 本目の占有行の `meta.changes === 0` が
   * 409 `slot_taken` の合図で、そのとき予約は 1 行も書かれていない。
   *
   * 断るのは**動かない事実**だけである — 定休日・営業時間の外（409 `store_closed`）と、
   * ご用件が要求する技能・設備がその時間帯に無いこと（409 `purpose_unavailable`）。
   */
  .post('/api/staff/reservations', zValidator('json', StaffReservationCreate), async (c) => {
    const db = drizzle(c.env.DB)
    const { org, sub } = c.get('auth')
    const input = c.req.valid('json')
    // 全クエリを JWT の `org` で絞る。他テナントの店舗 id は「無い」として 404。
    const store = await findStore(db, org, input.storeId)
    if (!store) return c.json({ error: 'not_found' }, 404)

    // 現在時刻はハンドラの入口で 1 回だけ作り、以降は引数で配る。
    const now = new Date()
    const date = toJstDateString(input.startsAt)
    const rows = await readAvailabilityDay(db, {
      organizationId: org,
      storeId: input.storeId,
      date,
      purposeIds: input.purposeIds,
    })
    // 予約の間隔が決まっていない店舗には確定できない（暗黙の既定値を作らない）。
    const slotRules = rows.slotRules
    if (slotRules === null) return c.json({ error: 'not_found' }, 404)
    // 受けられないご用件（無い id・止めた目的・他店舗のもの）が 1 つでも混ざったら確定しない。
    if (rows.missingPurposes > 0) return c.json({ error: 'purpose_unavailable' }, 409)

    const lines = await readPurposeLines(db, org, input.purposeIds)
    // 「お取りする時間」は目的の合計とは限らない（60 分の用件を 90 分押さえられる）。
    const durationMinutes =
      input.durationMinutes ?? lines.reduce((total, line) => total + line.durationMinutes, 0)
    const endsAt = new Date(
      Date.parse(input.startsAt) + durationMinutes * MS_PER_MINUTE,
    ).toISOString()
    // 所要は**予約した時点の写し**で凍結する（目的の所要をあとで変えても動かない）。
    const bookingPurposes: BookingPurposeLine[] = lines.map((line, index) => ({
      purposeId: line.id,
      durationMinutes: line.durationMinutes,
      sortOrder: index,
    }))

    // 担当・設備は自分の組織・自分の店舗のものだけ。他テナントの id は「無い」として 404。
    const staffMember =
      input.staffId === undefined || input.staffId === null
        ? null
        : (rows.staff.find((member) => member.id === input.staffId) ?? null)
    if (input.staffId !== undefined && input.staffId !== null && staffMember === null) {
      return c.json({ error: 'not_found' }, 404)
    }
    const units: { id: string; capacity: number }[] = []
    for (const equipmentId of input.equipmentIds) {
      const unit = rows.equipment.find((candidate) => candidate.id === equipmentId)
      if (unit === undefined) return c.json({ error: 'not_found' }, 404)
      units.push({ id: unit.id, capacity: unit.capacity })
    }
    // 受付セッションも org で絞る。他テナントの id を指した確定は 404 で、予約はできない。
    const receptionSessionId = input.receptionSessionId ?? null
    const receptionSession =
      receptionSessionId === null ? null : await findReceptionSession(db, org, receptionSessionId)
    if (receptionSessionId !== null && receptionSession === null) {
      return c.json({ error: 'not_found' }, 404)
    }
    // **終わった受付（`booked` / `discarded`）では確定させない。**確定のバッチが打つ
    // `UPDATE reception_sessions … WHERE outcome IS NULL` は 0 行でも失敗しないので、
    // ここで断らないと 200 が返りながら受付と予約の結び付きだけが黙って切れる。
    // 語彙は PATCH / close と揃える（`04-api.md` §5）。
    if (receptionSession !== null && receptionSession.outcome !== null) {
      return c.json({ error: 'invalid_transition' }, 409)
    }

    const holds = await listHoldOccupancies(c.env.SHORT_LIVED, org, input.storeId, now)
    const board = bookingBoard({
      date,
      now,
      rows,
      isSuspended: store.isActive !== '1',
      durationMinutes,
      staffId: input.staffId ?? null,
      equipmentIds: input.equipmentIds,
      receptionSessionId,
      holds,
      preferredStartsAt: input.startsAt,
    })
    const verdict = evaluateSlot(board, input.startsAt)
    const blocked = verdict.reason === null ? undefined : BLOCKING_REASON[verdict.reason]
    if (blocked !== undefined) return c.json({ error: blocked }, 409)

    // 冪等（`04-api.md` §6.2）。`Idempotency-Key` を送らない端末は素通りする
    // （送らない再送は 2 件の予約になる。画面は工程 1 で作った鍵を成功まで送り続ける）。
    // **空文字は「送っていない」と同じ扱いにする** — 素通しすると組織のすべての端末が
    // `<org>:reservation.create:` の 1 本を共有し、別のお客様のご予約を replay する。
    const header = readIdempotencyKey(c.req.header('Idempotency-Key'))
    if (!header.ok) {
      return c.json(
        rejected([
          'Idempotency-Key に使えない文字が入っているため確定できません。鍵を作り直して送り直してください。',
        ]),
        400,
      )
    }
    const clientKey = header.key
    let idempotencyKey: string | null = null
    if (clientKey !== null) {
      const started = await beginIdempotency(c.env.DB, {
        organizationId: org,
        scope: 'reservation.create',
        clientKey,
        requestHash: await requestHash(input),
        now,
      })
      // **再実行しない。**保存した応答をそのまま返す。
      if (started.state === 'replay') return c.json(ReservationDetail.parse(started.response))
      if (started.state === 'conflict') return c.json({ error: 'idempotency_conflict' }, 409)
      idempotencyKey = started.key
    }

    const reservationId = crypto.randomUUID()
    const correlationId = crypto.randomUUID()
    const actorId = await actorStaffId(db, org, input.storeId, sub)
    // 予期しない失敗（D1 の一時障害など）でも `in_progress` を残さない。残すと同じ
    // `Idempotency-Key` の再送が 24 時間ずっと 409 `idempotency_conflict` になり、
    // 伺った内容を持ったままの端末が確定できなくなる（`04-api.md` §6.2 の④）。
    // **採番の打ち直しはここを通らない**（`withReservationCode` の中で吸収される）。
    const attempt = await withReservationCode(c.env.DB, org, now, async (code) => {
      const detail = ReservationDetail.parse({
        id: reservationId,
        code,
        storeId: input.storeId,
        source: input.source,
        status: 'confirmed',
        startsAt: input.startsAt,
        endsAt,
        durationMinutes,
        purposes: lines.map((line, index) => ({
          purposeId: line.id,
          nameInternal: line.nameInternal,
          durationMinutes: line.durationMinutes,
          sortOrder: index,
        })),
        assignments: [
          { kind: 'staff', targetId: staffMember?.id ?? null, startsAt: input.startsAt, endsAt },
          ...units.map((unit) => ({
            kind: 'equipment' as const,
            targetId: unit.id,
            startsAt: input.startsAt,
            endsAt,
          })),
        ],
        webBookingCode: webBookingCodeOf(input.source, code),
        // 台帳の帯は短い名前、詳細と復唱は業務の名前（`03-data-model.md` §6.1）。
        purposeLabel: lines.map((line) => line.nameShort).join('・'),
        purposeLabelInternal: lines.map((line) => line.nameInternal).join('・'),
        noteCustomer: input.noteCustomer,
        noteInternal: input.noteInternal,
        version: FIRST_VERSION,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        createdBy: actorId,
        cancelledAt: null,
        cancelReason: null,
      })
      const results = await c.env.DB.batch(
        bookingStatements(c.env.DB, {
          organizationId: org,
          storeId: input.storeId,
          reservationId,
          code,
          source: input.source,
          startsAt: input.startsAt,
          endsAt,
          durationMinutes,
          purposes: bookingPurposes,
          staff:
            staffMember === null
              ? null
              : {
                  id: staffMember.id,
                  maxParallelReservations: staffMember.maxParallelReservations,
                },
          equipment: units,
          slotRules,
          noteCustomer: input.noteCustomer,
          noteInternal: input.noteInternal,
          actorId,
          correlationId,
          receptionSessionId,
          idempotency: idempotencyKey === null ? null : { key: idempotencyKey, response: detail },
          now,
        }),
      )
      // 1 本目は占有行の INSERT。0 行なら枠は取れていない（予約も 1 行も書かれていない）。
      return { taken: (results[0]?.meta.changes ?? 0) === 0, detail }
    }).catch(async (err: unknown) => {
      if (idempotencyKey !== null) await releaseIdempotency(c.env.DB, idempotencyKey)
      throw err
    })

    // 採番が尽きた。500 にせず人を呼ぶ（`04-api.md` §5 の `code_exhausted`）。
    if (!attempt.ok) {
      if (idempotencyKey !== null) await releaseIdempotency(c.env.DB, idempotencyKey)
      return c.json({ error: 'code_exhausted' }, 409)
    }
    if (attempt.value.taken) {
      // 鍵を空けて、同じ鍵のまま時刻を選び直せるようにする（伺った内容を失わせない）。
      if (idempotencyKey !== null) await releaseIdempotency(c.env.DB, idempotencyKey)
      // 代わりの時刻は**取られたあとの盤面**から採る（自分が読んだあとに相手が確定している）。
      const fresh = await readAvailabilityDay(db, {
        organizationId: org,
        storeId: input.storeId,
        date,
        purposeIds: input.purposeIds,
      })
      const answer = computeAvailability(
        bookingBoard({
          date,
          now,
          rows: fresh,
          isSuspended: store.isActive !== '1',
          durationMinutes,
          staffId: input.staffId ?? null,
          equipmentIds: input.equipmentIds,
          receptionSessionId,
          holds,
          preferredStartsAt: input.startsAt,
        }),
      )
      return c.json(
        {
          error: 'slot_taken' as const,
          alternatives: AvailabilitySlot.array().max(3).parse(answer.alternatives),
        },
        409,
      )
    }
    // 取れた枠の押さえを返す。**返さないと、確定したご予約とその予約が置いた押さえの
    // 両方が同じ枠を数える**（同時受付 2 の担当なら 1 件のご予約で「満席」と出る）。
    // 画面の `DELETE` だけに任せない — タブを閉じる・回線が切れるで 420 秒ぶん残る。
    // 枠の一次排他はもうバッチが打ってあるので、失敗しても確定は止めない（best-effort）。
    // 店舗が分かっているので `storeId` を渡し、`KV.list` を 1 回節約する（§6.3）。
    if (input.holdId !== undefined) {
      await deleteHold(c.env.SHORT_LIVED, org, input.holdId, input.storeId).catch(() => false)
    }
    return c.json(attempt.value.detail)
  })

  /**
   * 受付を始める（「新しい予約を取る」）。始めた時点で決まっているのは店舗だけである。
   * 破棄でも行は残すので、ここで作った行は消えない（`03-data-model.md` §8.1）。
   */
  .post('/api/staff/reception-sessions', zValidator('json', ReceptionSessionStart), async (c) => {
    const db = drizzle(c.env.DB)
    const { org, sub } = c.get('auth')
    const { storeId } = c.req.valid('json')
    if (!(await findStore(db, org, storeId))) return c.json({ error: 'not_found' }, 404)
    const startedAt = new Date().toISOString()
    const id = crypto.randomUUID()
    const actorId = await actorStaffId(db, org, storeId, sub)
    await c.env.DB.prepare(
      'INSERT INTO reception_sessions (id, organization_id, store_id, reservation_id, terminal_id, actor_id, started_at, ended_at, outcome, draft_json, created_at) VALUES (?,?,?,NULL,NULL,?,?,NULL,NULL,NULL,?)',
    )
      .bind(id, org, storeId, actorId, startedAt, startedAt)
      .run()
    return c.json(
      ReceptionSession.parse({
        id,
        storeId,
        reservationId: null,
        terminalId: null,
        actorId,
        startedAt,
        endedAt: null,
        outcome: null,
        draft: null,
        createdAt: startedAt,
      }),
    )
  })

  /**
   * 5 工程で伺った内容の下書きを保存する。**欄ごとの差分ではなく丸ごと 1 つ**を受ける。
   *
   * 端末のメモリだけに持たないのは、iPadOS の Safari が裏に回ったタブを容易に捨て、
   * 戻ると読み込み直すためである（伺った内容が丸ごと消える）。持てるのは選んだ id と
   * 打ちかけの文字だけで、お客様のお名前・お電話番号そのものを持つ欄は無い（`07-nfr.md` §6.6）。
   */
  .patch(
    '/api/staff/reception-sessions/:sessionId',
    zValidator('json', ReceptionSessionDraftPatch),
    async (c) => {
      const db = drizzle(c.env.DB)
      const org = c.get('auth').org
      const sessionId = c.req.param('sessionId')
      const row = await findReceptionSession(db, org, sessionId)
      if (row === null) return c.json({ error: 'not_found' }, 404)
      // 終わった受付の下書きは動かさない（成立した予約の裏で下書きだけが変わらない）。
      if (row.outcome !== null) return c.json({ error: 'invalid_transition' }, 409)
      const { draft } = c.req.valid('json')
      await c.env.DB.prepare(
        'UPDATE reception_sessions SET draft_json = ? WHERE organization_id = ? AND id = ? AND outcome IS NULL',
      )
        .bind(JSON.stringify(draft), org, sessionId)
        .run()
      return c.json(ReceptionSession.parse({ ...toReceptionSession(row), draft }))
    },
  )

  /**
   * 受付をやめる（BOOK の「入力をやめる」）。**受ける結果は `discarded` だけ**である。
   * 成立（`booked`）は確定の 1 バッチが書く値なので、端末から送れると予約の無い受付を
   * 成立として残せてしまう。破棄でも行は残す（録音も捨てない）。
   */
  .post(
    '/api/staff/reception-sessions/:sessionId/close',
    zValidator('json', ReceptionSessionClose),
    async (c) => {
      const db = drizzle(c.env.DB)
      const org = c.get('auth').org
      const sessionId = c.req.param('sessionId')
      const row = await findReceptionSession(db, org, sessionId)
      if (row === null) return c.json({ error: 'not_found' }, 404)
      if (row.outcome !== null) return c.json({ error: 'invalid_transition' }, 409)
      const { outcome } = c.req.valid('json')
      const endedAt = new Date().toISOString()
      // `outcome` と `ended_at` は同じ UPDATE で書き、`draft_json` は NULL へ戻す。
      await c.env.DB.prepare(
        'UPDATE reception_sessions SET ended_at = ?, outcome = ?, draft_json = NULL WHERE organization_id = ? AND id = ? AND outcome IS NULL',
      )
        .bind(endedAt, outcome, org, sessionId)
        .run()
      return c.json(
        ReceptionSession.parse({ ...toReceptionSession(row), endedAt, outcome, draft: null }),
      )
    },
  )

  /* --- 顧客台帳（P4） ---------------------------------------------------- */

  /**
   * 台帳の一覧と検索（CUSTOMER-LIST「当てはまるお客様 42名」）。
   *
   * **`OFFSET` を書かない。**続きは `(kana, id)` / `(visit_count, id)` の複合カーソルで
   * 取り、`total` は同じ条件の `COUNT(*)` で数える（`04-api.md` §1.2）。
   * 下 4 桁は `phone_last4` の完全一致、お名前は部分一致で、**電話番号の列に
   * `LIKE '%' || ?` を当てない**（B-tree が効かず顧客表の全走査になる）。
   */
  .get('/api/staff/customers', async (c) => {
    const org = c.get('auth').org
    const query = validQuery(c, CustomerSearchQuery, c.req.query())
    const scope = customerScope(org, query)

    // カーソルは並べ方に結び付いた不透明な値。読めなければ先頭から返す
    // （壊れたカーソルで行き止まりにしない）。
    const cursor = query.cursor === undefined ? null : decodeCursor(query.sort, query.cursor)
    let page = ''
    const pageParams: unknown[] = []
    if (cursor !== null && cursor.sort === 'kana') {
      page = ' AND (kana > ? OR (kana = ? AND id > ?))'
      pageParams.push(cursor.kana, cursor.kana, cursor.id)
    }
    if (cursor !== null && cursor.sort === 'visits') {
      page = ' AND (visit_count < ? OR (visit_count = ? AND id > ?))'
      pageParams.push(cursor.visitCount, cursor.visitCount, cursor.id)
    }
    const order = query.sort === 'kana' ? 'kana ASC, id ASC' : 'visit_count DESC, id ASC'

    const read = await c.env.DB.batch([
      c.env.DB.prepare(`SELECT COUNT(*) AS total FROM customers WHERE ${scope.clause}`).bind(
        ...scope.params,
      ),
      c.env.DB.prepare(
        `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE ${scope.clause}${page} ORDER BY ${order} LIMIT ?`,
      ).bind(...scope.params, ...pageParams, query.limit + 1),
    ])

    const found = ((read[1]?.results ?? []) as CustomerRecord[]).map(toCustomerRow)
    const items = found.slice(0, query.limit)
    const last = items[items.length - 1]
    return c.json(
      CustomerList.parse({
        items: items.map(toCustomerSummary),
        // 続きがあるときだけ載せる。**最後のページで空でないカーソルを返さない。**
        nextCursor:
          found.length > query.limit && last !== undefined ? encodeCursor(query.sort, last) : null,
        total: ((read[0]?.results ?? []) as { total: number }[])[0]?.total ?? 0,
      }),
    )
  })

  /**
   * お客様の候補（BOOK-04b-CUSTOMER-MATCH「同じ番号のご来店が2件見つかりました。」／
   * CUSTOMER-NEW の重複警告）。**1 件でも自動で確定しない**ので、応答は常に配列である。
   *
   * 番号は正規化した `phone_normalized` の**前方一致**で拾う。下 4 桁が違う
   * 090-1234-9912 も先頭 7 桁で当たるので、台帳の後方一致とは引き方そのものが違う。
   */
  .get('/api/staff/customers/lookup', async (c) => {
    const org = c.get('auth').org
    const query = validQuery(c, CustomerLookupQuery, c.req.query())
    const clauses: string[] = []
    const params: unknown[] = [org]
    const typed: { phone?: string | null; phoneLast4?: string | null } = {}

    if (query.phone !== undefined) {
      const filter = lookupFilter(query.phone)
      // 番号として読めない打鍵（9 桁など）は当てに行かない。空振りを全走査にしない。
      if (filter === null) return c.json([])
      const built = customerFilterClause(filter)
      clauses.push(built.clause)
      params.push(...built.params)
      typed.phone = normalizePhone(query.phone)
    }
    if (query.phoneLast4 !== undefined) {
      clauses.push(' AND phone_last4 = ?')
      params.push(query.phoneLast4)
      typed.phoneLast4 = query.phoneLast4
    }
    for (const word of [query.name, query.kana]) {
      if (word === undefined || word === '') continue
      clauses.push(' AND (name LIKE ? OR kana LIKE ?)')
      params.push(`%${word}%`, `%${word}%`)
    }

    const found = await c.env.DB.prepare(
      `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE organization_id = ? AND merged_into_id IS NULL${clauses.join('')} LIMIT 20`,
    )
      .bind(...params)
      .all<CustomerRecord>()
    const rows = found.results.map(toCustomerRow)
    // 確からしさの 2 段は番号を打った照会だけが持つ。お名前だけの照会は
    // 「確かめが必要です」に揃える（全桁一致という言い方が成り立たない）。
    const ranked =
      typed.phone === undefined && typed.phoneLast4 === undefined
        ? rows.map((customer) => ({ customer, match: 'weak' as const }))
        : rankCandidates(rows, typed)
    if (ranked.length === 0) return c.json([])

    const ids = ranked.map((row) => row.customer.id)
    const holes = ids.map(() => '?').join(',')
    const extra = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT customer_id AS customerId, ${PRESCRIPTION_COLUMNS} FROM customer_prescriptions ` +
          `WHERE organization_id = ? AND customer_id IN (${holes}) AND is_current = '1'`,
      ).bind(org, ...ids),
      c.env.DB.prepare(
        'SELECT r.customer_id AS customerId, s.display_name AS displayName, MAX(r.starts_at) AS lastAt ' +
          "FROM reservations r JOIN reservation_assignments a ON a.reservation_id = r.id AND a.kind = 'staff' " +
          'JOIN staff s ON s.id = a.target_id ' +
          `WHERE r.organization_id = ? AND r.customer_id IN (${holes}) AND r.status = 'done' ` +
          'GROUP BY r.customer_id',
      ).bind(org, ...ids),
      c.env.DB.prepare(
        'SELECT customer_id AS customerId, body FROM customer_notes ' +
          `WHERE organization_id = ? AND customer_id IN (${holes}) AND kind = 'attention' AND status = 'published' ` +
          'ORDER BY created_at DESC',
      ).bind(org, ...ids),
    ])

    const prescriptions = new Map(
      ((extra[0]?.results ?? []) as (PrescriptionRecord & { customerId: string })[]).map((row) => [
        row.customerId,
        toPrescription(row),
      ]),
    )
    const staffNames = new Map(
      ((extra[1]?.results ?? []) as { customerId: string; displayName: string }[]).map((row) => [
        row.customerId,
        row.displayName,
      ]),
    )
    const attentions = new Map<string, string>()
    for (const row of (extra[2]?.results ?? []) as { customerId: string; body: string }[]) {
      if (!attentions.has(row.customerId)) attentions.set(row.customerId, row.body)
    }

    return c.json(
      CustomerCandidate.array().parse(
        ranked.map((row) => ({
          customer: toCustomerSummary(row.customer),
          match: row.match,
          lastVisitAt: row.customer.lastVisitAt,
          currentPrescription: prescriptions.get(row.customer.id) ?? null,
          lastStaffName: staffNames.get(row.customer.id) ?? null,
          attentionSummary: (attentions.get(row.customer.id) ?? '').slice(0, 60),
        })),
      ),
    )
  })

  /**
   * おまとめの下見（CUSTOMER-MERGE の見比べ表と「まとめると、こうなります」）。
   *
   * **下見も店長だけが開ける。**AC-CUST-16 が「おまとめの入口が画面のどこにも出ず」と
   * 要求するので、実行だけを閉じても足りない。店長は選択中店舗の `StorePermission` に
   * `settings.manage` を持つ人で、**JWT の `role` では決まらない**（`04-api.md` §2.2）。
   */
  .post(
    '/api/staff/customers/merge/preview',
    requireStorePermission('settings.manage'),
    zValidator('json', CustomerMergePreviewRequest),
    async (c) => {
      const org = c.get('auth').org
      const { primaryId, secondaryId } = c.req.valid('json')
      const pair = await readMergePair(c.env.DB, org, primaryId, secondaryId)
      if (pair === null) return c.json({ error: 'not_found' }, 404)

      const resolved = mergePreview(pair.primary, pair.secondary)
      if (!resolved.ok) return c.json(rejected(['この 2 件はまとめられません。']), 400)

      // 下見が見た件数を写しておく。実行はこれと突き合わせ、下見のあとに片方へ
      // 新しい予約が入っていたら拒んで下見からやり直させる（AC-CUST-15）。
      const snapshot = await countMergeSubjects(c.env.DB, org, primaryId, secondaryId)
      await c.env.SHORT_LIVED.put(
        mergeSnapshotKey(org, primaryId, secondaryId),
        JSON.stringify(snapshot),
        { expirationTtl: MERGE_SNAPSHOT_TTL_SECONDS },
      )

      // ご来店の回数と最後のご来店は、`customers.visit_count` の書き戻し先（P5）が
      // まだ無いために保存値が古いことがある。**実行が書き込む値と同じ質問を同じ場所へ
      // 投げ直す**（`countVisitsOf`）——`mergedRow` の素の足し算をそのまま返すと、
      // 下見で読んだ数字と実行後の詳細の数字が食い違いうる（この関数のコメントが
      // 「下見に出した姿と実行が書き込む行を同じ 1 か所から作る」と言っている原則そのもの）。
      const liveCounters = await countVisitsOf(c.env.DB, org, [primaryId, secondaryId], new Date())
      const result = {
        ...resolved.result,
        visitCount: liveCounters.visitCount,
        lastVisitAt:
          liveCounters.lastVisitAt === null ? null : toJstDateString(liveCounters.lastVisitAt),
      }

      return c.json(
        CustomerMergePreview.parse({
          fields: resolved.fields.map(toMergeField),
          result,
          noteCount: resolved.noteCount,
          losingCustomerNumber: resolved.losingCustomerNumber,
        }),
      )
    },
  )

  /**
   * おまとめの実行（「この内容でまとめる」）。**取り消せない。**
   *
   * 1 つの `db.batch()` に ①予約の付け替え ②メモの付け替え ③残す側の項目更新
   * ④監査の追記 ⑤冪等の記録 ⑥**残さない側に統合先を書く UPDATE** の順で並べ、
   * 全文に下見と同じ状態かを確かめる `WHERE ... AND EXISTS (...)` を配る。
   * 拒む判定は最後の文の `meta.changes === 0` で行う（0 行の UPDATE は D1 のバッチを
   * 止めないので、条件を 1 文目にだけ付けると付け替えだけが済んだ状態ができる）。
   */
  .post(
    '/api/staff/customers/merge',
    requireStorePermission('settings.manage'),
    zValidator('json', CustomerMergeInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const input = c.req.valid('json')
      const pair = await readMergePair(c.env.DB, org, input.primaryId, input.secondaryId)
      if (pair === null) return c.json({ error: 'not_found' }, 404)

      const choices = input.fields.map((field) => ({ field: field.field, choice: field.choice }))
      const resolved = mergePreview(pair.primary, pair.secondary, choices)
      const merged = applyMerge(pair.primary, pair.secondary, choices)
      if (!resolved.ok || merged === null) {
        return c.json(rejected(['この内容ではまとめられません。下見からやり直してください。']), 400)
      }

      const now = new Date()
      const nowIso = now.toISOString()
      // 監査に残す店舗と操作者。店長は必ずどこかの店舗で `settings.manage` を持っている。
      const membership = await c.env.DB.prepare(
        'SELECT store_id AS storeId FROM store_memberships WHERE organization_id = ? AND user_id = ? LIMIT 1',
      )
        .bind(org, sub)
        .first<{ storeId: string }>()
      const storeId = membership?.storeId ?? null
      const actorId = storeId === null ? null : await actorStaffId(db, org, storeId, sub)

      // 冪等（`04-api.md` §6.2）。同じ鍵の再送では**再実行せず**保存した応答を返す。
      const header = readIdempotencyKey(c.req.header('Idempotency-Key'))
      if (!header.ok) {
        return c.json(
          rejected([
            'Idempotency-Key に使えない文字が入っているためまとめられません。鍵を作り直して送り直してください。',
          ]),
          400,
        )
      }
      let idempotencyKey: string | null = null
      if (header.key !== null) {
        const started = await beginIdempotency(c.env.DB, {
          organizationId: org,
          scope: 'customer.merge',
          clientKey: header.key,
          requestHash: await requestHash(input),
          now,
        })
        if (started.state === 'replay') return c.json(CustomerMergeResult.parse(started.response))
        if (started.state === 'conflict') return c.json({ error: 'idempotency_conflict' }, 409)
        idempotencyKey = started.key
      }

      // 下見の写しが無ければ実行しない。**下見を通らない実行はここで止まる**ので、
      // 「まとめたあとの姿と失うもの」を読まずに取り消せない操作へ進む道ができない。
      // 冪等の入口より**あと**に置く — 先に置くと、まとまったあとの再送が
      // 保存した応答ではなく 409 を受け取り、確定したのに失敗と見える。
      const snapshotKey = mergeSnapshotKey(org, input.primaryId, input.secondaryId)
      const stored = await c.env.SHORT_LIVED.get(snapshotKey)
      if (stored === null) {
        if (idempotencyKey !== null) await releaseIdempotency(c.env.DB, idempotencyKey)
        return c.json({ error: 'version_conflict' }, 409)
      }
      const snapshot = JSON.parse(stored) as MergeSnapshot

      const guard = mergeGuard({
        org,
        primaryId: input.primaryId,
        secondaryId: input.secondaryId,
        primaryVersion: input.primaryVersion,
        secondaryVersion: input.secondaryVersion,
        reservationCount: snapshot.reservationCount,
        noteCount: snapshot.noteCount,
      })
      // 来店回数は読むたびに数えない。**寄せた予約の集合から数え直してここで書き戻す**
      // （`done` の件数と、来店済みの最初と最後の瞬間）。
      const counters = await countVisitsOf(c.env.DB, org, [input.primaryId, input.secondaryId], now)
      // 接客のメモを付け替えるのは「両方を残します」を選んだときだけ。残す側だけを
      // 選んだときは残さない側のメモを動かさない（消しもしない。行は参照専用で残る）。
      const movesNotes =
        (input.fields.find((field) => field.field === 'notes')?.choice ?? 'both') !== 'primary'

      const statements: Statement[] = [
        c.env.DB.prepare(
          `UPDATE reservations SET customer_id = ?, updated_at = ? WHERE organization_id = ? AND customer_id = ? AND ${guard.clause}`,
        ).bind(input.primaryId, nowIso, org, input.secondaryId, ...guard.params),
        c.env.DB.prepare(
          `UPDATE customer_notes SET customer_id = ?, updated_at = ? WHERE organization_id = ? AND customer_id = ? AND ? = 1 AND ${guard.clause}`,
        ).bind(
          input.primaryId,
          nowIso,
          org,
          input.secondaryId,
          movesNotes ? 1 : 0,
          ...guard.params,
        ),
        /*
         * 店頭の受付の行も寄せる。寄せないと来店受付ボードと受付履歴が、まとめられて
         * 消えたお客様の id を指したまま残り、そのウォークインの退店が残す側ではなく
         * 消えた側の来店回数を数え直す（`008-reception-and-walkin` の AC-RECEP-23）。
         * **応答の `movedReservations` / `movedNotes` は先頭 2 文から読むので、
         * この文をその前に割り込ませない。**
         */
        c.env.DB.prepare(
          `UPDATE walk_ins SET customer_id = ? WHERE organization_id = ? AND customer_id = ? AND ${guard.clause}`,
        ).bind(input.primaryId, org, input.secondaryId, ...guard.params),
        // ③ 残す側の項目。**版は進めない** — 進めると下から先の文の条件が自分で崩れる。
        c.env.DB.prepare(
          'UPDATE customers SET name = ?, kana = ?, phone = ?, phone_normalized = ?, phone_last4 = ?, ' +
            'address = ?, memo = ?, visit_count = ?, first_visit_at = ?, last_visit_at = ?, updated_at = ? ' +
            `WHERE organization_id = ? AND id = ? AND ${guard.clause}`,
        ).bind(
          merged.name,
          merged.kana,
          merged.phoneNormalized,
          merged.phoneNormalized,
          merged.phoneLast4,
          merged.address,
          merged.memo,
          counters.visitCount,
          counters.firstVisitAt,
          counters.lastVisitAt,
          nowIso,
          org,
          input.primaryId,
          ...guard.params,
        ),
        // ④ 監査は追記専用。**平文のお名前・お電話番号を入れない**（`07-nfr.md` §6.6）。
        c.env.DB.prepare(
          'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
            `SELECT ?, ?, ?, 'staff', ?, NULL, 'customer.merged', 'customer', ?, NULL, ?, ?, ? WHERE ${guard.clause}`,
        ).bind(
          crypto.randomUUID(),
          org,
          storeId,
          actorId,
          input.primaryId,
          JSON.stringify({
            mergedId: input.secondaryId,
            losingCustomerNumber: resolved.losingCustomerNumber,
            fields: choices,
          }),
          crypto.randomUUID(),
          nowIso,
          ...guard.params,
        ),
      ]
      if (idempotencyKey !== null) {
        statements.push(
          c.env.DB.prepare(
            `UPDATE idempotency_records SET status = 'done', response_json = ? WHERE key = ? AND status = 'in_progress' AND ${guard.clause}`,
          ).bind('', idempotencyKey, ...guard.params),
        )
      }
      // ⑥ **最後の 1 文。**残さない側に統合先を書き、2 人ぶんの版を同時に +1 する。
      // この文の `meta.changes` だけが「まとまったか」を知っている。
      statements.push(
        c.env.DB.prepare(
          'UPDATE customers SET merged_into_id = CASE WHEN id = ? THEN ? ELSE merged_into_id END, ' +
            'version = version + 1, updated_at = ? ' +
            `WHERE organization_id = ? AND (id = ? OR id = ?) AND ${guard.clause}`,
        ).bind(
          input.secondaryId,
          input.primaryId,
          nowIso,
          org,
          input.primaryId,
          input.secondaryId,
          ...guard.params,
        ),
      )

      const results = await c.env.DB.batch(statements)
      const settled = results[results.length - 1]
      if ((settled?.meta.changes ?? 0) === 0) {
        // 1 行も変わっていない。鍵を空けて、下見からやり直せるようにする。
        if (idempotencyKey !== null) await releaseIdempotency(c.env.DB, idempotencyKey)
        return c.json({ error: 'version_conflict' }, 409)
      }

      const detail = await readCustomerDetail(c.env, org, input.primaryId, now)
      const answer = CustomerMergeResult.parse({
        customer: detail,
        mergedId: input.secondaryId,
        movedReservations: results[0]?.meta.changes ?? 0,
        movedNotes: results[1]?.meta.changes ?? 0,
      })
      // 応答の写しは本処理のあとで書く（バッチの中では中身がまだ無い）。
      if (idempotencyKey !== null) {
        await c.env.DB.prepare(
          "UPDATE idempotency_records SET response_json = ? WHERE key = ? AND status = 'done'",
        )
          .bind(JSON.stringify(answer), idempotencyKey)
          .run()
      }
      // 同じ下見でもう一度実行させない（件数が動いた状態の写しを残さない）。
      await c.env.SHORT_LIVED.delete(snapshotKey)
      return c.json(answer)
    },
  )

  /**
   * 新しいお客様の登録（CUSTOMER-NEW「登録してご予約に進む」）。**お名前だけで登録できる。**
   * お客様番号は組織の中で一意で、おまとめで失った番号は再利用しない。
   */
  .post('/api/staff/customers', zValidator('json', CustomerCreate), async (c) => {
    const org = c.get('auth').org
    const input = c.req.valid('json')
    const phone = phoneColumns(input.phone)
    if (phone === null) {
      return c.json(rejected(['お電話番号は 10 桁または 11 桁の数字で入れてください。']), 400)
    }
    const id = crypto.randomUUID()
    const now = new Date()
    const nowIso = now.toISOString()
    const serial = await nextCustomerSerial(c.env.DB, org)

    // 採番の衝突は打ち直す。尽きたら 500 にせず人を呼ぶ（`04-api.md` §5）。
    let saved: string | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = serial + attempt
      if (candidate > CUSTOMER_NUMBER_MAX) break
      try {
        await c.env.DB.prepare(
          'INSERT INTO customers (id, organization_id, customer_number, name, kana, phone, phone_normalized, phone_last4, email, birth_date, address, memo, first_visit_at, last_visit_at, visit_count, merged_into_id, version, created_store_id, created_terminal_id, created_at, updated_at) ' +
            'VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,NULL,NULL,0,NULL,1,NULL,NULL,?,?)',
        )
          .bind(
            id,
            org,
            formatCustomerNumber(candidate),
            input.name,
            input.kana ?? '',
            phone.phone,
            phone.normalized,
            phone.last4,
            input.email ?? null,
            input.birthDate ?? null,
            input.memo ?? '',
            nowIso,
            nowIso,
          )
          .run()
        saved = formatCustomerNumber(candidate)
        break
      } catch (err) {
        if (constraintTable(err) !== 'customers') throw err
      }
    }
    if (saved === null) return c.json({ error: 'code_exhausted' }, 409)
    return c.json(CustomerDetail.parse(await readCustomerDetail(c.env, org, id, now)))
  })

  /**
   * お客様 1 名（CUSTOMER-DETAIL）。**他テナントの id は 404** にして、
   * 403 で存在の有無を漏らさない。まとめられた行は id を知っていれば読める
   * （`mergedIntoId` で参照専用と分かる）が、検索と一覧からは外れている。
   */
  .get('/api/staff/customers/:customerId', async (c) => {
    const org = c.get('auth').org
    const detail = await readCustomerDetail(c.env, org, c.req.param('customerId'), new Date())
    if (detail === null) return c.json({ error: 'not_found' }, 404)
    return c.json(CustomerDetail.parse(detail))
  })

  /** お客様の更新。`version` が合わなければ 409 で、**1 列も変えない。** */
  .patch('/api/staff/customers/:customerId', zValidator('json', CustomerPatch), async (c) => {
    const org = c.get('auth').org
    const customerId = c.req.param('customerId')
    const input = c.req.valid('json')
    const current = await findCustomer(c.env.DB, org, customerId)
    if (current === null) return c.json({ error: 'not_found' }, 404)

    const sets: string[] = ['version = version + 1', 'updated_at = ?']
    const now = new Date()
    const params: unknown[] = [now.toISOString()]
    if (input.name !== undefined) {
      sets.push('name = ?')
      params.push(input.name)
    }
    if (input.kana !== undefined) {
      sets.push('kana = ?')
      params.push(input.kana)
    }
    if (input.phone !== undefined) {
      const phone = phoneColumns(input.phone)
      if (phone === null) {
        return c.json(rejected(['お電話番号は 10 桁または 11 桁の数字で入れてください。']), 400)
      }
      sets.push('phone = ?', 'phone_normalized = ?', 'phone_last4 = ?')
      params.push(phone.phone, phone.normalized, phone.last4)
    }
    if (input.email !== undefined) {
      sets.push('email = ?')
      params.push(input.email)
    }
    if (input.birthDate !== undefined) {
      sets.push('birth_date = ?')
      params.push(input.birthDate)
    }
    if (input.memo !== undefined) {
      sets.push('memo = ?')
      params.push(input.memo)
    }

    const applied = await c.env.DB.prepare(
      `UPDATE customers SET ${sets.join(', ')} WHERE organization_id = ? AND id = ? AND version = ?`,
    )
      .bind(...params, org, customerId, input.version)
      .run()
    if ((applied.meta.changes ?? 0) === 0) return c.json({ error: 'version_conflict' }, 409)
    return c.json(CustomerDetail.parse(await readCustomerDetail(c.env, org, customerId, now)))
  })

  /**
   * メモと手書き（CUSTOMER-HANDWRITE 左「手書きメモ 3枚」／CUSTOMER-DETAIL 右）。
   * **他店で書かれた 1 枚も同じ組織なら読める**ので、店舗で絞らない。
   */
  .get('/api/staff/customers/:customerId/notes', async (c) => {
    const org = c.get('auth').org
    const customerId = c.req.param('customerId')
    if ((await findCustomer(c.env.DB, org, customerId)) === null) {
      return c.json({ error: 'not_found' }, 404)
    }
    const query = validQuery(c, CustomerNoteQuery, c.req.query())
    let clause = ''
    const params: unknown[] = [org, customerId]
    if (query.kind !== undefined) {
      clause += ' AND kind = ?'
      params.push(query.kind)
    }
    if (query.status.length > 0) {
      clause += ` AND status IN (${query.status.map(() => '?').join(',')})`
      params.push(...query.status)
    }
    if (!query.includeOtherStores) {
      // 「自店」は選択中店舗ではなく、この人が入れる店舗として読む
      // （リクエストが店舗を運ばないので、`store_memberships` から導く）。
      clause +=
        ' AND store_id IN (SELECT store_id FROM store_memberships WHERE organization_id = ? AND user_id = ?)'
      params.push(org, c.get('auth').sub)
    }
    const found = await c.env.DB.prepare(
      `SELECT ${NOTE_COLUMNS} FROM customer_notes WHERE organization_id = ? AND customer_id = ?${clause} ORDER BY created_at DESC`,
    )
      .bind(...params)
      .all<NoteRecord>()
    return c.json(
      CustomerNote.array().parse(await toNotes(c.env.DB, c.env.RECORDINGS, org, found.results)),
    )
  })

  /**
   * メモを足す（BOOK-04d-HANDWRITE「手書きのまま残す」）。
   *
   * 筆跡の本体は **R2（`notes/{org}/{customerId}/{noteId}.svg`）** に置き、D1 には
   * キーだけを持つ。1 枚 3〜12KB × 5 枚 × 5,000 顧客で D1 の 500MB の 6 割を占めるためである。
   * 上限は 1 顧客 5 枚で、**6 枚目は黙って古い 1 枚を消さず**、置き換える候補を返して拒む。
   */
  .post(
    '/api/staff/customers/:customerId/notes',
    zValidator('json', CustomerNoteInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const customerId = c.req.param('customerId')
      if ((await findCustomer(c.env.DB, org, customerId)) === null) {
        return c.json({ error: 'not_found' }, 404)
      }
      const input = c.req.valid('json')
      if (!(await findStore(db, org, input.storeId))) return c.json({ error: 'not_found' }, 404)

      const noteId = crypto.randomUUID()
      let key: string | null = null
      if (input.handwritingSvg !== null) {
        const sheets = await c.env.DB.prepare(
          'SELECT id, created_at AS createdAt FROM customer_notes ' +
            'WHERE organization_id = ? AND customer_id = ? AND handwriting_key IS NOT NULL ORDER BY created_at ASC',
        )
          .bind(org, customerId)
          .all<{ id: string; createdAt: string }>()
        const room = acceptSheet(sheets.results)
        if (!room.ok) {
          // どの 1 枚を置き換えるかを尋ねるための材料をそのまま返す。
          return c.json({ error: 'invalid_transition' as const, sheets: room.sheets }, 409)
        }
        const accepted = acceptHandwriting(input.handwritingSvg)
        if (!accepted.ok) return c.json({ error: 'payload_too_large' }, 413)
        key = handwritingKey(org, customerId, noteId)
        await c.env.RECORDINGS.put(key, accepted.svg, {
          httpMetadata: { contentType: 'image/svg+xml' },
        })
      }

      const nowIso = new Date().toISOString()
      const actorId = await actorStaffId(db, org, input.storeId, sub)
      await c.env.DB.prepare(
        'INSERT INTO customer_notes (id, organization_id, customer_id, store_id, kind, body, handwriting_key, author_id, revision, status, created_at, updated_at) ' +
          "VALUES (?,?,?,?,?,?,?,?,1,'draft',?,?)",
      )
        .bind(
          noteId,
          org,
          customerId,
          input.storeId,
          input.kind,
          input.body,
          key,
          actorId,
          nowIso,
          nowIso,
        )
        .run()
      return c.json(CustomerNote.parse((await oneNote(c.env, org, customerId, noteId)) ?? {}))
    },
  )

  /**
   * 読み取った文字の修正（CUSTOMER-HANDWRITE「文字を保存する」）。
   * **筆跡は書いたときのまま残す**ので、この経路は `handwriting_key` に触れない。
   */
  .patch(
    '/api/staff/customers/:customerId/notes/:noteId',
    zValidator('json', CustomerNotePatch),
    async (c) => {
      const org = c.get('auth').org
      const customerId = c.req.param('customerId')
      const noteId = c.req.param('noteId')
      const input = c.req.valid('json')
      if ((await oneNote(c.env, org, customerId, noteId)) === null) {
        return c.json({ error: 'not_found' }, 404)
      }
      const sets = ['revision = revision + 1', 'updated_at = ?']
      const params: unknown[] = [new Date().toISOString()]
      if (input.body !== undefined) {
        sets.push('body = ?')
        params.push(input.body)
      }
      if (input.status !== undefined) {
        sets.push('status = ?')
        params.push(input.status)
      }
      const applied = await c.env.DB.prepare(
        `UPDATE customer_notes SET ${sets.join(', ')} WHERE organization_id = ? AND customer_id = ? AND id = ? AND revision = ?`,
      )
        .bind(...params, org, customerId, noteId, input.revision)
        .run()
      if ((applied.meta.changes ?? 0) === 0) return c.json({ error: 'version_conflict' }, 409)
      return c.json(CustomerNote.parse((await oneNote(c.env, org, customerId, noteId)) ?? {}))
    },
  )

  /**
   * 注意ごとへの申し込み（「注意ごととして登録を申し込む」）。
   * **申し込みだけでは注意ごとにならない。**`kind='attention'` / `status='draft'` を立てるだけで、
   * `published` へ上げるのは承認の面（P10）である。誤読がそのまま接客の禁忌にならないようにする。
   */
  .post(
    '/api/staff/customers/:customerId/notes/:noteId/publish',
    zValidator('json', CustomerNotePublishInput),
    async (c) => {
      const org = c.get('auth').org
      const customerId = c.req.param('customerId')
      const noteId = c.req.param('noteId')
      const input = c.req.valid('json')
      if ((await oneNote(c.env, org, customerId, noteId)) === null) {
        return c.json({ error: 'not_found' }, 404)
      }
      const applied = await c.env.DB.prepare(
        "UPDATE customer_notes SET kind = 'attention', status = 'draft', body = ?, revision = revision + 1, updated_at = ? " +
          'WHERE organization_id = ? AND customer_id = ? AND id = ? AND revision = ?',
      )
        .bind(input.body, new Date().toISOString(), org, customerId, noteId, input.revision)
        .run()
      if ((applied.meta.changes ?? 0) === 0) return c.json({ error: 'version_conflict' }, 409)
      return c.json(CustomerNote.parse((await oneNote(c.env, org, customerId, noteId)) ?? {}))
    },
  )

  /* --- 来店受付とウォークイン（P5） -------------------------------------- */

  /**
   * 店頭のお客様を受け付ける（LEDGER-WALKIN「受付して台帳に載せる」）。
   *
   * **お名前も電話番号も伺わないうちから受け付けられる**（`customerId` は任意で、
   * あとから `PATCH` で結び直す）。整理番号は**サーバが**店舗 × 来店日（JST）で採る
   * — クライアントに採らせると、2 台の iPad が同じ番号を同時に配る。
   *
   * 受付は `source='walkin'` のご予約を 1 件起こす。起こさないと LEDGER-WALKIN が
   * 台帳に点線で描いた枠が空き枠エンジンから見て空いたままになり、同じ瞬間の
   * お電話のご予約が同じ担当を取れてしまう（`04-api.md` §3.7）。
   *
   * 枠は一意 index ではなく**上限つきの条件付き INSERT** で取る（`db/slot-locks.ts`）。
   * 一意にすると「1 枠 1 件」しか表せず、**担当を決めずに受け付ける 2 人目が、店に
   * 余裕があっても 409 で落ちる**（目の前のお客様を受け付けられない画面ができる）。
   */
  .post('/api/staff/walkins', zValidator('json', WalkinCreate), async (c) => {
    const db = drizzle(c.env.DB)
    const { org, sub } = c.get('auth')
    const input = c.req.valid('json')
    const store = await findStore(db, org, input.storeId)
    if (!store) return c.json({ error: 'not_found' }, 404)

    // 現在時刻はハンドラの入口で 1 回だけ作り、以降は引数で配る。
    const now = new Date()
    const nowIso = now.toISOString()
    const arrivedAt = input.arrivedAt ?? nowIso
    const visitDate = jstVisitDate(arrivedAt)

    // 予約の間隔が決まっていない店舗には枠を置けない（暗黙の既定値を作らない）。
    const rules = (
      await db
        .select()
        .from(storeSlotRules)
        .where(
          and(eq(storeSlotRules.organizationId, org), eq(storeSlotRules.storeId, input.storeId)),
        )
    )[0]
    if (rules === undefined) return c.json({ error: 'not_found' }, 404)

    // ご用件は 4 択か自由記述の**ちょうど一方**（排他は契約が見ている）。
    let purposeLine: BookingPurposeLine | null = null
    if (input.purposeId !== undefined) {
      const found = (
        await db
          .select({ id: visitPurposes.id, durationMinutes: visitPurposes.durationMinutes })
          .from(visitPurposes)
          .where(and(eq(visitPurposes.organizationId, org), eq(visitPurposes.id, input.purposeId)))
      )[0]
      if (found === undefined) return c.json({ error: 'not_found' }, 404)
      purposeLine = { purposeId: found.id, durationMinutes: found.durationMinutes, sortOrder: 0 }
    }

    // 担当・お客様は自分の組織のものだけ。他テナントの id は「無い」として 404。
    const staffMember =
      input.staffId === undefined || input.staffId === null
        ? null
        : ((
            await db
              .select({
                id: staff.id,
                maxParallelReservations: staff.maxParallelReservations,
              })
              .from(staff)
              .where(
                and(
                  eq(staff.organizationId, org),
                  eq(staff.storeId, input.storeId),
                  eq(staff.id, input.staffId),
                ),
              )
          )[0] ?? null)
    if (input.staffId !== undefined && input.staffId !== null && staffMember === null) {
      return c.json({ error: 'not_found' }, 404)
    }
    const customerId = input.customerId ?? null
    if (customerId !== null && (await findLiveCustomer(c.env.DB, org, customerId)) === null) {
      return c.json({ error: 'not_found' }, 404)
    }

    const startsAt = input.startsAt ?? arrivedAt
    const durationMinutes =
      input.durationMinutes ?? purposeLine?.durationMinutes ?? WALKIN_DEFAULT_MINUTES
    const endsAt = new Date(Date.parse(startsAt) + durationMinutes * MS_PER_MINUTE).toISOString()

    // 冪等（`04-api.md` §6.2）。送らない端末は素通りする（送らない再送は 2 件になる）。
    const header = readIdempotencyKey(c.req.header('Idempotency-Key'))
    if (!header.ok) {
      return c.json(
        rejected([
          'Idempotency-Key に使えない文字が入っているため受け付けられません。鍵を作り直して送り直してください。',
        ]),
        400,
      )
    }
    let idempotencyKey: string | null = null
    if (header.key !== null) {
      const started = await beginIdempotency(c.env.DB, {
        organizationId: org,
        scope: 'walkin.create',
        clientKey: header.key,
        requestHash: await requestHash(input),
        now,
      })
      // **再実行しない。**保存した応答（同じ整理番号の同じ 1 件）をそのまま返す。
      if (started.state === 'replay') return c.json(Walkin.parse(started.response))
      if (started.state === 'conflict') return c.json({ error: 'idempotency_conflict' }, 409)
      idempotencyKey = started.key
    }

    const actorId = await actorStaffId(db, org, input.storeId, sub)
    const correlationId = crypto.randomUUID()
    /** 予期しない失敗のときだけ `in_progress` を消す（消すと同じ鍵で選び直せる）。 */
    const release = async (): Promise<void> => {
      if (idempotencyKey !== null) await releaseIdempotency(c.env.DB, idempotencyKey)
    }

    for (let attempt = 1; attempt <= WALKIN_TICKET_ATTEMPTS; attempt += 1) {
      const counters = await readWalkinCounters(c.env.DB, org, input.storeId, visitDate)
      const ticketNo = nextTicketNo(counters.maxTicketNo)
      // その日の 999 番まで出し切った。500 にせず人を呼ぶ（`04-api.md` §5）。
      if (ticketNo === null) {
        await release()
        return c.json({ error: 'code_exhausted' }, 409)
      }
      const walkinId = crypto.randomUUID()
      const reservationId = crypto.randomUUID()
      const walkin = Walkin.parse({
        id: walkinId,
        ticketNo,
        arrivedAt,
        purposeId: input.purposeId ?? null,
        purposeNote: input.purposeNote ?? null,
        customerId,
        reservationId,
        status: 'waiting',
        waitedMinutes: waitedMinutes(arrivedAt, now),
        leftAt: null,
        version: FIRST_VERSION,
      })

      let attempted: ReservationCodeAttempt<boolean>
      try {
        // 予約番号の打ち直し（`reservations` の一意違反）は `withReservationCode` が吸収する。
        attempted = await withReservationCode(c.env.DB, org, now, async (code) => {
          const results = await c.env.DB.batch([
            ...bookingStatements(c.env.DB, {
              organizationId: org,
              storeId: input.storeId,
              reservationId,
              code,
              source: 'walkin',
              startsAt,
              endsAt,
              durationMinutes,
              purposes: purposeLine === null ? [] : [purposeLine],
              staff: staffMember,
              equipment: [],
              slotRules: {
                slotMinutes: rules.slotMinutes,
                cleanupMinutes: rules.cleanupMinutes,
                maxParallel: rules.maxParallel,
              },
              noteCustomer: '',
              noteInternal: '',
              actorId,
              correlationId,
              receptionSessionId: null,
              idempotency:
                idempotencyKey === null ? null : { key: idempotencyKey, response: walkin },
              now,
            }),
            // 受付の 1 行。**枠が取れた予約にだけ当てる**（ガードを外すと、枠を取れて
            // いない受付が整理番号だけ食べて台帳に載る）。
            c.env.DB.prepare(
              'INSERT INTO walk_ins (id, organization_id, store_id, visit_date, ticket_no, arrived_at, purpose_id, purpose_note, customer_id, reservation_id, status, left_at, version, created_at) ' +
                `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting', NULL, ?, ? WHERE ${WALKIN_LOCKED}`,
            ).bind(
              walkinId,
              org,
              input.storeId,
              visitDate,
              ticketNo,
              arrivedAt,
              input.purposeId ?? null,
              input.purposeNote ?? null,
              customerId,
              reservationId,
              FIRST_VERSION,
              nowIso,
              org,
              reservationId,
            ),
            auditRow(c.env.DB, {
              organizationId: org,
              storeId: input.storeId,
              actorId,
              action: 'walkin.created',
              targetType: 'walk_ins',
              targetId: walkinId,
              after: { ticketNo, arrivedAt, reservationId, staffId: staffMember?.id ?? null },
              correlationId,
              occurredAt: nowIso,
              lockedFor: reservationId,
            }),
          ])
          // 1 本目は占有行の INSERT。0 行なら枠は取れていない（1 行も書かれていない）。
          return (results[0]?.meta.changes ?? 0) === 0
        })
      } catch (err) {
        // 整理番号がぶつかった。+1 して採番し直す。**`in_progress` はここで消さない**
        // （消すと打ち直した実行が同じ鍵で `done` を書けなくなる。`04-api.md` §6.2 の④）。
        if (constraintTable(err) === 'walk_ins') continue
        await release()
        throw err
      }

      if (!attempted.ok) {
        await release()
        return c.json({ error: 'code_exhausted' }, 409)
      }
      if (attempted.value) {
        // 同時受付の上限に当たった。鍵を空けて、同じ鍵のまま入れ直せるようにする。
        await release()
        return c.json({ error: 'slot_taken' }, 409)
      }
      return c.json(walkin)
    }

    // 5 回打ち直しても採れなかった。ここだけが「再試行で解けない失敗」である。
    await release()
    return c.json({ error: 'code_exhausted' }, 409)
  })

  /**
   * その日のウォークイン（LEDGER-STAFF「ご来店お待ち 2名」/ LEDGER-WALKIN「いまお待ち 2名」）。
   * **`date` は必須**で、日付の条件を落とすと昨日帰られたお客様が今朝の行列に残る。
   */
  .get('/api/staff/walkins', zValidator('query', WalkinListQuery), async (c) => {
    const org = c.get('auth').org
    const { storeId, date, status } = c.req.valid('query')
    const now = new Date()
    const filter = status.length === 0 ? '' : ` AND status IN (${status.map(() => '?').join(',')})`
    const found = await c.env.DB.prepare(
      `SELECT ${WALKIN_COLUMNS} FROM walk_ins ` +
        `WHERE organization_id = ? AND store_id = ? AND visit_date = ?${filter} ` +
        'ORDER BY arrived_at, ticket_no',
    )
      .bind(org, storeId, date, ...status)
      .all<WalkinRecord>()
    return c.json(Walkin.array().parse(found.results.map((row) => toWalkin(row, now))))
  })

  /**
   * 受け付けたあとの更新（お客様の紐づけ・担当決め・状態）。
   *
   * 顧客の紐づけと担当決めを 2 台の iPad が同時に触るので、版が合わなければ 409 にする。
   * **お客様を書いたら予約側にも同じお客様を書く** — 書かないと、その来店が
   * `customers.visit_count` の数え直し（`reservations.status='done'` の件数）から漏れ、
   * 「紐づけたのに来店回数が増えない」になる。
   */
  .patch('/api/staff/walkins/:walkinId', zValidator('json', WalkinPatch), async (c) => {
    const org = c.get('auth').org
    const walkinId = c.req.param('walkinId')
    const input = c.req.valid('json')
    const current = await findWalkin(c.env.DB, org, walkinId)
    if (current === null) return c.json({ error: 'not_found' }, 404)
    if (
      input.customerId !== undefined &&
      (await findLiveCustomer(c.env.DB, org, input.customerId)) === null
    ) {
      return c.json({ error: 'not_found' }, 404)
    }
    // 付け替え先のご予約も自分の組織のものだけ。宛先の無い `reservation_id` を書けると、
    // 受付履歴の詳細と盤面がその来店へ二度と辿り着けなくなる。
    if (input.reservationId !== undefined) {
      const found = await c.env.DB.prepare(
        'SELECT id FROM reservations WHERE organization_id = ? AND id = ?',
      )
        .bind(org, input.reservationId)
        .first<{ id: string }>()
      if (found === null) return c.json({ error: 'not_found' }, 404)
    }

    const now = new Date()
    const nowIso = now.toISOString()
    const sets = ['version = version + 1']
    const params: unknown[] = []
    if (input.customerId !== undefined) {
      sets.push('customer_id = ?')
      params.push(input.customerId)
    }
    if (input.status !== undefined) {
      sets.push('status = ?')
      params.push(input.status)
    }
    if (input.reservationId !== undefined) {
      sets.push('reservation_id = ?')
      params.push(input.reservationId)
    }

    /**
     * 版の条件を 2 文目以降にも配る。**1 文目が 0 行でもバッチは止まらない**ので、
     * 配らないと「409 を返しながらお客様だけ書き換える」形になる。
     * 1 文目が版を +1 したあとなので、条件は `version = <送られた版> + 1` である。
     */
    const applied = `EXISTS (SELECT 1 FROM walk_ins WHERE organization_id = ? AND id = ? AND version = ?)`
    const guard = [org, walkinId, input.version + 1]
    const statements: [Statement, ...Statement[]] = [
      c.env.DB.prepare(
        `UPDATE walk_ins SET ${sets.join(', ')} WHERE organization_id = ? AND id = ? AND version = ?`,
      ).bind(...params, org, walkinId, input.version),
    ]
    if (input.staffId !== undefined) {
      // 担当を決め直したら予約の割当も動かす（台帳と受付で担当が食い違わない）。
      statements.push(
        c.env.DB.prepare(
          "UPDATE reservation_assignments SET target_id = ? WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff' AND " +
            applied,
        ).bind(input.staffId, org, current.reservationId, ...guard),
      )
    }
    if (input.customerId !== undefined) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE reservations SET customer_id = ?, updated_at = ? WHERE organization_id = ? AND id = ? AND ${applied}`,
        ).bind(input.customerId, nowIso, org, current.reservationId, ...guard),
      )
      statements.push(bumpVisitCounters(c.env.DB, org, input.customerId, now))
    }
    const results = await c.env.DB.batch(statements)
    if ((results[0]?.meta.changes ?? 0) === 0) return c.json({ error: 'version_conflict' }, 409)

    const saved = await findWalkin(c.env.DB, org, walkinId)
    if (saved === null) return c.json({ error: 'not_found' }, 404)
    return c.json(Walkin.parse(toWalkin(saved, now)))
  })

  /**
   * 工程を進める（RECEPTION-JOURNEY の欄の中の操作）。**追記だけ**で、
   * UPDATE / DELETE を 1 文も発行しない。訂正は打ち消しの行を足す。
   *
   * 同じバッチで書くのは、記録の 1 行と、その記録で動く「いまの姿」
   * （`reservations.status` / `walk_ins.status` / `customers.visit_count`）と監査である。
   * 別の往復に割ると「盤面に載っているのに `confirmed` のまま」を作れてしまう。
   */
  .post('/api/staff/visits', zValidator('json', VisitEventInput), async (c) => {
    const db = drizzle(c.env.DB)
    const { org, sub } = c.get('auth')
    const input = c.req.valid('json')
    const store = await findStore(db, org, input.storeId)
    if (!store) return c.json({ error: 'not_found' }, 404)

    const now = new Date()
    const occurredAt = input.occurredAt ?? now.toISOString()

    /*
     * 対象は自分の組織のものだけ。他テナントの id は「無い」として 404。
     *
     * **同じ組織の別の店舗も 404 にする。**`visit_events.store_id` には `input.storeId` が
     * そのまま入り、盤面は `store_id` で絞って読む。対象の店舗と食い違ったまま書けると、
     * 記録は残っているのにどの盤面にも出ない行ができる（お客様が画面から消える）。
     */
    const walkin =
      input.subjectType === 'walkin' ? await findWalkin(c.env.DB, org, input.subjectId) : null
    const subject =
      input.subjectType === 'walkin'
        ? walkin === null
          ? null
          : { reservationId: walkin.reservationId, storeId: walkin.storeId }
        : await c.env.DB.prepare(
            'SELECT id AS reservationId, store_id AS storeId FROM reservations WHERE organization_id = ? AND id = ?',
          )
            .bind(org, input.subjectId)
            .first<{ reservationId: string; storeId: string }>()
    if (subject === null || subject.storeId !== input.storeId) {
      return c.json({ error: 'not_found' }, 404)
    }
    const reservationId = subject.reservationId

    // 進めた人も自分の組織・自分の店舗の在籍者だけ（`POST /api/staff/walkins` と同じ検査）。
    // 他テナントの id を通すと、監査の `after_json` と `visit_events.staff_id` に
    // 誰にも辿れない id が残る。
    if (input.staffId !== undefined) {
      const found = await db
        .select({ id: staff.id })
        .from(staff)
        .where(
          and(
            eq(staff.organizationId, org),
            eq(staff.storeId, input.storeId),
            eq(staff.id, input.staffId),
          ),
        )
      if (found[0] === undefined) return c.json({ error: 'not_found' }, 404)
    }

    /**
     * 受付は**点の記録**なので 2 行目を積まない。積むと「そのあとの変更」に
     * 「ご来店を受け付けました」が 2 度並び、どちらが本当の受付時刻か読めなくなる。
     */
    if (input.stage === 'received') {
      const already = await c.env.DB.prepare(
        "SELECT id, subject_type AS subjectType, subject_id AS subjectId, stage, occurred_at AS occurredAt, staff_id AS staffId, note FROM visit_events WHERE organization_id = ? AND subject_type = ? AND subject_id = ? AND stage = 'received' ORDER BY occurred_at LIMIT 1",
      )
        .bind(org, input.subjectType, input.subjectId)
        .first<{
          id: string
          subjectType: string
          subjectId: string
          stage: string
          occurredAt: string
          staffId: string | null
          note: string | null
        }>()
      if (already !== null) return c.json(VisitEvent.parse(already))
    }

    /*
     * 来店回数を数え直すお客様は**ご予約の側から読む**。おまとめ（P4）は
     * `reservations.customer_id` を残す側へ寄せるので、ウォークインの側を先に読むと
     * まとめられて消えた id を掴み、退店のときにその行の来店回数を 0 に書き戻して
     * 残す側は 1 件も増えない（AC-RECEP-23 がおまとめのあとだけ崩れる）。
     * `PATCH /api/staff/walkins` は両方へ同じお客様を書くので、ご予約の側が必ず新しい。
     */
    const customerId =
      (
        await c.env.DB.prepare(
          'SELECT customer_id AS customerId FROM reservations WHERE organization_id = ? AND id = ?',
        )
          .bind(org, reservationId)
          .first<{ customerId: string | null }>()
      )?.customerId ??
      walkin?.customerId ??
      null

    const eventId = crypto.randomUUID()
    const correlationId = crypto.randomUUID()
    const actorId = await actorStaffId(db, org, input.storeId, sub)
    const statements: [Statement, ...Statement[]] = [
      c.env.DB.prepare(
        'INSERT INTO visit_events (id, organization_id, store_id, subject_type, subject_id, stage, occurred_at, staff_id, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        eventId,
        org,
        input.storeId,
        input.subjectType,
        input.subjectId,
        input.stage,
        occurredAt,
        input.staffId ?? null,
        input.note ?? null,
        now.toISOString(),
      ),
    ]

    // 受け付けた事実はご予約の側にも書く（盤面に載っているのに `confirmed` を作らない）。
    if (input.stage === 'received') {
      statements.push(
        c.env.DB.prepare(
          "UPDATE reservations SET status = 'arrived', updated_at = ? WHERE organization_id = ? AND id = ? AND status = 'confirmed'",
        ).bind(occurredAt, org, reservationId),
      )
    }
    if (SERVING_STAGES.has(input.stage)) {
      statements.push(
        c.env.DB.prepare(
          "UPDATE reservations SET status = 'serving', updated_at = ? WHERE organization_id = ? AND id = ? AND status IN ('confirmed','arrived')",
        ).bind(occurredAt, org, reservationId),
      )
      if (walkin !== null) {
        statements.push(
          c.env.DB.prepare(
            "UPDATE walk_ins SET status = 'serving', version = version + 1 WHERE organization_id = ? AND id = ? AND status = 'waiting'",
          ).bind(org, input.subjectId),
        )
      }
    }
    if (input.stage === 'left') {
      /*
       * 退店。**接客に入っていた来店だけを `done` にする** — お待ちのまま帰られた行を
       * `done` に混ぜると来店回数が実態より増え、待ち時間の中央値は良い側へずれる。
       * `walk_ins.status='left'` は待ちの帯から外すためで、受付履歴には残り続ける。
       */
      statements.push(
        c.env.DB.prepare(
          "UPDATE reservations SET status = 'done', updated_at = ? WHERE organization_id = ? AND id = ? AND status IN ('arrived','serving')",
        ).bind(occurredAt, org, reservationId),
      )
      if (walkin !== null) {
        statements.push(
          c.env.DB.prepare(
            "UPDATE walk_ins SET status = 'left', left_at = ?, version = version + 1 WHERE organization_id = ? AND id = ?",
          ).bind(occurredAt, org, input.subjectId),
        )
      }
      // 顧客が未特定の来店は数えない（結び直したときに数え直される）。
      if (customerId !== null) {
        statements.push(bumpVisitCounters(c.env.DB, org, customerId, now))
      }
    }
    statements.push(
      auditRow(c.env.DB, {
        organizationId: org,
        storeId: input.storeId,
        actorId,
        action: 'visit.stage.changed',
        targetType: input.subjectType === 'walkin' ? 'walk_ins' : 'reservations',
        targetId: input.subjectId,
        after: { stage: input.stage, occurredAt, staffId: input.staffId ?? null },
        correlationId,
        occurredAt,
      }),
    )
    await c.env.DB.batch(statements)

    return c.json(
      VisitEvent.parse({
        id: eventId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        stage: input.stage,
        occurredAt,
        staffId: input.staffId ?? null,
        note: input.note ?? null,
      }),
    )
  })

  /**
   * 来店受付ボード（RECEPTION-JOURNEY「ご来店中 4名」）。
   *
   * 読むだけの面である。工程は `visit_events` の**追記だけ**の並びから毎回組み立てる
   * （`domain/visit-board.ts` の `buildBoard`）ので、同じ日の同じ記録からは何度でも
   * 同じ盤面が出る。**`serverNow` を必ず載せる** — 「お待たせ中 18分」を端末の時計で
   * 描かせると、iPad ごとに違う分数が出る。
   *
   * `storeId` は**絞り込みにだけ**使い、認可の根拠にしない（店舗をまたぐ閲覧を作らない。
   * `design/09-open-questions.md` Q-04 のいまの前提）。他テナントの店舗を指しても
   * 403 でも 404 でもなく、単に 1 行も出ない。
   */
  .get('/api/staff/visits/board', zValidator('query', VisitBoardQuery), async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const { storeId, date, scope } = c.req.valid('query')
    const now = new Date()
    const fromIso = toInstant(date, 0)
    const toIso = toInstant(date, MINUTES_PER_DAY)

    const [day, walkinRows, eventRows] = await Promise.all([
      readLedgerDay(db, { organizationId: org, storeId, date }),
      c.env.DB.prepare(
        `SELECT ${WALKIN_COLUMNS} FROM walk_ins WHERE organization_id = ? AND store_id = ? AND visit_date = ? ORDER BY ticket_no`,
      )
        .bind(org, storeId, date)
        .all<WalkinRecord>(),
      c.env.DB.prepare(
        'SELECT subject_type AS subjectType, subject_id AS subjectId, stage, occurred_at AS occurredAt ' +
          'FROM visit_events WHERE organization_id = ? AND store_id = ? AND occurred_at >= ? AND occurred_at < ? ' +
          'ORDER BY occurred_at',
      )
        .bind(org, storeId, fromIso, toIso)
        .all<{ subjectType: string; subjectId: string; stage: VisitStage; occurredAt: string }>(),
    ])

    // 帯のお名前と来店回数は台帳と同じ 1 か所から引く（画面ごとに違う数字を出さない）。
    const bands = await customerBands(
      c.env.DB,
      org,
      day.reservations.map((row) => row.id),
    )
    const walkinOf = new Map(walkinRows.results.map((row) => [row.reservationId, row]))
    const equipmentOf = new Map(day.equipment.map((unit) => [unit.id, unit]))
    const labels = new Map<string, string[]>()
    for (const purpose of [...day.purposes].sort((a, b) => a.sortOrder - b.sortOrder)) {
      labels.set(purpose.reservationId, [
        ...(labels.get(purpose.reservationId) ?? []),
        purpose.nameShort,
      ])
    }

    const rows: BoardSubjectRow[] = []
    for (const reservation of day.reservations) {
      // 取消・ご来店なしは盤面に出さない（お帰りになった行を待たせているように見せない）。
      if (reservation.status === 'cancelled' || reservation.status === 'no_show') continue
      const walkin = walkinOf.get(reservation.id) ?? null
      const band = bands.get(reservation.id) ?? null
      const assigned = day.assignments.filter((row) => row.reservationId === reservation.id)
      const unit = assigned.find((row) => row.kind === 'equipment' && row.targetId !== null)
      const attendant = assigned.find((row) => row.kind === 'staff')
      rows.push({
        subjectType: walkin === null ? 'reservation' : 'walkin',
        subjectId: walkin?.id ?? reservation.id,
        customerName: band?.customerName ?? null,
        ticketNo: walkin?.ticketNo ?? null,
        visitCount: band?.visitCount ?? null,
        // 受け付けただけで工程の記録がまだ 1 行も無いウォークインは、この時刻が
        // 受付の記録の代わりになる（`buildBoard` が補う）。
        arrivedAt: walkin?.arrivedAt ?? null,
        purposeLabel: labels.get(reservation.id)?.join('・') ?? walkin?.purposeNote ?? '',
        /*
         * 「次にやること」は押さえた設備から出す（AC-RECEP-12 の「視力測定機 A」）。
         * 設備を押さえていないご予約には出さない — 出すと、担当も設備も決まっていない
         * 欄に「次にやること」だけが並び、押しても何も始められない。
         */
        next:
          unit === undefined || unit.targetId === null
            ? null
            : {
                stage: 'measuring',
                label: equipmentOf.get(unit.targetId)?.name ?? '',
                staffId: attendant?.targetId ?? null,
                equipmentId: unit.targetId,
              },
      })
    }

    return c.json(
      VisitBoard.parse(
        buildBoard(
          rows,
          eventRows.results.map((row) => ({
            subjectType: row.subjectType === 'walkin' ? 'walkin' : 'reservation',
            subjectId: row.subjectId,
            stage: row.stage,
            occurredAt: row.occurredAt,
          })),
          {
            date,
            now,
            scope,
            shifts: day.shifts.map((shift) => ({ ...shift, date })),
            maintenances: day.maintenance.map((band) => ({
              equipmentId: band.equipmentId,
              startsAt: band.startsAt,
              endsAt: band.endsAt,
            })),
          },
        ),
      ),
    )
  })

  /**
   * 受付履歴（HISTORY-LIST「46件」/ HISTORY-EMPTY）。
   *
   * 一覧の元は「その日にご来店予定のご予約 ＋ その日のウォークイン ＋ 破棄した受付」で、
   * **`reception_sessions` だけを読まない** — スタッフが受け付けない Web のご予約は
   * 受付セッションを持たないので、セッションだけを読むとその行が一覧から丸ごと落ちる
   * （お客様からのお問い合わせに答えられない受付ができる）。
   *
   * 0 件のときは条件を 1 つ緩めた候補を**同じ応答に**同梱する。別の呼び出しで取りに行くと、
   * 0 件の画面がその往復ぶんだけ遅れて出る。候補の件数は推定せず、同じ行の集合を
   * 同じ `filterHistory` で数えた値である（押す前と押したあとで件数が食い違わない）。
   *
   * **閲覧そのものを監査に 1 行残す。**度数と録音へ届く経路なので、権限で閉じる代わりに
   * 誰が読んだかを残す（`design/09-open-questions.md` Q-03 のいまの前提）。
   */
  .get('/api/staff/reception-sessions', async (c) => {
    const db = drizzle(c.env.DB)
    const { org, sub } = c.get('auth')
    const query = validQuery(c, ReceptionHistoryQuery, c.req.query())
    const now = new Date()

    /*
     * 読む窓は「絞り込みの期間」と「今月」の広いほう。緩和候補（`buildRelaxations`）が
     * 今月まで広げた件数を**実際に数える**ので、そのぶんの行が手元に無いと
     * 「12件」と書いた操作を押して 0 件の画面へ戻る。
     */
    const today = toJstDateString(now.toISOString())
    const monthStart = `${today.slice(0, 7)}-01`
    const from = query.from < monthStart ? query.from : monthStart
    const to = query.to > today ? query.to : today
    const fromIso = toInstant(from, 0)
    const toIso = toInstant(to, MINUTES_PER_DAY)
    const storeFilter = query.storeId === undefined ? '' : ' AND r.store_id = ?'
    const storeParams = query.storeId === undefined ? [] : [query.storeId]

    const [entries, attendants, discarded] = await Promise.all([
      c.env.DB.prepare(
        'SELECT r.id AS reservationId, r.starts_at AS startsAt, r.status AS reservationStatus, ' +
          'r.created_at AS createdAt, w.id AS walkinId, w.ticket_no AS ticketNo, ' +
          'w.arrived_at AS arrivedAt, c.name AS customerName, c.kana AS customerKana, ' +
          'c.visit_count AS visitCount, s.id AS sessionId, s.started_at AS sessionStartedAt, ' +
          's.actor_id AS actorId, s.outcome AS outcome ' +
          'FROM reservations r ' +
          'LEFT JOIN walk_ins w ON w.organization_id = r.organization_id AND w.reservation_id = r.id ' +
          'LEFT JOIN customers c ON c.organization_id = r.organization_id AND c.id = r.customer_id ' +
          'LEFT JOIN reception_sessions s ON s.organization_id = r.organization_id AND s.reservation_id = r.id ' +
          `WHERE r.organization_id = ? AND r.starts_at >= ? AND r.starts_at < ?${storeFilter}`,
      )
        .bind(org, fromIso, toIso, ...storeParams)
        .all<HistoryEntryRecord>(),
      c.env.DB.prepare(
        'SELECT a.reservation_id AS reservationId, a.target_id AS targetId ' +
          'FROM reservation_assignments a ' +
          'JOIN reservations r ON r.organization_id = a.organization_id AND r.id = a.reservation_id ' +
          "WHERE a.organization_id = ? AND a.kind = 'staff' AND a.target_id IS NOT NULL " +
          `AND r.starts_at >= ? AND r.starts_at < ?${storeFilter}`,
      )
        .bind(org, fromIso, toIso, ...storeParams)
        .all<{ reservationId: string; targetId: string }>(),
      c.env.DB.prepare(
        'SELECT id AS sessionId, started_at AS startedAt, actor_id AS actorId, outcome ' +
          'FROM reception_sessions ' +
          "WHERE organization_id = ? AND reservation_id IS NULL AND outcome = 'discarded' " +
          'AND started_at >= ? AND started_at < ?' +
          (query.storeId === undefined ? '' : ' AND store_id = ?'),
      )
        .bind(org, fromIso, toIso, ...storeParams)
        .all<{ sessionId: string; startedAt: string; actorId: string | null; outcome: string }>(),
    ])

    const staffIdsOf = new Map<string, string[]>()
    for (const row of attendants.results) {
      staffIdsOf.set(row.reservationId, [
        ...(staffIdsOf.get(row.reservationId) ?? []),
        row.targetId,
      ])
    }
    const rows: ReceptionHistoryRow[] = entries.results.map((row) => ({
      // 行の識別子は受付セッション → ご予約 → ウォークイン の順に決まる。
      entryId: row.sessionId ?? row.reservationId,
      sessionId: row.sessionId,
      // 並びは「お着きになった順」。ウォークインは受付時刻、ご予約は予定時刻で並ぶ。
      startedAt: row.arrivedAt ?? row.sessionStartedAt ?? row.startsAt,
      // 「中村 彩 が 8月20日（木）14:32 に電話で受け付け」の時刻。**絞り込みには使わない。**
      receivedAt: row.sessionStartedAt ?? row.arrivedAt ?? row.createdAt,
      visitDate: jstVisitDate(row.startsAt),
      customerName: row.customerName,
      customerKana: row.customerKana,
      ticketNo: row.ticketNo,
      visitCount: row.visitCount,
      staffIds: staffIdsOf.get(row.reservationId) ?? [],
      receivedByStaffId: row.actorId,
      outcome: row.outcome === 'booked' || row.outcome === 'discarded' ? row.outcome : null,
      reservationStatus: ReservationStatus.parse(row.reservationStatus),
    }))
    // 破棄した受付は予約を持たないので、開始した日の暦日で一覧に混ざる。
    for (const row of discarded.results) {
      rows.push({
        entryId: row.sessionId,
        sessionId: row.sessionId,
        startedAt: row.startedAt,
        receivedAt: row.startedAt,
        visitDate: jstVisitDate(row.startedAt),
        customerName: null,
        customerKana: null,
        ticketNo: null,
        visitCount: null,
        staffIds: [],
        receivedByStaffId: row.actorId,
        outcome: 'discarded',
        reservationStatus: null,
      })
    }

    const view = buildHistoryList(
      rows,
      {
        from: query.from,
        to: query.to,
        ...(query.staffId === undefined ? {} : { staffId: query.staffId }),
        ...(query.status.length === 0 ? {} : { status: query.status }),
        ...(query.name === undefined ? {} : { name: query.name }),
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      },
      now,
    )

    // 読んだ事実を 1 行残す。店舗が絞られていなければ組織そのものを対象に置く
    // （`target_id` は NOT NULL なので、束ねる対象を必ず 1 つ書く）。
    await auditRow(c.env.DB, {
      organizationId: org,
      storeId: query.storeId ?? null,
      actorId: query.storeId === undefined ? null : await actorStaffId(db, org, query.storeId, sub),
      action: 'reception.history.viewed',
      targetType: 'reception_sessions',
      targetId: query.storeId ?? org,
      after: { from: query.from, to: query.to, total: view.total },
      correlationId: crypto.randomUUID(),
      occurredAt: now.toISOString(),
    }).run()

    return c.json(ReceptionHistoryList.parse(view))
  })

  /**
   * 受付 1 件（HISTORY-LIST の右）。パスの値は **`entryId`** で、
   * `reception_sessions` → `reservations` → `walk_ins` の順に引く。
   *
   * 「そのあとの変更」は `audit_events` を古い順に組み立てる。ウォークインは
   * 受付の監査が `walk_ins` に、工程の監査が同じく `walk_ins` に付くので、
   * **ご予約の id とウォークインの id の両方**で引く（片方だけだと受付の行が消える）。
   * `recording` は P7（`010-recording`）が埋めるまで常に null である。
   */
  .get('/api/staff/reception-sessions/:sessionId', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const entryId = c.req.param('sessionId')

    let session = await findReceptionSession(db, org, entryId)
    let reservationId = session?.reservationId ?? null
    if (session === null) {
      const reservation = await c.env.DB.prepare(
        'SELECT id FROM reservations WHERE organization_id = ? AND id = ?',
      )
        .bind(org, entryId)
        .first<{ id: string }>()
      reservationId =
        reservation?.id ?? (await findWalkin(c.env.DB, org, entryId))?.reservationId ?? null
      if (reservationId !== null) {
        const rows = await db
          .select()
          .from(receptionSessions)
          .where(
            and(
              eq(receptionSessions.organizationId, org),
              eq(receptionSessions.reservationId, reservationId),
            ),
          )
        session = rows[0] ?? null
      }
    }
    if (session === null && reservationId === null) return c.json({ error: 'not_found' }, 404)

    const walkin =
      reservationId === null
        ? null
        : await c.env.DB.prepare(
            `SELECT ${WALKIN_COLUMNS} FROM walk_ins WHERE organization_id = ? AND reservation_id = ?`,
          )
            .bind(org, reservationId)
            .first<WalkinRecord>()
    const reservation =
      reservationId === null ? null : await reservationDetailOf(c.env, org, reservationId)
    const receivedAt =
      session?.startedAt ?? walkin?.arrivedAt ?? reservation?.createdAt ?? new Date().toISOString()

    const targets = [reservationId, walkin?.id ?? null].filter((id): id is string => id !== null)
    const changes =
      targets.length === 0
        ? { results: [] as AuditChangeRecord[] }
        : await c.env.DB.prepare(
            'SELECT a.action, a.before_json AS beforeJson, a.after_json AS afterJson, a.occurred_at AS occurredAt, ' +
              's.display_name AS actorName FROM audit_events a ' +
              'LEFT JOIN staff s ON s.organization_id = a.organization_id AND s.id = a.actor_id ' +
              `WHERE a.organization_id = ? AND a.target_id IN (${targets.map(() => '?').join(',')}) ` +
              'ORDER BY a.occurred_at, a.id',
          )
            .bind(org, ...targets)
            .all<AuditChangeRecord>()

    const receivedBy =
      session?.actorId === undefined || session?.actorId === null
        ? null
        : ((
            await db
              .select({ displayName: staff.displayName })
              .from(staff)
              .where(and(eq(staff.organizationId, org), eq(staff.id, session.actorId)))
          )[0]?.displayName ?? null)

    return c.json(
      ReceptionHistoryDetail.parse({
        entryId,
        sessionId: session?.id ?? null,
        reservation,
        receivedBy,
        receivedAt,
        changes: changes.results
          .map((row) => ({
            occurredAt: row.occurredAt,
            what: changeLabel(row.action, row.afterJson, row.beforeJson),
            actorName: row.actorName,
          }))
          .filter((row) => row.what !== null),
        recording: null,
      }),
    )
  })

// web 側はこの型だけを（type-only で）読み、`hc<AppType>` のクライアントを作る。
export type AppType = typeof routes

export default app
