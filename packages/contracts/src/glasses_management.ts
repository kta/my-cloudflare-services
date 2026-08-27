import { z } from 'zod'
import { Plan, Role } from './auth'

/** Trusted admin → domain organization synchronization payload. */
export const OrganizationSync = z.strictObject({
  // admin's canonical ids predate this domain and are not required to be
  // UUIDs (for example, the seeded `org-admin-seed`). Keep the tenant key
  // non-empty while new domain-owned ids remain UUIDs below.
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  plan: Plan,
  isDisabled: z.boolean(),
  createdAt: z.string().datetime(),
  // Revision 0 keeps the foundation compatibility aliases usable while all
  // admin-originated snapshots carry a strictly increasing revision.
  revision: z.number().int().nonnegative().default(0),
})
export type OrganizationSync = z.infer<typeof OrganizationSync>

/** Store permissions are deliberately allow-listed; unknown values fail closed. */
export const StorePermission = z.enum([
  'store.read',
  'store.manage',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  'settings.read',
  'settings.manage',
  'recording.read',
  'recording.manage',
  'audit.read',
  'terminal.manage',
])
export type StorePermission = z.infer<typeof StorePermission>

/** A domain-owned store synchronized or provisioned under one organization. */
export const Store = z.strictObject({
  id: z.string().uuid(),
  // References the canonical admin organization, whose id may predate UUID
  // ids (for example, `org-admin-seed`). The store's own id remains a UUID.
  organizationId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
})
export type Store = z.infer<typeof Store>

/** Store membership copied from the domain's user/store administration later on. */
export const StoreMembership = z.strictObject({
  id: z.string().uuid(),
  organizationId: z.string().trim().min(1).max(200),
  storeId: z.string().uuid(),
  userId: z.string().min(1).max(200),
  permissions: StorePermission.array(),
  createdAt: z.string().datetime(),
})
export type StoreMembership = z.infer<typeof StoreMembership>

/** The resolved actor used by store authorization, never from request input. */
export const Actor = z.strictObject({
  subjectId: z.string().min(1).max(200),
  organizationId: z.string().trim().min(1).max(200),
  role: Role,
  permissions: StorePermission.array(),
})
export type Actor = z.infer<typeof Actor>

/** The only mutable fields supported by the foundation store endpoint. */
export const StorePatch = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => value.name !== undefined || value.isActive !== undefined, {
    message: 'at least one store field is required',
  })
export type StorePatch = z.infer<typeof StorePatch>

/** A client-selected store change, retained only as a non-PII audit fact. */
export const StoreSwitchInput = z
  .strictObject({
    fromStoreId: z.string().uuid(),
    toStoreId: z.string().uuid(),
  })
  .refine((value) => value.fromStoreId !== value.toStoreId, {
    message: 'destination must differ from source',
  })
export type StoreSwitchInput = z.infer<typeof StoreSwitchInput>

/** Public, unauthenticated store lookup. Search never accepts organization or store identifiers. */
export const PublicStoreSearchQuery = z
  .strictObject({
    q: z.string().trim().min(1).max(120).optional(),
    region: z.string().trim().min(1).max(200).optional(),
    station: z.string().trim().min(1).max(200).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    message: 'latitude and longitude must be supplied together',
    path: ['longitude'],
  })
export type PublicStoreSearchQuery = z.infer<typeof PublicStoreSearchQuery>

export const PublicStoreSummary = z.strictObject({
  slug: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  contactPhone: z.string().min(1).max(40),
  region: z.string().min(1).max(200),
  nearestStation: z.string().min(1).max(200),
})
export type PublicStoreSummary = z.infer<typeof PublicStoreSummary>

export const PublicStorePurpose = z.strictObject({
  id: z.string().uuid(),
  label: z.string().min(1).max(200),
  durationMinutes: z.number().int().positive(),
})
export type PublicStorePurpose = z.infer<typeof PublicStorePurpose>

export const PublicStoreDetail = PublicStoreSummary.extend({
  accessText: z.string().max(1000),
  notice: z.string().max(2000),
  businessHours: z.array(
    z.strictObject({
      dayOfWeek: z.number().int().min(0).max(6),
      periods: z.array(z.strictObject({ startTime: z.string(), endTime: z.string() })),
    }),
  ),
  purposes: PublicStorePurpose.array(),
})
export type PublicStoreDetail = z.infer<typeof PublicStoreDetail>

