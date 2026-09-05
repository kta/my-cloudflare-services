import {
  Alert,
  AlertList,
  AlertListQuery,
  AlertPatch,
  AlertReadAllInput,
  AlertReadAllResult,
  AnalyticsQuery,
  AnalyticsReport,
  AnalyticsRollupRequest,
  AnalyticsRollupResult,
  AnalyticsTargets,
  AuditEvent,
  AuditEventList,
  AuditSearchQuery,
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
  LoginRequest,
  LoginResponse,
  MaintenanceQuery,
  NotificationJob,
  NotificationResult,
  OrganizationSync,
  PinSetResult,
  type Plan,
  PublicAvailabilityQuery,
  PublicAvailabilityResponse,
  PublicBookingCreate,
  PublicBookingResult,
  PublicReservationCancel,
  PublicReservationChange,
  PublicReservationChangeResult,
  PublicReservationMutationResult,
  PublicReservationStatus,
  PublicReservationVerification,
  PublicReservationVerificationResult,
  PublicStoreDetail,
  PublicStorePurpose,
  PublicStoreSearchQuery,
  PublicStoreSummary,
  PurposeListQuery,
  PurposeOrderInput,
  PurposeRequirementsInput,
  ReauthInput,
  ReceptionHistoryDetail,
  ReceptionHistoryList,
  ReceptionHistoryQuery,
  ReceptionSession,
  ReceptionSessionClose,
  ReceptionSessionDraft,
  ReceptionSessionDraftPatch,
  ReceptionSessionStart,
  Recording,
  RecordingContentType,
  RecordingCreate,
  RecordingHoldInput,
  RecordingList,
  RecordingListQuery,
  RecordingPlaybackTicket,
  RecordingPurgeRequest,
  RecordingPurgeResult,
  RecordingRetainedError,
  type RecordingState,
  RecordingStatePatch,
  RefreshRequest,
  RefreshResponse,
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
  StaffPinInput,
  StaffReservationCreate,
  StaffShift,
  StaffShiftQuery,
  StaffShiftsInput,
  StaffSkillsInput,
  Store,
  StoreDetail,
  StoreIdQuery,
  StoreMembership,
  StorePatch,
  type StorePermission,
  Terminal,
  TerminalInput,
  TerminalListQuery,
  TerminalPatch,
  TerminalSession,
  TerminalSessionStart,
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
  WebBookingReviewInput,
  WebBookingSettings,
  WebBookingSettingsInput,
  WebPreviewQuery,
  WebPreviewResult,
  WebPublicationApplyRequest,
  WebPublicationApplyResult,
} from '@app/contracts'
import {
  type AuthVariables,
  hashStretched,
  internalAuth,
  type OrgResolver,
  requireActiveOrg,
  signAccessToken,
  stretchPin,
  tenantAuth,
  toJstDateString,
  verifyStretched,
} from '@app/shared'
import type {
  D1Database,
  D1PreparedStatement,
  Fetcher,
  KVNamespace,
  R2Bucket,
  ScheduledController,
} from '@cloudflare/workers-types'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm'
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { except } from 'hono/combine'
import { getCookie, setCookie } from 'hono/cookie'
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
  terminals,
  visitPurposes,
  webBookingSettings,
} from './db/schema'
import { slotLockRequests, slotLockStatements, UNASSIGNED_TARGET_KEY } from './db/slot-locks'
import { analyticsStoredMetrics, buildAnalyticsReport } from './domain/analytics-report'
import {
  type AnalyticsReservation,
  type AnalyticsVisitEvent,
  rollupAnalyticsDay,
} from './domain/analytics-rollup'
import { resolveActor } from './domain/audit'
import {
  type AvailabilityInput,
  computeAvailability,
  evaluateSlot,
  expandToSlotStarts,
  type HoldOccupancy,
  type SlotResult,
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
import {
  failureKey,
  hashConfirmationKey,
  hashManagementCode,
  isManagementCodeLocked,
  isShortLivedFresh,
  issueConfirmationKey,
  issueManagementCode,
  MANAGEMENT_CODE_FAILURE_TTL_SECONDS,
  MANAGEMENT_CODE_RETRY_AFTER_SECONDS,
  shortLivedExpiresAt,
  shortLivedKey,
  verifyManagementCode,
} from './domain/management-code'
import {
  isPinLocked,
  isWeakPin,
  nextFailureState,
  parsePinFailure,
  pinFailureKey,
} from './domain/pin'
import { issueTicket, verifyTicket } from './domain/playback'
import { buildHistoryList, type ReceptionHistoryRow } from './domain/reception-history'
import { nextRecordingCode, nextState, r2KeyFor, uploadFailedAlert } from './domain/recording'
import { buildCancelBatch, buildChangeBatch } from './domain/reservation-change'
import {
  type RelaxationCounts,
  type ReservationSearchInput,
  type ReservationSearchQueryLike,
  relaxationsFor,
  resolveSearch,
} from './domain/reservation-search'
import { canDelete, isStaleUpload, retainUntilFor, staleUploadBefore } from './domain/retention'
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
import {
  expiresAtFrom,
  isOnline,
  sessionAuthorizationAt,
  sharedExpiresAtFrom,
} from './domain/terminal-session'
import { type BoardSubjectRow, buildBoard, planBoardSteps } from './domain/visit-board'
import { jstVisitDate, nextTicketNo, waitedMinutes } from './domain/walkin'
import {
  autoCancelledAlert,
  bumpPublicCode,
  changeDeadlineAt,
  isChangeDeadlinePassed,
  nextPublicCode,
  type PublishablePurpose,
  requiresApproval,
  resolvePublication,
  shouldAutoCancel,
  type WebBookingSettingsRow,
  type WebWindow,
  webBookingCodeMonth,
} from './domain/web-booking'

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
  /** 認証の正本。初回ログイン・refresh・本人PIN照合はadminへ委譲する。 */
  ADMIN: Fetcher
  /** /api/internal/* を守る共有鍵（admin からの service binding 呼び出し）。 */
  INTERNAL_KEY: string
  /** アクセス JWT の HS256 署名鍵。admin（認証の正本）と同じ値。 */
  JWT_SECRET: string
  /** PINハッシュ用のpepper。本番はwrangler secret、devだけ.dev.vars。 */
  AUTH_PEPPER: string
  /**
   * お客様のご予約ページの公開ドメイン（`eyex.jp`）。SETTINGS-WEB の「ご案内のページ」を
   * `stores.slug` と繋いで組み立てるためだけに使う。**この値を表に持たない。**
   */
  PUBLIC_WEB_ORIGIN?: string
  /** credential 無しの dev トークングラントを開ける。本番では設定しない。 */
  AUTH_DEV_GRANT?: string
  /** integration test の基準時刻。本番では設定せず、実時刻を使う。 */
  TEST_NOW?: string
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
function requireStorePermission(
  perm: StorePermission,
  input: { storeIdFrom?: 'param' | 'query' } = {},
): MiddlewareHandler<Env> {
  return async (c, next) => {
    const db = drizzle(c.env.DB)
    const { org, sub } = c.get('auth')
    const storeId: string | undefined =
      input.storeIdFrom === 'query' ? c.req.query('storeId') : c.req.param('storeId')
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
 * 責任の残る操作は、同じJWTでも生きた個人モードの端末セッションを要求する。
 *
 * 端末機能より前からある API は、端末をまだ登録していない店舗でも使い続けられるよう、
 * `whenTerminalIsActive` のときだけヘッダー無しを従来の個人操作として扱う。新しい端末 UI は
 * `domainFetch()` が必ずヘッダーを付けるため、共有端末からの責任操作はここで確実に止まる。
 */
const TERMINAL_SESSION_TOKEN = /^[A-Za-z0-9_-]{64,128}$/

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sessionCredential(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(48))
  const token = base64Url(bytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return { token, hash: base64Url(new Uint8Array(digest)) }
}

async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return base64Url(new Uint8Array(digest))
}

type AuthenticatedTerminalSession = {
  id: string
  storeId: string
  terminalId: string
  staffId: string | null
  mode: 'shared' | 'personal'
  credentialHash: string
  startedAt: string
  expiresAt: string
  authorization: 'shared' | 'personal'
}

function terminalSessionInvalid(c: Context<Env>): never {
  throw new HTTPException(403, {
    res: c.json({ error: 'terminal_session_invalid' }, 403),
  })
}

async function authenticatedTerminalSession(
  c: Context<Env>,
  scope: { terminalId?: string; storeId?: string; sessionId?: string } = {},
): Promise<AuthenticatedTerminalSession> {
  const terminalId = c.req.header('x-terminal-id')
  const token = c.req.header('x-terminal-session')
  if (terminalId === undefined || token === undefined || !TERMINAL_SESSION_TOKEN.test(token)) {
    return terminalSessionInvalid(c)
  }
  if (scope.terminalId !== undefined && terminalId !== scope.terminalId) {
    return terminalSessionInvalid(c)
  }
  const credentialHash = await hashSessionToken(token)
  const clauses = [
    's.organization_id = ?',
    's.terminal_id = ?',
    's.credential_hash = ?',
    's.revoked_at IS NULL',
    "t.is_active = '1'",
  ]
  const params: unknown[] = [c.get('auth').org, terminalId, credentialHash]
  if (scope.storeId !== undefined) {
    clauses.push('s.store_id = ?')
    params.push(scope.storeId)
  }
  if (scope.sessionId !== undefined) {
    clauses.push('s.id = ?')
    params.push(scope.sessionId)
  }
  const row = await c.env.DB.prepare(
    'SELECT s.id, s.store_id AS storeId, s.terminal_id AS terminalId, s.staff_id AS staffId, s.mode, s.credential_hash AS credentialHash, s.started_at AS startedAt, s.expires_at AS expiresAt, s.revoked_at AS revokedAt ' +
      'FROM terminal_sessions s INNER JOIN terminals t ON t.organization_id = s.organization_id AND t.id = s.terminal_id ' +
      `WHERE ${clauses.join(' AND ')} ORDER BY s.started_at DESC LIMIT 1`,
  )
    .bind(...params)
    .first<{
      id: string
      storeId: string
      terminalId: string
      staffId: string | null
      mode: 'shared' | 'personal'
      credentialHash: string
      startedAt: string
      expiresAt: string
      revokedAt: string | null
    }>()
  if (row === null) return terminalSessionInvalid(c)
  const authorization = sessionAuthorizationAt(row, new Date(c.env.TEST_NOW ?? Date.now()))
  if (authorization === null) return terminalSessionInvalid(c)
  return { ...row, authorization }
}

function requirePersonalMode(
  subject = '設定の変更',
  input: { whenTerminalIsActive?: boolean } = {},
): MiddlewareHandler<Env> {
  return async (c, next) => {
    const terminalId = c.req.header('x-terminal-id')
    const sessionToken = c.req.header('x-terminal-session')
    if (terminalId === undefined && sessionToken === undefined) {
      if (input.whenTerminalIsActive) {
        await next()
        return
      }
      return c.json({ error: 'personal_mode_required', subject }, 403)
    }
    const session = await authenticatedTerminalSession(c)
    if (session.authorization !== 'personal') {
      return c.json({ error: 'personal_mode_required', subject }, 403)
    }
    await next()
  }
}

type OperationActor = {
  actorType: 'staff' | 'terminal'
  actorId: string | null
  terminalId: string | null
}

/** 端末ヘッダーを信用せず、同じ組織・店舗のセッションから操作主体を解決する。 */
async function operationActor(
  c: Context<Env>,
  storeId: string,
  fallbackStaffId: string | null,
): Promise<OperationActor> {
  const terminalId = c.req.header('x-terminal-id')
  const sessionToken = c.req.header('x-terminal-session')
  if (terminalId === undefined && sessionToken === undefined) {
    return { actorType: 'staff', actorId: fallbackStaffId, terminalId: null }
  }
  const session = await authenticatedTerminalSession(c, { storeId })
  if (session.authorization === 'personal' && session.staffId !== null) {
    const actor = resolveActor({
      mode: 'personal',
      staffId: session.staffId,
      terminalId: session.terminalId,
    })
    return { actorType: 'staff', actorId: actor.subjectId, terminalId: actor.terminalId }
  }
  if (session.authorization === 'shared') {
    const actor = resolveActor({ mode: 'shared', staffId: null, terminalId: session.terminalId })
    return { actorType: 'terminal', actorId: actor.subjectId, terminalId: actor.terminalId }
  }
  return terminalSessionInvalid(c)
}

/** headerless legacyを許すstaff APIでも、端末headerが一方でもあればpairを必ず検証する。 */
async function validateTerminalPairWhenPresent(c: Context<Env>, storeId: string): Promise<void> {
  if (
    c.req.header('x-terminal-id') === undefined &&
    c.req.header('x-terminal-session') === undefined
  ) {
    return
  }
  await authenticatedTerminalSession(c, { storeId })
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

/*
 * 「ご来店になった」と数える状態。
 *
 * **`done` だけでは足りない。**`AC-CUST-11` は「最後のご来店」を
 * **来店済み（`arrived` / `serving` / `done`）の予約の最終 `starts_at`」と定めている。
 * `done` だけで数えていたころ、いまお店にいらしている方（`arrived` / `serving`）の
 * 「最後のご来店」が前回のまま止まり、一覧・要約・重複の警告に古い日付が出続けた
 * （実装不足の洗い出し customers-05）。来店回数（`visit_count`）も同じ数え方をする。
 */
const VISITED_STATUSES = "('arrived', 'serving', 'done')"

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

const REFRESH_COOKIE = 'refresh_token'

async function adminAuthFetch(env: Bindings, path: string, body: unknown) {
  return env.ADMIN.fetch(`https://admin.internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': env.INTERNAL_KEY },
    body: JSON.stringify(body),
  })
}

/** 本番の初回トークンは認証の正本adminから受け取り、refresh tokenだけcookie境界へ移す。 */
app.post('/api/auth/login', zValidator('json', LoginRequest), async (c) => {
  const response = await adminAuthFetch(
    c.env,
    '/api/internal/domain-auth/login',
    c.req.valid('json'),
  )
  const body = await response.json().catch(() => null)
  if (!response.ok || body === null) {
    return new Response(JSON.stringify(body ?? { error: 'auth_unavailable' }), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    })
  }
  const parsed = LoginResponse.parse(body)
  setCookie(c, REFRESH_COOKIE, parsed.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/api/auth',
  })
  const { refreshToken: _omit, ...publicBody } = parsed
  return c.json(publicBody)
})

app.post('/api/auth/refresh', async (c) => {
  const refreshToken = getCookie(c, REFRESH_COOKIE)
  if (refreshToken === undefined) return c.json({ error: 'unauthorized' }, 401)
  const response = await adminAuthFetch(
    c.env,
    '/api/internal/domain-auth/refresh',
    RefreshRequest.parse({ refreshToken }),
  )
  const body = await response.json().catch(() => null)
  if (!response.ok || body === null) {
    return new Response(JSON.stringify(body ?? { error: 'auth_unavailable' }), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    })
  }
  const parsed = RefreshResponse.parse(body)
  setCookie(c, REFRESH_COOKIE, parsed.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/api/auth',
  })
  return c.json({ token: parsed.token })
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
function bumpVisitCounters(
  db: D1Database,
  org: string,
  customerId: string,
  now: Date,
  guard?: Guard,
): Statement {
  const nowIso = now.toISOString()
  const applied = guard === undefined ? '' : ` AND ${guard.condition}`
  return db
    .prepare(
      "UPDATE customers SET visit_count = (SELECT COUNT(*) FROM reservations WHERE organization_id = ? AND customer_id = ? AND status = 'done'), " +
        `first_visit_at = (SELECT MIN(starts_at) FROM reservations WHERE organization_id = ? AND customer_id = ? AND status IN ${VISITED_STATUSES} AND starts_at <= ?), ` +
        `last_visit_at = (SELECT MAX(starts_at) FROM reservations WHERE organization_id = ? AND customer_id = ? AND status IN ${VISITED_STATUSES} AND starts_at <= ?), ` +
        `updated_at = ? WHERE organization_id = ? AND id = ?${applied}`,
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
      ...(guard?.params ?? []),
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
    actorType?: 'staff' | 'terminal'
    terminalId?: string | null
    action: string
    targetType: string
    targetId: string
    after: unknown
    correlationId: string
    occurredAt: string
    /** 枠が取れた予約にだけ当てる条件（`reservationId` を渡したときだけ付く）。 */
    lockedFor?: string
    /** 工程イベントが成立した操作にだけ当てる条件。 */
    appliedVisitEventId?: string
  },
): Statement {
  const guard =
    input.lockedFor !== undefined
      ? ` WHERE ${WALKIN_LOCKED}`
      : input.appliedVisitEventId !== undefined
        ? ' WHERE EXISTS (SELECT 1 FROM visit_events WHERE organization_id = ? AND id = ?)'
        : ''
  const guardParams =
    input.lockedFor !== undefined
      ? [input.organizationId, input.lockedFor]
      : input.appliedVisitEventId !== undefined
        ? [input.organizationId, input.appliedVisitEventId]
        : []
  return db
    .prepare(
      'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
        `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?${guard}`,
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.storeId,
      input.actorType ?? 'staff',
      input.actorId,
      input.terminalId ?? null,
      input.action,
      input.targetType,
      input.targetId,
      JSON.stringify(input.after),
      input.correlationId,
      input.occurredAt,
      ...guardParams,
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

/* ───────────────────────────────────────────────────────────────────────────
 * 受付の録音（P7）が共有する道具
 *
 * 芯は **実体を出さない**ことである。録音の本体は非公開の R2（`RECORDINGS`）にあり、
 * D1 が持つのは状態だけで、応答には `r2Key` もダウンロード URL も載せない。行を
 * そのまま `c.json` しないよう、契約 `Recording` は `strictObject` にしてある
 * （剥がし忘れは 200 で外へ出るが、混ぜたまま渡せば 500 で落ちる）。
 *
 * もう 1 つの芯は **消しすぎない**ことである。削除の可否は経路ごとに書かず、
 * 通常の削除も保守の掃除も `canDelete()` の 1 か所を通す。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 1 録音の上限。100MB は約 7 時間ぶんで、最長 6 分の受付録音はここに届かない。 */
const RECORDING_MAX_BYTES = 104_857_600
/** 採番の打ち直し（`walk_ins.ticket_no` と同じ作法）。衝突は失敗に数えない。 */
const RECORDING_CODE_ATTEMPTS = 5
/** 3 回続けて失敗したら「対応が必要」のお知らせに上げる（`04-api.md` §3.9）。 */
const RECORDING_ALERT_ATTEMPTS = 3
/**
 * 数える失敗の上限。契約の `Recording.uploadAttempts` が 0..99 なので、ここで頭打ちに
 * しないと 5 分ごとの自動再送が 8 時間あまりで 100 に届き、応答を組み立てる
 * `Recording.parse` が落ちる。**壊れるのは状態更新だけではない** — 桁のあふれた行が
 * 1 本混ざるだけで `GET /api/staff/recordings` が組織まるごと 500 になる。
 * 3 回でお知らせは既に立っているので、そこから先の数に業務上の意味は無い。
 */
const RECORDING_MAX_ATTEMPTS = 99
/** 録音の長さの上限（秒）。6 時間。契約の `Recording.durationSeconds` と同じ境界。 */
const RECORDING_MAX_SECONDS = 21_600

/** 一覧・詳細が同じ形で読む列。`r2_key` は**応答を組み立てる側へ渡さない**別扱いにする。 */
const RECORDING_COLUMNS =
  'id, store_id AS storeId, code, reception_session_id AS receptionSessionId, ' +
  'reservation_id AS reservationId, r2_key AS r2Key, content_type AS contentType, ' +
  'duration_seconds AS durationSeconds, bytes, state, retain_until AS retainUntil, ' +
  'legal_hold AS legalHold, upload_attempts AS uploadAttempts, created_at AS createdAt'

type RecordingRecord = {
  id: string
  storeId: string
  code: string
  receptionSessionId: string
  reservationId: string | null
  r2Key: string
  contentType: string
  durationSeconds: number | null
  bytes: number | null
  state: string
  retainUntil: string | null
  legalHold: string
  uploadAttempts: number
  createdAt: string
}

/**
 * 行 → 契約の形。**`r2Key` と `storeId` を落とすのはここ 1 か所だけ**にする。
 * 経路ごとに手で組み立てると、1 つ足し忘れた経路から保管庫の鍵が漏れる。
 */
function toRecording(row: RecordingRecord) {
  return {
    id: row.id,
    code: row.code,
    receptionSessionId: row.receptionSessionId,
    reservationId: row.reservationId,
    state: row.state as RecordingState,
    contentType: row.contentType,
    durationSeconds: row.durationSeconds,
    bytes: row.bytes,
    retainUntil: row.retainUntil,
    legalHold: isOn(row.legalHold),
    uploadAttempts: row.uploadAttempts,
    createdAt: row.createdAt,
  }
}

/** 自分の組織の録音だけを引く。他テナントの id は「無い」として扱う（404）。 */
async function findRecording(
  db: D1Database,
  org: string,
  recordingId: string,
): Promise<RecordingRecord | null> {
  return await db
    .prepare(`SELECT ${RECORDING_COLUMNS} FROM recordings WHERE organization_id = ? AND id = ?`)
    .bind(org, recordingId)
    .first<RecordingRecord>()
}

/**
 * その人が `perm` を持っている店舗の id。
 *
 * `requireStorePermission()` は「組織のどこかで持っているか」までしか見ないので、
 * 録音のように**店舗ごとに閉じたい**ものはここで店舗まで絞る（Q-03）。
 * 担当していない店舗の録音は、読めないだけでなく**一覧にも出ない**（AC-REC-14）。
 */
async function permittedStores(
  db: Db,
  org: string,
  sub: string,
  perm: StorePermission,
): Promise<string[]> {
  const rows = await db
    .select({ storeId: storeMemberships.storeId, permissions: storeMemberships.permissions })
    .from(storeMemberships)
    .where(and(eq(storeMemberships.organizationId, org), eq(storeMemberships.userId, sub)))
  return rows.filter((row) => allows(row.permissions, perm)).map((row) => row.storeId)
}

/**
 * 権限のある店舗の録音か。**外れたら 403 ではなく 404** にする —
 * 「権限が無い」と答えた時点で、その id の録音が在ることを教えてしまう。
 */
async function readableRecording(
  c: Context<Env>,
  perm: StorePermission,
): Promise<RecordingRecord | null> {
  const { org, sub } = c.get('auth')
  const row = await findRecording(c.env.DB, org, c.req.param('recordingId') ?? '')
  if (row === null) return null
  const stores = await permittedStores(drizzle(c.env.DB), org, sub, perm)
  return stores.includes(row.storeId) ? row : null
}

/**
 * 録音の監査 1 行。`auditRow()` と分けてあるのは `actor_type` が動くからである —
 * 保管の完了と 24 時間放置の打ち切りは**人が押した操作ではない**ので `system` で残す。
 * P10 の端末操作では、検証済みセッションから端末欄も残す。
 */
function recordingAudit(
  db: D1Database,
  input: {
    organizationId: string
    storeId: string
    actorType: 'staff' | 'system' | 'terminal'
    actorId: string | null
    terminalId?: string | null
    action: string
    recordingId: string
    after: unknown
    correlationId: string
    occurredAt: string
  },
): Statement {
  return db
    .prepare(
      'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
        "VALUES (?,?,?,?,?,?,?,'recordings',?,NULL,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.storeId,
      input.actorType,
      input.actorId,
      input.terminalId ?? null,
      input.action,
      input.recordingId,
      JSON.stringify(input.after),
      input.correlationId,
      input.occurredAt,
    )
}

/**
 * その受付に結び付いたご予約とお客様のお名前。
 *
 * **「成立している」は `reservation_id` が入っているだけでは足りない** —
 * 取り消したご予約の録音まで 30 日残すと、破棄受付より長く声を持ち続けることになる
 * （`04-api.md` §3.9 の「`cancelled` / `no_show` 以外」）。
 */
async function readSessionLink(
  db: D1Database,
  org: string,
  receptionSessionId: string,
): Promise<{ reservationId: string | null; hasReservation: boolean; customerName: string | null }> {
  const row = await db
    .prepare(
      'SELECT r.id AS reservationId, r.status AS status, c.name AS customerName ' +
        'FROM reception_sessions s ' +
        'LEFT JOIN reservations r ON r.organization_id = s.organization_id AND r.id = s.reservation_id ' +
        'LEFT JOIN customers c ON c.organization_id = r.organization_id AND c.id = r.customer_id ' +
        'WHERE s.organization_id = ? AND s.id = ?',
    )
    .bind(org, receptionSessionId)
    .first<{ reservationId: string | null; status: string | null; customerName: string | null }>()
  const reservationId = row?.reservationId ?? null
  const status = row?.status ?? null
  return {
    reservationId,
    hasReservation: reservationId !== null && status !== 'cancelled' && status !== 'no_show',
    customerName: row?.customerName ?? null,
  }
}

/**
 * 「録音の保存に3回失敗しました」を 1 件立てる。
 *
 * **同じ原因で連打しない。**同じ `code` + `target_id` の未解決行があれば作らない
 * （4 回目・5 回目の失敗でお知らせが増えると、対応の 1 件が数に埋もれる）。
 *
 * 端末名はその録音の受付が使っていた端末から引く。`null` で固定していたころ、
 * 本文の一句が落ち、**どの iPad に実体が残っているのかが分からなかった** ——
 * 直しに行く人はお店じゅうの端末を順に見ることになる
 * （実装不足の洗い出し recording-05。P10 で `terminals` 表が入ったので引ける）。
 */
async function raiseUploadFailedAlert(
  db: D1Database,
  input: {
    organizationId: string
    storeId: string
    recordingId: string
    code: string
    customerName: string | null
    hasReservation: boolean
    occurredAt: string
  },
): Promise<void> {
  const existing = await db
    .prepare(
      "SELECT id FROM alerts WHERE organization_id = ? AND code = 'recording.upload_failed' " +
        "AND audience = 'store' AND target_id = ? AND resolved_at IS NULL LIMIT 1",
    )
    .bind(input.organizationId, input.recordingId)
    .first<{ id: string }>()
  if (existing !== null) return
  const terminal = await db
    .prepare(
      'SELECT t.name AS name FROM recordings r ' +
        'JOIN reception_sessions s ON s.organization_id = r.organization_id AND s.id = r.reception_session_id ' +
        'JOIN terminals t ON t.organization_id = s.organization_id AND t.id = s.terminal_id ' +
        'WHERE r.organization_id = ? AND r.id = ? LIMIT 1',
    )
    .bind(input.organizationId, input.recordingId)
    .first<{ name: string }>()
  const alert = uploadFailedAlert({
    code: input.code,
    customerName: input.customerName,
    hasReservation: input.hasReservation,
    terminalName: terminal?.name ?? null,
  })
  await db
    .prepare(
      'INSERT INTO alerts (id, organization_id, store_id, code, severity, audience, title, body, target_type, target_id, occurred_at, read_at, resolved_at, resolved_by, created_at) ' +
        "VALUES (?,?,?,?,?,'store',?,?,'recording',?,?,NULL,NULL,NULL,?)",
    )
    .bind(
      crypto.randomUUID(),
      input.organizationId,
      input.storeId,
      alert.code,
      alert.severity,
      alert.title,
      alert.body,
      input.recordingId,
      input.occurredAt,
      input.occurredAt,
    )
    .run()
}

/** `stored` 遷移と同じ D1 batch で、対応する未解決 alert と追記監査を閉じる。 */
function resolveUploadFailedAlertStatements(
  db: D1Database,
  input: {
    organizationId: string
    storeId: string
    recordingId: string
    resolvedAt: string
  },
): D1PreparedStatement[] {
  const correlationId = crypto.randomUUID()
  const predicate =
    "organization_id = ? AND store_id = ? AND audience = 'store' AND code = 'recording.upload_failed' AND target_id = ? AND resolved_at IS NULL"
  return [
    db
      .prepare(
        'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
          `SELECT id, organization_id, store_id, 'system', NULL, NULL, 'alert.resolved', 'alerts', id, json_object('resolvedAt',resolved_at), json_object('resolvedAt',?), ?, ? FROM alerts WHERE ${predicate}`,
      )
      .bind(
        input.resolvedAt,
        correlationId,
        input.resolvedAt,
        input.organizationId,
        input.storeId,
        input.recordingId,
      ),
    db
      .prepare(`UPDATE alerts SET resolved_at = ?, resolved_by = NULL WHERE ${predicate}`)
      .bind(input.resolvedAt, input.organizationId, input.storeId, input.recordingId),
  ]
}

/** 一覧の続き。並べ方に結び付いた不透明な値（`(時刻, id)` の複合カーソル）。 */
const encodePageCursor = (at: string, id: string): string => btoa(`${at}|${id}`)

/** 読めないカーソルは「無い」として先頭から返す（行き止まりにしない）。 */
function decodePageCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (cursor === undefined) return null
  try {
    const [at, id] = atob(cursor).split('|')
    return at === undefined || id === undefined ? null : { at, id }
  } catch {
    return null
  }
}

/**
 * 保持期限を過ぎた録音の実体を消し、24 時間動かない録音を `failed` に落とす。
 *
 * **プレフィクス走査で R2 を消さない。**同じバケットには手書きメモ（`notes/`）が
 * 入っているので、走査で消すとお客様の筆跡まで道連れになる。消すのは
 * `recordings.r2_key` が指すキーだけである。
 *
 * 消せなかったものは `failed` に数え、**行はそのまま残して次の実行で再び対象にする**
 * （行だけ `deleted` にすると、実体が残ったまま二度と拾われない）。
 *
 * `now` はテストが境界を確かめるための注入口で、Cron からは実時刻が渡る。
 */
async function purgeRecordings(
  env: Bindings,
  input: { now: Date; limit: number },
): Promise<{ examined: number; deleted: number; skippedHeld: number; failed: number }> {
  const nowIso = input.now.toISOString()
  const staleBefore = staleUploadBefore(input.now)
  const correlationId = crypto.randomUUID()
  let examined = 0
  let deleted = 0
  let skippedHeld = 0
  let failed = 0

  // ① 保持期限を過ぎた保管済み。ISO 文字列同士は辞書順が時系列と一致するので、
  // 絞り込みは文字列比較でよい。
  // **組織を指定しないので `recordings_org_state_retain_idx`（先頭が organization_id）は
  // 効かない。** 掃除は全組織を 1 度に見る 1 本なので、これは走査でよい（`limit` で 1 回の
  // 仕事量を切る）。組織ごとに回すと、組織が増えたぶんだけ Cron の中の往復が増える。
  const expired = await env.DB.prepare(
    `SELECT ${RECORDING_COLUMNS}, organization_id AS organizationId FROM recordings ` +
      "WHERE state = 'stored' AND retain_until IS NOT NULL AND retain_until < ? " +
      'ORDER BY retain_until ASC LIMIT ?',
  )
    .bind(nowIso, input.limit)
    .all<RecordingRecord & { organizationId: string }>()

  for (const row of expired.results) {
    examined += 1
    // ② 保全は期限より強い。触らずに数える（正常な残り方であって失敗ではない）。
    if (isOn(row.legalHold)) {
      skippedHeld += 1
      continue
    }
    const verdict = canDelete({
      state: row.state as RecordingState,
      retainUntil: row.retainUntil,
      legalHold: false,
      now: input.now,
    })
    if (!verdict.ok) {
      skippedHeld += 1
      continue
    }
    try {
      await env.RECORDINGS.delete(row.r2Key)
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE recordings SET state = 'deleted', deleted_at = ?, updated_at = ? WHERE organization_id = ? AND id = ?",
        ).bind(nowIso, nowIso, row.organizationId, row.id),
        recordingAudit(env.DB, {
          organizationId: row.organizationId,
          storeId: row.storeId,
          actorType: 'system',
          actorId: null,
          action: 'recording.deleted',
          recordingId: row.id,
          after: { reason: 'retention', retainUntil: row.retainUntil },
          correlationId,
          occurredAt: nowIso,
        }),
      ])
      deleted += 1
    } catch (err) {
      // 行は残す。次の実行で同じ条件に当たり、もう一度拾われる。
      console.error('recording purge failed', row.id, err)
      failed += 1
    }
  }

  // ③ 24 時間動かない録音。端末はもう戻ってこないので `failed` に落として
  // 「対応が必要」に上げる（警告を出し続けないため。AC-REC-20）。
  //
  // **一度お知らせを立てた録音は候補から外す。**`failed` の行は 24 時間の物差しから
  // 二度と外れないので、外さないと打ち切り済みの古い行が毎晩 `limit` を食い尽くし、
  // 新しく動かなくなった録音にいつまでも順番が回らない（同じお知らせが、対応を
  // 済ませたそばから毎晩立ち直りもする）。
  const stale = await env.DB.prepare(
    `SELECT ${RECORDING_COLUMNS}, organization_id AS organizationId FROM recordings r ` +
      "WHERE r.state IN ('recording','uploading','failed') AND r.created_at < ? " +
      'AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.organization_id = r.organization_id ' +
      "AND a.code = 'recording.upload_failed' AND a.target_id = r.id) " +
      'ORDER BY r.created_at ASC LIMIT ?',
  )
    .bind(staleBefore, input.limit)
    .all<RecordingRecord & { organizationId: string }>()

  for (const row of stale.results) {
    // 境界を持っているのは `isStaleUpload()` のほうである（SQL の `staleBefore` は
    // 同じ境界を D1 側へ写して `limit` を意味のある数にするためだけの絞り込み）。
    // ここを外すと、猶予を変えたときに SQL だけが先に動く。
    if (
      !isStaleUpload({
        state: row.state as RecordingState,
        createdAt: row.createdAt,
        now: input.now,
      })
    ) {
      continue
    }
    examined += 1
    // 本体を R2 へ書いたあとで D1 の書き込みが落ちると、`stored` にならないまま実体が
    // 残る。掃除の①は `state='stored'` しか引かないので、この実体は二度と拾われず、
    // **保持期限を持たない声**が保管庫に居座る。打ち切りは端末の控えを捨てる合図
    // （AC-REC-20）でもあるので、サーバ側の書きかけもここで一緒に捨てる。
    // 保全が立っている行だけは触らない（保全は期限より強い）。
    if (!isOn(row.legalHold)) {
      try {
        await env.RECORDINGS.delete(row.r2Key)
      } catch (err) {
        // 消せなくても打ち切りは続ける。次の実行で同じ鍵をもう一度消しに行く。
        console.error('recording stale object delete failed', row.id, err)
      }
    }
    const link = await readSessionLink(env.DB, row.organizationId, row.receptionSessionId)
    if (row.state !== 'failed') {
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE recordings SET state = 'failed', updated_at = ? WHERE organization_id = ? AND id = ?",
        ).bind(nowIso, row.organizationId, row.id),
        recordingAudit(env.DB, {
          organizationId: row.organizationId,
          storeId: row.storeId,
          actorType: 'system',
          actorId: null,
          action: 'recording.failed',
          recordingId: row.id,
          after: { reason: 'stale_upload', createdAt: row.createdAt },
          correlationId,
          occurredAt: nowIso,
        }),
      ])
    }
    await raiseUploadFailedAlert(env.DB, {
      organizationId: row.organizationId,
      storeId: row.storeId,
      recordingId: row.id,
      code: row.code,
      customerName: link.customerName,
      hasReservation: link.hasReservation,
      occurredAt: nowIso,
    })
  }

  return { examined, deleted, skippedHeld, failed }
}

/* ───────────────────────────────────────────────────────────────────────────
 * お客様向け Web 予約（P8）が共有する道具
 *
 * 公開面（`/api/public/**`）は**未認証**である。default-deny の例外に入っているので
 * ミドルウェアは 1 つも通らず、**組織は `stores.slug` からしか解決しない**。
 * body / query の `organizationId` を認可の根拠にしない（そもそも契約が持っていない）。
 *
 * 公開していない店舗・公開していない目的は、**存在も漏らさない**。
 * 「無い slug」と「非公開の slug」は status も body も同じにする（`04-api.md` §3.12）。
 * ─────────────────────────────────────────────────────────────────────────── */

/** ご案内のページの前置き（`eyex.jp/ginza`）。表には持たず、slug から組み立てる。 */
const PUBLIC_ORIGIN_FALLBACK = 'eyex.jp'

/**
 * 公開面の 404。**存在しない slug と非公開の店舗で body まで同じにする。**
 * status だけ揃えて code を分けると、slug が実在するかどうかが body から読めてしまう。
 */
const NOT_PUBLISHED = { error: 'not_published' as const }

/** 本人確認の 401。番号違い・期限切れ・無い番号を**同じ文言**に落とす。 */
const INVALID_MANAGEMENT_CODE = { error: 'invalid_management_code' as const }

/**
 * 確認メールを送れたことの控え。**送れなかったときは置かない** —
 * 置くと、次にお客様が自分の予約を開いたときの再送が二度と走らない（`04-api.md` §7.2）。
 */
const MAIL_SENT_TTL_SECONDS = 24 * 60 * 60
const mailSentKey = (org: string, reservationId: string): string =>
  `mailsent:${org}:${reservationId}`

/**
 * 枠のガード。`domain/booking.ts` の `LOCKED` と**一字一句同じ**にする
 * （あちらは export していない。写しであることを名前で示す）。
 * この文が付いていない行は、枠を 1 つも取れなかったバッチでも書かれてしまう。
 */
const WEB_LOCKED =
  'EXISTS (SELECT 1 FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ?)'

/** 公開設定の版は 0 から始まる（行がまだ無い店舗を 0 として読む）。 */
const WEB_FIRST_VERSION = 0

/** 本人確認が通ったあとの短命の鍵の寿命（`04-api.md` §6.3）。 */
const WEB_SHORT_LIVED_TTL_SECONDS = 900

/** 変更・取消の締切の既定（来店日の 1 日前 = 前日 23:59:59.999 JST まで）。 */
const DEFAULT_CHANGE_DEADLINE_DAYS = 1

/** `EY-W-YYMM-` のあと、連番が始まる位置（SQL の `SUBSTR` は 1 始まり）。 */
const WEB_CODE_SERIAL_OFFSET = 'EY-W-YYMM-'.length
/** ご予約番号の打ち直しの上限。尽きたら 409 `code_exhausted`（500 にしない）。 */
const WEB_CODE_ATTEMPTS = 5

type WebSettingsRow = typeof webBookingSettings.$inferSelect
type StoreRow = typeof stores.$inferSelect

/** お客様に見せる店名。`name_public` を持たない古い行だけ `name` に落ちる。 */
const publicStoreName = (row: StoreRow): string => row.namePublic ?? row.name

/** 公開設定 1 行 → ドメインが読む形。列が増えてもここだけを直す。 */
function toWebSettingsRow(row: WebSettingsRow | undefined): WebBookingSettingsRow | null {
  if (row === undefined) return null
  return {
    isPublished: isOn(row.isPublished) ? '1' : '0',
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    acceptFromHours: row.acceptFromHours,
    acceptUntilDays: row.acceptUntilDays,
    changeDeadlineDays: row.changeDeadlineDays,
    requiresApproval: isOn(row.requiresApproval) ? '1' : '0',
    message: row.message,
    version: row.version,
    updatedAt: row.updatedAt,
  }
}

async function readWebSettings(db: Db, org: string, storeId: string) {
  const rows = await db
    .select()
    .from(webBookingSettings)
    .where(and(eq(webBookingSettings.organizationId, org), eq(webBookingSettings.storeId, storeId)))
  return rows[0]
}

/**
 * Web に出しうるご来店の目的。**店舗のものとチェーン共通（`store_id IS NULL`）の両方**を
 * 登録順で返す。出すかどうかの判定はドメイン（`resolvePublication`）に任せる —
 * 判定を SQL とドメインの 2 か所に置くと、片方だけ直した日に画面と API がずれる。
 */
async function readPublishablePurposes(
  db: Db,
  org: string,
  storeId: string,
): Promise<PublishablePurpose[]> {
  const rows = await db
    .select({
      id: visitPurposes.id,
      namePublic: visitPurposes.namePublic,
      durationMinutes: visitPurposes.durationMinutes,
      isWebPublished: visitPurposes.isWebPublished,
      isActive: visitPurposes.isActive,
      sortOrder: visitPurposes.sortOrder,
    })
    .from(visitPurposes)
    .where(
      and(
        eq(visitPurposes.organizationId, org),
        or(eq(visitPurposes.storeId, storeId), isNull(visitPurposes.storeId)),
      ),
    )
    .orderBy(asc(visitPurposes.sortOrder))
  return rows.map((row) => ({
    id: row.id,
    namePublic: row.namePublic,
    durationMinutes: row.durationMinutes,
    isWebPublished: isOn(row.isWebPublished) ? '1' : '0',
    isActive: isOn(row.isActive) ? '1' : '0',
    sortOrder: row.sortOrder,
  }))
}

/**
 * 公開面の入口。**`stores.slug` は全組織横断で一意**なので、ここで解決した組織以外に
 * 手が届く道は無い（`stores_slug_idx`）。
 */
async function storeBySlug(db: Db, slug: string): Promise<StoreRow | null> {
  const rows = await db.select().from(stores).where(eq(stores.slug, slug))
  return rows[0] ?? null
}

/** 店舗 1 つぶんの公開の姿（設定 ＋ 出すご用件 ＋ ご案内のページ）。 */
async function publicationOf(env: Bindings, db: Db, store: StoreRow, now: Date) {
  return resolvePublication({
    slug: store.slug,
    settings: toWebSettingsRow(await readWebSettings(db, store.organizationId, store.id)),
    purposes: await readPublishablePurposes(db, store.organizationId, store.id),
    publicOrigin: env.PUBLIC_WEB_ORIGIN ?? PUBLIC_ORIGIN_FALLBACK,
    now,
  })
}

/**
 * 公開面の盤面。業務面（`bookingBoard`）との違いは 2 つだけである。
 *
 * 1. **仮の押さえ（KV）を読まない。**KV の list は無料枠 1,000 回/日で、公開ページの
 *    閲覧数がそのまま list 数になる（`04-api.md` §6.3）。二重予約は確定時の
 *    `reservation_slot_locks` が止めるので、読まなくても壊れない。
 * 2. 受付の窓（`opens_at`〜`closes_at` / 何時間先から / 何日先まで）を足す。
 *    絞り込みそのものは空き枠エンジンが持つ（関数を複製しない）。
 */
function webBoard(input: {
  date: string
  now: Date
  rows: AvailabilityDayRows
  isSuspended: boolean
  durationMinutes: number
  window: WebWindow
  preferredStartsAt?: string | null
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
    webWindow: input.window,
    excludeReservationId: input.excludeReservationId ?? null,
    preferredStartsAt: input.preferredStartsAt ?? null,
  }
}

/**
 * 公開面が返すエラー。業務面（`BLOCKING_REASON`）と違い、**埋まっている理由も写す** —
 * お客様の面では「ちょうど埋まってしまいました」と代わりの時刻を出す面（WEB-03）が
 * あり、確定のバッチまで待つ必要が無い（待っても答えは変わらない）。
 */
const PUBLIC_BLOCKING: Record<
  AvailabilityReason,
  'store_closed' | 'purpose_unavailable' | 'slot_taken'
> = {
  closed: 'store_closed',
  outside_hours: 'store_closed',
  break: 'store_closed',
  web_window: 'store_closed',
  lead_time: 'store_closed',
  no_skill: 'purpose_unavailable',
  staff_off: 'purpose_unavailable',
  no_equipment: 'purpose_unavailable',
  maintenance: 'purpose_unavailable',
  staff_busy: 'slot_taken',
  equipment_busy: 'slot_taken',
  max_parallel: 'slot_taken',
}

/**
 * お客様に見せる枠。**受け付ける気が無い時刻は 1 つも出さない** —
 * 定休・営業時間の外・お昼の受付停止帯・受付の窓の外（`web_window` / `lead_time`）で
 * 落ちた枠は、時刻そのものを返さない（AC-WEB-04「10:30 より前と 18:00 以降の時刻は
 * 候補に 1 つも出ない」）。残った時刻だけを、空いているかどうかの真偽で返す。
 * 「満」の札を出すのは**埋まっているとき**だけで、閉じている時間帯と混ぜない。
 */
const HIDDEN_FROM_PUBLIC: ReadonlySet<AvailabilityReason> = new Set<AvailabilityReason>([
  'closed',
  'outside_hours',
  'break',
  'web_window',
  'lead_time',
])

const publicSlots = (slots: readonly SlotResult[]): { startsAt: string; isAvailable: boolean }[] =>
  slots
    .filter((slot) => slot.reason === null || !HIDDEN_FROM_PUBLIC.has(slot.reason))
    .map((slot) => ({ startsAt: slot.startsAt, isAvailable: slot.isAvailable }))

/** Web 予約 1 件と、その予約本体・店舗を 1 度に読む形。 */
type WebBookingJoin = {
  id: string
  organizationId: string
  storeId: string
  reservationId: string
  publicCode: string
  managementCodeHash: string
  contactName: string
  contactEmail: string
  webStatus: string
  webCreatedAt: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  reservationStatus: string
  version: number
  updatedAt: string
  noteCustomer: string | null
  noteInternal: string | null
  storeSlug: string
  storeName: string
  storeNamePublic: string | null
  storeIsActive: string
}

const WEB_BOOKING_COLUMNS =
  'w.id AS id, w.organization_id AS organizationId, w.store_id AS storeId, ' +
  'w.reservation_id AS reservationId, w.public_code AS publicCode, ' +
  'w.management_code_hash AS managementCodeHash, w.contact_name AS contactName, ' +
  'w.contact_email AS contactEmail, w.status AS webStatus, w.created_at AS webCreatedAt, ' +
  'r.starts_at AS startsAt, r.ends_at AS endsAt, r.duration_minutes AS durationMinutes, ' +
  'r.status AS reservationStatus, r.version AS version, r.updated_at AS updatedAt, ' +
  'r.note_customer AS noteCustomer, r.note_internal AS noteInternal, ' +
  's.slug AS storeSlug, s.name AS storeName, s.name_public AS storeNamePublic, ' +
  's.is_active AS storeIsActive'

/**
 * ご予約番号で候補を引く。**`public_code` が一意なのは組織の中だけ**なので、
 * 番号だけでは 1 件に絞れない。絞るのは確認番号の照合で、そこで初めて組織が決まる
 * （他社の番号と自社の確認番号を組み合わせても、どの候補にも当たらない）。
 */
async function webBookingsByCode(db: D1Database, publicCode: string): Promise<WebBookingJoin[]> {
  const found = await db
    .prepare(
      `SELECT ${WEB_BOOKING_COLUMNS} FROM web_bookings w ` +
        'JOIN reservations r ON r.organization_id = w.organization_id AND r.id = w.reservation_id ' +
        'JOIN stores s ON s.organization_id = w.organization_id AND s.id = w.store_id ' +
        'WHERE w.public_code = ?1',
    )
    .bind(publicCode)
    .all<WebBookingJoin>()
  return found.results
}

/** 確認番号の塩。**組織とご予約番号**を混ぜる（1 件漏れても隣が開かない）。 */
const managementSalt = (organizationId: string, publicCode: string): string =>
  `${organizationId}:${publicCode}`

/** 総当たりを数える鍵。**コード × IP**。ヘッダーが無い経路は `unknown` で数える。 */
const clientIpOf = (c: Context<Env>): string => c.req.header('cf-connecting-ip') ?? 'unknown'

async function failureCount(env: Bindings, publicCode: string, ip: string): Promise<number> {
  const raw = await env.SHORT_LIVED.get(failureKey(publicCode, ip))
  return raw === null ? 0 : Number.parseInt(raw, 10) || 0
}

/** 失敗したときにだけ書く（成功しても書かない）。 */
async function countFailure(env: Bindings, publicCode: string, ip: string): Promise<void> {
  const key = failureKey(publicCode, ip)
  const next = (await failureCount(env, publicCode, ip)) + 1
  await env.SHORT_LIVED.put(key, String(next), {
    expirationTtl: MANAGEMENT_CODE_FAILURE_TTL_SECONDS,
  })
}

/** 短命の鍵に入れる値。組織を持たせるので、番号だけの候補から 1 件に絞れる。 */
type ShortLivedRecord = { organizationId: string; publicCode: string; expiresAt: string }

/**
 * `X-Management-Code` を照合して 1 件に絞る。通るのは 2 通りである。
 *
 * 1. 予約を作ったときにお渡しした**確認番号**そのもの。
 * 2. 本人確認が通ったあとに配った**短命の鍵**（KV `mgmt:<orgId>:<code>`。900 秒）。
 *
 * どちらでもなければ `null`。**理由を分けない**（番号違いと期限切れを区別すると、
 * 番号が実在するかどうかが応答から読める）。
 */
async function authenticateWebBooking(
  env: Bindings,
  input: { publicCode: string; presented: string; now: Date },
): Promise<WebBookingJoin | null> {
  const candidates = await webBookingsByCode(env.DB, input.publicCode)
  for (const row of candidates) {
    if (
      await verifyManagementCode(
        row.managementCodeHash,
        input.presented,
        managementSalt(row.organizationId, row.publicCode),
      )
    ) {
      return row
    }
    const raw = await env.SHORT_LIVED.get(shortLivedKey(row.organizationId, input.presented))
    if (raw === null) continue
    const record = JSON.parse(raw) as ShortLivedRecord
    if (record.publicCode !== row.publicCode) continue
    if (!isShortLivedFresh(record, input.now)) continue
    return row
  }
  return null
}

/** 照会の明細に載せるご用件（**対客名**）。店内名を返さない。 */
async function webBookingPurpose(
  db: D1Database,
  organizationId: string,
  reservationId: string,
): Promise<{ name: string; durationMinutes: number }> {
  const row = await db
    .prepare(
      'SELECT p.name_public AS name, rp.duration_minutes AS durationMinutes ' +
        'FROM reservation_purposes rp JOIN visit_purposes p ON p.id = rp.purpose_id ' +
        'WHERE rp.organization_id = ?1 AND rp.reservation_id = ?2 ORDER BY rp.sort_order LIMIT 1',
    )
    .bind(organizationId, reservationId)
    .first<{ name: string; durationMinutes: number }>()
  return row ?? { name: 'ご来店', durationMinutes: 30 }
}

/** 照会の応答。**確認番号を持たない**（平文が返るのは予約を作った 1 回だけ）。 */
async function webReservationStatus(
  db: D1Database,
  row: WebBookingJoin,
  changeDeadlineDays: number,
) {
  const purpose = await webBookingPurpose(db, row.organizationId, row.reservationId)
  return {
    code: row.publicCode,
    status: row.webStatus,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    storeName: row.storeNamePublic ?? row.storeName,
    purposeName: purpose.name,
    durationMinutes: purpose.durationMinutes,
    contactName: row.contactName,
    changeDeadlineAt: changeDeadlineAt(toJstDateString(row.startsAt), changeDeadlineDays),
  }
}

/**
 * 確認メールを notifier へ同期で送る。**予約の D1 書き込みは先に済ませてある。**
 * 失敗しても予約を巻き戻さず、握りつぶした事実を 2 つの形で外に出す
 * （`emailed: false` と `console.error`。`04-api.md` §7.2）。
 */
async function sendReservationMail(
  env: Bindings,
  input: {
    organizationId: string
    reservationId: string
    to: string
    managementCode: string
    reservationNumber: string
    /** **`stores.name_public`**。店内名をお客様のメールに漏らさない。 */
    storeName: string
    appointmentAt: string
  },
): Promise<boolean> {
  const job = NotificationJob.parse({
    // 日時変更のたびに 1 通だけ送る（同じ日時へ何度叩いても連打しない）。
    id: `res-confirmed:${input.reservationId}:${input.appointmentAt}`,
    organizationId: input.organizationId,
    type: 'reservation.confirmed',
    payload: {
      reservationId: input.reservationId,
      to: input.to,
      managementCode: input.managementCode,
      reservationNumber: input.reservationNumber,
      storeName: input.storeName,
      appointmentAt: input.appointmentAt,
    },
  })
  let emailed = false
  try {
    const res = await env.NOTIFIER.fetch('http://notifier/api/internal/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': env.INTERNAL_KEY },
      body: JSON.stringify(job),
    })
    const parsed = NotificationResult.safeParse(await res.json().catch(() => null))
    emailed =
      parsed.success && (parsed.data.status === 'sent' || parsed.data.status === 'duplicate')
  } catch (err) {
    console.error('notify failed', { reservationId: input.reservationId, type: job.type }, err)
    return false
  }
  if (!emailed) {
    console.error('notify failed', { reservationId: input.reservationId, type: job.type })
    return false
  }
  // **送れたときだけ**控えを置く。置かなければ次の照会が再送を試みる（§7.2 の再検知）。
  await env.SHORT_LIVED.put(mailSentKey(input.organizationId, input.reservationId), job.id, {
    expirationTtl: MAIL_SENT_TTL_SECONDS,
  })
  return emailed
}

/**
 * `pending` のまま**受信日**の 24:00 JST を越えた Web 予約を自動で取り消す。
 * 起算は受信日であって来店日ではない（来店日起算だと 3 週間先の予約が居座る）。
 */
async function applyWebPublications(
  env: Bindings,
  input: { now: Date; limit: number },
): Promise<{ applied: number; skipped: number; autoCancelled: number }> {
  const nowIso = input.now.toISOString()
  const found = await env.DB.prepare(
    'SELECT w.id AS id, w.organization_id AS organizationId, w.store_id AS storeId, ' +
      'w.reservation_id AS reservationId, w.public_code AS publicCode, ' +
      'w.status AS status, w.created_at AS createdAt ' +
      "FROM web_bookings w WHERE w.status = 'pending' ORDER BY w.created_at ASC LIMIT ?1",
  )
    .bind(input.limit)
    .all<{
      id: string
      organizationId: string
      storeId: string
      reservationId: string
      publicCode: string
      status: string
      createdAt: string
    }>()

  let autoCancelled = 0
  let skipped = 0
  for (const row of found.results) {
    if (!shouldAutoCancel({ status: row.status, createdAt: row.createdAt }, input.now)) {
      skipped += 1
      continue
    }
    const alert = autoCancelledAlert({ publicCode: row.publicCode })
    // お客様の予約が消える唯一の自動処理なので、台帳・Web・お知らせを 1 バッチで書く。
    const results = await env.DB.batch([
      env.DB.prepare(
        "UPDATE web_bookings SET status = 'cancelled', cancelled_at = ?, updated_at = ? " +
          "WHERE organization_id = ? AND id = ? AND status = 'pending'",
      ).bind(nowIso, nowIso, row.organizationId, row.id),
      env.DB.prepare(
        "UPDATE reservations SET status = 'cancelled', cancelled_at = ?, cancel_reason = 'store', " +
          'updated_at = ?, version = version + 1 WHERE organization_id = ? AND id = ? ' +
          "AND status NOT IN ('cancelled','no_show') AND EXISTS (" +
          'SELECT 1 FROM web_bookings WHERE organization_id = ? AND id = ? ' +
          "AND status = 'cancelled' AND cancelled_at = ?)",
      ).bind(
        nowIso,
        nowIso,
        row.organizationId,
        row.reservationId,
        row.organizationId,
        row.id,
        nowIso,
      ),
      env.DB.prepare(
        'DELETE FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ? ' +
          'AND EXISTS (SELECT 1 FROM web_bookings WHERE organization_id = ? AND id = ? ' +
          "AND status = 'cancelled' AND cancelled_at = ?)",
      ).bind(row.organizationId, row.reservationId, row.organizationId, row.id, nowIso),
      env.DB.prepare(
        'INSERT INTO alerts (id, organization_id, store_id, code, severity, audience, title, body, ' +
          'target_type, target_id, occurred_at, read_at, resolved_at, resolved_by, created_at) ' +
          "SELECT ?,?,?,?,?,?,?,?,'reservation',?,?,NULL,NULL,NULL,? " +
          'WHERE EXISTS (SELECT 1 FROM web_bookings WHERE organization_id = ? AND id = ? ' +
          "AND status = 'cancelled' AND cancelled_at = ?) " +
          'AND NOT EXISTS (SELECT 1 FROM alerts WHERE organization_id = ? AND code = ? ' +
          "AND target_type = 'reservation' AND target_id = ?)",
      ).bind(
        crypto.randomUUID(),
        row.organizationId,
        row.storeId,
        alert.code,
        alert.severity,
        alert.audience,
        alert.title,
        alert.body,
        row.reservationId,
        nowIso,
        nowIso,
        row.organizationId,
        row.id,
        nowIso,
        row.organizationId,
        alert.code,
        row.reservationId,
      ),
    ])
    if ((results[0]?.meta.changes ?? 0) === 0) {
      skipped += 1
      continue
    }
    autoCancelled += 1
  }
  // **自動で取り消した件数を他の数に混ぜない**（0 でないことが単独で読めるようにする）。
  return { applied: found.results.length, skipped, autoCancelled }
}

type AnalyticsStore = { id: string; organizationId: string }

type AnalyticsRawReservation = {
  id: string
  organizationId: string
  storeId: string
  customerId: string | null
  source: 'phone' | 'counter' | 'web' | 'walkin'
  status: 'confirmed' | 'arrived' | 'serving' | 'done' | 'cancelled' | 'no_show'
  startsAt: string
  createdAt: string
  cancelReason: 'customer' | 'store' | 'duplicate' | 'no_show' | null
}

function analyticsDates(from: string, to: string): string[] {
  const dates: string[] = []
  for (let date = from; date <= to; date = addJstDays(date, 1)) dates.push(date)
  return dates
}

function analyticsRetentionCutoff(date: string): string {
  const value = new Date(`${date.slice(0, 7)}-01T00:00:00.000Z`)
  value.setUTCMonth(value.getUTCMonth() - 24)
  return value.toISOString().slice(0, 10)
}

function analyticsPreviousMonthRange(date: string): { from: string; to: string } {
  const monthStart = new Date(`${date.slice(0, 7)}-01T00:00:00.000Z`)
  monthStart.setUTCMonth(monthStart.getUTCMonth() - 1)
  const from = monthStart.toISOString().slice(0, 10)
  const next = new Date(monthStart)
  next.setUTCMonth(next.getUTCMonth() + 1)
  next.setUTCDate(next.getUTCDate() - 1)
  return { from, to: next.toISOString().slice(0, 10) }
}

/** トップの15日グラフを保ったまま、先週〜来週を月曜〜日曜で欠けずに読む。 */
function analyticsOverviewWeekRange(from: string, to: string): { from: string; to: string } {
  const dates = analyticsDates(from, to)
  const center = dates[Math.floor(dates.length / 2)] ?? from
  const weekday = new Date(`${center}T00:00:00.000Z`).getUTCDay()
  const monday = addJstDays(center, -((weekday + 6) % 7))
  return { from: addJstDays(monday, -7), to: addJstDays(monday, 13) }
}

function encodeAnalyticsStoreCursor(storeId: string): string {
  return btoa(storeId)
}

// 最初のページがcatch-up中であることをKVに持つ内部cursor。UUID cursor と区別して、
// 次回も先頭の同じ3店舗を再処理する。
const ANALYTICS_RETRY_FIRST_PAGE_CURSOR = btoa('analytics:retry-first-page')

function decodeAnalyticsStoreCursor(cursor: string | undefined): string | null {
  if (cursor === undefined) return null
  if (cursor === ANALYTICS_RETRY_FIRST_PAGE_CURSOR) return null
  try {
    const storeId = atob(cursor)
    return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(storeId) ? storeId : null
  } catch {
    return null
  }
}

function isAnalyticsClosed(
  date: string,
  businessHours: readonly { weekday: number; isClosed: string }[],
  exceptions: readonly { date: string; kind: string }[],
): boolean {
  const exception = exceptions.find((row) => row.date === date)
  if (exception) return exception.kind === 'closed'
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  return businessHours.find((row) => row.weekday === weekday)?.isClosed !== '0'
}

/**
 * 最大 3 店舗・31 日を、各店舗ごとの bulk read と JSON upsert で再計算する。
 * 生表はここだけが読む。表示 API は analytics_daily に閉じる。
 */
export async function rollupAnalytics(
  env: Pick<Bindings, 'DB'>,
  input: {
    from: string
    to: string
    limit: number
    storeCursor?: string
    now: Date
    completedThrough?: string
  },
) {
  const cursorId = decodeAnalyticsStoreCursor(input.storeCursor)
  if (
    input.storeCursor !== undefined &&
    input.storeCursor !== ANALYTICS_RETRY_FIRST_PAGE_CURSOR &&
    cursorId === null
  )
    throw new HTTPException(400, { message: 'invalid_cursor' })
  // 対象店舗が無効化されても、analytics_daily の保持期限だけは全体で必ず進める。
  await env.DB.prepare('DELETE FROM analytics_daily WHERE date < ?1')
    .bind(analyticsRetentionCutoff(toJstDateString(input.now)))
    .run()
  const storeRows = await env.DB.prepare(
    "SELECT id, organization_id AS organizationId FROM stores WHERE is_active = '1' " +
      'AND (?1 IS NULL OR id > ?1) ORDER BY id ASC LIMIT ?2',
  )
    .bind(cursorId, input.limit + 1)
    .all<AnalyticsStore>()
  const page = storeRows.results.slice(0, input.limit)
  const lastStore = page.at(-1)
  const pageNextStoreCursor =
    storeRows.results.length > input.limit && lastStore !== undefined
      ? encodeAnalyticsStoreCursor(lastStore.id)
      : null
  let upserted = 0
  let dropped = 0
  const failedStores: string[] = []
  let retryCurrentPage = false

  for (const store of page) {
    try {
      let storeFrom = input.from
      let storeTo = input.to
      if (input.completedThrough !== undefined) {
        const lastClosed = await env.DB.prepare(
          "SELECT MAX(date) AS date FROM analytics_daily WHERE organization_id = ?1 AND store_id = ?2 AND metric = 'closed' AND date <= ?3",
        )
          .bind(store.organizationId, store.id, input.completedThrough)
          .first<{ date: string | null }>()
        storeFrom = lastClosed?.date == null ? input.from : addJstDays(lastClosed.date, 1)
        // 両端を含め最大31日。遅延分が残れば同じページを次回も処理する。
        storeTo = addJstDays(storeFrom, 30) < input.to ? addJstDays(storeFrom, 30) : input.to
      }
      const lower = toInstant(addJstDays(storeFrom, -90), 0)
      const windowStart = toInstant(storeFrom, 0)
      const upper = toInstant(addJstDays(storeTo, 1), 0)
      // 最終日の23:59受付→翌日相談開始も待ち時間へ入れる。
      const eventUpper = toInstant(addJstDays(storeTo, 2), 0)
      const [rawReservations, businessHours, exceptions, rawEvents, staffRows] = await Promise.all([
        env.DB.prepare(
          'SELECT id, organization_id AS organizationId, store_id AS storeId, customer_id AS customerId, source, status, starts_at AS startsAt, created_at AS createdAt, cancel_reason AS cancelReason ' +
            'FROM reservations WHERE organization_id = ?1 AND store_id = ?2 AND ((starts_at >= ?3 AND starts_at < ?4) OR (created_at >= ?5 AND created_at < ?4))',
        )
          .bind(store.organizationId, store.id, lower, upper, windowStart)
          .all<AnalyticsRawReservation>(),
        env.DB.prepare(
          'SELECT weekday, is_closed AS isClosed FROM store_business_hours WHERE organization_id = ?1 AND store_id = ?2',
        )
          .bind(store.organizationId, store.id)
          .all<{ weekday: number; isClosed: string }>(),
        env.DB.prepare(
          'SELECT date, kind FROM store_calendar_exceptions WHERE organization_id = ?1 AND store_id = ?2 AND date >= ?3 AND date <= ?4',
        )
          .bind(store.organizationId, store.id, storeFrom, storeTo)
          .all<{ date: string; kind: string }>(),
        env.DB.prepare(
          'SELECT organization_id AS organizationId, store_id AS storeId, subject_id AS subjectId, stage, occurred_at AS occurredAt ' +
            'FROM visit_events WHERE organization_id = ?1 AND store_id = ?2 AND occurred_at >= ?3 AND occurred_at < ?4',
        )
          .bind(store.organizationId, store.id, windowStart, eventUpper)
          .all<AnalyticsVisitEvent>(),
        env.DB.prepare(
          'SELECT id, display_name AS label, is_active AS isActive FROM staff WHERE organization_id = ?1 AND store_id = ?2 ORDER BY sort_order ASC, id ASC',
        )
          .bind(store.organizationId, store.id)
          .all<{ id: string; label: string; isActive: string }>(),
      ])
      const reservationIds = [...new Set(rawReservations.results.map((row) => row.id))]
      const reservationIdsJson = JSON.stringify(reservationIds)
      const currentDoneReservationIds = rawReservations.results
        .filter(
          (row) => row.status === 'done' && row.startsAt >= windowStart && row.startsAt < upper,
        )
        .map((row) => row.id)
      const currentDoneReservationIdsJson = JSON.stringify(currentDoneReservationIds)
      const [purposeRows, assignmentRows, priorVisitRows] = await Promise.all([
        reservationIds.length === 0
          ? Promise.resolve({
              results: [] as { reservationId: string; purposeId: string; label: string }[],
            })
          : env.DB.prepare(
              "SELECT rp.reservation_id AS reservationId, rp.purpose_id AS purposeId, COALESCE(p.name_internal, 'ご来店') AS label " +
                'FROM reservation_purposes rp LEFT JOIN visit_purposes p ON p.organization_id = rp.organization_id AND p.id = rp.purpose_id ' +
                'WHERE rp.organization_id = ?1 AND rp.reservation_id IN (SELECT value FROM json_each(?2))',
            )
              .bind(store.organizationId, reservationIdsJson)
              .all<{ reservationId: string; purposeId: string; label: string }>(),
        reservationIds.length === 0
          ? Promise.resolve({ results: [] as { reservationId: string; staffId: string | null }[] })
          : env.DB.prepare(
              "SELECT reservation_id AS reservationId, target_id AS staffId FROM reservation_assignments WHERE organization_id = ?1 AND kind = 'staff' AND reservation_id IN (SELECT value FROM json_each(?2))",
            )
              .bind(store.organizationId, reservationIdsJson)
              .all<{ reservationId: string; staffId: string | null }>(),
        currentDoneReservationIds.length === 0
          ? Promise.resolve({
              results: [] as { reservationId: string; visitCountBefore: number }[],
            })
          : env.DB.prepare(
              "SELECT target.id AS reservationId, COUNT(prior.id) AS visitCountBefore FROM reservations AS target LEFT JOIN reservations AS prior ON prior.organization_id = target.organization_id AND prior.customer_id = target.customer_id AND prior.status = 'done' AND prior.starts_at < target.starts_at WHERE target.organization_id = ?1 AND target.id IN (SELECT value FROM json_each(?2)) GROUP BY target.id",
            )
              .bind(store.organizationId, currentDoneReservationIdsJson)
              .all<{ reservationId: string; visitCountBefore: number }>(),
      ])
      const purposes = new Map<string, string[]>()
      const purposeLabels = new Map<string, string>()
      for (const row of purposeRows.results)
        purposes.set(row.reservationId, [...(purposes.get(row.reservationId) ?? []), row.purposeId])
      for (const row of purposeRows.results) purposeLabels.set(row.purposeId, row.label)
      const staffByReservation = new Map<string, string | null>()
      for (const row of assignmentRows.results)
        if (!staffByReservation.has(row.reservationId))
          staffByReservation.set(row.reservationId, row.staffId)
      const visitCountsBefore = new Map(
        priorVisitRows.results.map((row) => [row.reservationId, row.visitCountBefore]),
      )
      const reservations: AnalyticsReservation[] = rawReservations.results.map((row) => ({
        ...row,
        staffId: staffByReservation.get(row.id) ?? null,
        purposeIds: purposes.get(row.id) ?? [],
        purposeLabels: Object.fromEntries(purposeLabels),
        visitCountBefore: row.status === 'done' ? (visitCountsBefore.get(row.id) ?? 0) : null,
      }))
      const rows = analyticsDates(storeFrom, storeTo).flatMap((date) => {
        const result = rollupAnalyticsDay({
          organizationId: store.organizationId,
          storeId: store.id,
          date,
          now: input.now,
          completedThrough: input.completedThrough,
          isClosed: isAnalyticsClosed(date, businessHours.results, exceptions.results),
          reservations,
          visitEvents: rawEvents.results,
          staff: staffRows.results.map((staff) => ({
            id: staff.id,
            label: staff.label,
            isActive: staff.isActive === '1',
          })),
        })
        dropped += result.dropped.cancellationReservationIds.length
        return result.rows
      })
      const nowIso = input.now.toISOString()
      const json = JSON.stringify(
        rows.map((row) => ({
          ...row,
          id: crypto.randomUUID(),
          createdAt: nowIso,
          updatedAt: nowIso,
        })),
      )
      const writes = [
        env.DB.prepare(
          'DELETE FROM analytics_daily WHERE organization_id = ?1 AND store_id = ?2 AND date >= ?3 AND date <= ?4',
        ).bind(store.organizationId, store.id, storeFrom, storeTo),
      ]
      if (rows.length > 0) {
        writes.splice(
          1,
          0,
          env.DB.prepare(
            'INSERT INTO analytics_daily (id, organization_id, store_id, date, metric, dimension, dimension_key, dimension_label, value, created_at, updated_at) ' +
              "SELECT json_extract(value, '$.id'), json_extract(value, '$.organizationId'), json_extract(value, '$.storeId'), json_extract(value, '$.date'), json_extract(value, '$.metric'), json_extract(value, '$.dimension'), json_extract(value, '$.dimensionKey'), json_extract(value, '$.dimensionLabel'), json_extract(value, '$.value'), json_extract(value, '$.createdAt'), json_extract(value, '$.updatedAt') FROM json_each(?1) WHERE 1 " +
              'ON CONFLICT(organization_id, store_id, date, metric, dimension, dimension_key) DO UPDATE SET dimension_label = excluded.dimension_label, value = excluded.value, updated_at = excluded.updated_at',
          ).bind(json),
        )
      }
      await env.DB.batch(writes)
      upserted += rows.length
      if (input.completedThrough !== undefined && storeTo < input.completedThrough)
        retryCurrentPage = true
    } catch (err) {
      console.error('analytics rollup failed', { storeId: store.id }, err)
      failedStores.push(store.id)
      if (input.completedThrough !== undefined) retryCurrentPage = true
    }
  }
  const nextStoreCursor = retryCurrentPage
    ? (input.storeCursor ?? ANALYTICS_RETRY_FIRST_PAGE_CURSOR)
    : pageNextStoreCursor
  return {
    processedStores: page.length,
    failedStores,
    nextStoreCursor,
    from: input.from,
    to: input.to,
    upserted,
    dropped,
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
        target: [
          storeMemberships.organizationId,
          storeMemberships.userId,
          storeMemberships.storeId,
        ],
        set: { id: row.id, permissions: row.permissions },
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

  /* --- 端末と業務セッション（P10） -------------------------------------- */

  .get('/api/staff/terminals', zValidator('query', TerminalListQuery), async (c) => {
    const { org } = c.get('auth')
    const query = c.req.valid('query')
    if (!(await findStore(drizzle(c.env.DB), org, query.storeId))) {
      return c.json({ error: 'not_found' }, 404)
    }
    const terminalIdHeader = c.req.header('x-terminal-id')
    const terminalSessionHeader = c.req.header('x-terminal-session')
    if (terminalIdHeader !== undefined || terminalSessionHeader !== undefined) {
      const session = await authenticatedTerminalSession(c, { storeId: query.storeId })
      await c.env.DB.prepare(
        'UPDATE terminals SET last_seen_at = ? WHERE organization_id = ? AND store_id = ? AND id = ?',
      )
        .bind(
          new Date(c.env.TEST_NOW ?? Date.now()).toISOString(),
          org,
          query.storeId,
          session.terminalId,
        )
        .run()
    }
    const clauses = ['organization_id = ?', 'store_id = ?']
    const params: unknown[] = [org, query.storeId]
    if (!query.includeInactive) clauses.push("is_active = '1'")
    if (query.kind !== undefined) {
      clauses.push('kind = ?')
      params.push(query.kind)
    }
    const rows = await c.env.DB.prepare(
      'SELECT id, store_id AS storeId, name, kind, place_note AS placeNote, ' +
        'device_label AS deviceLabel, pin_hash AS pinHash, auto_lock_seconds AS autoLockSeconds, ' +
        'last_seen_at AS lastSeenAt, is_active AS isActive, version, created_at AS createdAt ' +
        `FROM terminals WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC`,
    )
      .bind(...params)
      .all<{
        id: string
        storeId: string
        name: string
        kind: 'shared' | 'personal'
        placeNote: string | null
        deviceLabel: string | null
        pinHash: string | null
        autoLockSeconds: number
        lastSeenAt: string | null
        isActive: string
        version: number
        createdAt: string
      }>()
    const now = new Date(c.env.TEST_NOW ?? Date.now())
    return c.json(
      Terminal.array().parse(
        rows.results.map((row) => ({
          id: row.id,
          storeId: row.storeId,
          name: row.name,
          kind: row.kind,
          placeNote: row.placeNote ?? '',
          deviceLabel: row.deviceLabel ?? '',
          autoLockSeconds: row.autoLockSeconds,
          isActive: row.isActive === '1',
          hasPin: row.pinHash !== null,
          lastSeenAt: row.lastSeenAt,
          isOnline: isOnline(row.lastSeenAt, now),
          version: row.version,
          createdAt: row.createdAt,
        })),
      ),
    )
  })

  .post(
    '/api/staff/terminals/:terminalId/sessions',
    zValidator('json', TerminalSessionStart),
    async (c) => {
      const { org } = c.get('auth')
      const terminalId = c.req.param('terminalId')
      const input = c.req.valid('json')
      const terminal = await c.env.DB.prepare(
        "SELECT id, store_id AS storeId, pin_hash AS pinHash, auto_lock_seconds AS autoLockSeconds FROM terminals WHERE organization_id = ? AND id = ? AND is_active = '1'",
      )
        .bind(org, terminalId)
        .first<{ id: string; storeId: string; pinHash: string | null; autoLockSeconds: number }>()
      if (terminal === null) return c.json({ error: 'not_found' }, 404)

      const staffId = input.mode === 'personal' ? input.staffId : null
      let storedHash = terminal.pinHash
      if (staffId !== null) {
        const member = await c.env.DB.prepare(
          "SELECT pin_hash AS pinHash FROM staff WHERE organization_id = ? AND store_id = ? AND id = ? AND is_active = '1'",
        )
          .bind(org, terminal.storeId, staffId)
          .first<{ pinHash: string | null }>()
        if (member === null) return c.json({ error: 'not_found' }, 404)
        storedHash = member.pinHash
      }

      const failureKey = pinFailureKey(org, terminalId, staffId)
      const now = new Date(c.env.TEST_NOW ?? Date.now())
      const nowIso = now.toISOString()
      const rawFailure = await c.env.SHORT_LIVED.get(failureKey)
      const failure = parsePinFailure(rawFailure)
      // Workers KV のTTL下限は60秒。値の時刻で30秒境界を守り、物理削除は60秒に任せる。
      const previous =
        failure !== null && now.getTime() - Date.parse(failure.failedAt) <= 30_000
          ? failure.attempts
          : 0
      if (
        failure !== null &&
        failure.attempts >= 3 &&
        isPinLocked(new Date(failure.failedAt), now)
      ) {
        const elapsedSeconds = Math.floor((now.getTime() - Date.parse(failure.failedAt)) / 1000)
        return c.json(
          {
            error: 'pin_locked',
            retryAfterSeconds: Math.max(1, 30 - elapsedSeconds),
            remainingAttempts: 0,
          },
          429,
        )
      }

      const stretched = await stretchPin(
        input.pin,
        org,
        staffId ?? terminalId,
        c.env.TEST_NOW === undefined ? undefined : 1,
      )
      const verified =
        storedHash !== null && (await verifyStretched(stretched, c.env.AUTH_PEPPER, storedHash))
      if (!verified) {
        const state = nextFailureState(previous)
        await c.env.SHORT_LIVED.put(
          failureKey,
          JSON.stringify({ attempts: state.attempts, failedAt: nowIso }),
          { expirationTtl: 60 },
        )
        await c.env.DB.prepare(
          'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
            "VALUES (?,?,?,'terminal',?,?, 'terminal.pin.failed','terminals',?,NULL,?,?,?)",
        )
          .bind(
            crypto.randomUUID(),
            org,
            terminal.storeId,
            terminalId,
            terminalId,
            terminalId,
            JSON.stringify({ staffId, remainingAttempts: state.remainingAttempts }),
            crypto.randomUUID(),
            nowIso,
          )
          .run()
        if (state.locked) {
          return c.json({ error: 'pin_locked', retryAfterSeconds: 30, remainingAttempts: 0 }, 429)
        }
        return c.json({ error: 'pin_invalid', remainingAttempts: state.remainingAttempts }, 401)
      }

      await c.env.SHORT_LIVED.delete(failureKey)
      const sessionId = crypto.randomUUID()
      const expiresAt =
        input.mode === 'shared'
          ? sharedExpiresAtFrom(now)
          : expiresAtFrom(now, terminal.autoLockSeconds)
      const correlationId = crypto.randomUUID()
      const credential = await sessionCredential()
      // stale read を置かず、既存行の終了監査→全 revoke→新規行→開始監査を1 batchにする。
      const result = await c.env.DB.batch([
        c.env.DB.prepare(
          'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
            "SELECT id, organization_id, store_id, ?, ?, terminal_id, 'terminal.session.ended', 'terminals', terminal_id, NULL, json_object('reason','taken_over','sessionId',id), ?, ? FROM terminal_sessions " +
            'WHERE organization_id = ? AND terminal_id = ? AND revoked_at IS NULL',
        ).bind(
          input.mode === 'personal' ? 'staff' : 'terminal',
          staffId ?? terminalId,
          correlationId,
          nowIso,
          org,
          terminalId,
        ),
        c.env.DB.prepare(
          'UPDATE terminal_sessions SET revoked_at = ? WHERE organization_id = ? AND terminal_id = ? AND revoked_at IS NULL',
        ).bind(nowIso, org, terminalId),
        c.env.DB.prepare(
          'INSERT INTO terminal_sessions (id, organization_id, store_id, terminal_id, staff_id, mode, credential_hash, started_at, expires_at, revoked_at, created_at) ' +
            "SELECT ?,?,?,?,?,?,?,?,?,NULL,? WHERE EXISTS (SELECT 1 FROM terminals WHERE organization_id = ? AND id = ? AND is_active = '1')",
        ).bind(
          sessionId,
          org,
          terminal.storeId,
          terminalId,
          staffId,
          input.mode,
          credential.hash,
          nowIso,
          expiresAt,
          nowIso,
          org,
          terminalId,
        ),
        c.env.DB.prepare(
          'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
            "SELECT ?,?,?,?,?,?,?,'terminals',?,NULL,?,?,? WHERE EXISTS (SELECT 1 FROM terminal_sessions WHERE organization_id = ? AND id = ? AND credential_hash = ? AND revoked_at IS NULL)",
        ).bind(
          crypto.randomUUID(),
          org,
          terminal.storeId,
          input.mode === 'personal' ? 'staff' : 'terminal',
          staffId ?? terminalId,
          terminalId,
          'terminal.session.started',
          terminalId,
          JSON.stringify({ mode: input.mode, sessionId }),
          correlationId,
          nowIso,
          org,
          sessionId,
          credential.hash,
        ),
        c.env.DB.prepare(
          "UPDATE terminals SET last_seen_at = ? WHERE organization_id = ? AND id = ? AND is_active = '1'",
        ).bind(nowIso, org, terminalId),
      ])
      if ((result[2]?.meta.changes ?? 0) === 0) return c.json({ error: 'not_found' }, 404)
      return c.json(
        TerminalSession.parse({
          id: sessionId,
          terminalId,
          staffId,
          mode: input.mode,
          startedAt: nowIso,
          expiresAt,
          sessionToken: credential.token,
        }),
      )
    },
  )

  .post(
    '/api/staff/terminals',
    requireStorePermission('terminal.manage', { storeIdFrom: 'query' }),
    requirePersonalMode(),
    zValidator('json', TerminalInput),
    async (c) => {
      const { org } = c.get('auth')
      const storeId = c.req.query('storeId')
      if (!storeId || !(await findStore(drizzle(c.env.DB), org, storeId))) {
        return c.json({ error: 'not_found' }, 404)
      }
      const input = c.req.valid('json')
      if (input.pin !== undefined && isWeakPin(input.pin)) {
        return c.json({ error: 'weak_pin' }, 400)
      }
      const id = crypto.randomUUID()
      const nowIso = new Date(c.env.TEST_NOW ?? Date.now()).toISOString()
      const pinHash =
        input.pin === undefined
          ? null
          : await hashStretched(
              await stretchPin(input.pin, org, id, c.env.TEST_NOW === undefined ? undefined : 1),
              c.env.AUTH_PEPPER,
            )
      const correlationId = crypto.randomUUID()
      const actor = await operationActor(c, storeId, c.get('auth').sub)
      await c.env.DB.batch([
        c.env.DB.prepare(
          'INSERT INTO terminals (id, organization_id, store_id, name, kind, place_note, device_label, pin_hash, auto_lock_seconds, last_seen_at, is_active, version, created_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,1,?)',
        ).bind(
          id,
          org,
          storeId,
          input.name,
          input.kind,
          input.placeNote,
          input.deviceLabel,
          pinHash,
          input.autoLockSeconds,
          flag(input.isActive),
          nowIso,
        ),
        c.env.DB.prepare(
          'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
            "VALUES (?,?,?,?,?,?,'terminal.created','terminals',?,NULL,?,?,?)",
        ).bind(
          crypto.randomUUID(),
          org,
          storeId,
          actor.actorType,
          actor.actorId,
          actor.terminalId,
          id,
          JSON.stringify({ name: input.name, kind: input.kind, hasPin: pinHash !== null }),
          correlationId,
          nowIso,
        ),
      ])
      return c.json(
        Terminal.parse({
          id,
          storeId,
          name: input.name,
          kind: input.kind,
          placeNote: input.placeNote,
          deviceLabel: input.deviceLabel,
          autoLockSeconds: input.autoLockSeconds,
          isActive: input.isActive,
          hasPin: pinHash !== null,
          lastSeenAt: null,
          isOnline: false,
          version: 1,
          createdAt: nowIso,
        }),
      )
    },
  )

  .patch(
    '/api/staff/terminals/:terminalId',
    requireStorePermission('terminal.manage'),
    requirePersonalMode(),
    zValidator('json', TerminalPatch),
    async (c) => {
      const { org, sub } = c.get('auth')
      const terminalId = c.req.param('terminalId')
      const input = c.req.valid('json')
      const current = await c.env.DB.prepare(
        'SELECT id, store_id AS storeId, name, kind, place_note AS placeNote, device_label AS deviceLabel, pin_hash AS pinHash, auto_lock_seconds AS autoLockSeconds, last_seen_at AS lastSeenAt, is_active AS isActive, version, created_at AS createdAt FROM terminals WHERE organization_id = ? AND id = ?',
      )
        .bind(org, terminalId)
        .first<{
          id: string
          storeId: string
          name: string
          kind: 'shared' | 'personal'
          placeNote: string | null
          deviceLabel: string | null
          pinHash: string | null
          autoLockSeconds: number
          lastSeenAt: string | null
          isActive: string
          version: number
          createdAt: string
        }>()
      if (current === null) return c.json({ error: 'not_found' }, 404)
      if (
        !(await permittedStores(drizzle(c.env.DB), org, sub, 'terminal.manage')).includes(
          current.storeId,
        )
      ) {
        return c.json({ error: 'forbidden' }, 403)
      }
      if (input.pin !== undefined && isWeakPin(input.pin)) {
        return c.json({ error: 'weak_pin' }, 400)
      }
      const nextPinHash =
        input.pin === undefined
          ? current.pinHash
          : await hashStretched(
              await stretchPin(
                input.pin,
                org,
                terminalId,
                c.env.TEST_NOW === undefined ? undefined : 1,
              ),
              c.env.AUTH_PEPPER,
            )
      const next = {
        name: input.name ?? current.name,
        kind: input.kind ?? current.kind,
        placeNote: input.placeNote ?? current.placeNote ?? '',
        deviceLabel: input.deviceLabel ?? current.deviceLabel ?? '',
        autoLockSeconds: input.autoLockSeconds ?? current.autoLockSeconds,
        isActive: input.isActive ?? current.isActive === '1',
        hasPin: nextPinHash !== null,
      }
      const nowIso = new Date(c.env.TEST_NOW ?? Date.now()).toISOString()
      const guard =
        'EXISTS (SELECT 1 FROM terminals WHERE organization_id = ? AND id = ? AND version = ?)'
      const actor = await operationActor(c, current.storeId, sub)
      const update = c.env.DB.prepare(
        'UPDATE terminals SET name = ?, kind = ?, place_note = ?, device_label = ?, pin_hash = ?, auto_lock_seconds = ?, is_active = ?, version = version + 1 WHERE organization_id = ? AND id = ? AND version = ?',
      ).bind(
        next.name,
        next.kind,
        next.placeNote,
        next.deviceLabel,
        nextPinHash,
        next.autoLockSeconds,
        flag(next.isActive),
        org,
        terminalId,
        input.version,
      )
      const writes: Statement[] = [
        c.env.DB.prepare(
          'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
            `SELECT ?, ?, ?, ?, ?, ?, 'terminal.updated', 'terminals', ?, ?, ?, ?, ? WHERE ${guard}`,
        ).bind(
          crypto.randomUUID(),
          org,
          current.storeId,
          actor.actorType,
          actor.actorId,
          actor.terminalId,
          terminalId,
          JSON.stringify({
            name: current.name,
            kind: current.kind,
            placeNote: current.placeNote ?? '',
            deviceLabel: current.deviceLabel ?? '',
            autoLockSeconds: current.autoLockSeconds,
            isActive: current.isActive === '1',
            hasPin: current.pinHash !== null,
          }),
          JSON.stringify(next),
          crypto.randomUUID(),
          nowIso,
          org,
          terminalId,
          input.version,
        ),
      ]
      if (!next.isActive) {
        writes.push(
          c.env.DB.prepare(
            'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
              "SELECT s.id, s.organization_id, s.store_id, ?, ?, ?, 'terminal.session.ended', 'terminals', s.terminal_id, NULL, json_object('reason','terminal_inactivated','sessionId',s.id), ?, ? FROM terminal_sessions s " +
              'WHERE s.organization_id = ? AND s.terminal_id = ? AND s.revoked_at IS NULL ' +
              `AND ${guard}`,
          ).bind(
            actor.actorType,
            actor.actorId,
            actor.terminalId,
            crypto.randomUUID(),
            nowIso,
            org,
            terminalId,
            org,
            terminalId,
            input.version,
          ),
          c.env.DB.prepare(
            'UPDATE terminal_sessions SET revoked_at = ? WHERE organization_id = ? AND terminal_id = ? AND revoked_at IS NULL ' +
              `AND ${guard}`,
          ).bind(nowIso, org, terminalId, org, terminalId, input.version),
        )
      }
      writes.push(update)
      const result = await c.env.DB.batch(writes)
      if ((result.at(-1)?.meta.changes ?? 0) === 0) {
        return c.json({ error: 'version_conflict', current: current.version }, 409)
      }
      return c.json(
        Terminal.parse({
          id: terminalId,
          storeId: current.storeId,
          ...next,
          lastSeenAt: current.lastSeenAt,
          isOnline: isOnline(current.lastSeenAt, new Date(c.env.TEST_NOW ?? Date.now())),
          version: input.version + 1,
          createdAt: current.createdAt,
        }),
      )
    },
  )

  .delete('/api/staff/terminals/:terminalId/sessions/:sessionId', async (c) => {
    const { org } = c.get('auth')
    const nowIso = new Date(c.env.TEST_NOW ?? Date.now()).toISOString()
    const terminalId = c.req.param('terminalId')
    const sessionId = c.req.param('sessionId')
    const session = await authenticatedTerminalSession(c, { terminalId, sessionId })
    const actorType =
      session.authorization === 'personal' && session.staffId !== null ? 'staff' : 'terminal'
    const actorId = actorType === 'staff' ? session.staffId : terminalId
    const guard =
      'organization_id = ? AND terminal_id = ? AND id = ? AND credential_hash = ? AND revoked_at IS NULL'
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
          `SELECT ?,?,?,?,?,?, 'terminal.session.ended','terminals',?,NULL,?,?,? WHERE EXISTS (SELECT 1 FROM terminal_sessions WHERE ${guard})`,
      ).bind(
        crypto.randomUUID(),
        org,
        session.storeId,
        actorType,
        actorId,
        terminalId,
        terminalId,
        JSON.stringify({ sessionId, reason: 'ended' }),
        crypto.randomUUID(),
        nowIso,
        org,
        terminalId,
        sessionId,
        session.credentialHash,
      ),
      c.env.DB.prepare(`UPDATE terminal_sessions SET revoked_at = ? WHERE ${guard}`).bind(
        nowIso,
        org,
        terminalId,
        sessionId,
        session.credentialHash,
      ),
    ])
    if ((result[1]?.meta.changes ?? 0) === 0) return terminalSessionInvalid(c)
    return c.json({ id: sessionId, deleted: true })
  })

  .post('/api/staff/terminals/:terminalId/elevate', zValidator('json', ReauthInput), async (c) => {
    const { org } = c.get('auth')
    const terminalId = c.req.param('terminalId')
    const input = c.req.valid('json')
    const now = new Date(c.env.TEST_NOW ?? Date.now())
    const nowIso = now.toISOString()
    const authenticated = await authenticatedTerminalSession(c, { terminalId })
    if (authenticated.mode !== 'shared' || authenticated.authorization !== 'shared') {
      return c.json({ error: 'personal_mode_required' }, 403)
    }
    const terminal = await c.env.DB.prepare(
      'SELECT auto_lock_seconds AS autoLockSeconds FROM terminals WHERE organization_id = ? AND store_id = ? AND id = ?',
    )
      .bind(org, authenticated.storeId, terminalId)
      .first<{ autoLockSeconds: number }>()
    if (terminal === null) return terminalSessionInvalid(c)
    const current = { ...authenticated, autoLockSeconds: terminal.autoLockSeconds }
    const member = await c.env.DB.prepare(
      "SELECT pin_hash AS pinHash FROM staff WHERE organization_id = ? AND store_id = ? AND id = ? AND is_active = '1'",
    )
      .bind(org, current.storeId, input.staffId)
      .first<{ pinHash: string | null }>()
    if (member === null) return c.json({ error: 'not_found' }, 404)
    const failureKey = pinFailureKey(org, terminalId, input.staffId)
    const failure = parsePinFailure(await c.env.SHORT_LIVED.get(failureKey))
    const previous =
      failure !== null && now.getTime() - Date.parse(failure.failedAt) <= 30_000
        ? failure.attempts
        : 0
    if (failure !== null && previous >= 3 && isPinLocked(new Date(failure.failedAt), now)) {
      const elapsedSeconds = Math.floor((now.getTime() - Date.parse(failure.failedAt)) / 1000)
      return c.json(
        {
          error: 'pin_locked',
          retryAfterSeconds: Math.max(1, 30 - elapsedSeconds),
          remainingAttempts: 0,
        },
        429,
      )
    }
    const stretched = await stretchPin(
      input.pin,
      org,
      input.staffId,
      c.env.TEST_NOW === undefined ? undefined : 1,
    )
    if (
      member.pinHash === null ||
      !(await verifyStretched(stretched, c.env.AUTH_PEPPER, member.pinHash))
    ) {
      const state = nextFailureState(previous)
      await c.env.SHORT_LIVED.put(
        failureKey,
        JSON.stringify({ attempts: state.attempts, failedAt: nowIso }),
        { expirationTtl: 60 },
      )
      await c.env.DB.prepare(
        "INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) VALUES (?,?,?,'terminal',?,?,'terminal.pin.failed','terminals',?,NULL,?,?,?)",
      )
        .bind(
          crypto.randomUUID(),
          org,
          current.storeId,
          terminalId,
          terminalId,
          terminalId,
          JSON.stringify({ staffId: input.staffId, remainingAttempts: state.remainingAttempts }),
          crypto.randomUUID(),
          nowIso,
        )
        .run()
      return state.locked
        ? c.json({ error: 'pin_locked', retryAfterSeconds: 30, remainingAttempts: 0 }, 429)
        : c.json({ error: 'pin_invalid', remainingAttempts: state.remainingAttempts }, 401)
    }
    await c.env.SHORT_LIVED.delete(failureKey)
    const sessionId = crypto.randomUUID()
    const expiresAt = expiresAtFrom(now, current.autoLockSeconds)
    const credential = await sessionCredential()
    const guard =
      "organization_id = ? AND terminal_id = ? AND id = ? AND credential_hash = ? AND mode = 'shared' AND revoked_at IS NULL AND expires_at > ?"
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO terminal_sessions (id, organization_id, store_id, terminal_id, staff_id, mode, credential_hash, started_at, expires_at, revoked_at, created_at) ' +
          `SELECT ?,?,?,?,?,'personal',?,?,?,NULL,? WHERE EXISTS (SELECT 1 FROM terminal_sessions WHERE ${guard})`,
      ).bind(
        sessionId,
        org,
        current.storeId,
        terminalId,
        input.staffId,
        credential.hash,
        nowIso,
        expiresAt,
        nowIso,
        org,
        terminalId,
        current.id,
        current.credentialHash,
        nowIso,
      ),
      c.env.DB.prepare(
        'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
          `SELECT ?,?,?, 'staff',?,?, 'terminal.mode.elevated','terminals',?,NULL,?,?,? WHERE EXISTS (SELECT 1 FROM terminal_sessions WHERE ${guard})`,
      ).bind(
        crypto.randomUUID(),
        org,
        current.storeId,
        input.staffId,
        terminalId,
        terminalId,
        JSON.stringify({ reason: input.reason }),
        crypto.randomUUID(),
        nowIso,
        org,
        terminalId,
        current.id,
        current.credentialHash,
        nowIso,
      ),
      c.env.DB.prepare(`UPDATE terminal_sessions SET revoked_at = ? WHERE ${guard}`).bind(
        nowIso,
        org,
        terminalId,
        current.id,
        current.credentialHash,
        nowIso,
      ),
    ])
    if ((result[2]?.meta.changes ?? 0) === 0) return terminalSessionInvalid(c)
    return c.json(
      TerminalSession.parse({
        id: sessionId,
        terminalId,
        staffId: input.staffId,
        mode: 'personal',
        startedAt: nowIso,
        expiresAt,
        sessionToken: credential.token,
      }),
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
    '/api/staff/stores/:storeId/staff/:staffId/pin',
    requireStorePermission('settings.manage'),
    requirePersonalMode('スタッフの暗証番号の再設定'),
    zValidator('json', StaffPinInput),
    async (c) => {
      const { org } = c.get('auth')
      const storeId = c.req.param('storeId')
      const staffId = c.req.param('staffId')
      const input = c.req.valid('json')
      const member = await c.env.DB.prepare(
        'SELECT id FROM staff WHERE organization_id = ? AND store_id = ? AND id = ?',
      )
        .bind(org, storeId, staffId)
        .first()
      if (member === null) return c.json({ error: 'not_found' }, 404)
      if (isWeakPin(input.pin)) return c.json({ error: 'weak_pin' }, 400)

      const nowIso = new Date(c.env.TEST_NOW ?? Date.now()).toISOString()
      const pinHash = await hashStretched(
        await stretchPin(input.pin, org, staffId, c.env.TEST_NOW === undefined ? undefined : 1),
        c.env.AUTH_PEPPER,
      )
      const actor = await operationActor(c, storeId, c.get('auth').sub)
      await c.env.DB.batch([
        c.env.DB.prepare(
          'UPDATE staff SET pin_hash = ?, pin_updated_at = ?, updated_at = ? WHERE organization_id = ? AND store_id = ? AND id = ?',
        ).bind(pinHash, nowIso, nowIso, org, storeId, staffId),
        c.env.DB.prepare(
          "INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) VALUES (?,?,?,?,?,?,?,'staff',?,NULL,?,?,?)",
        ).bind(
          crypto.randomUUID(),
          org,
          storeId,
          actor.actorType,
          actor.actorId,
          actor.terminalId,
          'staff.pin.updated',
          staffId,
          JSON.stringify({ pinUpdatedAt: nowIso }),
          crypto.randomUUID(),
          nowIso,
        ),
      ])
      return c.json(PinSetResult.parse({ staffId, updatedAt: nowIso }))
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
      const actor = await operationActor(c, reservation.storeId, actorId)
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
        actorId: actor.actorId,
        actorType: actor.actorType,
        terminalId: actor.terminalId,
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

      /*
       * Web のご予約の日時が動いたら、確定のメールを新しい日時で送り直す。
       *
       * 変更・取消の型は `NotificationJob` に無く、足すのは別サービスの契約変更
       * （＝人間の承認事項）なので、**日時だけを変えたときに `reservation.confirmed`
       * を送り直す**という決めでこれを賄う。決めはあったのに配線が無く、変更の面が
       * 「変更をメールでお知らせします」と言いながら 1 通も送っていなかった
       * （実装不足の洗い出し change-cancel-02）。
       * 鍵は「ご予約 id + 新しい日時」なので、同じ日時へ何度直しても 1 通に収まる。
       */
      if (startsAt !== null && startsAt !== reservation.startsAt) {
        const web = await c.env.DB.prepare(
          'SELECT w.contact_email AS contactEmail, w.public_code AS publicCode, ' +
            's.name AS storeName, s.name_public AS storeNamePublic ' +
            'FROM web_bookings w JOIN stores s ON s.organization_id = w.organization_id AND s.id = w.store_id ' +
            "WHERE w.organization_id = ? AND w.reservation_id = ? AND w.status <> 'cancelled' LIMIT 1",
        )
          .bind(org, reservationId)
          .first<{
            contactEmail: string
            publicCode: string
            storeName: string
            storeNamePublic: string | null
          }>()
        if (web !== null && web !== undefined && web.contactEmail !== '') {
          await sendReservationMail(c.env, {
            organizationId: org,
            reservationId,
            to: web.contactEmail,
            managementCode: web.publicCode,
            reservationNumber: web.publicCode,
            // 店内名をお客様のメールに漏らさない。
            storeName: web.storeNamePublic ?? web.storeName,
            appointmentAt: startsAt,
          }).catch(() => undefined)
        }
      }
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
      const actor = await operationActor(c, found.storeId, actorId)
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
          actorId: actor.actorId,
          actorType: actor.actorType,
          terminalId: actor.terminalId,
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
        'a.occurred_at AS occurredAt, COALESCE(s.display_name, t.name) AS actorName FROM audit_events a ' +
        'LEFT JOIN staff s ON s.organization_id = a.organization_id AND s.id = a.actor_id ' +
        'LEFT JOIN terminals t ON t.organization_id = a.organization_id AND t.id = a.actor_id ' +
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

    const customer =
      input.customerId === undefined
        ? null
        : await findLiveCustomer(c.env.DB, org, input.customerId)
    if (input.customerId !== undefined && customer === null) {
      if (idempotencyKey !== null) await releaseIdempotency(c.env.DB, idempotencyKey)
      return c.json({ error: 'not_found' }, 404)
    }

    const reservationId = crypto.randomUUID()
    const correlationId = crypto.randomUUID()
    const actorId = await actorStaffId(db, org, input.storeId, sub)
    const actor = await operationActor(c, input.storeId, actorId)
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
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        visitCount: customer?.visitCount ?? null,
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
        createdBy: actor.actorType === 'staff' ? actor.actorId : null,
        cancelledAt: null,
        cancelReason: null,
      })
      const results = await c.env.DB.batch(
        bookingStatements(c.env.DB, {
          organizationId: org,
          storeId: input.storeId,
          reservationId,
          code,
          customerId: input.customerId ?? null,
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
          actorId: actor.actorId,
          actorType: actor.actorType,
          terminalId: actor.terminalId,
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
    const actor = await operationActor(c, storeId, actorId)
    await c.env.DB.prepare(
      'INSERT INTO reception_sessions (id, organization_id, store_id, reservation_id, terminal_id, actor_id, started_at, ended_at, outcome, draft_json, created_at) VALUES (?,?,?,NULL,?,?,?,NULL,NULL,NULL,?)',
    )
      .bind(
        id,
        org,
        storeId,
        actor.terminalId,
        actor.actorType === 'staff' ? actor.actorId : null,
        startedAt,
        startedAt,
      )
      .run()
    return c.json(
      ReceptionSession.parse({
        id,
        storeId,
        reservationId: null,
        terminalId: actor.terminalId,
        actorId: actor.actorType === 'staff' ? actor.actorId : null,
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
   * 受けかけの受付を読み直す（端末が下書きから続きを伺うため）。
   *
   * 隣の `GET /api/staff/reception-sessions/:sessionId` と分けているのは、
   * **あちらが受付履歴の詳細（`ReceptionHistoryDetail`）を返すから**である。
   * 受付の面が欲しいのは伺った内容そのもの（`draft`）で、履歴の詳細は下書きを持たない。
   * 1 本にまとめようとして片方の形で返していたため、端末側の `safeParse` が必ず落ち、
   * iPadOS の Safari がタブを捨てて戻るたびに工程 1 からやり直しになっていた。
   */
  .get('/api/staff/reception-sessions/:sessionId/draft', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const row = await findReceptionSession(db, org, c.req.param('sessionId'))
    if (row === null) return c.json({ error: 'not_found' }, 404)
    return c.json(ReceptionSession.parse(toReceptionSession(row)))
  })

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
            `SELECT ?, ?, ?, 'staff', ?, NULL, 'customer.merged', 'customers', ?, NULL, ?, ?, ? WHERE ${guard.clause}`,
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
        /*
         * 置き換える 1 枚を人が選んでいれば、先にその 1 枚を退ける。
         * **黙って古い 1 枚を消さない**という決めはそのままで、消すのは
         * 画面で選ばれた 1 枚だけである（実装不足の洗い出し customers-02）。
         * R2 の実体も一緒に片づける（行だけ消すと鍵の無い実体が残り続ける）。
         */
        if (input.replacesId !== null) {
          const old = await c.env.DB.prepare(
            'SELECT handwriting_key AS handwritingKey FROM customer_notes ' +
              'WHERE organization_id = ? AND customer_id = ? AND id = ? AND handwriting_key IS NOT NULL',
          )
            .bind(org, customerId, input.replacesId)
            .first<{ handwritingKey: string }>()
          if (old === null || old === undefined) return c.json({ error: 'not_found' }, 404)
          await c.env.RECORDINGS.delete(old.handwritingKey).catch(() => undefined)
          await c.env.DB.prepare(
            'DELETE FROM customer_notes WHERE organization_id = ? AND customer_id = ? AND id = ?',
          )
            .bind(org, customerId, input.replacesId)
            .run()
        }
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
    // 現在時刻はハンドラの入口で 1 回だけ作り、以降は引数で配る。
    const now = new Date()
    const nowIso = now.toISOString()
    const arrivedAt = input.arrivedAt ?? nowIso
    const visitDate = jstVisitDate(arrivedAt)

    // 冪等（`04-api.md` §6.2）。保存済みの成功は、受付後に店舗や目的の設定が変わっても
    // 現在の入力検証を再実行せず、そのとき保存した応答をそのまま返す。
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
      if (started.state === 'replay') return c.json(Walkin.parse(started.response))
      if (started.state === 'conflict') return c.json({ error: 'idempotency_conflict' }, 409)
      idempotencyKey = started.key
    }
    /** 新規処理が成立しなかったときは、同じ鍵で入力を直して再試行できるようにする。 */
    const release = async (): Promise<void> => {
      if (idempotencyKey !== null) await releaseIdempotency(c.env.DB, idempotencyKey)
    }

    const store = await findStore(db, org, input.storeId)
    if (!store) {
      await release()
      return c.json({ error: 'not_found' }, 404)
    }

    // 予約の間隔が決まっていない店舗には枠を置けない（暗黙の既定値を作らない）。
    const rules = (
      await db
        .select()
        .from(storeSlotRules)
        .where(
          and(eq(storeSlotRules.organizationId, org), eq(storeSlotRules.storeId, input.storeId)),
        )
    )[0]
    if (rules === undefined) {
      await release()
      return c.json({ error: 'not_found' }, 404)
    }

    // ご用件は 4 択か自由記述の**ちょうど一方**（排他は契約が見ている）。
    let purposeLine: BookingPurposeLine | null = null
    if (input.purposeId !== undefined) {
      const found = (
        await db
          .select({ id: visitPurposes.id, durationMinutes: visitPurposes.durationMinutes })
          .from(visitPurposes)
          .where(and(eq(visitPurposes.organizationId, org), eq(visitPurposes.id, input.purposeId)))
      )[0]
      if (found === undefined) {
        await release()
        return c.json({ error: 'not_found' }, 404)
      }
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
      await release()
      return c.json({ error: 'not_found' }, 404)
    }
    const customerId = input.customerId ?? null
    if (customerId !== null && (await findLiveCustomer(c.env.DB, org, customerId)) === null) {
      await release()
      return c.json({ error: 'not_found' }, 404)
    }

    const startsAt = input.startsAt ?? arrivedAt
    const durationMinutes =
      input.durationMinutes ?? purposeLine?.durationMinutes ?? WALKIN_DEFAULT_MINUTES
    if (purposeLine !== null && durationMinutes < purposeLine.durationMinutes) {
      await release()
      return c.json(
        rejected(['お取りする時間は、ご来店の目的に必要な時間以上にしてください。']),
        422,
      )
    }
    const endsAt = new Date(Date.parse(startsAt) + durationMinutes * MS_PER_MINUTE).toISOString()

    const actorId = await actorStaffId(db, org, input.storeId, sub)
    const actor = await operationActor(c, input.storeId, actorId)
    const correlationId = crypto.randomUUID()

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
              customerId,
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
              actorId: actor.actorId,
              actorType: actor.actorType,
              terminalId: actor.terminalId,
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
              actorId: actor.actorId,
              actorType: actor.actorType,
              terminalId: actor.terminalId,
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
    if (current.version !== input.version) return c.json({ error: 'version_conflict' }, 409)
    if (
      input.customerId !== undefined &&
      (await findLiveCustomer(c.env.DB, org, input.customerId)) === null
    ) {
      return c.json({ error: 'not_found' }, 404)
    }
    const selectedStaff =
      input.staffId === undefined || input.staffId === null
        ? null
        : await c.env.DB.prepare(
            "SELECT id, max_parallel_reservations AS maxParallelReservations FROM staff WHERE organization_id = ? AND store_id = ? AND id = ? AND is_active = '1'",
          )
            .bind(org, current.storeId, input.staffId)
            .first<{ id: string; maxParallelReservations: number }>()
    if (input.staffId !== undefined && input.staffId !== null && selectedStaff === null) {
      return c.json({ error: 'not_found' }, 404)
    }
    if (selectedStaff !== null) {
      const band = await c.env.DB.prepare(
        "SELECT starts_at AS startsAt, ends_at AS endsAt FROM reservation_assignments WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff'",
      )
        .bind(org, current.reservationId)
        .first<{ startsAt: string; endsAt: string }>()
      if (band === null) return c.json({ error: 'not_found' }, 404)
      const jstParts = (iso: string): { date: string; clock: string } => {
        const shifted = new Date(Date.parse(iso) + 9 * 60 * MS_PER_MINUTE)
        return {
          date: shifted.toISOString().slice(0, 10),
          clock: shifted.toISOString().slice(11, 16),
        }
      }
      const starts = jstParts(band.startsAt)
      const ends = jstParts(band.endsAt)
      if (starts.date !== ends.date) return c.json({ error: 'purpose_unavailable' }, 409)
      const [shiftRows, requiredRows, skillRows] = await Promise.all([
        c.env.DB.prepare(
          'SELECT starts_at AS startsAt, ends_at AS endsAt, kind FROM staff_shifts WHERE organization_id = ? AND store_id = ? AND staff_id = ? AND date = ?',
        )
          .bind(org, current.storeId, selectedStaff.id, starts.date)
          .all<{ startsAt: string; endsAt: string; kind: string }>(),
        c.env.DB.prepare(
          "SELECT DISTINCT pr.value FROM reservation_purposes rp JOIN purpose_requirements pr ON pr.organization_id = rp.organization_id AND pr.purpose_id = rp.purpose_id WHERE rp.organization_id = ? AND rp.reservation_id = ? AND pr.kind = 'skill'",
        )
          .bind(org, current.reservationId)
          .all<{ value: string }>(),
        c.env.DB.prepare(
          'SELECT skill_code AS skillCode FROM staff_skills WHERE organization_id = ? AND staff_id = ?',
        )
          .bind(org, selectedStaff.id)
          .all<{ skillCode: string }>(),
      ])
      const covers = shiftRows.results.some(
        (row) => row.kind === 'work' && row.startsAt <= starts.clock && row.endsAt >= ends.clock,
      )
      const overlapsBreak = shiftRows.results.some(
        (row) => row.kind === 'break' && row.startsAt < ends.clock && row.endsAt > starts.clock,
      )
      const heldSkills = new Set(skillRows.results.map((row) => row.skillCode))
      const lacksSkill = requiredRows.results.some((row) => !heldSkills.has(row.value))
      if (!covers || overlapsBreak || lacksSkill) {
        return c.json({ error: 'purpose_unavailable' }, 409)
      }
    }
    // 付け替え先のご予約も自分の組織・現在の店舗のものだけ。宛先の無い `reservation_id` を書けると、
    // 受付履歴の詳細と盤面がその来店へ二度と辿り着けなくなる。
    if (input.reservationId !== undefined) {
      const found = await c.env.DB.prepare(
        'SELECT id FROM reservations WHERE organization_id = ? AND store_id = ? AND id = ?',
      )
        .bind(org, current.storeId, input.reservationId)
        .first<{ id: string }>()
      if (found === null) return c.json({ error: 'not_found' }, 404)
    }

    const now = new Date()
    const nowIso = now.toISOString()
    let lockStatements: Statement[] = []
    let lockGuard: Guard | null = null
    let desiredStaffTarget: string | null = null
    if (input.staffId !== undefined) {
      desiredStaffTarget = selectedStaff?.id ?? UNASSIGNED_TARGET_KEY
      const held = await c.env.DB.prepare(
        "SELECT target_key AS targetKey, slot_start AS slotStart FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff' ORDER BY slot_start",
      )
        .bind(org, current.reservationId)
        .all<{ targetKey: string; slotStart: string }>()
      const alreadyHeld =
        held.results.length > 0 && held.results.every((row) => row.targetKey === desiredStaffTarget)
      if (!alreadyHeld) {
        const maxParallel =
          selectedStaff?.maxParallelReservations ??
          (
            await c.env.DB.prepare(
              'SELECT max_parallel AS maxParallel FROM store_slot_rules WHERE organization_id = ? AND store_id = ?',
            )
              .bind(org, current.storeId)
              .first<{ maxParallel: number }>()
          )?.maxParallel
        if (maxParallel === undefined) return c.json({ error: 'not_found' }, 404)
        const ids = held.results.map(() => crypto.randomUUID())
        let idIndex = 0
        lockStatements = slotLockStatements(c.env.DB, {
          organizationId: org,
          storeId: current.storeId,
          reservationId: current.reservationId,
          createdAt: nowIso,
          requests: held.results.map((row) => ({
            kind: 'staff' as const,
            targetKey: desiredStaffTarget as string,
            slotStart: row.slotStart,
            cap: maxParallel,
          })),
          newId: () => ids[idIndex++] as string,
          additionalGuard: {
            condition:
              'EXISTS (SELECT 1 FROM walk_ins WHERE organization_id = ? AND id = ? AND version = ?)',
            params: [org, walkinId, input.version],
          },
        })
        if (ids[0] !== undefined) {
          lockGuard = {
            condition:
              'EXISTS (SELECT 1 FROM reservation_slot_locks WHERE organization_id = ? AND id = ?)',
            params: [org, ids[0]],
          }
        }
      }
    }
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

    /** 副作用を walk_ins の更新前 version で守り、walk_ins 本体はバッチの最後に更新する。 */
    const applied = `EXISTS (SELECT 1 FROM walk_ins WHERE organization_id = ? AND id = ? AND version = ?)`
    const guard = [org, walkinId, input.version]
    const lockApplied = lockGuard === null ? '' : ` AND ${lockGuard.condition}`
    const sideEffectApplied = `${applied}${lockApplied}`
    const sideEffectGuard = [...guard, ...(lockGuard?.params ?? [])]
    const walkinUpdate = c.env.DB.prepare(
      `UPDATE walk_ins SET ${sets.join(', ')} WHERE organization_id = ? AND id = ? AND version = ?${lockApplied}`,
    ).bind(...params, org, walkinId, input.version, ...(lockGuard?.params ?? []))
    const statements: Statement[] = [...lockStatements]
    if (input.staffId !== undefined) {
      // 担当を決め直したら予約の割当も動かす（台帳と受付で担当が食い違わない）。
      statements.push(
        c.env.DB.prepare(
          "UPDATE reservation_assignments SET target_id = ? WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff' AND " +
            sideEffectApplied,
        ).bind(input.staffId, org, current.reservationId, ...sideEffectGuard),
      )
      if (lockGuard !== null && desiredStaffTarget !== null) {
        statements.push(
          c.env.DB.prepare(
            `DELETE FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ? AND kind = 'staff' AND target_key <> ? AND ${sideEffectApplied}`,
          ).bind(org, current.reservationId, desiredStaffTarget, ...sideEffectGuard),
        )
      }
    }
    if (input.customerId !== undefined) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE reservations SET customer_id = ?, updated_at = ? WHERE organization_id = ? AND id = ? AND ${sideEffectApplied}`,
        ).bind(input.customerId, nowIso, org, current.reservationId, ...sideEffectGuard),
      )
      statements.push(
        bumpVisitCounters(c.env.DB, org, input.customerId, now, {
          condition: sideEffectApplied,
          params: sideEffectGuard,
        }),
      )
    }
    statements.push(walkinUpdate)
    const walkinResultIndex = statements.length - 1
    const results = await c.env.DB.batch(statements as [Statement, ...Statement[]])
    if ((results[walkinResultIndex]?.meta.changes ?? 0) === 0) {
      const latest = await findWalkin(c.env.DB, org, walkinId)
      if (latest !== null && latest.version === input.version && lockStatements.length > 0) {
        return c.json({ error: 'slot_taken' }, 409)
      }
      return c.json({ error: 'version_conflict' }, 409)
    }

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
    const actor = await operationActor(c, input.storeId, actorId)
    const eventApplied: Guard = {
      condition: 'EXISTS (SELECT 1 FROM visit_events WHERE organization_id = ? AND id = ?)',
      params: [org, eventId],
    }
    const statements: [Statement, ...Statement[]] = [
      c.env.DB.prepare(
        'INSERT INTO visit_events (id, organization_id, store_id, subject_type, subject_id, stage, occurred_at, staff_id, note, created_at) ' +
          'SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (' +
          'SELECT 1 FROM visit_events WHERE organization_id = ? AND subject_type = ? AND subject_id = ? AND occurred_at >= ?)',
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
        org,
        input.subjectType,
        input.subjectId,
        occurredAt,
      ),
    ]

    // 受け付けた事実はご予約の側にも書く（盤面に載っているのに `confirmed` を作らない）。
    if (input.stage === 'received') {
      statements.push(
        c.env.DB.prepare(
          `UPDATE reservations SET status = 'arrived', updated_at = ? WHERE organization_id = ? AND id = ? AND status = 'confirmed' AND ${eventApplied.condition}`,
        ).bind(occurredAt, org, reservationId, ...eventApplied.params),
      )
    }
    if (SERVING_STAGES.has(input.stage)) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE reservations SET status = 'serving', updated_at = ? WHERE organization_id = ? AND id = ? AND status IN ('confirmed','arrived') AND ${eventApplied.condition}`,
        ).bind(occurredAt, org, reservationId, ...eventApplied.params),
      )
      if (walkin !== null) {
        statements.push(
          c.env.DB.prepare(
            `UPDATE walk_ins SET status = 'serving', version = version + 1 WHERE organization_id = ? AND id = ? AND status = 'waiting' AND ${eventApplied.condition}`,
          ).bind(org, input.subjectId, ...eventApplied.params),
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
          `UPDATE reservations SET status = 'done', updated_at = ? WHERE organization_id = ? AND id = ? AND status IN ('arrived','serving') AND ${eventApplied.condition}`,
        ).bind(occurredAt, org, reservationId, ...eventApplied.params),
      )
      if (walkin !== null) {
        statements.push(
          c.env.DB.prepare(
            `UPDATE walk_ins SET status = 'left', left_at = ?, version = version + 1 WHERE organization_id = ? AND id = ? AND ${eventApplied.condition}`,
          ).bind(occurredAt, org, input.subjectId, ...eventApplied.params),
        )
      }
      // 顧客が未特定の来店は数えない（結び直したときに数え直される）。
      if (customerId !== null) {
        statements.push(bumpVisitCounters(c.env.DB, org, customerId, now, eventApplied))
      }
    }
    statements.push(
      auditRow(c.env.DB, {
        organizationId: org,
        storeId: input.storeId,
        actorId: actor.actorId,
        actorType: actor.actorType,
        terminalId: actor.terminalId,
        action: 'visit.stage.changed',
        targetType: input.subjectType === 'walkin' ? 'walk_ins' : 'reservations',
        targetId: input.subjectId,
        after: { stage: input.stage, occurredAt, staffId: input.staffId ?? null },
        correlationId,
        occurredAt,
        appliedVisitEventId: eventId,
      }),
    )
    const results = await c.env.DB.batch(statements)
    if ((results[0]?.meta.changes ?? 0) === 0) {
      return c.json({ error: 'occurred_at_conflict' }, 409)
    }

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
      const attendant = assigned.find((row) => row.kind === 'staff')
      const reservationPurposes = day.purposes.filter(
        (purpose) => purpose.reservationId === reservation.id,
      )
      const assignedEquipment = assigned.flatMap((assignment) => {
        if (assignment.kind !== 'equipment' || assignment.targetId === null) return []
        const found = equipmentOf.get(assignment.targetId)
        return found?.kind === undefined
          ? []
          : [
              {
                id: found.id,
                name: found.name,
                kind: found.kind,
                sortOrder: found.sortOrder,
              },
            ]
      })
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
        next: planBoardSteps({
          requiredSkills: reservationPurposes.flatMap((purpose) => purpose.requiredSkills ?? []),
          requiredEquipmentKinds: reservationPurposes.flatMap(
            (purpose) => purpose.requiredEquipmentKinds ?? [],
          ),
          staffId: attendant?.targetId ?? null,
          equipment: assignedEquipment,
        }),
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
    // テストだけは固定された世界観の時刻を注入する。本番では未設定なので実時刻のまま。
    const now = new Date(c.env.TEST_NOW ?? Date.now())

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
              'COALESCE(s.display_name, t.name) AS actorName FROM audit_events a ' +
              'LEFT JOIN staff s ON s.organization_id = a.organization_id AND s.id = a.actor_id ' +
              'LEFT JOIN terminals t ON t.organization_id = a.organization_id AND t.id = a.actor_id ' +
              `WHERE a.organization_id = ? AND a.target_id IN (${targets.map(() => '?').join(',')}) ` +
              'ORDER BY a.occurred_at, a.id',
          )
            .bind(org, ...targets)
            .all<AuditChangeRecord>()

    const receivedBy = session?.terminalId
      ? ((
          await db
            .select({ name: terminals.name })
            .from(terminals)
            .where(and(eq(terminals.organizationId, org), eq(terminals.id, session.terminalId)))
        )[0]?.name ?? null)
      : session?.actorId === undefined || session?.actorId === null
        ? null
        : ((
            await db
              .select({ displayName: staff.displayName })
              .from(staff)
              .where(and(eq(staff.organizationId, org), eq(staff.id, session.actorId)))
          )[0]?.displayName ?? null)

    /*
     * その受付の録音。**`stored` の 1 本だけ**を載せる。以前はここを null で
     * 固定していたので、録音が保管庫にあってもこの面に「受付のときの録音」が
     * 一度も出なかった（実装不足の洗い出し recording-01）。送信の途中や
     * 失敗した録音は載せない —— 押しても鳴らないボタンを作らない（AC-REC-07）。
     */
    const heardRow =
      session === null
        ? null
        : await c.env.DB.prepare(
            'SELECT id, state, duration_seconds AS durationSeconds FROM recordings ' +
              "WHERE organization_id = ? AND reception_session_id = ? AND state = 'stored' " +
              'ORDER BY created_at DESC LIMIT 1',
          )
            .bind(org, session.id)
            .first<{ id: string; state: string; durationSeconds: number | null }>()
    const heard =
      heardRow === null || heardRow === undefined
        ? null
        : {
            id: heardRow.id,
            state: heardRow.state,
            durationSeconds: heardRow.durationSeconds,
          }

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
        recording: heard,
      }),
    )
  })

  /* --- 受付の録音（P7） -------------------------------------------------- */

  /**
   * 録音を 1 本立てる（BOOK-01-DATETIME の `.rec`「録音中 01:08」）。
   *
   * **1 受付 = 1 録音。**工程を戻しても画面を作り直しても、同じ受付セッションには
   * 既にある行をそのまま返す（AC-REC-02）。切って繋ぐと、あとで聞き直すときに
   * 「どちらが本物か」を人が判断することになる。
   *
   * 権限は要求しない。お電話を取った人がそのまま録り始める操作である（`04-api.md` §2.2 が
   * 権限を挙げているのは一覧・再生・保全・削除の 4 つだけ）。
   */
  .post('/api/staff/recordings', zValidator('json', RecordingCreate), async (c) => {
    const db = drizzle(c.env.DB)
    const { org, sub } = c.get('auth')
    const input = c.req.valid('json')
    if (!(await findStore(db, org, input.storeId))) return c.json({ error: 'not_found' }, 404)
    const actor = await operationActor(
      c,
      input.storeId,
      await actorStaffId(db, org, input.storeId, sub),
    )
    // 受付は org **と店舗**で引く。店舗を落とすと、他店の受付に録音をぶら下げられる。
    const session = (
      await db
        .select({ id: receptionSessions.id })
        .from(receptionSessions)
        .where(
          and(
            eq(receptionSessions.organizationId, org),
            eq(receptionSessions.id, input.receptionSessionId),
            eq(receptionSessions.storeId, input.storeId),
          ),
        )
    )[0]
    if (session === undefined) return c.json({ error: 'not_found' }, 404)

    const existing = await c.env.DB.prepare(
      `SELECT ${RECORDING_COLUMNS} FROM recordings WHERE organization_id = ? AND reception_session_id = ? ORDER BY created_at ASC LIMIT 1`,
    )
      .bind(org, input.receptionSessionId)
      .first<RecordingRecord>()
    if (existing !== null) return c.json(Recording.parse(toRecording(existing)))

    const id = crypto.randomUUID()
    const correlationId = crypto.randomUUID()
    // 鍵は `id` から決まる。端末から受けないので、再送が保管庫に二重に置かれない。
    const r2Key = r2KeyFor({
      organizationId: org,
      storeId: input.storeId,
      id,
      contentType: input.contentType,
      createdAt: input.startedAt,
    })

    for (let attempt = 1; attempt <= RECORDING_CODE_ATTEMPTS; attempt += 1) {
      // 桁が伸びた組織（`EY-R-10000`）でも最後の 1 本を引けるよう、長さを先に見る。
      const previous = await c.env.DB.prepare(
        'SELECT code FROM recordings WHERE organization_id = ? ORDER BY length(code) DESC, code DESC LIMIT 1',
      )
        .bind(org)
        .first<{ code: string }>()
      const code = nextRecordingCode(previous?.code ?? null)
      const row: RecordingRecord = {
        id,
        storeId: input.storeId,
        code,
        receptionSessionId: input.receptionSessionId,
        reservationId: null,
        r2Key,
        contentType: input.contentType,
        durationSeconds: null,
        bytes: null,
        state: 'recording',
        retainUntil: null,
        legalHold: '0',
        uploadAttempts: 0,
        createdAt: input.startedAt,
      }
      try {
        await c.env.DB.batch([
          c.env.DB.prepare(
            'INSERT INTO recordings (id, organization_id, store_id, code, reception_session_id, reservation_id, r2_key, content_type, duration_seconds, bytes, state, retain_until, legal_hold, upload_attempts, created_at, updated_at, deleted_at) ' +
              "VALUES (?,?,?,?,?,NULL,?,?,NULL,NULL,'recording',NULL,'0',0,?,?,NULL)",
          ).bind(
            id,
            org,
            input.storeId,
            code,
            input.receptionSessionId,
            r2Key,
            input.contentType,
            input.startedAt,
            input.startedAt,
          ),
          recordingAudit(c.env.DB, {
            organizationId: org,
            storeId: input.storeId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            terminalId: actor.terminalId,
            action: 'recording.started',
            recordingId: id,
            after: { code, receptionSessionId: input.receptionSessionId },
            correlationId,
            occurredAt: input.startedAt,
          }),
        ])
      } catch (err) {
        // 録音番号がぶつかった。+1 して採り直す（採番の衝突は失敗に数えない）。
        if (constraintTable(err) === 'recordings') continue
        throw err
      }
      return c.json(Recording.parse(toRecording(row)))
    }
    // 5 回打ち直しても採れなかった。500 にせず人を呼ぶ（`04-api.md` §5）。
    return c.json({ error: 'code_exhausted' }, 409)
  })

  /**
   * 録音の本体（**生 body を受ける唯一のルート**）。Worker が R2 へ書く。
   *
   * `deleted` 以外のどの状態からでも受ける。同じ録音は必ず同じキーへ上書きされるので、
   * 送り直しが保管庫に 2 つ目を作らない（`r2_key` が第 2 の冪等キーである）。
   *
   * 100MB を越えたら 413 で断り、**その 1 回を送信の失敗として数える**
   * （3 回でお知らせに上がる対象になる。`features/010-recording` の「決めたこと」）。
   * 長さは宣言（`Content-Length`）で先に見て、宣言が無い / 食い違うときに実バイト数で見る。
   */
  .put('/api/staff/recordings/:recordingId/content', async (c) => {
    const db = drizzle(c.env.DB)
    const { org, sub } = c.get('auth')
    const recordingId = c.req.param('recordingId')
    const row = await findRecording(c.env.DB, org, recordingId)
    if (row === null) return c.json({ error: 'not_found' }, 404)
    await validateTerminalPairWhenPresent(c, row.storeId)
    if (row.state === 'deleted') return c.json({ error: 'invalid_transition' }, 409)

    // `audio/mp4; codecs=...` で届くので、媒体の型だけを見る。
    const declaredType = (c.req.header('content-type') ?? '').split(';')[0]?.trim() ?? ''
    const contentType = RecordingContentType.safeParse(declaredType)
    if (!contentType.success) return c.json(contentType, 400)

    const nowIso = new Date().toISOString()
    /** 413 の 1 回を失敗として数える。3 回目でお知らせに上がる。 */
    const countFailure = async (): Promise<Response> => {
      const attempts = Math.min(row.uploadAttempts + 1, RECORDING_MAX_ATTEMPTS)
      // **保管済みの録音は `failed` へ落とさない。**落とすと保持期限の掃除
      // （`state='stored'` を引く）が二度と拾わず、実体だけが期限を過ぎても
      // 保管庫に残り続ける。既に音は保管庫にあるので、失われたものは何も無い
      // （数だけ増やして、状態はそのままにする）。
      const landed = nextState(row.state as RecordingState, 'failed')
      await c.env.DB.prepare(
        'UPDATE recordings SET state = ?, upload_attempts = ?, updated_at = ? WHERE organization_id = ? AND id = ?',
      )
        .bind(landed.ok ? landed.state : row.state, attempts, nowIso, org, recordingId)
        .run()
      if (landed.ok && attempts >= RECORDING_ALERT_ATTEMPTS) {
        const link = await readSessionLink(c.env.DB, org, row.receptionSessionId)
        await raiseUploadFailedAlert(c.env.DB, {
          organizationId: org,
          storeId: row.storeId,
          recordingId,
          code: row.code,
          customerName: link.customerName,
          hasReservation: link.hasReservation,
          occurredAt: nowIso,
        })
      }
      return c.json({ error: 'payload_too_large' }, 413)
    }

    const declaredLength = Number(c.req.header('content-length') ?? Number.NaN)
    if (Number.isFinite(declaredLength) && declaredLength > RECORDING_MAX_BYTES) {
      return await countFailure()
    }
    const body = await c.req.arrayBuffer()
    if (body.byteLength > RECORDING_MAX_BYTES) return await countFailure()

    // 長さは端末が測る（サーバは音声を復号しない）。**受け直さずに書かない** —
    // 打ち間違えた値をそのまま入れると、応答を組み立てる `Recording.parse` が落ちて
    // 保管そのものが 500 に見える（音声は既に保管庫へ入っているのに）。
    const declaredDuration = c.req.query('durationSeconds')
    const parsedDuration = declaredDuration === undefined ? null : Number(declaredDuration)
    if (
      parsedDuration !== null &&
      (!Number.isInteger(parsedDuration) ||
        parsedDuration < 0 ||
        parsedDuration > RECORDING_MAX_SECONDS)
    ) {
      return c.json(rejected(['録音の長さが受け取れませんでした。送り直してください。']), 400)
    }
    const durationSeconds = parsedDuration ?? row.durationSeconds

    // 保持期限は**保管した時刻**から決まる（録り始めではない）。成立予約は 30 日、
    // 破棄受付は 24 時間で、取り消したご予約は成立していないほうへ落ちる。
    //
    // **一度決まった期限は動かさない。**送り直しのたびに引き直すと、5 分ごとの再送を
    // 続けるだけで期限が前へ逃げ続け、削除が永久に 409 `recording_retained` で拒まれる
    // （`PATCH` 側は最初からこの決めを持っている。両方の経路に同じ決めを置く）。
    // ご予約との結び付きだけは引き直す — 受付の途中で成立した予約が行から落ちない。
    const link = await readSessionLink(c.env.DB, org, row.receptionSessionId)
    const retainUntil =
      row.retainUntil ??
      retainUntilFor({
        hasReservation: link.hasReservation,
        storedAt: new Date(nowIso),
      }).toISOString()

    await c.env.RECORDINGS.put(row.r2Key, body, {
      httpMetadata: { contentType: contentType.data },
    })
    const actorId = await actorStaffId(db, org, row.storeId, sub)
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE recordings SET state = 'stored', content_type = ?, duration_seconds = ?, bytes = ?, " +
          'reservation_id = ?, retain_until = ?, updated_at = ? WHERE organization_id = ? AND id = ?',
      ).bind(
        contentType.data,
        durationSeconds,
        body.byteLength,
        link.reservationId,
        retainUntil,
        nowIso,
        org,
        recordingId,
      ),
      // 保管の完了は人が押した操作ではない（端末が送り終えた結果）ので `system`。
      recordingAudit(c.env.DB, {
        organizationId: org,
        storeId: row.storeId,
        actorType: 'system',
        actorId,
        action: 'recording.stored',
        recordingId,
        after: { bytes: body.byteLength, durationSeconds, retainUntil },
        correlationId: crypto.randomUUID(),
        occurredAt: nowIso,
      }),
      ...resolveUploadFailedAlertStatements(c.env.DB, {
        organizationId: org,
        storeId: row.storeId,
        recordingId,
        resolvedAt: nowIso,
      }),
    ])

    return c.json(
      Recording.parse(
        toRecording({
          ...row,
          state: 'stored',
          contentType: contentType.data,
          durationSeconds,
          bytes: body.byteLength,
          reservationId: link.reservationId,
          retainUntil,
        }),
      ),
    )
  })

  /**
   * 録音の状態更新（端末が送信の成否を知らせる）。許されない遷移は
   * 409 `invalid_transition` で、**例外にしない**（500 にすると端末が理由を読めない）。
   *
   * `failed` へ落とすたびに試行回数を 1 増やし、**3 に達したらお知らせを 1 件立てる**。
   */
  .patch(
    '/api/staff/recordings/:recordingId',
    zValidator('json', RecordingStatePatch),
    async (c) => {
      const org = c.get('auth').org
      const recordingId = c.req.param('recordingId')
      const row = await findRecording(c.env.DB, org, recordingId)
      if (row === null) return c.json({ error: 'not_found' }, 404)
      await validateTerminalPairWhenPresent(c, row.storeId)
      const input = c.req.valid('json')
      const moved = nextState(row.state as RecordingState, input.state)
      if (!moved.ok) return c.json({ error: 'invalid_transition' }, 409)

      const nowIso = new Date().toISOString()
      const attempts =
        input.state === 'failed'
          ? Math.min(row.uploadAttempts + 1, RECORDING_MAX_ATTEMPTS)
          : row.uploadAttempts
      const durationSeconds = input.durationSeconds ?? row.durationSeconds
      const bytes = input.bytes ?? row.bytes

      // **`stored` に着いた瞬間に最低保持期限が決まる**（成立予約は 30 日、破棄受付は
      // 24 時間）。本体を受けた経路（`PUT .../content`）だけで書いていると、端末が
      // 「送り終えた」とだけ知らせてきた行が `retain_until` を持たないまま `stored` になり、
      // 掃除の絞り込み（`retain_until IS NOT NULL`）から外れて永久に残る。
      // 既に決まっている期限は動かさない（送り直しで期限が伸びると保持が青天井になる）。
      const link =
        moved.state === 'stored' && row.retainUntil === null
          ? await readSessionLink(c.env.DB, org, row.receptionSessionId)
          : null
      const reservationId = link === null ? row.reservationId : link.reservationId
      const retainUntil =
        link === null
          ? row.retainUntil
          : retainUntilFor({
              hasReservation: link.hasReservation,
              storedAt: new Date(nowIso),
            }).toISOString()

      const statements: Statement[] = [
        c.env.DB.prepare(
          'UPDATE recordings SET state = ?, duration_seconds = ?, bytes = ?, upload_attempts = ?, ' +
            'reservation_id = ?, retain_until = ?, updated_at = ? WHERE organization_id = ? AND id = ?',
        ).bind(
          moved.state,
          durationSeconds,
          bytes,
          attempts,
          reservationId,
          retainUntil,
          nowIso,
          org,
          recordingId,
        ),
      ]
      // 残す `action` は 7 つだけ。`uploading` は途中経過なので監査に積まない
      // （積むと 5 分ごとの再送で監査が音声より速く育つ）。
      if (moved.state === 'failed' || moved.state === 'stored') {
        statements.push(
          recordingAudit(c.env.DB, {
            organizationId: org,
            storeId: row.storeId,
            actorType: 'system',
            actorId: null,
            action: moved.state === 'failed' ? 'recording.failed' : 'recording.stored',
            recordingId,
            after: { attempts, failureReason: input.failureReason ?? null },
            correlationId: crypto.randomUUID(),
            occurredAt: nowIso,
          }),
        )
      }
      if (moved.state === 'stored') {
        statements.push(
          ...resolveUploadFailedAlertStatements(c.env.DB, {
            organizationId: org,
            storeId: row.storeId,
            recordingId,
            resolvedAt: nowIso,
          }),
        )
      }
      await c.env.DB.batch(statements)

      if (moved.state === 'failed' && attempts >= RECORDING_ALERT_ATTEMPTS) {
        const link = await readSessionLink(c.env.DB, org, row.receptionSessionId)
        await raiseUploadFailedAlert(c.env.DB, {
          organizationId: org,
          storeId: row.storeId,
          recordingId,
          code: row.code,
          customerName: link.customerName,
          hasReservation: link.hasReservation,
          occurredAt: nowIso,
        })
      }

      return c.json(
        Recording.parse(
          toRecording({
            ...row,
            state: moved.state,
            durationSeconds,
            bytes,
            uploadAttempts: attempts,
            reservationId,
            retainUntil,
          }),
        ),
      )
    },
  )

  /**
   * 送り直し（EX-UPLOAD-FAILED / ALERTS の「もう一度送る」）。
   *
   * **サーバは音声を持っていない。**実体は端末の IndexedDB にあるので、ここでできるのは
   * `failed` → `uploading` へ戻すことだけで、本体は端末が改めて送る。
   * サーバ側からの再送経路は作らない（`features/010-recording` の「却下した代替案」）。
   */
  .post('/api/staff/recordings/:recordingId/retry', async (c) => {
    const org = c.get('auth').org
    const recordingId = c.req.param('recordingId')
    const row = await findRecording(c.env.DB, org, recordingId)
    if (row === null) return c.json({ error: 'not_found' }, 404)
    await validateTerminalPairWhenPresent(c, row.storeId)
    // **戻せるのは `failed` からだけ**にする。`nextState()` は `recording → uploading` も
    // 許すが、それは端末が録り終えて送り始める辺であって「もう一度送る」ではない。
    // まだ録っている録音をここで `uploading` にすると、送り終える前にサーバが送信中を名乗る。
    if (row.state !== 'failed' || !nextState(row.state, 'uploading').ok) {
      return c.json({ error: 'invalid_transition' }, 409)
    }

    const nowIso = new Date().toISOString()
    await c.env.DB.prepare(
      "UPDATE recordings SET state = 'uploading', updated_at = ? WHERE organization_id = ? AND id = ?",
    )
      .bind(nowIso, org, recordingId)
      .run()
    return c.json(Recording.parse(toRecording({ ...row, state: 'uploading' })))
  })

  /**
   * 録音の一覧（ALERTS の失敗一覧）。**`OFFSET` を書かない** —
   * 続きは `(created_at, id)` の複合カーソルで取り、`total` は同じ条件の `COUNT(*)` で数える。
   *
   * 担当していない店舗の録音は**一覧にも出さない**（AC-REC-14）。`recording.read` を
   * 持っている店舗の id で絞り込むので、他店の録音があるという標識も残らない。
   */
  .get(
    '/api/staff/recordings',
    requireStorePermission('recording.read'),
    zValidator('query', RecordingListQuery),
    async (c) => {
      const { org, sub } = c.get('auth')
      const query = c.req.valid('query')
      const allowed = await permittedStores(drizzle(c.env.DB), org, sub, 'recording.read')
      const scope =
        query.storeId === undefined ? allowed : allowed.filter((id) => id === query.storeId)
      if (scope.length === 0) {
        return c.json(RecordingList.parse({ items: [], nextCursor: null, total: 0 }))
      }

      const clauses = [`store_id IN (${scope.map(() => '?').join(',')})`]
      const params: unknown[] = [org, ...scope]
      if (query.state.length > 0) {
        clauses.push(`state IN (${query.state.map(() => '?').join(',')})`)
        params.push(...query.state)
      }
      if (query.from !== undefined) {
        clauses.push('created_at >= ?')
        params.push(toInstant(query.from, 0))
      }
      if (query.to !== undefined) {
        clauses.push('created_at < ?')
        params.push(toInstant(query.to, MINUTES_PER_DAY))
      }
      // ご予約 1 件・受付 1 件にぶら下がる録音を引く（画面の「録音を聞く」がこれを使う）。
      if (query.reservationId !== undefined) {
        clauses.push('reservation_id = ?')
        params.push(query.reservationId)
      }
      if (query.receptionSessionId !== undefined) {
        clauses.push('reception_session_id = ?')
        params.push(query.receptionSessionId)
      }
      const where = `organization_id = ? AND ${clauses.join(' AND ')}`

      const cursor = decodePageCursor(query.cursor)
      const page = cursor === null ? '' : ' AND (created_at > ? OR (created_at = ? AND id > ?))'
      const pageParams = cursor === null ? [] : [cursor.at, cursor.at, cursor.id]

      const read = await c.env.DB.batch([
        c.env.DB.prepare(`SELECT COUNT(*) AS total FROM recordings WHERE ${where}`).bind(...params),
        c.env.DB.prepare(
          `SELECT ${RECORDING_COLUMNS} FROM recordings WHERE ${where}${page} ORDER BY created_at ASC, id ASC LIMIT ?`,
        ).bind(...params, ...pageParams, query.limit + 1),
      ])

      const found = (read[1]?.results ?? []) as RecordingRecord[]
      const items = found.slice(0, query.limit)
      const last = items[items.length - 1]
      return c.json(
        RecordingList.parse({
          items: items.map(toRecording),
          // 続きがあるときだけ載せる。**最後のページで空でないカーソルを返さない。**
          nextCursor:
            found.length > query.limit && last !== undefined
              ? encodePageCursor(last.createdAt, last.id)
              : null,
          total: ((read[0]?.results ?? []) as { total: number }[])[0]?.total ?? 0,
        }),
      )
    },
  )

  /**
   * 再生の 1 段目（LEDGER-DETAIL「● 録音を聞く　03:12」）。**チケットを 1 枚出すだけ**で、
   * 音声もダウンロード URL も返さない。
   *
   * **監査を先に書き、書けなければチケットを出さない。**再生を best-effort にすると、
   * 誰が聞いたか分からない再生が生まれ、要配慮情報の持ち出しと区別が付かなくなる。
   * 保管済み（`stored`）以外は 404 にする — 消したあとの録音に対して
   * 「もう無い」と「聞けない」を言い分ける画面を作らない。
   */
  .post(
    '/api/staff/recordings/:recordingId/playback',
    requireStorePermission('recording.read'),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const row = await readableRecording(c, 'recording.read')
      if (row === null || row.state !== 'stored') return c.json({ error: 'not_found' }, 404)
      await validateTerminalPairWhenPresent(c, row.storeId)

      const now = new Date()
      const nowIso = now.toISOString()
      const actorId = await actorStaffId(db, org, row.storeId, sub)
      await c.env.DB.batch([
        recordingAudit(c.env.DB, {
          organizationId: org,
          storeId: row.storeId,
          actorType: 'staff',
          actorId,
          action: 'recording.played',
          recordingId: row.id,
          after: { code: row.code },
          correlationId: crypto.randomUUID(),
          occurredAt: nowIso,
        }),
      ])

      const ticket = await issueTicket(c.env.SHORT_LIVED, {
        organizationId: org,
        recordingId: row.id,
        storeId: row.storeId,
        staffId: actorId,
        now,
      })
      return c.json(
        RecordingPlaybackTicket.parse({
          token: ticket.token,
          expiresAt: ticket.expiresAt,
          durationSeconds: row.durationSeconds,
        }),
      )
    },
  )

  /**
   * 再生の 2 段目。R2 から読んで `audio/*` をそのまま返す。
   *
   * **このルートだけは応答が JSON ではないので、契約 `parse` の対象外にする**
   * （`04-api.md` §3.9 の唯一の例外）。契約を通すと音声が JSON へ包まれ、
   * `<audio>` が読めない形になる。
   *
   * チケットは `Authorization` の**代わりではなく上乗せ**である。ヘッダーだけで開けると
   * 業務トークンを持つ人が id の総当たりで他店舗の録音まで聞ける。
   */
  .get(
    '/api/staff/recordings/:recordingId/stream',
    requireStorePermission('recording.read'),
    async (c) => {
      const org = c.get('auth').org
      const row = await readableRecording(c, 'recording.read')
      if (row === null || row.state !== 'stored') return c.json({ error: 'not_found' }, 404)
      const ok = await verifyTicket(c.env.SHORT_LIVED, {
        organizationId: org,
        recordingId: row.id,
        token: c.req.query('token'),
      })
      if (!ok) return c.json({ error: 'unauthorized' }, 401)

      // `bytes=4-7` の 1 区間だけを見る（複数区間の要求は `<audio>` が出さない）。
      const requested = /^bytes=(\d+)-(\d*)$/.exec(c.req.header('range') ?? '')
      const offset = requested === null ? null : Number(requested[1])
      const end = requested === null || requested[2] === '' ? null : Number(requested[2])
      const object = await c.env.RECORDINGS.get(
        row.r2Key,
        offset === null
          ? undefined
          : { range: end === null ? { offset } : { offset, length: end - offset + 1 } },
      )
      if (object === null) return c.json({ error: 'not_found' }, 404)

      const body = await object.arrayBuffer()
      const headers: Record<string, string> = {
        'content-type': row.contentType,
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
      }
      if (offset === null) return c.body(body, 200, headers)
      // R2 は要求より短い範囲を返すので、ヘッダーの終端も実体で頭打ちにする。
      // `bytes 4-999/12` と答えると HTTP として不正で、`<audio>` の頭出しが壊れる。
      const last = Math.min(end ?? object.size - 1, object.size - 1)
      headers['content-range'] = `bytes ${offset}-${last}/${object.size}`
      return c.body(body, 206, headers)
    },
  )

  /**
   * 保全の指定と解除（MODE-PERSONAL「録音の保全にはご本人の確認が必要です」）。
   * **保全は最低保持期限より強い。**立っているあいだは期限を何年過ぎても消えない。
   *
   * 理由を必須にしてあるのは、外してよいのかを後から誰も判断できなくなるからである。
   */
  .post(
    '/api/staff/recordings/:recordingId/hold',
    requireStorePermission('recording.manage'),
    requirePersonalMode('録音の保全', { whenTerminalIsActive: true }),
    zValidator('json', RecordingHoldInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const row = await readableRecording(c, 'recording.manage')
      if (row === null) return c.json({ error: 'not_found' }, 404)
      const now = new Date(c.env.TEST_NOW ?? Date.now())
      if (
        c.req.header('x-terminal-id') === undefined &&
        c.req.header('x-terminal-session') === undefined
      ) {
        const active = await c.env.DB.prepare(
          "SELECT 1 FROM terminal_sessions WHERE organization_id = ? AND store_id = ? AND revoked_at IS NULL AND ((mode = 'shared' AND expires_at > ?) OR (mode = 'personal' AND started_at > ?)) LIMIT 1",
        )
          .bind(
            org,
            row.storeId,
            now.toISOString(),
            new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
          )
          .first()
        if (active !== null) {
          return c.json({ error: 'personal_mode_required', subject: '録音の保全' }, 403)
        }
      }
      const input = c.req.valid('json')
      const nowIso = now.toISOString()
      const actor = await operationActor(
        c,
        row.storeId,
        await actorStaffId(db, org, row.storeId, sub),
      )

      await c.env.DB.batch([
        c.env.DB.prepare(
          'UPDATE recordings SET legal_hold = ?, updated_at = ? WHERE organization_id = ? AND id = ?',
        ).bind(flag(input.legalHold), nowIso, org, row.id),
        recordingAudit(c.env.DB, {
          organizationId: org,
          storeId: row.storeId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          terminalId: actor.terminalId,
          action: input.legalHold ? 'recording.hold_set' : 'recording.hold_cleared',
          recordingId: row.id,
          after: { legalHold: input.legalHold, reason: input.reason },
          correlationId: crypto.randomUUID(),
          occurredAt: nowIso,
        }),
      ])
      return c.json(Recording.parse(toRecording({ ...row, legalHold: flag(input.legalHold) })))
    },
  )

  /**
   * 手で消す（HISTORY-LIST / LEDGER-DETAIL）。**最低保持期限より前の削除は拒む** —
   * 通常の削除も保守の掃除も `canDelete()` の 1 か所を通すので、片方だけが素通りしない。
   *
   * 拒むときは「いつから消せるか」を返す。返さないと画面は「もう一度あとで」としか言えない。
   * **行は消さない。**実体だけを消して `state='deleted'` を書く（いつ消したかが要る）。
   */
  .delete(
    '/api/staff/recordings/:recordingId',
    requireStorePermission('recording.manage'),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const row = await readableRecording(c, 'recording.manage')
      if (row === null) return c.json({ error: 'not_found' }, 404)
      await validateTerminalPairWhenPresent(c, row.storeId)
      // まだ保管庫に入っていない録音には消す実体が無い。期限も決まっていないので、
      // `recording_retained`（いつから消せるか）を返しようがない。
      if (row.retainUntil === null) return c.json({ error: 'invalid_transition' }, 409)

      const now = new Date()
      const verdict = canDelete({
        state: row.state as RecordingState,
        retainUntil: row.retainUntil,
        legalHold: isOn(row.legalHold),
        now,
      })
      if (!verdict.ok) {
        return c.json(
          RecordingRetainedError.parse({
            error: 'recording_retained',
            retainUntil: row.retainUntil,
            legalHold: isOn(row.legalHold),
          }),
          409,
        )
      }

      const nowIso = now.toISOString()
      const actorId = await actorStaffId(db, org, row.storeId, sub)
      await c.env.RECORDINGS.delete(row.r2Key)
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE recordings SET state = 'deleted', deleted_at = ?, updated_at = ? WHERE organization_id = ? AND id = ?",
        ).bind(nowIso, nowIso, org, row.id),
        recordingAudit(c.env.DB, {
          organizationId: org,
          storeId: row.storeId,
          actorType: 'staff',
          actorId,
          action: 'recording.deleted',
          recordingId: row.id,
          after: { reason: 'manual', retainUntil: row.retainUntil },
          correlationId: crypto.randomUUID(),
          occurredAt: nowIso,
        }),
      ])
      return c.json(DeletedResult.parse({ id: row.id, deleted: true }))
    },
  )

  .get(
    '/api/staff/audit',
    requireStorePermission('audit.read', { storeIdFrom: 'query' }),
    zValidator('query', AuditSearchQuery),
    async (c) => {
      const { org, sub } = c.get('auth')
      const query = c.req.valid('query')
      const allowed = await permittedStores(drizzle(c.env.DB), org, sub, 'audit.read')
      if (query.storeId !== undefined && !allowed.includes(query.storeId)) {
        return c.json({ error: 'forbidden' }, 403)
      }
      if (allowed.length === 0) return c.json({ error: 'forbidden' }, 403)
      const clauses = [
        'organization_id = ?',
        query.storeId === undefined
          ? `store_id IN (${allowed.map(() => '?').join(',')})`
          : 'store_id = ?',
      ]
      const params: unknown[] = [org, ...(query.storeId === undefined ? allowed : [query.storeId])]
      if (query.from !== undefined) {
        clauses.push('occurred_at >= ?')
        params.push(`${query.from}T00:00:00.000+09:00`)
      }
      if (query.to !== undefined) {
        const after = new Date(`${query.to}T00:00:00.000+09:00`)
        after.setUTCDate(after.getUTCDate() + 1)
        clauses.push('occurred_at < ?')
        params.push(after.toISOString())
      }
      if (query.actorId !== undefined) {
        clauses.push('actor_id = ?')
        params.push(query.actorId)
      }
      if (query.action !== undefined) {
        clauses.push('action = ?')
        params.push(query.action)
      }
      const cursor = decodePageCursor(query.cursor)
      if (cursor !== null) {
        clauses.push('(occurred_at < ? OR (occurred_at = ? AND id < ?))')
        params.push(cursor.at, cursor.at, cursor.id)
      }
      const where = clauses.join(' AND ')
      const result = await c.env.DB.batch([
        c.env.DB.prepare(`SELECT COUNT(*) AS total FROM audit_events WHERE ${where}`).bind(
          ...params,
        ),
        c.env.DB.prepare(
          'SELECT id, occurred_at AS occurredAt, actor_type AS actorType, actor_id AS actorId, terminal_id AS terminalId, action, target_type AS targetType, target_id AS targetId, correlation_id AS correlationId, before_json AS beforeJson, after_json AS afterJson ' +
            `FROM audit_events WHERE ${where} ORDER BY occurred_at DESC, id DESC LIMIT ?`,
        ).bind(...params, query.limit + 1),
      ])
      const raw = (result[1]?.results ?? []) as Array<{
        id: string
        occurredAt: string
        beforeJson: string | null
        afterJson: string | null
      }>
      const found = raw.map((row) => ({
        ...row,
        beforeJson: row.beforeJson === null ? null : JSON.parse(row.beforeJson),
        afterJson: row.afterJson === null ? null : JSON.parse(row.afterJson),
      }))
      const items = found.slice(0, query.limit)
      const last = items.at(-1)
      return c.json(
        AuditEventList.parse({
          items: AuditEvent.array().parse(items),
          nextCursor:
            found.length > query.limit && last !== undefined
              ? encodePageCursor(last.occurredAt, last.id)
              : null,
          total: ((result[0]?.results ?? []) as { total: number }[])[0]?.total ?? 0,
        }),
      )
    },
  )

  .get('/api/staff/alerts', zValidator('query', AlertListQuery), async (c) => {
    const { org, sub } = c.get('auth')
    const query = c.req.valid('query')
    const assigned = await c.env.DB.prepare(
      'SELECT store_id AS storeId FROM store_memberships WHERE organization_id = ? AND user_id = ?',
    )
      .bind(org, sub)
      .all<{ storeId: string }>()
    const storeIds = assigned.results.map((row) => row.storeId)
    if (query.storeId !== undefined && !storeIds.includes(query.storeId)) {
      return c.json({ error: 'forbidden' }, 403)
    }
    const selected = query.storeId === undefined ? storeIds : [query.storeId]
    if (selected.length === 0) {
      return c.json(
        AlertList.parse({
          items: [],
          nextCursor: null,
          total: 0,
          counts: { all: 0, action: 0, info: 0, resolved: 0 },
        }),
      )
    }
    const base = `organization_id = ? AND audience = 'store' AND store_id IN (${selected.map(() => '?').join(',')})`
    const params: unknown[] = [org, ...selected]
    const now = new Date(c.env.TEST_NOW ?? Date.now())
    const today = toJstDateString(now)
    const dayStart = new Date(`${today}T00:00:00.000+09:00`).toISOString()
    const dayEndDate = new Date(`${today}T00:00:00.000+09:00`)
    dayEndDate.setUTCDate(dayEndDate.getUTCDate() + 1)
    const dayEnd = dayEndDate.toISOString()
    const kinds = {
      all: 'resolved_at IS NULL',
      action: "resolved_at IS NULL AND severity = 'action'",
      info: "resolved_at IS NULL AND severity = 'info'",
      resolved: 'resolved_at >= ? AND resolved_at < ?',
    } as const
    const kindClause = kinds[query.kind]
    const kindParams = query.kind === 'resolved' ? [dayStart, dayEnd] : []
    const where = `${base} AND ${kindClause}`

    // 新しい順。続きは `(occurred_at, id)` を降順にたどる。
    const cursor = decodePageCursor(query.cursor)
    const page = cursor === null ? '' : ' AND (occurred_at < ? OR (occurred_at = ? AND id < ?))'
    const pageParams = cursor === null ? [] : [cursor.at, cursor.at, cursor.id]

    const read = await c.env.DB.batch([
      c.env.DB.prepare(`SELECT COUNT(*) AS total FROM alerts WHERE ${where}`).bind(
        ...params,
        ...kindParams,
      ),
      c.env.DB.prepare(
        'SELECT id, code, severity, audience, title, body, target_type AS targetType, ' +
          'target_id AS targetId, occurred_at AS occurredAt, read_at AS readAt, ' +
          `resolved_at AS resolvedAt, resolved_by AS resolvedBy FROM alerts WHERE ${where}${page} ` +
          'ORDER BY occurred_at DESC, id DESC LIMIT ?',
      ).bind(...params, ...kindParams, ...pageParams, query.limit + 1),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM alerts WHERE ${base} AND resolved_at IS NULL`,
      ).bind(...params),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM alerts WHERE ${base} AND resolved_at IS NULL AND severity = 'action'`,
      ).bind(...params),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM alerts WHERE ${base} AND resolved_at IS NULL AND severity = 'info'`,
      ).bind(...params),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM alerts WHERE ${base} AND resolved_at >= ? AND resolved_at < ?`,
      ).bind(...params, dayStart, dayEnd),
    ])

    const found = (read[1]?.results ?? []) as { id: string; occurredAt: string }[]
    const items = found.slice(0, query.limit)
    const last = items[items.length - 1]
    return c.json(
      AlertList.parse({
        items: Alert.array().parse(items),
        nextCursor:
          found.length > query.limit && last !== undefined
            ? encodePageCursor(last.occurredAt, last.id)
            : null,
        total: ((read[0]?.results ?? []) as { total: number }[])[0]?.total ?? 0,
        counts: {
          all: ((read[2]?.results ?? []) as { n: number }[])[0]?.n ?? 0,
          action: ((read[3]?.results ?? []) as { n: number }[])[0]?.n ?? 0,
          info: ((read[4]?.results ?? []) as { n: number }[])[0]?.n ?? 0,
          resolved: ((read[5]?.results ?? []) as { n: number }[])[0]?.n ?? 0,
        },
      }),
    )
  })

  .patch('/api/staff/alerts/:alertId', zValidator('json', AlertPatch), async (c) => {
    const { org, sub } = c.get('auth')
    const alertId = c.req.param('alertId')
    const input = c.req.valid('json')
    const row = await c.env.DB.prepare(
      "SELECT store_id AS storeId, read_at AS readAt, resolved_at AS resolvedAt FROM alerts WHERE organization_id = ? AND id = ? AND audience = 'store'",
    )
      .bind(org, alertId)
      .first<{ storeId: string; readAt: string | null; resolvedAt: string | null }>()
    if (row === null) return c.json({ error: 'not_found' }, 404)
    const assigned = await c.env.DB.prepare(
      'SELECT 1 FROM store_memberships WHERE organization_id = ? AND store_id = ? AND user_id = ?',
    )
      .bind(org, row.storeId, sub)
      .first()
    if (assigned === null) return c.json({ error: 'forbidden' }, 403)
    const nowIso = new Date(c.env.TEST_NOW ?? Date.now()).toISOString()
    const readAt = input.readAt === undefined ? row.readAt : input.readAt
    const actor = await operationActor(c, row.storeId, sub)
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE alerts SET read_at = ? WHERE organization_id = ? AND id = ? AND audience = 'store'",
      ).bind(readAt, org, alertId),
      c.env.DB.prepare(
        'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(
        crypto.randomUUID(),
        org,
        row.storeId,
        actor.actorType,
        actor.actorId,
        actor.terminalId,
        'alert.read',
        'alerts',
        alertId,
        JSON.stringify({ readAt: row.readAt, resolvedAt: row.resolvedAt }),
        JSON.stringify({ readAt, resolvedAt: row.resolvedAt }),
        crypto.randomUUID(),
        nowIso,
      ),
    ])
    const updated = await c.env.DB.prepare(
      "SELECT id, code, severity, audience, title, body, target_type AS targetType, target_id AS targetId, occurred_at AS occurredAt, read_at AS readAt, resolved_at AS resolvedAt, resolved_by AS resolvedBy FROM alerts WHERE organization_id = ? AND id = ? AND audience = 'store'",
    )
      .bind(org, alertId)
      .first()
    return c.json(Alert.parse(updated))
  })

  .post('/api/staff/alerts/read-all', zValidator('json', AlertReadAllInput), async (c) => {
    const { org, sub } = c.get('auth')
    const input = c.req.valid('json')
    if (input.storeId === undefined) return c.json({ error: 'store_required' }, 400)
    const assigned = await c.env.DB.prepare(
      'SELECT 1 FROM store_memberships WHERE organization_id = ? AND store_id = ? AND user_id = ?',
    )
      .bind(org, input.storeId, sub)
      .first()
    if (assigned === null) return c.json({ error: 'forbidden' }, 403)
    const nowIso = new Date(c.env.TEST_NOW ?? Date.now()).toISOString()
    const updated = await c.env.DB.prepare(
      "UPDATE alerts SET read_at = ? WHERE organization_id = ? AND store_id = ? AND audience = 'store' AND read_at IS NULL",
    )
      .bind(nowIso, org, input.storeId)
      .run()
    return c.json(AlertReadAllResult.parse({ updated: updated.meta.changes }))
  })

  /**
   * 保守の掃除（日次 Cron と、運用者が手で叩く経路の 2 つから呼ばれる）。
   * 共有鍵で守られていて、テナントのトークンでは越えられない。
   */
  .post(
    '/api/internal/maintenance/recordings/purge',
    zValidator('json', RecordingPurgeRequest),
    async (c) => {
      const input = c.req.valid('json')
      const result = await purgeRecordings(c.env, {
        now: input.now === undefined ? new Date() : new Date(input.now),
        limit: input.limit,
      })
      return c.json(RecordingPurgeResult.parse(result))
    },
  )

  /* --- Web 予約の公開設定と承認（P8。staff 4 本） -------------------------- */

  /**
   * SETTINGS-WEB の左（公開の可否・受け付ける内容・お知らせ文）。
   *
   * **行が無い店舗も同じ形で読める**（「公開していません」）。読むだけで行を作らない。
   * 「ご案内のページ」は表に持たず `stores.slug` から組み立てるので、slug を直せば
   * その場で追随する。
   */
  .get('/api/staff/web-booking-settings/:storeId', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const store = await findStore(db, org, c.req.param('storeId'))
    if (!store) return c.json({ error: 'not_found' }, 404)
    const publication = await publicationOf(c.env, db, store, new Date())
    return c.json(
      WebBookingSettings.parse({
        storeId: store.id,
        isPublished: publication.isPublished,
        landingPath: publication.landingPath,
        opensAt: publication.window.opensAt,
        closesAt: publication.window.closesAt,
        acceptFromHours: publication.window.acceptFromHours,
        acceptUntilDays: publication.window.acceptUntilDays,
        changeDeadlineDays: publication.changeDeadlineDays,
        requiresApproval: publication.requiresApproval,
        message: publication.message,
        publishedPurposeIds: publication.purposes.map((purpose) => purpose.id),
        version: publication.version,
        updatedAt: publication.updatedAt,
      }),
    )
  })

  /**
   * SETTINGS-WEB の「保存」。**店長だけ**（`settings.manage`）。
   *
   * 版の条件は `db.batch()` の**全文に配り**、`version` を +1 する文を**最後**に置く。
   * D1 は 0 行しか当たらない `UPDATE` でバッチを止めないので、版を進める 1 文だけに
   * 条件を置くと「409 を返しながら相手の変更を黙って巻き戻す」形になる。
   * 409 の判定は最後の文の `meta.changes === 0`（`03-data-model.md` §2-14）。
   *
   * 「公開する目的」は `visit_purposes.is_web_published` を書き換えることで表す。
   * 目的の公開・非公開を 2 か所に持たない（`04-api.md` §3.12）。
   */
  .put(
    '/api/staff/web-booking-settings/:storeId',
    requireStorePermission('settings.manage'),
    zValidator('json', WebBookingSettingsInput),
    async (c) => {
      const db = drizzle(c.env.DB)
      const { org, sub } = c.get('auth')
      const storeId = c.req.param('storeId')
      const store = await findStore(db, org, storeId)
      if (!store) return c.json({ error: 'not_found' }, 404)
      const input = c.req.valid('json')

      // 目的を選べない予約画面は成立しない。400 ではなく 422（入力の型は正しい）。
      if (input.isPublished && input.publishedPurposeIds.length === 0) {
        return c.json(
          rejected([
            '公開する目的が 0 件のため公開できません。ご来店の目的を 1 つ以上 Web に出してください。',
          ]),
          422,
        )
      }
      // 他店舗・他テナントの目的 id を混ぜた保存は通さない（無い id は「無い」として 404）。
      const publishable = await readPublishablePurposes(db, org, storeId)
      const known = new Set(publishable.map((purpose) => purpose.id))
      if (input.publishedPurposeIds.some((id) => !known.has(id))) {
        return c.json({ error: 'not_found' }, 404)
      }

      const now = new Date().toISOString()
      // 行が無い店舗は版 0 の行を先に作る（バッチの前に済ませる。`ensureVersion` と同じ形）。
      await c.env.DB.prepare(
        'INSERT INTO web_booking_settings (id, organization_id, store_id, is_published, opens_at, ' +
          'closes_at, accept_from_hours, accept_until_days, change_deadline_days, requires_approval, ' +
          'message, version, updated_at, created_at) ' +
          "VALUES (?,?,?,'0','10:30','18:00',2,30,1,'1',NULL,?,?,?) " +
          'ON CONFLICT (organization_id, store_id) DO NOTHING',
      )
        .bind(crypto.randomUUID(), org, storeId, WEB_FIRST_VERSION, now, now)
        .run()

      const guard =
        'EXISTS (SELECT 1 FROM web_booking_settings WHERE organization_id = ? AND store_id = ? AND version = ?)'
      const guardParams = [org, storeId, input.version]
      const statements: Statement[] = [
        // 一度すべて下ろしてから、選ばれたものだけを上げる（差分を数えない）。
        c.env.DB.prepare(
          "UPDATE visit_purposes SET is_web_published = '0', updated_at = ? " +
            `WHERE organization_id = ? AND (store_id = ? OR store_id IS NULL) AND ${guard}`,
        ).bind(now, org, storeId, ...guardParams),
      ]
      for (const purposeId of input.publishedPurposeIds) {
        statements.push(
          c.env.DB.prepare(
            "UPDATE visit_purposes SET is_web_published = '1', updated_at = ? " +
              `WHERE organization_id = ? AND id = ? AND ${guard}`,
          ).bind(now, org, purposeId, ...guardParams),
        )
      }
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, ' +
            'action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) ' +
            `SELECT ?, ?, ?, 'staff', ?, NULL, 'settings.web_booking.updated', 'stores', ?, NULL, ?, ?, ? WHERE ${guard}`,
        ).bind(
          crypto.randomUUID(),
          org,
          storeId,
          await actorStaffId(db, org, storeId, sub),
          storeId,
          JSON.stringify({
            isPublished: input.isPublished,
            opensAt: input.opensAt,
            closesAt: input.closesAt,
            acceptFromHours: input.acceptFromHours,
            acceptUntilDays: input.acceptUntilDays,
            changeDeadlineDays: input.changeDeadlineDays,
            publishedPurposeIds: input.publishedPurposeIds,
          }),
          crypto.randomUUID(),
          now,
          ...guardParams,
        ),
        // **必ず最後**。この 1 文の `meta.changes` だけが 409 の判定を知っている。
        c.env.DB.prepare(
          'UPDATE web_booking_settings SET is_published = ?, opens_at = ?, closes_at = ?, ' +
            'accept_from_hours = ?, accept_until_days = ?, change_deadline_days = ?, ' +
            'requires_approval = ?, message = ?, version = version + 1, updated_at = ? ' +
            'WHERE organization_id = ? AND store_id = ? AND version = ?',
        ).bind(
          flag(input.isPublished),
          input.opensAt,
          input.closesAt,
          input.acceptFromHours,
          input.acceptUntilDays,
          input.changeDeadlineDays,
          flag(input.requiresApproval),
          input.message === '' ? null : input.message,
          now,
          ...guardParams,
        ),
      )
      const saved = await commitSettings(c.env.DB, statements as [Statement, ...Statement[]])
      if (!saved) return c.json({ error: 'version_conflict' }, 409)

      const publication = await publicationOf(c.env, db, store, new Date())
      return c.json(
        WebBookingSettings.parse({
          storeId,
          isPublished: publication.isPublished,
          landingPath: publication.landingPath,
          opensAt: publication.window.opensAt,
          closesAt: publication.window.closesAt,
          acceptFromHours: publication.window.acceptFromHours,
          acceptUntilDays: publication.window.acceptUntilDays,
          changeDeadlineDays: publication.changeDeadlineDays,
          requiresApproval: publication.requiresApproval,
          message: publication.message,
          publishedPurposeIds: publication.purposes.map((purpose) => purpose.id),
          version: publication.version,
          updatedAt: publication.updatedAt,
        }),
      )
    },
  )

  /**
   * SETTINGS-WEB の右「お客様の画面の見え方」。**保存を伴わない** —
   * 未保存の目的とお知らせ文をクエリで受け取り、そのまま組み立てて返す。
   * 保存の前に「社内の言葉が漏れていないか」をその場で確かめるための面である。
   */
  .get('/api/staff/web-booking-settings/:storeId/preview', async (c) => {
    const db = drizzle(c.env.DB)
    const org = c.get('auth').org
    const store = await findStore(db, org, c.req.param('storeId'))
    if (!store) return c.json({ error: 'not_found' }, 404)
    const query = validQuery(c, WebPreviewQuery, c.req.query())
    const publication = await publicationOf(c.env, db, store, new Date())
    const draft = new Set(query.purposeIds)
    return c.json(
      WebPreviewResult.parse({
        // お客様に見せる店名（`stores.name_public`）。店内名を出さない。
        storeName: publicStoreName(store),
        purposes:
          query.purposeIds.length === 0
            ? publication.purposes
            : publication.purposes.filter((purpose) => draft.has(purpose.id)),
        message: query.message ?? publication.message,
      }),
    )
  })

  /**
   * 確認待ちの Web 予約を確かめる（ALERTS →「内容を確認」）。**店長だけ。**
   *
   * `approve` は `web_bookings.status` だけを動かす（予約本体は作成の時点で
   * `confirmed` なので、承認は台帳の予約を作り直さない）。`reject` は台帳ごと取り消す。
   */
  .post(
    '/api/staff/web-bookings/:webBookingId/review',
    requireStorePermission('settings.manage'),
    zValidator('json', WebBookingReviewInput),
    async (c) => {
      const org = c.get('auth').org
      const input = c.req.valid('json')
      const row = await c.env.DB.prepare(
        'SELECT id, store_id AS storeId, reservation_id AS reservationId, status, ' +
          'public_code AS publicCode, contact_email AS contactEmail ' +
          'FROM web_bookings WHERE organization_id = ?1 AND id = ?2',
      )
        .bind(org, c.req.param('webBookingId'))
        .first<{
          id: string
          storeId: string
          reservationId: string
          status: string
          publicCode: string
          contactEmail: string
        }>()
      if (row === null) return c.json({ error: 'not_found' }, 404)
      // `pending` 以外に叩くと 409（二重の承認・取消のあとの承認を止める）。
      if (row.status !== 'pending') return c.json({ error: 'invalid_transition' }, 409)

      const now = new Date().toISOString()
      if (input.decision === 'approve') {
        await c.env.DB.prepare(
          "UPDATE web_bookings SET status = 'confirmed', confirmed_at = ?, updated_at = ? " +
            "WHERE organization_id = ? AND id = ? AND status = 'pending'",
        )
          .bind(now, now, org, row.id)
          .run()
      } else {
        const results = await c.env.DB.batch([
          c.env.DB.prepare(
            "UPDATE web_bookings SET status = 'cancelled', cancelled_at = ?, updated_at = ? " +
              "WHERE organization_id = ? AND id = ? AND status = 'pending'",
          ).bind(now, now, org, row.id),
          c.env.DB.prepare(
            "UPDATE reservations SET status = 'cancelled', cancelled_at = ?, cancel_reason = 'store', " +
              'updated_at = ?, version = version + 1 WHERE organization_id = ? AND id = ? ' +
              "AND status NOT IN ('cancelled','no_show') AND EXISTS (" +
              'SELECT 1 FROM web_bookings WHERE organization_id = ? AND id = ? ' +
              "AND status = 'cancelled' AND cancelled_at = ?)",
          ).bind(now, now, org, row.reservationId, org, row.id, now),
          c.env.DB.prepare(
            'DELETE FROM reservation_slot_locks WHERE organization_id = ? AND reservation_id = ? ' +
              'AND EXISTS (SELECT 1 FROM web_bookings WHERE organization_id = ? AND id = ? ' +
              "AND status = 'cancelled' AND cancelled_at = ?)",
          ).bind(org, row.reservationId, org, row.id, now),
        ])
        if ((results[0]?.meta.changes ?? 0) === 0) {
          return c.json({ error: 'invalid_transition' }, 409)
        }
      }
      const detail = await reservationDetailOf(c.env, org, row.reservationId)
      if (detail === null) return c.json({ error: 'not_found' }, 404)
      return c.json(detail)
    },
  )

  /* --- 公開面（P8。未認証。10 本） ---------------------------------------- */

  /**
   * WEB-01-STORE の店舗一覧。**位置情報を受け取らない**（並びは `stores.sort_order`）。
   * 公開していない店舗と、出すご用件が 1 件も無い店舗は最初から出ない。
   */
  .get('/api/public/stores', async (c) => {
    const query = validQuery(c, PublicStoreSearchQuery, c.req.query())
    const found = await c.env.DB.prepare(
      'SELECT s.slug AS slug, COALESCE(s.name_public, s.name) AS name, ' +
        's.access_note AS accessNote FROM stores s ' +
        'JOIN web_booking_settings w ON w.organization_id = s.organization_id AND w.store_id = s.id ' +
        "WHERE w.is_published = '1' AND s.is_active = '1' " +
        'AND EXISTS (SELECT 1 FROM visit_purposes p WHERE p.organization_id = s.organization_id ' +
        'AND (p.store_id = s.id OR p.store_id IS NULL) ' +
        "AND p.is_web_published = '1' AND p.is_active = '1') " +
        'ORDER BY COALESCE(s.sort_order, 2147483647) ASC, s.created_at ASC LIMIT ?1',
    )
      .bind(query.limit)
      .all<{ slug: string; name: string; accessNote: string }>()
    return c.json(PublicStoreSummary.array().parse(found.results))
  })

  /**
   * ヘッダーの店名・道順と、完了画面の地図。
   * **公開していない店舗は「無い」と同じ答えを返す**（body まで同じにする）。
   */
  .get('/api/public/stores/:storeSlug', async (c) => {
    const db = drizzle(c.env.DB)
    const store = await storeBySlug(db, c.req.param('storeSlug'))
    if (store === null) return c.json(NOT_PUBLISHED, 404)
    const publication = await publicationOf(c.env, db, store, new Date())
    if (!publication.isPublished || !isOn(store.isActive)) return c.json(NOT_PUBLISHED, 404)
    return c.json(
      PublicStoreDetail.parse({
        slug: store.slug,
        name: publicStoreName(store),
        accessNote: store.accessNote,
        phone: store.phone,
        address: store.address,
        message: publication.message,
        isPublished: true,
      }),
    )
  })

  /** WEB-02-PURPOSE。**対客名と目安の分数だけ**で、店内名・技能・設備を持たない。 */
  .get('/api/public/stores/:storeSlug/purposes', async (c) => {
    const db = drizzle(c.env.DB)
    const store = await storeBySlug(db, c.req.param('storeSlug'))
    if (store === null) return c.json(NOT_PUBLISHED, 404)
    const publication = await publicationOf(c.env, db, store, new Date())
    if (!publication.isPublished || !isOn(store.isActive)) return c.json(NOT_PUBLISHED, 404)
    return c.json(PublicStorePurpose.array().parse(publication.purposes))
  })

  /**
   * WEB-03-DATETIME の週の空き。返すのは**空いているかどうかだけ**で、
   * 誰が・どの台がという内訳は出さない。**KV を 1 度も読まない**（`04-api.md` §6.3）。
   */
  .get('/api/public/stores/:storeSlug/availability', async (c) => {
    const db = drizzle(c.env.DB)
    const store = await storeBySlug(db, c.req.param('storeSlug'))
    if (store === null) return c.json(NOT_PUBLISHED, 404)
    const query = validQuery(c, PublicAvailabilityQuery, c.req.query())
    const now = new Date()
    const publication = await publicationOf(c.env, db, store, now)
    if (!publication.isPublished || !isOn(store.isActive)) return c.json(NOT_PUBLISHED, 404)
    const purpose = publication.purposes.find((row) => row.id === query.purposeId)
    if (purpose === undefined) return c.json({ error: 'purpose_unavailable' }, 409)

    const days: { date: string; isClosed: boolean; isFull: boolean; slots: unknown[] }[] = []
    for (let date = query.from; date <= query.to; date = addJstDays(date, 1)) {
      const rows = await readAvailabilityDay(db, {
        organizationId: store.organizationId,
        storeId: store.id,
        date,
        purposeIds: [purpose.id],
      })
      const answer = computeAvailability(
        webBoard({
          date,
          now,
          rows,
          isSuspended: !isOn(store.isActive),
          durationMinutes: purpose.durationMinutes,
          window: publication.window,
        }),
      )
      const slots = publicSlots(answer.slots)
      days.push({
        date,
        isClosed: answer.isClosed,
        isFull: !answer.isClosed && slots.every((slot) => !slot.isAvailable),
        slots: answer.isClosed ? [] : slots,
      })
    }
    return c.json(PublicAvailabilityResponse.parse({ days }))
  })

  /**
   * WEB-05-CONFIRM の「この内容で予約する」。
   *
   * 書き込みは **1 つの `db.batch()`** に入る（枠の占有 → 予約本体 → ご用件 → 割当 →
   * 監査 → Web 予約 → 冪等の `done`）。1 本目の占有行が 1 行も入らなければ枠は取れて
   * おらず、そのとき D1 には 1 行も書かれていない。
   *
   * 担当も設備も**指定しない**。お客様に社内の割り当てを選ばせないので、
   * `kind='staff'` の割当は `target_id = NULL`（あとで決める）1 行だけになり、
   * 二重予約は店舗の同時受付上限（`max_parallel`）が止める。
   *
   * 確認メールは予約を書き終えてから送る。**送れなくても予約を巻き戻さない。**
   */
  .post(
    '/api/public/stores/:storeSlug/bookings',
    zValidator('json', PublicBookingCreate),
    async (c) => {
      const db = drizzle(c.env.DB)
      const store = await storeBySlug(db, c.req.param('storeSlug'))
      if (store === null) return c.json(NOT_PUBLISHED, 404)
      const input = c.req.valid('json')
      const now = new Date()
      const publication = await publicationOf(c.env, db, store, now)
      if (!publication.isPublished || !isOn(store.isActive)) return c.json(NOT_PUBLISHED, 404)
      const purpose = publication.purposes.find((row) => row.id === input.purposeId)
      if (purpose === undefined) return c.json({ error: 'purpose_unavailable' }, 409)

      const org = store.organizationId
      const date = toJstDateString(input.startsAt)
      const rows = await readAvailabilityDay(db, {
        organizationId: org,
        storeId: store.id,
        date,
        purposeIds: [purpose.id],
      })
      const slotRules = rows.slotRules
      // 予約の間隔が決まっていない店舗は、そもそも Web に出せない（暗黙の既定値を作らない）。
      if (slotRules === null) return c.json(NOT_PUBLISHED, 404)
      if (rows.missingPurposes > 0) return c.json({ error: 'purpose_unavailable' }, 409)

      const durationMinutes = purpose.durationMinutes
      const endsAt = new Date(
        Date.parse(input.startsAt) + durationMinutes * MS_PER_MINUTE,
      ).toISOString()
      const boardOf = (source: AvailabilityDayRows) =>
        webBoard({
          date,
          now,
          rows: source,
          isSuspended: !isOn(store.isActive),
          durationMinutes,
          window: publication.window,
          preferredStartsAt: input.startsAt,
        })
      const verdict = evaluateSlot(boardOf(rows), input.startsAt)
      if (verdict.reason !== null) {
        const blocked = PUBLIC_BLOCKING[verdict.reason]
        if (blocked !== 'slot_taken') return c.json({ error: blocked }, 409)
        const answer = computeAvailability(boardOf(rows))
        return c.json(
          {
            error: 'slot_taken' as const,
            alternatives: AvailabilitySlot.array().max(3).parse(answer.alternatives),
          },
          409,
        )
      }

      // 冪等（`04-api.md` §6.2）。二度押しと回線断の再送を 1 件に畳む。
      const header = readIdempotencyKey(c.req.header('Idempotency-Key'))
      if (!header.ok) {
        return c.json(
          rejected([
            'Idempotency-Key に使えない文字が入っているため送れませんでした。もう一度お試しください。',
          ]),
          400,
        )
      }
      const clientKey = header.key
      let idempotencyKey: string | null = null
      if (clientKey !== null) {
        const started = await beginIdempotency(c.env.DB, {
          organizationId: org,
          scope: 'public.booking.create',
          clientKey,
          requestHash: await requestHash(input),
          now,
        })
        // **再実行しない。**確認番号を含む応答をそのまま返す（同じ番号が返る）。
        if (started.state === 'replay') return c.json(PublicBookingResult.parse(started.response))
        if (started.state === 'conflict') return c.json({ error: 'idempotency_conflict' }, 409)
        idempotencyKey = started.key
      }

      const reservationId = crypto.randomUUID()
      const webBookingId = crypto.randomUUID()
      const correlationId = crypto.randomUUID()
      const managementCode = issueManagementCode()
      const confirmationKey = issueConfirmationKey()
      const pending = requiresApproval(toWebSettingsRow(await readWebSettings(db, org, store.id)))
      const month = webBookingCodeMonth(now)
      const maxSerial = await c.env.DB.prepare(
        `SELECT MAX(CAST(SUBSTR(public_code, ${WEB_CODE_SERIAL_OFFSET + 1}) AS INTEGER)) AS maxSerial ` +
          'FROM web_bookings WHERE organization_id = ?1 AND public_code LIKE ?2',
      )
        .bind(org, `EY-W-${month}-%`)
        .first<{ maxSerial: number | null }>()
      let publicCode = nextPublicCode(month, maxSerial?.maxSerial ?? null)

      const attempt = await withReservationCode(c.env.DB, org, now, async (code) => {
        for (let tries = 1; tries <= WEB_CODE_ATTEMPTS; tries += 1) {
          const result = PublicBookingResult.parse({
            code: publicCode,
            status: pending ? 'pending' : 'confirmed',
            startsAt: input.startsAt,
            endsAt,
            storeName: publicStoreName(store),
            purposeName: purpose.name,
            contactName: input.contactName,
            managementCode,
            // 送れたかどうかは D1 を書き終えてから決まる。ここでは仮に false を置く。
            emailed: false,
          })
          const statements = bookingStatements(c.env.DB, {
            organizationId: org,
            storeId: store.id,
            reservationId,
            code,
            source: 'web',
            startsAt: input.startsAt,
            endsAt,
            durationMinutes,
            purposes: [{ purposeId: purpose.id, durationMinutes, sortOrder: 0 }],
            staff: null,
            equipment: [],
            slotRules,
            noteCustomer: '',
            noteInternal: '',
            actorId: null,
            actorType: 'customer',
            correlationId,
            receptionSessionId: null,
            idempotency: null,
            now,
          })
          // ④ Web 予約。**生の確認番号・確認鍵を保存しない**（ハッシュだけを入れる）。
          statements.push(
            c.env.DB.prepare(
              'INSERT INTO web_bookings (id, organization_id, store_id, reservation_id, public_code, ' +
                'confirmation_key_hash, management_code_hash, contact_name, contact_kana, contact_phone, ' +
                'contact_email, status, created_at, confirmed_at, cancelled_at, updated_at) ' +
                `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ? WHERE ${WEB_LOCKED}`,
            ).bind(
              webBookingId,
              org,
              store.id,
              reservationId,
              publicCode,
              await hashConfirmationKey(confirmationKey, managementSalt(org, publicCode)),
              await hashManagementCode(managementCode, managementSalt(org, publicCode)),
              input.contactName,
              input.contactKana === '' ? null : input.contactKana,
              input.contactPhone,
              input.contactEmail,
              pending ? 'pending' : 'confirmed',
              now.toISOString(),
              now.toISOString(),
              org,
              reservationId,
            ),
          )
          if (idempotencyKey !== null) {
            // **本処理と `done` 化を別の文に分けない**（片方だけ成功する窓を作らない）。
            statements.push(
              c.env.DB.prepare(
                "UPDATE idempotency_records SET status = 'done', response_json = ? " +
                  `WHERE key = ? AND status = 'in_progress' AND ${WEB_LOCKED}`,
              ).bind(JSON.stringify(result), idempotencyKey, org, reservationId),
            )
          }
          try {
            const results = await c.env.DB.batch(statements)
            return { taken: (results[0]?.meta.changes ?? 0) === 0, result, exhausted: false }
          } catch (err) {
            // ご予約番号の衝突だけを打ち直す。ほかの制約違反は投げ直す（握りつぶさない）。
            if (constraintTable(err) !== 'web_bookings') throw err
            publicCode = bumpPublicCode(publicCode)
          }
        }
        return { taken: false, result: null, exhausted: true }
      }).catch(async (err: unknown) => {
        if (idempotencyKey !== null) await releaseIdempotency(c.env.DB, idempotencyKey)
        throw err
      })

      if (!attempt.ok || attempt.value.exhausted || attempt.value.result === null) {
        if (idempotencyKey !== null) await releaseIdempotency(c.env.DB, idempotencyKey)
        return c.json({ error: 'code_exhausted' }, 409)
      }
      if (attempt.value.taken) {
        // 鍵を空けて、同じ鍵のまま時刻を選び直せるようにする。
        if (idempotencyKey !== null) await releaseIdempotency(c.env.DB, idempotencyKey)
        const fresh = await readAvailabilityDay(db, {
          organizationId: org,
          storeId: store.id,
          date,
          purposeIds: [purpose.id],
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

      // 予約はもう成立している。ここから先が失敗しても巻き戻さない（`04-api.md` §7.2）。
      const emailed = await sendReservationMail(c.env, {
        organizationId: org,
        reservationId,
        to: input.contactEmail,
        managementCode,
        reservationNumber: attempt.value.result.code,
        storeName: publicStoreName(store),
        appointmentAt: input.startsAt,
      })
      return c.json(PublicBookingResult.parse({ ...attempt.value.result, emailed }))
    },
  )

  /**
   * WEB-CANCEL の本人確認（2 手順のうち 1 つ目）。
   *
   * ご予約番号と確認番号（`X-Management-Code`）が合ったときだけ、**900 秒の短命の鍵**を
   * 返す。失敗は**コード × IP** で数え、10 回で 429（15 分お待ちいただく）。
   * **どちらが違うかを言わない** — 無い番号も番号違いも同じ status・同じ body にする。
   */
  .post(
    '/api/public/reservations/verify',
    zValidator('json', PublicReservationVerification),
    async (c) => {
      const input = c.req.valid('json')
      const ip = clientIpOf(c)
      if (isManagementCodeLocked(await failureCount(c.env, input.code, ip))) {
        return c.json(
          {
            error: 'management_code_locked' as const,
            retryAfterSeconds: MANAGEMENT_CODE_RETRY_AFTER_SECONDS,
          },
          429,
        )
      }
      const now = new Date()
      const row = await authenticateWebBooking(c.env, {
        publicCode: input.code,
        presented: c.req.header('X-Management-Code') ?? '',
        now,
      })
      if (row === null) {
        await countFailure(c.env, input.code, ip)
        return c.json(INVALID_MANAGEMENT_CODE, 401)
      }
      const shortLived = issueManagementCode()
      const expiresAt = shortLivedExpiresAt(now)
      await c.env.SHORT_LIVED.put(
        shortLivedKey(row.organizationId, shortLived),
        JSON.stringify({
          organizationId: row.organizationId,
          publicCode: row.publicCode,
          expiresAt,
        }),
        { expirationTtl: WEB_SHORT_LIVED_TTL_SECONDS },
      )
      return c.json(
        PublicReservationVerificationResult.parse({ managementCode: shortLived, expiresAt }),
      )
    },
  )

  /**
   * WEB-CANCEL の明細。**確認番号を 1 度も返さない**（平文が出るのは予約を作った 1 回だけ）。
   * 確認メールを送れていなかったご予約は、ここで 1 度だけ再送を試みる（§7.2 の再検知）。
   */
  .get('/api/public/reservations/:code', async (c) => {
    const publicCode = c.req.param('code')
    const ip = clientIpOf(c)
    if (isManagementCodeLocked(await failureCount(c.env, publicCode, ip))) {
      return c.json(
        {
          error: 'management_code_locked' as const,
          retryAfterSeconds: MANAGEMENT_CODE_RETRY_AFTER_SECONDS,
        },
        429,
      )
    }
    const now = new Date()
    const row = await authenticateWebBooking(c.env, {
      publicCode,
      presented: c.req.header('X-Management-Code') ?? '',
      now,
    })
    if (row === null) {
      await countFailure(c.env, publicCode, ip)
      return c.json(INVALID_MANAGEMENT_CODE, 401)
    }
    const db = drizzle(c.env.DB)
    const settings = toWebSettingsRow(await readWebSettings(db, row.organizationId, row.storeId))
    const status = await webReservationStatus(
      c.env.DB,
      row,
      settings?.changeDeadlineDays ?? DEFAULT_CHANGE_DEADLINE_DAYS,
    )
    // 控えが無い＝前に送れていない。**確認番号の平文はもう持っていない**ので、
    // ここで送るのは「ご予約が確定しました」の 1 通だけである（番号は画面に出ている）。
    if (
      row.webStatus !== 'cancelled' &&
      (await c.env.SHORT_LIVED.get(mailSentKey(row.organizationId, row.reservationId))) === null
    ) {
      await sendReservationMail(c.env, {
        organizationId: row.organizationId,
        reservationId: row.reservationId,
        to: row.contactEmail,
        managementCode: row.publicCode,
        reservationNumber: row.publicCode,
        storeName: row.storeNamePublic ?? row.storeName,
        appointmentAt: row.startsAt,
      })
    }
    return c.json(PublicReservationStatus.parse(status))
  })

  /** WEB-CANCEL「日時を変更する」の候補。WEB-03 と同じ形を返す。 */
  .get('/api/public/reservations/:code/availability', async (c) => {
    const publicCode = c.req.param('code')
    const now = new Date()
    const row = await authenticateWebBooking(c.env, {
      publicCode,
      presented: c.req.header('X-Management-Code') ?? '',
      now,
    })
    if (row === null) {
      await countFailure(c.env, publicCode, clientIpOf(c))
      return c.json(INVALID_MANAGEMENT_CODE, 401)
    }
    const db = drizzle(c.env.DB)
    const store = await storeBySlug(db, row.storeSlug)
    if (store === null) return c.json(NOT_PUBLISHED, 404)
    const query = validQuery(c, PublicAvailabilityQuery, c.req.query())
    const publication = await publicationOf(c.env, db, store, now)
    const purpose = publication.purposes.find((item) => item.id === query.purposeId)
    if (purpose === undefined) return c.json({ error: 'purpose_unavailable' }, 409)

    const days: { date: string; isClosed: boolean; isFull: boolean; slots: unknown[] }[] = []
    for (let date = query.from; date <= query.to; date = addJstDays(date, 1)) {
      const rows = await readAvailabilityDay(db, {
        organizationId: row.organizationId,
        storeId: row.storeId,
        date,
        purposeIds: [purpose.id],
      })
      const answer = computeAvailability(
        webBoard({
          date,
          now,
          rows,
          isSuspended: !isOn(store.isActive),
          durationMinutes: purpose.durationMinutes,
          window: publication.window,
          // いま入っているご予約自身が自分の変更を邪魔しない。
          excludeReservationId: row.reservationId,
        }),
      )
      const slots = publicSlots(answer.slots)
      days.push({
        date,
        isClosed: answer.isClosed,
        isFull: !answer.isClosed && slots.every((slot) => !slot.isAvailable),
        slots: answer.isClosed ? [] : slots,
      })
    }
    return c.json(PublicAvailabilityResponse.parse({ days }))
  })

  /**
   * WEB-CANCEL「日時を変更する」。**締切を過ぎたら何も動かない。**
   * 移す先が埋まっていれば 409 `slot_taken` で、元の時刻のまま残る
   * （新しい枠を取ってから古い枠を返すので、取れなければ古い枠は空かない）。
   */
  .patch(
    '/api/public/reservations/:code',
    zValidator('json', PublicReservationChange),
    async (c) => {
      const publicCode = c.req.param('code')
      const now = new Date()
      const row = await authenticateWebBooking(c.env, {
        publicCode,
        presented: c.req.header('X-Management-Code') ?? '',
        now,
      })
      if (row === null) {
        await countFailure(c.env, publicCode, clientIpOf(c))
        return c.json(INVALID_MANAGEMENT_CODE, 401)
      }
      if (row.webStatus === 'cancelled' || row.reservationStatus === 'cancelled') {
        return c.json({ error: 'invalid_transition' }, 409)
      }
      const db = drizzle(c.env.DB)
      const settings = toWebSettingsRow(await readWebSettings(db, row.organizationId, row.storeId))
      const changeDeadlineDays = settings?.changeDeadlineDays ?? DEFAULT_CHANGE_DEADLINE_DAYS
      if (
        isChangeDeadlinePassed(
          { visitDate: toJstDateString(row.startsAt), changeDeadlineDays },
          now,
        )
      ) {
        return c.json({ error: 'change_deadline_passed' }, 409)
      }
      const store = await storeBySlug(db, row.storeSlug)
      if (store === null) return c.json(NOT_PUBLISHED, 404)
      const publication = await publicationOf(c.env, db, store, now)
      if (!publication.isPublished) return c.json(NOT_PUBLISHED, 404)

      const input = c.req.valid('json')
      const date = toJstDateString(input.startsAt)
      const purposeRows = await c.env.DB.prepare(
        'SELECT purpose_id AS purposeId, duration_minutes AS durationMinutes, sort_order AS sortOrder ' +
          'FROM reservation_purposes WHERE organization_id = ?1 AND reservation_id = ?2 ORDER BY sort_order',
      )
        .bind(row.organizationId, row.reservationId)
        .all<{ purposeId: string; durationMinutes: number; sortOrder: number }>()
      const purposeIds = purposeRows.results.map((line) => line.purposeId)
      const rows = await readAvailabilityDay(db, {
        organizationId: row.organizationId,
        storeId: row.storeId,
        date,
        purposeIds,
      })
      const slotRules = rows.slotRules
      if (slotRules === null) return c.json(NOT_PUBLISHED, 404)
      // ご用件の所要は**予約した時点の写し**。日時だけを動かすので読み直さない。
      const durationMinutes = row.durationMinutes
      const endsAt = new Date(
        Date.parse(input.startsAt) + durationMinutes * MS_PER_MINUTE,
      ).toISOString()
      const boardOf = (source: AvailabilityDayRows) =>
        webBoard({
          date,
          now,
          rows: source,
          isSuspended: !isOn(store.isActive),
          durationMinutes,
          window: publication.window,
          preferredStartsAt: input.startsAt,
          excludeReservationId: row.reservationId,
        })
      const verdict = evaluateSlot(boardOf(rows), input.startsAt)
      if (verdict.reason !== null) {
        const blocked = PUBLIC_BLOCKING[verdict.reason]
        if (blocked !== 'slot_taken') return c.json({ error: blocked }, 409)
        const answer = computeAvailability(boardOf(rows))
        return c.json(
          {
            error: 'slot_taken' as const,
            alternatives: AvailabilitySlot.array().max(3).parse(answer.alternatives),
          },
          409,
        )
      }

      // 古い枠と新しい枠は `created_at` で見分ける。同じミリ秒に 2 度直せないようにする。
      const batchAt = new Date(Math.max(now.getTime(), Date.parse(row.updatedAt) + 1)).toISOString()
      const statements = buildChangeBatch({
        db: c.env.DB,
        organizationId: row.organizationId,
        storeId: row.storeId,
        reservationId: row.reservationId,
        version: row.version,
        batchAt,
        requests: slotLockRequests({
          slotStarts: expandToSlotStarts({
            startsAt: input.startsAt,
            endsAt,
            slotMinutes: slotRules.slotMinutes,
            cleanupMinutes: slotRules.cleanupMinutes,
          }),
          // 公開面は担当も設備も指定しない（`kind='staff'` の 1 行だけを積み直す）。
          staff: null,
          equipment: [],
          maxParallel: slotRules.maxParallel,
        }),
        after: {
          startsAt: input.startsAt,
          endsAt,
          durationMinutes,
          noteCustomer: row.noteCustomer ?? '',
          noteInternal: row.noteInternal ?? '',
        },
        purposes: purposeRows.results.map((line, index) => ({
          purposeId: line.purposeId,
          durationMinutes: line.durationMinutes,
          sortOrder: index,
        })),
        assignments: [{ kind: 'staff', targetId: null }],
        actorId: null,
        actorType: 'customer',
        correlationId: crypto.randomUUID(),
        // 監査は追記専用。平文のお名前・お電話番号を入れない（`07-nfr.md` §6.6）。
        audit: {
          before: { startsAt: row.startsAt, endsAt: row.endsAt, source: 'web' },
          after: { startsAt: input.startsAt, endsAt, source: 'web' },
        },
      })
      const results = await c.env.DB.batch(statements as [Statement, ...Statement[]])
      if ((results[results.length - 1]?.meta.changes ?? 0) === 0) {
        const fresh = await readAvailabilityDay(db, {
          organizationId: row.organizationId,
          storeId: row.storeId,
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
      await c.env.DB.prepare(
        'UPDATE web_bookings SET updated_at = ? WHERE organization_id = ? AND id = ?',
      )
        .bind(batchAt, row.organizationId, row.id)
        .run()

      const purpose = await webBookingPurpose(c.env.DB, row.organizationId, row.reservationId)
      return c.json(
        PublicReservationChangeResult.parse({
          code: row.publicCode,
          status: row.webStatus,
          startsAt: input.startsAt,
          endsAt,
          storeName: row.storeNamePublic ?? row.storeName,
          purposeName: purpose.name,
          durationMinutes: purpose.durationMinutes,
          contactName: row.contactName,
          changeDeadlineAt: changeDeadlineAt(date, changeDeadlineDays),
          previousStartsAt: row.startsAt,
        }),
      )
    },
  )

  /**
   * WEB-CANCEL「この予約を取り消す」。
   *
   * `web_bookings` と `reservations` の両方を落とし、枠の占有を返す。
   * **取消のメールは送らない**（`notification.ts` に取消の型が無く、足すのは人間の
   * 承認事項。`04-api.md` §7.1）。
   */
  .post(
    '/api/public/reservations/:code/cancel',
    zValidator('json', PublicReservationCancel),
    async (c) => {
      const publicCode = c.req.param('code')
      const now = new Date()
      const row = await authenticateWebBooking(c.env, {
        publicCode,
        presented: c.req.header('X-Management-Code') ?? '',
        now,
      })
      if (row === null) {
        await countFailure(c.env, publicCode, clientIpOf(c))
        return c.json(INVALID_MANAGEMENT_CODE, 401)
      }
      // 取り消した予約をもう一度取り消させない（版だけでは 2 度目を止められない）。
      if (row.webStatus === 'cancelled' || row.reservationStatus === 'cancelled') {
        return c.json({ error: 'invalid_transition' }, 409)
      }
      const db = drizzle(c.env.DB)
      const settings = toWebSettingsRow(await readWebSettings(db, row.organizationId, row.storeId))
      if (
        isChangeDeadlinePassed(
          {
            visitDate: toJstDateString(row.startsAt),
            changeDeadlineDays: settings?.changeDeadlineDays ?? DEFAULT_CHANGE_DEADLINE_DAYS,
          },
          now,
        )
      ) {
        return c.json({ error: 'change_deadline_passed' }, 409)
      }

      const cancelledAt = now.toISOString()
      const statements = buildCancelBatch({
        db: c.env.DB,
        organizationId: row.organizationId,
        storeId: row.storeId,
        reservationId: row.reservationId,
        version: row.version,
        reason: 'customer',
        now,
        actorId: null,
        actorType: 'customer',
        correlationId: crypto.randomUUID(),
        audit: { before: { startsAt: row.startsAt, source: 'web' } },
      })
      // **最後に置く。**台帳が取り消せていなければ、この 1 文は 0 行にしか当たらない
      // （版を +1 する `UPDATE reservations` はドメインの配列の最後にある）。
      statements.push(
        c.env.DB.prepare(
          "UPDATE web_bookings SET status = 'cancelled', cancelled_at = ?, updated_at = ? " +
            'WHERE organization_id = ? AND id = ? AND EXISTS (SELECT 1 FROM reservations ' +
            "WHERE organization_id = ? AND id = ? AND status = 'cancelled')",
        ).bind(
          cancelledAt,
          cancelledAt,
          row.organizationId,
          row.id,
          row.organizationId,
          row.reservationId,
        ),
      )
      const results = await c.env.DB.batch(statements as [Statement, ...Statement[]])
      if ((results[results.length - 1]?.meta.changes ?? 0) === 0) {
        return c.json({ error: 'invalid_transition' }, 409)
      }
      return c.json(
        PublicReservationMutationResult.parse({
          code: row.publicCode,
          status: 'cancelled',
          cancelledAt,
        }),
      )
    },
  )

  /**
   * 確認待ちのまま**受信日**の 24:00 JST を越えた Web 予約を自動で取り消す保守。
   * 共有鍵で守られていて、テナントのトークンでは越えられない。
   * `now` を受け取れるようにしてあるのは、日境界をテストから注入するためである。
   */
  .post(
    '/api/internal/maintenance/web-publications/apply',
    zValidator('json', WebPublicationApplyRequest),
    async (c) => {
      const input = c.req.valid('json')
      const result = await applyWebPublications(c.env, {
        now: input.now === undefined ? new Date() : new Date(input.now),
        limit: input.limit,
      })
      return c.json(WebPublicationApplyResult.parse(result))
    },
  )
  .get(
    '/api/staff/analytics',
    zValidator('query', AnalyticsQuery),
    requireStorePermission('analytics.read', { storeIdFrom: 'query' }),
    async (c) => {
      const input = c.req.valid('query')
      // P9 の読出し境界: reservations / events などの生表をここで参照しない。
      const period = analyticsPreviousMonthRange(input.from)
      const overviewPeriod = analyticsOverviewWeekRange(input.from, input.to)
      const metrics = JSON.stringify(analyticsStoredMetrics(input.metric, input.countBy))
      const statement =
        'SELECT date, metric, dimension, dimension_key AS dimensionKey, dimension_label AS dimensionLabel, value FROM analytics_daily ' +
        'WHERE organization_id = ?1 AND store_id = ?2 AND date >= ?3 AND date <= ?4 ' +
        'AND metric IN (SELECT value FROM json_each(?5))'
      const [rows, comparisonRows, overviewRows] = await Promise.all([
        c.env.DB.prepare(statement)
          .bind(c.get('auth').org, input.storeId, input.from, input.to, metrics)
          .all<{
            date: string
            metric: string
            dimension: string
            dimensionKey: string
            dimensionLabel: string
            value: number
          }>(),
        input.metric === 'wait_time'
          ? c.env.DB.prepare(statement)
              .bind(
                c.get('auth').org,
                input.storeId,
                period.from,
                period.to,
                JSON.stringify(['wait_seconds_histogram']),
              )
              .all<{
                date: string
                metric: string
                dimension: string
                dimensionKey: string
                dimensionLabel: string
                value: number
              }>()
          : Promise.resolve({ results: [] }),
        input.metric === 'overview'
          ? c.env.DB.prepare(statement)
              .bind(
                c.get('auth').org,
                input.storeId,
                overviewPeriod.from,
                overviewPeriod.to,
                JSON.stringify(['reservations']),
              )
              .all<{
                date: string
                metric: string
                dimension: string
                dimensionKey: string
                dimensionLabel: string
                value: number
              }>()
          : Promise.resolve({ results: [] }),
      ])
      return c.json(
        AnalyticsReport.parse(
          buildAnalyticsReport({
            ...input,
            rows: rows.results,
            comparisonRows: comparisonRows.results,
            overviewRows: overviewRows.results,
          }),
        ),
      )
    },
  )
  .get(
    '/api/staff/analytics/targets',
    zValidator('query', StoreIdQuery),
    requireStorePermission('analytics.read', { storeIdFrom: 'query' }),
    (c) =>
      c.json(
        AnalyticsTargets.parse({
          waitMinutes: 8,
          cancellationRatePercent: 10,
          revisitWindowDays: 90,
        }),
      ),
  )
  .post(
    '/api/internal/maintenance/analytics/rollup',
    zValidator('json', AnalyticsRollupRequest),
    async (c) => {
      const input = c.req.valid('json')
      const result = await rollupAnalytics(c.env, { ...input, now: new Date() })
      return c.json(AnalyticsRollupResult.parse(result))
    },
  )

// web 側はこの型だけを（type-only で）読み、`hc<AppType>` のクライアントを作る。
export type AppType = typeof routes

/**
 * 日次の保守（`wrangler.jsonc` の `triggers.crons`）。**アカウント全体の Cron 枠 5 本の
 * うち 1 本目**をこのサービスが使う（`04-api.md` §3.2）。
 *
 * **1 つが失敗しても後続を止めない。**いまは録音の掃除 1 本だが、P8 以降がこの中へ
 * 処理を足していくので、try/catch で包む形を最初から作っておく（1 本目が投げたせいで
 * 勤務の窓送りが止まる、という壊れ方を作らない）。
 */
type ScheduledMaintenanceTasks = {
  applyWebPublications: (now: Date) => Promise<unknown>
  readRollupCursor: () => Promise<string | undefined>
  rollupAnalytics: (input: {
    from: string
    to: string
    limit: number
    storeCursor?: string
    now: Date
    completedThrough?: string
  }) => Promise<{ nextStoreCursor: string | null; failedStores: string[]; dropped: number }>
  writeRollupCursor: (cursor: string | null) => Promise<unknown>
  purgeRecordings: (now: Date) => Promise<unknown>
  purgeAuditAndSessions?: (now: Date) => Promise<unknown>
  expandShiftWindow?: (now: Date) => Promise<unknown>
}

/**
 * 勤務の曜日テンプレートを、窓の先端の 1 日ぶんだけ日付の行へ展開する。
 *
 * `staff_weekly_shifts` が正本で、`staff_shifts` はその展開結果である
 * （`004-store-settings/spec.md`「62 日先までを展開した結果で、**保存時と日次 Cron の
 * 両方で展開する**」）。保存時しか展開していなかったので、設定を触らないまま
 * 62 日が過ぎると勤務の行が尽き、台帳に担当者の行が出ず空き枠も出せなくなっていた
 * （実装不足の洗い出し settings-07）。
 *
 * **その日にすでに行があれば触らない。**日付ごとの手直し（臨時の早上がりなど）を
 * Cron が毎晩塗り潰すと、直した本人の知らないうちに元へ戻る。
 * 1 回で足すのは先端の 1 日だけでよい —— 毎晩動くので窓は 1 日ずつ前へ出る。
 */
export async function expandShiftWindow(
  db: D1Database,
  now: Date,
): Promise<{ inserted: number; date: string }> {
  const date = addJstDays(toJstDateString(now), SHIFT_WINDOW_DAYS - 1)
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  const template = await db
    .prepare(
      'SELECT w.organization_id AS org, w.store_id AS storeId, w.staff_id AS staffId, ' +
        'w.starts_at AS startsAt, w.ends_at AS endsAt, w.break_start AS breakStart, w.break_end AS breakEnd ' +
        "FROM staff_weekly_shifts w WHERE w.weekday = ? AND w.is_off = '0' " +
        'AND w.starts_at IS NOT NULL AND w.ends_at IS NOT NULL AND w.effective_from <= ? ' +
        'AND NOT EXISTS (SELECT 1 FROM staff_shifts s WHERE s.organization_id = w.organization_id ' +
        'AND s.staff_id = w.staff_id AND s.date = ?)',
    )
    .bind(weekday, date, date)
    .all<{
      org: string
      storeId: string
      staffId: string
      startsAt: string
      endsAt: string
      breakStart: string | null
      breakEnd: string | null
    }>()

  const nowIso = now.toISOString()
  const insert =
    'INSERT INTO staff_shifts (id, organization_id, store_id, staff_id, date, starts_at, ends_at, kind, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  const writes: Statement[] = []
  for (const row of template.results) {
    writes.push(
      db
        .prepare(insert)
        .bind(
          crypto.randomUUID(),
          row.org,
          row.storeId,
          row.staffId,
          date,
          row.startsAt,
          row.endsAt,
          'work',
          nowIso,
        ),
    )
    if (row.breakStart !== null && row.breakEnd !== null) {
      writes.push(
        db
          .prepare(insert)
          .bind(
            crypto.randomUUID(),
            row.org,
            row.storeId,
            row.staffId,
            date,
            row.breakStart,
            row.breakEnd,
            'break',
            nowIso,
          ),
      )
    }
  }
  if (writes.length > 0) await db.batch(writes)
  return { inserted: writes.length, date }
}

export async function purgeAuditAndSessions(db: D1Database, now: Date): Promise<void> {
  const auditBefore = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString()
  const sessionsBefore = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  await db.batch([
    db.prepare('DELETE FROM audit_events WHERE occurred_at < ?').bind(auditBefore),
    db.prepare('DELETE FROM terminal_sessions WHERE expires_at < ?').bind(sessionsBefore),
  ])
}

export async function runScheduledMaintenance(
  now: Date,
  tasks: ScheduledMaintenanceTasks,
): Promise<void> {
  try {
    await tasks.applyWebPublications(now)
  } catch (err) {
    console.error('scheduled web publications apply failed', err)
  }
  try {
    const today = toJstDateString(now)
    // 各店舗のclosed最終確定日の翌日から、最大31日ずつ追いつく。遅延が残るページは
    // 同じcursorを保持し、追いついた店舗だけ通常の昨日〜7日先へ戻る。
    const from = addJstDays(today, -1)
    const to = addJstDays(today, 7)
    const completedThrough = addJstDays(today, -1)
    const storeCursor = await tasks.readRollupCursor()
    const result = await tasks.rollupAnalytics({
      from,
      to,
      limit: 3,
      storeCursor,
      now,
      completedThrough,
    })
    if (result.failedStores.length > 0 || result.dropped > 0)
      console.error('scheduled analytics rollup completed with anomalies', {
        failedStores: result.failedStores,
        dropped: result.dropped,
      })
    await tasks.writeRollupCursor(result.nextStoreCursor)
  } catch (err) {
    console.error('scheduled analytics rollup failed', err)
  }
  try {
    await tasks.purgeRecordings(now)
  } catch (err) {
    console.error('scheduled recordings purge failed', err)
  }
  try {
    await tasks.purgeAuditAndSessions?.(now)
  } catch (err) {
    console.error('scheduled audit and terminal session purge failed', err)
  }
  try {
    await tasks.expandShiftWindow?.(now)
  } catch (err) {
    console.error('scheduled staff shift expansion failed', err)
  }
}

async function scheduled(controller: ScheduledController, env: Bindings): Promise<void> {
  // Cloudflare が配った scheduledTime を唯一の時計にする（JST 00:00 の境界を再取得しない）。
  const now = new Date(controller.scheduledTime)
  await runScheduledMaintenance(now, {
    applyWebPublications: (clock) => applyWebPublications(env, { now: clock, limit: 100 }),
    readRollupCursor: async () =>
      (await env.SHORT_LIVED.get('analytics:rollup:store-cursor')) ?? undefined,
    rollupAnalytics: (input) => rollupAnalytics(env, input),
    writeRollupCursor: (cursor) =>
      cursor === null
        ? env.SHORT_LIVED.delete('analytics:rollup:store-cursor')
        : env.SHORT_LIVED.put('analytics:rollup:store-cursor', cursor, {
            expirationTtl: 172_800,
          }),
    purgeRecordings: (clock) => purgeRecordings(env, { now: clock, limit: 100 }),
    purgeAuditAndSessions: (clock) => purgeAuditAndSessions(env.DB, clock),
    expandShiftWindow: (clock) => expandShiftWindow(env.DB, clock),
  })
}

export default { fetch: app.fetch, scheduled }
