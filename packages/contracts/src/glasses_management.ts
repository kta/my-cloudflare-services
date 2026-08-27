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
  // Cross-store 来店・購入・調整履歴. Without it a customer record shows only
  // the selected store's rows — never a marker that other stores hold more.
  'customer.history',
  // 注意事項 (restricted). Read is separated from the later versioned
  // publish / revise / hide workflow so a viewer never gains a writer's reach.
  'attention.read',
  'attention.write',
  'attention.publish',
  'attention.revise',
  'attention.hide',
  'settings.read',
  'settings.manage',
  'recording.read',
  'recording.manage',
  'audit.read',
  'terminal.manage',
  // 分析. Read-only by design: analytics has no writes, and separating it from
  // reservation.read lets an organization grant numbers without granting rows.
  'analytics.read',
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
  /*
   * 承認済みモック（web-booking-complete-approved.html #store-search）の検索カードは
   * 「銀座駅 A3出口 徒歩2分」というアクセス文と「本日営業 10:00–19:00」を出す。
   * どちらも一覧の時点で必要なので、詳細を開かずに読めるようここへ持つ。
   * 既定値つきにしてあるのは、旧レスポンスや固定フィクスチャを壊さないためである。
   */
  accessText: z.string().max(1000).default(''),
  /** 本日の営業時間。定休日・未設定は null で、その行はモックどおり出さない。 */
  todayBusinessHours: z.string().max(100).nullable().default(null),
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
  /*
   * 店舗ページの「対応サービス」。来店目的（purposes）とは別軸である：来店目的は
   * 予約できる枠の種類であり、対応サービスはその店で受けられることの説明文である。
   * 両者を同一視すると、公開していない目的まで説明に出るか、説明が予約導線に化ける。
   */
  services: z.string().trim().min(1).max(200).array().max(20).default([]),
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