/** The immutable public projection configured by the company before booking is opened. */
export const WebBookingPublication = z
  .strictObject({
    id: z.string().uuid(),
    organizationId: z.string().trim().min(1).max(200),
    storeId: z.string().uuid(),
    publicSlug: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    status: z.enum(['published', 'hidden']),
    startsAt: z
      .string()
      .datetime()
      .refine((value) => value.endsWith('Z'))
      .nullable(),
    endsAt: z
      .string()
      .datetime()
      .refine((value) => value.endsWith('Z'))
      .nullable(),
    contactPhone: z.string().trim().min(1).max(40),
    accessText: z.string().trim().max(1000),
    notice: z.string().trim().max(2000),
    region: z.string().trim().min(1).max(200),
    nearestStation: z.string().trim().min(1).max(200),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    publicPurposeIds: z.string().uuid().array(),
    version: z.number().int().positive(),
    publishedAt: z
      .string()
      .datetime()
      .refine((value) => value.endsWith('Z')),
    updatedAt: z
      .string()
      .datetime()
      .refine((value) => value.endsWith('Z')),
  })
  .refine(
    (value) => value.startsAt === null || value.endsAt === null || value.startsAt < value.endsAt,
    {
      message: 'publication must end after it starts',
      path: ['endsAt'],
    },
  )
export type WebBookingPublication = z.infer<typeof WebBookingPublication>

// Keep explicit sync names for callers that distinguish trusted input from
// public store responses. Both paths intentionally share one Zod shape.
export const StoreSync = Store
export type StoreSync = z.infer<typeof StoreSync>

export const StoreMembershipSync = StoreMembership
export type StoreMembershipSync = z.infer<typeof StoreMembershipSync>

/** A named, store-bound shared iPad. The bearer token is returned only at issuance. */
export const SharedTerminalCreateInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
})
export type SharedTerminalCreateInput = z.infer<typeof SharedTerminalCreateInput>

export const SharedTerminal = z.strictObject({
  id: z.string().uuid(),
  organizationId: z.string().trim().min(1).max(200),
  storeId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  status: z.enum(['active', 'revoked']),
  idleTimeoutSeconds: z.number().int().positive(),
  expiresAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
})
export type SharedTerminal = z.infer<typeof SharedTerminal>

export const SharedTerminalIssue = z.strictObject({
  terminal: SharedTerminal,
  token: z.string().min(40),
})
export type SharedTerminalIssue = z.infer<typeof SharedTerminalIssue>

/** PIN proof submitted by a shared terminal; its tenant is derived from the terminal, never this body. */
export const SharedTerminalReauthenticationInput = z.strictObject({
  userId: z.string().trim().min(1).max(200),
  stretchedPin: z.string().min(1),
})
export type SharedTerminalReauthenticationInput = z.infer<
  typeof SharedTerminalReauthenticationInput
>

/** Issuance-only opaque token for one short-lived shared-terminal management action. */
export const SharedTerminalReauthenticationIssue = z.strictObject({
  token: z.string().min(40),
  expiresAt: z.string().datetime(),
})
export type SharedTerminalReauthenticationIssue = z.infer<
  typeof SharedTerminalReauthenticationIssue
>

/*
 * Availability and store-reception settings.
 *
 * All times in these contracts are wall-clock times in Asia/Tokyo. They are
 * deliberately not ISO timestamps: a weekly opening hour such as 10:00
 * must not be interpreted in the browser's local timezone. The Worker turns
 * these values into UTC only at the availability-engine boundary.
 */
export const LocalTime = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm in Asia/Tokyo')
export type LocalTime = z.infer<typeof LocalTime>

function validDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

export const LocalDate = z.string().refine(validDateOnly, 'date must be YYYY-MM-DD')
export type LocalDate = z.infer<typeof LocalDate>

export const AvailabilityPeriod = z
  .strictObject({ startTime: LocalTime, endTime: LocalTime })
  .refine((value) => value.startTime < value.endTime, {
    message: 'period must end after it starts',
    path: ['endTime'],
  })
