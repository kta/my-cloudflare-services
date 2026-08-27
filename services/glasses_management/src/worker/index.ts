import {
  type AlertCode,
  AlertCondition,
  AlertEvaluationResult,
  AlertListQuery,
  AlertRecord,
  AlertResolveInput,
  AlertSettings,
  AlertSettingsInput,
  type AnalyticsBreakdown,
  type AnalyticsCauseCandidate,
  type AnalyticsExclusion,
  type AnalyticsFunnel,
  AnalyticsFunnelEventInput,
  AnalyticsFunnelEventResult,
  type AnalyticsMetricValue,
  type AnalyticsPeriod,
  type AnalyticsQualityWarning,
  AnalyticsQuery,
  AnalyticsReport,
  AnalyticsSettings,
  AnalyticsSettingsInput,
  type AnalyticsStage,
  AnalyticsTarget,
  type AttentionCapability,
  AttentionHideInput,
  AttentionNoteInput,
  AttentionNoteRecord,
  AttentionNoteRevisionInput,
  AttentionReviewInput,
  type AttentionSettings,
  AttentionSettingsInput,
  type AttentionSharingScope,
  AttentionSharingScopeImpact,
  AttentionSharingScopeImpactRequest,
  AttentionVersionConflict,
  AuditEventView,
  AuditSearchQuery,
  AvailabilityBusinessHours,
  AvailabilityEquipment,
  AvailabilityException,
  AvailabilityMaintenance,
  AvailabilityPurpose,
  AvailabilitySettingsInput,
  type AvailabilitySlot,
  AvailabilitySlotsQuery,
  AvailabilitySlotsResponse,
  AvailabilityStaff,
  AvailabilityStaffShift,
  AvailabilityStoreSettings,
  CustomerCandidate,
  CustomerDetail,
  CustomerLinkReleaseInput,
  CustomerLinkReleaseResult,
  type CustomerMergeImpact,
  CustomerMergeInput,
  CustomerMergePreview,
  CustomerMergePreviewRequest,
  CustomerMergeResult,
  CustomerSearchQuery,
  LedgerEntry,
  LedgerQuery,
  LoginRequest,
  LoginResponse,
  ManagementCodeReissueResult,
  NotificationJob,
  NotificationResult,
  OrganizationSync,
  PinVerificationResponse,
  PublicAvailabilityResponse,
  PublicBookingCreate,
  PublicBookingResult,
  PublicOffersQuery,
  PublicOffersResponse,
  PublicReservationCancel,
  PublicReservationChange,
  PublicReservationChangeResult,
  PublicReservationMutationResult,
  PublicReservationStatus,
  PublicReservationStatusQuery,
  PublicReservationVerification,
  PublicReservationVerificationResult,
  PublicStoreDetail,
  PublicStorePurpose,
  PublicStoreSearchQuery,
  PublicStoreSummary,
  ReceptionHistoryEntry,
  ReceptionHistoryQuery,
  Recording,
  RecordingHoldInput,
  RecordingHoldRelease,
  RecordingListQuery,
  RecordingMetadataCreate,
  RecordingReconciliationMismatch,
  RecordingReconciliationReport,
  RecordingReconciliationRequest,
  RecordingReservationLink,
  RecordingRetentionSettings,
  RecordingRetentionSettingsInput,
  type RecordingState,
  RefreshResponse,
  Reservation,
  ReservationCancelInput,
  ReservationChangeHistoryEntry,
  ReservationChangeInput,
  ReservationNoShowInput,
  ReservationProgressPatch,
  ReservationSearchQuery,
  SettingsChainDefault,
  SettingsConflictResolution,
  SettingsConflictResolutionInput,
  SettingsConflictResolutionKind,
  SettingsDraft,
  SettingsDraftInput,
  type SettingsImpactReport,
  SettingsOrigin,
  SettingsOverrideRelease,
  SettingsOverrideView,
  SettingsPublication,
  SettingsPublicationPatch,
  SettingsPublicationRequest,
  SettingsVersionDetail,
  SettingsVersionSummary,
  SharedTerminal,
  SharedTerminalCreateInput,
  SharedTerminalIssue,
  SharedTerminalReauthenticationInput,
  SharedTerminalReauthenticationIssue,
  StaffReservationCreate,
  Store,
  StoreMembership,
  StorePatch,
  StorePermission,
  type StorePermission as StorePermissionValue,
  StoreSwitchInput,
  VersionConflict,
  Walkin,
  WalkinCreate,
  WalkinCustomerPatch,
  WalkinListQuery,
  WalkinProgressPatch,
} from '@app/contracts'
import {
  type AuthVariables,
  internalAuth,
  type OrgResolver,
  REFRESH_TTL_SECONDS,
  requireActiveOrg,
  tenantAuth,
  toJstDateString,
} from '@app/shared'
import type { D1Database, Fetcher, KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import { zValidator } from '@hono/zod-validator'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  like,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { type Context, Hono } from 'hono'
import { except } from 'hono/combine'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import {
  authorizedStore,
  listAccessibleStores,
  requireStorePermission,
  type StoreContext,
} from './auth'
import {
  alertSettings,
  analyticsSettings,
  attentionSettings,
  auditEvents,
  availabilityBookings,
  availabilityBusinessHours,
  availabilityEquipment,
  availabilityExceptions,
  availabilityMaintenances,
  availabilitySettings,
  availabilityStaff,
  availabilityStaffShifts,
  customerAttentionNotes,
  customerNotes,
  customerOwnedGlasses,
  customerPrescriptions,
  customers,
  idempotencyRecords,
  operationalAlerts,
  organizations,
  recordingRetentionSettings,
  recordings,
  reservationChanges,
  reservationProgressEvents,
  reservationResourceAllocations,
  reservations,
  settingsChainDefaults,
  settingsDraftConflictResolutions,
  settingsDrafts,
  settingsPublications,
  settingsPublicationTargets,
  settingsVersions,
  sharedTerminalReauthSessions,
  sharedTerminals,
  storeMemberships,
  stores,
  visitPurposes,
  walkinDailySequences,
  walkinEvents,
  walkins,
  webBookingFunnelEvents,
  webBookingManagementCodeIssues,
  webBookingNotificationAttempts,
  webBookingPublications,
  webBookingRecords,
  webBookingVerifiedSessions,
} from './db/schema'
import {
  type AlertDescriptor,
  DEFAULT_ALERT_CONDITIONS,
  longWaitAlerts,
  recordingFailureAlerts,
  settingsContradictionAlerts,
} from './domain/alerts'
import {
  applySmallSampleSuppression,
  jstPeriod,
  previousJstPeriod,
  stageDistribution,
} from './domain/analytics'
import {
  ATTENTION_ORGANIZATION_SCOPE,
  attentionRoleFor,
  mayUseAttentionCapability,
  noteDifferences,
  resolveAttentionSettings,
  serializeAttentionCapabilities,
} from './domain/attention'
import { AuditAppendError, writeAuditBatch } from './domain/audit'
import {
  type AvailabilityBooking,
  type AvailabilityResult,
  calculateAvailability,
  selectAvailabilityAllocation,
} from './domain/availability'
import { type Clock, jstDateKey, nowIso, systemClock } from './domain/clock'
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  RetryableIdempotencyError,
  withIdempotency,
} from './domain/idempotency'
import { ledgerWarnings } from './domain/ledger-warnings'
import {
  issueVerifiedReservationSessionToken,
  MANAGEMENT_CODE_MAX_FAILED_ATTEMPTS,
  managementCodeAccessError,
  reservationModificationAccessError,
  VERIFIED_RESERVATION_SESSION_TTL_MS,
  verifiedReservationSessionAccessError,
} from './domain/management-code'
import { distanceKilometers } from './domain/public-location'
import { isOfferableSlot, upcomingJstDates } from './domain/public-offers'
import { publicationUnavailableReason } from './domain/publication'
import {
  assertRecordingTransition,
  MINIMUM_CONFIRMED_RETENTION_DAYS,
  MINIMUM_DISCARDED_RETENTION_HOURS,
  minimumRetentionDeadline,
  RecordingTransitionError,
  recordingKeySecret,
  recordingStorageKey,
  retentionDeadline,
  retentionIsActive,
} from './domain/recording'
import {
  changedSettingsFields,
  deriveStoreScopedSettings,
  evaluateSettingsImpact,
  instantToJstDateTime,
  isPublicationDue,
  jstDateTimeToInstant,
  settingsDiff,
} from './domain/settings-publication'
import {
  hashSharedTerminalToken,
  issueSharedTerminalToken,
  sharedTerminalAccessError,
  sharedTerminalReauthAccessError,
} from './domain/shared-terminal'
import { assertVersion, nextVersion, VersionConflictError } from './domain/version'
import { isCustomerPhoneConflict } from './domain/walkin'
import {
  hashConfirmationKey,
  hashManagementCode,
  hashVerifiedReservationSessionToken,
  issueManagementCode,
} from './domain/web-booking'

/** Runtime bindings owned by the glasses-management Worker. */
export type Bindings = {
  DB: D1Database
  RECORDINGS: R2Bucket
  SHORT_LIVED: KVNamespace
  NOTIFIER: Fetcher
  ADMIN: Fetcher
  ADMIN_DOMAIN_AUTH_KEY: string
  // Internal service-binding requests fail closed when this secret is absent.
  INTERNAL_KEY: string
  // Must match admin's access-token signing secret.
  JWT_SECRET: string
  /** Test-only fixed instant; production never configures this binding. */
  TEST_CLOCK_NOW?: string
}

type AppVariables = AuthVariables & {
  sharedTerminal?: { id: string; organizationId: string; storeId: string }
  personalReauthUserId?: string
}
type AppContext = Context<{ Bindings: Bindings; Variables: AppVariables }>
type PublicVerifiedSessionAccess =
  | { error: Response }
  | { db: ReturnType<typeof drizzle>; session: typeof webBookingVerifiedSessions.$inferSelect }

const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>()

/*
 * The one clock every handler must use. Reading the wall clock directly makes
 * JST day boundaries — which decide the ledger day, the reception-history day
 * and every expiry deadline — untestable and silently machine-dependent.
 */
function requestClock(c: AppContext): Clock {
  const fixed = c.env.TEST_CLOCK_NOW
  if (fixed === undefined) return systemClock()
  const instant = new Date(fixed)
  if (Number.isNaN(instant.getTime())) throw new Error('TEST_CLOCK_NOW must be an ISO instant')
  return { now: () => new Date(instant.getTime()) }
}

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse()
  console.error('unhandled', error)
  return c.json({ error: 'internal_error' }, 500)
})

const orgResolver: OrgResolver = async (organizationId, c) => {
  const db = drizzle(c.env.DB)
  const rows = await db
    .select({ plan: organizations.plan, isDisabled: organizations.isDisabled })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
  const row = rows[0]
  if (!row || (row.plan !== 'free' && row.plan !== 'contracted')) return null
  if (row.isDisabled !== '0' && row.isDisabled !== '1') return null
  return { plan: row.plan, isDisabled: row.isDisabled === '1' }
}

// Internal routes are protected independently from tenant JWTs. The global
// default-deny gate below deliberately excludes this namespace so the shared
// key remains the only trust boundary for admin → domain synchronization.
app.use('/api/internal/*', internalAuth())
app.use(
  '/api/*',
  except(
    ['/api/health', '/api/auth/*', '/api/internal/*', '/api/public/*', '/api/shared-terminals/*'],
    tenantAuth(),
    requireActiveOrg(orgResolver),
  ),
)

const DOMAIN_REFRESH_COOKIE = 'eyex_rt'

function setDomainRefreshCookie(c: AppContext, refreshToken: string) {
  setCookie(c, DOMAIN_REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: REFRESH_TTL_SECONDS,
  })
}

async function domainAuthRequest(c: AppContext, path: string, body: unknown): Promise<Response> {
  try {
    return await c.env.ADMIN.fetch(`https://admin.internal${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-key': c.env.INTERNAL_KEY,
        'x-forwarded-for':
          c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown',
      },
      body: JSON.stringify(body),
    })
  } catch {
    return c.json({ error: 'auth_unavailable' }, 502)
  }
}

async function domainLogin(c: AppContext, input: LoginRequest): Promise<Response> {
  const response = await domainAuthRequest(c, '/api/internal/domain-auth/login', input)
  if (!response.ok) return new Response(response.body, response)
  const parsed = LoginResponse.safeParse(await response.json())
  if (!parsed.success) return c.json({ error: 'auth_unavailable' }, 502)
  setDomainRefreshCookie(c, parsed.data.refreshToken)
  const { refreshToken: _refreshToken, ...body } = parsed.data
  return c.json(body)
}

async function domainRefresh(c: AppContext): Promise<Response> {
  const refreshToken = getCookie(c, DOMAIN_REFRESH_COOKIE)
  if (!refreshToken) return c.json({ error: 'no_session' }, 401)
  const response = await domainAuthRequest(c, '/api/internal/domain-auth/refresh', { refreshToken })
  if (!response.ok) {
    if (response.status === 401) deleteCookie(c, DOMAIN_REFRESH_COOKIE, { path: '/' })
    return new Response(response.body, response)
  }
  const parsed = RefreshResponse.safeParse(await response.json())
  if (!parsed.success) return c.json({ error: 'auth_unavailable' }, 502)
  setDomainRefreshCookie(c, parsed.data.refreshToken)
  return c.json({ token: parsed.data.token })
}

function publicPublicationWindow(now: string) {
  return [
    eq(webBookingPublications.status, 'published'),
    or(isNull(webBookingPublications.startsAt), lte(webBookingPublications.startsAt, now)),
    or(isNull(webBookingPublications.endsAt), gt(webBookingPublications.endsAt, now)),
  ]
}

async function listPublicStores(
  c: AppContext,
  query: { q?: string; region?: string; station?: string; latitude?: number; longitude?: number },
) {
  const db = drizzle(c.env.DB)
  const conditions = [
    eq(stores.isActive, '1'),
    eq(organizations.isDisabled, '0'),
    or(
      isNull(availabilitySettings.receptionStatus),
      eq(availabilitySettings.receptionStatus, 'open'),
    ),
    ...publicPublicationWindow(nowIso(requestClock(c))),
  ]
  if (query.q) {
    const pattern = `%${query.q}%`
    conditions.push(
      or(like(stores.name, pattern), like(webBookingPublications.accessText, pattern))!,
    )
  }
  if (query.region) conditions.push(eq(webBookingPublications.region, query.region))
  if (query.station) conditions.push(eq(webBookingPublications.nearestStation, query.station))
  const rows = await db
    .select({
      slug: webBookingPublications.publicSlug,
      name: stores.name,
      contactPhone: webBookingPublications.contactPhone,
      region: webBookingPublications.region,
      nearestStation: webBookingPublications.nearestStation,
      accessText: webBookingPublications.accessText,
      organizationId: stores.organizationId,
      storeId: stores.id,
      latitude: webBookingPublications.latitude,
      longitude: webBookingPublications.longitude,
    })
    .from(stores)
    .innerJoin(organizations, eq(organizations.id, stores.organizationId))
    .leftJoin(
      availabilitySettings,
      and(
        eq(availabilitySettings.organizationId, stores.organizationId),
        eq(availabilitySettings.storeId, stores.id),
      ),
    )
    .innerJoin(
      webBookingPublications,
      and(
        eq(webBookingPublications.organizationId, stores.organizationId),
        eq(webBookingPublications.storeId, stores.id),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(stores.name))
  const customerLocation =
    query.latitude === undefined || query.longitude === undefined
      ? undefined
      : { latitude: query.latitude, longitude: query.longitude }
  const ordered =
    customerLocation === undefined
      ? rows
      : [...rows].sort((left, right) => {
          const leftLatitude = left.latitude === null ? Number.NaN : Number(left.latitude)
          const leftLongitude = left.longitude === null ? Number.NaN : Number(left.longitude)
          const rightLatitude = right.latitude === null ? Number.NaN : Number(right.latitude)
          const rightLongitude = right.longitude === null ? Number.NaN : Number(right.longitude)
          const leftDistance =
            Number.isFinite(leftLatitude) && Number.isFinite(leftLongitude)
              ? distanceKilometers(customerLocation, {
                  latitude: leftLatitude,
                  longitude: leftLongitude,
                })
              : Number.POSITIVE_INFINITY
          const rightDistance =
            Number.isFinite(rightLatitude) && Number.isFinite(rightLongitude)
              ? distanceKilometers(customerLocation, {
                  latitude: rightLatitude,
                  longitude: rightLongitude,
                })
              : Number.POSITIVE_INFINITY
          return leftDistance - rightDistance
        })
  /*
   * 承認済みモックの検索カードは「本日営業 10:00–19:00」を詳細を開く前に出す。
   * 曜日は JST で決まるので、Worker が動く UTC の曜日ではなく JST の曜日で引く。
   * 例外日（臨時休業・特別営業）は 1 日ぶんの空き計算にしか効かないため、カードは
   * 定常の営業時間だけを名乗る。空きの有無は次の工程が答える。
   */
  const todayHours = await readTodayBusinessHours(
    db,
    ordered.map((store) => ({ organizationId: store.organizationId, storeId: store.storeId })),
    requestClock(c),
  )
  return PublicStoreSummary.array().parse(
    ordered.map(
      ({ latitude: _latitude, longitude: _longitude, organizationId, storeId, ...store }) => ({
        ...store,
        todayBusinessHours: todayHours.get(`${organizationId}:${storeId}`) ?? null,
      }),
    ),
  )
}

/** 営業時間の表示（"10:00–19:00"）。複数区間は中黒でつなぐ。区間なしは null。 */
function businessHoursText(periodsJson: unknown): string | null {
  if (!Array.isArray(periodsJson)) return null
  const ranges = periodsJson
    .map((period) =>
      typeof period === 'object' &&
      period !== null &&
      'startTime' in period &&
      'endTime' in period &&
      typeof period.startTime === 'string' &&
      typeof period.endTime === 'string'
        ? `${period.startTime}\u2013${period.endTime}`
        : undefined,
    )
    .filter((range): range is string => range !== undefined)
  return ranges.length === 0 ? null : ranges.join(' / ')
}

async function readTodayBusinessHours(
  db: ReturnType<typeof drizzle>,
  scopes: readonly { organizationId: string; storeId: string }[],
  clock: Clock,
): Promise<Map<string, string>> {
  if (scopes.length === 0) return new Map()
  const dayOfWeek = new Date(`${jstDateKey(clock)}T00:00:00.000Z`).getUTCDay()
  const rows = await db
    .select({
      organizationId: availabilityBusinessHours.organizationId,
      storeId: availabilityBusinessHours.storeId,
      periodsJson: availabilityBusinessHours.periodsJson,
    })
    .from(availabilityBusinessHours)
    .where(
      and(
        eq(availabilityBusinessHours.dayOfWeek, dayOfWeek),
        inArray(
          availabilityBusinessHours.storeId,
          scopes.map((scope) => scope.storeId),
        ),
      ),
    )
  const allowed = new Set(scopes.map((scope) => `${scope.organizationId}:${scope.storeId}`))
  const byStore = new Map<string, string>()
  for (const row of rows) {
    const key = `${row.organizationId}:${row.storeId}`
    // storeId で絞ったうえで organization も突き合わせる。テナント跨ぎの id 衝突を
    // 表示だけとはいえ通すと、他テナントの営業時間が公開面に出る。
    if (!allowed.has(key)) continue
    const text = businessHoursText(parseJson(row.periodsJson, 'public business hours'))
    if (text !== null) byStore.set(key, text)
  }
  return byStore
}

async function readPublicStore(c: AppContext, slug: string) {
  const db = drizzle(c.env.DB)
  const rows = await db
    .select({
      organizationId: stores.organizationId,
      storeId: stores.id,
      slug: webBookingPublications.publicSlug,
      name: stores.name,
      isActive: stores.isActive,
      isOrganizationDisabled: organizations.isDisabled,
      receptionStatus: availabilitySettings.receptionStatus,
      status: webBookingPublications.status,
      startsAt: webBookingPublications.startsAt,
      endsAt: webBookingPublications.endsAt,
      contactPhone: webBookingPublications.contactPhone,
      accessText: webBookingPublications.accessText,
      notice: webBookingPublications.notice,
      region: webBookingPublications.region,
      nearestStation: webBookingPublications.nearestStation,
      publicPurposeIdsJson: webBookingPublications.publicPurposeIdsJson,
      publicPurposesJson: webBookingPublications.publicPurposesJson,
      publicServicesJson: webBookingPublications.publicServicesJson,
    })
    .from(stores)
    .innerJoin(organizations, eq(organizations.id, stores.organizationId))
    .leftJoin(
      availabilitySettings,
      and(
        eq(availabilitySettings.organizationId, stores.organizationId),
        eq(availabilitySettings.storeId, stores.id),
      ),
    )
    .innerJoin(
      webBookingPublications,
      and(
        eq(webBookingPublications.organizationId, stores.organizationId),
        eq(webBookingPublications.storeId, stores.id),
      ),
    )
    .where(eq(webBookingPublications.publicSlug, slug))
  const store = rows[0]
  if (!store) return c.json({ error: 'public_store_not_found' }, 404)
  const reason = publicationUnavailableReason(
    {
      isActive: store.isActive === '1',
      isOrganizationDisabled: store.isOrganizationDisabled === '1',
      receptionStatus:
        store.receptionStatus === 'paused'
          ? 'paused'
          : store.receptionStatus === 'open'
            ? 'open'
            : undefined,
      status: store.status === 'published' ? 'published' : 'hidden',
      startsAt: store.startsAt,
      endsAt: store.endsAt,
    },
    requestClock(c).now(),
  )
  if (reason)
    return c.json(
      { error: 'public_store_unavailable', reason, contactPhone: store.contactPhone },
      409,
    )
  const publishedPurposeIds = parseJson(store.publicPurposeIdsJson, 'public purpose ids')
  if (
    !Array.isArray(publishedPurposeIds) ||
    !publishedPurposeIds.every((id): id is string => typeof id === 'string')
  ) {
    throw new Error('invalid public purpose ids')
  }
  const publicPurposes =
    store.publicPurposesJson === null
      ? (
          await db
            .select({
              id: visitPurposes.id,
              label: visitPurposes.customerLabel,
              durationMinutes: visitPurposes.durationMinutes,
            })
            .from(visitPurposes)
            .where(
              and(
                eq(visitPurposes.organizationId, store.organizationId),
                eq(visitPurposes.storeId, store.storeId),
              ),
            )
            .orderBy(asc(visitPurposes.customerLabel))
        ).filter((purpose) => publishedPurposeIds.includes(purpose.id))
      : PublicStorePurpose.array().parse(
          parseJson(store.publicPurposesJson, 'public purpose snapshot'),
        )
  const parsedServices =
    store.publicServicesJson === null ? [] : parseJson(store.publicServicesJson, 'public services')
  if (!Array.isArray(parsedServices) || !parsedServices.every((s) => typeof s === 'string')) {
    throw new Error('invalid public services')
  }
  const publicServices: string[] = parsedServices
  const businessHours = await db
    .select({
      dayOfWeek: availabilityBusinessHours.dayOfWeek,
      periodsJson: availabilityBusinessHours.periodsJson,
    })
    .from(availabilityBusinessHours)
    .where(
      and(
        eq(availabilityBusinessHours.organizationId, store.organizationId),
        eq(availabilityBusinessHours.storeId, store.storeId),
      ),
    )
    .orderBy(asc(availabilityBusinessHours.dayOfWeek))
  /*
   * 詳細も一覧と同じ「本日営業」を名乗る。PublicStoreDetail は PublicStoreSummary を
   * 拡張しているので、ここで埋めないと既定の null が常に返り、週次の営業時間は
   * あるのに本日だけ休みに見える。曜日は UTC ではなく JST で引く。
   */
  const todayDayOfWeek = new Date(`${jstDateKey(requestClock(c))}T00:00:00.000Z`).getUTCDay()
  const todayRow = businessHours.find((hour) => hour.dayOfWeek === todayDayOfWeek)
  const todayBusinessHours =
    todayRow === undefined
      ? null
      : businessHoursText(parseJson(todayRow.periodsJson, 'public business hours'))
  return c.json(
    PublicStoreDetail.parse({
      slug: store.slug,
      todayBusinessHours,
      name: store.name,
      contactPhone: store.contactPhone,
      accessText: store.accessText,
      notice: store.notice,
      region: store.region,
      nearestStation: store.nearestStation,
      businessHours: businessHours.map((hour) => ({
        dayOfWeek: hour.dayOfWeek,
        periods: parseJson(hour.periodsJson, 'public business hours'),
      })),
      purposes: publicPurposes,
      /*
       * 対応サービスは来店目的とは別軸。公開時に文言として保存されたものだけを出し、
       * 未設定なら空にする（来店目的で代用すると、予約できる枠の名前が説明文に化ける）。
       */
      services: publicServices,
    }),
  )
}

async function readPublicAvailability(
  c: AppContext,
  slug: string,
  query: { date: string; purposeIds: string[] },
) {
  const db = drizzle(c.env.DB)
  const rows = await db
    .select({
      organizationId: stores.organizationId,
      storeId: stores.id,
      name: stores.name,
      isActive: stores.isActive,
      isOrganizationDisabled: organizations.isDisabled,
      receptionStatus: availabilitySettings.receptionStatus,
      status: webBookingPublications.status,
      startsAt: webBookingPublications.startsAt,
      endsAt: webBookingPublications.endsAt,
      contactPhone: webBookingPublications.contactPhone,
      publicPurposeIdsJson: webBookingPublications.publicPurposeIdsJson,
    })
    .from(stores)
    .innerJoin(organizations, eq(organizations.id, stores.organizationId))
    .leftJoin(
      availabilitySettings,
      and(
        eq(availabilitySettings.organizationId, stores.organizationId),
        eq(availabilitySettings.storeId, stores.id),
      ),
    )
    .innerJoin(
      webBookingPublications,
      and(
        eq(webBookingPublications.organizationId, stores.organizationId),
        eq(webBookingPublications.storeId, stores.id),
      ),
    )
    .where(eq(webBookingPublications.publicSlug, slug))
  const store = rows[0]
  if (!store) return c.json({ error: 'public_store_not_found' }, 404)
  const reason = publicationUnavailableReason(
    {
      isActive: store.isActive === '1',
      isOrganizationDisabled: store.isOrganizationDisabled === '1',
      receptionStatus:
        store.receptionStatus === 'paused'
          ? 'paused'
          : store.receptionStatus === 'open'
            ? 'open'
            : undefined,
      status: store.status === 'published' ? 'published' : 'hidden',
      startsAt: store.startsAt,
      endsAt: store.endsAt,
    },
    requestClock(c).now(),
  )
  if (reason)
    return c.json(
      { error: 'public_store_unavailable', reason, contactPhone: store.contactPhone },
      409,
    )
  const publishedPurposeIds = parseJson(store.publicPurposeIdsJson, 'public purpose ids')
  if (
    !Array.isArray(publishedPurposeIds) ||
    !publishedPurposeIds.every((id): id is string => typeof id === 'string') ||
    !query.purposeIds.every((id) => publishedPurposeIds.includes(id))
  ) {
    return c.json({ error: 'invalid_public_purpose_selection' }, 400)
  }
  const settings = await readAvailabilitySettings(db, store.organizationId, store.storeId)
  const input = {
    date: query.date,
    store: {
      receptionStatus: settings.receptionStatus,
      businessHours: settings.businessHours,
      exceptions: settings.exceptions,
    },
    purposes: settings.purposes,
    staff: settings.staff,
    shifts: settings.shifts,
    equipment: settings.equipment,
    maintenance: settings.maintenance,
    bookings: await readAvailabilityBookings(db, store.organizationId, store.storeId),
  }
  try {
    const result = calculateAvailability(input, query.purposeIds)
    return c.json(PublicAvailabilityResponse.parse(result))
  } catch (error) {
    if (error instanceof RangeError)
      return c.json({ error: 'invalid_public_purpose_selection' }, 400)
    throw error
  }
}

/*
 * 顧客Web予約の候補枠（オファー）。
 *
 * なぜ /slots と別関数なのか: /slots は「この日の空き」を答えるが、承認済みモックの
 * 第 2 工程は日付を訊かずに既製のショートリストを並べる。日付は入力ではなく走査の
 * 結果なので、JST の今日から days 日ぶんを順に空き計算し、先に埋まった順で limit 件
 * だけ採る。開始済みの枠は押せても必ず失敗するので isOfferableSlot で落とす。
 */
async function readPublicOffers(c: AppContext, slug: string, query: PublicOffersQuery) {
  const db = drizzle(c.env.DB)
  const rows = await db
    .select({
      organizationId: stores.organizationId,
      storeId: stores.id,
      isActive: stores.isActive,
      isOrganizationDisabled: organizations.isDisabled,
      receptionStatus: availabilitySettings.receptionStatus,
      status: webBookingPublications.status,
      startsAt: webBookingPublications.startsAt,
      endsAt: webBookingPublications.endsAt,
      contactPhone: webBookingPublications.contactPhone,
      publicPurposeIdsJson: webBookingPublications.publicPurposeIdsJson,
    })
    .from(stores)
    .innerJoin(organizations, eq(organizations.id, stores.organizationId))
    .leftJoin(
      availabilitySettings,
      and(
        eq(availabilitySettings.organizationId, stores.organizationId),
        eq(availabilitySettings.storeId, stores.id),
      ),
    )
    .innerJoin(
      webBookingPublications,
      and(
        eq(webBookingPublications.organizationId, stores.organizationId),
        eq(webBookingPublications.storeId, stores.id),
      ),
    )
    .where(eq(webBookingPublications.publicSlug, slug))
  const store = rows[0]
  if (!store) return c.json({ error: 'public_store_not_found' }, 404)
  const clock = requestClock(c)
  const reason = publicationUnavailableReason(
    {
      isActive: store.isActive === '1',
      isOrganizationDisabled: store.isOrganizationDisabled === '1',
      receptionStatus:
        store.receptionStatus === 'paused'
          ? 'paused'
          : store.receptionStatus === 'open'
            ? 'open'
            : undefined,
      status: store.status === 'published' ? 'published' : 'hidden',
      startsAt: store.startsAt,
      endsAt: store.endsAt,
    },
    clock.now(),
  )
  if (reason)
    return c.json(
      { error: 'public_store_unavailable', reason, contactPhone: store.contactPhone },
      409,
    )
  const publishedPurposeIds = parseJson(store.publicPurposeIdsJson, 'public purpose ids')
  if (
    !Array.isArray(publishedPurposeIds) ||
    !publishedPurposeIds.every((id): id is string => typeof id === 'string') ||
    !query.purposeIds.every((id) => publishedPurposeIds.includes(id))
  ) {
    return c.json({ error: 'invalid_public_purpose_selection' }, 400)
  }
  const settings = await readAvailabilitySettings(db, store.organizationId, store.storeId)
  const bookings = await readAvailabilityBookings(db, store.organizationId, store.storeId)
  const now = clock.now()
  const slots: AvailabilitySlot[] = []
  let durationMinutes = 0
  for (const date of upcomingJstDates(jstDateKey(clock), query.days)) {
    if (slots.length >= query.limit) break
    let result: ReturnType<typeof calculateAvailability>
    try {
      result = calculateAvailability(
        {
          date,
          store: {
            receptionStatus: settings.receptionStatus,
            businessHours: settings.businessHours,
            exceptions: settings.exceptions,
          },
          purposes: settings.purposes,
          staff: settings.staff,
          shifts: settings.shifts,
          equipment: settings.equipment,
          maintenance: settings.maintenance,
          bookings,
        },
        query.purposeIds,
      )
    } catch (error) {
      if (error instanceof RangeError)
        return c.json({ error: 'invalid_public_purpose_selection' }, 400)
      throw error
    }
    // 所要時間は目的の設定で決まるので日付によらず同じ。最後に計算した日の値でよい。
    durationMinutes = result.durationMinutes
    for (const slot of result.slots) {
      if (!isOfferableSlot(slot, now)) continue
      slots.push(slot)
      if (slots.length >= query.limit) break
    }
  }
  return c.json(PublicOffersResponse.parse({ timezone: 'Asia/Tokyo', durationMinutes, slots }))
}

async function createPublicReservation(
  c: AppContext,
  slug: string,
  input: PublicBookingCreate,
): Promise<Response> {
  const idempotencyKey = c.req.header('idempotency-key')?.trim()
  if (!idempotencyKey || idempotencyKey.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400)
  const normalizedCustomerPhone = normalizePhone(input.customer.phone)
  if (normalizedCustomerPhone.length < 7) return c.json({ error: 'invalid_customer_phone' }, 400)
  const db = drizzle(c.env.DB)
  const rows = await db
    .select({
      organizationId: stores.organizationId,
      storeId: stores.id,
      name: stores.name,
      isActive: stores.isActive,
      isOrganizationDisabled: organizations.isDisabled,
      receptionStatus: availabilitySettings.receptionStatus,
      status: webBookingPublications.status,
      startsAt: webBookingPublications.startsAt,
      endsAt: webBookingPublications.endsAt,
      contactPhone: webBookingPublications.contactPhone,
      publicPurposeIdsJson: webBookingPublications.publicPurposeIdsJson,
    })
    .from(stores)
    .innerJoin(organizations, eq(organizations.id, stores.organizationId))
    .leftJoin(
      availabilitySettings,
      and(
        eq(availabilitySettings.organizationId, stores.organizationId),
        eq(availabilitySettings.storeId, stores.id),
      ),
    )
    .innerJoin(
      webBookingPublications,
      and(
        eq(webBookingPublications.organizationId, stores.organizationId),
        eq(webBookingPublications.storeId, stores.id),
      ),
    )
    .where(eq(webBookingPublications.publicSlug, slug))
  const store = rows[0]
  if (!store) return c.json({ error: 'public_store_not_found' }, 404)
  const reason = publicationUnavailableReason(
    {
      isActive: store.isActive === '1',
      isOrganizationDisabled: store.isOrganizationDisabled === '1',
      receptionStatus:
        store.receptionStatus === 'paused'
          ? 'paused'
          : store.receptionStatus === 'open'
            ? 'open'
            : undefined,
      status: store.status === 'published' ? 'published' : 'hidden',
      startsAt: store.startsAt,
      endsAt: store.endsAt,
    },
    requestClock(c).now(),
  )
  if (reason)
    return c.json(
      { error: 'public_store_unavailable', reason, contactPhone: store.contactPhone },
      409,
    )
  const publishedPurposeIds = parseJson(store.publicPurposeIdsJson, 'public purpose ids')
  if (
    !Array.isArray(publishedPurposeIds) ||
    !publishedPurposeIds.every((id): id is string => typeof id === 'string') ||
    !input.purposeIds.every((id) => publishedPurposeIds.includes(id))
  ) {
    return c.json({ error: 'invalid_public_purpose_selection' }, 400)
  }
  const confirmationKeyHash = await hashConfirmationKey(idempotencyKey)
  const existingConfirmation = await db
    .select({
      organizationId: webBookingRecords.organizationId,
      storeId: webBookingRecords.storeId,
    })
    .from(webBookingRecords)
    .where(eq(webBookingRecords.confirmationKeyHash, confirmationKeyHash))
  if (
    existingConfirmation.some(
      (record) =>
        record.organizationId !== store.organizationId || record.storeId !== store.storeId,
    )
  ) {
    return c.json({ error: 'confirmation_key_conflict' }, 409)
  }
  try {
    const result = await withIdempotency(
      {
        db,
        organizationId: store.organizationId,
        operation: `public_reservation_create:${store.storeId}`,
        key: confirmationKeyHash,
        requestHash: await requestHash(input),
        clock: requestClock(c),
      },
      async (completeInBatch) =>
        retryableBeforeCommit(async () => {
          const { selected, allocation, claimSlots, equipmentResourceIds, purposeResourceIds } =
            await prepareReservationAllocation(db, store.organizationId, store.storeId, input)
          const id = crypto.randomUUID()
          const createdAt = nowIso(requestClock(c))
          const managementCode = issueManagementCode()
          const managementCodeHash = await hashManagementCode(managementCode)
          const issued = PublicBookingResult.parse({
            reservationNumber: reservationNumber(),
            managementCode,
            emailStatus: 'pending',
          })
          const persisted = PublicBookingResult.parse({ ...issued, managementCode: null })
          try {
            await writeAuditBatch(db, {
              clock: requestClock(c),
              operations: [
                db
                  .insert(customers)
                  .values({
                    id: crypto.randomUUID(),
                    organizationId: store.organizationId,
                    primaryStoreId: store.storeId,
                    name: input.customer.name,
                    kana: input.customer.kana,
                    phoneNormalized: normalizedCustomerPhone,
                    email: input.customer.email,
                    visitCount: 1,
                    createdAt,
                    updatedAt: createdAt,
                  })
                  .onConflictDoUpdate({
                    target: [customers.organizationId, customers.phoneNormalized],
                    set: {
                      name: input.customer.name,
                      kana: input.customer.kana,
                      email: input.customer.email,
                      visitCount: sql`${customers.visitCount} + 1`,
                      updatedAt: createdAt,
                    },
                  }),
                db.insert(reservations).select(
                  db
                    .select({
                      id: sql<string>`${id}`.as('id'),
                      organizationId: sql<string>`${store.organizationId}`.as('organizationId'),
                      storeId: sql<string>`${store.storeId}`.as('storeId'),
                      reservationNumber: sql<string>`${issued.reservationNumber}`.as(
                        'reservationNumber',
                      ),
                      source: sql<string>`'web'`.as('source'),
                      status: sql<string>`'confirmed'`.as('status'),
                      startAt: sql<string>`${selected.startAt}`.as('startAt'),
                      endAt: sql<string>`${selected.endAt}`.as('endAt'),
                      purposeIdsJson: sql<string>`${JSON.stringify(input.purposeIds)}`.as(
                        'purposeIdsJson',
                      ),
                      customerId: customers.id,
                      customerName: sql<string>`${input.customer.name}`.as('customerName'),
                      customerKana: sql<string>`${input.customer.kana}`.as('customerKana'),
                      customerPhone: sql<string>`${input.customer.phone}`.as('customerPhone'),
                      customerPhoneNormalized: sql<string>`${normalizedCustomerPhone}`.as(
                        'customerPhoneNormalized',
                      ),
                      customerEmail: sql<string>`${input.customer.email}`.as('customerEmail'),
                      recital: sql<string>`'Web予約'`.as('recital'),
                      reservationMemo: sql<null>`null`.as('reservationMemo'),
                      handoffNote: sql<null>`null`.as('handoffNote'),
                      progress: sql<null>`null`.as('progress'),
                      waitStartedAt: sql<null>`null`.as('waitStartedAt'),
                      assignedStaffId: sql<null>`null`.as('assignedStaffId'),
                      assignedEquipmentIdsJson: sql<null>`null`.as('assignedEquipmentIdsJson'),
                      nextGuidance: sql<null>`null`.as('nextGuidance'),
                      progressOperationId: sql<null>`null`.as('progressOperationId'),
                      version: sql<number>`1`.as('version'),
                      createdAt: sql<string>`${createdAt}`.as('createdAt'),
                      updatedAt: sql<string>`${createdAt}`.as('updatedAt'),
                    })
                    .from(customers)
                    .where(
                      and(
                        eq(customers.organizationId, store.organizationId),
                        eq(customers.phoneNormalized, normalizedCustomerPhone),
                      ),
                    ),
                ),
                db.insert(availabilityBookings).values({
                  id,
                  organizationId: store.organizationId,
                  storeId: store.storeId,
                  startAt: selected.startAt,
                  endAt: selected.endAt,
                  purposeIdsJson: JSON.stringify(input.purposeIds),
                  staffId: allocation.staffId,
                  equipmentIdsJson: JSON.stringify(allocation.equipmentIds),
                  status: 'confirmed',
                }),
                db.insert(webBookingRecords).values({
                  id: crypto.randomUUID(),
                  organizationId: store.organizationId,
                  storeId: store.storeId,
                  reservationId: id,
                  confirmationKeyHash,
                  managementCodeHash,
                  consentVersion: input.consentVersion,
                  consentedAt: createdAt,
                  inputHistoryJson: JSON.stringify(input),
                  createdAt,
                }),
                db.insert(webBookingManagementCodeIssues).values({
                  id: crypto.randomUUID(),
                  organizationId: store.organizationId,
                  storeId: store.storeId,
                  reservationId: id,
                  codeHash: managementCodeHash,
                  issuedAt: createdAt,
                  expiresAt: selected.endAt,
                  revokedAt: null,
                  failedAttempts: 0,
                  issuedBy: 'system:web-reservation',
                }),
                completeInBatch(issued, persisted),
                ...[
                  ...claimSlots.map((slotStartAt) => ({
                    id: crypto.randomUUID(),
                    organizationId: store.organizationId,
                    storeId: store.storeId,
                    reservationId: id,
                    resourceKind: 'staff',
                    resourceId: allocation.staffId,
                    slotStartAt,
                  })),
                  ...equipmentResourceIds.flatMap((resourceId) =>
                    claimSlots.map((slotStartAt) => ({
                      id: crypto.randomUUID(),
                      organizationId: store.organizationId,
                      storeId: store.storeId,
                      reservationId: id,
                      resourceKind: 'equipment',
                      resourceId,
                      slotStartAt,
                    })),
                  ),
                  ...purposeResourceIds.flatMap((resourceId) =>
                    claimSlots.map((slotStartAt) => ({
                      id: crypto.randomUUID(),
                      organizationId: store.organizationId,
                      storeId: store.storeId,
                      reservationId: id,
                      resourceKind: 'purpose',
                      resourceId,
                      slotStartAt,
                    })),
                  ),
                ].map((claim) => db.insert(reservationResourceAllocations).values(claim)),
              ],
              events: [
                {
                  organizationId: store.organizationId,
                  storeId: store.storeId,
                  actorType: 'public_web',
                  actorId: 'anonymous',
                  action: 'reservation.created',
                  entityType: 'reservation',
                  entityId: id,
                  metadata: {
                    source: 'web',
                    reservationNumber: issued.reservationNumber,
                    purposeCount: input.purposeIds.length,
                  },
                },
              ],
            })
          } catch (error) {
            if (isResourceClaimConflict(error))
              throw new RetryableIdempotencyError('reservation confirmation batch rolled back')
            throw error
          }
          return issued
        }),
    )
    const booking = PublicBookingResult.parse(result)
    const reservationRows = await db
      .select({ id: reservations.id, startAt: reservations.startAt })
      .from(reservations)
      .where(
        and(
          eq(reservations.organizationId, store.organizationId),
          eq(reservations.storeId, store.storeId),
          eq(reservations.reservationNumber, booking.reservationNumber),
        ),
      )
    const reservation = reservationRows[0]
    if (!reservation) throw new Error('public reservation result has no reservation')
    let emailStatus = booking.emailStatus
    if (booking.managementCode !== null) {
      const confirmed = NotificationJob.parse({
        id: `reservation:${reservation.id}:confirmed`,
        organizationId: store.organizationId,
        type: 'reservation.confirmed',
        payload: {
          reservationId: reservation.id,
          to: input.customer.email,
          managementCode: booking.managementCode,
          reservationNumber: booking.reservationNumber,
          storeName: store.name,
          appointmentAt: reservation.startAt,
        },
      })
      const codeIssued = NotificationJob.parse({
        id: `reservation:${reservation.id}:management-code-issued`,
        organizationId: store.organizationId,
        type: 'reservation.management_code_issued',
        payload: {
          reservationId: reservation.id,
          to: input.customer.email,
          managementCode: booking.managementCode,
          reservationNumber: booking.reservationNumber,
          storeName: store.name,
          appointmentAt: reservation.startAt,
        },
      })
      const delivery = await Promise.all([
        deliverPublicNotification(
          c,
          db,
          store.organizationId,
          store.storeId,
          reservation.id,
          confirmed,
          'reservation.confirmed',
        ),
        deliverPublicNotification(
          c,
          db,
          store.organizationId,
          store.storeId,
          reservation.id,
          codeIssued,
          'reservation.management_code_issued',
        ),
      ])
      emailStatus = delivery.every((status) => status === 'sent')
        ? 'sent'
        : delivery.some((status) => status === 'pending')
          ? 'pending'
          : 'failed'
    } else {
      const attempts = await db
        .select({ status: webBookingNotificationAttempts.status })
        .from(webBookingNotificationAttempts)
        .where(
          and(
            eq(webBookingNotificationAttempts.organizationId, store.organizationId),
            eq(webBookingNotificationAttempts.reservationId, reservation.id),
          ),
        )
        .orderBy(desc(webBookingNotificationAttempts.attemptedAt))
      const latest = attempts[0]?.status
      if (latest === 'sent' || latest === 'failed') emailStatus = latest
    }
    return c.json(PublicBookingResult.parse({ ...booking, emailStatus }), 201)
  } catch (error) {
    if (
      error instanceof SlotUnavailableError ||
      error instanceof RangeError ||
      error instanceof RetryableIdempotencyError
    )
      return c.json({ error: 'slot_unavailable' }, 409)
    if (error instanceof IdempotencyConflictError || error instanceof IdempotencyInProgressError)
      return c.json({ error: error.code }, error.status)
    if (isConfirmationKeyConflict(error)) return c.json({ error: 'confirmation_key_conflict' }, 409)
    throw error
  }
}

function isConfirmationKeyConflict(error: unknown): boolean {
  return String(error instanceof AuditAppendError ? error.cause : error).includes(
    'web_booking_records.confirmation_key_hash',
  )
}

async function recordPublicNotificationAttempt(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
  reservationId: string,
  notificationId: string,
  notificationType:
    | 'reservation.confirmed'
    | 'reservation.management_code_issued'
    | 'reservation.management_code_reissued',
  status: 'pending' | 'sent' | 'failed',
  clock: Clock,
): Promise<void> {
  const attemptedAt = nowIso(clock)
  await writeAuditBatch(db, {
    clock,
    operations: [
      db.insert(webBookingNotificationAttempts).values({
        id: crypto.randomUUID(),
        organizationId,
        storeId,
        reservationId,
        notificationId,
        notificationType,
        status,
        attemptedAt,
      }),
    ],
    events: [
      {
        organizationId,
        storeId,
        actorType: 'system',
        actorId: 'notifier',
        action: 'reservation.notification_recorded',
        entityType: 'reservation',
        entityId: reservationId,
        metadata: { notificationId, status },
      },
    ],
  })
}

async function deliverPublicNotification(
  c: AppContext,
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
  reservationId: string,
  job: NotificationJob,
  notificationType:
    | 'reservation.confirmed'
    | 'reservation.management_code_issued'
    | 'reservation.management_code_reissued',
  clock: Clock = systemClock(),
): Promise<'pending' | 'sent' | 'failed'> {
  try {
    await recordPublicNotificationAttempt(
      db,
      organizationId,
      storeId,
      reservationId,
      job.id,
      notificationType,
      'pending',
      clock,
    )
  } catch {
    // Without a durable pending marker, do not send a recoverability secret.
    return 'pending'
  }
  let status: 'sent' | 'failed' = 'failed'
  try {
    const response = await c.env.NOTIFIER.fetch('https://notifier.internal/api/internal/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': c.env.INTERNAL_KEY },
      body: JSON.stringify(job),
    })
    const notification = response.ok
      ? NotificationResult.safeParse(await response.json())
      : { success: false as const }
    status =
      notification.success && ['sent', 'duplicate'].includes(notification.data.status)
        ? 'sent'
        : 'failed'
  } catch {
    status = 'failed'
  }
  try {
    await recordPublicNotificationAttempt(
      db,
      organizationId,
      storeId,
      reservationId,
      job.id,
      notificationType,
      status,
      clock,
    )
    return status
  } catch {
    // The message may have reached the provider but is explicitly recoverable as pending.
    return 'pending'
  }
}

async function readPublicReservationStatus(
  c: AppContext,
  confirmationKey: string,
): Promise<Response> {
  const db = drizzle(c.env.DB)
  const confirmationKeyHash = await hashConfirmationKey(confirmationKey)
  const rows = await db
    .select({ status: reservations.status })
    .from(webBookingRecords)
    .innerJoin(
      reservations,
      and(
        eq(reservations.organizationId, webBookingRecords.organizationId),
        eq(reservations.id, webBookingRecords.reservationId),
      ),
    )
    .where(eq(webBookingRecords.confirmationKeyHash, confirmationKeyHash))
  if (rows.length !== 1) return c.json(PublicReservationStatus.parse({ status: 'not_found' }))
  return c.json(
    PublicReservationStatus.parse({
      status: rows[0]?.status === 'confirmed' ? 'confirmed' : 'pending',
    }),
  )
}

/**
 * Verify a company-issued code without returning reservation/customer data.
 * A successful verification creates a hash-only, reservation-scoped bearer
 * session; callers receive its plaintext exactly once in this response.
 */
async function verifyPublicReservationManagementCode(
  c: AppContext,
  input: PublicReservationVerification,
): Promise<Response> {
  const db = drizzle(c.env.DB)
  const clock = requestClock(c)
  const codeHash = await hashManagementCode(input.managementCode)
  const matching = (
    await db
      .select({
        issueId: webBookingManagementCodeIssues.id,
        organizationId: webBookingManagementCodeIssues.organizationId,
        storeId: webBookingManagementCodeIssues.storeId,
        reservationId: webBookingManagementCodeIssues.reservationId,
        expiresAt: webBookingManagementCodeIssues.expiresAt,
        revokedAt: webBookingManagementCodeIssues.revokedAt,
        failedAttempts: webBookingManagementCodeIssues.failedAttempts,
        version: reservations.version,
        startAt: reservations.startAt,
        purposeIdsJson: reservations.purposeIdsJson,
        storeSlug: webBookingPublications.publicSlug,
      })
      .from(webBookingManagementCodeIssues)
      .innerJoin(
        reservations,
        and(
          eq(reservations.organizationId, webBookingManagementCodeIssues.organizationId),
          eq(reservations.id, webBookingManagementCodeIssues.reservationId),
        ),
      )
      .innerJoin(
        webBookingRecords,
        and(
          eq(webBookingRecords.organizationId, webBookingManagementCodeIssues.organizationId),
          eq(webBookingRecords.storeId, webBookingManagementCodeIssues.storeId),
          eq(webBookingRecords.reservationId, webBookingManagementCodeIssues.reservationId),
        ),
      )
      .innerJoin(
        webBookingPublications,
        and(
          eq(webBookingPublications.organizationId, webBookingManagementCodeIssues.organizationId),
          eq(webBookingPublications.storeId, webBookingManagementCodeIssues.storeId),
        ),
      )
      .where(
        and(
          eq(reservations.reservationNumber, input.reservationNumber),
          eq(webBookingManagementCodeIssues.codeHash, codeHash),
        ),
      )
  )[0]

  if (!matching) {
    // Keep the failure response indistinguishable, but count a bad attempt
    // against the latest active issue for an existing reservation number.
    const activeIssues = await db
      .select({
        id: webBookingManagementCodeIssues.id,
        organizationId: webBookingManagementCodeIssues.organizationId,
        reservationId: webBookingManagementCodeIssues.reservationId,
      })
      .from(webBookingManagementCodeIssues)
      .innerJoin(
        reservations,
        and(
          eq(reservations.organizationId, webBookingManagementCodeIssues.organizationId),
          eq(reservations.id, webBookingManagementCodeIssues.reservationId),
        ),
      )
      .innerJoin(
        webBookingRecords,
        and(
          eq(webBookingRecords.organizationId, webBookingManagementCodeIssues.organizationId),
          eq(webBookingRecords.storeId, webBookingManagementCodeIssues.storeId),
          eq(webBookingRecords.reservationId, webBookingManagementCodeIssues.reservationId),
        ),
      )
      .where(
        and(
          eq(reservations.reservationNumber, input.reservationNumber),
          isNull(webBookingManagementCodeIssues.revokedAt),
        ),
      )
      .orderBy(desc(webBookingManagementCodeIssues.issuedAt))
      .limit(2)
    // Reservation numbers are tenant-scoped. For an incorrect code, public
    // input has no tenant discriminator, so refuse to mutate any counter if
    // a legacy/corrupt duplicate would make the target ambiguous.
    const activeIssue = activeIssues.length === 1 ? activeIssues[0] : undefined
    if (activeIssue) {
      await db
        .update(webBookingManagementCodeIssues)
        .set({
          failedAttempts: sql`min(${webBookingManagementCodeIssues.failedAttempts} + 1, ${MANAGEMENT_CODE_MAX_FAILED_ATTEMPTS})`,
        })
        .where(
          and(
            eq(webBookingManagementCodeIssues.organizationId, activeIssue.organizationId),
            eq(webBookingManagementCodeIssues.reservationId, activeIssue.reservationId),
            eq(webBookingManagementCodeIssues.id, activeIssue.id),
          ),
        )
        .run()
    }
    return c.json({ error: 'invalid_management_code' }, 401)
  }
  const accessError = managementCodeAccessError(matching, clock.now())
  if (accessError) {
    if (
      accessError === 'management_code_expired' ||
      accessError === 'management_code_attempt_limit'
    ) {
      const publication = (
        await db
          .select({ contactPhone: webBookingPublications.contactPhone })
          .from(webBookingPublications)
          .where(
            and(
              eq(webBookingPublications.organizationId, matching.organizationId),
              eq(webBookingPublications.storeId, matching.storeId),
            ),
          )
      )[0]
      return c.json(
        {
          error: accessError,
          contactPhone: publication?.contactPhone ?? null,
          reissueRequired: true,
        },
        401,
      )
    }
    return c.json({ error: accessError }, 401)
  }

  const createdAt = nowIso(clock)
  const expiresAt = new Date(
    Date.parse(createdAt) + VERIFIED_RESERVATION_SESSION_TTL_MS,
  ).toISOString()
  const verificationToken = issueVerifiedReservationSessionToken()
  const sessionId = crypto.randomUUID()
  const tokenHash = await hashVerifiedReservationSessionToken(verificationToken)
  const activeIssue = and(
    eq(webBookingManagementCodeIssues.id, matching.issueId),
    eq(webBookingManagementCodeIssues.organizationId, matching.organizationId),
    eq(webBookingManagementCodeIssues.storeId, matching.storeId),
    eq(webBookingManagementCodeIssues.reservationId, matching.reservationId),
    eq(webBookingManagementCodeIssues.codeHash, codeHash),
    isNull(webBookingManagementCodeIssues.revokedAt),
    lt(webBookingManagementCodeIssues.failedAttempts, MANAGEMENT_CODE_MAX_FAILED_ATTEMPTS),
    gt(webBookingManagementCodeIssues.expiresAt, createdAt),
  )
  const claimed = await db.batch([
    db
      .delete(webBookingVerifiedSessions)
      .where(
        and(
          eq(webBookingVerifiedSessions.organizationId, matching.organizationId),
          eq(webBookingVerifiedSessions.storeId, matching.storeId),
          eq(webBookingVerifiedSessions.reservationId, matching.reservationId),
          sql`exists (select 1 from ${webBookingManagementCodeIssues} where ${activeIssue})`,
        ),
      ),
    db.insert(webBookingVerifiedSessions).select(
      db
        .select({
          id: sql<string>`${sessionId}`.as('id'),
          organizationId: webBookingManagementCodeIssues.organizationId,
          storeId: webBookingManagementCodeIssues.storeId,
          reservationId: webBookingManagementCodeIssues.reservationId,
          tokenHash: sql<string>`${tokenHash}`.as('tokenHash'),
          createdAt: sql<string>`${createdAt}`.as('createdAt'),
          expiresAt: sql<string>`${expiresAt}`.as('expiresAt'),
        })
        .from(webBookingManagementCodeIssues)
        .where(activeIssue),
    ),
  ])
  if (!batchStatementChanged(claimed[1])) {
    const currentIssue = (
      await db
        .select({
          expiresAt: webBookingManagementCodeIssues.expiresAt,
          revokedAt: webBookingManagementCodeIssues.revokedAt,
          failedAttempts: webBookingManagementCodeIssues.failedAttempts,
        })
        .from(webBookingManagementCodeIssues)
        .where(
          and(
            eq(webBookingManagementCodeIssues.id, matching.issueId),
            eq(webBookingManagementCodeIssues.organizationId, matching.organizationId),
            eq(webBookingManagementCodeIssues.storeId, matching.storeId),
            eq(webBookingManagementCodeIssues.reservationId, matching.reservationId),
          ),
        )
    )[0]
    const error = currentIssue
      ? managementCodeAccessError(currentIssue, clock.now())
      : 'management_code_revoked'
    return c.json({ error: error ?? 'invalid_management_code' }, 401)
  }
  return c.json(
    PublicReservationVerificationResult.parse({
      reservationId: matching.reservationId,
      verificationToken,
      expiresAt,
      version: matching.version,
      startAt: matching.startAt,
      purposeIds: parseJson(matching.purposeIdsJson, 'verified reservation purposes'),
      storeSlug: matching.storeSlug,
    }),
    201,
  )
}

async function requirePublicVerifiedReservationSession(
  c: AppContext,
  reservationId: string,
): Promise<PublicVerifiedSessionAccess> {
  const token = c.req.header('x-reservation-verification-token')?.trim()
  if (!token) return { error: c.json({ error: 'verification_required' }, 401) } as const
  const db = drizzle(c.env.DB)
  const session = (
    await db
      .select()
      .from(webBookingVerifiedSessions)
      .where(
        eq(webBookingVerifiedSessions.tokenHash, await hashVerifiedReservationSessionToken(token)),
      )
  )[0]
  if (!session) return { error: c.json({ error: 'verification_required' }, 401) } as const
  const accessError = verifiedReservationSessionAccessError(
    session,
    { organizationId: session.organizationId, storeId: session.storeId, reservationId },
    requestClock(c).now(),
  )
  if (accessError) return { error: c.json({ error: accessError }, 401) } as const
  return { db, session } as const
}

async function releasePublicIdempotencyClaim(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  id: string,
): Promise<void> {
  await db
    .delete(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.id, id),
        eq(idempotencyRecords.organizationId, organizationId),
        eq(idempotencyRecords.status, 'in_progress'),
      ),
    )
    .run()
}

async function cancelPublicReservation(
  c: AppContext,
  reservationId: string,
  input: PublicReservationCancel,
): Promise<Response> {
  const access = await requirePublicVerifiedReservationSession(c, reservationId)
  if (!('db' in access)) return access.error
  const { db, session } = access
  const clock = requestClock(c)
  const idempotencyKey = c.req.header('idempotency-key')?.trim()
  if (!idempotencyKey || idempotencyKey.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400)
  const idempotencyHash = await hashConfirmationKey(idempotencyKey)
  const requestHashValue = await requestHash({ reservationId, input })
  const idempotencyId = crypto.randomUUID()
  const claimCreatedAt = nowIso(clock)
  await db
    .insert(idempotencyRecords)
    .values({
      id: idempotencyId,
      organizationId: session.organizationId,
      operation: `public_reservation_cancel:${session.storeId}`,
      key: idempotencyHash,
      requestHash: requestHashValue,
      status: 'in_progress',
      resultJson: null,
      createdAt: claimCreatedAt,
      expiresAt: new Date(Date.parse(claimCreatedAt) + 24 * 60 * 60 * 1000).toISOString(),
    })
    .onConflictDoNothing({
      target: [
        idempotencyRecords.organizationId,
        idempotencyRecords.operation,
        idempotencyRecords.key,
      ],
    })
    .run()
  const idempotency = (
    await db
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.organizationId, session.organizationId),
          eq(idempotencyRecords.operation, `public_reservation_cancel:${session.storeId}`),
          eq(idempotencyRecords.key, idempotencyHash),
        ),
      )
  )[0]
  if (!idempotency) throw new Error('public cancellation idempotency record disappeared')
  if (idempotency.requestHash !== requestHashValue)
    return c.json({ error: 'idempotency_conflict' }, 409)
  if (idempotency.status === 'completed') {
    if (!idempotency.resultJson) throw new Error('completed public cancellation has no result')
    return c.json(PublicReservationMutationResult.parse(JSON.parse(idempotency.resultJson)))
  }
  if (idempotency.id !== idempotencyId) return c.json({ error: 'idempotency_in_progress' }, 409)
  const current = (
    await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.organizationId, session.organizationId),
          eq(reservations.storeId, session.storeId),
          eq(reservations.id, reservationId),
        ),
      )
  )[0]
  if (!current) {
    await releasePublicIdempotencyClaim(db, session.organizationId, idempotency.id)
    return c.json({ error: 'verification_scope_mismatch' }, 401)
  }
  if (current.version !== input.version) {
    await releasePublicIdempotencyClaim(db, session.organizationId, idempotency.id)
    return c.json({ error: 'version_conflict', currentVersion: current.version }, 409)
  }
  if (current.status !== 'confirmed') {
    await releasePublicIdempotencyClaim(db, session.organizationId, idempotency.id)
    return c.json({ error: 'invalid_cancellation_transition', currentStatus: current.status }, 409)
  }
  if (reservationModificationAccessError(current.startAt, clock.now())) {
    await releasePublicIdempotencyClaim(db, session.organizationId, idempotency.id)
    return c.json({ error: 'cancellation_deadline_passed' }, 409)
  }
  const updatedAt = nowIso(clock)
  const nextVersion = current.version + 1
  const operationId = crypto.randomUUID()
  const applied = and(
    eq(reservations.organizationId, session.organizationId),
    eq(reservations.storeId, session.storeId),
    eq(reservations.id, reservationId),
    eq(reservations.version, nextVersion),
    eq(reservations.progressOperationId, operationId),
  )
  const afterJson = JSON.stringify({
    ...JSON.parse(reservationChangeSnapshot(current)),
    status: 'cancelled',
    version: nextVersion,
  })
  const result = await db.batch([
    db
      .update(reservations)
      .set({
        status: 'cancelled',
        version: nextVersion,
        updatedAt,
        progressOperationId: operationId,
      })
      .where(
        and(
          eq(reservations.organizationId, session.organizationId),
          eq(reservations.storeId, session.storeId),
          eq(reservations.id, reservationId),
          eq(reservations.version, input.version),
          eq(reservations.status, 'confirmed'),
        ),
      ),
    db
      .delete(reservationResourceAllocations)
      .where(
        and(
          eq(reservationResourceAllocations.organizationId, session.organizationId),
          eq(reservationResourceAllocations.storeId, session.storeId),
          eq(reservationResourceAllocations.reservationId, reservationId),
          sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${session.organizationId} and ${reservations.storeId} = ${session.storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${nextVersion} and ${reservations.progressOperationId} = ${operationId})`,
        ),
      ),
    db
      .update(availabilityBookings)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(availabilityBookings.organizationId, session.organizationId),
          eq(availabilityBookings.storeId, session.storeId),
          eq(availabilityBookings.id, reservationId),
          sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${session.organizationId} and ${reservations.storeId} = ${session.storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${nextVersion} and ${reservations.progressOperationId} = ${operationId})`,
        ),
      ),
    db
      .update(webBookingManagementCodeIssues)
      .set({ revokedAt: updatedAt })
      .where(
        and(
          eq(webBookingManagementCodeIssues.organizationId, session.organizationId),
          eq(webBookingManagementCodeIssues.storeId, session.storeId),
          eq(webBookingManagementCodeIssues.reservationId, reservationId),
          isNull(webBookingManagementCodeIssues.revokedAt),
          sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${session.organizationId} and ${reservations.storeId} = ${session.storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${nextVersion} and ${reservations.progressOperationId} = ${operationId})`,
        ),
      ),
    db.insert(reservationChanges).select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as('id'),
          organizationId: reservations.organizationId,
          storeId: reservations.storeId,
          reservationId: reservations.id,
          action: sql<string>`'cancelled'`.as('action'),
          reason: sql<string>`'customer_request'`.as('reason'),
          beforeJson: sql<string>`${reservationChangeSnapshot(current)}`.as('beforeJson'),
          afterJson: sql<string>`${afterJson}`.as('afterJson'),
          actorId: sql<string>`${`public_verified:${session.id}`}`.as('actorId'),
          occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
        })
        .from(reservations)
        .where(applied),
    ),
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as('id'),
          organizationId: reservations.organizationId,
          storeId: reservations.storeId,
          actorType: sql<string>`'public_web'`.as('actorType'),
          actorId: sql<string>`${session.id}`.as('actorId'),
          action: sql<string>`'reservation.cancelled'`.as('action'),
          entityType: sql<string>`'reservation'`.as('entityType'),
          entityId: reservations.id,
          requestId: sql<string>`${crypto.randomUUID()}`.as('requestId'),
          metadata:
            sql<string>`${JSON.stringify({ source: 'verified_management_code', version: nextVersion })}`.as(
              'metadata',
            ),
          occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
        })
        .from(reservations)
        .where(applied),
    ),
    db
      .update(idempotencyRecords)
      .set({
        status: 'completed',
        resultJson: JSON.stringify({ status: 'cancelled', version: nextVersion }),
      })
      .where(
        and(
          eq(idempotencyRecords.id, idempotency.id),
          eq(idempotencyRecords.status, 'in_progress'),
          sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${session.organizationId} and ${reservations.storeId} = ${session.storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${nextVersion} and ${reservations.progressOperationId} = ${operationId})`,
        ),
      ),
  ])
  if (!batchStatementChanged(result[0])) {
    await releasePublicIdempotencyClaim(db, session.organizationId, idempotency.id)
    return c.json({ error: 'version_conflict', currentVersion: current.version }, 409)
  }
  return c.json(
    PublicReservationMutationResult.parse({ status: 'cancelled', version: nextVersion }),
  )
}

async function changePublicReservation(
  c: AppContext,
  reservationId: string,
  input: PublicReservationChange,
): Promise<Response> {
  const access = await requirePublicVerifiedReservationSession(c, reservationId)
  if (!('db' in access)) return access.error
  const { db, session } = access
  const clock = requestClock(c)
  const idempotencyKey = c.req.header('idempotency-key')?.trim()
  if (!idempotencyKey || idempotencyKey.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400)
  const idempotencyHash = await hashConfirmationKey(idempotencyKey)
  const requestHashValue = await requestHash({ reservationId, input })
  const idempotencyId = crypto.randomUUID()
  const claimCreatedAt = nowIso(clock)
  await db
    .insert(idempotencyRecords)
    .values({
      id: idempotencyId,
      organizationId: session.organizationId,
      operation: `public_reservation_change:${session.storeId}`,
      key: idempotencyHash,
      requestHash: requestHashValue,
      status: 'in_progress',
      resultJson: null,
      createdAt: claimCreatedAt,
      expiresAt: new Date(Date.parse(claimCreatedAt) + 24 * 60 * 60 * 1000).toISOString(),
    })
    .onConflictDoNothing({
      target: [
        idempotencyRecords.organizationId,
        idempotencyRecords.operation,
        idempotencyRecords.key,
      ],
    })
    .run()
  const idempotency = (
    await db
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.organizationId, session.organizationId),
          eq(idempotencyRecords.operation, `public_reservation_change:${session.storeId}`),
          eq(idempotencyRecords.key, idempotencyHash),
        ),
      )
  )[0]
  if (!idempotency) throw new Error('public change idempotency record disappeared')
  if (idempotency.requestHash !== requestHashValue)
    return c.json({ error: 'idempotency_conflict' }, 409)
  if (idempotency.status === 'completed') {
    if (!idempotency.resultJson) throw new Error('completed public change has no result')
    return c.json(PublicReservationChangeResult.parse(JSON.parse(idempotency.resultJson)))
  }
  if (idempotency.id !== idempotencyId) return c.json({ error: 'idempotency_in_progress' }, 409)
  const current = (
    await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.organizationId, session.organizationId),
          eq(reservations.storeId, session.storeId),
          eq(reservations.id, reservationId),
        ),
      )
  )[0]
  if (!current) {
    await releasePublicIdempotencyClaim(db, session.organizationId, idempotency.id)
    return c.json({ error: 'verification_scope_mismatch' }, 401)
  }
  if (current.version !== input.version) {
    await releasePublicIdempotencyClaim(db, session.organizationId, idempotency.id)
    return c.json({ error: 'version_conflict', currentVersion: current.version }, 409)
  }
  if (current.status !== 'confirmed') {
    await releasePublicIdempotencyClaim(db, session.organizationId, idempotency.id)
    return c.json({ error: 'invalid_change_transition', currentStatus: current.status }, 409)
  }
  if (reservationModificationAccessError(current.startAt, clock.now())) {
    await releasePublicIdempotencyClaim(db, session.organizationId, idempotency.id)
    return c.json({ error: 'change_deadline_passed' }, 409)
  }
  const publication = (
    await db
      .select({ purposeIdsJson: webBookingPublications.publicPurposeIdsJson })
      .from(webBookingPublications)
      .where(
        and(
          eq(webBookingPublications.organizationId, session.organizationId),
          eq(webBookingPublications.storeId, session.storeId),
        ),
      )
  )[0]
  const publicPurposeIds =
    publication === undefined ? [] : parseJson(publication.purposeIdsJson, 'public purpose ids')
  if (
    !Array.isArray(publicPurposeIds) ||
    !publicPurposeIds.every((id): id is string => typeof id === 'string') ||
    !input.purposeIds.every((id) => publicPurposeIds.includes(id))
  ) {
    await releasePublicIdempotencyClaim(db, session.organizationId, idempotency.id)
    return c.json({ error: 'invalid_public_purpose_selection' }, 400)
  }
  try {
    const { selected, allocation, claimSlots, equipmentResourceIds, purposeResourceIds } =
      await prepareReservationAllocation(db, session.organizationId, session.storeId, input, {
        excludeReservationId: reservationId,
      })
    const updatedAt = nowIso(clock)
    const version = current.version + 1
    const operationId = crypto.randomUUID()
    const next = {
      ...current,
      startAt: selected.startAt,
      endAt: selected.endAt,
      purposeIdsJson: JSON.stringify(input.purposeIds),
      version,
      updatedAt,
      progressOperationId: operationId,
    }
    const applied = and(
      eq(reservations.organizationId, session.organizationId),
      eq(reservations.storeId, session.storeId),
      eq(reservations.id, reservationId),
      eq(reservations.version, version),
      eq(reservations.progressOperationId, operationId),
    )
    const claims = [
      ...claimSlots.map((slotStartAt) => ({
        resourceKind: 'staff',
        resourceId: allocation.staffId,
        slotStartAt,
      })),
      ...equipmentResourceIds.flatMap((resourceId) =>
        claimSlots.map((slotStartAt) => ({ resourceKind: 'equipment', resourceId, slotStartAt })),
      ),
      ...purposeResourceIds.flatMap((resourceId) =>
        claimSlots.map((slotStartAt) => ({ resourceKind: 'purpose', resourceId, slotStartAt })),
      ),
    ] as const
    const results = await db.batch([
      db
        .update(reservations)
        .set({
          startAt: next.startAt,
          endAt: next.endAt,
          purposeIdsJson: next.purposeIdsJson,
          version,
          updatedAt,
          progressOperationId: operationId,
        })
        .where(
          and(
            eq(reservations.organizationId, session.organizationId),
            eq(reservations.storeId, session.storeId),
            eq(reservations.id, reservationId),
            eq(reservations.version, input.version),
            eq(reservations.status, 'confirmed'),
          ),
        ),
      db
        .delete(reservationResourceAllocations)
        .where(
          and(
            eq(reservationResourceAllocations.organizationId, session.organizationId),
            eq(reservationResourceAllocations.storeId, session.storeId),
            eq(reservationResourceAllocations.reservationId, reservationId),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${session.organizationId} and ${reservations.storeId} = ${session.storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${version} and ${reservations.progressOperationId} = ${operationId})`,
          ),
        ),
      db
        .update(availabilityBookings)
        .set({
          startAt: next.startAt,
          endAt: next.endAt,
          purposeIdsJson: next.purposeIdsJson,
          staffId: allocation.staffId,
          equipmentIdsJson: JSON.stringify(allocation.equipmentIds),
        })
        .where(
          and(
            eq(availabilityBookings.organizationId, session.organizationId),
            eq(availabilityBookings.storeId, session.storeId),
            eq(availabilityBookings.id, reservationId),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${session.organizationId} and ${reservations.storeId} = ${session.storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${version} and ${reservations.progressOperationId} = ${operationId})`,
          ),
        ),
      ...claims.map((claim) =>
        db.insert(reservationResourceAllocations).select(
          db
            .select({
              id: sql<string>`${crypto.randomUUID()}`.as('id'),
              organizationId: reservations.organizationId,
              storeId: reservations.storeId,
              reservationId: reservations.id,
              resourceKind: sql<string>`${claim.resourceKind}`.as('resourceKind'),
              resourceId: sql<string>`${claim.resourceId}`.as('resourceId'),
              slotStartAt: sql<string>`${claim.slotStartAt}`.as('slotStartAt'),
            })
            .from(reservations)
            .where(applied),
        ),
      ),
      db
        .update(webBookingManagementCodeIssues)
        .set({ expiresAt: next.endAt })
        .where(
          and(
            eq(webBookingManagementCodeIssues.organizationId, session.organizationId),
            eq(webBookingManagementCodeIssues.storeId, session.storeId),
            eq(webBookingManagementCodeIssues.reservationId, reservationId),
            isNull(webBookingManagementCodeIssues.revokedAt),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${session.organizationId} and ${reservations.storeId} = ${session.storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${version} and ${reservations.progressOperationId} = ${operationId})`,
          ),
        ),
      db.insert(reservationChanges).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as('id'),
            organizationId: reservations.organizationId,
            storeId: reservations.storeId,
            reservationId: reservations.id,
            action: sql<string>`'changed'`.as('action'),
            reason: sql<string>`'customer_request'`.as('reason'),
            beforeJson: sql<string>`${reservationChangeSnapshot(current)}`.as('beforeJson'),
            afterJson: sql<string>`${reservationChangeSnapshot(next)}`.as('afterJson'),
            actorId: sql<string>`${`public_verified:${session.id}`}`.as('actorId'),
            occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
          })
          .from(reservations)
          .where(applied),
      ),
      db.insert(auditEvents).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as('id'),
            organizationId: reservations.organizationId,
            storeId: reservations.storeId,
            actorType: sql<string>`'public_web'`.as('actorType'),
            actorId: sql<string>`${session.id}`.as('actorId'),
            action: sql<string>`'reservation.changed'`.as('action'),
            entityType: sql<string>`'reservation'`.as('entityType'),
            entityId: reservations.id,
            requestId: sql<string>`${crypto.randomUUID()}`.as('requestId'),
            metadata:
              sql<string>`${JSON.stringify({ source: 'verified_management_code', version })}`.as(
                'metadata',
              ),
            occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
          })
          .from(reservations)
          .where(applied),
      ),
      db
        .update(idempotencyRecords)
        .set({
          status: 'completed',
          resultJson: JSON.stringify({
            status: 'confirmed',
            version,
            startAt: next.startAt,
            endAt: next.endAt,
            purposeIds: input.purposeIds,
          }),
        })
        .where(
          and(
            eq(idempotencyRecords.id, idempotency.id),
            eq(idempotencyRecords.status, 'in_progress'),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${session.organizationId} and ${reservations.storeId} = ${session.storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${version} and ${reservations.progressOperationId} = ${operationId})`,
          ),
        ),
    ])
    if (!batchStatementChanged(results[0])) {
      await releasePublicIdempotencyClaim(db, session.organizationId, idempotency.id)
      return c.json({ error: 'version_conflict', currentVersion: current.version }, 409)
    }
    return c.json(
      PublicReservationChangeResult.parse({
        status: 'confirmed',
        version,
        startAt: next.startAt,
        endAt: next.endAt,
        purposeIds: input.purposeIds,
      }),
    )
  } catch (error) {
    if (
      error instanceof SlotUnavailableError ||
      error instanceof RangeError ||
      isResourceClaimConflict(error)
    ) {
      await releasePublicIdempotencyClaim(db, session.organizationId, idempotency.id)
      return c.json({ error: 'slot_unavailable' }, 409)
    }
    throw error
  }
}

/** Staff-only recovery path: a code is never reissued through the public API. */
async function reissueManagementCode(
  c: AppContext,
  storeId: string,
  reservationId: string,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.write')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const organizationId = c.get('auth').org
  const row = (
    await db
      .select({
        reservationId: reservations.id,
        reservationNumber: reservations.reservationNumber,
        status: reservations.status,
        version: reservations.version,
        progressOperationId: reservations.progressOperationId,
        startAt: reservations.startAt,
        endAt: reservations.endAt,
        email: reservations.customerEmail,
        storeName: stores.name,
      })
      .from(reservations)
      .innerJoin(
        webBookingRecords,
        and(
          eq(webBookingRecords.organizationId, reservations.organizationId),
          eq(webBookingRecords.storeId, reservations.storeId),
          eq(webBookingRecords.reservationId, reservations.id),
        ),
      )
      .innerJoin(
        stores,
        and(
          eq(stores.organizationId, reservations.organizationId),
          eq(stores.id, reservations.storeId),
        ),
      )
      .where(
        and(
          eq(reservations.organizationId, organizationId),
          eq(reservations.storeId, storeId),
          eq(reservations.id, reservationId),
        ),
      )
  )[0]
  if (!row?.email)
    return c.json({ error: 'reservation_not_eligible_for_management_code_reissue' }, 404)
  if (row.status !== 'confirmed') return c.json({ error: 'reservation_not_confirmed' }, 409)
  const idempotencyKey = c.req.header('idempotency-key')?.trim()
  if (!idempotencyKey || idempotencyKey.length > 256)
    return c.json({ error: 'idempotency_key_required' }, 400)
  const idempotencyHash = await hashConfirmationKey(idempotencyKey)
  const requestHashValue = await requestHash({ reservationId })
  const clock = requestClock(c)
  const idempotencyId = crypto.randomUUID()
  const claimCreatedAt = nowIso(clock)
  await db
    .insert(idempotencyRecords)
    .values({
      id: idempotencyId,
      organizationId,
      operation: `management_code_reissue:${storeId}`,
      key: idempotencyHash,
      requestHash: requestHashValue,
      status: 'in_progress',
      resultJson: null,
      createdAt: claimCreatedAt,
      expiresAt: new Date(Date.parse(claimCreatedAt) + 24 * 60 * 60 * 1000).toISOString(),
    })
    .onConflictDoNothing({
      target: [
        idempotencyRecords.organizationId,
        idempotencyRecords.operation,
        idempotencyRecords.key,
      ],
    })
    .run()
  const idempotency = (
    await db
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.organizationId, organizationId),
          eq(idempotencyRecords.operation, `management_code_reissue:${storeId}`),
          eq(idempotencyRecords.key, idempotencyHash),
        ),
      )
  )[0]
  if (!idempotency) throw new Error('management-code reissue idempotency record disappeared')
  if (idempotency.requestHash !== requestHashValue)
    return c.json({ error: 'idempotency_conflict' }, 409)
  if (idempotency.status === 'completed') {
    if (!idempotency.resultJson) throw new Error('completed management-code reissue has no result')
    return c.json(ManagementCodeReissueResult.parse(JSON.parse(idempotency.resultJson)), 201)
  }
  if (idempotency.id !== idempotencyId) return c.json({ error: 'idempotency_in_progress' }, 409)
  const managementCode = issueManagementCode()
  const codeHash = await hashManagementCode(managementCode)
  const issuedAt = nowIso(clock)
  const issueId = idempotency.id
  const operationId = crypto.randomUUID()
  const expectedProgressOperation =
    row.progressOperationId === null
      ? isNull(reservations.progressOperationId)
      : eq(reservations.progressOperationId, row.progressOperationId)
  const applied = and(
    eq(reservations.organizationId, organizationId),
    eq(reservations.storeId, storeId),
    eq(reservations.id, reservationId),
    eq(reservations.version, row.version),
    eq(reservations.status, 'confirmed'),
    eq(reservations.progressOperationId, operationId),
  )
  const results = await db.batch([
    db
      .update(reservations)
      .set({ progressOperationId: operationId, updatedAt: issuedAt })
      .where(
        and(
          eq(reservations.organizationId, organizationId),
          eq(reservations.storeId, storeId),
          eq(reservations.id, reservationId),
          eq(reservations.version, row.version),
          eq(reservations.status, 'confirmed'),
          expectedProgressOperation,
        ),
      ),
    db
      .update(webBookingManagementCodeIssues)
      .set({ revokedAt: issuedAt })
      .where(
        and(
          eq(webBookingManagementCodeIssues.organizationId, organizationId),
          eq(webBookingManagementCodeIssues.storeId, storeId),
          eq(webBookingManagementCodeIssues.reservationId, reservationId),
          isNull(webBookingManagementCodeIssues.revokedAt),
          sql`exists (select 1 from ${reservations} where ${applied})`,
        ),
      ),
    db.insert(webBookingManagementCodeIssues).select(
      db
        .select({
          id: sql<string>`${issueId}`.as('id'),
          organizationId: reservations.organizationId,
          storeId: reservations.storeId,
          reservationId: reservations.id,
          codeHash: sql<string>`${codeHash}`.as('codeHash'),
          issuedAt: sql<string>`${issuedAt}`.as('issuedAt'),
          expiresAt: reservations.endAt,
          revokedAt: sql<null>`NULL`.as('revokedAt'),
          failedAttempts: sql<number>`0`.as('failedAttempts'),
          issuedBy: sql<string>`${c.get('auth').sub}`.as('issuedBy'),
        })
        .from(reservations)
        .where(applied),
    ),
    db
      .delete(webBookingVerifiedSessions)
      .where(
        and(
          eq(webBookingVerifiedSessions.organizationId, organizationId),
          eq(webBookingVerifiedSessions.storeId, storeId),
          eq(webBookingVerifiedSessions.reservationId, reservationId),
          sql`exists (select 1 from ${reservations} where ${applied})`,
        ),
      ),
    db
      .update(idempotencyRecords)
      .set({ status: 'completed', resultJson: JSON.stringify({ emailStatus: 'pending' }) })
      .where(
        and(
          eq(idempotencyRecords.id, idempotency.id),
          eq(idempotencyRecords.organizationId, organizationId),
          eq(idempotencyRecords.status, 'in_progress'),
          sql`exists (select 1 from ${reservations} where ${applied})`,
        ),
      ),
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as('id'),
          organizationId: reservations.organizationId,
          storeId: reservations.storeId,
          actorType: sql<string>`'user'`.as('actorType'),
          actorId: sql<string>`${c.get('auth').sub}`.as('actorId'),
          action: sql<string>`'reservation.management_code_reissued'`.as('action'),
          entityType: sql<string>`'reservation'`.as('entityType'),
          entityId: reservations.id,
          requestId: sql<null>`NULL`.as('requestId'),
          metadata: sql<string>`${JSON.stringify({ issueId })}`.as('metadata'),
          occurredAt: sql<string>`${issuedAt}`.as('occurredAt'),
        })
        .from(reservations)
        .where(applied),
    ),
  ])
  if (!batchStatementChanged(results[0])) {
    await db
      .delete(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.id, idempotency.id),
          eq(idempotencyRecords.organizationId, organizationId),
          eq(idempotencyRecords.status, 'in_progress'),
        ),
      )
      .run()
    return c.json({ error: 'reservation_not_confirmed' }, 409)
  }
  const deliveryState = (
    await db
      .select({ startAt: reservations.startAt, status: reservations.status })
      .from(reservations)
      .where(
        and(
          eq(reservations.organizationId, organizationId),
          eq(reservations.storeId, storeId),
          eq(reservations.id, reservationId),
        ),
      )
  )[0]
  if (deliveryState?.status !== 'confirmed') {
    return c.json(ManagementCodeReissueResult.parse({ emailStatus: 'pending' }), 201)
  }
  const job = NotificationJob.parse({
    id: `reservation:${reservationId}:management-code-reissued:${issueId}`,
    organizationId,
    type: 'reservation.management_code_reissued',
    payload: {
      reservationId,
      to: row.email,
      managementCode,
      reservationNumber: row.reservationNumber,
      storeName: row.storeName,
      appointmentAt: deliveryState.startAt,
    },
  })
  const emailStatus = await deliverPublicNotification(
    c,
    db,
    organizationId,
    storeId,
    reservationId,
    job,
    'reservation.management_code_reissued',
    clock,
  )
  await db
    .update(idempotencyRecords)
    .set({ resultJson: JSON.stringify({ emailStatus }) })
    .where(
      and(
        eq(idempotencyRecords.id, idempotency.id),
        eq(idempotencyRecords.organizationId, organizationId),
        eq(idempotencyRecords.status, 'completed'),
      ),
    )
    .run()
  return c.json(ManagementCodeReissueResult.parse({ emailStatus }), 201)
}

async function persistOrganization(c: AppContext, organization: OrganizationSync) {
  const db = drizzle(c.env.DB)
  await db
    .insert(organizations)
    .values({
      id: organization.id,
      name: organization.name,
      plan: organization.plan,
      isDisabled: organization.isDisabled ? '1' : '0',
      createdAt: organization.createdAt,
      syncRevision: organization.revision,
    })
    .onConflictDoUpdate({
      target: organizations.id,
      set: {
        name: organization.name,
        plan: organization.plan,
        isDisabled: organization.isDisabled ? '1' : '0',
        createdAt: organization.createdAt,
        syncRevision: organization.revision,
      },
      // A service-binding response can arrive out of order. Only a strictly
      // newer admin snapshot may replace the local organization copy.
      setWhere: lt(organizations.syncRevision, organization.revision),
    })
  const appliedRows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organization.id))
  const row = appliedRows[0]
  if (!row) throw new Error('organization sync did not persist a canonical row')
  const applied = OrganizationSync.parse({
    id: row.id,
    name: row.name,
    plan: row.plan,
    isDisabled: row.isDisabled === '1',
    createdAt: row.createdAt,
    revision: row.syncRevision,
  })
  if (
    applied.revision === organization.revision &&
    (applied.name !== organization.name ||
      applied.plan !== organization.plan ||
      applied.isDisabled !== organization.isDisabled ||
      applied.createdAt !== organization.createdAt)
  ) {
    return c.json({ error: 'sync_revision_conflict' as const }, 409)
  }
  return c.json(applied, 200)
}

async function persistStore(c: AppContext, store: Store) {
  const db = drizzle(c.env.DB)
  await db
    .insert(stores)
    .values({
      id: store.id,
      organizationId: store.organizationId,
      name: store.name,
      slug: store.slug,
      isActive: store.isActive ? '1' : '0',
      createdAt: store.createdAt,
    })
    .onConflictDoUpdate({
      target: stores.id,
      set: {
        organizationId: store.organizationId,
        name: store.name,
        slug: store.slug,
        isActive: store.isActive ? '1' : '0',
      },
    })
  return c.json(store, 200)
}

async function persistMembership(c: AppContext, membership: StoreMembership) {
  const db = drizzle(c.env.DB)
  await db
    .insert(storeMemberships)
    .values({
      id: membership.id,
      organizationId: membership.organizationId,
      storeId: membership.storeId,
      userId: membership.userId,
      permissions: JSON.stringify(membership.permissions),
      createdAt: membership.createdAt,
    })
    .onConflictDoUpdate({
      // The source membership id may be re-created during an admin-side
      // store/user reconciliation. The business identity is the tenant,
      // store, and user tuple; using that unique key prevents duplicate
      // authorization rows when the source id changes.
      target: [storeMemberships.organizationId, storeMemberships.storeId, storeMemberships.userId],
      set: {
        permissions: JSON.stringify(membership.permissions),
        createdAt: membership.createdAt,
      },
    })
  return c.json(membership, 200)
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    throw new Error(`invalid ${label} JSON`, { cause: error })
  }
}

function emptyAvailabilitySettings(storeId: string): AvailabilityStoreSettings {
  return AvailabilityStoreSettings.parse({
    storeId,
    version: 0,
    receptionStatus: 'open',
    businessHours: [],
    exceptions: [],
    purposes: [],
    staff: [],
    shifts: [],
    equipment: [],
    maintenance: [],
  })
}

async function readAvailabilitySettings(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
): Promise<AvailabilityStoreSettings> {
  const [
    settingsRows,
    businessHourRows,
    exceptionRows,
    purposeRows,
    staffRows,
    shiftRows,
    equipmentRows,
    maintenanceRows,
  ] = await Promise.all([
    db
      .select()
      .from(availabilitySettings)
      .where(
        and(
          eq(availabilitySettings.organizationId, organizationId),
          eq(availabilitySettings.storeId, storeId),
        ),
      ),
    db
      .select()
      .from(availabilityBusinessHours)
      .where(
        and(
          eq(availabilityBusinessHours.organizationId, organizationId),
          eq(availabilityBusinessHours.storeId, storeId),
        ),
      ),
    db
      .select()
      .from(availabilityExceptions)
      .where(
        and(
          eq(availabilityExceptions.organizationId, organizationId),
          eq(availabilityExceptions.storeId, storeId),
        ),
      ),
    db
      .select()
      .from(visitPurposes)
      .where(
        and(eq(visitPurposes.organizationId, organizationId), eq(visitPurposes.storeId, storeId)),
      ),
    db
      .select()
      .from(availabilityStaff)
      .where(
        and(
          eq(availabilityStaff.organizationId, organizationId),
          eq(availabilityStaff.storeId, storeId),
        ),
      ),
    db
      .select()
      .from(availabilityStaffShifts)
      .where(
        and(
          eq(availabilityStaffShifts.organizationId, organizationId),
          eq(availabilityStaffShifts.storeId, storeId),
        ),
      ),
    db
      .select()
      .from(availabilityEquipment)
      .where(
        and(
          eq(availabilityEquipment.organizationId, organizationId),
          eq(availabilityEquipment.storeId, storeId),
        ),
      ),
    db
      .select()
      .from(availabilityMaintenances)
      .where(
        and(
          eq(availabilityMaintenances.organizationId, organizationId),
          eq(availabilityMaintenances.storeId, storeId),
        ),
      ),
  ])
  const current = settingsRows[0]
  if (!current) return emptyAvailabilitySettings(storeId)

  return AvailabilityStoreSettings.parse({
    storeId,
    version: current.version,
    receptionStatus: current.receptionStatus,
    businessHours: businessHourRows.map((row) =>
      AvailabilityBusinessHours.parse({
        dayOfWeek: row.dayOfWeek,
        periods: parseJson(row.periodsJson, 'business hours periods'),
      }),
    ),
    exceptions: exceptionRows.map((row) =>
      AvailabilityException.parse({
        date: row.date,
        mode: row.mode,
        periods: parseJson(row.periodsJson, 'exception periods'),
        ...(row.reason === null ? {} : { reason: row.reason }),
      }),
    ),
    purposes: purposeRows.map((row) =>
      AvailabilityPurpose.parse({
        id: row.id,
        staffName: row.staffName,
        customerLabel: row.customerLabel,
        durationMinutes: row.durationMinutes,
        slotIntervalMinutes: row.slotIntervalMinutes,
        isPublic: row.isPublic === '1',
        requiredSkills: parseJson(row.requiredSkillsJson, 'purpose skills'),
        requiredEquipment: parseJson(row.requiredEquipmentJson, 'purpose equipment'),
        maxConcurrent: row.maxConcurrent,
      }),
    ),
    staff: staffRows.map((row) =>
      AvailabilityStaff.parse({
        id: row.id,
        name: row.name,
        skills: parseJson(row.skillsJson, 'staff skills'),
        canBook: row.canBook === '1',
        isActive: row.isActive === '1',
      }),
    ),
    shifts: shiftRows.map((row) =>
      AvailabilityStaffShift.parse({
        id: row.id,
        staffId: row.staffId,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        breaks: parseJson(row.breaksJson, 'staff breaks'),
      }),
    ),
    equipment: equipmentRows.map((row) =>
      AvailabilityEquipment.parse({
        id: row.id,
        name: row.name,
        capacity: row.capacity,
        isActive: row.isActive === '1',
        availablePeriods: parseJson(row.availablePeriodsJson, 'equipment periods'),
      }),
    ),
    maintenance: maintenanceRows.map((row) =>
      AvailabilityMaintenance.parse({
        id: row.id,
        equipmentId: row.equipmentId,
        date: row.date,
        startTime: row.startTime,
        endTime: row.endTime,
        reason: row.reason,
      }),
    ),
  })
}

function uniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function validateAvailabilityReferences(input: AvailabilitySettingsInput): void {
  if (!uniqueValues(input.purposes.map((purpose) => purpose.id))) {
    throw new HTTPException(400, { message: 'duplicate purpose id' })
  }
  if (!uniqueValues(input.staff.map((member) => member.id))) {
    throw new HTTPException(400, { message: 'duplicate staff id' })
  }
  if (!uniqueValues(input.equipment.map((resource) => resource.id))) {
    throw new HTTPException(400, { message: 'duplicate equipment id' })
  }
  if (
    new Set(input.businessHours.map((hours) => hours.dayOfWeek)).size !== input.businessHours.length
  ) {
    throw new HTTPException(400, { message: 'duplicate business hours day' })
  }
  if (
    new Set(input.exceptions.map((exception) => exception.date)).size !== input.exceptions.length
  ) {
    throw new HTTPException(400, { message: 'duplicate exception date' })
  }
  const staffIds = new Set(input.staff.map((member) => member.id))
  if (input.shifts.some((shift) => !staffIds.has(shift.staffId))) {
    throw new HTTPException(400, { message: 'shift references an unknown staff member' })
  }
  const equipmentIds = new Set(input.equipment.map((resource) => resource.id))
  if (input.maintenance.some((maintenance) => !equipmentIds.has(maintenance.equipmentId))) {
    throw new HTTPException(400, { message: 'maintenance references unknown equipment' })
  }
}

/**
 * Build the full replace-in-place statement list for one store's settings.
 *
 * Both the direct settings PUT and a settings publication write exactly the
 * same rows, so the publication path can never drift from the interactive one.
 */
function availabilitySettingsWriteOperations(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
  persisted: AvailabilityStoreSettings,
  actorId: string,
  updatedAt: string,
  currentVersion: number,
  origin: SettingsOrigin,
) {
  const version = persisted.version
  const topLevel =
    currentVersion === 0
      ? db.insert(availabilitySettings).values({
          id: crypto.randomUUID(),
          organizationId,
          storeId,
          version,
          receptionStatus: persisted.receptionStatus,
          origin,
          updatedBy: actorId,
          updatedAt,
        })
      : db
          .update(availabilitySettings)
          .set({
            version,
            receptionStatus: persisted.receptionStatus,
            origin,
            updatedBy: actorId,
            updatedAt,
          })
          .where(
            and(
              eq(availabilitySettings.organizationId, organizationId),
              eq(availabilitySettings.storeId, storeId),
              eq(availabilitySettings.version, currentVersion),
            ),
          )

  return [
    topLevel,
    db
      .delete(availabilityBusinessHours)
      .where(
        and(
          eq(availabilityBusinessHours.organizationId, organizationId),
          eq(availabilityBusinessHours.storeId, storeId),
        ),
      ),
    db
      .delete(availabilityExceptions)
      .where(
        and(
          eq(availabilityExceptions.organizationId, organizationId),
          eq(availabilityExceptions.storeId, storeId),
        ),
      ),
    db
      .delete(visitPurposes)
      .where(
        and(eq(visitPurposes.organizationId, organizationId), eq(visitPurposes.storeId, storeId)),
      ),
    db
      .delete(availabilityStaff)
      .where(
        and(
          eq(availabilityStaff.organizationId, organizationId),
          eq(availabilityStaff.storeId, storeId),
        ),
      ),
    db
      .delete(availabilityStaffShifts)
      .where(
        and(
          eq(availabilityStaffShifts.organizationId, organizationId),
          eq(availabilityStaffShifts.storeId, storeId),
        ),
      ),
    db
      .delete(availabilityEquipment)
      .where(
        and(
          eq(availabilityEquipment.organizationId, organizationId),
          eq(availabilityEquipment.storeId, storeId),
        ),
      ),
    db
      .delete(availabilityMaintenances)
      .where(
        and(
          eq(availabilityMaintenances.organizationId, organizationId),
          eq(availabilityMaintenances.storeId, storeId),
        ),
      ),
    ...(persisted.businessHours.length > 0
      ? [
          db.insert(availabilityBusinessHours).values(
            persisted.businessHours.map((hours) => ({
              id: crypto.randomUUID(),
              organizationId,
              storeId,
              dayOfWeek: hours.dayOfWeek,
              periodsJson: JSON.stringify(hours.periods),
            })),
          ),
        ]
      : []),
    ...(persisted.exceptions.length > 0
      ? [
          db.insert(availabilityExceptions).values(
            persisted.exceptions.map((exception) => ({
              id: crypto.randomUUID(),
              organizationId,
              storeId,
              date: exception.date,
              mode: exception.mode,
              periodsJson: JSON.stringify(exception.periods),
              reason: exception.reason ?? null,
            })),
          ),
        ]
      : []),
    ...(persisted.purposes.length > 0
      ? [
          db.insert(visitPurposes).values(
            persisted.purposes.map((purpose) => ({
              id: purpose.id,
              organizationId,
              storeId,
              staffName: purpose.staffName,
              customerLabel: purpose.customerLabel,
              durationMinutes: purpose.durationMinutes,
              slotIntervalMinutes: purpose.slotIntervalMinutes,
              isPublic: purpose.isPublic ? '1' : '0',
              requiredSkillsJson: JSON.stringify(purpose.requiredSkills),
              requiredEquipmentJson: JSON.stringify(purpose.requiredEquipment),
              maxConcurrent: purpose.maxConcurrent,
            })),
          ),
        ]
      : []),
    ...(persisted.staff.length > 0
      ? [
          db.insert(availabilityStaff).values(
            persisted.staff.map((member) => ({
              id: member.id,
              organizationId,
              storeId,
              name: member.name,
              skillsJson: JSON.stringify(member.skills),
              canBook: member.canBook ? '1' : '0',
              isActive: member.isActive ? '1' : '0',
            })),
          ),
        ]
      : []),
    ...(persisted.shifts.length > 0
      ? [
          db.insert(availabilityStaffShifts).values(
            persisted.shifts.map((shift) => ({
              id: shift.id,
              organizationId,
              storeId,
              staffId: shift.staffId,
              date: shift.date,
              startTime: shift.startTime,
              endTime: shift.endTime,
              breaksJson: JSON.stringify(shift.breaks),
            })),
          ),
        ]
      : []),
    ...(persisted.equipment.length > 0
      ? [
          db.insert(availabilityEquipment).values(
            persisted.equipment.map((resource) => ({
              id: resource.id,
              organizationId,
              storeId,
              name: resource.name,
              capacity: resource.capacity,
              isActive: resource.isActive ? '1' : '0',
              availablePeriodsJson: JSON.stringify(resource.availablePeriods),
            })),
          ),
        ]
      : []),
    ...(persisted.maintenance.length > 0
      ? [
          db.insert(availabilityMaintenances).values(
            persisted.maintenance.map((maintenance) => ({
              id: maintenance.id,
              organizationId,
              storeId,
              equipmentId: maintenance.equipmentId,
              date: maintenance.date,
              startTime: maintenance.startTime,
              endTime: maintenance.endTime,
              reason: maintenance.reason,
            })),
          ),
        ]
      : []),
  ]
}

async function saveAvailabilitySettings(
  c: AppContext,
  storeId: string,
  input: AvailabilitySettingsInput,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.manage')
  if (denied) return denied
  validateAvailabilityReferences(input)

  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const current = await readAvailabilitySettings(db, organizationId, storeId)
  try {
    await assertVersion(current.version, input.version)
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return c.json(
        {
          error: error.code,
          currentVersion: error.currentVersion,
          expectedVersion: error.expectedVersion,
        },
        409,
      )
    }
    throw error
  }

  const version = nextVersion(current.version)
  const updatedAt = nowIso(requestClock(c))
  const persisted = AvailabilityStoreSettings.parse({ ...input, storeId, version })
  const operations = availabilitySettingsWriteOperations(
    db,
    organizationId,
    storeId,
    persisted,
    c.get('auth').sub,
    updatedAt,
    current.version,
    'store_override',
  )

  await writeAuditBatch(db, {
    clock: requestClock(c),
    operations,
    events: [
      {
        organizationId,
        storeId,
        actorType: 'user',
        actorId: c.get('auth').sub,
        action: 'availability.settings.updated',
        entityType: 'availability_settings',
        entityId: storeId,
        metadata: { fromVersion: current.version, toVersion: version },
      },
    ],
  })
  return c.json(persisted, 201)
}

async function readAvailabilityBookings(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
): Promise<AvailabilityBooking[]> {
  const rows = await db
    .select()
    .from(availabilityBookings)
    .where(
      and(
        eq(availabilityBookings.organizationId, organizationId),
        eq(availabilityBookings.storeId, storeId),
      ),
    )
  return rows.map((row) => {
    const purposeIds = parseJson(row.purposeIdsJson, 'booking purposes')
    const equipmentIds = parseJson(row.equipmentIdsJson, 'booking equipment')
    if (
      !Array.isArray(purposeIds) ||
      !purposeIds.every((value): value is string => typeof value === 'string')
    ) {
      throw new Error('invalid booking purpose ids')
    }
    if (
      !Array.isArray(equipmentIds) ||
      !equipmentIds.every((value): value is string => typeof value === 'string')
    ) {
      throw new Error('invalid booking equipment ids')
    }
    if (!['held', 'confirmed', 'checked_in', 'cancelled'].includes(row.status)) {
      throw new Error('invalid booking status')
    }
    return {
      id: row.id,
      startAt: row.startAt,
      endAt: row.endAt,
      purposeIds,
      equipmentIds,
      staffId: row.staffId,
      status: row.status as AvailabilityBooking['status'],
    }
  })
}

class SlotUnavailableError extends Error {
  constructor() {
    super('selected slot is no longer available')
    this.name = 'SlotUnavailableError'
  }
}

async function requestHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function reservationNumber(): string {
  return `EYEX-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
}

/** Normalize Japanese full-width digits/dashes and strip formatting before lookup. */
function normalizePhone(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[‐‑‒–—―ー]/g, '-')
    .replace(/[^0-9]/g, '')
}

function minuteClaims(startAt: string, endAt: string): string[] {
  const start = Date.parse(startAt)
  const end = Date.parse(endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start % 60_000 !== 0) {
    throw new RangeError('reservation interval must align to one minute')
  }
  const claims: string[] = []
  for (let instant = start; instant < end; instant += 60_000)
    claims.push(new Date(instant).toISOString())
  return claims
}

function isResourceClaimConflict(error: unknown): boolean {
  const message = String(error instanceof AuditAppendError ? error.cause : error)
  return message.includes('UNIQUE constraint failed: reservation_resource_allocations.')
}

function selectClaimUnit(
  resourceKind: 'equipment' | 'purpose',
  resourceId: string,
  /*
   * 設定から引いた収容数。割当は同じ設定から計算しているので、ここが未定義に
   * なるのは設定と割当が食い違っているとき、つまり呼び出し側の誤りである。
   * 黙って 1 とみなすと二重予約が通ってしまうので、その場で落とす。
   */
  capacity: number | undefined,
  claimSlots: readonly string[],
  occupied: ReadonlySet<string>,
): string {
  if (capacity === undefined)
    throw new Error(`${resourceKind} ${resourceId} は選択中店舗の設定に存在しない`)
  for (let unit = 0; unit < capacity; unit += 1) {
    const candidate = `${resourceId}:${unit}`
    if (
      claimSlots.every(
        (slotStartAt) => !occupied.has(`${resourceKind}|${candidate}|${slotStartAt}`),
      )
    )
      return candidate
  }
  throw new SlotUnavailableError()
}

/** Resolve one configured public or staff slot into the concrete claim units used by both confirmation paths. */
async function prepareReservationAllocation(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
  input: Pick<StaffReservationCreate, 'date' | 'startTime' | 'purposeIds'>,
  options?: Readonly<{ excludeReservationId?: string }>,
) {
  const settings = await readAvailabilitySettings(db, organizationId, storeId)
  const availabilityInput = {
    date: input.date,
    store: {
      receptionStatus: settings.receptionStatus,
      businessHours: settings.businessHours,
      exceptions: settings.exceptions,
    },
    purposes: settings.purposes,
    staff: settings.staff,
    shifts: settings.shifts,
    equipment: settings.equipment,
    maintenance: settings.maintenance,
    bookings: (await readAvailabilityBookings(db, organizationId, storeId)).filter(
      (booking) => booking.id !== options?.excludeReservationId,
    ),
  }
  const availability = calculateAvailability(availabilityInput, input.purposeIds)
  const selected = availability.slots.find((slot) => slot.startTime === input.startTime)
  if (!selected) throw new SlotUnavailableError()
  const allocation = selectAvailabilityAllocation(availabilityInput, input.purposeIds, selected)
  const claimSlots = minuteClaims(selected.startAt, selected.endAt)
  const existingClaims = await db
    .select({
      resourceKind: reservationResourceAllocations.resourceKind,
      resourceId: reservationResourceAllocations.resourceId,
      slotStartAt: reservationResourceAllocations.slotStartAt,
    })
    .from(reservationResourceAllocations)
    .where(
      and(
        eq(reservationResourceAllocations.organizationId, organizationId),
        eq(reservationResourceAllocations.storeId, storeId),
        ...(options?.excludeReservationId === undefined
          ? []
          : [ne(reservationResourceAllocations.reservationId, options.excludeReservationId)]),
      ),
    )
  const occupiedClaims = new Set(
    existingClaims.map((claim) => `${claim.resourceKind}|${claim.resourceId}|${claim.slotStartAt}`),
  )
  const equipmentResourceIds = allocation.equipmentIds.map((equipmentId) =>
    selectClaimUnit(
      'equipment',
      equipmentId,
      settings.equipment.find((candidate) => candidate.id === equipmentId)?.capacity,
      claimSlots,
      occupiedClaims,
    ),
  )
  const purposeResourceIds = input.purposeIds.map((purposeId) =>
    selectClaimUnit(
      'purpose',
      purposeId,
      settings.purposes.find((candidate) => candidate.id === purposeId)?.maxConcurrent,
      claimSlots,
      occupiedClaims,
    ),
  )
  return { settings, selected, allocation, claimSlots, equipmentResourceIds, purposeResourceIds }
}

async function retryableBeforeCommit<T>(execute: () => Promise<T>): Promise<T> {
  try {
    return await execute()
  } catch (error) {
    if (error instanceof SlotUnavailableError || error instanceof RangeError) {
      throw new RetryableIdempotencyError('reservation confirmation did not start a domain write')
    }
    throw error
  }
}

async function createStaffReservation(
  c: AppContext,
  storeId: string,
  input: StaffReservationCreate,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.write')
  if (denied) return denied
  const idempotencyKey = c.req.header('idempotency-key')?.trim()
  if (!idempotencyKey || idempotencyKey.length > 256) {
    return c.json({ error: 'idempotency_key_required' }, 400)
  }
  const normalizedCustomerPhone = normalizePhone(input.customer.phone)
  if (normalizedCustomerPhone.length < 7) {
    return c.json({ error: 'invalid_customer_phone' }, 400)
  }
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  try {
    const reservation = await withIdempotency(
      {
        db,
        organizationId,
        // The store is part of the idempotency operation scope. A retried
        // request can never replay a reservation from another store.
        operation: `staff_reservation_create:${storeId}`,
        key: idempotencyKey,
        requestHash: await requestHash(input),
        clock: requestClock(c),
      },
      async (completeInBatch) =>
        retryableBeforeCommit(async () => {
          const { selected, allocation, claimSlots, equipmentResourceIds, purposeResourceIds } =
            await prepareReservationAllocation(db, organizationId, storeId, input)
          const id = crypto.randomUUID()
          const createdAt = nowIso(requestClock(c))
          const record = Reservation.parse({
            id,
            organizationId,
            storeId,
            reservationNumber: reservationNumber(),
            source: 'staff',
            status: 'confirmed',
            startAt: selected.startAt,
            endAt: selected.endAt,
            purposeIds: input.purposeIds,
            customer: { ...input.customer, email: input.customer.email ?? null },
            recital: input.recital,
            reservationMemo: input.reservationMemo ?? null,
            handoffNote: input.handoffNote ?? null,
            version: 1,
            createdAt,
          })
          try {
            await writeAuditBatch(db, {
              clock: requestClock(c),
              operations: [
                db
                  .insert(customers)
                  .values({
                    id: crypto.randomUUID(),
                    organizationId,
                    primaryStoreId: storeId,
                    name: input.customer.name,
                    kana: input.customer.kana,
                    phoneNormalized: normalizedCustomerPhone,
                    email: input.customer.email ?? null,
                    visitCount: 1,
                    createdAt,
                    updatedAt: createdAt,
                  })
                  .onConflictDoUpdate({
                    target: [customers.organizationId, customers.phoneNormalized],
                    set: {
                      name: input.customer.name,
                      kana: input.customer.kana,
                      email: sql<string | null>`coalesce(excluded.email, ${customers.email})`,
                      visitCount: sql`${customers.visitCount} + 1`,
                      updatedAt: createdAt,
                    },
                  }),
                db.insert(reservations).select(
                  db
                    .select({
                      id: sql<string>`${record.id}`.as('id'),
                      organizationId: sql<string>`${organizationId}`.as('organizationId'),
                      storeId: sql<string>`${storeId}`.as('storeId'),
                      reservationNumber: sql<string>`${record.reservationNumber}`.as(
                        'reservationNumber',
                      ),
                      source: sql<string>`${record.source}`.as('source'),
                      status: sql<string>`${record.status}`.as('status'),
                      startAt: sql<string>`${record.startAt}`.as('startAt'),
                      endAt: sql<string>`${record.endAt}`.as('endAt'),
                      purposeIdsJson: sql<string>`${JSON.stringify(record.purposeIds)}`.as(
                        'purposeIdsJson',
                      ),
                      customerId: customers.id,
                      customerName: sql<string>`${record.customer.name}`.as('customerName'),
                      customerKana: sql<string>`${record.customer.kana}`.as('customerKana'),
                      customerPhone: sql<string>`${record.customer.phone}`.as('customerPhone'),
                      customerPhoneNormalized: sql<string>`${normalizedCustomerPhone}`.as(
                        'customerPhoneNormalized',
                      ),
                      customerEmail: sql<string | null>`${record.customer.email}`.as(
                        'customerEmail',
                      ),
                      recital: sql<string>`${record.recital}`.as('recital'),
                      reservationMemo: sql<string | null>`${record.reservationMemo}`.as(
                        'reservationMemo',
                      ),
                      handoffNote: sql<string | null>`${record.handoffNote}`.as('handoffNote'),
                      progress: sql<null>`null`.as('progress'),
                      waitStartedAt: sql<null>`null`.as('waitStartedAt'),
                      assignedStaffId: sql<null>`null`.as('assignedStaffId'),
                      assignedEquipmentIdsJson: sql<null>`null`.as('assignedEquipmentIdsJson'),
                      nextGuidance: sql<null>`null`.as('nextGuidance'),
                      progressOperationId: sql<null>`null`.as('progressOperationId'),
                      version: sql<number>`${record.version}`.as('version'),
                      createdAt: sql<string>`${record.createdAt}`.as('createdAt'),
                      updatedAt: sql<string>`${record.createdAt}`.as('updatedAt'),
                    })
                    .from(customers)
                    .where(
                      and(
                        eq(customers.organizationId, organizationId),
                        eq(customers.phoneNormalized, normalizedCustomerPhone),
                      ),
                    ),
                ),
                db.insert(availabilityBookings).values({
                  id: record.id,
                  organizationId,
                  storeId,
                  startAt: record.startAt,
                  endAt: record.endAt,
                  purposeIdsJson: JSON.stringify(record.purposeIds),
                  staffId: allocation.staffId,
                  equipmentIdsJson: JSON.stringify(allocation.equipmentIds),
                  status: 'confirmed',
                }),
                completeInBatch(record),
                ...[
                  ...claimSlots.map((slotStartAt) => ({
                    id: crypto.randomUUID(),
                    organizationId,
                    storeId,
                    reservationId: record.id,
                    resourceKind: 'staff',
                    resourceId: allocation.staffId,
                    slotStartAt,
                  })),
                  ...equipmentResourceIds.flatMap((resourceId) =>
                    claimSlots.map((slotStartAt) => ({
                      id: crypto.randomUUID(),
                      organizationId,
                      storeId,
                      reservationId: record.id,
                      resourceKind: 'equipment',
                      resourceId,
                      slotStartAt,
                    })),
                  ),
                  ...purposeResourceIds.flatMap((resourceId) =>
                    claimSlots.map((slotStartAt) => ({
                      id: crypto.randomUUID(),
                      organizationId,
                      storeId,
                      reservationId: record.id,
                      resourceKind: 'purpose',
                      resourceId,
                      slotStartAt,
                    })),
                  ),
                ].map((claim) => db.insert(reservationResourceAllocations).values(claim)),
              ],
              events: [
                {
                  organizationId,
                  storeId,
                  actorType: 'user',
                  actorId: c.get('auth').sub,
                  action: 'reservation.created',
                  entityType: 'reservation',
                  entityId: record.id,
                  metadata: {
                    source: 'staff',
                    reservationNumber: record.reservationNumber,
                    purposeCount: record.purposeIds.length,
                  },
                },
              ],
            })
          } catch (error) {
            if (isResourceClaimConflict(error)) {
              throw new RetryableIdempotencyError('reservation confirmation batch rolled back')
            }
            throw error
          }
          return record
        }),
    )
    return c.json(Reservation.parse(reservation), 201)
  } catch (error) {
    if (
      error instanceof SlotUnavailableError ||
      error instanceof RangeError ||
      error instanceof RetryableIdempotencyError
    ) {
      return c.json({ error: 'slot_unavailable' }, 409)
    }
    if (error instanceof IdempotencyConflictError || error instanceof IdempotencyInProgressError) {
      return c.json({ error: error.code }, error.status)
    }
    throw error
  }
}

function reservationFromRow(row: typeof reservations.$inferSelect) {
  return Reservation.parse({
    id: row.id,
    organizationId: row.organizationId,
    storeId: row.storeId,
    reservationNumber: row.reservationNumber,
    source: row.source,
    status: row.status,
    startAt: row.startAt,
    endAt: row.endAt,
    purposeIds: JSON.parse(row.purposeIdsJson),
    customer: {
      name: row.customerName,
      kana: row.customerKana,
      phone: row.customerPhone,
      email: row.customerEmail,
    },
    recital: row.recital,
    reservationMemo: row.reservationMemo,
    handoffNote: row.handoffNote,
    version: row.version,
    createdAt: row.createdAt,
  })
}

async function searchReservations(
  c: AppContext,
  storeId: string,
  input: ReservationSearchQuery,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.read')
  if (denied) return denied
  const normalizedPhone = input.phone === undefined ? undefined : normalizePhone(input.phone)
  if (normalizedPhone !== undefined && normalizedPhone.length < 7) {
    return c.json({ error: 'invalid_reservation_phone' }, 400)
  }
  const conditions = [
    eq(reservations.organizationId, c.get('auth').org),
    eq(reservations.storeId, storeId),
    ...(input.name === undefined ? [] : [like(reservations.customerName, `%${input.name}%`)]),
    ...(input.kana === undefined ? [] : [like(reservations.customerKana, `%${input.kana}%`)]),
    ...(normalizedPhone === undefined
      ? []
      : [like(reservations.customerPhoneNormalized, `%${normalizedPhone}%`)]),
    ...(input.reservationNumber === undefined
      ? []
      : [eq(reservations.reservationNumber, input.reservationNumber)]),
    ...(input.source === undefined ? [] : [eq(reservations.source, input.source)]),
    ...(input.status === undefined ? [] : [eq(reservations.status, input.status)]),
    ...(input.dateFrom === undefined
      ? []
      : [gte(reservations.startAt, jstDayBounds(input.dateFrom).startAt)]),
    ...(input.dateTo === undefined
      ? []
      : [lt(reservations.startAt, jstDayBounds(input.dateTo).endAt)]),
  ]
  const rows = await drizzle(c.env.DB)
    .select()
    .from(reservations)
    .where(and(...conditions))
    .orderBy(asc(reservations.startAt))
    .limit(100)
  return c.json(Reservation.array().parse(rows.map(reservationFromRow)))
}

async function readReservation(
  c: AppContext,
  storeId: string,
  reservationId: string,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.read')
  if (denied) return denied
  const row = (
    await drizzle(c.env.DB)
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.organizationId, c.get('auth').org),
          eq(reservations.storeId, storeId),
          eq(reservations.id, reservationId),
        ),
      )
  )[0]
  if (!row) return c.json({ error: 'forbidden' }, 403)
  return c.json(reservationFromRow(row))
}

async function readReservationChangeHistory(
  c: AppContext,
  storeId: string,
  reservationId: string,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.read')
  if (denied) return denied
  const rows = await drizzle(c.env.DB)
    .select()
    .from(reservationChanges)
    .where(
      and(
        eq(reservationChanges.organizationId, c.get('auth').org),
        eq(reservationChanges.storeId, storeId),
        eq(reservationChanges.reservationId, reservationId),
      ),
    )
    .orderBy(asc(reservationChanges.occurredAt))
  return c.json(
    ReservationChangeHistoryEntry.array().parse(
      rows.map((row) => ({
        id: row.id,
        reservationId: row.reservationId,
        action: row.action,
        reason: row.reason,
        before: JSON.parse(row.beforeJson),
        after: JSON.parse(row.afterJson),
        actorId: row.actorId,
        occurredAt: row.occurredAt,
      })),
    ),
  )
}

function reservationChangeSnapshot(row: typeof reservations.$inferSelect) {
  return JSON.stringify({
    status: row.status,
    startAt: row.startAt,
    endAt: row.endAt,
    purposeIds: JSON.parse(row.purposeIdsJson),
    version: row.version,
  })
}

async function cancelReservation(
  c: AppContext,
  storeId: string,
  reservationId: string,
  input: ReservationCancelInput,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.write')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const idempotencyKey = c.req.header('idempotency-key')?.trim()
  let idempotencyRecordId: string | undefined
  let releaseIdempotency: (() => Promise<void>) | undefined
  if (idempotencyKey) {
    if (idempotencyKey.length > 256) return c.json({ error: 'invalid_idempotency_key' }, 400)
    const requestHashValue = await requestHash({ reservationId, input })
    const candidateId = crypto.randomUUID()
    const createdAt = nowIso(requestClock(c))
    await db
      .insert(idempotencyRecords)
      .values({
        id: candidateId,
        organizationId: c.get('auth').org,
        operation: `reservation_cancel:${storeId}`,
        key: idempotencyKey,
        requestHash: requestHashValue,
        status: 'in_progress',
        resultJson: null,
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString(),
      })
      .onConflictDoNothing({
        target: [
          idempotencyRecords.organizationId,
          idempotencyRecords.operation,
          idempotencyRecords.key,
        ],
      })
      .run()
    const record = (
      await db
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.organizationId, c.get('auth').org),
            eq(idempotencyRecords.operation, `reservation_cancel:${storeId}`),
            eq(idempotencyRecords.key, idempotencyKey),
          ),
        )
    )[0]
    if (!record) throw new Error('idempotency record disappeared')
    if (record.requestHash !== requestHashValue)
      return c.json({ error: 'idempotency_conflict' }, 409)
    if (record.status === 'completed') {
      if (record.resultJson === null) throw new Error('completed idempotency record has no result')
      return c.json(Reservation.parse(JSON.parse(record.resultJson)))
    }
    if (record.id !== candidateId) return c.json({ error: 'idempotency_in_progress' }, 409)
    idempotencyRecordId = record.id
    releaseIdempotency = async () => {
      await db
        .delete(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.id, record.id),
            eq(idempotencyRecords.organizationId, c.get('auth').org),
            eq(idempotencyRecords.status, 'in_progress'),
          ),
        )
        .run()
    }
  }
  const current = (
    await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.organizationId, c.get('auth').org),
          eq(reservations.storeId, storeId),
          eq(reservations.id, reservationId),
        ),
      )
  )[0]
  if (!current) {
    await releaseIdempotency?.()
    return c.json({ error: 'forbidden' }, 403)
  }
  if (current.version !== input.version) {
    await releaseIdempotency?.()
    return c.json({ error: 'version_conflict', currentVersion: current.version }, 409)
  }
  if (current.status === 'cancelled') {
    await releaseIdempotency?.()
    return c.json({ error: 'reservation_already_cancelled', currentVersion: current.version }, 409)
  }
  if (current.status === 'no_show') {
    await releaseIdempotency?.()
    return c.json({ error: 'reservation_no_show', currentVersion: current.version }, 409)
  }
  if (input.confirmation !== current.reservationNumber) {
    await releaseIdempotency?.()
    return c.json({ error: 'invalid_cancellation_confirmation' }, 400)
  }
  const updatedAt = nowIso(requestClock(c))
  const requestId = crypto.randomUUID()
  const next = { ...current, status: 'cancelled' as const, version: current.version + 1, updatedAt }
  const operationId = crypto.randomUUID()
  const applied = and(
    eq(reservations.organizationId, c.get('auth').org),
    eq(reservations.storeId, storeId),
    eq(reservations.id, reservationId),
    eq(reservations.version, next.version),
    eq(reservations.progressOperationId, operationId),
  )
  let batchResults: Awaited<ReturnType<typeof db.batch>>
  try {
    batchResults = await db.batch([
      db
        .update(reservations)
        .set({
          status: next.status,
          version: next.version,
          updatedAt,
          progressOperationId: operationId,
        })
        .where(
          and(
            eq(reservations.organizationId, c.get('auth').org),
            eq(reservations.storeId, storeId),
            eq(reservations.id, reservationId),
            eq(reservations.version, input.version),
            sql`exists (select 1 from ${availabilityBookings} where ${availabilityBookings.organizationId} = ${c.get('auth').org} and ${availabilityBookings.storeId} = ${storeId} and ${availabilityBookings.id} = ${reservationId})`,
          ),
        ),
      db
        .delete(reservationResourceAllocations)
        .where(
          and(
            eq(reservationResourceAllocations.organizationId, c.get('auth').org),
            eq(reservationResourceAllocations.storeId, storeId),
            eq(reservationResourceAllocations.reservationId, reservationId),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${c.get('auth').org} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.progressOperationId} = ${operationId} and ${reservations.version} = ${next.version})`,
          ),
        ),
      db
        .update(availabilityBookings)
        .set({ status: 'cancelled' })
        .where(
          and(
            eq(availabilityBookings.organizationId, c.get('auth').org),
            eq(availabilityBookings.storeId, storeId),
            eq(availabilityBookings.id, reservationId),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${c.get('auth').org} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.progressOperationId} = ${operationId} and ${reservations.version} = ${next.version})`,
          ),
        ),
      db
        .update(webBookingManagementCodeIssues)
        .set({ revokedAt: updatedAt })
        .where(
          and(
            eq(webBookingManagementCodeIssues.organizationId, c.get('auth').org),
            eq(webBookingManagementCodeIssues.storeId, storeId),
            eq(webBookingManagementCodeIssues.reservationId, reservationId),
            isNull(webBookingManagementCodeIssues.revokedAt),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${c.get('auth').org} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.progressOperationId} = ${operationId} and ${reservations.version} = ${next.version})`,
          ),
        ),
      db
        .delete(webBookingVerifiedSessions)
        .where(
          and(
            eq(webBookingVerifiedSessions.organizationId, c.get('auth').org),
            eq(webBookingVerifiedSessions.storeId, storeId),
            eq(webBookingVerifiedSessions.reservationId, reservationId),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${c.get('auth').org} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.progressOperationId} = ${operationId} and ${reservations.version} = ${next.version})`,
          ),
        ),
      db.insert(reservationChanges).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as('id'),
            organizationId: reservations.organizationId,
            storeId: reservations.storeId,
            reservationId: reservations.id,
            action: sql<string>`'cancelled'`.as('action'),
            reason: sql<string>`${input.reason}`.as('reason'),
            beforeJson: sql<string>`${reservationChangeSnapshot(current)}`.as('beforeJson'),
            afterJson: sql<string>`${reservationChangeSnapshot(next)}`.as('afterJson'),
            actorId: sql<string>`${c.get('auth').sub}`.as('actorId'),
            occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
          })
          .from(reservations)
          .where(applied),
      ),
      db.insert(auditEvents).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as('id'),
            organizationId: reservations.organizationId,
            storeId: reservations.storeId,
            actorType: sql<string>`'user'`.as('actorType'),
            actorId: sql<string>`${c.get('auth').sub}`.as('actorId'),
            action: sql<string>`'reservation.cancelled'`.as('action'),
            entityType: sql<string>`'reservation'`.as('entityType'),
            entityId: reservations.id,
            requestId: sql<string>`${requestId}`.as('requestId'),
            metadata: sql<string>`${JSON.stringify({ version: next.version })}`.as('metadata'),
            occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
          })
          .from(reservations)
          .where(applied),
      ),
      ...(idempotencyRecordId === undefined
        ? []
        : [
            db
              .update(idempotencyRecords)
              .set({
                status: 'completed',
                resultJson: JSON.stringify(reservationFromRow(next)),
              })
              .where(
                and(
                  eq(idempotencyRecords.id, idempotencyRecordId),
                  eq(idempotencyRecords.status, 'in_progress'),
                  sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${c.get('auth').org} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.progressOperationId} = ${operationId} and ${reservations.version} = ${next.version})`,
                ),
              ),
          ]),
    ])
  } catch (error) {
    // A transport/D1 batch error can arrive after commit. Keep the claim
    // fail-closed so a retry cannot execute a second lifecycle operation.
    console.error('reservation cancellation batch failed after idempotency claim', error)
    throw error
  }
  if (!batchStatementChanged(batchResults[0])) {
    const projection = (
      await db
        .select({ id: availabilityBookings.id })
        .from(availabilityBookings)
        .where(
          and(
            eq(availabilityBookings.organizationId, c.get('auth').org),
            eq(availabilityBookings.storeId, storeId),
            eq(availabilityBookings.id, reservationId),
          ),
        )
    )[0]
    if (!projection) {
      await releaseIdempotency?.()
      return c.json({ error: 'reservation_projection_missing' }, 409)
    }
    const latest = (
      await db
        .select({ version: reservations.version })
        .from(reservations)
        .where(
          and(
            eq(reservations.organizationId, c.get('auth').org),
            eq(reservations.storeId, storeId),
            eq(reservations.id, reservationId),
          ),
        )
    )[0]
    await releaseIdempotency?.()
    return c.json(
      { error: 'version_conflict', currentVersion: latest?.version ?? current.version },
      409,
    )
  }
  return c.json(reservationFromRow(next))
}

/**
 * Record that a confirmed reservation was not attended.
 *
 * The reservation row is the CAS anchor for this operation.  Every dependent
 * write is selected through the operation token written by that update, so a
 * concurrent lifecycle/progress write cannot append a detached history or
 * audit row.  The projection and resource claims are released in the same D1
 * batch as the status change.
 */
async function markReservationNoShow(
  c: AppContext,
  storeId: string,
  reservationId: string,
  input: ReservationNoShowInput,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.write')
  if (denied) return denied
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const idempotencyKey = c.req.header('idempotency-key')?.trim()
  let idempotencyRecordId: string | undefined
  let releaseIdempotency: (() => Promise<void>) | undefined
  if (idempotencyKey) {
    if (idempotencyKey.length > 256) return c.json({ error: 'invalid_idempotency_key' }, 400)
    const requestHashValue = await requestHash({ reservationId, input })
    const candidateId = crypto.randomUUID()
    const createdAt = nowIso(requestClock(c))
    await db
      .insert(idempotencyRecords)
      .values({
        id: candidateId,
        organizationId,
        operation: `reservation_no_show:${storeId}`,
        key: idempotencyKey,
        requestHash: requestHashValue,
        status: 'in_progress',
        resultJson: null,
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString(),
      })
      .onConflictDoNothing({
        target: [
          idempotencyRecords.organizationId,
          idempotencyRecords.operation,
          idempotencyRecords.key,
        ],
      })
      .run()
    const record = (
      await db
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.organizationId, organizationId),
            eq(idempotencyRecords.operation, `reservation_no_show:${storeId}`),
            eq(idempotencyRecords.key, idempotencyKey),
          ),
        )
    )[0]
    if (!record) throw new Error('idempotency record disappeared')
    if (record.requestHash !== requestHashValue)
      return c.json({ error: 'idempotency_conflict' }, 409)
    if (record.status === 'completed') {
      if (record.resultJson === null) throw new Error('completed idempotency record has no result')
      return c.json(Reservation.parse(JSON.parse(record.resultJson)))
    }
    if (record.id !== candidateId) return c.json({ error: 'idempotency_in_progress' }, 409)
    idempotencyRecordId = record.id
    releaseIdempotency = async () => {
      await db
        .delete(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.id, record.id),
            eq(idempotencyRecords.organizationId, organizationId),
            eq(idempotencyRecords.status, 'in_progress'),
          ),
        )
        .run()
    }
  }
  const current = (
    await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.organizationId, organizationId),
          eq(reservations.storeId, storeId),
          eq(reservations.id, reservationId),
        ),
      )
  )[0]
  if (!current) {
    await releaseIdempotency?.()
    return c.json({ error: 'forbidden' }, 403)
  }
  if (current.version !== input.version) {
    await releaseIdempotency?.()
    return c.json({ error: 'version_conflict', currentVersion: current.version }, 409)
  }
  if (current.status !== 'confirmed') {
    await releaseIdempotency?.()
    return c.json(
      {
        error: 'invalid_no_show_transition',
        currentStatus: current.status,
        currentVersion: current.version,
      },
      409,
    )
  }

  const updatedAt = nowIso(requestClock(c))
  const operationId = crypto.randomUUID()
  const requestId = crypto.randomUUID()
  const next = {
    ...current,
    status: 'no_show' as const,
    version: current.version + 1,
    updatedAt,
    progressOperationId: operationId,
  }
  const applied = and(
    eq(reservations.organizationId, organizationId),
    eq(reservations.storeId, storeId),
    eq(reservations.id, reservationId),
    eq(reservations.version, next.version),
    eq(reservations.progressOperationId, operationId),
  )

  let batchResults: Awaited<ReturnType<typeof db.batch>>
  try {
    batchResults = await db.batch([
      db
        .update(reservations)
        .set({
          status: next.status,
          version: next.version,
          updatedAt,
          progressOperationId: operationId,
        })
        .where(
          and(
            eq(reservations.organizationId, organizationId),
            eq(reservations.storeId, storeId),
            eq(reservations.id, reservationId),
            eq(reservations.version, input.version),
            eq(reservations.status, 'confirmed'),
            sql`exists (select 1 from ${availabilityBookings} where ${availabilityBookings.organizationId} = ${organizationId} and ${availabilityBookings.storeId} = ${storeId} and ${availabilityBookings.id} = ${reservationId})`,
          ),
        ),
      db
        .delete(reservationResourceAllocations)
        .where(
          and(
            eq(reservationResourceAllocations.organizationId, organizationId),
            eq(reservationResourceAllocations.storeId, storeId),
            eq(reservationResourceAllocations.reservationId, reservationId),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${organizationId} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${next.version} and ${reservations.progressOperationId} = ${operationId})`,
          ),
        ),
      db
        .update(availabilityBookings)
        .set({ status: 'cancelled' })
        .where(
          and(
            eq(availabilityBookings.organizationId, organizationId),
            eq(availabilityBookings.storeId, storeId),
            eq(availabilityBookings.id, reservationId),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${organizationId} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${next.version} and ${reservations.progressOperationId} = ${operationId})`,
          ),
        ),
      db
        .update(webBookingManagementCodeIssues)
        .set({ revokedAt: updatedAt })
        .where(
          and(
            eq(webBookingManagementCodeIssues.organizationId, organizationId),
            eq(webBookingManagementCodeIssues.storeId, storeId),
            eq(webBookingManagementCodeIssues.reservationId, reservationId),
            isNull(webBookingManagementCodeIssues.revokedAt),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${organizationId} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${next.version} and ${reservations.progressOperationId} = ${operationId})`,
          ),
        ),
      db
        .delete(webBookingVerifiedSessions)
        .where(
          and(
            eq(webBookingVerifiedSessions.organizationId, organizationId),
            eq(webBookingVerifiedSessions.storeId, storeId),
            eq(webBookingVerifiedSessions.reservationId, reservationId),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${organizationId} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${next.version} and ${reservations.progressOperationId} = ${operationId})`,
          ),
        ),
      db.insert(reservationChanges).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as('id'),
            organizationId: reservations.organizationId,
            storeId: reservations.storeId,
            reservationId: reservations.id,
            action: sql<string>`'no_show'`.as('action'),
            reason: sql<string | null>`NULL`.as('reason'),
            beforeJson: sql<string>`${reservationChangeSnapshot(current)}`.as('beforeJson'),
            afterJson: sql<string>`${reservationChangeSnapshot(next)}`.as('afterJson'),
            actorId: sql<string>`${c.get('auth').sub}`.as('actorId'),
            occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
          })
          .from(reservations)
          .where(applied),
      ),
      db.insert(auditEvents).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as('id'),
            organizationId: reservations.organizationId,
            storeId: reservations.storeId,
            actorType: sql<string>`'user'`.as('actorType'),
            actorId: sql<string>`${c.get('auth').sub}`.as('actorId'),
            action: sql<string>`'reservation.no_show'`.as('action'),
            entityType: sql<string>`'reservation'`.as('entityType'),
            entityId: reservations.id,
            requestId: sql<string>`${requestId}`.as('requestId'),
            metadata: sql<string>`${JSON.stringify({ version: next.version })}`.as('metadata'),
            occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
          })
          .from(reservations)
          .where(applied),
      ),
      ...(idempotencyRecordId === undefined
        ? []
        : [
            db
              .update(idempotencyRecords)
              .set({
                status: 'completed',
                resultJson: JSON.stringify(reservationFromRow(next)),
              })
              .where(
                and(
                  eq(idempotencyRecords.id, idempotencyRecordId),
                  eq(idempotencyRecords.status, 'in_progress'),
                  sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${organizationId} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.progressOperationId} = ${operationId} and ${reservations.version} = ${next.version})`,
                ),
              ),
          ]),
    ])
  } catch (error) {
    // A transport/D1 batch error can arrive after commit. Keep the claim
    // fail-closed so a retry cannot execute a second lifecycle operation.
    console.error('reservation no-show batch failed after idempotency claim', error)
    throw error
  }

  if (!batchStatementChanged(batchResults[0])) {
    const latest = (
      await db
        .select({ status: reservations.status, version: reservations.version })
        .from(reservations)
        .where(
          and(
            eq(reservations.organizationId, organizationId),
            eq(reservations.storeId, storeId),
            eq(reservations.id, reservationId),
          ),
        )
    )[0]
    if (!latest) {
      await releaseIdempotency?.()
      return c.json({ error: 'forbidden' }, 403)
    }
    if (latest.status !== 'confirmed') {
      await releaseIdempotency?.()
      return c.json(
        {
          error: 'invalid_no_show_transition',
          currentStatus: latest.status,
          currentVersion: latest.version,
        },
        409,
      )
    }
    const projection = (
      await db
        .select({ id: availabilityBookings.id })
        .from(availabilityBookings)
        .where(
          and(
            eq(availabilityBookings.organizationId, organizationId),
            eq(availabilityBookings.storeId, storeId),
            eq(availabilityBookings.id, reservationId),
          ),
        )
    )[0]
    if (!projection) {
      await releaseIdempotency?.()
      return c.json({ error: 'reservation_projection_missing' }, 409)
    }
    await releaseIdempotency?.()
    return c.json({ error: 'version_conflict', currentVersion: latest.version }, 409)
  }

  return c.json(reservationFromRow(next))
}

async function changeReservation(
  c: AppContext,
  storeId: string,
  reservationId: string,
  input: ReservationChangeInput,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.write')
  if (denied) return denied
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const idempotencyKey = c.req.header('idempotency-key')?.trim()
  let idempotencyRecordId: string | undefined
  let releaseIdempotency: (() => Promise<void>) | undefined
  if (idempotencyKey) {
    if (idempotencyKey.length > 256) return c.json({ error: 'invalid_idempotency_key' }, 400)
    const requestHashValue = await requestHash({ reservationId, input })
    const candidateId = crypto.randomUUID()
    const createdAt = nowIso(requestClock(c))
    await db
      .insert(idempotencyRecords)
      .values({
        id: candidateId,
        organizationId,
        operation: `reservation_change:${storeId}`,
        key: idempotencyKey,
        requestHash: requestHashValue,
        status: 'in_progress',
        resultJson: null,
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1000).toISOString(),
      })
      .onConflictDoNothing({
        target: [
          idempotencyRecords.organizationId,
          idempotencyRecords.operation,
          idempotencyRecords.key,
        ],
      })
      .run()
    const record = (
      await db
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.organizationId, organizationId),
            eq(idempotencyRecords.operation, `reservation_change:${storeId}`),
            eq(idempotencyRecords.key, idempotencyKey),
          ),
        )
    )[0]
    if (!record) throw new Error('idempotency record disappeared')
    if (record.requestHash !== requestHashValue)
      return c.json({ error: 'idempotency_conflict' }, 409)
    if (record.status === 'completed') {
      if (record.resultJson === null) throw new Error('completed idempotency record has no result')
      return c.json(Reservation.parse(JSON.parse(record.resultJson)))
    }
    if (record.id !== candidateId) return c.json({ error: 'idempotency_in_progress' }, 409)
    idempotencyRecordId = record.id
    releaseIdempotency = async () => {
      await db
        .delete(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.id, record.id),
            eq(idempotencyRecords.organizationId, organizationId),
            eq(idempotencyRecords.status, 'in_progress'),
          ),
        )
        .run()
    }
  }
  const current = (
    await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.organizationId, organizationId),
          eq(reservations.storeId, storeId),
          eq(reservations.id, reservationId),
        ),
      )
  )[0]
  if (!current) {
    await releaseIdempotency?.()
    return c.json({ error: 'forbidden' }, 403)
  }
  if (current.version !== input.version) {
    await releaseIdempotency?.()
    return c.json({ error: 'version_conflict', currentVersion: current.version }, 409)
  }
  if (current.status === 'cancelled') {
    await releaseIdempotency?.()
    return c.json({ error: 'reservation_already_cancelled', currentVersion: current.version }, 409)
  }
  if (current.status === 'no_show') {
    await releaseIdempotency?.()
    return c.json({ error: 'reservation_no_show', currentVersion: current.version }, 409)
  }
  try {
    const settings = await readAvailabilitySettings(db, organizationId, storeId)
    const availabilityInput = {
      date: input.date,
      store: {
        receptionStatus: settings.receptionStatus,
        businessHours: settings.businessHours,
        exceptions: settings.exceptions,
      },
      purposes: settings.purposes,
      staff: settings.staff,
      shifts: settings.shifts,
      equipment: settings.equipment,
      maintenance: settings.maintenance,
      bookings: (await readAvailabilityBookings(db, organizationId, storeId)).filter(
        (booking) => booking.id !== reservationId,
      ),
    }
    const availability = calculateAvailability(availabilityInput, input.purposeIds)
    const selected = availability.slots.find((slot) => slot.startTime === input.startTime)
    if (!selected) throw new SlotUnavailableError()
    const allocation = selectAvailabilityAllocation(availabilityInput, input.purposeIds, selected)
    const claimSlots = minuteClaims(selected.startAt, selected.endAt)
    const existingClaims = await db
      .select({
        resourceKind: reservationResourceAllocations.resourceKind,
        resourceId: reservationResourceAllocations.resourceId,
        slotStartAt: reservationResourceAllocations.slotStartAt,
      })
      .from(reservationResourceAllocations)
      .where(
        and(
          eq(reservationResourceAllocations.organizationId, organizationId),
          eq(reservationResourceAllocations.storeId, storeId),
          ne(reservationResourceAllocations.reservationId, reservationId),
        ),
      )
    const occupiedClaims = new Set(
      existingClaims.map(
        (claim) => `${claim.resourceKind}|${claim.resourceId}|${claim.slotStartAt}`,
      ),
    )
    const equipmentResourceIds = allocation.equipmentIds.map((equipmentId) => {
      const equipment = settings.equipment.find((candidate) => candidate.id === equipmentId)
      return selectClaimUnit(
        'equipment',
        equipmentId,
        equipment?.capacity,
        claimSlots,
        occupiedClaims,
      )
    })
    const purposeResourceIds = input.purposeIds.map((purposeId) => {
      const purpose = settings.purposes.find((candidate) => candidate.id === purposeId)
      return selectClaimUnit(
        'purpose',
        purposeId,
        purpose?.maxConcurrent,
        claimSlots,
        occupiedClaims,
      )
    })
    const updatedAt = nowIso(requestClock(c))
    const requestId = crypto.randomUUID()
    const version = current.version + 1
    const operationId = crypto.randomUUID()
    const next = {
      ...current,
      startAt: selected.startAt,
      endAt: selected.endAt,
      purposeIdsJson: JSON.stringify(input.purposeIds),
      version,
      updatedAt,
      progressOperationId: operationId,
    }
    const applied = and(
      eq(reservations.organizationId, organizationId),
      eq(reservations.storeId, storeId),
      eq(reservations.id, reservationId),
      eq(reservations.version, version),
      eq(reservations.progressOperationId, operationId),
    )
    const claims = [
      ...claimSlots.map((slotStartAt) => ({
        resourceKind: 'staff',
        resourceId: allocation.staffId,
        slotStartAt,
      })),
      ...equipmentResourceIds.flatMap((resourceId) =>
        claimSlots.map((slotStartAt) => ({ resourceKind: 'equipment', resourceId, slotStartAt })),
      ),
      ...purposeResourceIds.flatMap((resourceId) =>
        claimSlots.map((slotStartAt) => ({ resourceKind: 'purpose', resourceId, slotStartAt })),
      ),
    ] as const
    const results = await db.batch([
      db
        .update(reservations)
        .set({
          startAt: next.startAt,
          endAt: next.endAt,
          purposeIdsJson: next.purposeIdsJson,
          version,
          updatedAt,
          progressOperationId: operationId,
        })
        .where(
          and(
            eq(reservations.organizationId, organizationId),
            eq(reservations.storeId, storeId),
            eq(reservations.id, reservationId),
            eq(reservations.version, input.version),
            sql`exists (select 1 from ${availabilityBookings} where ${availabilityBookings.organizationId} = ${organizationId} and ${availabilityBookings.storeId} = ${storeId} and ${availabilityBookings.id} = ${reservationId})`,
          ),
        ),
      db
        .delete(reservationResourceAllocations)
        .where(
          and(
            eq(reservationResourceAllocations.organizationId, organizationId),
            eq(reservationResourceAllocations.storeId, storeId),
            eq(reservationResourceAllocations.reservationId, reservationId),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${organizationId} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${version} and ${reservations.progressOperationId} = ${operationId})`,
          ),
        ),
      db
        .update(availabilityBookings)
        .set({
          startAt: next.startAt,
          endAt: next.endAt,
          purposeIdsJson: next.purposeIdsJson,
          staffId: allocation.staffId,
          equipmentIdsJson: JSON.stringify(allocation.equipmentIds),
        })
        .where(
          and(
            eq(availabilityBookings.organizationId, organizationId),
            eq(availabilityBookings.storeId, storeId),
            eq(availabilityBookings.id, reservationId),
            sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${organizationId} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${version} and ${reservations.progressOperationId} = ${operationId})`,
          ),
        ),
      ...claims.map((claim) =>
        db.insert(reservationResourceAllocations).select(
          db
            .select({
              id: sql<string>`${crypto.randomUUID()}`.as('id'),
              organizationId: reservations.organizationId,
              storeId: reservations.storeId,
              reservationId: reservations.id,
              resourceKind: sql<string>`${claim.resourceKind}`.as('resourceKind'),
              resourceId: sql<string>`${claim.resourceId}`.as('resourceId'),
              slotStartAt: sql<string>`${claim.slotStartAt}`.as('slotStartAt'),
            })
            .from(reservations)
            .where(applied),
        ),
      ),
      db.insert(reservationChanges).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as('id'),
            organizationId: reservations.organizationId,
            storeId: reservations.storeId,
            reservationId: reservations.id,
            action: sql<string>`'changed'`.as('action'),
            reason: sql<string>`${input.reason}`.as('reason'),
            beforeJson: sql<string>`${reservationChangeSnapshot(current)}`.as('beforeJson'),
            afterJson: sql<string>`${reservationChangeSnapshot(next)}`.as('afterJson'),
            actorId: sql<string>`${c.get('auth').sub}`.as('actorId'),
            occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
          })
          .from(reservations)
          .where(applied),
      ),
      db.insert(auditEvents).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as('id'),
            organizationId: reservations.organizationId,
            storeId: reservations.storeId,
            actorType: sql<string>`'user'`.as('actorType'),
            actorId: sql<string>`${c.get('auth').sub}`.as('actorId'),
            action: sql<string>`'reservation.changed'`.as('action'),
            entityType: sql<string>`'reservation'`.as('entityType'),
            entityId: reservations.id,
            requestId: sql<string>`${requestId}`.as('requestId'),
            metadata: sql<string>`${JSON.stringify({ version })}`.as('metadata'),
            occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
          })
          .from(reservations)
          .where(applied),
      ),
      ...(idempotencyRecordId === undefined
        ? []
        : [
            db
              .update(idempotencyRecords)
              .set({
                status: 'completed',
                resultJson: JSON.stringify(reservationFromRow(next)),
              })
              .where(
                and(
                  eq(idempotencyRecords.id, idempotencyRecordId),
                  eq(idempotencyRecords.status, 'in_progress'),
                  sql`exists (select 1 from ${reservations} where ${reservations.organizationId} = ${organizationId} and ${reservations.storeId} = ${storeId} and ${reservations.id} = ${reservationId} and ${reservations.version} = ${version} and ${reservations.progressOperationId} = ${operationId})`,
                ),
              ),
          ]),
    ])
    if (!batchStatementChanged(results[0])) {
      const projection = (
        await db
          .select({ id: availabilityBookings.id })
          .from(availabilityBookings)
          .where(
            and(
              eq(availabilityBookings.organizationId, organizationId),
              eq(availabilityBookings.storeId, storeId),
              eq(availabilityBookings.id, reservationId),
            ),
          )
      )[0]
      if (!projection) {
        await releaseIdempotency?.()
        return c.json({ error: 'reservation_projection_missing' }, 409)
      }
      const latest = (
        await db
          .select({ version: reservations.version })
          .from(reservations)
          .where(
            and(
              eq(reservations.organizationId, organizationId),
              eq(reservations.storeId, storeId),
              eq(reservations.id, reservationId),
            ),
          )
      )[0]
      await releaseIdempotency?.()
      return c.json(
        { error: 'version_conflict', currentVersion: latest?.version ?? current.version },
        409,
      )
    }
    return c.json(reservationFromRow(next))
  } catch (error) {
    // A transport/D1 batch error can arrive after commit. Keep the claim
    // fail-closed so a retry cannot execute a second lifecycle operation.
    if (
      error instanceof SlotUnavailableError ||
      error instanceof RangeError ||
      isResourceClaimConflict(error)
    ) {
      // These are locally proven pre-commit availability failures (or a D1
      // uniqueness rollback), so no lifecycle side effect can have committed.
      await releaseIdempotency?.()
      return c.json({ error: 'slot_unavailable' }, 409)
    }
    throw error
  }
}

async function findCustomerCandidates(
  c: AppContext,
  storeId: string,
  input: CustomerSearchQuery,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'customer.read')
  if (denied) return denied
  const term =
    input.phone === undefined ? (input.name ?? input.kana ?? '') : normalizePhone(input.phone)
  if (term.length === 0) return c.json([])
  const match =
    input.phone !== undefined
      ? like(customers.phoneNormalized, `${term}%`)
      : input.name !== undefined
        ? like(customers.name, `%${term}%`)
        : like(customers.kana, `%${term}%`)
  const rows = await drizzle(c.env.DB)
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.organizationId, c.get('auth').org),
        eq(customers.primaryStoreId, storeId),
        match,
      ),
    )
    .limit(20)
  return c.json(
    rows.map((row) =>
      CustomerCandidate.parse({
        id: row.id,
        name: row.name,
        kana: row.kana,
        phone: row.phoneNormalized,
        email: row.email,
        primaryStoreId: row.primaryStoreId,
        visitCount: row.visitCount,
      }),
    ),
  )
}

/*
 * Dioptre and pupillary-distance values are formatted exactly once, here, so
 * no client ever reimplements the sign and precision rules a prescription is
 * read with.
 */
function formatDioptre(value: number): string {
  return `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(2)}`
}

function formatMillimetres(value: number): string {
  return value.toFixed(1)
}

/**
 * Read one customer record (顧客台帳).
 *
 * Base access needs `customer.read` on the selected store. Cross-store rows
 * are added only for `customer.history`, and 注意事項 only for
 * `attention.read` — a caller without the latter receives an empty array and
 * no count, flag or other trace that restricted rows exist (AC-EYEX-91).
 * A customer in another organization, and one this store may not see, share
 * the same opaque 403 so neither existence can be probed.
 */
async function readCustomerDetail(
  c: AppContext,
  storeId: string,
  customerId: string,
): Promise<Response> {
  const access = await authorizedStore(c as StoreContext, storeId, 'customer.read')
  if (!access) return c.json({ error: 'forbidden' }, 403)
  const organizationId = c.get('auth').org
  const permissions = access.actor.permissions
  const crossStore = permissions.includes('customer.history')
  const mayReadAttention = permissions.includes('attention.read')
  const db = drizzle(c.env.DB)

  const customer = (
    await db
      .select()
      .from(customers)
      .where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId)))
  )[0]
  if (!customer) return c.json({ error: 'forbidden' }, 403)

  // A customer neither belonging to nor ever received by the selected store is
  // visible only to staff trusted with the chain-wide customer record.
  if (!crossStore && customer.primaryStoreId !== storeId) {
    const [receivedReservations, receivedWalkins] = await Promise.all([
      db
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(
            eq(reservations.organizationId, organizationId),
            eq(reservations.storeId, storeId),
            eq(reservations.customerId, customerId),
          ),
        )
        .limit(1),
      db
        .select({ id: walkins.id })
        .from(walkins)
        .where(
          and(
            eq(walkins.organizationId, organizationId),
            eq(walkins.storeId, storeId),
            eq(walkins.customerId, customerId),
          ),
        )
        .limit(1),
    ])
    if (receivedReservations.length === 0 && receivedWalkins.length === 0)
      return c.json({ error: 'forbidden' }, 403)
  }

  const now = nowIso(requestClock(c))
  // Every customer-record query is scoped by the JWT organization, and by the
  // selected store unless the actor may read the chain-wide record.
  const scoped = (
    table:
      | typeof customerPrescriptions
      | typeof customerNotes
      | typeof customerOwnedGlasses
      | typeof customerAttentionNotes,
  ) =>
    crossStore
      ? and(eq(table.organizationId, organizationId), eq(table.customerId, customerId))
      : and(
          eq(table.organizationId, organizationId),
          eq(table.storeId, storeId),
          eq(table.customerId, customerId),
        )

  const [storeRows, prescriptionRows, noteRows, glassesRows, attentionRows, visits, walkinVisits] =
    await Promise.all([
      db
        .select({ id: stores.id, name: stores.name })
        .from(stores)
        .where(eq(stores.organizationId, organizationId)),
      db
        .select()
        .from(customerPrescriptions)
        .where(scoped(customerPrescriptions))
        .orderBy(desc(customerPrescriptions.measuredOn), desc(customerPrescriptions.createdAt)),
      db
        .select()
        .from(customerNotes)
        .where(scoped(customerNotes))
        .orderBy(desc(customerNotes.recordedOn), desc(customerNotes.createdAt))
        .limit(1),
      db
        .select()
        .from(customerOwnedGlasses)
        .where(scoped(customerOwnedGlasses))
        .orderBy(desc(customerOwnedGlasses.purchasedOn), desc(customerOwnedGlasses.createdAt)),
      mayReadAttention
        ? db
            .select()
            .from(customerAttentionNotes)
            .where(
              and(
                scoped(customerAttentionNotes),
                eq(customerAttentionNotes.status, 'published'),
                isNull(customerAttentionNotes.hiddenAt),
              ),
            )
            .orderBy(desc(customerAttentionNotes.recordedOn))
        : Promise.resolve([]),
      db
        .select({ storeId: reservations.storeId, startAt: reservations.startAt })
        .from(reservations)
        .where(
          and(
            crossStore
              ? eq(reservations.organizationId, organizationId)
              : and(
                  eq(reservations.organizationId, organizationId),
                  eq(reservations.storeId, storeId),
                ),
            eq(reservations.customerId, customerId),
            lte(reservations.startAt, now),
            ne(reservations.status, 'cancelled'),
            ne(reservations.status, 'no_show'),
          ),
        ),
      db
        .select({ storeId: walkins.storeId, arrivedAt: walkins.arrivedAt })
        .from(walkins)
        .where(
          and(
            crossStore
              ? eq(walkins.organizationId, organizationId)
              : and(eq(walkins.organizationId, organizationId), eq(walkins.storeId, storeId)),
            eq(walkins.customerId, customerId),
            lte(walkins.arrivedAt, now),
          ),
        ),
    ])

  const storeNames = new Map(storeRows.map((row) => [row.id, row.name]))
  const storeName = (id: string) => storeNames.get(id) ?? ''

  const prescriptions = prescriptionRows.map((row) => ({
    measuredOn: row.measuredOn,
    storeId: row.storeId,
    storeName: storeName(row.storeId),
    recordedBy: row.recordedBy,
    rightSphere: formatDioptre(row.rightSphere),
    leftSphere: formatDioptre(row.leftSphere),
    pupillaryDistance: formatMillimetres(row.pupillaryDistance),
    addPower: row.addPower === null ? null : formatDioptre(row.addPower),
  }))

  const visitHistory = [
    ...visits.map((row) => ({ storeId: row.storeId, at: row.startAt, summary: '予約来店' })),
    ...walkinVisits.map((row) => ({
      storeId: row.storeId,
      at: row.arrivedAt,
      summary: 'ウォークイン来店',
    })),
  ]
    .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0))
    .map((row) => ({
      visitedOn: toJstDateString(row.at),
      storeId: row.storeId,
      storeName: storeName(row.storeId),
      summary: row.summary,
    }))

  // Disclosing 注意事項 is itself an audited event (UC-EYEX-147); a read whose
  // audit row cannot be appended discloses nothing.
  if (mayReadAttention) {
    const audited = await auditAttentionRead(c, storeId, customerId, attentionRows.length)
    if (audited) return audited
  }

  const latestNoteRow = noteRows[0]
  return c.json(
    CustomerDetail.parse({
      customerId: customer.id,
      currentPrescription: prescriptions[0] ?? null,
      pastPrescriptions: prescriptions.slice(1),
      latestNote:
        latestNoteRow === undefined
          ? null
          : {
              recordedOn: latestNoteRow.recordedOn,
              storeId: latestNoteRow.storeId,
              storeName: storeName(latestNoteRow.storeId),
              recordedBy: latestNoteRow.recordedBy,
              body: latestNoteRow.body,
            },
      ownedGlasses: glassesRows.map((row) => ({
        label: row.label,
        purchasedOn: row.purchasedOn,
        storeId: row.storeId,
        storeName: storeName(row.storeId),
        lensType: row.lensType,
      })),
      attentionNotes: attentionRows.map((row) => ({
        body: row.body,
        basis: row.basis,
        recordedBy: row.recordedBy,
        recordedOn: row.recordedOn,
      })),
      visitHistory,
    }),
  )
}

/**
 * 来店目的の id → スタッフ向け名称。台帳のセルは名称しか出さないので、
 * id を引ける表がないまま台帳を組み立てることはしない。
 */
async function purposeNameLookup(c: AppContext, storeId: string): Promise<Map<string, string>> {
  const rows = await drizzle(c.env.DB)
    .select({ id: visitPurposes.id, name: visitPurposes.staffName })
    .from(visitPurposes)
    .where(
      and(eq(visitPurposes.organizationId, c.get('auth').org), eq(visitPurposes.storeId, storeId)),
    )
  return new Map(rows.map((row) => [row.id, row.name]))
}

function reservationPurposeNames(
  row: typeof reservations.$inferSelect,
  names: Map<string, string>,
): string[] {
  const ids: unknown = JSON.parse(row.purposeIdsJson)
  if (!Array.isArray(ids)) return []
  // 名称を引けない目的は落とす。台帳に生の uuid を出しても誰も読めない。
  return ids.flatMap((id) => (typeof id === 'string' ? (names.get(id) ?? []) : []))
}

function ledgerEntryFromReservation(
  row: typeof reservations.$inferSelect,
  now: Date,
  purposeNames: string[],
) {
  return LedgerEntry.parse({
    id: row.id,
    entryType: 'reservation',
    source: row.source,
    status: row.status,
    startAt: row.startAt,
    endAt: row.endAt,
    customerName: row.customerName,
    customerId: row.customerId,
    progress: row.progress,
    waitStartedAt: row.waitStartedAt,
    assignedStaffId: row.assignedStaffId,
    assignedEquipmentIds:
      row.assignedEquipmentIdsJson === null ? [] : JSON.parse(row.assignedEquipmentIdsJson),
    nextGuidance: row.nextGuidance,
    purposeNames,
    warnings: ledgerWarnings({
      progress: row.progress as import('@app/contracts').ReceptionProgress | null,
      waitStartedAt: row.waitStartedAt,
      assignedStaffId: row.assignedStaffId,
      assignedEquipmentIds:
        row.assignedEquipmentIdsJson === null ? [] : JSON.parse(row.assignedEquipmentIdsJson),
      now,
    }),
    version: row.version,
  })
}

function ledgerEntryFromWalkin(row: typeof walkins.$inferSelect, now: Date, customerName?: string) {
  return LedgerEntry.parse({
    id: row.id,
    entryType: 'walkin',
    source: 'walkin',
    status: row.status,
    startAt: row.arrivedAt,
    endAt: row.arrivedAt,
    customerName: customerName ?? `ウォークイン ${row.sequence}`,
    customerId: row.customerId,
    progress: row.progress,
    waitStartedAt: row.progress === 'waiting' ? row.arrivedAt : null,
    assignedStaffId: null,
    assignedEquipmentIds: [],
    nextGuidance: null,
    warnings: ledgerWarnings({
      progress: row.progress as import('@app/contracts').ReceptionProgress,
      waitStartedAt: row.arrivedAt,
      assignedStaffId: null,
      assignedEquipmentIds: [],
      now,
    }),
    version: row.version,
  })
}

function jstDayBounds(date: string): { startAt: string; endAt: string } {
  const startAt = new Date(`${date}T00:00:00.000+09:00`)
  const endAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000)
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() }
}

function batchStatementChanged(result: unknown): boolean {
  if (typeof result !== 'object' || result === null || !('meta' in result)) return false
  const meta = result.meta
  return typeof meta === 'object' && meta !== null && 'changes' in meta && meta.changes === 1
}

async function readLedger(c: AppContext, storeId: string, date: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.read')
  if (denied) return denied
  const bounds = jstDayBounds(date)
  const db = drizzle(c.env.DB)
  const reservationRows = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.organizationId, c.get('auth').org),
        eq(reservations.storeId, storeId),
        gte(reservations.startAt, bounds.startAt),
        lt(reservations.startAt, bounds.endAt),
      ),
    )
    .orderBy(asc(reservations.startAt))
  const walkinRows = await db
    .select()
    .from(walkins)
    .where(
      and(
        eq(walkins.organizationId, c.get('auth').org),
        eq(walkins.storeId, storeId),
        eq(walkins.serviceDate, date),
      ),
    )
  const customerIds = walkinRows.flatMap((row) => (row.customerId === null ? [] : [row.customerId]))
  const walkinCustomerRows =
    customerIds.length === 0
      ? []
      : await db
          .select({ id: customers.id, name: customers.name })
          .from(customers)
          .where(
            and(
              eq(customers.organizationId, c.get('auth').org),
              inArray(customers.id, customerIds),
            ),
          )
  const walkinCustomerNames = new Map(walkinCustomerRows.map((row) => [row.id, row.name]))
  const purposeNames = await purposeNameLookup(c, storeId)
  const now = requestClock(c).now()
  return c.json(
    LedgerEntry.array().parse(
      [
        ...reservationRows.map((row) =>
          ledgerEntryFromReservation(row, now, reservationPurposeNames(row, purposeNames)),
        ),
        ...walkinRows.map((row) =>
          ledgerEntryFromWalkin(
            row,
            now,
            row.customerId === null ? undefined : walkinCustomerNames.get(row.customerId),
          ),
        ),
      ].sort((left, right) => left.startAt.localeCompare(right.startAt)),
    ),
  )
}

const receptionHistoryActions = {
  'reservation.created': 'created',
  'reservation.changed': 'changed',
  'reservation.cancelled': 'cancelled',
  'reservation.no_show': 'no_show',
  'walkin.created': 'walkin_created',
} as const

async function readReceptionHistory(
  c: AppContext,
  storeId: string,
  input: ReceptionHistoryQuery,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.read')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const actionNames = Object.keys(receptionHistoryActions)
  const bounds = input.date === undefined ? undefined : jstDayBounds(input.date)
  const auditRows = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, c.get('auth').org),
        eq(auditEvents.storeId, storeId),
        inArray(auditEvents.action, actionNames),
        ...(bounds === undefined
          ? []
          : [
              gte(auditEvents.occurredAt, bounds.startAt),
              lt(auditEvents.occurredAt, bounds.endAt),
            ]),
      ),
    )
    .orderBy(desc(auditEvents.occurredAt))

  const reservationIds = auditRows
    .filter((row) => row.entityType === 'reservation')
    .map((row) => row.entityId)
  const walkinIds = auditRows
    .filter((row) => row.entityType === 'walkin')
    .map((row) => row.entityId)
  const reservationRows =
    reservationIds.length === 0
      ? []
      : await db
          .select()
          .from(reservations)
          .where(
            and(
              eq(reservations.organizationId, c.get('auth').org),
              eq(reservations.storeId, storeId),
              inArray(reservations.id, reservationIds),
            ),
          )
  const walkinRows =
    walkinIds.length === 0
      ? []
      : await db
          .select()
          .from(walkins)
          .where(
            and(
              eq(walkins.organizationId, c.get('auth').org),
              eq(walkins.storeId, storeId),
              inArray(walkins.id, walkinIds),
            ),
          )
  const reservationById = new Map(reservationRows.map((row) => [row.id, row]))
  const walkinById = new Map(walkinRows.map((row) => [row.id, row]))

  const normalizedPhone = input.phone === undefined ? undefined : normalizePhone(input.phone)
  if (normalizedPhone !== undefined && normalizedPhone.length < 7)
    return c.json({ error: 'invalid_reservation_phone' }, 400)
  const entries = auditRows.flatMap((row) => {
    const action = receptionHistoryActions[row.action as keyof typeof receptionHistoryActions]
    if (!action) return []
    const reservation = reservationById.get(row.entityId)
    const walkin = walkinById.get(row.entityId)
    if (!reservation && !walkin) return []
    const source = reservation?.source ?? 'walkin'
    const customerName =
      reservation?.customerName ?? (walkin === undefined ? null : `ウォークイン ${walkin.sequence}`)
    const customerPhone = reservation?.customerPhone ?? null
    const reservationNumber = reservation?.reservationNumber ?? null
    const requiresAttention = action === 'cancelled' || action === 'no_show'
    if (input.source !== undefined && input.source !== source) return []
    if (input.action !== undefined && input.action !== action) return []
    if (
      input.requiresAttention !== undefined &&
      (input.requiresAttention === 'true') !== requiresAttention
    )
      return []
    if (input.name !== undefined && (customerName === null || !customerName.includes(input.name)))
      return []
    if (
      normalizedPhone !== undefined &&
      (reservation?.customerPhoneNormalized === null ||
        reservation?.customerPhoneNormalized === undefined ||
        !reservation.customerPhoneNormalized.includes(normalizedPhone))
    )
      return []
    if (input.reservationNumber !== undefined && input.reservationNumber !== reservationNumber)
      return []
    return [
      ReceptionHistoryEntry.parse({
        id: row.id,
        occurredAt: row.occurredAt,
        source,
        action,
        entityType: row.entityType,
        entityId: row.entityId,
        reservationId: reservation?.id ?? null,
        customerName,
        customerPhone,
        reservationNumber,
        actorId: row.actorId,
        requiresAttention,
        recordingStatus: 'none',
      }),
    ]
  })
  return c.json(ReceptionHistoryEntry.array().parse(entries))
}

async function updateReservationProgress(
  c: AppContext,
  storeId: string,
  reservationId: string,
  input: ReservationProgressPatch,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.write')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const rows = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.organizationId, c.get('auth').org),
        eq(reservations.storeId, storeId),
        eq(reservations.id, reservationId),
      ),
    )
  const current = rows[0]
  if (!current) return c.json({ error: 'forbidden' }, 403)
  try {
    await assertVersion(current.version, input.version)
  } catch (error) {
    if (error instanceof VersionConflictError)
      return c.json({ error: error.code, currentVersion: error.currentVersion }, 409)
    throw error
  }
  if (current.status === 'cancelled' || current.status === 'no_show') {
    return c.json({ error: 'invalid_progress_transition', currentVersion: current.version }, 409)
  }
  if (input.assignedStaffId !== undefined && input.assignedStaffId !== null) {
    const assignedStaff = await db
      .select({ id: availabilityStaff.id })
      .from(availabilityStaff)
      .where(
        and(
          eq(availabilityStaff.organizationId, c.get('auth').org),
          eq(availabilityStaff.storeId, storeId),
          eq(availabilityStaff.id, input.assignedStaffId),
        ),
      )
    if (assignedStaff.length !== 1) return c.json({ error: 'forbidden' }, 403)
  }
  if (input.assignedEquipmentIds !== undefined) {
    const uniqueEquipmentIds = [...new Set(input.assignedEquipmentIds)]
    if (uniqueEquipmentIds.length !== input.assignedEquipmentIds.length) {
      return c.json({ error: 'invalid_equipment_assignment' }, 400)
    }
    if (uniqueEquipmentIds.length > 0) {
      const assignedEquipment = await db
        .select({ id: availabilityEquipment.id })
        .from(availabilityEquipment)
        .where(
          and(
            eq(availabilityEquipment.organizationId, c.get('auth').org),
            eq(availabilityEquipment.storeId, storeId),
            inArray(availabilityEquipment.id, uniqueEquipmentIds),
          ),
        )
      if (assignedEquipment.length !== uniqueEquipmentIds.length)
        return c.json({ error: 'forbidden' }, 403)
    }
  }
  const clock = requestClock(c)
  const updatedAt = nowIso(clock)
  const nextStatus = current.status === 'confirmed' ? 'checked_in' : current.status
  const updatedVersion = nextVersion(current.version)
  const operationId = crypto.randomUUID()
  const progressEventId = crypto.randomUUID()
  const auditEventId = crypto.randomUUID()
  const actor = auditActor(c)
  const terminalGuard = activeSharedTerminalWriteGuard(c, storeId, updatedAt)
  const values = {
    status: nextStatus,
    progress: input.progress,
    waitStartedAt:
      input.progress === 'waiting' ? (current.waitStartedAt ?? updatedAt) : current.waitStartedAt,
    assignedStaffId:
      input.assignedStaffId === undefined ? current.assignedStaffId : input.assignedStaffId,
    assignedEquipmentIdsJson:
      input.assignedEquipmentIds === undefined
        ? current.assignedEquipmentIdsJson
        : JSON.stringify(input.assignedEquipmentIds),
    nextGuidance: input.nextGuidance === undefined ? current.nextGuidance : input.nextGuidance,
    progressOperationId: operationId,
    version: updatedVersion,
    updatedAt,
  }
  const updatedRow = and(
    eq(reservations.organizationId, c.get('auth').org),
    eq(reservations.storeId, storeId),
    eq(reservations.id, reservationId),
    eq(reservations.version, updatedVersion),
    eq(reservations.progressOperationId, operationId),
  )
  const metadata = JSON.stringify({
    fromProgress: current.progress,
    toProgress: input.progress,
    fromAssignedStaffId: current.assignedStaffId,
    toAssignedStaffId: values.assignedStaffId,
    fromAssignedEquipmentIdsJson: current.assignedEquipmentIdsJson,
    toAssignedEquipmentIdsJson: values.assignedEquipmentIdsJson,
    nextGuidanceChanged: current.nextGuidance !== values.nextGuidance,
    version: updatedVersion,
  })
  const batchResults = await db.batch([
    db
      .update(reservations)
      .set(values)
      .where(
        and(
          eq(reservations.organizationId, c.get('auth').org),
          eq(reservations.storeId, storeId),
          eq(reservations.id, reservationId),
          eq(reservations.version, input.version),
          ...(terminalGuard === undefined ? [] : [terminalGuard]),
        ),
      ),
    db.insert(reservationProgressEvents).select(
      db
        .select({
          id: sql<string>`${progressEventId}`.as('id'),
          organizationId: reservations.organizationId,
          storeId: reservations.storeId,
          reservationId: reservations.id,
          fromProgress: sql<string | null>`${current.progress}`.as('fromProgress'),
          toProgress: reservations.progress,
          assignedStaffId: reservations.assignedStaffId,
          assignedEquipmentIdsJson:
            sql<string>`coalesce(${reservations.assignedEquipmentIdsJson}, '[]')`.as(
              'assignedEquipmentIdsJson',
            ),
          nextGuidance: reservations.nextGuidance,
          version: reservations.version,
          createdAt: sql<string>`${updatedAt}`.as('createdAt'),
        })
        .from(reservations)
        .where(updatedRow),
    ),
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${auditEventId}`.as('id'),
          organizationId: reservations.organizationId,
          storeId: reservations.storeId,
          actorType: sql<string>`${actor.actorType}`.as('actorType'),
          actorId: sql<string>`${actor.actorId}`.as('actorId'),
          action: sql<string>`'reservation.progress_updated'`.as('action'),
          entityType: sql<string>`'reservation'`.as('entityType'),
          entityId: reservations.id,
          requestId: sql<null>`null`.as('requestId'),
          metadata: sql<string>`${metadata}`.as('metadata'),
          occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
        })
        .from(reservations)
        .where(updatedRow),
    ),
  ])
  if (!batchStatementChanged(batchResults[0])) {
    const terminalFailure = await sharedTerminalWriteFailure(c, storeId, requestClock(c))
    if (terminalFailure) return terminalFailure
    const latest = (
      await db
        .select()
        .from(reservations)
        .where(
          and(
            eq(reservations.organizationId, c.get('auth').org),
            eq(reservations.storeId, storeId),
            eq(reservations.id, reservationId),
          ),
        )
    )[0]
    if (!latest) return c.json({ error: 'forbidden' }, 403)
    return reservationConflict(c, storeId, latest)
  }
  const result = { ...current, ...values }
  return c.json(
    ledgerEntryFromReservation(
      result,
      requestClock(c).now(),
      reservationPurposeNames(result, await purposeNameLookup(c, storeId)),
    ),
  )
}

/**
 * EX-CONFLICT のための 409 本文。
 *
 * 版番号だけでは操作者は何も判断できない。承認済みモックは「最新の内容」に
 * 実際の値と更新者・時刻を出すので、監査イベントから最後に書いた主体を引いて
 * 一緒に返す。監査行が引けないときは版番号だけに縮退させる（衝突自体は
 * 事実なので、更新者が不明でも 409 を返さないという選択は取らない）。
 */
async function versionConflictBody(
  c: AppContext,
  input: {
    storeId: string
    entityType: 'reservation' | 'walkin'
    entityId: string
    currentVersion: number
    latest: { label: string; value: string }[]
  },
): Promise<Record<string, unknown>> {
  const db = drizzle(c.env.DB)
  const event = (
    await db
      .select({
        actorType: auditEvents.actorType,
        actorId: auditEvents.actorId,
        occurredAt: auditEvents.occurredAt,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, c.get('auth').org),
          eq(auditEvents.entityType, input.entityType),
          eq(auditEvents.entityId, input.entityId),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1)
  )[0]
  const storeRow = (
    await db
      .select({ name: stores.name })
      .from(stores)
      .where(and(eq(stores.organizationId, c.get('auth').org), eq(stores.id, input.storeId)))
  )[0]
  let actorName: string | undefined
  if (event?.actorType === 'shared_terminal') {
    actorName = (
      await db
        .select({ name: sharedTerminals.name })
        .from(sharedTerminals)
        .where(
          and(
            eq(sharedTerminals.organizationId, c.get('auth').org),
            eq(sharedTerminals.id, event.actorId),
          ),
        )
    )[0]?.name
  } else if (event) {
    actorName = event.actorId
  }
  const updatedBy =
    actorName === undefined
      ? null
      : storeRow === undefined
        ? actorName
        : `${storeRow.name} ${actorName}`
  return VersionConflict.parse({
    error: 'version_conflict',
    currentVersion: input.currentVersion,
    latest: input.latest,
    updatedBy,
    updatedAt: event?.occurredAt ?? null,
  })
}

/** 台帳セルと同じ語で状態を出す。操作者が画面で読む語と 409 の語を割らない。 */
const CONFLICT_PROGRESS_LABELS: Record<string, string> = {
  waiting: 'お待ち',
  service_in_progress: '接客中',
  service_completed: '接客完了',
  departed: '退店',
}

/** ウォークインの 409。最新の工程と顧客の紐付きを、画面の語のまま並べる。 */
async function walkinConflict(
  c: AppContext,
  storeId: string,
  row: { id: string; version: number; progress: string; customerId: string | null },
): Promise<Response> {
  return c.json(
    await versionConflictBody(c, {
      storeId,
      entityType: 'walkin',
      entityId: row.id,
      currentVersion: row.version,
      latest: [
        { label: '状態', value: CONFLICT_PROGRESS_LABELS[row.progress] ?? row.progress },
        { label: 'お客様', value: row.customerId === null ? '顧客未登録' : '顧客と関連付け済み' },
      ],
    }),
    409,
  )
}

/** 予約の 409。工程・担当者・次のご案内という、この画面で書き換わる 3 つ。 */
async function reservationConflict(
  c: AppContext,
  storeId: string,
  row: {
    id: string
    version: number
    progress: string | null
    assignedStaffId: string | null
    nextGuidance: string | null
  },
): Promise<Response> {
  // 担当者は名前でしか意味を成さない。id しか引けないときは未定として扱う。
  const staffName =
    row.assignedStaffId === null
      ? null
      : ((
          await drizzle(c.env.DB)
            .select({ name: availabilityStaff.name })
            .from(availabilityStaff)
            .where(
              and(
                eq(availabilityStaff.organizationId, c.get('auth').org),
                eq(availabilityStaff.storeId, storeId),
                eq(availabilityStaff.id, row.assignedStaffId),
              ),
            )
        )[0]?.name ?? null)
  return c.json(
    await versionConflictBody(c, {
      storeId,
      entityType: 'reservation',
      entityId: row.id,
      currentVersion: row.version,
      latest: [
        {
          label: '店内工程',
          value:
            row.progress === null
              ? '未着手'
              : (CONFLICT_PROGRESS_LABELS[row.progress] ?? row.progress),
        },
        { label: '担当者', value: staffName ?? '担当者未定' },
        { label: '次のご案内', value: row.nextGuidance ?? 'なし' },
      ],
    }),
    409,
  )
}

function jstDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

function auditActor(c: AppContext): { actorType: 'user' | 'shared_terminal'; actorId: string } {
  const sharedTerminal = (
    c.var as unknown as {
      sharedTerminal?: { id: string }
    }
  ).sharedTerminal
  if (sharedTerminal) return { actorType: 'shared_terminal', actorId: sharedTerminal.id }
  return { actorType: 'user', actorId: c.get('auth').sub }
}

/**
 * Re-check the device, tenant and store in the same D1 statement as a shared
 * terminal write. Context is only an identity carrier; it is never sufficient
 * authorization after a concurrent remote revocation or disablement.
 */
function activeSharedTerminalWriteGuard(c: AppContext, storeId: string, now: string) {
  const terminal = c.get('sharedTerminal')
  if (!terminal) return undefined
  return sql`exists (
    select 1 from shared_terminals terminal
    join organizations organization on organization.id = terminal.organization_id
    join stores store on store.id = terminal.store_id and store.organization_id = terminal.organization_id
    where terminal.id = ${terminal.id}
      and terminal.organization_id = ${terminal.organizationId}
      and terminal.store_id = ${storeId}
      and terminal.status = 'active'
      and julianday(terminal.expires_at) > julianday(${now})
      and (terminal.last_seen_at is null or julianday(terminal.last_seen_at) + terminal.idle_timeout_seconds / 86400.0 > julianday(${now}))
      and organization.is_disabled = '0'
      and store.is_active = '1'
  )`
}

/** Recover a concrete terminal/session error after a guarded CAS writes zero rows. */
async function sharedTerminalWriteFailure(
  c: AppContext,
  storeId: string,
  clock: Clock,
): Promise<Response | null> {
  const identity = c.get('sharedTerminal')
  if (!identity) return null
  const db = drizzle(c.env.DB)
  const terminal = (
    await db
      .select()
      .from(sharedTerminals)
      .where(
        and(
          eq(sharedTerminals.id, identity.id),
          eq(sharedTerminals.organizationId, identity.organizationId),
          eq(sharedTerminals.storeId, storeId),
        ),
      )
  )[0]
  if (!terminal) return c.json({ error: 'terminal_revoked' }, 401)
  const accessError = sharedTerminalAccessError(terminal, clock.now())
  if (accessError) return c.json({ error: accessError }, 401)
  const organization = (
    await db
      .select({ isDisabled: organizations.isDisabled })
      .from(organizations)
      .where(eq(organizations.id, identity.organizationId))
  )[0]
  if (organization?.isDisabled !== '0') return c.json({ error: 'org_disabled' }, 403)
  const store = (
    await db
      .select({ isActive: stores.isActive })
      .from(stores)
      .where(and(eq(stores.id, storeId), eq(stores.organizationId, identity.organizationId)))
  )[0]
  if (store?.isActive !== '1') return c.json({ error: 'terminal_store_inactive' }, 403)
  return null
}

async function createWalkin(c: AppContext, storeId: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.write')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const now = nowIso(requestClock(c))
  const serviceDate = jstDate(new Date(now))
  const recordId = crypto.randomUUID()
  const actor = auditActor(c)
  const terminalGuard = activeSharedTerminalWriteGuard(c, storeId, now)
  const dailySequenceScope = and(
    eq(walkinDailySequences.organizationId, c.get('auth').org),
    eq(walkinDailySequences.storeId, storeId),
    eq(walkinDailySequences.serviceDate, serviceDate),
    ...(terminalGuard === undefined ? [] : [terminalGuard]),
  )
  const sequenceAllocator = db
    .insert(walkinDailySequences)
    .select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as('id'),
          organizationId: sql<string>`${c.get('auth').org}`.as('organizationId'),
          storeId: sql<string>`${storeId}`.as('storeId'),
          serviceDate: sql<string>`${serviceDate}`.as('serviceDate'),
          // The following update increments this initial value before it is read.
          // This preserves the prior allocator's first issued number of 1.
          nextSequence:
            sql<number>`coalesce((select max(${walkins.sequence}) from ${walkins} where ${walkins.organizationId} = ${c.get('auth').org} and ${walkins.storeId} = ${storeId} and ${walkins.serviceDate} = ${serviceDate}), 0) + 1`.as(
              'nextSequence',
            ),
        })
        .from(organizations)
        .where(
          and(
            eq(organizations.id, c.get('auth').org),
            ...(terminalGuard === undefined ? [] : [terminalGuard]),
          ),
        ),
    )
    .onConflictDoNothing()
  const record = Walkin.parse({
    id: recordId,
    entryType: 'walkin',
    provisionalLabel: 'ウォークイン',
    customerId: null,
    progress: 'waiting',
    status: 'active',
    arrivedAt: now,
    version: 1,
  })
  const inserted = and(
    eq(walkins.organizationId, c.get('auth').org),
    eq(walkins.storeId, storeId),
    eq(walkins.id, record.id),
  )
  const results = await db.batch([
    sequenceAllocator,
    db
      .update(walkinDailySequences)
      .set({ nextSequence: sql`${walkinDailySequences.nextSequence} + 1` })
      .where(dailySequenceScope),
    db.insert(walkins).select(
      db
        .select({
          id: sql<string>`${record.id}`.as('id'),
          organizationId: sql<string>`${c.get('auth').org}`.as('organizationId'),
          storeId: sql<string>`${storeId}`.as('storeId'),
          serviceDate: sql<string>`${serviceDate}`.as('serviceDate'),
          sequence: sql<number>`${walkinDailySequences.nextSequence} - 1`.as('sequence'),
          customerId: sql<null>`null`.as('customerId'),
          status: sql<string>`${record.status}`.as('status'),
          progress: sql<string>`${record.progress}`.as('progress'),
          arrivedAt: sql<string>`${record.arrivedAt}`.as('arrivedAt'),
          operationId: sql<null>`null`.as('operationId'),
          version: sql<number>`1`.as('version'),
          createdAt: sql<string>`${now}`.as('createdAt'),
          updatedAt: sql<string>`${now}`.as('updatedAt'),
        })
        .from(walkinDailySequences)
        .where(dailySequenceScope),
    ),
    db.insert(walkinEvents).select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as('id'),
          organizationId: walkins.organizationId,
          storeId: walkins.storeId,
          walkinId: walkins.id,
          eventType: sql<string>`'created'`.as('eventType'),
          fromCustomerId: sql<null>`null`.as('fromCustomerId'),
          toCustomerId: sql<null>`null`.as('toCustomerId'),
          fromProgress: sql<null>`null`.as('fromProgress'),
          toProgress: sql<string>`'waiting'`.as('toProgress'),
          version: sql<number>`1`.as('version'),
          occurredAt: sql<string>`${now}`.as('occurredAt'),
        })
        .from(walkins)
        .where(inserted),
    ),
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as('id'),
          organizationId: walkins.organizationId,
          storeId: walkins.storeId,
          actorType: sql<string>`${actor.actorType}`.as('actorType'),
          actorId: sql<string>`${actor.actorId}`.as('actorId'),
          action: sql<string>`'walkin.created'`.as('action'),
          entityType: sql<string>`'walkin'`.as('entityType'),
          entityId: walkins.id,
          requestId: sql<null>`null`.as('requestId'),
          metadata:
            sql<string>`${JSON.stringify({ provisionalLabel: record.provisionalLabel })}`.as(
              'metadata',
            ),
          occurredAt: sql<string>`${now}`.as('occurredAt'),
        })
        .from(walkins)
        .where(inserted),
    ),
  ])
  if (!batchStatementChanged(results[2])) {
    return (
      (await sharedTerminalWriteFailure(c, storeId, requestClock(c))) ??
      c.json({ error: 'version_conflict' }, 409)
    )
  }
  const saved = (await db.select({ sequence: walkins.sequence }).from(walkins).where(inserted))[0]
  if (!saved) throw new Error('walkin creation committed without its record')
  return c.json(
    Walkin.parse({ ...record, provisionalLabel: `ウォークイン ${saved.sequence}` }),
    201,
  )
}

function walkinFromRow(row: typeof walkins.$inferSelect) {
  return Walkin.parse({
    id: row.id,
    entryType: 'walkin',
    provisionalLabel: `ウォークイン ${row.sequence}`,
    customerId: row.customerId,
    progress: row.progress,
    status: row.status,
    arrivedAt: row.arrivedAt,
    version: row.version,
  })
}

async function linkWalkinCustomer(
  c: AppContext,
  storeId: string,
  walkinId: string,
  input: WalkinCustomerPatch,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'customer.write')
  if (denied) return denied
  if ('customer' in input) return createAndLinkWalkinCustomer(c, storeId, walkinId, input)
  const db = drizzle(c.env.DB)
  const current = (
    await db
      .select()
      .from(walkins)
      .where(
        and(
          eq(walkins.organizationId, c.get('auth').org),
          eq(walkins.storeId, storeId),
          eq(walkins.id, walkinId),
        ),
      )
  )[0]
  if (!current) return c.json({ error: 'forbidden' }, 403)
  if (current.customerId !== null) {
    return c.json({ error: 'walkin_customer_already_linked', currentVersion: current.version }, 409)
  }
  const customer = (
    await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, c.get('auth').org),
          eq(customers.primaryStoreId, storeId),
          eq(customers.id, input.customerId),
        ),
      )
  )[0]
  if (!customer) return c.json({ error: 'forbidden' }, 403)
  if (current.version !== input.version) return walkinConflict(c, storeId, current)
  const operationId = crypto.randomUUID()
  const updatedAt = nowIso(requestClock(c))
  const nextVersion = current.version + 1
  const actor = auditActor(c)
  const terminalGuard = activeSharedTerminalWriteGuard(c, storeId, updatedAt)
  const applied = and(
    eq(walkins.organizationId, c.get('auth').org),
    eq(walkins.storeId, storeId),
    eq(walkins.id, walkinId),
    eq(walkins.version, nextVersion),
    eq(walkins.operationId, operationId),
  )
  const customerLinkApplied = and(
    eq(customers.organizationId, c.get('auth').org),
    eq(customers.primaryStoreId, storeId),
    eq(customers.id, input.customerId),
    sql`exists (select 1 from ${walkins} where ${walkins.organizationId} = ${c.get('auth').org} and ${walkins.storeId} = ${storeId} and ${walkins.id} = ${walkinId} and ${walkins.operationId} = ${operationId} and ${walkins.version} = ${nextVersion})`,
  )
  const results = await db.batch([
    db
      .update(walkins)
      .set({ customerId: input.customerId, operationId, version: nextVersion, updatedAt })
      .where(
        and(
          eq(walkins.organizationId, c.get('auth').org),
          eq(walkins.storeId, storeId),
          eq(walkins.id, walkinId),
          eq(walkins.version, input.version),
          sql`exists (select 1 from ${customers} where ${customers.organizationId} = ${c.get('auth').org} and ${customers.primaryStoreId} = ${storeId} and ${customers.id} = ${input.customerId})`,
          ...(terminalGuard === undefined ? [] : [terminalGuard]),
        ),
      ),
    db
      .update(customers)
      .set({
        visitCount: sql`${customers.visitCount} + 1`,
        updatedAt,
      })
      .where(customerLinkApplied),
    db.insert(walkinEvents).select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as('id'),
          organizationId: walkins.organizationId,
          storeId: walkins.storeId,
          walkinId: walkins.id,
          eventType: sql<string>`'customer_linked'`.as('eventType'),
          fromCustomerId: sql<string | null>`${current.customerId}`.as('fromCustomerId'),
          toCustomerId: walkins.customerId,
          fromProgress: sql<string>`${current.progress}`.as('fromProgress'),
          toProgress: walkins.progress,
          version: walkins.version,
          occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
        })
        .from(walkins)
        .where(applied),
    ),
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as('id'),
          organizationId: walkins.organizationId,
          storeId: walkins.storeId,
          actorType: sql<string>`${actor.actorType}`.as('actorType'),
          actorId: sql<string>`${actor.actorId}`.as('actorId'),
          action: sql<string>`'walkin.customer_linked'`.as('action'),
          entityType: sql<string>`'walkin'`.as('entityType'),
          entityId: walkins.id,
          requestId: sql<null>`null`.as('requestId'),
          metadata:
            sql<string>`${JSON.stringify({ customerId: input.customerId, version: nextVersion })}`.as(
              'metadata',
            ),
          occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
        })
        .from(walkins)
        .where(applied),
    ),
  ])
  if (!batchStatementChanged(results[0])) {
    const terminalFailure = await sharedTerminalWriteFailure(c, storeId, requestClock(c))
    if (terminalFailure) return terminalFailure
    const latest = (
      await db
        .select()
        .from(walkins)
        .where(
          and(
            eq(walkins.organizationId, c.get('auth').org),
            eq(walkins.storeId, storeId),
            eq(walkins.id, walkinId),
          ),
        )
    )[0]
    return walkinConflict(c, storeId, latest ?? current)
  }
  return c.json(
    walkinFromRow({
      ...current,
      customerId: input.customerId,
      operationId,
      version: nextVersion,
      updatedAt,
    }),
  )
}

async function createAndLinkWalkinCustomer(
  c: AppContext,
  storeId: string,
  walkinId: string,
  input: Extract<WalkinCustomerPatch, { customer: unknown }>,
): Promise<Response> {
  const normalizedPhone = normalizePhone(input.customer.phone)
  if (normalizedPhone.length < 7) return c.json({ error: 'invalid_customer_phone' }, 400)
  const db = drizzle(c.env.DB)
  const existingCustomer = (
    await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, c.get('auth').org),
          eq(customers.phoneNormalized, normalizedPhone),
        ),
      )
  )[0]
  // "新規"入力が既存電話番号に当たるときは、組織共有の既存顧客を更新せず関連付ける。
  if (existingCustomer) {
    return linkWalkinCustomer(c, storeId, walkinId, {
      version: input.version,
      customerId: existingCustomer.id,
    })
  }
  const current = (
    await db
      .select()
      .from(walkins)
      .where(
        and(
          eq(walkins.organizationId, c.get('auth').org),
          eq(walkins.storeId, storeId),
          eq(walkins.id, walkinId),
        ),
      )
  )[0]
  if (!current) return c.json({ error: 'forbidden' }, 403)
  if (current.version !== input.version) return walkinConflict(c, storeId, current)
  const operationId = crypto.randomUUID()
  const customerId = crypto.randomUUID()
  const updatedAt = nowIso(requestClock(c))
  const nextVersion = current.version + 1
  const actor = auditActor(c)
  const terminalGuard = activeSharedTerminalWriteGuard(c, storeId, updatedAt)
  const applied = and(
    eq(walkins.organizationId, c.get('auth').org),
    eq(walkins.storeId, storeId),
    eq(walkins.id, walkinId),
    eq(walkins.version, nextVersion),
    eq(walkins.operationId, operationId),
  )
  let results: Awaited<ReturnType<typeof db.batch>>
  try {
    results = await db.batch([
      db
        .update(walkins)
        .set({
          customerId,
          operationId,
          version: nextVersion,
          updatedAt,
        })
        .where(
          and(
            eq(walkins.organizationId, c.get('auth').org),
            eq(walkins.storeId, storeId),
            eq(walkins.id, walkinId),
            eq(walkins.version, input.version),
            ...(terminalGuard === undefined ? [] : [terminalGuard]),
          ),
        ),
      db.insert(customers).select(
        db
          .select({
            id: sql<string>`${customerId}`.as('id'),
            organizationId: walkins.organizationId,
            primaryStoreId: walkins.storeId,
            name: sql<string>`${input.customer.name}`.as('name'),
            kana: sql<string>`${input.customer.kana}`.as('kana'),
            phoneNormalized: sql<string>`${normalizedPhone}`.as('phoneNormalized'),
            email: sql<string | null>`${input.customer.email ?? null}`.as('email'),
            visitCount: sql<number>`1`.as('visitCount'),
            // A newly created customer is never the losing side of a merge;
            // insert-select requires every column, in table order.
            mergedIntoCustomerId: sql<string | null>`null`.as('mergedIntoCustomerId'),
            createdAt: sql<string>`${updatedAt}`.as('createdAt'),
            updatedAt: sql<string>`${updatedAt}`.as('updatedAt'),
          })
          .from(walkins)
          .where(applied),
      ),
      db.insert(walkinEvents).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as('id'),
            organizationId: walkins.organizationId,
            storeId: walkins.storeId,
            walkinId: walkins.id,
            eventType: sql<string>`'customer_created_and_linked'`.as('eventType'),
            fromCustomerId: sql<string | null>`${current.customerId}`.as('fromCustomerId'),
            toCustomerId: walkins.customerId,
            fromProgress: sql<string>`${current.progress}`.as('fromProgress'),
            toProgress: walkins.progress,
            version: walkins.version,
            occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
          })
          .from(walkins)
          .where(applied),
      ),
      db.insert(auditEvents).select(
        db
          .select({
            id: sql<string>`${crypto.randomUUID()}`.as('id'),
            organizationId: walkins.organizationId,
            storeId: walkins.storeId,
            actorType: sql<string>`${actor.actorType}`.as('actorType'),
            actorId: sql<string>`${actor.actorId}`.as('actorId'),
            action: sql<string>`'walkin.customer_created_and_linked'`.as('action'),
            entityType: sql<string>`'walkin'`.as('entityType'),
            entityId: walkins.id,
            requestId: sql<null>`null`.as('requestId'),
            metadata: sql<string>`${JSON.stringify({ customerId, version: nextVersion })}`.as(
              'metadata',
            ),
            occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
          })
          .from(walkins)
          .where(applied),
      ),
    ])
  } catch (error) {
    if (!isCustomerPhoneConflict(error)) throw error
    const committedCustomer = (
      await db
        .select({ id: customers.id, primaryStoreId: customers.primaryStoreId })
        .from(customers)
        .where(
          and(
            eq(customers.organizationId, c.get('auth').org),
            eq(customers.phoneNormalized, normalizedPhone),
          ),
        )
    )[0]
    if (!committedCustomer) throw error
    if (committedCustomer.primaryStoreId !== storeId) return c.json({ error: 'forbidden' }, 403)
    return linkWalkinCustomer(c, storeId, walkinId, {
      version: input.version,
      customerId: committedCustomer.id,
    })
  }
  if (!batchStatementChanged(results[0])) {
    const terminalFailure = await sharedTerminalWriteFailure(c, storeId, requestClock(c))
    if (terminalFailure) return terminalFailure
    const latest = (
      await db
        .select()
        .from(walkins)
        .where(
          and(
            eq(walkins.organizationId, c.get('auth').org),
            eq(walkins.storeId, storeId),
            eq(walkins.id, walkinId),
          ),
        )
    )[0]
    return walkinConflict(c, storeId, latest ?? current)
  }
  const updated = (
    await db
      .select()
      .from(walkins)
      .where(
        and(
          eq(walkins.organizationId, c.get('auth').org),
          eq(walkins.storeId, storeId),
          eq(walkins.id, walkinId),
        ),
      )
  )[0]
  if (!updated) return c.json({ error: 'internal_error' }, 500)
  return c.json(walkinFromRow(updated))
}

async function updateWalkinProgress(
  c: AppContext,
  storeId: string,
  walkinId: string,
  input: WalkinProgressPatch,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.write')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const current = (
    await db
      .select()
      .from(walkins)
      .where(
        and(
          eq(walkins.organizationId, c.get('auth').org),
          eq(walkins.storeId, storeId),
          eq(walkins.id, walkinId),
        ),
      )
  )[0]
  if (!current) return c.json({ error: 'forbidden' }, 403)
  if (current.version !== input.version) return walkinConflict(c, storeId, current)
  if (current.status === 'departed' && input.progress !== 'departed') {
    return c.json({ error: 'invalid_progress_transition', currentVersion: current.version }, 409)
  }
  const operationId = crypto.randomUUID()
  const updatedAt = nowIso(requestClock(c))
  const version = current.version + 1
  const status = input.progress === 'departed' ? 'departed' : 'active'
  const actor = auditActor(c)
  const terminalGuard = activeSharedTerminalWriteGuard(c, storeId, updatedAt)
  const applied = and(
    eq(walkins.organizationId, c.get('auth').org),
    eq(walkins.storeId, storeId),
    eq(walkins.id, walkinId),
    eq(walkins.version, version),
    eq(walkins.operationId, operationId),
  )
  const results = await db.batch([
    db
      .update(walkins)
      .set({ progress: input.progress, status, operationId, version, updatedAt })
      .where(
        and(
          eq(walkins.organizationId, c.get('auth').org),
          eq(walkins.storeId, storeId),
          eq(walkins.id, walkinId),
          eq(walkins.version, input.version),
          ...(terminalGuard === undefined ? [] : [terminalGuard]),
        ),
      ),
    db.insert(walkinEvents).select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as('id'),
          organizationId: walkins.organizationId,
          storeId: walkins.storeId,
          walkinId: walkins.id,
          eventType: sql<string>`'progress_updated'`.as('eventType'),
          fromCustomerId: walkins.customerId,
          toCustomerId: walkins.customerId,
          fromProgress: sql<string>`${current.progress}`.as('fromProgress'),
          toProgress: walkins.progress,
          version: walkins.version,
          occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
        })
        .from(walkins)
        .where(applied),
    ),
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as('id'),
          organizationId: walkins.organizationId,
          storeId: walkins.storeId,
          actorType: sql<string>`${actor.actorType}`.as('actorType'),
          actorId: sql<string>`${actor.actorId}`.as('actorId'),
          action: sql<string>`'walkin.progress_updated'`.as('action'),
          entityType: sql<string>`'walkin'`.as('entityType'),
          entityId: walkins.id,
          requestId: sql<null>`null`.as('requestId'),
          metadata: sql<string>`${JSON.stringify({ progress: input.progress, version })}`.as(
            'metadata',
          ),
          occurredAt: sql<string>`${updatedAt}`.as('occurredAt'),
        })
        .from(walkins)
        .where(applied),
    ),
  ])
  if (!batchStatementChanged(results[0])) {
    const terminalFailure = await sharedTerminalWriteFailure(c, storeId, requestClock(c))
    if (terminalFailure) return terminalFailure
    const latest = (
      await db
        .select()
        .from(walkins)
        .where(
          and(
            eq(walkins.organizationId, c.get('auth').org),
            eq(walkins.storeId, storeId),
            eq(walkins.id, walkinId),
          ),
        )
    )[0]
    return walkinConflict(c, storeId, latest ?? current)
  }
  return c.json(
    walkinFromRow({
      ...current,
      progress: input.progress,
      status,
      operationId,
      version,
      updatedAt,
    }),
  )
}

async function listWalkins(
  c: AppContext,
  storeId: string,
  status?: 'active' | 'departed',
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.read')
  if (denied) return denied
  const rows = await drizzle(c.env.DB)
    .select()
    .from(walkins)
    .where(
      and(
        eq(walkins.organizationId, c.get('auth').org),
        eq(walkins.storeId, storeId),
        ...(status ? [eq(walkins.status, status)] : []),
      ),
    )
    .orderBy(asc(walkins.arrivedAt))
  return c.json(Walkin.array().parse(rows.map(walkinFromRow)))
}

/*
 * The terminal surface authenticates with a device token, so a stored row that
 * violates the SharedTerminal contract must fail closed and be indistinguishable
 * from an unknown terminal. Returning `undefined` here lets the terminal-facing
 * callers answer 401 instead of leaking a parse failure as a 500.
 */
function sharedTerminalFromRowOrUndefined(row: typeof sharedTerminals.$inferSelect) {
  const parsed = SharedTerminal.safeParse({
    id: row.id,
    organizationId: row.organizationId,
    storeId: row.storeId,
    name: row.name,
    status: row.status,
    idleTimeoutSeconds: row.idleTimeoutSeconds,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  })
  return parsed.success ? parsed.data : undefined
}

function sharedTerminalFromRow(row: typeof sharedTerminals.$inferSelect) {
  return SharedTerminal.parse({
    id: row.id,
    organizationId: row.organizationId,
    storeId: row.storeId,
    name: row.name,
    status: row.status,
    idleTimeoutSeconds: row.idleTimeoutSeconds,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  })
}

async function createSharedTerminal(
  c: AppContext,
  storeId: string,
  input: SharedTerminalCreateInput,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'terminal.manage')
  if (denied) return denied
  const now = nowIso(requestClock(c))
  const token = issueSharedTerminalToken()
  const terminal = {
    id: crypto.randomUUID(),
    organizationId: c.get('auth').org,
    storeId,
    name: input.name,
    tokenHash: await hashSharedTerminalToken(token),
    status: 'active',
    idleTimeoutSeconds: 120,
    expiresAt: new Date(Date.parse(now) + 30 * 24 * 60 * 60 * 1000).toISOString(),
    lastSeenAt: null,
    createdAt: now,
    revokedAt: null,
    revocationOperationId: null,
  } as const
  const db = drizzle(c.env.DB)
  await writeAuditBatch(db, {
    clock: requestClock(c),
    operations: [db.insert(sharedTerminals).values(terminal)],
    events: [
      {
        organizationId: terminal.organizationId,
        storeId,
        actorType: 'user',
        actorId: c.get('auth').sub,
        action: 'shared_terminal.created',
        entityType: 'shared_terminal',
        entityId: terminal.id,
        metadata: { status: terminal.status },
      },
    ],
  })
  return c.json(
    SharedTerminalIssue.parse({ terminal: sharedTerminalFromRow(terminal), token }),
    201,
  )
}

async function listSharedTerminals(c: AppContext, storeId: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'terminal.manage')
  if (denied) return denied
  const rows = await drizzle(c.env.DB)
    .select()
    .from(sharedTerminals)
    .where(
      and(
        eq(sharedTerminals.organizationId, c.get('auth').org),
        eq(sharedTerminals.storeId, storeId),
      ),
    )
    .orderBy(desc(sharedTerminals.createdAt))
  return c.json(SharedTerminal.array().parse(rows.map(sharedTerminalFromRow)))
}

/**
 * Selection itself is client state, but the deliberate cross-store action is
 * retained as an append-only audit fact after both memberships are checked.
 */
async function auditStoreSwitch(c: AppContext, input: StoreSwitchInput): Promise<Response> {
  const sourceDenied = await requireStorePermission(
    c as StoreContext,
    input.fromStoreId,
    'store.read',
  )
  if (sourceDenied) return sourceDenied
  const destinationDenied = await requireStorePermission(
    c as StoreContext,
    input.toStoreId,
    'store.read',
  )
  if (destinationDenied) return destinationDenied
  const occurredAt = nowIso(requestClock(c))
  await drizzle(c.env.DB)
    .insert(auditEvents)
    .values({
      id: crypto.randomUUID(),
      organizationId: c.get('auth').org,
      storeId: input.toStoreId,
      actorType: 'user',
      actorId: c.get('auth').sub,
      action: 'store.switched',
      entityType: 'store',
      entityId: input.toStoreId,
      metadata: JSON.stringify({ fromStoreId: input.fromStoreId, toStoreId: input.toStoreId }),
      occurredAt,
    })
  return c.json({ storeId: input.toStoreId }, 201)
}

async function revokeSharedTerminal(
  c: AppContext,
  storeId: string,
  terminalId: string,
  actor: {
    actorType: 'user' | 'shared_terminal'
    actorId: string
    metadata: Record<string, string>
  } = {
    actorType: 'user',
    actorId: c.get('auth').sub,
    metadata: {},
  },
  skipJwtPermission = false,
): Promise<Response> {
  if (!skipJwtPermission) {
    const denied = await requireStorePermission(c as StoreContext, storeId, 'terminal.manage')
    if (denied) return denied
  }
  const db = drizzle(c.env.DB)
  const current = (
    await db
      .select()
      .from(sharedTerminals)
      .where(
        and(
          eq(sharedTerminals.organizationId, c.get('auth').org),
          eq(sharedTerminals.storeId, storeId),
          eq(sharedTerminals.id, terminalId),
        ),
      )
  )[0]
  if (!current) return c.json({ error: 'forbidden' }, 403)
  if (current.status === 'revoked') return c.json(sharedTerminalFromRow(current))
  const revokedAt = nowIso(requestClock(c))
  const operationId = crypto.randomUUID()
  const next = {
    ...current,
    status: 'revoked' as const,
    revokedAt,
    revocationOperationId: operationId,
  }
  const results = await db.batch([
    db
      .update(sharedTerminals)
      .set({
        status: next.status,
        revokedAt,
        revocationOperationId: operationId,
      })
      .where(
        and(
          eq(sharedTerminals.organizationId, current.organizationId),
          eq(sharedTerminals.storeId, current.storeId),
          eq(sharedTerminals.id, current.id),
          eq(sharedTerminals.status, 'active'),
        ),
      ),
    db
      .delete(sharedTerminalReauthSessions)
      .where(
        and(
          eq(sharedTerminalReauthSessions.organizationId, current.organizationId),
          eq(sharedTerminalReauthSessions.storeId, current.storeId),
          eq(sharedTerminalReauthSessions.terminalId, current.id),
          sql`exists (select 1 from shared_terminals where ${sharedTerminals.id} = ${current.id} and ${sharedTerminals.organizationId} = ${current.organizationId} and ${sharedTerminals.storeId} = ${current.storeId} and ${sharedTerminals.status} = 'revoked' and ${sharedTerminals.revocationOperationId} = ${operationId})`,
        ),
      ),
    db.insert(auditEvents).select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as('id'),
          organizationId: sharedTerminals.organizationId,
          storeId: sharedTerminals.storeId,
          actorType: sql<string>`${actor.actorType}`.as('actorType'),
          actorId: sql<string>`${actor.actorId}`.as('actorId'),
          action: sql<string>`'shared_terminal.revoked'`.as('action'),
          entityType: sql<string>`'shared_terminal'`.as('entityType'),
          entityId: sharedTerminals.id,
          requestId: sql<null>`null`.as('requestId'),
          metadata: sql<string>`${JSON.stringify(actor.metadata)}`.as('metadata'),
          occurredAt: sql<string>`${revokedAt}`.as('occurredAt'),
        })
        .from(sharedTerminals)
        .where(
          and(
            eq(sharedTerminals.organizationId, current.organizationId),
            eq(sharedTerminals.storeId, current.storeId),
            eq(sharedTerminals.id, current.id),
            eq(sharedTerminals.status, 'revoked'),
            eq(sharedTerminals.revocationOperationId, operationId),
          ),
        ),
    ),
  ])
  if (!batchStatementChanged(results[0])) {
    const latest = (
      await db
        .select()
        .from(sharedTerminals)
        .where(
          and(
            eq(sharedTerminals.organizationId, current.organizationId),
            eq(sharedTerminals.storeId, current.storeId),
            eq(sharedTerminals.id, current.id),
          ),
        )
    )[0]
    if (!latest) return c.json({ error: 'forbidden' }, 403)
    return c.json(sharedTerminalFromRow(latest))
  }
  return c.json(sharedTerminalFromRow(next))
}

async function readSharedTerminalSession(
  c: AppContext,
  terminalId: string,
  clock: Clock,
): Promise<Response> {
  const token = c.req.header('x-shared-terminal-token')?.trim()
  if (!token) return c.json({ error: 'terminal_unauthorized' }, 401)
  const db = drizzle(c.env.DB)
  const row = (await db.select().from(sharedTerminals).where(eq(sharedTerminals.id, terminalId)))[0]
  if (!row || row.tokenHash !== (await hashSharedTerminalToken(token))) {
    return c.json({ error: 'terminal_unauthorized' }, 401)
  }
  const organization = (
    await db.select().from(organizations).where(eq(organizations.id, row.organizationId))
  )[0]
  if (organization?.isDisabled !== '0') return c.json({ error: 'org_disabled' }, 403)
  const store = (
    await db
      .select()
      .from(stores)
      .where(and(eq(stores.id, row.storeId), eq(stores.organizationId, row.organizationId)))
  )[0]
  if (store?.isActive !== '1') return c.json({ error: 'terminal_store_inactive' }, 403)
  const now = nowIso(clock)
  const accessError = sharedTerminalAccessError(row, new Date(now))
  if (accessError) return c.json({ error: accessError }, 401)
  const result = await db
    .update(sharedTerminals)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(sharedTerminals.id, row.id),
        eq(sharedTerminals.organizationId, row.organizationId),
        eq(sharedTerminals.storeId, row.storeId),
        eq(sharedTerminals.status, 'active'),
        // Re-evaluate inside the atomic statement with the request clock. A delayed
        // request that crosses either boundary cannot revive an expired or idle-locked
        // token, while tests and callers retain one explicit time source.
        sql`julianday(${sharedTerminals.expiresAt}) > julianday(${now})`,
        sql`(${sharedTerminals.lastSeenAt} is null or julianday(${sharedTerminals.lastSeenAt}) + ${sharedTerminals.idleTimeoutSeconds} / 86400.0 > julianday(${now}))`,
        sql`exists (
      select 1 from organizations organization
      join stores store on store.id = ${sharedTerminals.storeId} and store.organization_id = ${sharedTerminals.organizationId}
      where organization.id = ${sharedTerminals.organizationId}
        and organization.is_disabled = '0'
        and store.is_active = '1'
    )`,
      ),
    )
    .run()
  if (!batchStatementChanged(result)) {
    const current = (
      await db
        .select()
        .from(sharedTerminals)
        .where(
          and(
            eq(sharedTerminals.id, row.id),
            eq(sharedTerminals.organizationId, row.organizationId),
            eq(sharedTerminals.storeId, row.storeId),
          ),
        )
    )[0]
    if (!current) return c.json({ error: 'terminal_unauthorized' }, 401)
    const currentAccessError = sharedTerminalAccessError(current, clock.now())
    if (currentAccessError) return c.json({ error: currentAccessError }, 401)
    const currentOrganization = (
      await db
        .select({ isDisabled: organizations.isDisabled })
        .from(organizations)
        .where(eq(organizations.id, current.organizationId))
    )[0]
    if (currentOrganization?.isDisabled !== '0') return c.json({ error: 'org_disabled' }, 403)
    const currentStore = (
      await db
        .select({ isActive: stores.isActive })
        .from(stores)
        .where(
          and(eq(stores.id, current.storeId), eq(stores.organizationId, current.organizationId)),
        )
    )[0]
    if (currentStore?.isActive !== '1') return c.json({ error: 'terminal_store_inactive' }, 403)
    return c.json({ error: 'terminal_revoked' }, 401)
  }
  const terminal = sharedTerminalFromRowOrUndefined({ ...row, lastSeenAt: now })
  if (!terminal) return c.json({ error: 'terminal_unauthorized' }, 401)
  return c.json(terminal)
}

const SHARED_TERMINAL_REAUTH_TTL_MS = 5 * 60 * 1000

async function issueSharedTerminalReauthentication(
  c: AppContext,
  terminalId: string,
  input: SharedTerminalReauthenticationInput,
  clock: Clock,
): Promise<Response> {
  const activeTerminal = await readSharedTerminalSession(c, terminalId, clock)
  if (!activeTerminal.ok) return activeTerminal

  const db = drizzle(c.env.DB)
  const terminal = (
    await db.select().from(sharedTerminals).where(eq(sharedTerminals.id, terminalId))
  )[0]
  if (!terminal) return c.json({ error: 'terminal_unauthorized' }, 401)

  const memberships = await db
    .select()
    .from(storeMemberships)
    .where(
      and(
        eq(storeMemberships.organizationId, terminal.organizationId),
        eq(storeMemberships.storeId, terminal.storeId),
        eq(storeMemberships.userId, input.userId),
      ),
    )
  const mayManage = memberships.some((membership) => {
    try {
      return StorePermission.array()
        .parse(JSON.parse(membership.permissions))
        .includes('terminal.manage')
    } catch {
      return false
    }
  })
  if (!mayManage) return c.json({ error: 'reauth_forbidden' }, 403)

  let verification: { verified: boolean }
  try {
    const response = await c.env.ADMIN.fetch(
      'https://admin.internal/api/internal/domain-auth/pin/verify',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-key': c.env.ADMIN_DOMAIN_AUTH_KEY,
        },
        body: JSON.stringify({
          organizationId: terminal.organizationId,
          userId: input.userId,
          stretchedPin: input.stretchedPin,
        }),
      },
    )
    if (!response.ok) return c.json({ error: 'admin_auth_unavailable' }, 502)
    verification = PinVerificationResponse.parse(await response.json())
  } catch {
    return c.json({ error: 'admin_auth_unavailable' }, 502)
  }
  if (!verification.verified) return c.json({ error: 'pin_invalid' }, 401)

  const createdAt = nowIso(clock)
  const expiresAt = new Date(clock.now().getTime() + SHARED_TERMINAL_REAUTH_TTL_MS).toISOString()
  const token = issueSharedTerminalToken()
  const sessionId = crypto.randomUUID()
  try {
    await writeAuditBatch(db, {
      clock,
      operations: [
        db.insert(sharedTerminalReauthSessions).values({
          id: sessionId,
          organizationId: terminal.organizationId,
          storeId: terminal.storeId,
          terminalId: terminal.id,
          userId: input.userId,
          tokenHash: await hashSharedTerminalToken(token),
          actionClass: 'management',
          expiresAt,
          createdAt,
        }),
      ],
      events: [
        {
          organizationId: terminal.organizationId,
          storeId: terminal.storeId,
          actorType: 'shared_terminal',
          actorId: terminal.id,
          action: 'shared_terminal.reauthenticated',
          entityType: 'shared_terminal_reauth_session',
          entityId: sessionId,
          metadata: { userId: input.userId, actionClass: 'management' },
        },
      ],
    })
  } catch (error) {
    if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
    throw error
  }
  return c.json(SharedTerminalReauthenticationIssue.parse({ token, expiresAt }), 201)
}

/**
 * Enforce an opaque personal reauthentication grant for a management action.
 * It deliberately rechecks the bearer terminal first so remote revocation,
 * expiry, or idle lock invalidates all outstanding grants immediately.
 */
async function requirePersonalReauth(
  c: AppContext,
  terminalId: string,
  actionClass: 'management',
  clock: Clock,
): Promise<Response | null> {
  const activeTerminal = await readSharedTerminalSession(c, terminalId, clock)
  if (!activeTerminal.ok) return activeTerminal
  const token = c.req.header('x-shared-terminal-reauth-token')?.trim()
  if (!token) return c.json({ error: 'reauth_unauthorized' }, 401)

  const db = drizzle(c.env.DB)
  const terminal = (
    await db.select().from(sharedTerminals).where(eq(sharedTerminals.id, terminalId))
  )[0]
  if (!terminal) return c.json({ error: 'terminal_unauthorized' }, 401)
  const session = (
    await db
      .select()
      .from(sharedTerminalReauthSessions)
      .where(and(eq(sharedTerminalReauthSessions.tokenHash, await hashSharedTerminalToken(token))))
  )[0]
  // A spent grant is indistinguishable from an unknown one: replaying it must
  // not reveal that it was ever valid.
  if (!session || session.consumedAt !== null) return c.json({ error: 'reauth_unauthorized' }, 401)
  const accessError = sharedTerminalReauthAccessError(
    session,
    {
      organizationId: terminal.organizationId,
      storeId: terminal.storeId,
      terminalId: terminal.id,
      actionClass,
    },
    clock.now(),
  )
  if (accessError === 'reauth_expired') return c.json({ error: accessError }, 401)
  if (accessError) return c.json({ error: accessError }, 403)
  /*
   * Spend the grant before the action runs. The claim is the UPDATE itself —
   * `consumed_at IS NULL` in the WHERE — so two concurrent requests presenting
   * the same token cannot both proceed, and a replay after the action finds
   * nothing to claim.
   */
  const claimed = await db
    .update(sharedTerminalReauthSessions)
    .set({ consumedAt: nowIso(clock) })
    .where(
      and(
        eq(sharedTerminalReauthSessions.id, session.id),
        isNull(sharedTerminalReauthSessions.consumedAt),
      ),
    )
    .run()
  if (!batchStatementChanged(claimed)) return c.json({ error: 'reauth_unauthorized' }, 401)
  c.set('personalReauthUserId', session.userId)
  return null
}

async function revokeCurrentSharedTerminal(c: AppContext, terminalId: string): Promise<Response> {
  const denied = await requirePersonalReauth(c, terminalId, 'management', requestClock(c))
  if (denied) return denied
  const reauthenticatedUserId = c.get('personalReauthUserId')
  if (!reauthenticatedUserId) return c.json({ error: 'reauth_unauthorized' }, 401)
  const db = drizzle(c.env.DB)
  const terminal = (
    await db.select().from(sharedTerminals).where(eq(sharedTerminals.id, terminalId))
  )[0]
  if (!terminal) return c.json({ error: 'terminal_unauthorized' }, 401)
  const memberships = await db
    .select({ permissions: storeMemberships.permissions })
    .from(storeMemberships)
    .where(
      and(
        eq(storeMemberships.organizationId, terminal.organizationId),
        eq(storeMemberships.storeId, terminal.storeId),
        eq(storeMemberships.userId, reauthenticatedUserId),
      ),
    )
  const mayManage = memberships.some((membership) => {
    try {
      return StorePermission.array()
        .parse(JSON.parse(membership.permissions))
        .includes('terminal.manage')
    } catch {
      return false
    }
  })
  if (!mayManage) return c.json({ error: 'reauth_forbidden' }, 403)
  c.set(
    'auth' as never,
    {
      sub: terminal.id,
      org: terminal.organizationId,
      email: 'shared-terminal@internal.invalid',
      role: 'staff',
    } as never,
  )
  return revokeSharedTerminal(
    c,
    terminal.storeId,
    terminal.id,
    {
      actorType: 'shared_terminal',
      actorId: terminal.id,
      metadata: { reauthenticatedUserId },
    },
    true,
  )
}

/** Establish a non-person shared-terminal actor for one allow-listed daily route. */
async function establishSharedTerminalDailyActor(
  c: AppContext,
  terminalId: string,
  storeId: string,
  clock: Clock,
): Promise<Response | null> {
  const activeTerminal = await readSharedTerminalSession(c, terminalId, clock)
  if (!activeTerminal.ok) return activeTerminal
  const terminal = (
    await drizzle(c.env.DB)
      .select()
      .from(sharedTerminals)
      .where(and(eq(sharedTerminals.id, terminalId), eq(sharedTerminals.storeId, storeId)))
  )[0]
  if (!terminal) return c.json({ error: 'forbidden' }, 403)
  c.set(
    'auth' as never,
    {
      sub: terminal.id,
      org: terminal.organizationId,
      email: 'shared-terminal@internal.invalid',
      role: 'staff',
    } as never,
  )
  c.set(
    'sharedTerminal' as never,
    {
      id: terminal.id,
      organizationId: terminal.organizationId,
      storeId: terminal.storeId,
    } as never,
  )
  return null
}

/* ------------------------------------------------------------------ *
 * 設定の下書き → 影響確認 → 公開 (UC-EYEX-092〜098, 159〜166)
 * ------------------------------------------------------------------ */

type SettingsDraftRow = typeof settingsDrafts.$inferSelect
type SettingsPublicationRow = typeof settingsPublications.$inferSelect

/** Strip the store identity so a stored snapshot can be re-validated as input. */
function toAvailabilitySettingsInput(
  settings: AvailabilityStoreSettings,
  version: number,
): AvailabilitySettingsInput {
  return AvailabilitySettingsInput.parse({
    version,
    receptionStatus: settings.receptionStatus,
    businessHours: settings.businessHours,
    exceptions: settings.exceptions,
    purposes: settings.purposes,
    staff: settings.staff,
    shifts: settings.shifts,
    equipment: settings.equipment,
    maintenance: settings.maintenance,
  })
}

function parseSettingsPayload(
  payloadJson: string,
  storeId: string,
  version: number,
): AvailabilityStoreSettings {
  const payload = parseJson(payloadJson, 'settings payload')
  if (typeof payload !== 'object' || payload === null) throw new Error('invalid settings payload')
  return AvailabilityStoreSettings.parse({ ...payload, storeId, version })
}

function draftSettings(row: SettingsDraftRow): AvailabilityStoreSettings {
  return parseSettingsPayload(row.payloadJson, row.storeId, row.baseVersion)
}

function toSettingsDraft(row: SettingsDraftRow): SettingsDraft {
  return SettingsDraft.parse({
    id: row.id,
    storeId: row.storeId,
    draftVersion: row.draftVersion,
    baseVersion: row.baseVersion,
    status: row.status,
    origin: row.origin,
    restoredFromVersionId: row.restoredFromVersionId,
    savedAt: row.savedAt,
    savedBy: row.savedBy,
    settings: draftSettings(row),
  })
}

async function readSettingsDraft(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
): Promise<SettingsDraftRow | undefined> {
  const rows = await db
    .select()
    .from(settingsDrafts)
    .where(
      and(eq(settingsDrafts.organizationId, organizationId), eq(settingsDrafts.storeId, storeId)),
    )
  return rows[0]
}

/** Public candidate slots for one JST day; a settings snapshot that cannot be evaluated yields none. */
function countPublicSlots(
  settings: AvailabilityStoreSettings,
  bookings: readonly AvailabilityBooking[],
  date: string,
): number {
  const purposeIds = settings.purposes.filter((purpose) => purpose.isPublic).map((p) => p.id)
  if (purposeIds.length === 0) return 0
  try {
    return calculateAvailability(
      {
        date,
        store: {
          receptionStatus: settings.receptionStatus,
          businessHours: settings.businessHours,
          exceptions: settings.exceptions,
        },
        purposes: settings.purposes,
        staff: settings.staff,
        shifts: settings.shifts,
        equipment: settings.equipment,
        maintenance: settings.maintenance,
        bookings,
      },
      purposeIds,
    ).slots.length
  } catch {
    return 0
  }
}

/**
 * Re-run the whole impact evaluation from persisted state.
 *
 * The impact screen, the publication request and the moment a scheduled
 * publication runs all call this, so a conflict cannot appear between the
 * check and the write (UC-EYEX-093, 097, 115, 161).
 */
async function buildSettingsImpact(
  c: AppContext,
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  row: SettingsDraftRow,
): Promise<SettingsImpactReport> {
  const storeId = row.storeId
  const [published, bookings, resolutionRows] = await Promise.all([
    readAvailabilitySettings(db, organizationId, storeId),
    readAvailabilityBookings(db, organizationId, storeId),
    db
      .select()
      .from(settingsDraftConflictResolutions)
      .where(
        and(
          eq(settingsDraftConflictResolutions.organizationId, organizationId),
          eq(settingsDraftConflictResolutions.draftId, row.id),
        ),
      ),
  ])
  const clock = requestClock(c)
  const date = toJstDateString(clock.now())
  const draft = draftSettings(row)
  return evaluateSettingsImpact({
    draftId: row.id,
    storeId,
    evaluatedAt: nowIso(clock),
    published,
    draft,
    bookings: bookings.map((booking) => ({
      id: booking.id,
      startAt: booking.startAt,
      endAt: booking.endAt,
      purposeIds: booking.purposeIds,
      staffId: booking.staffId ?? null,
      status: booking.status,
    })),
    resolutions: resolutionRows.map((resolution) => ({
      reservationId: resolution.reservationId,
      resolution: SettingsConflictResolutionKind.parse(resolution.resolution),
    })),
    publicSlots: {
      date,
      publishedCount: countPublicSlots(published, bookings, date),
      draftCount: countPublicSlots(draft, bookings, date),
    },
  })
}

function versionConflictResponse(c: AppContext, error: VersionConflictError): Response {
  return c.json(
    {
      error: error.code,
      currentVersion: error.currentVersion,
      expectedVersion: error.expectedVersion,
    },
    409,
  )
}

/** Persist a draft (new or replacing the store's open draft) together with its audit event. */
async function persistSettingsDraft(
  c: AppContext,
  storeId: string,
  input: {
    settings: AvailabilitySettingsInput
    status: 'draft' | 'review'
    origin: SettingsOrigin
    restoredFromVersionId?: string | null
    action: string
  },
): Promise<SettingsDraft> {
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const actorId = c.get('auth').sub
  const savedAt = nowIso(requestClock(c))
  const existing = await readSettingsDraft(db, organizationId, storeId)
  const current = await readAvailabilitySettings(db, organizationId, storeId)
  const draftVersion = (existing?.draftVersion ?? 0) + 1
  const id = existing?.id ?? crypto.randomUUID()
  const payloadJson = JSON.stringify({ ...input.settings, version: 0 })
  const values = {
    id,
    organizationId,
    storeId,
    draftVersion,
    baseVersion: input.settings.version,
    status: input.status,
    origin: input.origin,
    restoredFromVersionId: input.restoredFromVersionId ?? null,
    payloadJson,
    savedBy: actorId,
    savedAt,
  }
  const write =
    existing === undefined
      ? db.insert(settingsDrafts).values(values)
      : db
          .update(settingsDrafts)
          .set(values)
          .where(
            and(
              eq(settingsDrafts.organizationId, organizationId),
              eq(settingsDrafts.storeId, storeId),
            ),
          )
  const stored = AvailabilityStoreSettings.parse({
    ...input.settings,
    storeId,
    version: input.settings.version,
  })
  await writeAuditBatch(db, {
    clock: requestClock(c),
    operations: [write],
    events: [
      {
        organizationId,
        storeId,
        actorType: 'user',
        actorId,
        action: input.action,
        entityType: 'settings_draft',
        entityId: id,
        metadata: {
          draftVersion,
          baseVersion: input.settings.version,
          status: input.status,
          origin: input.origin,
          changedFields: changedSettingsFields(current, stored),
        },
      },
    ],
  })
  return SettingsDraft.parse({
    id,
    storeId,
    draftVersion,
    baseVersion: input.settings.version,
    status: input.status,
    origin: input.origin,
    restoredFromVersionId: input.restoredFromVersionId ?? null,
    savedAt,
    savedBy: actorId,
    settings: stored,
  })
}

async function saveSettingsDraft(
  c: AppContext,
  storeId: string,
  input: SettingsDraftInput,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.manage')
  if (denied) return denied
  validateAvailabilityReferences(input.settings)
  const db = drizzle(c.env.DB)
  const current = await readAvailabilitySettings(db, c.get('auth').org, storeId)
  try {
    await assertVersion(current.version, input.settings.version)
  } catch (error) {
    if (error instanceof VersionConflictError) return versionConflictResponse(c, error)
    throw error
  }
  const draft = await persistSettingsDraft(c, storeId, {
    settings: input.settings,
    status: input.status,
    origin: 'store_override',
    action: 'settings.draft.saved',
  })
  return c.json(draft, 201)
}

async function requireSettingsDraft(
  c: AppContext,
  storeId: string,
): Promise<{ error: Response } | { db: ReturnType<typeof drizzle>; row: SettingsDraftRow }> {
  const db = drizzle(c.env.DB)
  const row = await readSettingsDraft(db, c.get('auth').org, storeId)
  if (row === undefined) return { error: c.json({ error: 'draft_not_found' }, 404) }
  return { db, row }
}

async function recordSettingsConflictResolution(
  c: AppContext,
  storeId: string,
  reservationId: string,
  input: SettingsConflictResolutionInput,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.manage')
  if (denied) return denied
  const found = await requireSettingsDraft(c as AppContext, storeId)
  if ('error' in found) return found.error
  const organizationId = c.get('auth').org
  const actorId = c.get('auth').sub
  const resolvedAt = nowIso(requestClock(c))
  const record = {
    draftId: found.row.id,
    reservationId,
    resolution: input.resolution,
    note: input.note,
    resolvedBy: actorId,
    resolvedAt,
  }
  await writeAuditBatch(found.db, {
    clock: requestClock(c),
    operations: [
      found.db
        .insert(settingsDraftConflictResolutions)
        .values({ id: crypto.randomUUID(), organizationId, storeId, ...record })
        .onConflictDoUpdate({
          target: [
            settingsDraftConflictResolutions.draftId,
            settingsDraftConflictResolutions.reservationId,
          ],
          set: { resolution: input.resolution, note: input.note, resolvedBy: actorId, resolvedAt },
        }),
    ],
    events: [
      {
        organizationId,
        storeId,
        actorType: 'user',
        actorId,
        action: 'settings.conflict.resolved',
        entityType: 'reservation',
        entityId: reservationId,
        metadata: { draftId: found.row.id, resolution: input.resolution },
      },
    ],
  })
  return c.json(SettingsConflictResolution.parse(record), 201)
}

async function readPublicationTargets(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  publicationId: string,
) {
  return db
    .select()
    .from(settingsPublicationTargets)
    .where(
      and(
        eq(settingsPublicationTargets.organizationId, organizationId),
        eq(settingsPublicationTargets.publicationId, publicationId),
      ),
    )
}

function toSettingsPublication(
  row: SettingsPublicationRow,
  targets: readonly (typeof settingsPublicationTargets.$inferSelect)[],
): SettingsPublication {
  return SettingsPublication.parse({
    id: row.id,
    versionId: row.versionId,
    draftId: row.draftId,
    status: row.status,
    scheduledForJst: row.scheduledAt === null ? null : instantToJstDateTime(row.scheduledAt),
    scheduledAt: row.scheduledAt,
    executedAt: row.executedAt,
    appliedCount: row.appliedCount,
    failedCount: row.failedCount,
    ledgerEntriesAffected: row.ledgerEntriesAffected,
    webSlotEffect: {
      date: row.slotDate,
      previousSlotCount: row.previousSlotCount,
      publishedSlotCount: row.publishedSlotCount,
    },
    targets: [...targets]
      .sort((left, right) => left.storeId.localeCompare(right.storeId))
      .map((target) => ({
        storeId: target.storeId,
        status: target.status,
        appliedVersion: target.appliedVersion,
        failureReason: target.failureReason,
        appliedAt: target.appliedAt,
      })),
  })
}

/**
 * Apply one draft to every target store that has not already succeeded.
 *
 * Each store is its own `db.batch()` — settings rows, the immutable version
 * snapshot, the target outcome and the audit event commit or roll back
 * together — so a partial failure leaves the successful stores applied and
 * the failed ones retryable without ever applying a version twice
 * (AC-EYEX-103, 107).
 */
async function applyPublicationTargets(
  c: AppContext,
  db: ReturnType<typeof drizzle>,
  publication: SettingsPublicationRow,
  row: SettingsDraftRow,
): Promise<void> {
  const organizationId = c.get('auth').org
  const actorId = c.get('auth').sub
  const clock = requestClock(c)
  const settings = draftSettings(row)
  const origin = SettingsOrigin.parse(row.origin)
  const targets = await readPublicationTargets(db, organizationId, publication.id)

  for (const target of targets) {
    if (target.status === 'applied') continue
    const appliedAt = nowIso(clock)
    try {
      const denied = await requireStorePermission(
        c as StoreContext,
        target.storeId,
        'settings.manage',
      )
      if (denied) throw new Error('store is inactive or not permitted')
      const current = await readAvailabilitySettings(db, organizationId, target.storeId)
      const version = nextVersion(current.version)
      const persisted = AvailabilityStoreSettings.parse({
        // A store other than the draft's own store receives store-local
        // resource ids; the ids are keyed globally and cannot be shared.
        ...(target.storeId === row.storeId
          ? settings
          : await deriveStoreScopedSettings(settings, target.storeId)),
        storeId: target.storeId,
        version,
      })
      const changedFields = changedSettingsFields(current, persisted)
      await writeAuditBatch(db, {
        clock,
        operations: [
          ...availabilitySettingsWriteOperations(
            db,
            organizationId,
            target.storeId,
            persisted,
            actorId,
            appliedAt,
            current.version,
            origin,
          ),
          db.insert(settingsVersions).values({
            id: crypto.randomUUID(),
            organizationId,
            storeId: target.storeId,
            version,
            origin,
            payloadJson: JSON.stringify(toAvailabilitySettingsInput(persisted, 0)),
            changedFieldsJson: JSON.stringify(changedFields),
            sourceDraftId: row.id,
            publicationId: publication.id,
            publishedBy: actorId,
            publishedAt: appliedAt,
          }),
          db
            .update(settingsPublicationTargets)
            .set({
              status: 'applied',
              appliedVersion: version,
              failureReason: null,
              appliedAt,
            })
            .where(
              and(
                eq(settingsPublicationTargets.id, target.id),
                // A target that already succeeded can never be applied again.
                ne(settingsPublicationTargets.status, 'applied'),
              ),
            ),
        ],
        events: [
          {
            organizationId,
            storeId: target.storeId,
            actorType: 'user',
            actorId,
            action: 'settings.published',
            entityType: 'availability_settings',
            entityId: target.storeId,
            metadata: {
              publicationId: publication.id,
              versionId: publication.versionId,
              draftId: row.id,
              fromVersion: current.version,
              toVersion: version,
              changedFields,
            },
          },
        ],
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'settings could not be applied'
      await db
        .update(settingsPublicationTargets)
        .set({ status: 'failed', failureReason: reason.slice(0, 300) })
        .where(
          and(
            eq(settingsPublicationTargets.id, target.id),
            ne(settingsPublicationTargets.status, 'applied'),
          ),
        )
        .run()
    }
  }
}

/** Settle the run: counts, status, executed instant and the draft's own state. */
async function settlePublication(
  c: AppContext,
  db: ReturnType<typeof drizzle>,
  publication: SettingsPublicationRow,
  row: SettingsDraftRow,
): Promise<SettingsPublication> {
  const organizationId = c.get('auth').org
  const actorId = c.get('auth').sub
  const executedAt = nowIso(requestClock(c))
  const targets = await readPublicationTargets(db, organizationId, publication.id)
  const appliedCount = targets.filter((target) => target.status === 'applied').length
  const failedCount = targets.filter((target) => target.status === 'failed').length
  const status = failedCount === 0 ? 'completed' : 'partially_failed'
  await writeAuditBatch(db, {
    clock: requestClock(c),
    operations: [
      db
        .update(settingsPublications)
        .set({ status, appliedCount, failedCount, executedAt, updatedAt: executedAt })
        .where(
          and(
            eq(settingsPublications.organizationId, organizationId),
            eq(settingsPublications.id, publication.id),
          ),
        ),
      db
        .update(settingsDrafts)
        .set({ status: status === 'completed' ? 'published' : 'draft' })
        .where(
          and(eq(settingsDrafts.organizationId, organizationId), eq(settingsDrafts.id, row.id)),
        ),
    ],
    events: [
      {
        organizationId,
        storeId: publication.storeId,
        actorType: 'user',
        actorId,
        action: 'settings.publication.executed',
        entityType: 'settings_publication',
        entityId: publication.id,
        metadata: { status, appliedCount, failedCount, versionId: publication.versionId },
      },
    ],
  })
  return toSettingsPublication(
    { ...publication, status, appliedCount, failedCount, executedAt, updatedAt: executedAt },
    await readPublicationTargets(db, organizationId, publication.id),
  )
}

async function createSettingsPublication(
  c: AppContext,
  storeId: string,
  input: SettingsPublicationRequest,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.manage')
  if (denied) return denied
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const row = await readSettingsDraft(db, organizationId, storeId)
  if (row === undefined || row.id !== input.draftId) {
    return c.json({ error: 'draft_not_found' }, 404)
  }
  const impact = await buildSettingsImpact(c, db, organizationId, row)
  if (!impact.canPublish) {
    return c.json(
      {
        error: 'publication_blocked',
        blockingCount: impact.blockingCount,
        items: impact.items.filter((item) => item.severity === 'blocking'),
      },
      409,
    )
  }
  const clock = requestClock(c)
  const createdAt = nowIso(clock)
  const scheduledAt =
    input.scheduledForJst === undefined ? null : jstDateTimeToInstant(input.scheduledForJst)
  // A scheduled publication always waits for its own run step, even when the
  // instant has already passed: the JST boundary is decided in exactly one
  // place (UC-EYEX-166), never split between creation and execution.
  const runNow = scheduledAt === null
  const publicationId = crypto.randomUUID()
  const publication = {
    id: publicationId,
    organizationId,
    storeId,
    draftId: row.id,
    versionId: crypto.randomUUID(),
    status: runNow ? ('completed' as const) : ('scheduled' as const),
    scheduledAt,
    executedAt: null,
    appliedCount: 0,
    failedCount: 0,
    ledgerEntriesAffected: impact.ledgerEntriesAffected,
    slotDate: impact.publicSlots.date,
    previousSlotCount: impact.publicSlots.publishedCount,
    publishedSlotCount: impact.publicSlots.draftCount,
    createdBy: c.get('auth').sub,
    createdAt,
    updatedAt: createdAt,
  }
  const result = await withIdempotency<SettingsPublication, Record<string, never>>(
    {
      db,
      organizationId,
      operation: 'settings.publication',
      key: input.idempotencyKey,
      requestHash: await requestHash({ storeId, ...input }),
      clock,
    },
    async () => {
      await writeAuditBatch(db, {
        clock,
        operations: [
          db.insert(settingsPublications).values({ ...publication, status: 'scheduled' }),
          db.insert(settingsPublicationTargets).values(
            input.targetStoreIds.map((targetStoreId) => ({
              id: crypto.randomUUID(),
              organizationId,
              publicationId,
              storeId: targetStoreId,
              status: 'pending',
              appliedVersion: null,
              failureReason: null,
              appliedAt: null,
            })),
          ),
          db
            .update(settingsDrafts)
            .set({ status: runNow ? 'draft' : 'scheduled' })
            .where(
              and(eq(settingsDrafts.organizationId, organizationId), eq(settingsDrafts.id, row.id)),
            ),
        ],
        events: [
          {
            organizationId,
            storeId,
            actorType: 'user',
            actorId: c.get('auth').sub,
            action: runNow ? 'settings.publication.started' : 'settings.publication.scheduled',
            entityType: 'settings_publication',
            entityId: publicationId,
            metadata: {
              draftId: row.id,
              versionId: publication.versionId,
              scheduledAt,
              targetStoreIds: [...input.targetStoreIds],
            },
          },
        ],
      })
      const stored = { ...publication, status: 'scheduled' as const }
      if (!runNow) {
        return toSettingsPublication(
          stored,
          await readPublicationTargets(db, organizationId, publicationId),
        )
      }
      await applyPublicationTargets(c, db, stored, row)
      return settlePublication(c, db, stored, row)
    },
  )
  return c.json(result, 201)
}

async function requirePublication(
  c: AppContext,
  storeId: string,
  publicationId: string,
): Promise<
  { error: Response } | { db: ReturnType<typeof drizzle>; publication: SettingsPublicationRow }
> {
  const db = drizzle(c.env.DB)
  const rows = await db
    .select()
    .from(settingsPublications)
    .where(
      and(
        eq(settingsPublications.organizationId, c.get('auth').org),
        eq(settingsPublications.storeId, storeId),
        eq(settingsPublications.id, publicationId),
      ),
    )
  const publication = rows[0]
  if (publication === undefined) return { error: c.json({ error: 'publication_not_found' }, 404) }
  return { db, publication }
}

async function readSettingsPublication(
  c: AppContext,
  storeId: string,
  publicationId: string,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.read')
  if (denied) return denied
  const found = await requirePublication(c, storeId, publicationId)
  if ('error' in found) return found.error
  return c.json(
    toSettingsPublication(
      found.publication,
      await readPublicationTargets(found.db, c.get('auth').org, publicationId),
    ),
  )
}

async function patchSettingsPublication(
  c: AppContext,
  storeId: string,
  publicationId: string,
  input: SettingsPublicationPatch,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.manage')
  if (denied) return denied
  const found = await requirePublication(c, storeId, publicationId)
  if ('error' in found) return found.error
  if (found.publication.status !== 'scheduled') {
    return c.json({ error: 'publication_not_scheduled' }, 409)
  }
  const organizationId = c.get('auth').org
  const updatedAt = nowIso(requestClock(c))
  const scheduledAt =
    input.scheduledForJst === undefined
      ? found.publication.scheduledAt
      : jstDateTimeToInstant(input.scheduledForJst)
  const status = input.status === 'cancelled' ? 'cancelled' : 'scheduled'
  await writeAuditBatch(found.db, {
    clock: requestClock(c),
    operations: [
      found.db
        .update(settingsPublications)
        .set({ scheduledAt, status, updatedAt })
        .where(
          and(
            eq(settingsPublications.organizationId, organizationId),
            eq(settingsPublications.id, publicationId),
          ),
        ),
      ...(status === 'cancelled'
        ? [
            found.db
              .update(settingsDrafts)
              .set({ status: 'draft' })
              .where(
                and(
                  eq(settingsDrafts.organizationId, organizationId),
                  eq(settingsDrafts.id, found.publication.draftId),
                ),
              ),
          ]
        : []),
    ],
    events: [
      {
        organizationId,
        storeId,
        actorType: 'user',
        actorId: c.get('auth').sub,
        action:
          status === 'cancelled'
            ? 'settings.publication.cancelled'
            : 'settings.publication.rescheduled',
        entityType: 'settings_publication',
        entityId: publicationId,
        metadata: { fromScheduledAt: found.publication.scheduledAt, toScheduledAt: scheduledAt },
      },
    ],
  })
  return c.json(
    toSettingsPublication(
      { ...found.publication, scheduledAt, status, updatedAt },
      await readPublicationTargets(found.db, organizationId, publicationId),
    ),
  )
}

/** Execute a scheduled publication once its JST instant has arrived (UC-EYEX-161, 166). */
async function runSettingsPublication(
  c: AppContext,
  storeId: string,
  publicationId: string,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.manage')
  if (denied) return denied
  const found = await requirePublication(c, storeId, publicationId)
  if ('error' in found) return found.error
  if (found.publication.status !== 'scheduled') {
    return c.json({ error: 'publication_not_scheduled' }, 409)
  }
  if (
    found.publication.scheduledAt !== null &&
    !isPublicationDue(found.publication.scheduledAt, requestClock(c).now())
  ) {
    return c.json({ error: 'publication_not_due' }, 409)
  }
  const organizationId = c.get('auth').org
  const row = await readSettingsDraft(found.db, organizationId, storeId)
  if (row === undefined || row.id !== found.publication.draftId) {
    return c.json({ error: 'draft_not_found' }, 404)
  }
  // Re-validate immediately before applying; the world may have moved.
  const impact = await buildSettingsImpact(c, found.db, organizationId, row)
  if (!impact.canPublish) {
    return c.json({ error: 'publication_blocked', blockingCount: impact.blockingCount }, 409)
  }
  await applyPublicationTargets(c, found.db, found.publication, row)
  return c.json(await settlePublication(c, found.db, found.publication, row))
}

/** Retry only the stores that failed; successful stores are skipped (AC-EYEX-107). */
async function retrySettingsPublication(
  c: AppContext,
  storeId: string,
  publicationId: string,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.manage')
  if (denied) return denied
  const found = await requirePublication(c, storeId, publicationId)
  if ('error' in found) return found.error
  if (found.publication.status !== 'partially_failed') {
    return c.json({ error: 'publication_not_retryable' }, 409)
  }
  const organizationId = c.get('auth').org
  const rows = await found.db
    .select()
    .from(settingsDrafts)
    .where(
      and(
        eq(settingsDrafts.organizationId, organizationId),
        eq(settingsDrafts.id, found.publication.draftId),
      ),
    )
  const row = rows[0]
  if (row === undefined) return c.json({ error: 'draft_not_found' }, 404)
  await applyPublicationTargets(c, found.db, found.publication, row)
  return c.json(await settlePublication(c, found.db, found.publication, row))
}

async function listSettingsVersions(c: AppContext, storeId: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.read')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const rows = await db
    .select()
    .from(settingsVersions)
    .where(
      and(
        eq(settingsVersions.organizationId, c.get('auth').org),
        eq(settingsVersions.storeId, storeId),
      ),
    )
    .orderBy(desc(settingsVersions.version))
  return c.json(
    rows.map((row) =>
      SettingsVersionSummary.parse({
        versionId: row.id,
        storeId: row.storeId,
        version: row.version,
        origin: row.origin,
        publishedAt: row.publishedAt,
        publishedBy: row.publishedBy,
        changedFields: parseJson(row.changedFieldsJson, 'changed fields'),
      }),
    ),
  )
}

async function requireSettingsVersion(
  c: AppContext,
  storeId: string,
  versionId: string,
): Promise<
  | { error: Response }
  | { db: ReturnType<typeof drizzle>; row: typeof settingsVersions.$inferSelect }
> {
  const db = drizzle(c.env.DB)
  const rows = await db
    .select()
    .from(settingsVersions)
    .where(
      and(
        eq(settingsVersions.organizationId, c.get('auth').org),
        eq(settingsVersions.storeId, storeId),
        eq(settingsVersions.id, versionId),
      ),
    )
  const row = rows[0]
  if (row === undefined) return { error: c.json({ error: 'version_not_found' }, 404) }
  return { db, row }
}

async function readSettingsVersion(
  c: AppContext,
  storeId: string,
  versionId: string,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.read')
  if (denied) return denied
  const found = await requireSettingsVersion(c, storeId, versionId)
  if ('error' in found) return found.error
  const settings = parseSettingsPayload(found.row.payloadJson, storeId, found.row.version)
  const previous = await found.db
    .select()
    .from(settingsVersions)
    .where(
      and(
        eq(settingsVersions.organizationId, c.get('auth').org),
        eq(settingsVersions.storeId, storeId),
        lt(settingsVersions.version, found.row.version),
      ),
    )
    .orderBy(desc(settingsVersions.version))
    .limit(1)
  const before =
    previous[0] === undefined
      ? emptyAvailabilitySettings(storeId)
      : parseSettingsPayload(previous[0].payloadJson, storeId, previous[0].version)
  return c.json(
    SettingsVersionDetail.parse({
      versionId: found.row.id,
      storeId,
      version: found.row.version,
      origin: found.row.origin,
      publishedAt: found.row.publishedAt,
      publishedBy: found.row.publishedBy,
      changedFields: parseJson(found.row.changedFieldsJson, 'changed fields'),
      settings,
      diff: settingsDiff(before, settings),
    }),
  )
}

/** A past version is never republished directly; it becomes a new draft (AC-EYEX-108). */
async function restoreSettingsVersion(
  c: AppContext,
  storeId: string,
  versionId: string,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.manage')
  if (denied) return denied
  const found = await requireSettingsVersion(c, storeId, versionId)
  if ('error' in found) return found.error
  const current = await readAvailabilitySettings(found.db, c.get('auth').org, storeId)
  const settings = parseSettingsPayload(found.row.payloadJson, storeId, current.version)
  const draft = await persistSettingsDraft(c, storeId, {
    settings: toAvailabilitySettingsInput(settings, current.version),
    status: 'draft',
    origin: SettingsOrigin.parse(found.row.origin),
    restoredFromVersionId: versionId,
    action: 'settings.draft.restored',
  })
  return c.json(draft, 201)
}

async function readChainDefaultRow(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
): Promise<typeof settingsChainDefaults.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(settingsChainDefaults)
    .where(eq(settingsChainDefaults.organizationId, organizationId))
  return rows[0]
}

async function saveChainDefault(
  c: AppContext,
  storeId: string,
  input: SettingsDraftInput,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.manage')
  if (denied) return denied
  validateAvailabilityReferences(input.settings)
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const actorId = c.get('auth').sub
  const updatedAt = nowIso(requestClock(c))
  const existing = await readChainDefaultRow(db, organizationId)
  const version = (existing?.version ?? 0) + 1
  const settings = AvailabilitySettingsInput.parse({ ...input.settings, version })
  const payloadJson = JSON.stringify({ ...settings, version: 0 })
  const values = {
    id: existing?.id ?? crypto.randomUUID(),
    organizationId,
    version,
    payloadJson,
    updatedBy: actorId,
    updatedAt,
  }
  await writeAuditBatch(db, {
    clock: requestClock(c),
    operations: [
      existing === undefined
        ? db.insert(settingsChainDefaults).values(values)
        : db
            .update(settingsChainDefaults)
            .set(values)
            .where(eq(settingsChainDefaults.organizationId, organizationId)),
    ],
    events: [
      {
        organizationId,
        storeId,
        actorType: 'user',
        actorId,
        action: 'settings.chain_default.updated',
        entityType: 'settings_chain_default',
        entityId: values.id,
        metadata: { fromVersion: existing?.version ?? 0, toVersion: version },
      },
    ],
  })
  return c.json(
    SettingsChainDefault.parse({ version, updatedAt, updatedBy: actorId, settings }),
    201,
  )
}

async function readChainDefault(c: AppContext, storeId: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.read')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const row = await readChainDefaultRow(db, c.get('auth').org)
  if (row === undefined) return c.json({ error: 'chain_default_not_found' }, 404)
  return c.json(
    SettingsChainDefault.parse({
      version: row.version,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      settings: AvailabilitySettingsInput.parse({
        ...(parseJson(row.payloadJson, 'chain default payload') as Record<string, unknown>),
        version: row.version,
      }),
    }),
  )
}

async function readSettingsOverride(c: AppContext, storeId: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.read')
  if (denied) return denied
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const [rows, chain, current] = await Promise.all([
    db
      .select({ origin: availabilitySettings.origin })
      .from(availabilitySettings)
      .where(
        and(
          eq(availabilitySettings.organizationId, organizationId),
          eq(availabilitySettings.storeId, storeId),
        ),
      ),
    readChainDefaultRow(db, organizationId),
    readAvailabilitySettings(db, organizationId, storeId),
  ])
  // Rows written before this loop existed carry no origin and are, by
  // definition, a store-local value rather than a distributed chain value.
  const origin = SettingsOrigin.parse(rows[0]?.origin ?? 'store_override')
  const chainSettings =
    chain === undefined
      ? emptyAvailabilitySettings(storeId)
      : parseSettingsPayload(chain.payloadJson, storeId, current.version)
  return c.json(
    SettingsOverrideView.parse({
      storeId,
      origin,
      chainVersion: chain?.version ?? 0,
      overriddenFields: chain === undefined ? [] : changedSettingsFields(chainSettings, current),
    }),
  )
}

/** Show the new common value and its impact before the store returns to it (AC-EYEX-104). */
async function releaseSettingsOverride(c: AppContext, storeId: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.manage')
  if (denied) return denied
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const chain = await readChainDefaultRow(db, organizationId)
  if (chain === undefined) return c.json({ error: 'chain_default_not_found' }, 404)
  const current = await readAvailabilitySettings(db, organizationId, storeId)
  const settings = AvailabilitySettingsInput.parse({
    ...(parseJson(chain.payloadJson, 'chain default payload') as Record<string, unknown>),
    version: current.version,
  })
  const draft = await persistSettingsDraft(c, storeId, {
    settings,
    status: 'draft',
    origin: 'chain',
    action: 'settings.override.released',
  })
  const row = await readSettingsDraft(db, organizationId, storeId)
  if (row === undefined) return c.json({ error: 'draft_not_found' }, 404)
  return c.json(
    SettingsOverrideRelease.parse({
      chainVersion: chain.version,
      draft,
      impact: await buildSettingsImpact(c, db, organizationId, row),
    }),
    201,
  )
}

/* ------------------------------------------------------------------ *
 * Recording storage, playback, retention, legal hold and deletion.
 * The audio body lives only in the private R2 bucket; D1 keeps the
 * metadata that makes a deletion provable. There is no download API.
 * ------------------------------------------------------------------ */

type RecordingRow = typeof recordings.$inferSelect

/** Who performed a recording management action, for the audit trail. */
type RecordingActor = {
  actorType: 'user' | 'shared_terminal'
  actorId: string
  /** The person behind a shared terminal, proven by personal reauthentication. */
  reauthenticatedUserId?: string
}

function staffRecordingActor(c: AppContext): RecordingActor {
  return { actorType: 'user', actorId: c.get('auth').sub }
}

function recordingPersonId(actor: RecordingActor): string {
  return actor.reauthenticatedUserId ?? actor.actorId
}

function toRecording(row: RecordingRow) {
  return Recording.parse({
    id: row.id,
    organizationId: row.organizationId,
    storeId: row.storeId,
    receptionSessionId: row.receptionSessionId,
    reservationId: row.reservationId,
    recorderType: row.recorderType,
    recorderId: row.recorderId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSeconds: row.durationSeconds,
    endReason: row.endReason,
    state: row.state,
    retentionUntil: row.retentionUntil,
    holdReason: row.holdReason,
    heldBy: row.heldBy,
    heldAt: row.heldAt,
    deletedAt: row.deletedAt,
    failureReason: row.failureReason,
    version: row.version,
  })
}

/** Always scoped by the JWT organization and the authorized store. */
async function findRecordingRow(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
  recordingId: string,
): Promise<RecordingRow | undefined> {
  const rows = await db
    .select()
    .from(recordings)
    .where(
      and(
        eq(recordings.id, recordingId),
        eq(recordings.organizationId, organizationId),
        eq(recordings.storeId, storeId),
      ),
    )
  return rows[0]
}

type RecordingAccess =
  | { error: Response }
  | { db: ReturnType<typeof drizzle>; organizationId: string; row: RecordingRow }

async function accessRecording(
  c: AppContext,
  storeId: string,
  recordingId: string,
  permission: 'recording.read' | 'recording.manage',
): Promise<RecordingAccess> {
  const denied = await requireStorePermission(c as StoreContext, storeId, permission)
  if (denied) return { error: denied }
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const row = await findRecordingRow(db, organizationId, storeId, recordingId)
  // A recording from another store or tenant is indistinguishable from one
  // that never existed.
  if (!row) return { error: c.json({ error: 'not_found' }, 404) }
  return { db, organizationId, row }
}

function recordingStateError(c: AppContext, error: unknown): Response | null {
  if (error instanceof RecordingTransitionError) {
    return c.json({ error: error.code, from: error.from, to: error.to }, error.status)
  }
  if (error instanceof VersionConflictError) {
    return c.json({ error: error.code, currentVersion: error.currentVersion }, error.status)
  }
  if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
  return null
}

async function readRecordingRetentionSettings(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
) {
  const rows = await db
    .select()
    .from(recordingRetentionSettings)
    .where(
      and(
        eq(recordingRetentionSettings.organizationId, organizationId),
        eq(recordingRetentionSettings.storeId, storeId),
      ),
    )
  const row = rows[0]
  return {
    confirmedRetentionDays: row?.confirmedRetentionDays ?? MINIMUM_CONFIRMED_RETENTION_DAYS,
    discardedRetentionHours: row?.discardedRetentionHours ?? MINIMUM_DISCARDED_RETENTION_HOURS,
    updatedAt: row?.updatedAt ?? null,
  }
}

async function recordingRetentionUntil(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
  row: Pick<RecordingRow, 'endedAt' | 'reservationId'>,
): Promise<string> {
  const settings = await readRecordingRetentionSettings(db, organizationId, storeId)
  return retentionDeadline({
    endedAt: row.endedAt,
    hasReservation: row.reservationId !== null,
    confirmedRetentionDays: settings.confirmedRetentionDays,
    discardedRetentionHours: settings.discardedRetentionHours,
  })
}

async function createRecordingMetadata(
  c: AppContext,
  storeId: string,
  input: RecordingMetadataCreate,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'recording.manage')
  if (denied) return denied
  const organizationId = c.get('auth').org
  /*
   * 録音主体はセッションが決める。本文の申告を採ると、誰でも他人の名前で録音を
   * 残せてしまい、監査に残る操作主体(AC-EYEX-80)と食い違う。共有端末の録音は
   * 端末認証の経路だけが名乗れる。
   */
  const terminal = c.get('sharedTerminal')
  const expectedRecorderType = terminal === undefined ? 'personal' : 'shared_terminal'
  if (input.recorderType !== expectedRecorderType) return c.json({ error: 'invalid_recorder' }, 400)
  const recorder =
    terminal === undefined
      ? { type: 'personal' as const, id: c.get('auth').sub }
      : { type: 'shared_terminal' as const, id: terminal.id }
  const db = drizzle(c.env.DB)
  const clock = requestClock(c)
  try {
    const recording = await withIdempotency<Recording, Record<string, never>>(
      {
        db,
        organizationId,
        operation: `recording_metadata_create:${storeId}`,
        key: input.idempotencyKey,
        requestHash: await requestHash({ storeId, ...input }),
        clock,
      },
      async (completeInBatch) => {
        const id = crypto.randomUUID()
        const createdAt = nowIso(clock)
        const storageKey = recordingStorageKey({
          organizationId,
          storeId,
          recordingId: id,
          secret: recordingKeySecret(),
        })
        const row = {
          id,
          organizationId,
          storeId,
          receptionSessionId: input.receptionSessionId,
          reservationId: input.reservationId,
          recorderType: recorder.type,
          recorderId: recorder.id,
          startedAt: input.startedAt,
          endedAt: input.endedAt,
          durationSeconds: input.durationSeconds,
          endReason: input.endReason,
          // The body has not arrived yet; retention starts once it is stored.
          state: 'uploading' as const,
          contentType: input.contentType,
          storageKey,
          retentionUntil: null,
          holdReason: null,
          heldBy: null,
          heldAt: null,
          failureReason: null,
          deletedAt: null,
          createdAt,
          updatedAt: createdAt,
          version: 1,
        }
        const view = toRecording(row)
        await writeAuditBatch(db, {
          clock,
          operations: [db.insert(recordings).values(row), completeInBatch(view)],
          events: [
            {
              organizationId,
              storeId,
              actorType: 'user',
              actorId: c.get('auth').sub,
              action: 'recording.metadata_created',
              entityType: 'recording',
              entityId: id,
              metadata: {
                receptionSessionId: input.receptionSessionId,
                reservationId: input.reservationId,
                endReason: input.endReason,
                durationSeconds: input.durationSeconds,
              },
            },
          ],
        })
        return view
      },
    )
    return c.json(recording, 201)
  } catch (error) {
    if (error instanceof IdempotencyConflictError || error instanceof IdempotencyInProgressError) {
      return c.json({ error: error.code }, error.status)
    }
    const mapped = recordingStateError(c, error)
    if (mapped) {
      // A second recording for the same reception session collides with the
      // unique index and reaches this boundary as a rolled-back batch.
      return c.json({ error: 'recording_session_exists' }, 409)
    }
    throw error
  }
}

async function uploadRecordingAudio(
  c: AppContext,
  storeId: string,
  recordingId: string,
): Promise<Response> {
  const access = await accessRecording(c, storeId, recordingId, 'recording.manage')
  if ('error' in access) return access.error
  const { db, organizationId, row } = access
  // A resent body must not create a second object or a second audit event.
  if (row.state === 'stored') return c.json(toRecording(row))
  const clock = requestClock(c)
  const audio = await c.req.arrayBuffer()
  if (audio.byteLength === 0) {
    try {
      await writeAuditBatch(db, {
        clock,
        operations: [
          db
            .update(recordings)
            .set({
              state: 'failed',
              failureReason: 'empty_audio_body',
              updatedAt: nowIso(clock),
              version: nextVersion(row.version),
            })
            .where(and(eq(recordings.id, row.id), eq(recordings.version, row.version))),
        ],
        events: [
          {
            organizationId,
            storeId,
            actorType: 'user',
            actorId: c.get('auth').sub,
            action: 'recording.upload_failed',
            entityType: 'recording',
            entityId: row.id,
            metadata: { reason: 'empty_audio_body' },
          },
        ],
      })
    } catch (error) {
      const mapped = recordingStateError(c, error)
      if (mapped) return mapped
      throw error
    }
    return c.json({ error: 'empty_audio_body' }, 400)
  }
  try {
    assertRecordingTransition(row.state as RecordingState, 'stored')
  } catch (error) {
    const mapped = recordingStateError(c, error)
    if (mapped) return mapped
    throw error
  }
  await c.env.RECORDINGS.put(row.storageKey, audio, {
    httpMetadata: { contentType: row.contentType },
  })
  const retentionUntil = await recordingRetentionUntil(db, organizationId, storeId, row)
  try {
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .update(recordings)
          .set({
            state: 'stored',
            retentionUntil,
            failureReason: null,
            updatedAt: nowIso(clock),
            version: nextVersion(row.version),
          })
          .where(and(eq(recordings.id, row.id), eq(recordings.version, row.version))),
      ],
      events: [
        {
          organizationId,
          storeId,
          actorType: 'user',
          actorId: c.get('auth').sub,
          action: 'recording.stored',
          entityType: 'recording',
          entityId: row.id,
          metadata: { retentionUntil, byteLength: audio.byteLength },
        },
      ],
    })
  } catch (error) {
    // The metadata write is the source of truth. An object without it would be
    // invisible to reconciliation, so remove it again.
    await c.env.RECORDINGS.delete(row.storageKey)
    const mapped = recordingStateError(c, error)
    if (mapped) return mapped
    throw error
  }
  return c.json(
    toRecording({
      ...row,
      state: 'stored',
      retentionUntil,
      failureReason: null,
      version: nextVersion(row.version),
    }),
  )
}

async function playRecording(
  c: AppContext,
  storeId: string,
  recordingId: string,
): Promise<Response> {
  const access = await accessRecording(c, storeId, recordingId, 'recording.read')
  if ('error' in access) return access.error
  const { db, organizationId, row } = access
  if (row.state === 'deleted') return c.json({ error: 'recording_deleted' }, 410)
  if (row.state !== 'stored' && row.state !== 'held' && row.state !== 'pending_deletion') {
    return c.json({ error: 'invalid_recording_state', state: row.state }, 409)
  }
  const rangeHeader = c.req.header('range')
  const object = await c.env.RECORDINGS.get(row.storageKey, {
    range: rangeHeader === undefined ? undefined : c.req.raw.headers,
  })
  if (!object || !('body' in object) || object.body === null) {
    return c.json({ error: 'recording_object_missing' }, 404)
  }
  const clock = requestClock(c)
  try {
    await writeAuditBatch(db, {
      clock,
      events: [
        {
          organizationId,
          storeId,
          actorType: 'user',
          actorId: c.get('auth').sub,
          action: 'recording.played',
          entityType: 'recording',
          entityId: row.id,
          metadata: {
            reservationId: row.reservationId,
            receptionSessionId: row.receptionSessionId,
            playedAt: nowIso(clock),
            ranged: rangeHeader !== undefined,
          },
        },
      ],
    })
  } catch (error) {
    const mapped = recordingStateError(c, error)
    if (mapped) return mapped
    throw error
  }
  const headers = new Headers({
    'content-type': row.contentType,
    // Streaming playback only. Never an attachment, never a signed URL.
    'content-disposition': 'inline',
    'accept-ranges': 'bytes',
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
  })
  const range = object.range
  if (rangeHeader !== undefined && range && 'offset' in range && 'length' in range) {
    const offset = range.offset ?? 0
    const length = range.length ?? object.size - offset
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`)
    headers.set('content-length', String(length))
    return new Response(object.body as unknown as BodyInit, { status: 206, headers })
  }
  headers.set('content-length', String(object.size))
  return new Response(object.body as unknown as BodyInit, { status: 200, headers })
}

async function listRecordings(
  c: AppContext,
  storeId: string,
  query: RecordingListQuery,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'recording.read')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const conditions = [
    eq(recordings.organizationId, c.get('auth').org),
    eq(recordings.storeId, storeId),
  ]
  if (query.state) conditions.push(eq(recordings.state, query.state))
  const rows = await db
    .select()
    .from(recordings)
    .where(and(...conditions))
    .orderBy(desc(recordings.createdAt))
  return c.json(Recording.array().parse(rows.map(toRecording)))
}

async function readRecording(
  c: AppContext,
  storeId: string,
  recordingId: string,
): Promise<Response> {
  const access = await accessRecording(c, storeId, recordingId, 'recording.read')
  if ('error' in access) return access.error
  return c.json(toRecording(access.row))
}

async function retryRecordingUpload(
  c: AppContext,
  storeId: string,
  recordingId: string,
): Promise<Response> {
  const access = await accessRecording(c, storeId, recordingId, 'recording.manage')
  if ('error' in access) return access.error
  const { db, organizationId, row } = access
  const clock = requestClock(c)
  try {
    assertRecordingTransition(row.state as RecordingState, 'uploading')
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .update(recordings)
          .set({
            state: 'uploading',
            failureReason: null,
            updatedAt: nowIso(clock),
            version: nextVersion(row.version),
          })
          .where(and(eq(recordings.id, row.id), eq(recordings.version, row.version))),
      ],
      events: [
        {
          organizationId,
          storeId,
          actorType: 'user',
          actorId: c.get('auth').sub,
          action: 'recording.retry_requested',
          entityType: 'recording',
          entityId: row.id,
          metadata: { previousFailureReason: row.failureReason },
        },
      ],
    })
  } catch (error) {
    const mapped = recordingStateError(c, error)
    if (mapped) return mapped
    throw error
  }
  return c.json(
    toRecording({
      ...row,
      state: 'uploading',
      failureReason: null,
      version: nextVersion(row.version),
    }),
  )
}

async function linkRecordingReservation(
  c: AppContext,
  storeId: string,
  recordingId: string,
  input: RecordingReservationLink,
): Promise<Response> {
  const access = await accessRecording(c, storeId, recordingId, 'recording.manage')
  if ('error' in access) return access.error
  const { db, organizationId, row } = access
  if (row.state === 'deleted') return c.json({ error: 'recording_deleted' }, 410)
  const clock = requestClock(c)
  const linked = { ...row, reservationId: input.reservationId }
  const retentionUntil = await recordingRetentionUntil(db, organizationId, storeId, linked)
  try {
    await assertVersion(row.version, input.version)
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .update(recordings)
          .set({
            reservationId: input.reservationId,
            retentionUntil,
            updatedAt: nowIso(clock),
            version: nextVersion(row.version),
          })
          .where(and(eq(recordings.id, row.id), eq(recordings.version, row.version))),
      ],
      events: [
        {
          organizationId,
          storeId,
          actorType: 'user',
          actorId: c.get('auth').sub,
          action: 'recording.reservation_linked',
          entityType: 'recording',
          entityId: row.id,
          metadata: { reservationId: input.reservationId, retentionUntil },
        },
      ],
    })
  } catch (error) {
    const mapped = recordingStateError(c, error)
    if (mapped) return mapped
    throw error
  }
  return c.json(toRecording({ ...linked, retentionUntil, version: nextVersion(row.version) }))
}

async function holdRecording(
  c: AppContext,
  storeId: string,
  recordingId: string,
  input: RecordingHoldInput,
  actor: RecordingActor,
): Promise<Response> {
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const row = await findRecordingRow(db, organizationId, storeId, recordingId)
  if (!row) return c.json({ error: 'not_found' }, 404)
  const clock = requestClock(c)
  const heldAt = nowIso(clock)
  const heldBy = recordingPersonId(actor)
  try {
    await assertVersion(row.version, input.version)
    assertRecordingTransition(row.state as RecordingState, 'held')
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .update(recordings)
          .set({
            state: 'held',
            holdReason: input.reason,
            heldBy,
            heldAt,
            updatedAt: heldAt,
            version: nextVersion(row.version),
          })
          .where(and(eq(recordings.id, row.id), eq(recordings.version, row.version))),
      ],
      events: [
        {
          organizationId,
          storeId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'recording.held',
          entityType: 'recording',
          entityId: row.id,
          metadata: {
            reason: input.reason,
            heldBy,
            reauthenticatedUserId: actor.reauthenticatedUserId ?? null,
          },
        },
      ],
    })
  } catch (error) {
    const mapped = recordingStateError(c, error)
    if (mapped) return mapped
    throw error
  }
  return c.json(
    toRecording({
      ...row,
      state: 'held',
      holdReason: input.reason,
      heldBy,
      heldAt,
      version: nextVersion(row.version),
    }),
  )
}

async function releaseRecordingHold(
  c: AppContext,
  storeId: string,
  recordingId: string,
  input: RecordingHoldRelease,
  actor: RecordingActor,
): Promise<Response> {
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const row = await findRecordingRow(db, organizationId, storeId, recordingId)
  if (!row) return c.json({ error: 'not_found' }, 404)
  const clock = requestClock(c)
  const releasedAt = nowIso(clock)
  try {
    await assertVersion(row.version, input.version)
    assertRecordingTransition(row.state as RecordingState, 'stored')
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .update(recordings)
          .set({
            state: 'stored',
            holdReason: null,
            heldBy: null,
            heldAt: null,
            updatedAt: releasedAt,
            version: nextVersion(row.version),
          })
          .where(and(eq(recordings.id, row.id), eq(recordings.version, row.version))),
      ],
      events: [
        {
          organizationId,
          storeId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'recording.hold_released',
          entityType: 'recording',
          entityId: row.id,
          metadata: {
            reason: input.reason,
            previousHoldReason: row.holdReason,
            releasedBy: recordingPersonId(actor),
            reauthenticatedUserId: actor.reauthenticatedUserId ?? null,
          },
        },
      ],
    })
  } catch (error) {
    const mapped = recordingStateError(c, error)
    if (mapped) return mapped
    throw error
  }
  return c.json(
    toRecording({
      ...row,
      state: 'stored',
      holdReason: null,
      heldBy: null,
      heldAt: null,
      version: nextVersion(row.version),
    }),
  )
}

async function deleteRecording(
  c: AppContext,
  storeId: string,
  recordingId: string,
): Promise<Response> {
  const access = await accessRecording(c, storeId, recordingId, 'recording.manage')
  if ('error' in access) return access.error
  const { db, organizationId, row } = access
  if (row.state === 'deleted') return c.json(toRecording(row))
  // A legal hold survives both routine and manual deletion.
  if (row.state === 'held') {
    return c.json({ error: 'recording_held', holdReason: row.holdReason }, 409)
  }
  if (row.retentionUntil !== null && retentionIsActive(row.retentionUntil, requestClock(c).now())) {
    return c.json(
      {
        error: 'retention_active',
        retentionUntil: row.retentionUntil,
        minimumRetentionUntil: minimumRetentionDeadline(row.endedAt, row.reservationId !== null),
      },
      409,
    )
  }
  const clock = requestClock(c)
  try {
    assertRecordingTransition(row.state as RecordingState, 'deleted')
  } catch (error) {
    const mapped = recordingStateError(c, error)
    if (mapped) return mapped
    throw error
  }
  const deletedAt = nowIso(clock)
  await c.env.RECORDINGS.delete(row.storageKey)
  try {
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .update(recordings)
          .set({
            state: 'deleted',
            deletedAt,
            updatedAt: deletedAt,
            version: nextVersion(row.version),
          })
          .where(and(eq(recordings.id, row.id), eq(recordings.version, row.version))),
      ],
      events: [
        {
          organizationId,
          storeId,
          actorType: 'user',
          actorId: c.get('auth').sub,
          action: 'recording.deleted',
          entityType: 'recording',
          entityId: row.id,
          metadata: { trigger: 'manual', retentionUntil: row.retentionUntil },
        },
      ],
    })
  } catch (error) {
    const mapped = recordingStateError(c, error)
    if (mapped) return mapped
    throw error
  }
  return c.json(
    toRecording({ ...row, state: 'deleted', deletedAt, version: nextVersion(row.version) }),
  )
}

async function readRecordingRetention(c: AppContext, storeId: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'recording.manage')
  if (denied) return denied
  const settings = await readRecordingRetentionSettings(
    drizzle(c.env.DB),
    c.get('auth').org,
    storeId,
  )
  return c.json(
    RecordingRetentionSettings.parse({
      confirmedRetentionDays: settings.confirmedRetentionDays,
      discardedRetentionHours: settings.discardedRetentionHours,
      updatedAt: settings.updatedAt ?? nowIso(requestClock(c)),
    }),
  )
}

async function saveRecordingRetention(
  c: AppContext,
  storeId: string,
  input: RecordingRetentionSettingsInput,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'recording.manage')
  if (denied) return denied
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const clock = requestClock(c)
  const updatedAt = nowIso(clock)
  const existing = await readRecordingRetentionSettings(db, organizationId, storeId)
  try {
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .insert(recordingRetentionSettings)
          .values({
            id: crypto.randomUUID(),
            organizationId,
            storeId,
            confirmedRetentionDays: input.confirmedRetentionDays,
            discardedRetentionHours: input.discardedRetentionHours,
            createdAt: updatedAt,
            updatedAt,
          })
          .onConflictDoUpdate({
            target: [recordingRetentionSettings.organizationId, recordingRetentionSettings.storeId],
            set: {
              confirmedRetentionDays: input.confirmedRetentionDays,
              discardedRetentionHours: input.discardedRetentionHours,
              updatedAt,
            },
          }),
      ],
      events: [
        {
          organizationId,
          storeId,
          actorType: 'user',
          actorId: c.get('auth').sub,
          action: 'recording.retention_configured',
          entityType: 'recording_retention_settings',
          entityId: storeId,
          metadata: {
            from: {
              confirmedRetentionDays: existing.confirmedRetentionDays,
              discardedRetentionHours: existing.discardedRetentionHours,
            },
            to: {
              confirmedRetentionDays: input.confirmedRetentionDays,
              discardedRetentionHours: input.discardedRetentionHours,
            },
          },
        },
      ],
    })
  } catch (error) {
    const mapped = recordingStateError(c, error)
    if (mapped) return mapped
    throw error
  }
  return c.json(
    RecordingRetentionSettings.parse({
      confirmedRetentionDays: input.confirmedRetentionDays,
      discardedRetentionHours: input.discardedRetentionHours,
      updatedAt,
    }),
  )
}

/**
 * Compare R2 against D1 for one organization.
 *
 * R2 lifecycle rules alone cannot prove a body is gone, so this pass deletes
 * what is due, verifies what should exist, and records every divergence as an
 * audit event. It is deliberately an internal endpoint: no cron trigger is
 * registered, because adding one is an architecture decision.
 */
async function reconcileRecordings(
  c: AppContext,
  input: RecordingReconciliationRequest,
): Promise<Response> {
  const db = drizzle(c.env.DB)
  const organization = (
    await db.select().from(organizations).where(eq(organizations.id, input.organizationId))
  )[0]
  if (!organization) return c.json({ error: 'organization_not_found' }, 404)
  const clock = requestClock(c)
  const now = clock.now()
  const rows = await db
    .select()
    .from(recordings)
    .where(
      and(
        eq(recordings.organizationId, input.organizationId),
        inArray(recordings.state, ['stored', 'pending_deletion', 'held', 'deleted']),
      ),
    )
    .orderBy(asc(recordings.createdAt))
    .limit(input.limit)

  let deleted = 0
  let retained = 0
  let held = 0
  const mismatches: RecordingReconciliationMismatch[] = []
  const mismatchEvents: Parameters<typeof writeAuditBatch>[1]['events'][number][] = []

  const recordMismatch = (row: RecordingRow, kind: RecordingReconciliationMismatch['kind']) => {
    mismatches.push(RecordingReconciliationMismatch.parse({ recordingId: row.id, kind }))
    mismatchEvents.push({
      organizationId: row.organizationId,
      storeId: row.storeId,
      actorType: 'system',
      actorId: 'recording-reconciliation',
      action: 'recording.reconciliation_mismatch',
      entityType: 'recording',
      entityId: row.id,
      metadata: { kind, state: row.state, retentionUntil: row.retentionUntil },
    })
  }

  for (const row of rows) {
    if (row.state === 'deleted') {
      // A body that survived a recorded deletion must never look like success.
      if ((await c.env.RECORDINGS.head(row.storageKey)) !== null) {
        recordMismatch(row, 'object_present_after_deletion')
      }
      continue
    }
    if (row.state === 'held') {
      held += 1
      continue
    }
    if (row.retentionUntil === null || retentionIsActive(row.retentionUntil, now)) {
      retained += 1
      if ((await c.env.RECORDINGS.head(row.storageKey)) === null) {
        recordMismatch(row, 'object_missing')
      }
      continue
    }
    try {
      await c.env.RECORDINGS.delete(row.storageKey)
    } catch {
      recordMismatch(row, 'delete_failed')
      continue
    }
    const deletedAt = nowIso(clock)
    try {
      await writeAuditBatch(db, {
        clock,
        operations: [
          db
            .update(recordings)
            .set({
              state: 'deleted',
              deletedAt,
              updatedAt: deletedAt,
              version: nextVersion(row.version),
            })
            .where(and(eq(recordings.id, row.id), eq(recordings.version, row.version))),
        ],
        events: [
          {
            organizationId: row.organizationId,
            storeId: row.storeId,
            actorType: 'system',
            actorId: 'recording-reconciliation',
            action: 'recording.deleted',
            entityType: 'recording',
            entityId: row.id,
            metadata: { trigger: 'retention_expired', retentionUntil: row.retentionUntil },
          },
        ],
      })
      deleted += 1
    } catch (error) {
      if (!(error instanceof AuditAppendError)) throw error
      recordMismatch(row, 'delete_failed')
    }
  }

  if (mismatchEvents.length > 0) {
    await writeAuditBatch(db, { clock, events: mismatchEvents })
  }
  return c.json(
    RecordingReconciliationReport.parse({
      scanned: rows.length,
      deleted,
      retained,
      held,
      mismatches,
    }),
  )
}

/**
 * A shared iPad may never manage a recording on the strength of the device
 * alone: the acting person must reauthenticate personally and must themselves
 * hold `recording.manage` in the terminal's store.
 */
async function sharedTerminalRecordingManager(
  c: AppContext,
  terminalId: string,
  storeId: string,
): Promise<Response | RecordingActor> {
  const denied = await requirePersonalReauth(c, terminalId, 'management', requestClock(c))
  if (denied) return denied
  const reauthenticatedUserId = c.get('personalReauthUserId')
  if (!reauthenticatedUserId) return c.json({ error: 'reauth_unauthorized' }, 401)
  const db = drizzle(c.env.DB)
  const terminal = (
    await db
      .select()
      .from(sharedTerminals)
      .where(and(eq(sharedTerminals.id, terminalId), eq(sharedTerminals.storeId, storeId)))
  )[0]
  if (!terminal) return c.json({ error: 'forbidden' }, 403)
  const memberships = await db
    .select({ permissions: storeMemberships.permissions })
    .from(storeMemberships)
    .where(
      and(
        eq(storeMemberships.organizationId, terminal.organizationId),
        eq(storeMemberships.storeId, terminal.storeId),
        eq(storeMemberships.userId, reauthenticatedUserId),
      ),
    )
  const mayManage = memberships.some((membership) => {
    try {
      return StorePermission.array()
        .parse(JSON.parse(membership.permissions))
        .includes('recording.manage')
    } catch {
      return false
    }
  })
  if (!mayManage) return c.json({ error: 'forbidden' }, 403)
  c.set(
    'auth' as never,
    {
      sub: terminal.id,
      org: terminal.organizationId,
      email: 'shared-terminal@internal.invalid',
      role: 'staff',
    } as never,
  )
  return {
    actorType: 'shared_terminal',
    actorId: terminal.id,
    reauthenticatedUserId,
  }
}

/* ------------------------------------------------------------------ *
 * 注意事項 (UC-EYEX-139〜148), 監査検索 (UC-EYEX-155), 顧客統合 (UC-EYEX-181)
 * ------------------------------------------------------------------ */

const ATTENTION_PERMISSION: Record<AttentionCapability, StorePermissionValue> = {
  read: 'attention.read',
  write: 'attention.write',
  publish: 'attention.publish',
  revise: 'attention.revise',
  hide: 'attention.hide',
}

/**
 * The person and device behind one 注意事項 operation. A shared iPad is always
 * the actor of record; `personId` is the individual credited with the change,
 * proven by personal reauthentication on that device (AC-EYEX-87).
 */
type AttentionActor = {
  actorType: 'user' | 'shared_terminal'
  actorId: string
  personId: string
  reauthenticatedUserId?: string
}

/** A request-scoped correlation id, carried into every audit row it writes. */
function correlationId(c: AppContext): string {
  return c.req.header('x-request-id')?.trim() || crypto.randomUUID()
}

async function readAttentionSettings(c: AppContext, storeId: string): Promise<AttentionSettings> {
  const organizationId = c.get('auth').org
  const rows = await drizzle(c.env.DB)
    .select()
    .from(attentionSettings)
    .where(
      and(
        eq(attentionSettings.organizationId, organizationId),
        inArray(attentionSettings.storeId, [ATTENTION_ORGANIZATION_SCOPE, storeId]),
      ),
    )
  return resolveAttentionSettings({
    storeId,
    organization: rows.find((row) => row.storeId === ATTENTION_ORGANIZATION_SCOPE) ?? null,
    store: rows.find((row) => row.storeId === storeId) ?? null,
  })
}

/**
 * Authorize one 注意事項 capability. The store permission and the configured
 * minimum role must *both* hold: configuration can only narrow what a
 * membership already grants, never widen it.
 */
async function attentionAccess(
  c: AppContext,
  storeId: string,
  capability: AttentionCapability,
): Promise<Response | { settings: AttentionSettings; actor: AttentionActor }> {
  const access = await authorizedStore(c as StoreContext, storeId, ATTENTION_PERMISSION[capability])
  if (!access) return c.json({ error: 'forbidden' }, 403)
  const settings = await readAttentionSettings(c, storeId)
  const role = attentionRoleFor(access.actor.role, access.actor.permissions)
  if (!mayUseAttentionCapability(settings, capability, role))
    return c.json({ error: 'forbidden' }, 403)
  const auditedActor = auditActor(c)
  return {
    settings,
    actor: { ...auditedActor, personId: c.get('auth').sub },
  }
}

type AttentionRow = typeof customerAttentionNotes.$inferSelect

function attentionRecordFrom(row: AttentionRow): AttentionNoteRecord {
  return AttentionNoteRecord.parse({
    id: row.id,
    // Rows written before the versioned workflow are their own single version.
    noteId: row.noteId ?? row.id,
    customerId: row.customerId,
    storeId: row.storeId,
    status: row.status === 'draft' ? 'pending_review' : row.status,
    version: row.version,
    body: row.body,
    occurredAt: row.occurredAt ?? `${row.recordedOn}T00:00:00.000Z`,
    basis: row.basis,
    recommendedAction: row.recommendedAction ?? '（未記録）',
    sharingScope: row.sharingScope ?? 'permitted_stores',
    recordedBy: row.recordedBy,
    recordedOn: row.recordedOn,
    publishedAt: row.publishedAt,
    hiddenAt: row.hiddenAt,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    reviewReason: row.reviewReason,
  })
}

function attentionNoteFields(row: AttentionRow): AttentionNoteInput {
  const record = attentionRecordFrom(row)
  return {
    body: record.body,
    occurredAt: record.occurredAt,
    basis: record.basis,
    recommendedAction: record.recommendedAction,
  }
}

/** A note is visible from its own store, or from anywhere when shared chain-wide. */
function attentionVisibleFrom(storeId: string) {
  return or(
    eq(customerAttentionNotes.storeId, storeId),
    eq(customerAttentionNotes.sharingScope, 'chain'),
  )
}

async function currentAttentionVersion(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
  noteId: string,
): Promise<AttentionRow[]> {
  return db
    .select()
    .from(customerAttentionNotes)
    .where(
      and(
        eq(customerAttentionNotes.organizationId, organizationId),
        eq(customerAttentionNotes.noteId, noteId),
        attentionVisibleFrom(storeId),
      ),
    )
    .orderBy(desc(customerAttentionNotes.version))
}

function attentionConflict(
  c: AppContext,
  versions: readonly AttentionRow[],
  expectedVersion: number,
): Response {
  const current = versions[0]
  if (current === undefined) return c.json({ error: 'not_found' }, 404)
  const expected = versions.find((row) => row.version === expectedVersion)
  return c.json(
    AttentionVersionConflict.parse({
      error: 'attention_version_conflict',
      currentVersion: current.version,
      expectedVersion,
      differences:
        expected === undefined
          ? []
          : noteDifferences(attentionNoteFields(expected), attentionNoteFields(current)),
    }),
    409,
  )
}

async function readAttentionSettingsRoute(c: AppContext, storeId: string): Promise<Response> {
  const access = await attentionAccess(c, storeId, 'read')
  if (access instanceof Response) return access
  return c.json(access.settings)
}

/**
 * Count the notes an organization-wide sharing-scope change would move, and
 * how many customers and stores they belong to (AC-EYEX-118).
 */
async function attentionSharingScopeImpact(
  c: AppContext,
  storeId: string,
  requestedScope: AttentionSharingScope,
): Promise<AttentionSharingScopeImpact> {
  const settings = await readAttentionSettings(c, storeId)
  const rows = await drizzle(c.env.DB)
    .select({
      customerId: customerAttentionNotes.customerId,
      storeId: customerAttentionNotes.storeId,
      sharingScope: customerAttentionNotes.sharingScope,
      status: customerAttentionNotes.status,
    })
    .from(customerAttentionNotes)
    .where(eq(customerAttentionNotes.organizationId, c.get('auth').org))
  const affected = rows.filter(
    (row) => row.status !== 'hidden' && (row.sharingScope ?? 'permitted_stores') !== requestedScope,
  )
  return AttentionSharingScopeImpact.parse({
    currentScope: settings.sharingScope,
    requestedScope,
    affectedNoteCount: affected.length,
    affectedCustomerCount: new Set(affected.map((row) => row.customerId)).size,
    affectedStoreCount: new Set(affected.map((row) => row.storeId)).size,
  })
}

async function readAttentionSharingScopeImpact(
  c: AppContext,
  storeId: string,
  input: AttentionSharingScopeImpactRequest,
): Promise<Response> {
  return c.json(await attentionSharingScopeImpact(c, storeId, input.requestedScope))
}

/**
 * Write the organization default or the store override (UC-EYEX-139〜142).
 * A sharing-scope change is refused until the actor acknowledges exactly the
 * impact they were shown, and is then applied to the existing notes too.
 */
async function saveAttentionSettings(
  c: AppContext,
  storeId: string,
  input: AttentionSettingsInput,
): Promise<Response> {
  const access = await authorizedStore(c as StoreContext, storeId, 'settings.manage')
  if (!access) return c.json({ error: 'forbidden' }, 403)
  const role = attentionRoleFor(access.actor.role, access.actor.permissions)
  const requiredRole = input.scope === 'organization' ? 'organization_admin' : 'store_manager'
  if (requiredRole === 'organization_admin' ? role !== 'organization_admin' : role === 'staff')
    return c.json({ error: 'forbidden' }, 403)

  const organizationId = c.get('auth').org
  const current = await readAttentionSettings(c, storeId)
  const clock = requestClock(c)
  const now = nowIso(clock)
  const db = drizzle(c.env.DB)

  const scopeChanged = input.sharingScope !== current.sharingScope
  let impact: AttentionSharingScopeImpact | null = null
  if (scopeChanged) {
    impact = await attentionSharingScopeImpact(c, storeId, input.sharingScope)
    if (input.acknowledgedAffectedNoteCount !== impact.affectedNoteCount)
      return c.json({ error: 'sharing_scope_impact_unacknowledged', impact }, 409)
  }

  const scopeStoreId = input.scope === 'organization' ? ATTENTION_ORGANIZATION_SCOPE : storeId
  const existing = (
    await db
      .select({ id: attentionSettings.id })
      .from(attentionSettings)
      .where(
        and(
          eq(attentionSettings.organizationId, organizationId),
          eq(attentionSettings.storeId, scopeStoreId),
        ),
      )
  )[0]
  const values = {
    reviewMode: input.reviewMode,
    sharingScope: input.sharingScope,
    storeOverrideAllowed: input.storeOverrideAllowed ? '1' : '0',
    capabilitiesJson: serializeAttentionCapabilities(input.capabilities),
    updatedBy: c.get('auth').sub,
    updatedAt: now,
  }
  const operations: Parameters<typeof writeAuditBatch>[1]['operations'] = [
    existing === undefined
      ? db.insert(attentionSettings).values({
          id: crypto.randomUUID(),
          organizationId,
          storeId: scopeStoreId,
          ...values,
        })
      : db
          .update(attentionSettings)
          .set(values)
          .where(
            and(
              eq(attentionSettings.id, existing.id),
              eq(attentionSettings.organizationId, organizationId),
            ),
          ),
    ...(impact === null || impact.affectedNoteCount === 0
      ? []
      : [
          db
            .update(customerAttentionNotes)
            .set({ sharingScope: input.sharingScope, updatedAt: now })
            .where(
              and(
                eq(customerAttentionNotes.organizationId, organizationId),
                ne(customerAttentionNotes.status, 'hidden'),
              ),
            ),
        ]),
  ]

  try {
    await writeAuditBatch(db, {
      clock,
      operations,
      events: [
        {
          organizationId,
          storeId,
          ...auditActor(c),
          action: 'attention_settings.updated',
          entityType: 'attention_settings',
          entityId: scopeStoreId,
          requestId: correlationId(c),
          metadata: {
            before: {
              reviewMode: current.reviewMode,
              sharingScope: current.sharingScope,
              storeOverrideAllowed: current.storeOverrideAllowed,
            },
            after: {
              reviewMode: input.reviewMode,
              sharingScope: input.sharingScope,
              storeOverrideAllowed: input.storeOverrideAllowed,
            },
            scope: input.scope,
            affectedNoteCount: impact?.affectedNoteCount ?? 0,
          },
        },
      ],
    })
  } catch (error) {
    if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
    throw error
  }
  return c.json(await readAttentionSettings(c, storeId))
}

/**
 * List the 注意事項 of one customer. A note awaiting review is stored apart
 * from published information and is returned only to an actor who may review
 * it (AC-EYEX-85); every disclosure is audited (UC-EYEX-147).
 */
async function listAttentionNotes(
  c: AppContext,
  storeId: string,
  customerId: string,
): Promise<Response> {
  const access = await attentionAccess(c, storeId, 'read')
  if (access instanceof Response) return access
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)

  const reviewer = await authorizedStore(c as StoreContext, storeId, 'attention.publish')
  const visibleStatuses = reviewer ? ['pending_review', 'published', 'returned'] : ['published']
  const rows = await db
    .select()
    .from(customerAttentionNotes)
    .where(
      and(
        eq(customerAttentionNotes.organizationId, organizationId),
        eq(customerAttentionNotes.customerId, customerId),
        attentionVisibleFrom(storeId),
        inArray(customerAttentionNotes.status, visibleStatuses),
      ),
    )
    .orderBy(desc(customerAttentionNotes.recordedOn), desc(customerAttentionNotes.version))

  // Every permitted 閲覧 is audited, disclosed rows or not (UC-EYEX-147).
  const audited = await auditAttentionRead(c, storeId, customerId, rows.length)
  if (audited) return audited
  return c.json(rows.map(attentionRecordFrom))
}

/** The 閲覧 audit that UC-EYEX-147 does not allow any read path to skip. */
async function auditAttentionRead(
  c: AppContext,
  storeId: string,
  customerId: string,
  disclosed: number,
): Promise<Response | null> {
  try {
    await writeAuditBatch(drizzle(c.env.DB), {
      clock: requestClock(c),
      events: [
        {
          organizationId: c.get('auth').org,
          storeId,
          ...auditActor(c),
          action: 'attention_note.read',
          entityType: 'customer',
          entityId: customerId,
          requestId: correlationId(c),
          metadata: { disclosed },
        },
      ],
    })
    return null
  } catch (error) {
    if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
    throw error
  }
}

async function readAttentionVersions(
  c: AppContext,
  storeId: string,
  noteId: string,
): Promise<Response> {
  const access = await attentionAccess(c, storeId, 'read')
  if (access instanceof Response) return access
  const versions = await currentAttentionVersion(
    drizzle(c.env.DB),
    c.get('auth').org,
    storeId,
    noteId,
  )
  if (versions.length === 0) return c.json({ error: 'not_found' }, 404)
  const reviewer = await authorizedStore(c as StoreContext, storeId, 'attention.publish')
  // Without review rights a never-published note must not even be countable.
  if (!reviewer && !versions.some((row) => row.publishedAt !== null))
    return c.json({ error: 'not_found' }, 404)
  const audited = await auditAttentionRead(
    c,
    storeId,
    versions[0]?.customerId ?? noteId,
    versions.length,
  )
  if (audited) return audited
  return c.json(versions.map(attentionRecordFrom))
}

/**
 * Register one 注意事項. Under 確認待ち方式 — and always from a fully shared
 * terminal — the note is stored as pending and stays invisible to ordinary
 * staff until a reviewer publishes it (AC-EYEX-85, AC-EYEX-87).
 */
async function registerAttentionNote(
  c: AppContext,
  storeId: string,
  customerId: string,
  input: AttentionNoteInput,
  sharedTerminalActor?: AttentionActor,
): Promise<Response> {
  let settings: AttentionSettings
  let actor: AttentionActor
  if (sharedTerminalActor === undefined) {
    const access = await attentionAccess(c, storeId, 'write')
    if (access instanceof Response) return access
    settings = access.settings
    actor = access.actor
  } else {
    settings = await readAttentionSettings(c, storeId)
    actor = sharedTerminalActor
  }

  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const customer = (
    await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.organizationId, organizationId), eq(customers.id, customerId)))
  )[0]
  if (!customer) return c.json({ error: 'not_found' }, 404)

  const clock = requestClock(c)
  const now = nowIso(clock)
  const immediate = sharedTerminalActor === undefined && settings.reviewMode === 'immediate'
  const row = {
    id: crypto.randomUUID(),
    organizationId,
    storeId,
    customerId,
    noteId: crypto.randomUUID(),
    body: input.body,
    occurredAt: input.occurredAt,
    basis: input.basis,
    recommendedAction: input.recommendedAction,
    sharingScope: settings.sharingScope,
    status: immediate ? 'published' : 'pending_review',
    version: 1,
    recordedBy: actor.personId,
    recordedOn: toJstDateString(clock.now()),
    publishedAt: immediate ? now : null,
    hiddenAt: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewReason: null,
    previousVersionId: null,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await writeAuditBatch(db, {
      clock,
      operations: [db.insert(customerAttentionNotes).values(row)],
      events: [
        {
          organizationId,
          storeId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'attention_note.registered',
          entityType: 'attention_note',
          entityId: row.noteId,
          requestId: correlationId(c),
          metadata: {
            before: null,
            after: { status: row.status, version: 1, customerId },
            ...(actor.reauthenticatedUserId === undefined
              ? {}
              : { reauthenticatedUserId: actor.reauthenticatedUserId }),
          },
        },
      ],
    })
  } catch (error) {
    if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
    throw error
  }
  return c.json(attentionRecordFrom(row as AttentionRow), 201)
}

const REVIEW_STATUS = {
  publish: 'published',
  return: 'returned',
  reject: 'rejected',
} as const

/** 公開 / 差戻し / 却下 を理由付きで記録する (AC-EYEX-116). */
async function reviewAttentionNote(
  c: AppContext,
  storeId: string,
  noteId: string,
  input: AttentionReviewInput,
  sharedTerminalActor?: AttentionActor,
): Promise<Response> {
  let actor: AttentionActor
  if (sharedTerminalActor === undefined) {
    const access = await attentionAccess(c, storeId, 'publish')
    if (access instanceof Response) return access
    actor = access.actor
  } else {
    actor = sharedTerminalActor
  }

  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const versions = await currentAttentionVersion(db, organizationId, storeId, noteId)
  const current = versions[0]
  if (current === undefined) return c.json({ error: 'not_found' }, 404)
  if (current.version !== input.expectedVersion)
    return attentionConflict(c, versions, input.expectedVersion)
  if (current.status !== 'pending_review') return c.json({ error: 'attention_not_pending' }, 409)

  const clock = requestClock(c)
  const now = nowIso(clock)
  const status = REVIEW_STATUS[input.decision]
  const patch = {
    status,
    reviewedBy: actor.personId,
    reviewedAt: now,
    reviewReason: input.reason,
    publishedAt: input.decision === 'publish' ? now : null,
    updatedAt: now,
  }

  try {
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .update(customerAttentionNotes)
          .set(patch)
          .where(
            and(
              eq(customerAttentionNotes.id, current.id),
              eq(customerAttentionNotes.organizationId, organizationId),
            ),
          ),
      ],
      events: [
        {
          organizationId,
          storeId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: `attention_note.${status}`,
          entityType: 'attention_note',
          entityId: noteId,
          requestId: correlationId(c),
          metadata: {
            before: { status: current.status, version: current.version },
            after: { status, version: current.version },
            reason: input.reason,
            registeredBy: current.recordedBy,
            reviewedBy: actor.personId,
            ...(actor.reauthenticatedUserId === undefined
              ? {}
              : { reauthenticatedUserId: actor.reauthenticatedUserId }),
          },
        },
      ],
    })
  } catch (error) {
    if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
    throw error
  }
  return c.json(attentionRecordFrom({ ...current, ...patch }))
}

/** 公開済みは上書きせず、新しい版を公開して旧版を残す (UC-EYEX-145, AC-EYEX-86). */
async function reviseAttentionNote(
  c: AppContext,
  storeId: string,
  noteId: string,
  input: AttentionNoteRevisionInput,
  sharedTerminalActor?: AttentionActor,
): Promise<Response> {
  let actor: AttentionActor
  if (sharedTerminalActor === undefined) {
    const access = await attentionAccess(c, storeId, 'revise')
    if (access instanceof Response) return access
    actor = access.actor
  } else {
    actor = sharedTerminalActor
  }

  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const versions = await currentAttentionVersion(db, organizationId, storeId, noteId)
  const current = versions[0]
  if (current === undefined) return c.json({ error: 'not_found' }, 404)
  if (current.status !== 'published') return c.json({ error: 'attention_not_published' }, 409)
  if (current.version !== input.expectedVersion)
    return attentionConflict(c, versions, input.expectedVersion)

  const clock = requestClock(c)
  const now = nowIso(clock)
  const revision = {
    id: crypto.randomUUID(),
    organizationId,
    storeId: current.storeId,
    customerId: current.customerId,
    noteId,
    body: input.body,
    occurredAt: input.occurredAt,
    basis: input.basis,
    recommendedAction: input.recommendedAction,
    sharingScope: current.sharingScope,
    status: 'published',
    version: nextVersion(current.version),
    recordedBy: actor.personId,
    recordedOn: toJstDateString(clock.now()),
    publishedAt: now,
    hiddenAt: null,
    reviewedBy: actor.personId,
    reviewedAt: now,
    reviewReason: null,
    previousVersionId: current.id,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .update(customerAttentionNotes)
          .set({ status: 'superseded', updatedAt: now })
          .where(
            and(
              eq(customerAttentionNotes.id, current.id),
              eq(customerAttentionNotes.organizationId, organizationId),
            ),
          ),
        db.insert(customerAttentionNotes).values(revision),
      ],
      events: [
        {
          organizationId,
          storeId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'attention_note.revised',
          entityType: 'attention_note',
          entityId: noteId,
          requestId: correlationId(c),
          metadata: {
            // Field names only, never their values: `audit.read` is a separate
            // capability from `attention.read`, so the audit trail must not
            // become a second way to read 注意事項 (AC-EYEX-91).
            changedFields: noteDifferences(attentionNoteFields(current), input).map(
              (difference) => difference.field,
            ),
            before: { version: current.version, status: current.status },
            after: { version: revision.version, status: 'published' },
            ...(actor.reauthenticatedUserId === undefined
              ? {}
              : { reauthenticatedUserId: actor.reauthenticatedUserId }),
          },
        },
      ],
    })
  } catch (error) {
    if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
    throw error
  }
  return c.json(attentionRecordFrom(revision as AttentionRow))
}

/** 削除ではなく非表示化 (UC-EYEX-146): the row itself is never removed. */
async function hideAttentionNote(
  c: AppContext,
  storeId: string,
  noteId: string,
  input: AttentionHideInput,
  sharedTerminalActor?: AttentionActor,
): Promise<Response> {
  let actor: AttentionActor
  if (sharedTerminalActor === undefined) {
    const access = await attentionAccess(c, storeId, 'hide')
    if (access instanceof Response) return access
    actor = access.actor
  } else {
    actor = sharedTerminalActor
  }

  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const versions = await currentAttentionVersion(db, organizationId, storeId, noteId)
  const current = versions[0]
  if (current === undefined) return c.json({ error: 'not_found' }, 404)
  if (current.status === 'hidden') return c.json({ error: 'attention_already_hidden' }, 409)
  if (current.version !== input.expectedVersion)
    return attentionConflict(c, versions, input.expectedVersion)

  const clock = requestClock(c)
  const now = nowIso(clock)
  const patch = { status: 'hidden', hiddenAt: now, updatedAt: now }

  try {
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .update(customerAttentionNotes)
          .set(patch)
          .where(
            and(
              eq(customerAttentionNotes.id, current.id),
              eq(customerAttentionNotes.organizationId, organizationId),
            ),
          ),
      ],
      events: [
        {
          organizationId,
          storeId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'attention_note.hidden',
          entityType: 'attention_note',
          entityId: noteId,
          requestId: correlationId(c),
          metadata: {
            before: { status: current.status, version: current.version },
            after: { status: 'hidden', version: current.version },
            reason: input.reason,
            ...(actor.reauthenticatedUserId === undefined
              ? {}
              : { reauthenticatedUserId: actor.reauthenticatedUserId }),
          },
        },
      ],
    })
  } catch (error) {
    if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
    throw error
  }
  return c.json(attentionRecordFrom({ ...current, ...patch }))
}

/**
 * A shared iPad may register for review on the device alone, but publishing,
 * revising and hiding require the individual to reauthenticate personally and
 * to hold the capability themselves (UC-EYEX-137, 138, AC-EYEX-87).
 */
async function sharedTerminalAttentionManager(
  c: AppContext,
  terminalId: string,
  storeId: string,
  capability: AttentionCapability,
): Promise<Response | AttentionActor> {
  const denied = await requirePersonalReauth(c, terminalId, 'management', requestClock(c))
  if (denied) return denied
  const reauthenticatedUserId = c.get('personalReauthUserId')
  if (!reauthenticatedUserId) return c.json({ error: 'reauth_unauthorized' }, 401)
  const db = drizzle(c.env.DB)
  const terminal = (
    await db
      .select()
      .from(sharedTerminals)
      .where(and(eq(sharedTerminals.id, terminalId), eq(sharedTerminals.storeId, storeId)))
  )[0]
  if (!terminal) return c.json({ error: 'forbidden' }, 403)

  const memberships = await db
    .select({ permissions: storeMemberships.permissions })
    .from(storeMemberships)
    .where(
      and(
        eq(storeMemberships.organizationId, terminal.organizationId),
        eq(storeMemberships.storeId, terminal.storeId),
        eq(storeMemberships.userId, reauthenticatedUserId),
      ),
    )
  const permissions = memberships.flatMap((membership) => {
    try {
      return StorePermission.array().parse(JSON.parse(membership.permissions))
    } catch {
      return []
    }
  })
  c.set(
    'auth' as never,
    {
      sub: terminal.id,
      org: terminal.organizationId,
      email: 'shared-terminal@internal.invalid',
      role: 'staff',
    } as never,
  )
  const settings = await readAttentionSettings(c, terminal.storeId)
  if (
    !permissions.includes(ATTENTION_PERMISSION[capability]) ||
    !mayUseAttentionCapability(settings, capability, attentionRoleFor('staff', permissions))
  )
    return c.json({ error: 'forbidden' }, 403)

  return {
    actorType: 'shared_terminal',
    actorId: terminal.id,
    personId: reauthenticatedUserId,
    reauthenticatedUserId,
  }
}

/** Establish the shared terminal as a non-person 注意事項 registrant. */
async function sharedTerminalAttentionRegistrant(
  c: AppContext,
  terminalId: string,
  storeId: string,
): Promise<Response | AttentionActor> {
  const denied = await establishSharedTerminalDailyActor(
    c as AppContext,
    terminalId,
    storeId,
    requestClock(c),
  )
  if (denied) return denied
  const identity = c.get('sharedTerminal')
  if (!identity) return c.json({ error: 'terminal_unauthorized' }, 401)
  return { actorType: 'shared_terminal', actorId: identity.id, personId: identity.id }
}

/** 権限内の監査イベントを検索する (UC-EYEX-155, AC-EYEX-102). */
async function searchAuditEvents(
  c: AppContext,
  storeId: string,
  query: AuditSearchQuery,
): Promise<Response> {
  const organizationId = c.get('auth').org
  const rows = await drizzle(c.env.DB)
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, organizationId),
        // The selected store is the authorization boundary; a store id from the
        // query never widens it.
        eq(auditEvents.storeId, storeId),
        ...(query.from === undefined ? [] : [gte(auditEvents.occurredAt, query.from)]),
        ...(query.to === undefined ? [] : [lte(auditEvents.occurredAt, query.to)]),
        ...(query.action === undefined ? [] : [eq(auditEvents.action, query.action)]),
        ...(query.actorType === undefined ? [] : [eq(auditEvents.actorType, query.actorType)]),
        ...(query.entityType === undefined ? [] : [eq(auditEvents.entityType, query.entityType)]),
        ...(query.entityId === undefined ? [] : [eq(auditEvents.entityId, query.entityId)]),
      ),
    )
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(query.limit)

  return c.json(
    rows.map((row) => {
      const metadata: unknown = JSON.parse(row.metadata)
      const document =
        typeof metadata === 'object' && metadata !== null
          ? (metadata as Record<string, unknown>)
          : {}
      const section = (key: 'before' | 'after') => {
        const value = document[key]
        return typeof value === 'object' && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null
      }
      return AuditEventView.parse({
        id: row.id,
        occurredAt: row.occurredAt,
        storeId: row.storeId,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        correlationId: row.requestId,
        before: section('before'),
        after: section('after'),
      })
    }),
  )
}

/* 顧客の重複統合・誤関連解除 (UC-EYEX-181, AC-EYEX-121) */

/**
 * Correcting a customer identity touches the chain-wide record, so it needs
 * the read, the write and the cross-store history permission together.
 */
async function requireCustomerCorrectionPermissions(
  c: AppContext,
  storeId: string,
): Promise<Response | null> {
  for (const permission of ['customer.read', 'customer.write', 'customer.history'] as const) {
    const denied = await requireStorePermission(c as StoreContext, storeId, permission)
    if (denied) return denied
  }
  return null
}

type CustomerRow = typeof customers.$inferSelect

function customerSummary(row: CustomerRow) {
  return {
    customerId: row.id,
    name: row.name,
    kana: row.kana,
    phone: row.phoneNormalized,
    primaryStoreId: row.primaryStoreId,
    visitCount: row.visitCount,
  }
}

async function customerMergeImpact(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  customerId: string,
): Promise<CustomerMergeImpact> {
  const count = async (
    table:
      | typeof reservations
      | typeof walkins
      | typeof customerPrescriptions
      | typeof customerNotes
      | typeof customerAttentionNotes
      | typeof customerOwnedGlasses,
  ) =>
    (
      await db
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.organizationId, organizationId), eq(table.customerId, customerId)))
    ).length

  const [reservationCount, walkinCount, prescriptions, notes, attention, glasses] =
    await Promise.all([
      count(reservations),
      count(walkins),
      count(customerPrescriptions),
      count(customerNotes),
      count(customerAttentionNotes),
      count(customerOwnedGlasses),
    ])
  return {
    reservations: reservationCount,
    walkins: walkinCount,
    prescriptions,
    notes,
    attentionNotes: attention,
    ownedGlasses: glasses,
  }
}

async function loadMergeCandidates(
  c: AppContext,
  primaryCustomerId: string,
  duplicateCustomerId: string,
): Promise<Response | { primary: CustomerRow; duplicate: CustomerRow }> {
  const organizationId = c.get('auth').org
  const rows = await drizzle(c.env.DB)
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.organizationId, organizationId),
        inArray(customers.id, [primaryCustomerId, duplicateCustomerId]),
      ),
    )
  const primary = rows.find((row) => row.id === primaryCustomerId)
  const duplicate = rows.find((row) => row.id === duplicateCustomerId)
  if (primary === undefined || duplicate === undefined) return c.json({ error: 'not_found' }, 404)
  return { primary, duplicate }
}

async function previewCustomerMerge(
  c: AppContext,
  input: CustomerMergePreviewRequest,
): Promise<Response> {
  const candidates = await loadMergeCandidates(
    c,
    input.primaryCustomerId,
    input.duplicateCustomerId,
  )
  if (candidates instanceof Response) return candidates
  const impact = await customerMergeImpact(
    drizzle(c.env.DB),
    c.get('auth').org,
    input.duplicateCustomerId,
  )
  return c.json(
    CustomerMergePreview.parse({
      primary: customerSummary(candidates.primary),
      duplicate: customerSummary(candidates.duplicate),
      impact,
      alreadyMerged: candidates.duplicate.mergedIntoCustomerId !== null,
    }),
  )
}

/** Never automatic: the acknowledged impact must match what was previewed. */
async function mergeCustomers(c: AppContext, input: CustomerMergeInput): Promise<Response> {
  const candidates = await loadMergeCandidates(
    c,
    input.primaryCustomerId,
    input.duplicateCustomerId,
  )
  if (candidates instanceof Response) return candidates
  if (candidates.duplicate.mergedIntoCustomerId !== null)
    return c.json({ error: 'customer_already_merged' }, 409)

  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const impact = await customerMergeImpact(db, organizationId, input.duplicateCustomerId)
  const total = Object.values(impact).reduce((sum, value) => sum + value, 0)
  if (input.acknowledgedImpactTotal !== total)
    return c.json({ error: 'merge_impact_unacknowledged', impact }, 409)

  const clock = requestClock(c)
  const now = nowIso(clock)
  const scoped = (
    table:
      | typeof reservations
      | typeof walkins
      | typeof customerPrescriptions
      | typeof customerNotes
      | typeof customerAttentionNotes
      | typeof customerOwnedGlasses,
  ) =>
    db
      .update(table)
      .set({ customerId: input.primaryCustomerId })
      .where(
        and(
          eq(table.organizationId, organizationId),
          eq(table.customerId, input.duplicateCustomerId),
        ),
      )

  try {
    await writeAuditBatch(db, {
      clock,
      operations: [
        scoped(reservations),
        scoped(walkins),
        scoped(customerPrescriptions),
        scoped(customerNotes),
        scoped(customerAttentionNotes),
        scoped(customerOwnedGlasses),
        db
          .update(customers)
          .set({ mergedIntoCustomerId: input.primaryCustomerId, updatedAt: now })
          .where(
            and(
              eq(customers.organizationId, organizationId),
              eq(customers.id, input.duplicateCustomerId),
            ),
          ),
        db
          .update(customers)
          .set({
            visitCount: candidates.primary.visitCount + candidates.duplicate.visitCount,
            updatedAt: now,
          })
          .where(
            and(
              eq(customers.organizationId, organizationId),
              eq(customers.id, input.primaryCustomerId),
            ),
          ),
      ],
      events: [
        {
          organizationId,
          storeId: candidates.primary.primaryStoreId,
          ...auditActor(c),
          action: 'customer.merged',
          entityType: 'customer',
          entityId: input.primaryCustomerId,
          requestId: correlationId(c),
          metadata: {
            before: {
              duplicateCustomerId: input.duplicateCustomerId,
              mergedIntoCustomerId: null,
              visitCount: candidates.primary.visitCount,
            },
            after: {
              mergedIntoCustomerId: input.primaryCustomerId,
              visitCount: candidates.primary.visitCount + candidates.duplicate.visitCount,
            },
            reason: input.reason,
            impact,
          },
        },
      ],
    })
  } catch (error) {
    if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
    throw error
  }

  return c.json(
    CustomerMergeResult.parse({
      primaryCustomerId: input.primaryCustomerId,
      mergedCustomerId: input.duplicateCustomerId,
      impact,
      mergedAt: now,
    }),
  )
}

/** 誤関連解除: the reception entry survives, only the association is removed. */
async function releaseCustomerLink(
  c: AppContext,
  storeId: string,
  input: CustomerLinkReleaseInput,
): Promise<Response> {
  const organizationId = c.get('auth').org
  const db = drizzle(c.env.DB)
  const table = input.entryType === 'reservation' ? reservations : walkins
  const entry = (
    await db
      .select({ id: table.id, customerId: table.customerId })
      .from(table)
      .where(
        and(
          eq(table.organizationId, organizationId),
          eq(table.storeId, storeId),
          eq(table.id, input.entryId),
        ),
      )
  )[0]
  if (entry === undefined) return c.json({ error: 'not_found' }, 404)
  if (entry.customerId === null) return c.json({ error: 'link_already_released' }, 409)

  const clock = requestClock(c)
  const now = nowIso(clock)
  try {
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .update(table)
          .set({ customerId: null, updatedAt: now })
          .where(
            and(
              eq(table.organizationId, organizationId),
              eq(table.storeId, storeId),
              eq(table.id, input.entryId),
            ),
          ),
      ],
      events: [
        {
          organizationId,
          storeId,
          ...auditActor(c),
          action: 'customer.link_released',
          entityType: input.entryType,
          entityId: input.entryId,
          requestId: correlationId(c),
          metadata: {
            before: { customerId: entry.customerId },
            after: { customerId: null },
            reason: input.reason,
          },
        },
      ],
    })
  } catch (error) {
    if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
    throw error
  }

  return c.json(
    CustomerLinkReleaseResult.parse({
      entryType: input.entryType,
      entryId: input.entryId,
      previousCustomerId: entry.customerId,
      releasedAt: now,
    }),
  )
}

/*
 * ---------------------------------------------------------------------------
 * Analytics (UC-EYEX-099..108, 180) and the alert inbox (UC-EYEX-178, 179)
 * ---------------------------------------------------------------------------
 */

/** Used until an organization configures its own privacy threshold. */
const DEFAULT_SMALL_SAMPLE_THRESHOLD = 5

const FUNNEL_STAGES = [
  { stage: 'started' as const, label: '開始' },
  { stage: 'slot_selected' as const, label: '枠選択' },
  { stage: 'confirmed' as const, label: '確認' },
  { stage: 'completed' as const, label: '完了' },
]

const METRIC_DEFINITIONS: Record<AnalyticsMetricName, { label: string; definition: string }> = {
  reservations: {
    label: '予約件数',
    definition: '対象期間内にJSTの開始時刻を持つ予約の件数（状態を問わない）。',
  },
  visits: {
    label: '来店件数',
    definition: '対象期間内に受付された来店の件数（受付済み予約 + ウォークイン）。',
  },
  cancellations: {
    label: '取消件数',
    definition: '対象期間内に開始予定だった予約のうち、取消された件数。',
  },
  no_shows: {
    label: '無断キャンセル件数',
    definition: '対象期間内に開始予定だった予約のうち、無断キャンセルとして記録された件数。',
  },
}

const EXCLUSION_TEXT: Record<AnalyticsExclusionReason, { description: string; caveat: string }> = {
  invalid_timestamp: {
    description: '時刻が解釈できない記録',
    caveat: '該当件数だけ実際より少なく集計されています。記録の修正後に再表示してください。',
  },
  missing_stage_timestamp: {
    description: '工程の開始時刻または完了時刻が欠けている記録',
    caveat: '待ち時間・所要時間の分布は、計測できた記録だけを対象にしています。',
  },
  unknown_purpose: {
    description: '現在の設定に存在しない来店目的を参照している記録',
    caveat: '来店目的別の内訳は、現在の設定に存在する目的だけを対象にしています。',
  },
  unassigned_staff: {
    description: '担当者が割り当てられていない記録',
    caveat: '担当者別の内訳は、担当者が記録されているものだけを対象にしています。',
  },
}

type AnalyticsExclusionReason = AnalyticsExclusion['reason']
type AnalyticsMetricName = AnalyticsMetricValue['metric']

type AnalyticsSettingsResolved = {
  organizationId: string
  smallSampleThreshold: number
  targets: AnalyticsTarget[]
  updatedAt: string
}

/**
 * Read the organization's analytics configuration. A stored row that cannot be
 * parsed is an error rather than a silent fallback: guessing a suppression
 * threshold would be guessing how much privacy to give away.
 */
async function loadAnalyticsSettings(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  now: string,
): Promise<AnalyticsSettingsResolved> {
  const rows = await db
    .select()
    .from(analyticsSettings)
    .where(eq(analyticsSettings.organizationId, organizationId))
  const row = rows[0]
  if (row === undefined)
    return {
      organizationId,
      smallSampleThreshold: DEFAULT_SMALL_SAMPLE_THRESHOLD,
      targets: [],
      updatedAt: now,
    }
  const targets = AnalyticsTarget.array().parse(JSON.parse(row.targetsJson))
  return {
    organizationId,
    smallSampleThreshold: row.smallSampleThreshold,
    targets,
    updatedAt: row.updatedAt,
  }
}

/** JST hour of an instant. Japan has no daylight saving, so this is exact. */
function jstHour(instant: string): number | null {
  const parsed = new Date(instant)
  if (Number.isNaN(parsed.getTime())) return null
  return (parsed.getUTCHours() + 9) % 24
}

function minutesBetween(from: string, to: string): number | null {
  const start = new Date(from).getTime()
  const end = new Date(to).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null
  return Math.round((end - start) / 60000)
}

type PeriodRows = {
  reservationRows: (typeof reservations.$inferSelect)[]
  walkinRows: (typeof walkins.$inferSelect)[]
}

async function readPeriodRows(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
  period: AnalyticsPeriod,
): Promise<PeriodRows> {
  const reservationRows = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.organizationId, organizationId),
        eq(reservations.storeId, storeId),
        gte(reservations.startAt, period.startAt),
        lt(reservations.startAt, period.endAt),
      ),
    )
  const walkinRows = await db
    .select()
    .from(walkins)
    .where(
      and(
        eq(walkins.organizationId, organizationId),
        eq(walkins.storeId, storeId),
        gte(walkins.arrivedAt, period.startAt),
        lt(walkins.arrivedAt, period.endAt),
      ),
    )
  return { reservationRows, walkinRows }
}

function countsFor(rows: PeriodRows): Record<AnalyticsMetricName, number> {
  return {
    reservations: rows.reservationRows.length,
    visits:
      rows.reservationRows.filter((row) => row.status === 'checked_in').length +
      rows.walkinRows.length,
    cancellations: rows.reservationRows.filter((row) => row.status === 'cancelled').length,
    no_shows: rows.reservationRows.filter((row) => row.status === 'no_show').length,
  }
}

function tallied(entries: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry, (counts.get(entry) ?? 0) + 1)
  return counts
}

function breakdownFrom(
  dimension: AnalyticsBreakdown['dimension'],
  metricName: AnalyticsMetricName,
  counts: Map<string, number>,
  labelFor: (key: string) => string,
): AnalyticsBreakdown {
  return {
    dimension,
    metric: metricName,
    suppressed: false,
    suppressionReason: null,
    items: [...counts.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([key, value]) => ({ key, label: labelFor(key), value, suppressed: false })),
  }
}

type StageTimestamps = {
  receptionAt: string | null
  serviceStartedAt: string | null
  serviceCompletedAt: string | null
  departedAt: string | null
}

/** Collapse a progress history into the four instants the stages need. */
function stageTimestampsFrom(
  receptionAt: string | null,
  events: readonly { toProgress: string; occurredAt: string }[],
): StageTimestamps {
  const earliest = (progress: string) =>
    events
      .filter((event) => event.toProgress === progress)
      .map((event) => event.occurredAt)
      .sort()[0] ?? null
  return {
    receptionAt,
    serviceStartedAt: earliest('service_in_progress'),
    serviceCompletedAt: earliest('service_completed'),
    departedAt: earliest('departed'),
  }
}

function stageSamples(timestamps: readonly StageTimestamps[]): {
  samples: Record<AnalyticsStage, number[]>
  missing: number
} {
  const samples: Record<AnalyticsStage, number[]> = {
    reception_to_service_start: [],
    service_duration: [],
    service_end_to_departure: [],
  }
  let missing = 0
  for (const entry of timestamps) {
    const pairs: [AnalyticsStage, string | null, string | null][] = [
      ['reception_to_service_start', entry.receptionAt, entry.serviceStartedAt],
      ['service_duration', entry.serviceStartedAt, entry.serviceCompletedAt],
      ['service_end_to_departure', entry.serviceCompletedAt, entry.departedAt],
    ]
    let incomplete = false
    for (const [stage, from, to] of pairs) {
      if (to === null) continue
      if (from === null) {
        // The stage ended but nothing says when it began — measuring it would
        // invent a wait, so the row is excluded and reported instead.
        incomplete = true
        continue
      }
      const minutes = minutesBetween(from, to)
      if (minutes === null) incomplete = true
      else samples[stage].push(minutes)
    }
    if (incomplete) missing += 1
  }
  return { samples, missing }
}

function funnelFrom(
  sessionsByStage: Map<string, Set<string>>,
  sessionCount: number,
): AnalyticsFunnel {
  let previous: number | null = null
  let largestDrop = 0
  let largestDropStage: AnalyticsFunnel['largestDropStage'] = null
  const steps = FUNNEL_STAGES.map(({ stage, label }) => {
    const count = sessionsByStage.get(stage)?.size ?? 0
    const dropped = previous === null ? null : Math.max(0, previous - count)
    if (dropped !== null && dropped > largestDrop) {
      largestDrop = dropped
      largestDropStage = stage
    }
    previous = count
    return { stage, label, count, droppedFromPrevious: dropped, suppressed: false }
  })
  return {
    sessionCount,
    suppressed: false,
    suppressionReason: null,
    steps,
    largestDropStage,
  }
}

const CAUSE_TEXT: Record<
  AnalyticsCauseCandidate['code'],
  { hypothesis: string; inspectionTarget: string }
> = {
  web_source_concentration: {
    hypothesis: 'Web予約に偏っている可能性があります。断定はできません。',
    inspectionTarget: 'Web予約の確認メール到達状況と、予約完了画面の案内文',
  },
  peak_hour_concentration: {
    hypothesis: '特定の時間帯に集中している可能性があります。断定はできません。',
    inspectionTarget: '該当時間帯の受付枠数と担当者シフト',
  },
  staff_unassigned: {
    hypothesis: '担当者が割り当てられないまま進行した可能性があります。断定はできません。',
    inspectionTarget: '受付台帳の担当者割り当て運用',
  },
  purpose_concentration: {
    hypothesis: '特定の来店目的に偏っている可能性があります。断定はできません。',
    inspectionTarget: '該当する来店目的の所要時間設定と案内文',
  },
}

function causeCandidatesFor(
  metricName: AnalyticsMetricName,
  reservationRows: readonly (typeof reservations.$inferSelect)[],
  walkinRows: readonly (typeof walkins.$inferSelect)[],
): AnalyticsCauseCandidate[] {
  const relevant =
    metricName === 'reservations'
      ? reservationRows
      : metricName === 'visits'
        ? reservationRows.filter((row) => row.status === 'checked_in')
        : reservationRows.filter(
            (row) => row.status === (metricName === 'cancellations' ? 'cancelled' : 'no_show'),
          )
  const includedWalkins = metricName === 'visits' ? walkinRows : []
  const hours = [
    ...relevant.map((row) => jstHour(row.startAt)),
    ...includedWalkins.map((row) => jstHour(row.arrivedAt)),
  ].flatMap((hour) => (hour === null ? [] : [String(hour)]))
  const purposeKeys = relevant.flatMap((row) => parsePurposeIds(row.purposeIdsJson))
  const evidence: Record<AnalyticsCauseCandidate['code'], number> = {
    web_source_concentration: relevant.filter((row) => row.source === 'web').length,
    peak_hour_concentration: Math.max(0, ...tallied(hours).values()),
    staff_unassigned:
      relevant.filter((row) => row.assignedStaffId === null).length + includedWalkins.length,
    purpose_concentration: Math.max(0, ...tallied(purposeKeys).values()),
  }
  return (Object.keys(evidence) as AnalyticsCauseCandidate['code'][]).flatMap((code) => {
    const evidenceCount = evidence[code]
    if (evidenceCount <= 0) return []
    return [{ metric: metricName, code, evidenceCount, ...CAUSE_TEXT[code] }]
  })
}

function parsePurposeIds(serialized: string): string[] {
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return []
  }
}

function emptyAnalyticsFunnel(): AnalyticsFunnel {
  return funnelFrom(new Map(), 0)
}

async function readAnalyticsReport(
  c: AppContext,
  storeId: string,
  query: AnalyticsQuery,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'analytics.read')
  if (denied) return denied
  const access = await authorizedStore(c as StoreContext, storeId, 'analytics.read')
  if (!access) return c.json({ error: 'forbidden' }, 403)
  const organizationId = c.get('auth').org
  const lastUpdatedAt = nowIso(requestClock(c))
  const period = jstPeriod(query.granularity, query.date)
  const previousPeriod = previousJstPeriod(period)
  const base = {
    storeId,
    storeName: access.store.name,
    timezone: 'Asia/Tokyo' as const,
    period,
    previousPeriod,
    lastUpdatedAt,
  }

  try {
    const db = drizzle(c.env.DB)
    const settings = await loadAnalyticsSettings(db, organizationId, lastUpdatedAt)
    const rows = await readPeriodRows(db, organizationId, storeId, period)
    const previousRows = await readPeriodRows(db, organizationId, storeId, previousPeriod)
    const purposeRows = await db
      .select()
      .from(visitPurposes)
      .where(
        and(eq(visitPurposes.organizationId, organizationId), eq(visitPurposes.storeId, storeId)),
      )
    const purposeNames = new Map(purposeRows.map((row) => [row.id, row.staffName]))

    const invalidTimestamps =
      rows.reservationRows.filter((row) => jstHour(row.startAt) === null).length +
      rows.walkinRows.filter((row) => jstHour(row.arrivedAt) === null).length
    const valid = {
      reservationRows: rows.reservationRows.filter((row) => jstHour(row.startAt) !== null),
      walkinRows: rows.walkinRows.filter((row) => jstHour(row.arrivedAt) !== null),
    }
    const counts = countsFor(valid)
    const previousCounts = countsFor(previousRows)
    const totalCount = valid.reservationRows.length + valid.walkinRows.length
    const targets = new Map(settings.targets.map((target) => [target.metric, target.target]))

    const metrics: AnalyticsMetricValue[] = (
      Object.keys(METRIC_DEFINITIONS) as AnalyticsMetricName[]
    ).map((metricName) => {
      const value = counts[metricName]
      const target = targets.get(metricName) ?? null
      return {
        metric: metricName,
        label: METRIC_DEFINITIONS[metricName].label,
        definition: METRIC_DEFINITIONS[metricName].definition,
        unit: 'count' as const,
        value,
        previousValue: previousCounts[metricName],
        difference: value - previousCounts[metricName],
        target,
        targetDifference: target === null ? null : value - target,
        exceedsTarget: target !== null && value > target,
        suppressed: false,
        suppressionReason: null,
      }
    })

    // --- breakdowns (UC-EYEX-100) -----------------------------------------
    const purposeReferences = valid.reservationRows.flatMap((row) =>
      parsePurposeIds(row.purposeIdsJson),
    )
    const knownPurposeReferences = purposeReferences.filter((id) => purposeNames.has(id))
    const sourceKeys = [
      ...valid.reservationRows.map((row) => row.source),
      ...valid.walkinRows.map(() => 'walkin'),
    ]
    const visitRows = valid.reservationRows.filter((row) => row.status === 'checked_in')
    const hourKeys = [
      ...visitRows.map((row) => String(jstHour(row.startAt))),
      ...valid.walkinRows.map((row) => String(jstHour(row.arrivedAt))),
    ]
    const staffKeys = visitRows.flatMap((row) =>
      row.assignedStaffId === null ? [] : [row.assignedStaffId],
    )
    const unassignedStaff =
      visitRows.filter((row) => row.assignedStaffId === null).length + valid.walkinRows.length
    const breakdowns: AnalyticsBreakdown[] = [
      breakdownFrom(
        'purpose',
        'reservations',
        tallied(knownPurposeReferences),
        (key) => purposeNames.get(key) ?? key,
      ),
      breakdownFrom('source', 'reservations', tallied(sourceKeys), (key) => key),
      breakdownFrom('hour', 'visits', tallied(hourKeys), (key) => `${key}時台`),
      breakdownFrom('staff', 'visits', tallied(staffKeys), (key) => key),
    ]

    // --- wait time and stage durations (UC-EYEX-101) ----------------------
    const reservationIds = valid.reservationRows.map((row) => row.id)
    const walkinIds = valid.walkinRows.map((row) => row.id)
    const progressRows =
      reservationIds.length === 0
        ? []
        : await db
            .select()
            .from(reservationProgressEvents)
            .where(
              and(
                eq(reservationProgressEvents.organizationId, organizationId),
                eq(reservationProgressEvents.storeId, storeId),
                inArray(reservationProgressEvents.reservationId, reservationIds),
              ),
            )
    const walkinEventRows =
      walkinIds.length === 0
        ? []
        : await db
            .select()
            .from(walkinEvents)
            .where(
              and(
                eq(walkinEvents.organizationId, organizationId),
                eq(walkinEvents.storeId, storeId),
                inArray(walkinEvents.walkinId, walkinIds),
              ),
            )
    const timestamps: StageTimestamps[] = [
      ...valid.reservationRows.map((row) =>
        stageTimestampsFrom(
          row.waitStartedAt,
          progressRows
            .filter((event) => event.reservationId === row.id)
            .map((event) => ({ toProgress: event.toProgress, occurredAt: event.createdAt })),
        ),
      ),
      ...valid.walkinRows.map((row) =>
        stageTimestampsFrom(
          row.arrivedAt,
          walkinEventRows
            .filter((event) => event.walkinId === row.id && event.toProgress !== null)
            .map((event) => ({
              toProgress: event.toProgress ?? '',
              occurredAt: event.occurredAt,
            })),
        ),
      ),
    ]
    const stages = stageSamples(timestamps)
    const stageDistributions = (Object.keys(stages.samples) as AnalyticsStage[]).map((stage) =>
      stageDistribution(stage, stages.samples[stage]),
    )

    // --- web booking funnel (UC-EYEX-103) ---------------------------------
    const funnelRows = await db
      .select()
      .from(webBookingFunnelEvents)
      .where(
        and(
          eq(webBookingFunnelEvents.organizationId, organizationId),
          eq(webBookingFunnelEvents.storeId, storeId),
          gte(webBookingFunnelEvents.occurredAt, period.startAt),
          lt(webBookingFunnelEvents.occurredAt, period.endAt),
        ),
      )
    const sessionsByStage = new Map<string, Set<string>>()
    for (const row of funnelRows) {
      const bucket = sessionsByStage.get(row.stage) ?? new Set<string>()
      bucket.add(row.sessionId)
      sessionsByStage.set(row.stage, bucket)
    }
    const funnel = funnelFrom(sessionsByStage, new Set(funnelRows.map((row) => row.sessionId)).size)

    // --- operational quality (UC-EYEX-104) --------------------------------
    const failedRecordingRows = await db
      .select()
      .from(recordings)
      .where(
        and(
          eq(recordings.organizationId, organizationId),
          eq(recordings.storeId, storeId),
          eq(recordings.state, 'failed'),
          gte(recordings.updatedAt, period.startAt),
          lt(recordings.updatedAt, period.endAt),
        ),
      )
    const contradictions = settingsContradictionAlerts(purposeRows, new Date(lastUpdatedAt))
    const qualityWarnings: AnalyticsQualityWarning[] = [
      ...(failedRecordingRows.length === 0
        ? []
        : [
            {
              code: 'recording_save_failure' as const,
              count: failedRecordingRows.length,
              message: '対象期間に録音の保存失敗が記録されています。',
              nextAction: '録音一覧で該当セッションを開き、再取得の可否を確認してください。',
            },
          ]),
      ...(contradictions.length === 0
        ? []
        : [
            {
              code: 'settings_contradiction' as const,
              count: contradictions.length,
              message: '来店目的の設定に矛盾があり、集計対象の枠が作られていない可能性があります。',
              nextAction: '設定画面で所要時間・枠間隔・同時受入数を見直してください。',
            },
          ]),
    ]

    // --- exclusions (AC-EYEX-54) ------------------------------------------
    const exclusionCounts: [AnalyticsExclusionReason, number][] = [
      ['invalid_timestamp', invalidTimestamps],
      ['missing_stage_timestamp', stages.missing],
      ['unknown_purpose', purposeReferences.length - knownPurposeReferences.length],
      ['unassigned_staff', unassignedStaff],
    ]
    const exclusions: AnalyticsExclusion[] = exclusionCounts.flatMap(([reason, count]) =>
      count <= 0 ? [] : [{ reason, count, ...EXCLUSION_TEXT[reason] }],
    )

    // --- cause candidates (AC-EYEX-51) ------------------------------------
    const causeCandidates = metrics
      .filter((entry) => entry.exceedsTarget)
      .flatMap((entry) => causeCandidatesFor(entry.metric, valid.reservationRows, valid.walkinRows))

    const suppressed = applySmallSampleSuppression({
      threshold: settings.smallSampleThreshold,
      totalCount,
      metrics,
      breakdowns,
      stageDistributions,
      funnel,
      causeCandidates,
    })

    const status: AnalyticsReport['status'] =
      totalCount === 0 ? 'empty' : suppressed.suppressedEverything ? 'suppressed' : 'ok'
    const reason =
      status === 'empty'
        ? '対象期間に集計できる予約・来店の記録がありません。'
        : status === 'suppressed'
          ? `対象件数が組織の抑制閾値（${settings.smallSampleThreshold}件）未満のため、個人が特定されないよう値と内訳を非表示にしています。`
          : null
    const nextAction =
      status === 'empty'
        ? '対象期間または店舗を変えて再表示するか、受付記録が登録されているか確認してください。'
        : status === 'suppressed'
          ? '期間を広げるか、より粗い集計粒度（週・月）で再表示してください。'
          : null

    return c.json(
      AnalyticsReport.parse({
        ...base,
        totalCount,
        smallSampleThreshold: settings.smallSampleThreshold,
        status,
        reason,
        nextAction,
        metrics: suppressed.metrics,
        breakdowns: suppressed.breakdowns,
        stageDistributions: suppressed.stageDistributions,
        funnel: suppressed.funnel,
        exclusions,
        qualityWarnings,
        causeCandidates: suppressed.causeCandidates,
      }),
    )
  } catch (error) {
    // UC-EYEX-108: a failed aggregation states its reason and the next step;
    // it never degrades into a zero that reads like a real result.
    console.error('analytics_aggregation_failed', error)
    return c.json(
      AnalyticsReport.parse({
        ...base,
        totalCount: 0,
        smallSampleThreshold: DEFAULT_SMALL_SAMPLE_THRESHOLD,
        status: 'failed',
        reason: '集計に必要な設定または記録を読み取れませんでした。',
        nextAction: '分析設定（抑制閾値・目標値）を保存し直してから再表示してください。',
        metrics: [],
        breakdowns: [],
        stageDistributions: [],
        funnel: emptyAnalyticsFunnel(),
        exclusions: [],
        qualityWarnings: [],
        causeCandidates: [],
      }),
    )
  }
}

async function readAnalyticsSettings(c: AppContext, storeId: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.read')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const now = nowIso(requestClock(c))
  const settings = await loadAnalyticsSettings(db, c.get('auth').org, now)
  return c.json(AnalyticsSettings.parse(settings))
}

async function updateAnalyticsSettings(
  c: AppContext,
  storeId: string,
  input: AnalyticsSettingsInput,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.manage')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const organizationId = c.get('auth').org
  const clock = requestClock(c)
  const updatedAt = nowIso(clock)
  const targetsJson = JSON.stringify(input.targets)
  try {
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .insert(analyticsSettings)
          .values({
            id: crypto.randomUUID(),
            organizationId,
            smallSampleThreshold: input.smallSampleThreshold,
            targetsJson,
            createdAt: updatedAt,
            updatedAt,
          })
          .onConflictDoUpdate({
            target: analyticsSettings.organizationId,
            set: {
              smallSampleThreshold: input.smallSampleThreshold,
              targetsJson,
              updatedAt,
            },
          }),
      ],
      events: [
        {
          organizationId,
          storeId,
          actorType: 'user',
          actorId: c.get('auth').sub,
          action: 'analytics.settings_updated',
          entityType: 'analytics_settings',
          entityId: organizationId,
          metadata: {
            smallSampleThreshold: input.smallSampleThreshold,
            targetMetrics: input.targets.map((target) => target.metric),
          },
        },
      ],
    })
  } catch (error) {
    if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
    throw error
  }
  return c.json(
    AnalyticsSettings.parse({
      organizationId,
      smallSampleThreshold: input.smallSampleThreshold,
      targets: input.targets,
      updatedAt,
    }),
  )
}

async function recordFunnelEvent(
  c: AppContext,
  slug: string,
  input: AnalyticsFunnelEventInput,
): Promise<Response> {
  const db = drizzle(c.env.DB)
  const now = nowIso(requestClock(c))
  const rows = await db
    .select({ organizationId: stores.organizationId, storeId: stores.id })
    .from(stores)
    .innerJoin(organizations, eq(organizations.id, stores.organizationId))
    .innerJoin(
      webBookingPublications,
      and(
        eq(webBookingPublications.organizationId, stores.organizationId),
        eq(webBookingPublications.storeId, stores.id),
      ),
    )
    .where(
      and(
        eq(webBookingPublications.publicSlug, slug),
        eq(stores.isActive, '1'),
        eq(organizations.isDisabled, '0'),
        ...publicPublicationWindow(now),
      ),
    )
  const row = rows[0]
  if (row === undefined) return c.json({ error: 'store_not_found' }, 404)
  // The unique (organization, session, stage) index makes a replayed step a
  // no-op, so a client retry can never inflate a funnel count.
  await db
    .insert(webBookingFunnelEvents)
    .values({
      id: crypto.randomUUID(),
      organizationId: row.organizationId,
      storeId: row.storeId,
      sessionId: input.sessionId,
      stage: input.stage,
      occurredAt: now,
    })
    .onConflictDoNothing()
  return c.json(AnalyticsFunnelEventResult.parse({ recorded: true }))
}

/* --- alerts --------------------------------------------------------------- */

async function loadAlertSettings(
  db: ReturnType<typeof drizzle>,
  organizationId: string,
  storeId: string,
  now: string,
): Promise<AlertSettings> {
  const rows = await db
    .select()
    .from(alertSettings)
    .where(
      and(eq(alertSettings.organizationId, organizationId), eq(alertSettings.storeId, storeId)),
    )
  const row = rows[0]
  if (row === undefined)
    return AlertSettings.parse({
      storeId,
      conditions: DEFAULT_ALERT_CONDITIONS,
      notificationTargets: [],
      updatedAt: now,
    })
  return AlertSettings.parse({
    storeId,
    conditions: AlertCondition.array().parse(JSON.parse(row.conditionsJson)),
    notificationTargets: JSON.parse(row.notificationTargetsJson),
    updatedAt: row.updatedAt,
  })
}

async function readAlertSettings(c: AppContext, storeId: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.read')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  return c.json(await loadAlertSettings(db, c.get('auth').org, storeId, nowIso(requestClock(c))))
}

async function updateAlertSettings(
  c: AppContext,
  storeId: string,
  input: AlertSettingsInput,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.manage')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const organizationId = c.get('auth').org
  const clock = requestClock(c)
  const updatedAt = nowIso(clock)
  const conditionsJson = JSON.stringify(input.conditions)
  const notificationTargetsJson = JSON.stringify(input.notificationTargets)
  try {
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .insert(alertSettings)
          .values({
            id: crypto.randomUUID(),
            organizationId,
            storeId,
            conditionsJson,
            notificationTargetsJson,
            createdAt: updatedAt,
            updatedAt,
          })
          .onConflictDoUpdate({
            target: [alertSettings.organizationId, alertSettings.storeId],
            set: { conditionsJson, notificationTargetsJson, updatedAt },
          }),
      ],
      events: [
        {
          organizationId,
          storeId,
          actorType: 'user',
          actorId: c.get('auth').sub,
          action: 'alert.settings_updated',
          entityType: 'alert_settings',
          entityId: storeId,
          metadata: {
            enabledCodes: input.conditions
              .filter((condition) => condition.enabled)
              .map((condition) => condition.code),
            // Addresses stay out of the audit metadata; only the count is a fact
            // an auditor needs.
            notificationTargetCount: input.notificationTargets.length,
          },
        },
      ],
    })
  } catch (error) {
    if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
    throw error
  }
  return c.json(
    AlertSettings.parse({
      storeId,
      conditions: input.conditions,
      notificationTargets: input.notificationTargets,
      updatedAt,
    }),
  )
}

function alertRecordFrom(row: typeof operationalAlerts.$inferSelect): AlertRecord {
  return AlertRecord.parse({
    id: row.id,
    storeId: row.storeId,
    kind: row.kind,
    code: row.code,
    title: row.title,
    reason: row.reason,
    subject: row.subject,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    occurredAt: row.occurredAt,
    nextAction: row.nextAction,
    readAt: row.readAt,
    readBy: row.readBy,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
    resolutionNote: row.resolutionNote,
  })
}

/**
 * Evaluate every enabled warning condition for one store and persist what is
 * newly true. Dedupe keys make this safe to call as often as an operator
 * likes; a scheduled trigger would call exactly this handler.
 */
async function evaluateStoreAlerts(c: AppContext, storeId: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.write')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const organizationId = c.get('auth').org
  const clock = requestClock(c)
  const now = clock.now()
  const evaluatedAt = nowIso(clock)
  const settings = await loadAlertSettings(db, organizationId, storeId, evaluatedAt)
  const enabled = new Map(settings.conditions.map((condition) => [condition.code, condition]))
  const isEnabled = (code: AlertCode) => enabled.get(code)?.enabled === true

  const descriptors: AlertDescriptor[] = []
  if (isEnabled('long_wait')) {
    const waitingReservations = await db
      .select()
      .from(reservations)
      .where(
        and(
          eq(reservations.organizationId, organizationId),
          eq(reservations.storeId, storeId),
          eq(reservations.progress, 'waiting'),
        ),
      )
    const waitingWalkins = await db
      .select()
      .from(walkins)
      .where(
        and(
          eq(walkins.organizationId, organizationId),
          eq(walkins.storeId, storeId),
          eq(walkins.progress, 'waiting'),
        ),
      )
    descriptors.push(
      ...longWaitAlerts({
        entries: [
          ...waitingReservations.map((row) => ({
            subjectType: 'reservation' as const,
            subjectId: row.id,
            subject: `予約番号 ${row.reservationNumber}`,
            waitStartedAt: row.waitStartedAt,
            isWaiting: true,
          })),
          ...waitingWalkins.map((row) => ({
            subjectType: 'walkin' as const,
            subjectId: row.id,
            subject: `来店番号 ${row.sequence}`,
            waitStartedAt: row.arrivedAt,
            isWaiting: true,
          })),
        ],
        thresholdMinutes: enabled.get('long_wait')?.thresholdMinutes ?? 15,
        now,
      }),
    )
  }
  if (isEnabled('recording_save_failure')) {
    const failed = await db
      .select()
      .from(recordings)
      .where(
        and(
          eq(recordings.organizationId, organizationId),
          eq(recordings.storeId, storeId),
          eq(recordings.state, 'failed'),
        ),
      )
    descriptors.push(...recordingFailureAlerts(failed))
  }
  if (isEnabled('settings_contradiction')) {
    const purposeRows = await db
      .select()
      .from(visitPurposes)
      .where(
        and(eq(visitPurposes.organizationId, organizationId), eq(visitPurposes.storeId, storeId)),
      )
    descriptors.push(...settingsContradictionAlerts(purposeRows, now))
  }

  const existing =
    descriptors.length === 0
      ? []
      : await db
          .select({ dedupeKey: operationalAlerts.dedupeKey })
          .from(operationalAlerts)
          .where(
            and(
              eq(operationalAlerts.organizationId, organizationId),
              inArray(
                operationalAlerts.dedupeKey,
                descriptors.map((descriptor) => descriptor.dedupeKey),
              ),
            ),
          )
  const known = new Set(existing.map((row) => row.dedupeKey))
  const fresh = descriptors.filter((descriptor) => !known.has(descriptor.dedupeKey))
  const inserted = fresh.map((descriptor) => ({
    id: crypto.randomUUID(),
    organizationId,
    storeId,
    kind: descriptor.kind,
    code: descriptor.code,
    title: descriptor.title,
    reason: descriptor.reason,
    subject: descriptor.subject,
    subjectType: descriptor.subjectType,
    subjectId: descriptor.subjectId,
    occurredAt: descriptor.occurredAt,
    nextAction: descriptor.nextAction,
    dedupeKey: descriptor.dedupeKey,
    readAt: null,
    readBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    createdAt: evaluatedAt,
    updatedAt: evaluatedAt,
  }))
  if (inserted.length > 0) {
    try {
      await writeAuditBatch(db, {
        clock,
        operations: inserted.map((values) =>
          db.insert(operationalAlerts).values(values).onConflictDoNothing(),
        ),
        events: inserted.map((values) => ({
          organizationId,
          storeId,
          actorType: 'user',
          actorId: c.get('auth').sub,
          action: 'alert.raised',
          entityType: 'operational_alert',
          entityId: values.id,
          metadata: { code: values.code, subjectType: values.subjectType },
        })),
      })
    } catch (error) {
      if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
      throw error
    }
  }
  return c.json(
    AlertEvaluationResult.parse({
      evaluatedAt,
      raised: inserted.length,
      disabledCodes: settings.conditions
        .filter((condition) => !condition.enabled)
        .map((condition) => condition.code),
      alerts: inserted.map(alertRecordFrom),
    }),
  )
}

async function listStoreAlerts(
  c: AppContext,
  storeId: string,
  query: AlertListQuery,
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.read')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const rows = await db
    .select()
    .from(operationalAlerts)
    .where(
      and(
        eq(operationalAlerts.organizationId, c.get('auth').org),
        eq(operationalAlerts.storeId, storeId),
        ...(query.kind === undefined ? [] : [eq(operationalAlerts.kind, query.kind)]),
        ...(query.status === 'unread' ? [isNull(operationalAlerts.readAt)] : []),
        ...(query.status === 'unresolved' ? [isNull(operationalAlerts.resolvedAt)] : []),
      ),
    )
    .orderBy(desc(operationalAlerts.occurredAt))
  return c.json(AlertRecord.array().parse(rows.map(alertRecordFrom)))
}

async function findStoreAlert(
  c: AppContext,
  storeId: string,
  alertId: string,
): Promise<typeof operationalAlerts.$inferSelect | undefined> {
  const db = drizzle(c.env.DB)
  const rows = await db
    .select()
    .from(operationalAlerts)
    .where(
      and(
        eq(operationalAlerts.organizationId, c.get('auth').org),
        eq(operationalAlerts.storeId, storeId),
        eq(operationalAlerts.id, alertId),
      ),
    )
  return rows[0]
}

async function readStoreAlert(c: AppContext, storeId: string, alertId: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.read')
  if (denied) return denied
  const row = await findStoreAlert(c, storeId, alertId)
  if (row === undefined) return c.json({ error: 'alert_not_found' }, 404)
  return c.json(alertRecordFrom(row))
}

/**
 * 既読 and 対応済み are two independent transitions (AC-EYEX-120). Marking an
 * alert read never marks it handled, and the first reader is kept rather than
 * overwritten by whoever opened it last.
 */
async function acknowledgeStoreAlert(
  c: AppContext,
  storeId: string,
  alertId: string,
  transition: { kind: 'read' } | { kind: 'resolve'; note: string },
): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.write')
  if (denied) return denied
  const row = await findStoreAlert(c, storeId, alertId)
  if (row === undefined) return c.json({ error: 'alert_not_found' }, 404)
  const db = drizzle(c.env.DB)
  const clock = requestClock(c)
  const at = nowIso(clock)
  const actorId = c.get('auth').sub
  const alreadyDone = transition.kind === 'read' ? row.readAt !== null : row.resolvedAt !== null
  if (alreadyDone) return c.json(alertRecordFrom(row))
  const patch =
    transition.kind === 'read'
      ? { readAt: at, readBy: actorId, updatedAt: at }
      : { resolvedAt: at, resolvedBy: actorId, resolutionNote: transition.note, updatedAt: at }
  try {
    await writeAuditBatch(db, {
      clock,
      operations: [
        db
          .update(operationalAlerts)
          .set(patch)
          .where(
            and(
              eq(operationalAlerts.organizationId, row.organizationId),
              eq(operationalAlerts.id, row.id),
            ),
          ),
      ],
      events: [
        {
          organizationId: row.organizationId,
          storeId,
          actorType: 'user',
          actorId,
          action: transition.kind === 'read' ? 'alert.read' : 'alert.resolved',
          entityType: 'operational_alert',
          entityId: row.id,
          metadata: { code: row.code },
        },
      ],
    })
  } catch (error) {
    if (error instanceof AuditAppendError) return c.json({ error: error.code }, error.status)
    throw error
  }
  return c.json(alertRecordFrom({ ...row, ...patch }))
}

const routes = app
  .get('/api/health', (c) => c.json({ status: 'ok' as const }))
  .get('/api/public/stores', zValidator('query', PublicStoreSearchQuery), async (c) =>
    c.json(await listPublicStores(c as AppContext, c.req.valid('query'))),
  )
  // Public slots are scoped by the resolved public store slug, never by an
  // organization or store id taken from the query.
  .get('/api/public/stores/:slug/slots', zValidator('query', AvailabilitySlotsQuery), async (c) =>
    readPublicAvailability(c as AppContext, c.req.param('slug'), c.req.valid('query')),
  )
  // 候補枠は日付を受け取らない。日付は顧客の入力ではなく走査の結果である。
  .get('/api/public/stores/:slug/offers', zValidator('query', PublicOffersQuery), async (c) =>
    readPublicOffers(c as AppContext, c.req.param('slug'), c.req.valid('query')),
  )
  .post(
    '/api/public/stores/:slug/reservations',
    zValidator('json', PublicBookingCreate),
    async (c) => createPublicReservation(c as AppContext, c.req.param('slug'), c.req.valid('json')),
  )
  .get(
    '/api/public/reservations/status',
    zValidator('query', PublicReservationStatusQuery),
    async (c) => readPublicReservationStatus(c as AppContext, c.req.valid('query').confirmationKey),
  )
  .post(
    '/api/public/reservations/verify',
    zValidator('json', PublicReservationVerification),
    async (c) => verifyPublicReservationManagementCode(c as AppContext, c.req.valid('json')),
  )
  .post(
    '/api/public/reservations/:reservationId/cancel',
    zValidator('json', PublicReservationCancel),
    async (c) =>
      cancelPublicReservation(c as AppContext, c.req.param('reservationId'), c.req.valid('json')),
  )
  .patch(
    '/api/public/reservations/:reservationId',
    zValidator('json', PublicReservationChange),
    async (c) =>
      changePublicReservation(c as AppContext, c.req.param('reservationId'), c.req.valid('json')),
  )
  .get('/api/public/stores/:slug', async (c) =>
    readPublicStore(c as AppContext, c.req.param('slug')),
  )
  .post('/api/auth/login', zValidator('json', LoginRequest), async (c) =>
    domainLogin(c as AppContext, c.req.valid('json')),
  )
  .post('/api/auth/refresh', async (c) => domainRefresh(c as AppContext))
  .get('/api/shared-terminals/:terminalId/session', async (c) =>
    readSharedTerminalSession(c, c.req.param('terminalId'), requestClock(c)),
  )
  .post(
    '/api/shared-terminals/:terminalId/reauthenticate',
    zValidator('json', SharedTerminalReauthenticationInput),
    async (c) =>
      issueSharedTerminalReauthentication(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.valid('json'),
        requestClock(c),
      ),
  )
  .get('/api/shared-terminals/:terminalId/reauthentication', async (c) => {
    const denied = await requirePersonalReauth(
      c as AppContext,
      c.req.param('terminalId'),
      'management',
      requestClock(c),
    )
    if (denied) return denied
    return c.json({ authorized: true })
  })
  .post('/api/shared-terminals/:terminalId/revoke', async (c) =>
    revokeCurrentSharedTerminal(c as AppContext, c.req.param('terminalId')),
  )
  .get(
    '/api/shared-terminals/:terminalId/stores/:storeId/ledger',
    zValidator('query', LedgerQuery),
    async (c) => {
      const denied = await establishSharedTerminalDailyActor(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.param('storeId'),
        requestClock(c),
      )
      if (denied) return denied
      return readLedger(c as AppContext, c.req.param('storeId'), c.req.valid('query').date)
    },
  )
  .post(
    '/api/shared-terminals/:terminalId/stores/:storeId/walkins',
    zValidator('json', WalkinCreate),
    async (c) => {
      const denied = await establishSharedTerminalDailyActor(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.param('storeId'),
        requestClock(c),
      )
      if (denied) return denied
      return createWalkin(c as AppContext, c.req.param('storeId'))
    },
  )
  .patch(
    '/api/shared-terminals/:terminalId/stores/:storeId/walkins/:walkinId/progress',
    zValidator('json', WalkinProgressPatch),
    async (c) => {
      const denied = await establishSharedTerminalDailyActor(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.param('storeId'),
        requestClock(c),
      )
      if (denied) return denied
      return updateWalkinProgress(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('walkinId'),
        c.req.valid('json'),
      )
    },
  )
  .patch(
    '/api/shared-terminals/:terminalId/stores/:storeId/reservations/:reservationId/progress',
    zValidator('json', ReservationProgressPatch),
    async (c) => {
      const denied = await establishSharedTerminalDailyActor(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.param('storeId'),
        requestClock(c),
      )
      if (denied) return denied
      return updateReservationProgress(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('reservationId'),
        c.req.valid('json'),
      )
    },
  )
  .patch(
    '/api/shared-terminals/:terminalId/stores/:storeId/walkins/:walkinId/customer',
    zValidator('json', WalkinCustomerPatch),
    async (c) => {
      const denied = await establishSharedTerminalDailyActor(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.param('storeId'),
        requestClock(c),
      )
      if (denied) return denied
      return linkWalkinCustomer(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('walkinId'),
        c.req.valid('json'),
      )
    },
  )
  .get('/api/shared-terminals/:terminalId/stores/:storeId/availability/settings', (c) =>
    c.json({ error: 'forbidden' }, 403),
  )
  .post('/api/internal/organizations/sync', zValidator('json', OrganizationSync), async (c) =>
    persistOrganization(c, c.req.valid('json')),
  )
  // Keep the non-suffixed path as a compatibility alias for service-binding
  // callers created during the foundation migration.
  .post('/api/internal/organizations', zValidator('json', OrganizationSync), async (c) =>
    persistOrganization(c, c.req.valid('json')),
  )
  .post('/api/internal/stores/sync', zValidator('json', Store), async (c) =>
    persistStore(c, c.req.valid('json')),
  )
  .post('/api/internal/stores', zValidator('json', Store), async (c) =>
    persistStore(c, c.req.valid('json')),
  )
  .post('/api/internal/store-memberships/sync', zValidator('json', StoreMembership), async (c) =>
    persistMembership(c, c.req.valid('json')),
  )
  .get('/api/staff/stores', async (c) => {
    const storesForActor = await listAccessibleStores(c as StoreContext)
    return c.json(storesForActor)
  })
  .post('/api/staff/store-switches', zValidator('json', StoreSwitchInput), async (c) =>
    auditStoreSwitch(c as AppContext, c.req.valid('json')),
  )
  .get('/api/staff/stores/:storeId', async (c) => {
    const storeId = c.req.param('storeId')
    const access = await authorizedStore(c as StoreContext, storeId)
    if (!access) return c.json({ error: 'forbidden' }, 403)
    return c.json(access.store)
  })
  /*
   * What the caller may do in this store, from the server's own evaluation.
   * The UI needs this to decide whether restricted information is shown at
   * all; letting the client infer it from a role would either over-expose
   * customer data or hide it from staff entitled to see it.
   */
  .get('/api/staff/stores/:storeId/permissions', async (c) => {
    const access = await authorizedStore(c as StoreContext, c.req.param('storeId'))
    if (!access) return c.json({ error: 'forbidden' }, 403)
    return c.json(StorePermission.array().parse(access.actor.permissions))
  })
  .patch('/api/staff/stores/:storeId', zValidator('json', StorePatch), async (c) => {
    const storeId = c.req.param('storeId')
    const denied = await requireStorePermission(c as StoreContext, storeId, 'store.manage')
    if (denied) return denied
    const patch = c.req.valid('json')
    const organizationId = c.get('auth').org
    const values: { name?: string; isActive?: string } = {}
    if (patch.name !== undefined) values.name = patch.name
    if (patch.isActive !== undefined) values.isActive = patch.isActive ? '1' : '0'
    const db = drizzle(c.env.DB)
    const updated = await db
      .update(stores)
      .set(values)
      .where(and(eq(stores.id, storeId), eq(stores.organizationId, organizationId)))
      .returning()
    const row = updated[0]
    if (!row) return c.json({ error: 'forbidden' }, 403)
    return c.json({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      slug: row.slug,
      isActive: row.isActive === '1',
      createdAt: row.createdAt,
    })
  })
  .post(
    '/api/staff/stores/:storeId/shared-terminals',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'terminal.manage',
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', SharedTerminalCreateInput),
    async (c) => createSharedTerminal(c as AppContext, c.req.param('storeId'), c.req.valid('json')),
  )
  .get('/api/staff/stores/:storeId/shared-terminals', async (c) =>
    listSharedTerminals(c as AppContext, c.req.param('storeId')),
  )
  .post('/api/staff/stores/:storeId/shared-terminals/:terminalId/revoke', async (c) =>
    revokeSharedTerminal(c as AppContext, c.req.param('storeId'), c.req.param('terminalId')),
  )
  .get('/api/staff/stores/:storeId/availability/settings', async (c) => {
    const storeId = c.req.param('storeId')
    const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.read')
    if (denied) return denied
    const settings = await readAvailabilitySettings(drizzle(c.env.DB), c.get('auth').org, storeId)
    return c.json(AvailabilityStoreSettings.parse(settings))
  })
  .put(
    '/api/staff/stores/:storeId/availability/settings',
    zValidator('json', AvailabilitySettingsInput),
    async (c) => {
      const storeId = c.req.param('storeId')
      return saveAvailabilitySettings(c as AppContext, storeId, c.req.valid('json'))
    },
  )
  .get('/api/staff/stores/:storeId/availability/draft', async (c) => {
    const storeId = c.req.param('storeId')
    const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.read')
    if (denied) return denied
    const found = await requireSettingsDraft(c as AppContext, storeId)
    if ('error' in found) return found.error
    return c.json(toSettingsDraft(found.row))
  })
  .put(
    '/api/staff/stores/:storeId/availability/draft',
    zValidator('json', SettingsDraftInput),
    async (c) => saveSettingsDraft(c as AppContext, c.req.param('storeId'), c.req.valid('json')),
  )
  .get('/api/staff/stores/:storeId/availability/draft/impact', async (c) => {
    const storeId = c.req.param('storeId')
    const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.read')
    if (denied) return denied
    const found = await requireSettingsDraft(c as AppContext, storeId)
    if ('error' in found) return found.error
    return c.json(
      await buildSettingsImpact(c as AppContext, found.db, c.get('auth').org, found.row),
    )
  })
  .post(
    '/api/staff/stores/:storeId/availability/draft/conflicts/:reservationId',
    zValidator('json', SettingsConflictResolutionInput),
    async (c) =>
      recordSettingsConflictResolution(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('reservationId'),
        c.req.valid('json'),
      ),
  )
  .post(
    '/api/staff/stores/:storeId/availability/publications',
    zValidator('json', SettingsPublicationRequest),
    async (c) =>
      createSettingsPublication(c as AppContext, c.req.param('storeId'), c.req.valid('json')),
  )
  .get('/api/staff/stores/:storeId/availability/publications/:publicationId', async (c) =>
    readSettingsPublication(c as AppContext, c.req.param('storeId'), c.req.param('publicationId')),
  )
  .patch(
    '/api/staff/stores/:storeId/availability/publications/:publicationId',
    zValidator('json', SettingsPublicationPatch),
    async (c) =>
      patchSettingsPublication(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('publicationId'),
        c.req.valid('json'),
      ),
  )
  .post('/api/staff/stores/:storeId/availability/publications/:publicationId/run', async (c) =>
    runSettingsPublication(c as AppContext, c.req.param('storeId'), c.req.param('publicationId')),
  )
  .post('/api/staff/stores/:storeId/availability/publications/:publicationId/retry', async (c) =>
    retrySettingsPublication(c as AppContext, c.req.param('storeId'), c.req.param('publicationId')),
  )
  .get('/api/staff/stores/:storeId/availability/versions', async (c) =>
    listSettingsVersions(c as AppContext, c.req.param('storeId')),
  )
  .get('/api/staff/stores/:storeId/availability/versions/:versionId', async (c) =>
    readSettingsVersion(c as AppContext, c.req.param('storeId'), c.req.param('versionId')),
  )
  .post('/api/staff/stores/:storeId/availability/versions/:versionId/restore', async (c) =>
    restoreSettingsVersion(c as AppContext, c.req.param('storeId'), c.req.param('versionId')),
  )
  .get('/api/staff/stores/:storeId/availability/chain-default', async (c) =>
    readChainDefault(c as AppContext, c.req.param('storeId')),
  )
  .put(
    '/api/staff/stores/:storeId/availability/chain-default',
    zValidator('json', SettingsDraftInput),
    async (c) => saveChainDefault(c as AppContext, c.req.param('storeId'), c.req.valid('json')),
  )
  .get('/api/staff/stores/:storeId/availability/override', async (c) =>
    readSettingsOverride(c as AppContext, c.req.param('storeId')),
  )
  .post('/api/staff/stores/:storeId/availability/override/release', async (c) =>
    releaseSettingsOverride(c as AppContext, c.req.param('storeId')),
  )
  .get(
    '/api/staff/stores/:storeId/ledger',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'reservation.read',
      )
      if (denied) return denied
      await next()
    },
    zValidator('query', LedgerQuery),
    async (c) => readLedger(c as AppContext, c.req.param('storeId'), c.req.valid('query').date),
  )
  .get(
    '/api/staff/stores/:storeId/reception-history',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'reservation.read',
      )
      if (denied) return denied
      await next()
    },
    zValidator('query', ReceptionHistoryQuery),
    async (c) =>
      readReceptionHistory(c as AppContext, c.req.param('storeId'), c.req.valid('query')),
  )
  .patch(
    '/api/staff/stores/:storeId/reservations/:reservationId/progress',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'reservation.write',
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', ReservationProgressPatch),
    async (c) =>
      updateReservationProgress(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('reservationId'),
        c.req.valid('json'),
      ),
  )
  .get(
    '/api/staff/stores/:storeId/reservations',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'reservation.read',
      )
      if (denied) return denied
      await next()
    },
    zValidator('query', ReservationSearchQuery),
    async (c) => searchReservations(c as AppContext, c.req.param('storeId'), c.req.valid('query')),
  )
  .get('/api/staff/stores/:storeId/reservations/:reservationId', async (c) =>
    readReservation(c as AppContext, c.req.param('storeId'), c.req.param('reservationId')),
  )
  .get('/api/staff/stores/:storeId/reservations/:reservationId/history', async (c) =>
    readReservationChangeHistory(
      c as AppContext,
      c.req.param('storeId'),
      c.req.param('reservationId'),
    ),
  )
  .patch(
    '/api/staff/stores/:storeId/reservations/:reservationId',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'reservation.write',
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', ReservationChangeInput),
    async (c) =>
      changeReservation(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('reservationId'),
        c.req.valid('json'),
      ),
  )
  .post(
    '/api/staff/stores/:storeId/reservations/:reservationId/management-code/reissue',
    async (c) =>
      reissueManagementCode(c as AppContext, c.req.param('storeId'), c.req.param('reservationId')),
  )
  .post(
    '/api/staff/stores/:storeId/reservations/:reservationId/cancel',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'reservation.write',
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', ReservationCancelInput),
    async (c) =>
      cancelReservation(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('reservationId'),
        c.req.valid('json'),
      ),
  )
  .post(
    '/api/staff/stores/:storeId/reservations/:reservationId/no-show',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'reservation.write',
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', ReservationNoShowInput),
    async (c) =>
      markReservationNoShow(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('reservationId'),
        c.req.valid('json'),
      ),
  )
  .get(
    '/api/staff/stores/:storeId/availability/slots',
    zValidator('query', AvailabilitySlotsQuery),
    async (c) => {
      const storeId = c.req.param('storeId')
      const denied = await requireStorePermission(c as StoreContext, storeId, 'settings.read')
      if (denied) return denied
      const query = c.req.valid('query')
      const db = drizzle(c.env.DB)
      const settings = await readAvailabilitySettings(db, c.get('auth').org, storeId)
      let result: AvailabilityResult
      try {
        result = calculateAvailability(
          {
            date: query.date,
            store: {
              receptionStatus: settings.receptionStatus,
              businessHours: settings.businessHours,
              exceptions: settings.exceptions,
            },
            purposes: settings.purposes,
            staff: settings.staff,
            shifts: settings.shifts,
            equipment: settings.equipment,
            maintenance: settings.maintenance,
            bookings: await readAvailabilityBookings(db, c.get('auth').org, storeId),
          },
          query.purposeIds,
        )
      } catch (error) {
        if (error instanceof RangeError) return c.json({ error: 'invalid_purpose_selection' }, 400)
        throw error
      }
      return c.json(
        AvailabilitySlotsResponse.parse({
          storeId,
          ...result,
        }),
      )
    },
  )
  .post(
    '/api/staff/stores/:storeId/reservations',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'reservation.write',
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', StaffReservationCreate),
    async (c) =>
      createStaffReservation(c as AppContext, c.req.param('storeId'), c.req.valid('json')),
  )
  .post('/api/staff/stores/:storeId/walkins', zValidator('json', WalkinCreate), async (c) =>
    createWalkin(c as AppContext, c.req.param('storeId')),
  )
  .patch(
    '/api/staff/stores/:storeId/walkins/:walkinId/customer',
    zValidator('json', WalkinCustomerPatch),
    async (c) =>
      linkWalkinCustomer(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('walkinId'),
        c.req.valid('json'),
      ),
  )
  .patch(
    '/api/staff/stores/:storeId/walkins/:walkinId/progress',
    zValidator('json', WalkinProgressPatch),
    async (c) =>
      updateWalkinProgress(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('walkinId'),
        c.req.valid('json'),
      ),
  )
  .get('/api/staff/stores/:storeId/walkins', zValidator('query', WalkinListQuery), async (c) =>
    listWalkins(c as AppContext, c.req.param('storeId'), c.req.valid('query').status),
  )
  .get(
    '/api/staff/stores/:storeId/customers',
    zValidator('query', CustomerSearchQuery),
    async (c) =>
      findCustomerCandidates(c as AppContext, c.req.param('storeId'), c.req.valid('query')),
  )

  .get('/api/staff/stores/:storeId/customers/:customerId', async (c) =>
    readCustomerDetail(c as AppContext, c.req.param('storeId'), c.req.param('customerId')),
  )
  .get(
    '/api/staff/stores/:storeId/recordings',
    zValidator('query', RecordingListQuery),
    async (c) => listRecordings(c as AppContext, c.req.param('storeId'), c.req.valid('query')),
  )
  .post(
    '/api/staff/stores/:storeId/recordings',
    zValidator('json', RecordingMetadataCreate),
    async (c) =>
      createRecordingMetadata(c as AppContext, c.req.param('storeId'), c.req.valid('json')),
  )
  .get('/api/staff/stores/:storeId/recordings/:recordingId', async (c) =>
    readRecording(c as AppContext, c.req.param('storeId'), c.req.param('recordingId')),
  )
  .put('/api/staff/stores/:storeId/recordings/:recordingId/audio', async (c) =>
    uploadRecordingAudio(c as AppContext, c.req.param('storeId'), c.req.param('recordingId')),
  )
  // Streaming playback only — no download route exists anywhere in this API.
  .get('/api/staff/stores/:storeId/recordings/:recordingId/audio', async (c) =>
    playRecording(c as AppContext, c.req.param('storeId'), c.req.param('recordingId')),
  )
  .post('/api/staff/stores/:storeId/recordings/:recordingId/retry', async (c) =>
    retryRecordingUpload(c as AppContext, c.req.param('storeId'), c.req.param('recordingId')),
  )
  .post(
    '/api/staff/stores/:storeId/recordings/:recordingId/reservation',
    zValidator('json', RecordingReservationLink),
    async (c) =>
      linkRecordingReservation(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('recordingId'),
        c.req.valid('json'),
      ),
  )
  .post(
    '/api/staff/stores/:storeId/recordings/:recordingId/hold',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'recording.manage',
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', RecordingHoldInput),
    async (c) =>
      holdRecording(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('recordingId'),
        c.req.valid('json'),
        staffRecordingActor(c as AppContext),
      ),
  )
  .post(
    '/api/staff/stores/:storeId/recordings/:recordingId/hold/release',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'recording.manage',
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', RecordingHoldRelease),
    async (c) =>
      releaseRecordingHold(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('recordingId'),
        c.req.valid('json'),
        staffRecordingActor(c as AppContext),
      ),
  )
  .delete('/api/staff/stores/:storeId/recordings/:recordingId', async (c) =>
    deleteRecording(c as AppContext, c.req.param('storeId'), c.req.param('recordingId')),
  )
  .get('/api/staff/stores/:storeId/recording-retention', async (c) =>
    readRecordingRetention(c as AppContext, c.req.param('storeId')),
  )
  .put(
    '/api/staff/stores/:storeId/recording-retention',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'recording.manage',
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', RecordingRetentionSettingsInput),
    async (c) =>
      saveRecordingRetention(c as AppContext, c.req.param('storeId'), c.req.valid('json')),
  )
  .post(
    '/api/shared-terminals/:terminalId/stores/:storeId/recordings/:recordingId/hold',
    zValidator('json', RecordingHoldInput),
    async (c) => {
      const actor = await sharedTerminalRecordingManager(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.param('storeId'),
      )
      if (actor instanceof Response) return actor
      return holdRecording(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('recordingId'),
        c.req.valid('json'),
        actor,
      )
    },
  )
  .post(
    '/api/shared-terminals/:terminalId/stores/:storeId/recordings/:recordingId/hold/release',
    zValidator('json', RecordingHoldRelease),
    async (c) => {
      const actor = await sharedTerminalRecordingManager(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.param('storeId'),
      )
      if (actor instanceof Response) return actor
      return releaseRecordingHold(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('recordingId'),
        c.req.valid('json'),
        actor,
      )
    },
  )
  .post(
    '/api/internal/recordings/reconcile',
    zValidator('json', RecordingReconciliationRequest),
    async (c) => reconcileRecordings(c as AppContext, c.req.valid('json')),
  )

  .get('/api/staff/stores/:storeId/attention-settings', async (c) =>
    readAttentionSettingsRoute(c as AppContext, c.req.param('storeId')),
  )
  .put(
    '/api/staff/stores/:storeId/attention-settings',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'settings.manage',
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', AttentionSettingsInput),
    async (c) =>
      saveAttentionSettings(c as AppContext, c.req.param('storeId'), c.req.valid('json')),
  )
  .post(
    '/api/staff/stores/:storeId/attention-settings/sharing-scope-impact',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'settings.manage',
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', AttentionSharingScopeImpactRequest),
    async (c) =>
      readAttentionSharingScopeImpact(c as AppContext, c.req.param('storeId'), c.req.valid('json')),
  )
  .get(
    '/api/staff/stores/:storeId/customers/:customerId/attention-notes',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'customer.read',
      )
      if (denied) return denied
      await next()
    },
    async (c) =>
      listAttentionNotes(c as AppContext, c.req.param('storeId'), c.req.param('customerId')),
  )
  .post(
    '/api/staff/stores/:storeId/customers/:customerId/attention-notes',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'customer.read',
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', AttentionNoteInput),
    async (c) =>
      registerAttentionNote(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('customerId'),
        c.req.valid('json'),
      ),
  )
  .get('/api/staff/stores/:storeId/attention-notes/:noteId/versions', async (c) =>
    readAttentionVersions(c as AppContext, c.req.param('storeId'), c.req.param('noteId')),
  )
  .post(
    '/api/staff/stores/:storeId/attention-notes/:noteId/review',
    zValidator('json', AttentionReviewInput),
    async (c) =>
      reviewAttentionNote(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('noteId'),
        c.req.valid('json'),
      ),
  )
  .post(
    '/api/staff/stores/:storeId/attention-notes/:noteId/revisions',
    zValidator('json', AttentionNoteRevisionInput),
    async (c) =>
      reviseAttentionNote(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('noteId'),
        c.req.valid('json'),
      ),
  )
  .post(
    '/api/staff/stores/:storeId/attention-notes/:noteId/hide',
    zValidator('json', AttentionHideInput),
    async (c) =>
      hideAttentionNote(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('noteId'),
        c.req.valid('json'),
      ),
  )
  .get(
    '/api/staff/stores/:storeId/audit-events',
    async (c, next) => {
      const denied = await requireStorePermission(
        c as StoreContext,
        c.req.param('storeId'),
        'audit.read',
      )
      if (denied) return denied
      await next()
    },
    zValidator('query', AuditSearchQuery),
    async (c) => searchAuditEvents(c as AppContext, c.req.param('storeId'), c.req.valid('query')),
  )
  .post(
    '/api/staff/stores/:storeId/customer-merges/preview',
    async (c, next) => {
      const denied = await requireCustomerCorrectionPermissions(
        c as AppContext,
        c.req.param('storeId'),
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', CustomerMergePreviewRequest),
    async (c) => previewCustomerMerge(c as AppContext, c.req.valid('json')),
  )
  .post(
    '/api/staff/stores/:storeId/customer-merges',
    async (c, next) => {
      const denied = await requireCustomerCorrectionPermissions(
        c as AppContext,
        c.req.param('storeId'),
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', CustomerMergeInput),
    async (c) => mergeCustomers(c as AppContext, c.req.valid('json')),
  )
  .post(
    '/api/staff/stores/:storeId/customer-links/release',
    async (c, next) => {
      const denied = await requireCustomerCorrectionPermissions(
        c as AppContext,
        c.req.param('storeId'),
      )
      if (denied) return denied
      await next()
    },
    zValidator('json', CustomerLinkReleaseInput),
    async (c) => releaseCustomerLink(c as AppContext, c.req.param('storeId'), c.req.valid('json')),
  )
  .post(
    '/api/shared-terminals/:terminalId/stores/:storeId/customers/:customerId/attention-notes',
    zValidator('json', AttentionNoteInput),
    async (c) => {
      const actor = await sharedTerminalAttentionRegistrant(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.param('storeId'),
      )
      if (actor instanceof Response) return actor
      return registerAttentionNote(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('customerId'),
        c.req.valid('json'),
        actor,
      )
    },
  )
  .post(
    '/api/shared-terminals/:terminalId/stores/:storeId/attention-notes/:noteId/review',
    zValidator('json', AttentionReviewInput),
    async (c) => {
      const actor = await sharedTerminalAttentionManager(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.param('storeId'),
        'publish',
      )
      if (actor instanceof Response) return actor
      return reviewAttentionNote(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('noteId'),
        c.req.valid('json'),
        actor,
      )
    },
  )
  .post(
    '/api/shared-terminals/:terminalId/stores/:storeId/attention-notes/:noteId/revisions',
    zValidator('json', AttentionNoteRevisionInput),
    async (c) => {
      const actor = await sharedTerminalAttentionManager(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.param('storeId'),
        'revise',
      )
      if (actor instanceof Response) return actor
      return reviseAttentionNote(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('noteId'),
        c.req.valid('json'),
        actor,
      )
    },
  )
  .post(
    '/api/shared-terminals/:terminalId/stores/:storeId/attention-notes/:noteId/hide',
    zValidator('json', AttentionHideInput),
    async (c) => {
      const actor = await sharedTerminalAttentionManager(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.param('storeId'),
        'hide',
      )
      if (actor instanceof Response) return actor
      return hideAttentionNote(
        c as AppContext,
        c.req.param('storeId'),
        c.req.param('noteId'),
        c.req.valid('json'),
        actor,
      )
    },
  )

  .get('/api/staff/stores/:storeId/analytics', zValidator('query', AnalyticsQuery), async (c) =>
    readAnalyticsReport(c as AppContext, c.req.param('storeId'), c.req.valid('query')),
  )
  .get('/api/staff/stores/:storeId/analytics/settings', async (c) =>
    readAnalyticsSettings(c as AppContext, c.req.param('storeId')),
  )
  .put(
    '/api/staff/stores/:storeId/analytics/settings',
    zValidator('json', AnalyticsSettingsInput),
    async (c) =>
      updateAnalyticsSettings(c as AppContext, c.req.param('storeId'), c.req.valid('json')),
  )
  .get('/api/staff/stores/:storeId/alert-settings', async (c) =>
    readAlertSettings(c as AppContext, c.req.param('storeId')),
  )
  .put(
    '/api/staff/stores/:storeId/alert-settings',
    zValidator('json', AlertSettingsInput),
    async (c) => updateAlertSettings(c as AppContext, c.req.param('storeId'), c.req.valid('json')),
  )
  .post('/api/staff/stores/:storeId/alerts/evaluate', async (c) =>
    evaluateStoreAlerts(c as AppContext, c.req.param('storeId')),
  )
  .get('/api/staff/stores/:storeId/alerts', zValidator('query', AlertListQuery), async (c) =>
    listStoreAlerts(c as AppContext, c.req.param('storeId'), c.req.valid('query')),
  )
  .get('/api/staff/stores/:storeId/alerts/:alertId', async (c) =>
    readStoreAlert(c as AppContext, c.req.param('storeId'), c.req.param('alertId')),
  )
  .post('/api/staff/stores/:storeId/alerts/:alertId/read', async (c) =>
    acknowledgeStoreAlert(c as AppContext, c.req.param('storeId'), c.req.param('alertId'), {
      kind: 'read',
    }),
  )
  .post(
    '/api/staff/stores/:storeId/alerts/:alertId/resolve',
    zValidator('json', AlertResolveInput),
    async (c) =>
      acknowledgeStoreAlert(c as AppContext, c.req.param('storeId'), c.req.param('alertId'), {
        kind: 'resolve',
        note: c.req.valid('json').note,
      }),
  )
  .post(
    '/api/public/stores/:slug/funnel-events',
    zValidator('json', AnalyticsFunnelEventInput),
    async (c) => recordFunnelEvent(c as AppContext, c.req.param('slug'), c.req.valid('json')),
  )

export type AppType = typeof routes

export default app