export const AvailabilityStaffShift = z
  .strictObject({
    id: z.string().uuid(),
    staffId: z.string().uuid(),
    date: LocalDate,
    startTime: LocalTime,
    endTime: LocalTime,
    breaks: AvailabilityPeriod.array().max(8),
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
  /*
   * 希望時刻の工程で読み上げる候補の件数。
   *
   * なぜ件数を契約に持つのか: 電話口のスタッフが読み上げられる長さは営業時間
   * の長さではなく会話の長さで決まる。営業時間を 30 分刻みで全部並べると
   * 18 件を超え、承認済みモック（BOOK-TIME は 6 件・2 行）とも、下部の工程
   * バーに隠れない高さとも合わない。刻み幅は目的ごとの設定から決まるので、
   * 「いくつ読み上げるか」だけをここで店舗設定として持つ。
   *
   * 既定 6 はモックの件数。旧レスポンスとの互換のため既定値つきにしてある。
   */
  desiredTimeCandidateCount: z.number().int().min(3).max(12).default(6),
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

/*
 * 顧客Web予約の「候補枠」。
 *
 * なぜ日付を受け取らないのか: 承認済みモック（web-booking-approved.html /
 * web-booking-complete-approved.html #datetime）の第 2 工程は、日付を先に選ばせず
 * 「8月28日（金）11:00」のような既製のショートリストを並べる。日付必須の
 * /slots をそのまま使うと、顧客の第 1 操作がカレンダー入力に変わり、候補が
 * 単一日に閉じてしまう。候補は複数日にまたがるので、日付は入力ではなく結果である。
 */
export const PublicOffersQuery = z
  .strictObject({
    purposeIds: z.string().trim().min(1),
    /** 先読みする日数。長くしても読み上げる件数は limit で頭打ちになる。 */
    days: z.coerce.number().int().min(1).max(30).default(14),
    /** 顧客に見せる件数。モックは 2〜4 件、既定 6 は BOOK-TIME と同じ読み上げ長。 */
    limit: z.coerce.number().int().min(1).max(20).default(6),
  })
  .transform((value) => ({
    purposeIds: [
      ...new Set(
        value.purposeIds
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ],
    days: value.days,
    limit: value.limit,
  }))
export type PublicOffersQuery = z.infer<typeof PublicOffersQuery>

export const PublicOffersResponse = z.strictObject({
  timezone: z.literal('Asia/Tokyo'),
  durationMinutes: z.number().int().nonnegative(),
  slots: AvailabilitySlot.array(),
})
export type PublicOffersResponse = z.infer<typeof PublicOffersResponse>

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
  /*
   * 台帳のセルは承認済みモックどおり「氏名 / 目的 · 予約元」を出す。目的は
   * 予約が持つ id ではなくスタッフが口にする名称でなければ意味を成さないので、
   * 契約の側で名称を運ぶ。id は台帳の関心事ではないため持たせない。
   */
  purposeNames: z.string().trim().min(1).max(120).array().max(20),
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

/**
 * 楽観ロック衝突（EX-CONFLICT）の応答。
 *
 * 版番号だけでは「何が違うのか」を操作者に見せられない。承認済みモックは
 * 「最新の内容」と「この端末の入力」を並べ、最新側に更新者と時刻まで出すので、
 * その 3 要素を契約として運ぶ。`latest` が空でも壊れないよう既定値を置く。
 */
export const VersionConflictField = z.strictObject({
  label: z.string().trim().min(1).max(60),
  value: z.string().trim().max(500),
})
export type VersionConflictField = z.infer<typeof VersionConflictField>

export const VersionConflict = z.object({
  error: z.literal('version_conflict'),
  currentVersion: z.number().int().positive(),
  latest: VersionConflictField.array().max(20).default([]),
  updatedBy: z.string().trim().min(1).max(200).nullable().default(null),
  updatedAt: z.string().datetime().nullable().default(null),
})
export type VersionConflict = z.infer<typeof VersionConflict>

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

/** Dioptre values are formatted server-side so no client ever formats numbers. */
const SignedDioptre = z
  .string()
  .regex(/^[+-]\d+\.\d{2}$/, 'dioptre must be a signed 2-decimal string')
const Millimetres = z.string().regex(/^\d+\.\d$/, 'distance must be a 1-decimal string')

/** One measurement of a customer's prescription, always attributed (UC-EYEX-027). */
export const PrescriptionView = z.strictObject({
  measuredOn: LocalDate,
  storeId: z.string().uuid(),
  storeName: z.string().trim().min(1).max(200),
  recordedBy: z.string().trim().min(1).max(200),
  rightSphere: SignedDioptre,
  leftSphere: SignedDioptre,
  pupillaryDistance: Millimetres,
  addPower: SignedDioptre.nullable(),
})
export type PrescriptionView = z.infer<typeof PrescriptionView>

/** A staff service note attributed to the store and person who recorded it. */
export const CustomerNoteView = z.strictObject({
  recordedOn: LocalDate,
  storeId: z.string().uuid(),
  storeName: z.string().trim().min(1).max(200),
  recordedBy: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
})
export type CustomerNoteView = z.infer<typeof CustomerNoteView>

/** Glasses the customer already owns, with the store that sold them. */
export const OwnedGlassesView = z.strictObject({
  label: z.string().trim().min(1).max(200),
  purchasedOn: LocalDate,
  storeId: z.string().uuid(),
  storeName: z.string().trim().min(1).max(200),
  lensType: z.string().trim().min(1).max(200),
})
export type OwnedGlassesView = z.infer<typeof OwnedGlassesView>

/** Restricted 注意事項; the basis is mandatory so it is never an unsourced label. */
export const AttentionNoteView = z.strictObject({
  body: z.string().trim().min(1).max(2000),
  basis: z.string().trim().min(1).max(500),
  recordedBy: z.string().trim().min(1).max(200),
  recordedOn: LocalDate,
})
export type AttentionNoteView = z.infer<typeof AttentionNoteView>

/** A past visit derived from reservations and walk-ins; there is no visits table. */
export const VisitHistoryView = z.strictObject({
  visitedOn: LocalDate,
  storeId: z.string().uuid(),
  storeName: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(200),
})
export type VisitHistoryView = z.infer<typeof VisitHistoryView>

/**
 * The customer record (顧客台帳). Restricted sections are simply empty for a
 * staff member without the permission: the object is strict and carries no
 * count, flag or other trace that withheld information exists (AC-EYEX-91).
 */
export const CustomerDetail = z.strictObject({
  customerId: z.string().uuid(),
  currentPrescription: PrescriptionView.nullable(),
  pastPrescriptions: PrescriptionView.array(),
  latestNote: CustomerNoteView.nullable(),
  ownedGlasses: OwnedGlassesView.array(),
  attentionNotes: AttentionNoteView.array(),
  visitHistory: VisitHistoryView.array(),
})
export type CustomerDetail = z.infer<typeof CustomerDetail>

/* ------------------------------------------------------------------ *
 * 設定の下書き → 影響確認 → 公開 の閉ループ (UC-EYEX-093〜097, 159〜166)
 * ------------------------------------------------------------------ */

/** The formal states of a settings change; conflicts and failures are warnings, not states. */
export const SettingsDraftStatus = z.enum([
  'draft',
  'review',
  'scheduled',
  'published',
  'cancelled',
])
export type SettingsDraftStatus = z.infer<typeof SettingsDraftStatus>

/** Whether a store runs the chain-wide value or an explicitly recorded override (AC-EYEX-48). */
export const SettingsOrigin = z.enum(['chain', 'store_override'])
export type SettingsOrigin = z.infer<typeof SettingsOrigin>

export const SettingsDraftInput = z.strictObject({
  // Publication is a separate, permissioned step; a draft can only be parked.
  status: z.enum(['draft', 'review']).default('draft'),
  settings: AvailabilitySettingsInput,
})
export type SettingsDraftInput = z.infer<typeof SettingsDraftInput>

export const SettingsDraft = z.strictObject({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  /** Monotonic per store; independent from the published settings version. */
  draftVersion: z.number().int().positive(),
  /** The published settings version this draft was derived from. */
  baseVersion: z.number().int().nonnegative(),
  status: SettingsDraftStatus,
  origin: SettingsOrigin,
  restoredFromVersionId: z.string().uuid().nullable(),
  savedAt: z.string().datetime(),
  savedBy: z.string().trim().min(1).max(200),
  settings: AvailabilityStoreSettings,
})
export type SettingsDraft = z.infer<typeof SettingsDraft>

export const SettingsImpactKind = z.enum([
  'reservation_conflict',
  'missing_staff_skill',
  'missing_equipment',
  'out_of_hours',
  'web_slot_change',
])
export type SettingsImpactKind = z.infer<typeof SettingsImpactKind>

export const SettingsImpactSeverity = z.enum(['blocking', 'warning', 'info'])
export type SettingsImpactSeverity = z.infer<typeof SettingsImpactSeverity>

export const SettingsConflictResolutionKind = z.enum([
  'alternative_resource',
  'keep_exception',
  'customer_contacted',
])
export type SettingsConflictResolutionKind = z.infer<typeof SettingsConflictResolutionKind>

export const SettingsImpactItem = z.strictObject({
  kind: SettingsImpactKind,
  severity: SettingsImpactSeverity,
  reservationId: z.string().uuid().nullable(),
  message: z.string().trim().min(1).max(300),
  resolution: SettingsConflictResolutionKind.nullable(),
})
export type SettingsImpactItem = z.infer<typeof SettingsImpactItem>

export const SettingsPublicSlotEffect = z.strictObject({
  date: LocalDate,
  publishedCount: z.number().int().nonnegative(),
  draftCount: z.number().int().nonnegative(),
})
export type SettingsPublicSlotEffect = z.infer<typeof SettingsPublicSlotEffect>

export const SettingsImpactReport = z.strictObject({
  draftId: z.string().uuid(),
  storeId: z.string().uuid(),
  evaluatedAt: z.string().datetime(),
  blockingCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  /** False while a blocking item remains unresolved (AC-EYEX-109). */
  canPublish: z.boolean(),
  ledgerEntriesAffected: z.number().int().nonnegative(),
  publicSlots: SettingsPublicSlotEffect,
  items: SettingsImpactItem.array().max(500),
})
export type SettingsImpactReport = z.infer<typeof SettingsImpactReport>

export const SettingsConflictResolutionInput = z.strictObject({
  resolution: SettingsConflictResolutionKind,
  note: z.string().trim().max(500).default(''),
})
export type SettingsConflictResolutionInput = z.infer<typeof SettingsConflictResolutionInput>

export const SettingsConflictResolution = z.strictObject({
  draftId: z.string().uuid(),
  reservationId: z.string().uuid(),
  resolution: SettingsConflictResolutionKind,
  note: z.string().max(500),
  resolvedBy: z.string().trim().min(1).max(200),
  resolvedAt: z.string().datetime(),
})
export type SettingsConflictResolution = z.infer<typeof SettingsConflictResolution>

function validJstDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return false
  const [hour, minute] = [Number(match[4]), Number(match[5])]
  if (hour > 23 || minute > 59) return false
  return validDateOnly(`${match[1]}-${match[2]}-${match[3]}`)
}

/** A wall-clock JST instant (`YYYY-MM-DDTHH:mm`); the server converts it to UTC. */
export const JstDateTime = z.string().refine(validJstDateTime, 'must be a JST YYYY-MM-DDTHH:mm')
export type JstDateTime = z.infer<typeof JstDateTime>

export const SettingsPublicationRequest = z.strictObject({
  draftId: z.string().uuid(),
  targetStoreIds: z.string().uuid().array().min(1).max(200),
  scheduledForJst: JstDateTime.optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
})
export type SettingsPublicationRequest = z.infer<typeof SettingsPublicationRequest>

export const SettingsPublicationPatch = z
  .strictObject({
    scheduledForJst: JstDateTime.optional(),
    status: z.literal('cancelled').optional(),
  })
  .refine((value) => value.scheduledForJst !== undefined || value.status !== undefined, {
    message: 'either a new schedule or a cancellation is required',
  })
export type SettingsPublicationPatch = z.infer<typeof SettingsPublicationPatch>

export const SettingsPublicationStatus = z.enum([
  'scheduled',
  'completed',
  'partially_failed',
  'cancelled',
])
export type SettingsPublicationStatus = z.infer<typeof SettingsPublicationStatus>

export const SettingsPublicationTarget = z.strictObject({
  storeId: z.string().uuid(),
  status: z.enum(['pending', 'applied', 'failed']),
  appliedVersion: z.number().int().positive().nullable(),
  failureReason: z.string().max(300).nullable(),
  appliedAt: z.string().datetime().nullable(),
})
export type SettingsPublicationTarget = z.infer<typeof SettingsPublicationTarget>

export const SettingsWebSlotEffect = z.strictObject({
  date: LocalDate,
  previousSlotCount: z.number().int().nonnegative(),
  publishedSlotCount: z.number().int().nonnegative(),
})
export type SettingsWebSlotEffect = z.infer<typeof SettingsWebSlotEffect>

export const SettingsPublication = z.strictObject({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
  draftId: z.string().uuid(),
  status: SettingsPublicationStatus,
  scheduledForJst: JstDateTime.nullable(),
  scheduledAt: z.string().datetime().nullable(),
  executedAt: z.string().datetime().nullable(),
  appliedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  ledgerEntriesAffected: z.number().int().nonnegative(),
  webSlotEffect: SettingsWebSlotEffect,
  targets: SettingsPublicationTarget.array().max(200),
})
export type SettingsPublication = z.infer<typeof SettingsPublication>

export const SettingsVersionSummary = z.strictObject({
  versionId: z.string().uuid(),
  storeId: z.string().uuid(),
  version: z.number().int().positive(),
  origin: SettingsOrigin,
  publishedAt: z.string().datetime(),
  publishedBy: z.string().trim().min(1).max(200),
  changedFields: z.string().array().max(20),
})
export type SettingsVersionSummary = z.infer<typeof SettingsVersionSummary>

/** Serialized so the diff stays a contract value rather than an untyped blob. */
export const SettingsFieldDiff = z.strictObject({
  field: z.string().trim().min(1).max(60),
  before: z.string(),
  after: z.string(),
})
export type SettingsFieldDiff = z.infer<typeof SettingsFieldDiff>

export const SettingsVersionDetail = SettingsVersionSummary.extend({
  settings: AvailabilityStoreSettings,
  diff: SettingsFieldDiff.array().max(20),
})
export type SettingsVersionDetail = z.infer<typeof SettingsVersionDetail>

/** The chain-wide common value a store override can be released back to (UC-EYEX-160). */
export const SettingsChainDefault = z.strictObject({
  version: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  updatedBy: z.string().trim().min(1).max(200),
  settings: AvailabilitySettingsInput,
})
export type SettingsChainDefault = z.infer<typeof SettingsChainDefault>

export const SettingsOverrideView = z.strictObject({
  storeId: z.string().uuid(),
  origin: SettingsOrigin,
  chainVersion: z.number().int().nonnegative(),
  overriddenFields: z.string().array().max(20),
})
export type SettingsOverrideView = z.infer<typeof SettingsOverrideView>

/** Releasing an override shows the new common value and its impact before it applies (AC-EYEX-104). */
export const SettingsOverrideRelease = z.strictObject({
  chainVersion: z.number().int().nonnegative(),
  draft: SettingsDraft,
  impact: SettingsImpactReport,
})
export type SettingsOverrideRelease = z.infer<typeof SettingsOverrideRelease>

/**
 * Recording lifecycle. A recording moves through these states independently of
 * the reservation it may later be linked to: a discarded reception still
 * produces a stored, retained recording.
 */
export const RecordingState = z.enum([
  'permission_check',
  'recording',
  'stopped',
  'uploading',
  'stored',
  'failed',
  'held',
  'pending_deletion',
  'deleted',
])
export type RecordingState = z.infer<typeof RecordingState>

/** Why the reception recording ended; a discard is a first-class outcome. */
export const RecordingEndReason = z.enum([
  'completed',
  'discarded',
  'interrupted',
  'permission_denied',
])
export type RecordingEndReason = z.infer<typeof RecordingEndReason>

/** The audio container types the reception client is allowed to upload. */
export const RecordingContentType = z.enum(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav'])
export type RecordingContentType = z.infer<typeof RecordingContentType>

/**
 * Recording metadata claimed by the reception client. The organization and the
 * store are never accepted from the body: they come from the JWT and the path.
 */
export const RecordingMetadataCreate = z
  .strictObject({
    idempotencyKey: z.string().trim().min(8).max(200),
    receptionSessionId: z.string().uuid(),
    // A discarded reception has no reservation; it is linked later, if ever.
    reservationId: z.string().uuid().nullable().default(null),
    recorderType: z.enum(['personal', 'shared_terminal']),
    recorderId: z.string().trim().min(1).max(200),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    durationSeconds: z.number().int().nonnegative().max(86400),
    endReason: RecordingEndReason,
    contentType: RecordingContentType,
  })
  .refine((value) => Date.parse(value.endedAt) >= Date.parse(value.startedAt), {
    message: 'endedAt must not precede startedAt',
    path: ['endedAt'],
  })
export type RecordingMetadataCreate = z.infer<typeof RecordingMetadataCreate>

/** Client view of one recording. The R2 key is deliberately never exposed. */
export const Recording = z.strictObject({
  id: z.string().uuid(),
  organizationId: z.string().trim().min(1).max(200),
  storeId: z.string().uuid(),
  receptionSessionId: z.string().uuid(),
  reservationId: z.string().uuid().nullable(),
  recorderType: z.enum(['personal', 'shared_terminal']),
  recorderId: z.string().trim().min(1).max(200),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationSeconds: z.number().int().nonnegative(),
  endReason: RecordingEndReason,
  state: RecordingState,
  retentionUntil: z.string().datetime().nullable(),
  holdReason: z.string().trim().min(1).max(500).nullable(),
  heldBy: z.string().trim().min(1).max(200).nullable(),
  heldAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  failureReason: z.string().trim().min(1).max(200).nullable(),
  version: z.number().int().positive(),
})
export type Recording = z.infer<typeof Recording>

/** Operations view filter: 保存済み / 失敗 / 保全中 / 削除予定 / 削除済み. */
export const RecordingListQuery = z.strictObject({ state: RecordingState.optional() })
export type RecordingListQuery = z.infer<typeof RecordingListQuery>

/** A legal hold always carries a reason; the reason is part of the audit. */
export const RecordingHoldInput = z.strictObject({
  version: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
})
export type RecordingHoldInput = z.infer<typeof RecordingHoldInput>

/** Releasing a hold is as accountable as placing one. */
export const RecordingHoldRelease = z.strictObject({
  version: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
})
export type RecordingHoldRelease = z.infer<typeof RecordingHoldRelease>

/** Link a stored recording to the reservation the reception finally produced. */
export const RecordingReservationLink = z.strictObject({
  version: z.number().int().positive(),
  reservationId: z.string().uuid(),
})
export type RecordingReservationLink = z.infer<typeof RecordingReservationLink>

/**
 * Operational retention. The configured values may be raised above the legal
 * minimum but never lowered below it, and they are never presented to a
 * customer as a deletion guarantee.
 */
export const RecordingRetentionSettingsInput = z.strictObject({
  confirmedRetentionDays: z
    .number()
    .int()
    .min(30, {
      message: '成立予約の録音は録音完了から最低30日間保持する必要があります（最低値: 30日）',
    })
    .max(3650),
  discardedRetentionHours: z
    .number()
    .int()
    .min(24, {
      message: '破棄受付の録音は録音終了から最低24時間保持する必要があります（最低値: 24時間）',
    })
    .max(87600),
})
export type RecordingRetentionSettingsInput = z.infer<typeof RecordingRetentionSettingsInput>

export const RecordingRetentionSettings = z.strictObject({
  confirmedRetentionDays: z.number().int().min(30).max(3650),
  discardedRetentionHours: z.number().int().min(24).max(87600),
  updatedAt: z.string().datetime(),
})
export type RecordingRetentionSettings = z.infer<typeof RecordingRetentionSettings>

/** Internal reconciliation run, scoped to one synchronized organization. */
export const RecordingReconciliationRequest = z.strictObject({
  organizationId: z.string().trim().min(1).max(200),
  limit: z.number().int().positive().max(500).default(100),
})
export type RecordingReconciliationRequest = z.infer<typeof RecordingReconciliationRequest>

/** A divergence between R2 and D1; recorded so a silent failure cannot pass. */
export const RecordingReconciliationMismatch = z.strictObject({
  recordingId: z.string().uuid(),
  kind: z.enum(['object_missing', 'object_present_after_deletion', 'delete_failed']),
})
export type RecordingReconciliationMismatch = z.infer<typeof RecordingReconciliationMismatch>

export const RecordingReconciliationReport = z.strictObject({
  scanned: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  retained: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(),
  mismatches: RecordingReconciliationMismatch.array(),
})
export type RecordingReconciliationReport = z.infer<typeof RecordingReconciliationReport>

/* ------------------------------------------------------------------ *
 * 注意事項の権限・確認待ち・版管理 (UC-EYEX-139〜148)
 * ------------------------------------------------------------------ */

/**
 * The five configurable 注意事項 capabilities. Each one is backed by exactly
 * one `StorePermission`, so a configuration change never invents a grant the
 * membership does not already carry: the configured role is an *additional*
 * gate on top of `attention.<capability>`.
 */
export const ATTENTION_CAPABILITIES = ['read', 'write', 'publish', 'revise', 'hide'] as const
export const AttentionCapability = z.enum(ATTENTION_CAPABILITIES)
export type AttentionCapability = z.infer<typeof AttentionCapability>

/**
 * Role ladder used by the configuration. It is derived server-side from the
 * JWT role and the store membership (`store.manage` ⇒ 店舗管理者), never from
 * request input.
 */
export const AttentionRole = z.enum(['staff', 'store_manager', 'organization_admin'])
export type AttentionRole = z.infer<typeof AttentionRole>

/** 即時公開 か 管理者確認後の公開 か (UC-EYEX-141). */
export const AttentionReviewMode = z.enum(['immediate', 'review_required'])
export type AttentionReviewMode = z.infer<typeof AttentionReviewMode>

/** 権限店舗だけ か チェーン全体 か (UC-EYEX-142). */
export const AttentionSharingScope = z.enum(['permitted_stores', 'chain'])
export type AttentionSharingScope = z.infer<typeof AttentionSharingScope>

/** Which configuration row the resolved value came from (UC-EYEX-139). */
export const AttentionSettingsOrigin = z.enum(['organization', 'store'])
export type AttentionSettingsOrigin = z.infer<typeof AttentionSettingsOrigin>

/** One capability, the minimum role it needs, and where that value came from. */
export const AttentionCapabilityRule = z.strictObject({
  capability: AttentionCapability,
  minimumRole: AttentionRole,
  origin: AttentionSettingsOrigin,
})
export type AttentionCapabilityRule = z.infer<typeof AttentionCapabilityRule>

/**
 * Input guidance (UC-EYEX-144) travels as contract data so no screen owns the
 * wording and every client — staff SPA, shared iPad — warns identically.
 */
export const AttentionInputGuidance = z.strictObject({
  record: z.string().trim().min(1).max(200).array().min(1).max(20),
  avoid: z.string().trim().min(1).max(200).array().min(1).max(20),
})
export type AttentionInputGuidance = z.infer<typeof AttentionInputGuidance>

export const ATTENTION_INPUT_GUIDANCE: AttentionInputGuidance = {
  record: ['発生した事実', '発生日時', '根拠', '推奨対応'],
  avoid: ['人格評価', '憶測', '差別につながる属性'],
}

/** The resolved configuration for one store, with the applied origin (AC-EYEX-84). */
export const AttentionSettings = z.strictObject({
  storeId: z.string().uuid(),
  reviewMode: AttentionReviewMode,
  sharingScope: AttentionSharingScope,
  storeOverrideAllowed: z.boolean(),
  origin: AttentionSettingsOrigin,
  capabilities: AttentionCapabilityRule.array().length(ATTENTION_CAPABILITIES.length),
  guidance: AttentionInputGuidance,
})
export type AttentionSettings = z.infer<typeof AttentionSettings>

/** One configured capability, as stored and as submitted. */
export const AttentionCapabilityAssignment = z.strictObject({
  capability: AttentionCapability,
  minimumRole: AttentionRole,
})
export type AttentionCapabilityAssignment = z.infer<typeof AttentionCapabilityAssignment>

/**
 * A configuration write. `scope` decides whether the organization default or
 * the store override is written; `acknowledgedAffectedNoteCount` proves the
 * actor saw the sharing-scope impact before changing it (AC-EYEX-118).
 */
export const AttentionSettingsInput = z.strictObject({
  scope: AttentionSettingsOrigin,
  reviewMode: AttentionReviewMode,
  sharingScope: AttentionSharingScope,
  storeOverrideAllowed: z.boolean(),
  capabilities: AttentionCapabilityAssignment.array()
    .length(ATTENTION_CAPABILITIES.length)
    .refine(
      (rules) => new Set(rules.map((rule) => rule.capability)).size === rules.length,
      'each capability must be configured exactly once',
    ),
  acknowledgedAffectedNoteCount: z.number().int().nonnegative().optional(),
})
export type AttentionSettingsInput = z.infer<typeof AttentionSettingsInput>

/** Ask what a sharing-scope change would do before doing it (AC-EYEX-118). */
export const AttentionSharingScopeImpactRequest = z.strictObject({
  requestedScope: AttentionSharingScope,
})
export type AttentionSharingScopeImpactRequest = z.infer<typeof AttentionSharingScopeImpactRequest>

/** How many existing notes a sharing-scope change would move, and to what. */
export const AttentionSharingScopeImpact = z.strictObject({
  currentScope: AttentionSharingScope,
  requestedScope: AttentionSharingScope,
  affectedNoteCount: z.number().int().nonnegative(),
  affectedCustomerCount: z.number().int().nonnegative(),
  affectedStoreCount: z.number().int().nonnegative(),
})
export type AttentionSharingScopeImpact = z.infer<typeof AttentionSharingScopeImpact>

/** 確認待ち・公開・差戻し・却下・旧版・非表示 の正式な状態. */
export const AttentionNoteStatus = z.enum([
  'pending_review',
  'published',
  'returned',
  'rejected',
  'superseded',
  'hidden',
])
export type AttentionNoteStatus = z.infer<typeof AttentionNoteStatus>

/** 発生した事実・発生日時・根拠・推奨対応 (UC-EYEX-143). All four are mandatory. */
export const AttentionNoteInput = z.strictObject({
  body: z.string().trim().min(1).max(2000),
  occurredAt: z.string().datetime(),
  basis: z.string().trim().min(1).max(500),
  recommendedAction: z.string().trim().min(1).max(500),
})
export type AttentionNoteInput = z.infer<typeof AttentionNoteInput>

/** A revision always names the version it was written against (AC-EYEX-117). */
export const AttentionNoteRevisionInput = z.strictObject({
  ...AttentionNoteInput.shape,
  expectedVersion: z.number().int().positive(),
})
export type AttentionNoteRevisionInput = z.infer<typeof AttentionNoteRevisionInput>

export const AttentionReviewDecision = z.enum(['publish', 'return', 'reject'])
export type AttentionReviewDecision = z.infer<typeof AttentionReviewDecision>

/** 公開 / 差戻し / 却下 は必ず理由付き (AC-EYEX-116). */
export const AttentionReviewInput = z.strictObject({
  decision: AttentionReviewDecision,
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().positive(),
})
export type AttentionReviewInput = z.infer<typeof AttentionReviewInput>

/** 削除ではなく非表示化 (UC-EYEX-146). */
export const AttentionHideInput = z.strictObject({
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().positive(),
})
export type AttentionHideInput = z.infer<typeof AttentionHideInput>

/** One version of one note. Published versions are never overwritten. */
export const AttentionNoteRecord = z.strictObject({
  id: z.string().uuid(),
  noteId: z.string().uuid(),
  customerId: z.string().uuid(),
  storeId: z.string().uuid(),
  status: AttentionNoteStatus,
  version: z.number().int().positive(),
  body: z.string().trim().min(1).max(2000),
  occurredAt: z.string().datetime(),
  basis: z.string().trim().min(1).max(500),
  recommendedAction: z.string().trim().min(1).max(500),
  sharingScope: AttentionSharingScope,
  recordedBy: z.string().trim().min(1).max(200),
  recordedOn: LocalDate,
  publishedAt: z.string().datetime().nullable(),
  hiddenAt: z.string().datetime().nullable(),
  reviewedBy: z.string().trim().min(1).max(200).nullable(),
  reviewedAt: z.string().datetime().nullable(),
  reviewReason: z.string().trim().min(1).max(500).nullable(),
})
export type AttentionNoteRecord = z.infer<typeof AttentionNoteRecord>

export const AttentionNoteFieldDifference = z.strictObject({
  field: z.string().trim().min(1).max(80),
  before: z.string().max(2000),
  after: z.string().max(2000),
})
export type AttentionNoteFieldDifference = z.infer<typeof AttentionNoteFieldDifference>

/** Refusal payload for publishing or revising from a stale version (AC-EYEX-117). */
export const AttentionVersionConflict = z.strictObject({
  error: z.literal('attention_version_conflict'),
  currentVersion: z.number().int().positive(),
  expectedVersion: z.number().int().positive(),
  differences: AttentionNoteFieldDifference.array(),
})
export type AttentionVersionConflict = z.infer<typeof AttentionVersionConflict>

/* ------------------------------------------------------------------ *
 * 監査検索 (UC-EYEX-155, AC-EYEX-102)
 * ------------------------------------------------------------------ */

export const AuditActorType = z.enum(['user', 'shared_terminal'])
export type AuditActorType = z.infer<typeof AuditActorType>

/** 期間・店舗・操作・主体種別・対象 で検索する。既定は直近50件。 */
export const AuditSearchQuery = z.strictObject({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  storeId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(100).optional(),
  actorType: AuditActorType.optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type AuditSearchQuery = z.infer<typeof AuditSearchQuery>

/** One append-only audit row with its 変更前後 and correlation id. */
export const AuditEventView = z.strictObject({
  id: z.string().uuid(),
  occurredAt: z.string().datetime(),
  storeId: z.string().uuid().nullable(),
  actorType: z.string().trim().min(1).max(50),
  actorId: z.string().trim().min(1).max(200),
  action: z.string().trim().min(1).max(100),
  entityType: z.string().trim().min(1).max(100),
  entityId: z.string().trim().min(1).max(200),
  correlationId: z.string().trim().min(1).max(200).nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
})
export type AuditEventView = z.infer<typeof AuditEventView>

/* ------------------------------------------------------------------ *
 * 顧客の重複統合・誤関連解除 (UC-EYEX-181, AC-EYEX-121)
 * ------------------------------------------------------------------ */

export const CustomerMergeSummary = z.strictObject({
  customerId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  kana: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(20),
  primaryStoreId: z.string().uuid(),
  visitCount: z.number().int().nonnegative(),
})
export type CustomerMergeSummary = z.infer<typeof CustomerMergeSummary>

/** The history a merge would move; shown before anything is executed. */
export const CustomerMergeImpact = z.strictObject({
  reservations: z.number().int().nonnegative(),
  walkins: z.number().int().nonnegative(),
  prescriptions: z.number().int().nonnegative(),
  notes: z.number().int().nonnegative(),
  attentionNotes: z.number().int().nonnegative(),
  ownedGlasses: z.number().int().nonnegative(),
})
export type CustomerMergeImpact = z.infer<typeof CustomerMergeImpact>

/** Compare two candidate records before deciding anything (UC-EYEX-181). */
export const CustomerMergePreviewRequest = z
  .strictObject({
    primaryCustomerId: z.string().uuid(),
    duplicateCustomerId: z.string().uuid(),
  })
  .refine(
    (input) => input.primaryCustomerId !== input.duplicateCustomerId,
    'a customer cannot be compared with itself',
  )
export type CustomerMergePreviewRequest = z.infer<typeof CustomerMergePreviewRequest>

export const CustomerMergePreview = z.strictObject({
  primary: CustomerMergeSummary,
  duplicate: CustomerMergeSummary,
  impact: CustomerMergeImpact,
  alreadyMerged: z.boolean(),
})
export type CustomerMergePreview = z.infer<typeof CustomerMergePreview>

/**
 * A merge is never automatic: the actor names both records, gives a reason and
 * acknowledges the exact impact total they were shown.
 */
export const CustomerMergeInput = z
  .strictObject({
    primaryCustomerId: z.string().uuid(),
    duplicateCustomerId: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
    acknowledgedImpactTotal: z.number().int().nonnegative(),
  })
  .refine(
    (input) => input.primaryCustomerId !== input.duplicateCustomerId,
    'a customer cannot be merged into itself',
  )
export type CustomerMergeInput = z.infer<typeof CustomerMergeInput>

export const CustomerMergeResult = z.strictObject({
  primaryCustomerId: z.string().uuid(),
  mergedCustomerId: z.string().uuid(),
  impact: CustomerMergeImpact,
  mergedAt: z.string().datetime(),
})
export type CustomerMergeResult = z.infer<typeof CustomerMergeResult>

/** 誤関連解除: one reception entry loses its wrong customer association. */
export const CustomerLinkReleaseInput = z.strictObject({
  entryType: z.enum(['reservation', 'walkin']),
  entryId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
})
export type CustomerLinkReleaseInput = z.infer<typeof CustomerLinkReleaseInput>

export const CustomerLinkReleaseResult = z.strictObject({
  entryType: z.enum(['reservation', 'walkin']),
  entryId: z.string().uuid(),
  previousCustomerId: z.string().uuid(),
  releasedAt: z.string().datetime(),
})
export type CustomerLinkReleaseResult = z.infer<typeof CustomerLinkReleaseResult>

/*
 * ---------------------------------------------------------------------------
 * Analytics (UC-EYEX-099..108, 180)
 * ---------------------------------------------------------------------------
 * Every analytics response is self-describing: the metric definition, the JST
 * period it covers, the timezone, when it was computed and how many rows it
 * counted travel with the numbers. A number without those five facts is not
 * interpretable, and an operator reading it would guess.
 */

/** Aggregation grain. Anything finer than a day can identify an individual. */
export const AnalyticsGranularity = z.enum(['day', 'week', 'month'])
export type AnalyticsGranularity = z.infer<typeof AnalyticsGranularity>

/** The metrics UC-EYEX-099 requires for one store. */
export const AnalyticsMetric = z.enum(['reservations', 'visits', 'cancellations', 'no_shows'])
export type AnalyticsMetric = z.infer<typeof AnalyticsMetric>

/** Dimensions UC-EYEX-100 compares. */
export const AnalyticsDimension = z.enum(['purpose', 'source', 'hour', 'staff'])
export type AnalyticsDimension = z.infer<typeof AnalyticsDimension>

/** Reception stages UC-EYEX-101 measures the wait and duration of. */
export const AnalyticsStage = z.enum([
  'reception_to_service_start',
  'service_duration',
  'service_end_to_departure',
])
export type AnalyticsStage = z.infer<typeof AnalyticsStage>

/** Web booking funnel steps (UC-EYEX-103). */
export const AnalyticsFunnelStage = z.enum(['started', 'slot_selected', 'confirmed', 'completed'])
export type AnalyticsFunnelStage = z.infer<typeof AnalyticsFunnelStage>

export const AnalyticsQuery = z.strictObject({
  granularity: AnalyticsGranularity,
  /** Any JST calendar date inside the period the caller wants. */
  date: LocalDate,
})
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>

/** The resolved JST window, echoed so a reader never infers it (UC-EYEX-105). */
export const AnalyticsPeriod = z.strictObject({
  granularity: AnalyticsGranularity,
  startDate: LocalDate,
  endDate: LocalDate,
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
})
export type AnalyticsPeriod = z.infer<typeof AnalyticsPeriod>

/** Why a value is absent. `null` values never mean zero. */
export const AnalyticsSuppressionReason = z.enum(['small_sample', 'derivable_from_small_sample'])
export type AnalyticsSuppressionReason = z.infer<typeof AnalyticsSuppressionReason>

export const AnalyticsBreakdownItem = z.strictObject({
  key: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
  value: z.number().int().nonnegative().nullable(),
  suppressed: z.boolean(),
})
export type AnalyticsBreakdownItem = z.infer<typeof AnalyticsBreakdownItem>

export const AnalyticsBreakdown = z.strictObject({
  dimension: AnalyticsDimension,
  metric: AnalyticsMetric,
  suppressed: z.boolean(),
  suppressionReason: AnalyticsSuppressionReason.nullable(),
  items: AnalyticsBreakdownItem.array(),
})
export type AnalyticsBreakdown = z.infer<typeof AnalyticsBreakdown>

/**
 * A metric with the three numbers AC-EYEX-52 requires in the same unit:
 * the current value, the difference against the previous period and the
 * store target. `target` is null while no target is configured — an absent
 * target is stated, never invented.
 */
export const AnalyticsMetricValue = z.strictObject({
  metric: AnalyticsMetric,
  label: z.string().trim().min(1).max(200),
  definition: z.string().trim().min(1).max(500),
  unit: z.enum(['count', 'minutes']),
  value: z.number().int().nonnegative().nullable(),
  previousValue: z.number().int().nonnegative().nullable(),
  difference: z.number().int().nullable(),
  target: z.number().int().nonnegative().nullable(),
  targetDifference: z.number().int().nullable(),
  exceedsTarget: z.boolean(),
  suppressed: z.boolean(),
  suppressionReason: AnalyticsSuppressionReason.nullable(),
})
export type AnalyticsMetricValue = z.infer<typeof AnalyticsMetricValue>

export const AnalyticsDurationBucket = z.strictObject({
  label: z.string().trim().min(1).max(80),
  fromMinutes: z.number().int().nonnegative(),
  /** Null on the open-ended top bucket. */
  toMinutes: z.number().int().positive().nullable(),
  count: z.number().int().nonnegative(),
})
export type AnalyticsDurationBucket = z.infer<typeof AnalyticsDurationBucket>

/** A distribution, never a lone average (AC-EYEX-50). */
export const AnalyticsStageDistribution = z.strictObject({
  stage: AnalyticsStage,
  label: z.string().trim().min(1).max(200),
  definition: z.string().trim().min(1).max(500),
  unit: z.literal('minutes'),
  sampleCount: z.number().int().nonnegative(),
  suppressed: z.boolean(),
  suppressionReason: AnalyticsSuppressionReason.nullable(),
  averageMinutes: z.number().nonnegative().nullable(),
  medianMinutes: z.number().nonnegative().nullable(),
  p90Minutes: z.number().nonnegative().nullable(),
  maxMinutes: z.number().nonnegative().nullable(),
  buckets: AnalyticsDurationBucket.array(),
})
export type AnalyticsStageDistribution = z.infer<typeof AnalyticsStageDistribution>

export const AnalyticsFunnelStep = z.strictObject({
  stage: AnalyticsFunnelStage,
  label: z.string().trim().min(1).max(200),
  count: z.number().int().nonnegative().nullable(),
  /** Sessions lost between the previous step and this one. */
  droppedFromPrevious: z.number().int().nonnegative().nullable(),
  suppressed: z.boolean(),
})
export type AnalyticsFunnelStep = z.infer<typeof AnalyticsFunnelStep>

export const AnalyticsFunnel = z.strictObject({
  sessionCount: z.number().int().nonnegative(),
  suppressed: z.boolean(),
  suppressionReason: AnalyticsSuppressionReason.nullable(),
  steps: AnalyticsFunnelStep.array(),
  /** The step with the largest drop-off, or null when nothing was lost. */
  largestDropStage: AnalyticsFunnelStage.nullable(),
})
export type AnalyticsFunnel = z.infer<typeof AnalyticsFunnel>

/** Rows deliberately left out of the aggregate, with why (AC-EYEX-54). */
export const AnalyticsExclusion = z.strictObject({
  reason: z.enum([
    'invalid_timestamp',
    'missing_stage_timestamp',
    'unknown_purpose',
    'unassigned_staff',
  ]),
  count: z.number().int().positive(),
  description: z.string().trim().min(1).max(500),
  caveat: z.string().trim().min(1).max(500),
})
export type AnalyticsExclusion = z.infer<typeof AnalyticsExclusion>

/** Operational-quality warnings surfaced next to the numbers (UC-EYEX-104). */
export const AnalyticsQualityWarning = z.strictObject({
  code: z.enum(['recording_save_failure', 'settings_contradiction']),
  count: z.number().int().positive(),
  message: z.string().trim().min(1).max(500),
  nextAction: z.string().trim().min(1).max(500),
})
export type AnalyticsQualityWarning = z.infer<typeof AnalyticsQualityWarning>

/**
 * A candidate explanation with its evidence count and what to inspect.
 * The wording is deliberately non-committal: analytics never asserts a cause
 * (AC-EYEX-51).
 */
export const AnalyticsCauseCandidate = z.strictObject({
  metric: AnalyticsMetric,
  code: z.enum([
    'web_source_concentration',
    'peak_hour_concentration',
    'staff_unassigned',
    'purpose_concentration',
  ]),
  hypothesis: z.string().trim().min(1).max(500),
  evidenceCount: z.number().int().positive(),
  inspectionTarget: z.string().trim().min(1).max(500),
})
export type AnalyticsCauseCandidate = z.infer<typeof AnalyticsCauseCandidate>

/** Why a report carries no numbers, and what the reader should do next. */
export const AnalyticsStatus = z.enum(['ok', 'empty', 'suppressed', 'failed'])
export type AnalyticsStatus = z.infer<typeof AnalyticsStatus>

export const AnalyticsReport = z.strictObject({
  storeId: z.string().uuid(),
  storeName: z.string().trim().min(1).max(200),
  timezone: z.literal('Asia/Tokyo'),
  period: AnalyticsPeriod,
  previousPeriod: AnalyticsPeriod,
  /** When this aggregate was computed, from the injected request clock. */
  lastUpdatedAt: z.string().datetime(),
  /** Rows that entered the aggregate, after exclusions. */
  totalCount: z.number().int().nonnegative(),
  smallSampleThreshold: z.number().int().positive(),
  status: AnalyticsStatus,
  /** Populated for every status except `ok`. */
  reason: z.string().trim().min(1).max(500).nullable(),
  nextAction: z.string().trim().min(1).max(500).nullable(),
  metrics: AnalyticsMetricValue.array(),
  breakdowns: AnalyticsBreakdown.array(),
  stageDistributions: AnalyticsStageDistribution.array(),
  funnel: AnalyticsFunnel,
  exclusions: AnalyticsExclusion.array(),
  qualityWarnings: AnalyticsQualityWarning.array(),
  causeCandidates: AnalyticsCauseCandidate.array(),
})
export type AnalyticsReport = z.infer<typeof AnalyticsReport>

export const AnalyticsTarget = z.strictObject({
  metric: AnalyticsMetric,
  /** Same unit as the metric it targets, per AC-EYEX-52. */
  target: z.number().int().nonnegative(),
})
export type AnalyticsTarget = z.infer<typeof AnalyticsTarget>

export const AnalyticsSettings = z.strictObject({
  organizationId: z.string().trim().min(1).max(200),
  smallSampleThreshold: z.number().int().min(1).max(1000),
  targets: AnalyticsTarget.array(),
  updatedAt: z.string().datetime(),
})
export type AnalyticsSettings = z.infer<typeof AnalyticsSettings>

export const AnalyticsSettingsInput = z
  .strictObject({
    smallSampleThreshold: z.number().int().min(1).max(1000),
    targets: AnalyticsTarget.array().max(20),
  })
  .refine((value) => new Set(value.targets.map((t) => t.metric)).size === value.targets.length, {
    message: 'each metric may carry at most one target',
    path: ['targets'],
  })
export type AnalyticsSettingsInput = z.infer<typeof AnalyticsSettingsInput>

/** Client-reported web booking funnel step, keyed by an anonymous session. */
export const AnalyticsFunnelEventInput = z.strictObject({
  sessionId: z.string().uuid(),
  stage: AnalyticsFunnelStage,
})
export type AnalyticsFunnelEventInput = z.infer<typeof AnalyticsFunnelEventInput>

export const AnalyticsFunnelEventResult = z.strictObject({ recorded: z.boolean() })
export type AnalyticsFunnelEventResult = z.infer<typeof AnalyticsFunnelEventResult>

/*
 * ---------------------------------------------------------------------------
 * Notices and alerts (UC-EYEX-178, 179)
 * ---------------------------------------------------------------------------
 */

/** お知らせ (informational) and アラート (needs action) share one inbox. */
export const AlertKind = z.enum(['notice', 'alert'])
export type AlertKind = z.infer<typeof AlertKind>

export const AlertCode = z.enum(['long_wait', 'recording_save_failure', 'settings_contradiction'])
export type AlertCode = z.infer<typeof AlertCode>

/**
 * 既読 and 対応済み are separate facts (AC-EYEX-120): reading an alert is not
 * handling it, and one operator may read what another resolves.
 */
export const AlertRecord = z.strictObject({
  id: z.string().uuid(),
  storeId: z.string().uuid(),
  kind: AlertKind,
  code: AlertCode,
  title: z.string().trim().min(1).max(200),
  /** 発生理由. */
  reason: z.string().trim().min(1).max(500),
  /** 対象 — an operational subject, never a customer name. */
  subject: z.string().trim().min(1).max(200),
  subjectType: z.enum(['reservation', 'walkin', 'recording', 'visit_purpose']),
  subjectId: z.string().trim().min(1).max(200),
  /** 発生時刻. */
  occurredAt: z.string().datetime(),
  /** 次の操作. */
  nextAction: z.string().trim().min(1).max(500),
  readAt: z.string().datetime().nullable(),
  readBy: z.string().trim().min(1).max(200).nullable(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedBy: z.string().trim().min(1).max(200).nullable(),
  resolutionNote: z.string().trim().min(1).max(500).nullable(),
})
export type AlertRecord = z.infer<typeof AlertRecord>

export const AlertListQuery = z.strictObject({
  kind: AlertKind.optional(),
  status: z.enum(['all', 'unread', 'unresolved']).optional(),
})
export type AlertListQuery = z.infer<typeof AlertListQuery>

export const AlertResolveInput = z.strictObject({
  note: z.string().trim().min(1).max(500),
})
export type AlertResolveInput = z.infer<typeof AlertResolveInput>

export const AlertEvaluationResult = z.strictObject({
  evaluatedAt: z.string().datetime(),
  raised: z.number().int().nonnegative(),
  /** Conditions that are switched off are reported, not silently skipped. */
  disabledCodes: AlertCode.array(),
  alerts: AlertRecord.array(),
})
export type AlertEvaluationResult = z.infer<typeof AlertEvaluationResult>

export const AlertCondition = z.strictObject({
  code: AlertCode,
  enabled: z.boolean(),
  /** Only meaningful for `long_wait`; null for the other conditions. */
  thresholdMinutes: z.number().int().min(1).max(600).nullable(),
})
export type AlertCondition = z.infer<typeof AlertCondition>

export const AlertSettings = z.strictObject({
  storeId: z.string().uuid(),
  conditions: AlertCondition.array(),
  /** Where the notification would be sent once a trigger dispatches it. */
  notificationTargets: z.string().trim().email().max(320).array(),
  updatedAt: z.string().datetime(),
})
export type AlertSettings = z.infer<typeof AlertSettings>

export const AlertSettingsInput = z
  .strictObject({
    conditions: AlertCondition.array().min(1).max(10),
    notificationTargets: z.string().trim().email().max(320).array().max(20),
  })
  .refine(
    (value) => new Set(value.conditions.map((c) => c.code)).size === value.conditions.length,
    { message: 'each condition may be configured at most once', path: ['conditions'] },
  )
  .refine(
    (value) =>
      value.conditions.every((c) =>
        c.code === 'long_wait' ? c.thresholdMinutes !== null : c.thresholdMinutes === null,
      ),
    { message: 'only long_wait carries a minute threshold', path: ['conditions'] },
  )
export type AlertSettingsInput = z.infer<typeof AlertSettingsInput>