export type AvailabilityPeriod = z.infer<typeof AvailabilityPeriod>

export const AvailabilityBusinessHours = z.strictObject({
  // JavaScript-compatible weekday: 0 Sunday .. 6 Saturday.
  dayOfWeek: z.number().int().min(0).max(6),
  periods: AvailabilityPeriod.array().max(2),
})
export type AvailabilityBusinessHours = z.infer<typeof AvailabilityBusinessHours>

export const AvailabilityExceptionMode = z.enum(['closed', 'open', 'paused'])
export type AvailabilityExceptionMode = z.infer<typeof AvailabilityExceptionMode>

export const AvailabilityException = z
  .strictObject({
    date: LocalDate,
    mode: AvailabilityExceptionMode,
    periods: AvailabilityPeriod.array().max(2),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((value) => value.mode !== 'open' || value.periods.length > 0, {
    message: 'an exceptional opening requires at least one period',
    path: ['periods'],
  })
export type AvailabilityException = z.infer<typeof AvailabilityException>

export const AvailabilityReceptionStatus = z.enum(['open', 'paused'])
export type AvailabilityReceptionStatus = z.infer<typeof AvailabilityReceptionStatus>

const AvailabilityPurposeFields = {
  staffName: z.string().trim().min(1).max(120),
  customerLabel: z.string().trim().min(1).max(200),
  durationMinutes: z.number().int().min(5).max(480),
  slotIntervalMinutes: z.number().int().min(5).max(120),
  isPublic: z.boolean(),
  requiredSkills: z.string().trim().min(1).max(80).array().max(20),
  requiredEquipment: z.string().trim().min(1).max(120).array().max(20),
  maxConcurrent: z.number().int().min(1).max(100),
} as const

export const AvailabilityPurpose = z.strictObject({
  id: z.string().uuid(),
  ...AvailabilityPurposeFields,
})
export type AvailabilityPurpose = z.infer<typeof AvailabilityPurpose>

export const AvailabilityStaff = z.strictObject({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  skills: z.string().trim().min(1).max(80).array().max(30),
  canBook: z.boolean(),
  isActive: z.boolean(),
})
export type AvailabilityStaff = z.infer<typeof AvailabilityStaff>

export const AvailabilityBreak = AvailabilityPeriod
export type AvailabilityBreak = z.infer<typeof AvailabilityBreak>

export const AvailabilityStaffShift = z
  .strictObject({
    id: z.string().uuid(),
    staffId: z.string().uuid(),
    date: LocalDate,
    startTime: LocalTime,
    endTime: LocalTime,
    breaks: AvailabilityBreak.array().max(8),
  })
  .refine((value) => value.startTime < value.endTime, {
    message: 'shift must end after it starts',
    path: ['endTime'],
  })
  .refine(
    (value) =>
      value.breaks.every(
        (breakPeriod) =>
          breakPeriod.startTime >= value.startTime && breakPeriod.endTime <= value.endTime,
      ),
    {
      message: 'break must be within the shift',
      path: ['breaks'],
    },
  )
export type AvailabilityStaffShift = z.infer<typeof AvailabilityStaffShift>

export const AvailabilityEquipment = z.strictObject({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  capacity: z.number().int().min(1).max(100),
  isActive: z.boolean(),
  availablePeriods: AvailabilityPeriod.array().max(2),
})
export type AvailabilityEquipment = z.infer<typeof AvailabilityEquipment>

export const AvailabilityMaintenance = z
  .strictObject({
    id: z.string().uuid(),
    equipmentId: z.string().uuid(),
    date: LocalDate,
    startTime: LocalTime,
    endTime: LocalTime,
    reason: z.string().trim().min(1).max(200),
  })
  .refine((value) => value.startTime < value.endTime, {
    message: 'maintenance must end after it starts',
    path: ['endTime'],
  })
export type AvailabilityMaintenance = z.infer<typeof AvailabilityMaintenance>

export const AvailabilitySettingsInput = z.strictObject({
  version: z.number().int().nonnegative(),
  receptionStatus: AvailabilityReceptionStatus,
  businessHours: AvailabilityBusinessHours.array().max(7),
  exceptions: AvailabilityException.array().max(366),
  purposes: AvailabilityPurpose.array().max(100),
  staff: AvailabilityStaff.array().max(500),
  shifts: AvailabilityStaffShift.array().max(5000),
  equipment: AvailabilityEquipment.array().max(500),
  maintenance: AvailabilityMaintenance.array().max(5000),
})
export type AvailabilitySettingsInput = z.infer<typeof AvailabilitySettingsInput>

export const AvailabilityStoreSettings = AvailabilitySettingsInput.extend({
  storeId: z.string().uuid(),
})
export type AvailabilityStoreSettings = z.infer<typeof AvailabilityStoreSettings>

export const AvailabilitySlotsQuery = z
  .strictObject({
    date: LocalDate,
    purposeIds: z.string().trim().min(1),
  })
  .transform((value) => {
    const purposeIds = [
      ...new Set(
        value.purposeIds
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ]
    return { date: value.date, purposeIds }
  })
  .refine(
    (value) =>
      value.purposeIds.length > 0 &&
      value.purposeIds.every((id) => z.string().uuid().safeParse(id).success),
    {
      message: 'purposeIds must be a comma-separated UUID list',
      path: ['purposeIds'],
    },
  )
export type AvailabilitySlotsQuery = z.infer<typeof AvailabilitySlotsQuery>

/** Public slots are scoped by resolved public store URL, never an input store id. */
export const PublicAvailabilityQuery = AvailabilitySlotsQuery
export type PublicAvailabilityQuery = z.infer<typeof PublicAvailabilityQuery>

export const PublicBookingCreate = z.strictObject({
  date: LocalDate,
  startTime: LocalTime,
  purposeIds: z
    .string()
    .uuid()
    .array()
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'purposeIds must be unique',
    }),
  customer: z.strictObject({
    name: z.string().trim().min(1).max(120),
    kana: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(7).max(40),
    email: z.string().trim().email().max(320),
  }),
  consentVersion: z.string().trim().min(1).max(100),
})
export type PublicBookingCreate = z.infer<typeof PublicBookingCreate>

export const PublicBookingResult = z.strictObject({
  reservationNumber: z.string().trim().min(1).max(100),
  managementCode: z.string().min(8).max(100).nullable(),
  emailStatus: z.enum(['pending', 'sent', 'failed']),
})
export type PublicBookingResult = z.infer<typeof PublicBookingResult>

/** A caller may use the original confirmation key only to recover coarse outcome state. */
export const PublicReservationStatusQuery = z.strictObject({
  confirmationKey: z.string().trim().min(1).max(256),
})
export type PublicReservationStatusQuery = z.infer<typeof PublicReservationStatusQuery>

export const PublicReservationStatus = z.strictObject({
  status: z.enum(['confirmed', 'pending', 'not_found']),
})
export type PublicReservationStatus = z.infer<typeof PublicReservationStatus>

/** The code is company-issued; this request never carries customer contact information. */
export const PublicReservationVerification = z.strictObject({
  reservationNumber: z.string().trim().min(1).max(100),
  managementCode: z.string().trim().min(8).max(100),
})
export type PublicReservationVerification = z.infer<typeof PublicReservationVerification>

/** The opaque token is returned once and must be supplied only as a request header afterwards. */
export const PublicReservationVerificationResult = z.strictObject({
  reservationId: z.string().uuid(),
  verificationToken: z.string().min(32).max(200),
  expiresAt: z.string().datetime(),
  version: z.number().int().positive(),
  startAt: z.string().datetime(),
  purposeIds: z.string().uuid().array(),
  storeSlug: z.string().trim().min(1).max(120),
})
export type PublicReservationVerificationResult = z.infer<
  typeof PublicReservationVerificationResult
>

export const PublicReservationCancel = z.strictObject({
  version: z.number().int().positive(),
})
export type PublicReservationCancel = z.infer<typeof PublicReservationCancel>

export const PublicReservationChange = z.strictObject({
  version: z.number().int().positive(),
  date: LocalDate,
  startTime: LocalTime,
  purposeIds: z
    .string()
    .uuid()
    .array()
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'purposeIds must be unique',
    }),
})
export type PublicReservationChange = z.infer<typeof PublicReservationChange>

