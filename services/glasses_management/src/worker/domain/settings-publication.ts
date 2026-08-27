import type {
  AvailabilityStoreSettings,
  SettingsConflictResolutionKind,
  SettingsFieldDiff,
  SettingsImpactItem,
  SettingsImpactReport,
  SettingsPublicSlotEffect,
} from '@app/contracts'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const JST_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/**
 * Convert a JST wall-clock instant (`YYYY-MM-DDTHH:mm`) into its UTC instant.
 *
 * Publication windows are authored in JST, but every stored instant and every
 * comparison is UTC. Doing the conversion here — and only here — keeps the
 * boundary decision (`isPublicationDue`) a single unambiguous comparison.
 */
export function jstDateTimeToInstant(value: string): string {
  const match = JST_DATE_TIME.exec(value)
  if (!match) throw new RangeError('scheduled instant must be JST YYYY-MM-DDTHH:mm')
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  if (hour > 23 || minute > 59) throw new RangeError('scheduled instant has an invalid time')
  const utc = Date.UTC(year, month - 1, day, hour, minute)
  const rebuilt = new Date(utc)
  if (
    rebuilt.getUTCFullYear() !== year ||
    rebuilt.getUTCMonth() !== month - 1 ||
    rebuilt.getUTCDate() !== day
  ) {
    throw new RangeError('scheduled instant has an invalid date')
  }
  return new Date(utc - JST_OFFSET_MS).toISOString()
}

