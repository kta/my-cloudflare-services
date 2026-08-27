import {
  AvailabilityBusinessHours,
  AvailabilityEquipment,
  AvailabilityException,
  AvailabilityMaintenance,
  AvailabilityPurpose,
  AvailabilitySettingsInput,
  AvailabilitySlotsQuery,
  AvailabilitySlotsResponse,
  AvailabilityStaff,
  AvailabilityStaffShift,
  AvailabilityStoreSettings,
  CustomerCandidate,
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
  PublicAvailabilityQuery,
  PublicAvailabilityResponse,
  PublicBookingCreate,
  PublicBookingResult,
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
  RefreshResponse,
  Reservation,
  ReservationCancelInput,
  ReservationChangeHistoryEntry,
  ReservationChangeInput,
  ReservationNoShowInput,
  ReservationProgressPatch,
  ReservationSearchQuery,
  SharedTerminal,
  SharedTerminalCreateInput,
  SharedTerminalIssue,
  SharedTerminalReauthenticationInput,
  SharedTerminalReauthenticationIssue,
  StaffReservationCreate,
  StoreMembershipSync,
  StorePatch,
  StorePermission,
  StoreSwitchInput,
  StoreSync,
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
  auditEvents,
  availabilityBookings,
  availabilityBusinessHours,
  availabilityEquipment,
  availabilityExceptions,
  availabilityMaintenances,
  availabilitySettings,
  availabilityStaff,
  availabilityStaffShifts,
  customers,
  idempotencyRecords,
  organizations,
  reservationChanges,
  reservationProgressEvents,
  reservationResourceAllocations,
  reservations,
  sharedTerminalReauthSessions,
  sharedTerminals,
  storeMemberships,
  stores,
  visitPurposes,
  walkinDailySequences,
  walkinEvents,
  walkins,
  webBookingManagementCodeIssues,
  webBookingNotificationAttempts,
  webBookingPublications,
  webBookingRecords,
  webBookingVerifiedSessions,
} from './db/schema'
import { AuditAppendError, writeAuditBatch } from './domain/audit'
import {
  type AvailabilityBooking,
  type AvailabilityResult,
  calculateAvailability,
  selectAvailabilityAllocation,
} from './domain/availability'
import { type Clock, nowIso, systemClock } from './domain/clock'
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
import { publicationUnavailableReason } from './domain/publication'
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
    ...publicPublicationWindow(nowIso(systemClock())),
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
  return PublicStoreSummary.array().parse(
    ordered.map(({ latitude: _latitude, longitude: _longitude, ...store }) => store),
  )
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
    systemClock().now(),
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
  return c.json(
    PublicStoreDetail.parse({
      slug: store.slug,
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
    systemClock().now(),
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
    systemClock().now(),
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
        clock: systemClock(),
      },
      async (completeInBatch) =>
        retryableBeforeCommit(async () => {
          const { selected, allocation, claimSlots, equipmentResourceIds, purposeResourceIds } =
            await prepareReservationAllocation(db, store.organizationId, store.storeId, input)
          const id = crypto.randomUUID()
          const createdAt = nowIso(systemClock())
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
              clock: systemClock(),
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
                db
                  .insert(availabilityBookings)
                  .values({
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
                db
                  .insert(webBookingRecords)
                  .values({
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
                db
                  .insert(webBookingManagementCodeIssues)
                  .values({
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
  if (!row || !row.email)
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
  if (!deliveryState || deliveryState.status !== 'confirmed') {
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

async function persistStore(c: AppContext, store: StoreSync) {
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

async function persistMembership(c: AppContext, membership: StoreMembershipSync) {
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
  const updatedAt = nowIso(systemClock())
  const persisted = AvailabilityStoreSettings.parse({ ...input, storeId, version })
  const topLevel =
    current.version === 0
      ? db.insert(availabilitySettings).values({
          id: crypto.randomUUID(),
          organizationId,
          storeId,
          version,
          receptionStatus: persisted.receptionStatus,
          updatedBy: c.get('auth').sub,
          updatedAt,
        })
      : db
          .update(availabilitySettings)
          .set({
            version,
            receptionStatus: persisted.receptionStatus,
            updatedBy: c.get('auth').sub,
            updatedAt,
          })
          .where(
            and(
              eq(availabilitySettings.organizationId, organizationId),
              eq(availabilitySettings.storeId, storeId),
              eq(availabilitySettings.version, current.version),
            ),
          )

  const operations = [
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

  await writeAuditBatch(db, {
    clock: systemClock(),
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
  capacity: number,
  claimSlots: readonly string[],
  occupied: ReadonlySet<string>,
): string {
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
      settings.equipment.find((candidate) => candidate.id === equipmentId)!.capacity,
      claimSlots,
      occupiedClaims,
    ),
  )
  const purposeResourceIds = input.purposeIds.map((purposeId) =>
    selectClaimUnit(
      'purpose',
      purposeId,
      settings.purposes.find((candidate) => candidate.id === purposeId)!.maxConcurrent,
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
        clock: systemClock(),
      },
      async (completeInBatch) =>
        retryableBeforeCommit(async () => {
          const { selected, allocation, claimSlots, equipmentResourceIds, purposeResourceIds } =
            await prepareReservationAllocation(db, organizationId, storeId, input)
          const id = crypto.randomUUID()
          const createdAt = nowIso(systemClock())
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
              clock: systemClock(),
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
    const createdAt = nowIso(systemClock())
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
  const updatedAt = nowIso(systemClock())
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
    const createdAt = nowIso(systemClock())
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

  const updatedAt = nowIso(systemClock())
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
    const createdAt = nowIso(systemClock())
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
        equipment!.capacity,
        claimSlots,
        occupiedClaims,
      )
    })
    const purposeResourceIds = input.purposeIds.map((purposeId) => {
      const purpose = settings.purposes.find((candidate) => candidate.id === purposeId)
      return selectClaimUnit(
        'purpose',
        purposeId,
        purpose!.maxConcurrent,
        claimSlots,
        occupiedClaims,
      )
    })
    const updatedAt = nowIso(systemClock())
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

function ledgerEntryFromReservation(row: typeof reservations.$inferSelect, now: Date) {
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
  const now = systemClock().now()
  return c.json(
    LedgerEntry.array().parse(
      [
        ...reservationRows.map((row) => ledgerEntryFromReservation(row, now)),
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
  const clock = systemClock()
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
    const terminalFailure = await sharedTerminalWriteFailure(c, storeId, systemClock())
    if (terminalFailure) return terminalFailure
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
    if (!latest) return c.json({ error: 'forbidden' }, 403)
    return c.json({ error: 'version_conflict', currentVersion: latest.version }, 409)
  }
  const result = { ...current, ...values }
  return c.json(ledgerEntryFromReservation(result, systemClock().now()))
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
  if (!organization || organization.isDisabled !== '0')
    return c.json({ error: 'org_disabled' }, 403)
  const store = (
    await db
      .select({ isActive: stores.isActive })
      .from(stores)
      .where(and(eq(stores.id, storeId), eq(stores.organizationId, identity.organizationId)))
  )[0]
  if (!store || store.isActive !== '1') return c.json({ error: 'terminal_store_inactive' }, 403)
  return null
}

async function createWalkin(c: AppContext, storeId: string): Promise<Response> {
  const denied = await requireStorePermission(c as StoreContext, storeId, 'reservation.write')
  if (denied) return denied
  const db = drizzle(c.env.DB)
  const now = nowIso(systemClock())
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
      (await sharedTerminalWriteFailure(c, storeId, systemClock())) ??
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
  if (current.version !== input.version)
    return c.json({ error: 'version_conflict', currentVersion: current.version }, 409)
  const operationId = crypto.randomUUID()
  const updatedAt = nowIso(systemClock())
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
    const terminalFailure = await sharedTerminalWriteFailure(c, storeId, systemClock())
    if (terminalFailure) return terminalFailure
    const latest = (
      await db
        .select({ version: walkins.version })
        .from(walkins)
        .where(
          and(
            eq(walkins.organizationId, c.get('auth').org),
            eq(walkins.storeId, storeId),
            eq(walkins.id, walkinId),
          ),
        )
    )[0]
    return c.json(
      { error: 'version_conflict', currentVersion: latest?.version ?? current.version },
      409,
    )
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
  if (current.version !== input.version)
    return c.json({ error: 'version_conflict', currentVersion: current.version }, 409)
  const operationId = crypto.randomUUID()
  const customerId = crypto.randomUUID()
  const updatedAt = nowIso(systemClock())
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
    const terminalFailure = await sharedTerminalWriteFailure(c, storeId, systemClock())
    if (terminalFailure) return terminalFailure
    const latest = (
      await db
        .select({ version: walkins.version })
        .from(walkins)
        .where(
          and(
            eq(walkins.organizationId, c.get('auth').org),
            eq(walkins.storeId, storeId),
            eq(walkins.id, walkinId),
          ),
        )
    )[0]
    return c.json(
      { error: 'version_conflict', currentVersion: latest?.version ?? current.version },
      409,
    )
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
  if (current.version !== input.version)
    return c.json({ error: 'version_conflict', currentVersion: current.version }, 409)
  if (current.status === 'departed' && input.progress !== 'departed') {
    return c.json({ error: 'invalid_progress_transition', currentVersion: current.version }, 409)
  }
  const operationId = crypto.randomUUID()
  const updatedAt = nowIso(systemClock())
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
    const terminalFailure = await sharedTerminalWriteFailure(c, storeId, systemClock())
    if (terminalFailure) return terminalFailure
    const latest = (
      await db
        .select({ version: walkins.version })
        .from(walkins)
        .where(
          and(
            eq(walkins.organizationId, c.get('auth').org),
            eq(walkins.storeId, storeId),
            eq(walkins.id, walkinId),
          ),
        )
    )[0]
    return c.json(
      { error: 'version_conflict', currentVersion: latest?.version ?? current.version },
      409,
    )
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
  const now = nowIso(systemClock())
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
    clock: systemClock(),
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
  const occurredAt = nowIso(systemClock())
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
  const revokedAt = nowIso(systemClock())
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
  if (!organization || organization.isDisabled !== '0')
    return c.json({ error: 'org_disabled' }, 403)
  const store = (
    await db
      .select()
      .from(stores)
      .where(and(eq(stores.id, row.storeId), eq(stores.organizationId, row.organizationId)))
  )[0]
  if (!store || store.isActive !== '1') return c.json({ error: 'terminal_store_inactive' }, 403)
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
    if (!currentOrganization || currentOrganization.isDisabled !== '0')
      return c.json({ error: 'org_disabled' }, 403)
    const currentStore = (
      await db
        .select({ isActive: stores.isActive })
        .from(stores)
        .where(
          and(eq(stores.id, current.storeId), eq(stores.organizationId, current.organizationId)),
        )
    )[0]
    if (!currentStore || currentStore.isActive !== '1')
      return c.json({ error: 'terminal_store_inactive' }, 403)
    return c.json({ error: 'terminal_revoked' }, 401)
  }
  return c.json(sharedTerminalFromRow({ ...row, lastSeenAt: now }))
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
  if (!session) return c.json({ error: 'reauth_unauthorized' }, 401)
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
  c.set('personalReauthUserId', session.userId)
  return null
}

async function revokeCurrentSharedTerminal(c: AppContext, terminalId: string): Promise<Response> {
  const denied = await requirePersonalReauth(c, terminalId, 'management', systemClock())
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

const routes = app
  .get('/api/health', (c) => c.json({ status: 'ok' as const }))
  .get('/api/public/stores', zValidator('query', PublicStoreSearchQuery), async (c) =>
    c.json(await listPublicStores(c as AppContext, c.req.valid('query'))),
  )
  .get('/api/public/stores/:slug/slots', zValidator('query', PublicAvailabilityQuery), async (c) =>
    readPublicAvailability(c as AppContext, c.req.param('slug'), c.req.valid('query')),
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
    readSharedTerminalSession(c, c.req.param('terminalId'), systemClock()),
  )
  .post(
    '/api/shared-terminals/:terminalId/reauthenticate',
    zValidator('json', SharedTerminalReauthenticationInput),
    async (c) =>
      issueSharedTerminalReauthentication(
        c as AppContext,
        c.req.param('terminalId'),
        c.req.valid('json'),
        systemClock(),
      ),
  )
  .get('/api/shared-terminals/:terminalId/reauthentication', async (c) => {
    const denied = await requirePersonalReauth(
      c as AppContext,
      c.req.param('terminalId'),
      'management',
      systemClock(),
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
        systemClock(),
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
        systemClock(),
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
        systemClock(),
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
        systemClock(),
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
        systemClock(),
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
  .post('/api/internal/stores/sync', zValidator('json', StoreSync), async (c) =>
    persistStore(c, c.req.valid('json')),
  )
  .post('/api/internal/stores', zValidator('json', StoreSync), async (c) =>
    persistStore(c, c.req.valid('json')),
  )
  .post(
    '/api/internal/store-memberships/sync',
    zValidator('json', StoreMembershipSync),
    async (c) => persistMembership(c, c.req.valid('json')),
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

export type AppType = typeof routes

export default app