export const PublicReservationMutationResult = z.strictObject({
  status: z.literal('cancelled'),
  version: z.number().int().positive(),
})
export type PublicReservationMutationResult = z.infer<typeof PublicReservationMutationResult>

export const PublicReservationChangeResult = z.strictObject({
  status: z.literal('confirmed'),
  version: z.number().int().positive(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  purposeIds: z.string().uuid().array(),
})
export type PublicReservationChangeResult = z.infer<typeof PublicReservationChangeResult>

export const ManagementCodeReissueResult = z.strictObject({
  emailStatus: z.enum(['pending', 'sent', 'failed']),
})
export type ManagementCodeReissueResult = z.infer<typeof ManagementCodeReissueResult>

export const AvailabilitySlot = z.strictObject({
  date: LocalDate,
  startTime: LocalTime,
  endTime: LocalTime,
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
})
export type AvailabilitySlot = z.infer<typeof AvailabilitySlot>

export const PublicAvailabilityResponse = z.strictObject({
  date: LocalDate,
  timezone: z.literal('Asia/Tokyo'),
  durationMinutes: z.number().int().nonnegative(),
  intervalMinutes: z.number().int().nonnegative(),
  slots: AvailabilitySlot.array(),
})
export type PublicAvailabilityResponse = z.infer<typeof PublicAvailabilityResponse>

export const AvailabilitySlotsResponse = z.strictObject({
  storeId: z.string().uuid(),
  date: LocalDate,
  timezone: z.literal('Asia/Tokyo'),
  durationMinutes: z.number().int().nonnegative(),
  intervalMinutes: z.number().int().nonnegative(),
  slots: AvailabilitySlot.array(),
})
export type AvailabilitySlotsResponse = z.infer<typeof AvailabilitySlotsResponse>

/** Staff-entered reservation confirmation. The organization is always taken from the JWT. */
export const StaffReservationCreate = z.strictObject({
  date: LocalDate,
  startTime: LocalTime,
  purposeIds: z
    .string()
    .uuid()
    .array()
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'purposeIds must be unique',
    }),
  customer: z.strictObject({
    name: z.string().trim().min(1).max(120),
    kana: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(7).max(40),
    email: z.string().trim().email().max(320).optional(),
  }),
  recital: z.string().trim().min(1).max(2000),
  reservationMemo: z.string().trim().max(2000).optional(),
  handoffNote: z.string().trim().max(2000).optional(),
})
export type StaffReservationCreate = z.infer<typeof StaffReservationCreate>