function jstParts(instant: string | Date): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  dayOfWeek: number
} {
  const value = instant instanceof Date ? instant : new Date(instant)
  const time = value.getTime()
  if (Number.isNaN(time)) throw new RangeError('invalid instant')
  const shifted = new Date(time + JST_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayOfWeek: shifted.getUTCDay(),
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Render a stored UTC instant back as the JST wall clock the operator entered. */
export function instantToJstDateTime(instant: string): string {
  const parts = jstParts(instant)
  return `${String(parts.year)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`
}

/**
 * The scheduled instant itself is due; one millisecond earlier is not. The
 * comparison is inclusive so a boundary instant can never fall through both a
 * "not yet" and an "already ran" branch.
 */
export function isPublicationDue(scheduledAt: string, now: Date): boolean {
  const scheduled = Date.parse(scheduledAt)
  if (!Number.isFinite(scheduled)) throw new RangeError('invalid scheduled instant')
  const current = now.getTime()
  if (Number.isNaN(current)) throw new RangeError('clock returned an invalid date')
  return current >= scheduled
}

const DIFFED_FIELDS = [
  'receptionStatus',
  'businessHours',
  'exceptions',
  'purposes',
  'staff',
  'shifts',
  'equipment',
  'maintenance',
] as const

type DiffedField = (typeof DIFFED_FIELDS)[number]

function serialize(settings: AvailabilityStoreSettings, field: DiffedField): string {
  return JSON.stringify(settings[field])
}

/** The version-history diff; the version number itself is never a change. */
export function settingsDiff(
  before: AvailabilityStoreSettings,
  after: AvailabilityStoreSettings,
): SettingsFieldDiff[] {
  return DIFFED_FIELDS.flatMap((field) => {
    const previous = serialize(before, field)
    const next = serialize(after, field)
    return previous === next ? [] : [{ field, before: previous, after: next }]
  })
}

export function changedSettingsFields(
  before: AvailabilityStoreSettings,
  after: AvailabilityStoreSettings,
): string[] {
  return settingsDiff(before, after).map((entry) => entry.field)
}

type ImpactBooking = Readonly<{
  id: string
  startAt: string
  endAt: string
  purposeIds: readonly string[]
  staffId: string | null
  status: string
}>

type ImpactResolution = Readonly<{
  reservationId: string
  resolution: SettingsConflictResolutionKind
}>

export type SettingsImpactInput = Readonly<{
  draftId: string
  storeId: string
  evaluatedAt: string
  published: AvailabilityStoreSettings
  draft: AvailabilityStoreSettings
  bookings: readonly ImpactBooking[]
  resolutions: readonly ImpactResolution[]
  publicSlots: SettingsPublicSlotEffect
}>

function coveredByHours(draft: AvailabilityStoreSettings, startAt: string, endAt: string): boolean {
  const start = jstParts(startAt)
  const end = jstParts(endAt)
  const startTime = `${pad(start.hour)}:${pad(start.minute)}`
  const endTime = `${pad(end.hour)}:${pad(end.minute)}`
  const date = `${String(start.year)}-${pad(start.month)}-${pad(start.day)}`
  const exception = draft.exceptions.find((entry) => entry.date === date)
  if (exception !== undefined) {
    if (exception.mode === 'closed') return false
    return exception.periods.some(
      (period) => period.startTime <= startTime && endTime <= period.endTime,
    )
  }
  const hours = draft.businessHours.find((entry) => entry.dayOfWeek === start.dayOfWeek)
  if (hours === undefined) return false
  return hours.periods.some((period) => period.startTime <= startTime && endTime <= period.endTime)
}

function skillCovered(draft: AvailabilityStoreSettings, skill: string): boolean {
  return draft.staff.some(
    (member) => member.isActive && member.canBook && member.skills.includes(skill),
  )
}

function equipmentAvailable(draft: AvailabilityStoreSettings, name: string): boolean {
  return draft.equipment.some((resource) => resource.isActive && resource.name === name)
}

/**
 * Report what a draft would break before it is published.
 *
 * Everything here is pure: the caller supplies the settings, the future
 * bookings, the recorded conflict resolutions and the computed public slot
 * counts, so the same evaluation runs for the impact screen, for the
 * publication request and again immediately before a scheduled run.
 */
export function evaluateSettingsImpact(input: SettingsImpactInput): SettingsImpactReport {
  const items: SettingsImpactItem[] = []
  const resolutionByReservation = new Map(
    input.resolutions.map((entry) => [entry.reservationId, entry.resolution] as const),
  )
  const draftPurposes = new Map(input.draft.purposes.map((purpose) => [purpose.id, purpose]))
  const affectedReservations = new Set<string>()

  const push = (item: SettingsImpactItem, blocking: boolean): void => {
    const resolution =
      item.reservationId === null ? null : (resolutionByReservation.get(item.reservationId) ?? null)
    items.push({
      ...item,
      resolution,
      severity: blocking && resolution === null ? 'blocking' : blocking ? 'warning' : item.severity,
    })
    if (item.reservationId !== null) affectedReservations.add(item.reservationId)
  }

  for (const booking of input.bookings) {
    if (booking.status === 'cancelled') continue
    if (Date.parse(booking.startAt) < Date.parse(input.evaluatedAt)) continue
    for (const purposeId of booking.purposeIds) {
      const purpose = draftPurposes.get(purposeId)
      if (purpose === undefined) {
        push(
          {
            kind: 'reservation_conflict',
            severity: 'blocking',
            reservationId: booking.id,
            message: '予約が使用している受付内容が下書きに存在しません',
            resolution: null,
          },
          true,
        )
        continue
      }
      for (const skill of purpose.requiredSkills) {
        if (skillCovered(input.draft, skill)) continue
        push(
          {
            kind: 'missing_staff_skill',
            severity: 'blocking',
            reservationId: booking.id,
            message: `技能「${skill}」を持つ担当者が下書きにいません`,
            resolution: null,
          },
          true,
        )
      }
      for (const equipment of purpose.requiredEquipment) {
        if (equipmentAvailable(input.draft, equipment)) continue
        push(
          {
            kind: 'missing_equipment',
            severity: 'blocking',
            reservationId: booking.id,
            message: `設備「${equipment}」が下書きで利用できません`,
            resolution: null,
          },
          true,
        )
      }
    }
    if (!coveredByHours(input.draft, booking.startAt, booking.endAt)) {
      push(
        {
          kind: 'out_of_hours',
          severity: 'warning',
          reservationId: booking.id,
          message: '既存予約が下書きの営業時間外になります',
          resolution: null,
        },
        false,
      )
    }
  }

  if (input.draft.businessHours.length === 0) {
    push(
      {
        kind: 'out_of_hours',
        severity: 'warning',
        reservationId: null,
        message: '下書きに営業時間が設定されていません',
        resolution: null,
      },
      false,
    )
  }

  if (input.publicSlots.draftCount !== input.publicSlots.publishedCount) {
    push(
      {
        kind: 'web_slot_change',
        severity: 'info',
        reservationId: null,
        message: `Web公開枠が ${String(input.publicSlots.publishedCount)} から ${String(input.publicSlots.draftCount)} に変わります`,
        resolution: null,
      },
      false,
    )
  }

  const blockingCount = items.filter((item) => item.severity === 'blocking').length
  return {
    draftId: input.draftId,
    storeId: input.storeId,
    evaluatedAt: input.evaluatedAt,
    blockingCount,
    warningCount: items.filter((item) => item.severity === 'warning').length,
    canPublish: blockingCount === 0,
    ledgerEntriesAffected: affectedReservations.size,
    publicSlots: input.publicSlots,
    items,
  }
}

/**
 * Derive a store-local copy of one settings snapshot.
 *
 * Purpose, staff and equipment rows are keyed by their id alone, so the same
 * chain-wide value cannot be written into two stores verbatim. Each resource
 * id is replaced by a UUID derived from `storeId:sourceId`, which keeps the
 * mapping deterministic (republishing the same version rewrites the same rows)
 * and store-local (two stores never collide), while every internal reference
 * is rewritten to match.
 */
export async function deriveStoreScopedSettings(
  settings: AvailabilityStoreSettings,
  storeId: string,
): Promise<AvailabilityStoreSettings> {
  const cache = new Map<string, string>()
  const derive = async (sourceId: string): Promise<string> => {
    const cached = cache.get(sourceId)
    if (cached !== undefined) return cached
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${storeId}:${sourceId}`)),
    )
    const bytes = [...digest.slice(0, 16)]
    // RFC 4122 version 5 / variant bits, so the result is a valid UUID.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
    const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
    cache.set(sourceId, uuid)
    return uuid
  }

  return {
    ...settings,
    storeId,
    purposes: await Promise.all(
      settings.purposes.map(async (purpose) => ({ ...purpose, id: await derive(purpose.id) })),
    ),
    staff: await Promise.all(
      settings.staff.map(async (member) => ({ ...member, id: await derive(member.id) })),
    ),
    shifts: await Promise.all(
      settings.shifts.map(async (shift) => ({
        ...shift,
        id: await derive(shift.id),
        staffId: await derive(shift.staffId),
      })),
    ),
    equipment: await Promise.all(
      settings.equipment.map(async (resource) => ({ ...resource, id: await derive(resource.id) })),
    ),
    maintenance: await Promise.all(
      settings.maintenance.map(async (maintenance) => ({
        ...maintenance,
        id: await derive(maintenance.id),
        equipmentId: await derive(maintenance.equipmentId),
      })),
    ),
  }
}