export const Reservation = z.strictObject({
  id: z.string().uuid(),
  organizationId: z.string().trim().min(1).max(200),
  storeId: z.string().uuid(),
  reservationNumber: z.string().trim().min(1).max(100),
  source: z.enum(['staff', 'web', 'walkin']),
  status: z.enum(['confirmed', 'checked_in', 'cancelled', 'no_show']),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  purposeIds: z.string().uuid().array(),
  customer: z.strictObject({
    name: z.string(),
    kana: z.string(),
    phone: z.string(),
    email: z.string().email().nullable(),
  }),
  recital: z.string(),
  reservationMemo: z.string().nullable(),
  handoffNote: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
})
export type Reservation = z.infer<typeof Reservation>

/** Selected-store reservation search criteria. All supplied fields are intersected. */
export const ReservationSearchQuery = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    kana: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(1).max(40).optional(),
    reservationNumber: z.string().trim().min(1).max(100).optional(),
    dateFrom: LocalDate.optional(),
    dateTo: LocalDate.optional(),
    source: z.enum(['staff', 'web', 'walkin']).optional(),
    status: z.enum(['confirmed', 'checked_in', 'cancelled', 'no_show']).optional(),
  })
  .refine(
    (value) =>
      value.dateFrom === undefined || value.dateTo === undefined || value.dateFrom <= value.dateTo,
    {
      message: 'dateFrom must not be after dateTo',
      path: ['dateTo'],
    },
  )
export type ReservationSearchQuery = z.infer<typeof ReservationSearchQuery>

/** Staff cancellation requires both an accountable reason and a deliberate confirmation. */
export const ReservationCancelInput = z.strictObject({
  version: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
  confirmation: z.string().trim().min(1).max(100),
})
export type ReservationCancelInput = z.infer<typeof ReservationCancelInput>

/** Marking a reservation as a no-show is a staff-only, versioned transition. */
export const ReservationNoShowInput = z.strictObject({
  version: z.number().int().positive(),
})
export type ReservationNoShowInput = z.infer<typeof ReservationNoShowInput>

export const ReservationChangeInput = z.strictObject({
  version: z.number().int().positive(),
  date: LocalDate,
  startTime: LocalTime,
  purposeIds: z
    .string()
    .uuid()
    .array()
    .min(1)
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'purposeIds must be unique',
    }),
  reason: z.string().trim().min(1).max(500),
})
export type ReservationChangeInput = z.infer<typeof ReservationChangeInput>

/** Immutable staff-visible reason and before/after snapshot for a lifecycle operation. */
export const ReservationChangeHistoryEntry = z.strictObject({
  id: z.string().uuid(),
  reservationId: z.string().uuid(),
  action: z.enum(['changed', 'cancelled', 'no_show']),
  reason: z.string().trim().min(1).max(500).nullable(),
  before: z.strictObject({
    status: z.enum(['confirmed', 'checked_in', 'cancelled', 'no_show']),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    purposeIds: z.string().uuid().array(),
    version: z.number().int().positive(),
  }),
  after: z.strictObject({
    status: z.enum(['confirmed', 'checked_in', 'cancelled', 'no_show']),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    purposeIds: z.string().uuid().array(),
    version: z.number().int().positive(),
  }),
  actorId: z.string().min(1).max(200),
  occurredAt: z.string().datetime(),
})
export type ReservationChangeHistoryEntry = z.infer<typeof ReservationChangeHistoryEntry>

/** Operational progress is independent from the durable booking status. */
export const ReceptionProgress = z.enum([
  'waiting',
  'service_in_progress',
  'service_completed',
  'departed',
])
export type ReceptionProgress = z.infer<typeof ReceptionProgress>

/** A text-bearing operational warning; presentation must never rely on color alone. */
export const LedgerWarning = z.strictObject({
  code: z.enum(['long_wait', 'staff_unassigned', 'equipment_unavailable']),
  message: z.string().trim().min(1).max(500),
})
export type LedgerWarning = z.infer<typeof LedgerWarning>

/** One timeline row in the selected store's staff ledger. */
export const ReservationLedgerEntry = z.strictObject({
  id: z.string().uuid(),
  entryType: z.literal('reservation'),
  source: z.enum(['staff', 'web', 'walkin']),
  status: z.enum(['confirmed', 'checked_in', 'cancelled', 'no_show']),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  customerName: z.string().trim().min(1).max(120),
  customerId: z.string().uuid().nullable(),
  progress: ReceptionProgress.nullable(),
  waitStartedAt: z.string().datetime().nullable(),
  assignedStaffId: z.string().uuid().nullable(),
  assignedEquipmentIds: z.string().uuid().array(),
  nextGuidance: z.string().trim().max(500).nullable(),
  warnings: LedgerWarning.array(),
  version: z.number().int().positive(),
})
export const WalkinLedgerEntry = z.strictObject({
  id: z.string().uuid(),
  entryType: z.literal('walkin'),
  source: z.literal('walkin'),
  status: z.enum(['active', 'departed']),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  customerName: z.string().trim().min(1).max(160),
  customerId: z.string().uuid().nullable(),
  progress: ReceptionProgress,
  waitStartedAt: z.string().datetime().nullable(),
  assignedStaffId: z.string().uuid().nullable(),
  assignedEquipmentIds: z.string().uuid().array(),
  nextGuidance: z.string().trim().max(500).nullable(),
  warnings: LedgerWarning.array(),
  version: z.number().int().positive(),
})
export const LedgerEntry = z.discriminatedUnion('entryType', [
  ReservationLedgerEntry,
  WalkinLedgerEntry,
])
export type LedgerEntry = z.infer<typeof LedgerEntry>

export const LedgerQuery = z.strictObject({ date: LocalDate })
export type LedgerQuery = z.infer<typeof LedgerQuery>

/** Filterable, append-only operational history for one selected store. */
export const ReceptionHistoryQuery = z.strictObject({
  date: LocalDate.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  reservationNumber: z.string().trim().min(1).max(100).optional(),
  source: z.enum(['staff', 'web', 'walkin']).optional(),
  action: z.enum(['created', 'changed', 'cancelled', 'no_show', 'walkin_created']).optional(),
  requiresAttention: z.enum(['true', 'false']).optional(),
})
export type ReceptionHistoryQuery = z.infer<typeof ReceptionHistoryQuery>

/** Recording is intentionally explicit while Phase 7 recording operations are unavailable. */
export const ReceptionHistoryEntry = z.strictObject({
  id: z.string().uuid(),
  occurredAt: z.string().datetime(),
  source: z.enum(['staff', 'web', 'walkin']),
  action: z.enum(['created', 'changed', 'cancelled', 'no_show', 'walkin_created']),
  entityType: z.enum(['reservation', 'walkin']),
  entityId: z.string().uuid(),
  reservationId: z.string().uuid().nullable(),
  customerName: z.string().trim().min(1).max(160).nullable(),
  customerPhone: z.string().trim().min(1).max(40).nullable(),
  reservationNumber: z.string().trim().min(1).max(100).nullable(),
  actorId: z.string().min(1).max(200),
  requiresAttention: z.boolean(),
  recordingStatus: z.literal('none'),
})
export type ReceptionHistoryEntry = z.infer<typeof ReceptionHistoryEntry>

/** Compare-and-swap update for the in-store service state. */
export const ReservationProgressPatch = z.strictObject({
  version: z.number().int().positive(),
  progress: ReceptionProgress,
  assignedStaffId: z.string().uuid().nullable().optional(),
  assignedEquipmentIds: z.string().uuid().array().max(20).optional(),
  nextGuidance: z.string().trim().max(500).nullable().optional(),
})
export type ReservationProgressPatch = z.infer<typeof ReservationProgressPatch>

/** An arrival can be recorded before the customer is identified. */
export const WalkinCreate = z.strictObject({})
export type WalkinCreate = z.infer<typeof WalkinCreate>

export const Walkin = z.strictObject({
  id: z.string().uuid(),
  entryType: z.literal('walkin'),
  provisionalLabel: z.string().trim().min(1).max(160),
  customerId: z.string().uuid().nullable(),
  progress: ReceptionProgress,
  status: z.enum(['active', 'departed']),
  arrivedAt: z.string().datetime(),
  version: z.number().int().positive(),
})
export type Walkin = z.infer<typeof Walkin>

export const WalkinCustomerPatch = z.union([
  z.strictObject({ version: z.number().int().positive(), customerId: z.string().uuid() }),
  z.strictObject({
    version: z.number().int().positive(),
    customer: z.strictObject({
      name: z.string().trim().min(1).max(120),
      kana: z.string().trim().min(1).max(120),
      phone: z.string().trim().min(7).max(40),
      email: z.string().trim().email().max(320).optional(),
    }),
  }),
])
export type WalkinCustomerPatch = z.infer<typeof WalkinCustomerPatch>

export const WalkinProgressPatch = z.strictObject({
  version: z.number().int().positive(),
  progress: ReceptionProgress,
})
export type WalkinProgressPatch = z.infer<typeof WalkinProgressPatch>
export const WalkinListQuery = z.strictObject({ status: z.enum(['active', 'departed']).optional() })
export type WalkinListQuery = z.infer<typeof WalkinListQuery>

export const CustomerSearchQuery = z
  .strictObject({
    phone: z.string().trim().min(1).max(40).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    kana: z.string().trim().min(1).max(120).optional(),
  })
  .refine(
    (value) =>
      [value.phone, value.name, value.kana].filter((part) => part !== undefined).length === 1,
    {
      message: 'exactly one customer search term is required',
    },
  )
export type CustomerSearchQuery = z.infer<typeof CustomerSearchQuery>

export const CustomerCandidate = z.strictObject({
  id: z.string().uuid(),
  name: z.string(),
  kana: z.string(),
  phone: z.string(),
  email: z.string().email().nullable(),
  primaryStoreId: z.string().uuid(),
  visitCount: z.number().int().nonnegative(),
})
export type CustomerCandidate = z.infer<typeof CustomerCandidate>
