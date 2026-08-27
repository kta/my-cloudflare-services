import type {
  AvailabilityBusinessHours,
  AvailabilityEquipment,
  AvailabilityException,
  AvailabilityMaintenance,
  AvailabilityPurpose,
  AvailabilityReceptionStatus,
  AvailabilitySlot,
  AvailabilityStaff,
  AvailabilityStaffShift,
} from '@app/contracts'

const JAPAN_OFFSET = '+09:00'
const ACTIVE_BOOKING_STATUSES = new Set(['held', 'confirmed', 'checked_in'])

export type AvailabilityBooking = {
  id: string
  startAt: string
  endAt: string
  purposeIds: readonly string[]
  status: 'held' | 'confirmed' | 'checked_in' | 'cancelled'
  staffId?: string | null
  equipmentIds?: readonly string[]
  equipmentNames?: readonly string[]
}

export type AvailabilityEngineInput = {
  date: string
  store: {
    receptionStatus: AvailabilityReceptionStatus
    businessHours: readonly AvailabilityBusinessHours[]
    exceptions: readonly AvailabilityException[]
  }
  purposes: readonly AvailabilityPurpose[]
  staff: readonly AvailabilityStaff[]
  shifts: readonly AvailabilityStaffShift[]
  equipment: readonly AvailabilityEquipment[]
  maintenance: readonly AvailabilityMaintenance[]
  bookings: readonly AvailabilityBooking[]
}

export type AvailabilityResult = {
  date: string
  timezone: 'Asia/Tokyo'
  durationMinutes: number
  intervalMinutes: number
  slots: AvailabilitySlot[]
}

export type AvailabilityResourceAllocation = {
  staffId: string
  equipmentIds: string[]
}

function parseLocalMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

function assertValidLocalDate(date: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new RangeError('invalid local date')
  const value = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date) {
    throw new RangeError('invalid local date')
  }
}

function formatLocalMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function localDateTime(date: string, time: string): Date {
  const value = new Date(`${date}T${time}:00.000${JAPAN_OFFSET}`)
  if (Number.isNaN(value.getTime())) throw new RangeError('invalid local date or time')
  return value
}

function localDateWeekday(date: string): number {
  const value = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(value.getTime())) throw new RangeError('invalid local date')
  return value.getUTCDay()
}

function overlaps(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart < rightEnd && rightStart < leftEnd
}

function covers(
  periodStart: number,
  periodEnd: number,
  candidateStart: number,
  candidateEnd: number,
): boolean {
  return periodStart <= candidateStart && candidateEnd <= periodEnd
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

function leastCommonMultiple(values: readonly number[]): number {
  return values.reduce((current, value) => (current / gcd(current, value)) * value, 1)
}

function exceptionalPeriods(
  input: AvailabilityEngineInput,
): readonly AvailabilityBusinessHours['periods'][number][] {
  if (input.store.receptionStatus === 'paused') return []
  const exception = input.store.exceptions.find((candidate) => candidate.date === input.date)
  if (exception) return exception.mode === 'open' ? exception.periods : []
  return (
    input.store.businessHours.find(
      (candidate) => candidate.dayOfWeek === localDateWeekday(input.date),
    )?.periods ?? []
  )
}

function shiftFor(
  shifts: readonly AvailabilityStaffShift[],
  staffId: string,
  date: string,
  candidateStart: number,
  candidateEnd: number,
): AvailabilityStaffShift | undefined {
  return shifts.find((shift) => {
    if (shift.staffId !== staffId || shift.date !== date) return false
    const shiftStart = parseLocalMinutes(shift.startTime)
    const shiftEnd = parseLocalMinutes(shift.endTime)
    if (!covers(shiftStart, shiftEnd, candidateStart, candidateEnd)) return false
    return !shift.breaks.some((breakPeriod) =>
      overlaps(
        candidateStart,
        candidateEnd,
        parseLocalMinutes(breakPeriod.startTime),
        parseLocalMinutes(breakPeriod.endTime),
      ),
    )
  })
}

function staffIsAvailable(
  input: AvailabilityEngineInput,
  requiredSkills: ReadonlySet<string>,
  candidateStart: number,
  candidateEnd: number,
  startAt: number,
  endAt: number,
): boolean {
  return input.staff.some((member) => {
    if (!member.isActive || !member.canBook) return false
    const memberSkills = new Set(member.skills)
    if (![...requiredSkills].every((skill) => memberSkills.has(skill))) return false
    if (!shiftFor(input.shifts, member.id, input.date, candidateStart, candidateEnd)) return false
    return !input.bookings.some((booking) => {
      if (!ACTIVE_BOOKING_STATUSES.has(booking.status) || booking.staffId !== member.id)
        return false
      const bookingStart = Date.parse(booking.startAt)
      const bookingEnd = Date.parse(booking.endAt)
      return Number.isFinite(bookingStart) && Number.isFinite(bookingEnd)
        ? overlaps(startAt, endAt, bookingStart, bookingEnd)
        : true
    })
  })
}

function equipmentIsAvailable(
  input: AvailabilityEngineInput,
  requiredEquipment: ReadonlySet<string>,
  candidateStart: number,
  candidateEnd: number,
  startAt: number,
  endAt: number,
): boolean {
  return [...requiredEquipment].every((name) => {
    const resources = input.equipment.filter(
      (resource) => resource.isActive && resource.name === name,
    )
    if (resources.length === 0) return false

    const usableCapacity = resources.reduce((total, resource) => {
      const withinOperatingHours = resource.availablePeriods.some((period) =>
        covers(
          parseLocalMinutes(period.startTime),
          parseLocalMinutes(period.endTime),
          candidateStart,
          candidateEnd,
        ),
      )
      if (!withinOperatingHours) return total
      const underMaintenance = input.maintenance.some((maintenance) => {
        if (maintenance.equipmentId !== resource.id || maintenance.date !== input.date) return false
        return overlaps(
          candidateStart,
          candidateEnd,
          parseLocalMinutes(maintenance.startTime),
          parseLocalMinutes(maintenance.endTime),
        )
      })
      if (underMaintenance) return total

      const occupied = input.bookings.filter((booking) => {
        if (!ACTIVE_BOOKING_STATUSES.has(booking.status)) return false
        const assigned = booking.equipmentIds?.includes(resource.id) ?? false
        const named = booking.equipmentNames?.includes(name) ?? false
        if (!assigned && !named) return false
        const bookingStart = Date.parse(booking.startAt)
        const bookingEnd = Date.parse(booking.endAt)
        return Number.isFinite(bookingStart) && Number.isFinite(bookingEnd)
          ? overlaps(startAt, endAt, bookingStart, bookingEnd)
          : true
      }).length
      return total + Math.max(0, resource.capacity - occupied)
    }, 0)

    return usableCapacity > 0
  })
}

function capacityIsAvailable(
  input: AvailabilityEngineInput,
  selectedPurposes: readonly AvailabilityPurpose[],
  startAt: number,
  endAt: number,
): boolean {
  return selectedPurposes.every((purpose) => {
    const occupied = input.bookings.filter((booking) => {
      if (!ACTIVE_BOOKING_STATUSES.has(booking.status)) return false
      if (booking.purposeIds.length > 0 && !booking.purposeIds.includes(purpose.id)) return false
      const bookingStart = Date.parse(booking.startAt)
      const bookingEnd = Date.parse(booking.endAt)
      return Number.isFinite(bookingStart) && Number.isFinite(bookingEnd)
        ? overlaps(startAt, endAt, bookingStart, bookingEnd)
        : true
    }).length
    return occupied < purpose.maxConcurrent
  })
}

/**
 * Calculate candidate starts for one JST calendar date.
 *
 * This function has no Worker, D1, or current-time dependency. Callers load
 * a tenant/store snapshot and existing booking intervals, then pass that
 * snapshot here. Intervals are half-open (`[start, end)`), so a booking that
 * ends exactly when another starts does not create a false conflict.
 */
export function calculateAvailability(
  input: AvailabilityEngineInput,
  purposeIds?: readonly string[],
): AvailabilityResult {
  assertValidLocalDate(input.date)
  const selectedIds = purposeIds ?? input.purposes.map((purpose) => purpose.id)
  const selectedPurposes = selectedIds
    .map((id) => input.purposes.find((purpose) => purpose.id === id))
    .filter((purpose): purpose is AvailabilityPurpose => purpose !== undefined)
  if (selectedPurposes.length !== selectedIds.length || selectedPurposes.length === 0) {
    throw new RangeError('at least one known purpose is required')
  }

  const durationMinutes = selectedPurposes.reduce(
    (total, purpose) => total + purpose.durationMinutes,
    0,
  )
  const intervalMinutes = leastCommonMultiple(
    selectedPurposes.map((purpose) => purpose.slotIntervalMinutes),
  )
  if (
    !Number.isSafeInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    !Number.isSafeInteger(intervalMinutes) ||
    intervalMinutes <= 0
  ) {
    throw new RangeError('purpose duration and interval must be positive integers')
  }
  const requiredSkills = new Set(selectedPurposes.flatMap((purpose) => purpose.requiredSkills))
  const requiredEquipment = new Set(
    selectedPurposes.flatMap((purpose) => purpose.requiredEquipment),
  )
  const periods = exceptionalPeriods(input)
  const slots: AvailabilitySlot[] = []

  for (const period of periods) {
    const periodStart = parseLocalMinutes(period.startTime)
    const periodEnd = parseLocalMinutes(period.endTime)
    for (
      let candidateStart = periodStart;
      candidateStart + durationMinutes <= periodEnd;
      candidateStart += intervalMinutes
    ) {
      const candidateEnd = candidateStart + durationMinutes
      const startDate = localDateTime(input.date, formatLocalMinutes(candidateStart))
      const endDate = localDateTime(input.date, formatLocalMinutes(candidateEnd))
      const startAt = startDate.getTime()
      const endAt = endDate.getTime()
      if (!capacityIsAvailable(input, selectedPurposes, startAt, endAt)) continue
      if (!staffIsAvailable(input, requiredSkills, candidateStart, candidateEnd, startAt, endAt))
        continue
      if (
        !equipmentIsAvailable(
          input,
          requiredEquipment,
          candidateStart,
          candidateEnd,
          startAt,
          endAt,
        )
      )
        continue

      slots.push({
        date: input.date,
        startTime: formatLocalMinutes(candidateStart),
        endTime: formatLocalMinutes(candidateEnd),
        startAt: startDate.toISOString(),
        endAt: endDate.toISOString(),
      })
    }
  }

  const uniqueSlots = new Map(slots.map((slot) => [slot.startAt, slot]))
  return {
    date: input.date,
    timezone: 'Asia/Tokyo',
    durationMinutes,
    intervalMinutes,
    slots: [...uniqueSlots.values()].sort((left, right) =>
      left.startAt.localeCompare(right.startAt),
    ),
  }
}

/** Resolve the concrete staff member and equipment resources for an already validated slot. */
export function selectAvailabilityAllocation(
  input: AvailabilityEngineInput,
  purposeIds: readonly string[],
  slot: AvailabilitySlot,
): AvailabilityResourceAllocation {
  const selectedPurposes = purposeIds
    .map((id) => input.purposes.find((purpose) => purpose.id === id))
    .filter((purpose): purpose is AvailabilityPurpose => purpose !== undefined)
  if (selectedPurposes.length !== purposeIds.length || selectedPurposes.length === 0) {
    throw new RangeError('at least one known purpose is required')
  }
  const candidateStart = parseLocalMinutes(slot.startTime)
  const candidateEnd = parseLocalMinutes(slot.endTime)
  const startAt = Date.parse(slot.startAt)
  const endAt = Date.parse(slot.endAt)
  const requiredSkills = new Set(selectedPurposes.flatMap((purpose) => purpose.requiredSkills))
  const staff = input.staff.find((member) => {
    if (!member.isActive || !member.canBook) return false
    if (![...requiredSkills].every((skill) => member.skills.includes(skill))) return false
    if (!shiftFor(input.shifts, member.id, input.date, candidateStart, candidateEnd)) return false
    return !input.bookings.some((booking) => {
      if (!ACTIVE_BOOKING_STATUSES.has(booking.status) || booking.staffId !== member.id)
        return false
      return overlaps(startAt, endAt, Date.parse(booking.startAt), Date.parse(booking.endAt))
    })
  })
  if (!staff) throw new RangeError('no staff can be allocated')

  const equipmentIds = [
    ...new Set(selectedPurposes.flatMap((purpose) => purpose.requiredEquipment)),
  ].map((name) => {
    const resource = input.equipment.find((candidate) => {
      if (!candidate.isActive || candidate.name !== name) return false
      if (
        !candidate.availablePeriods.some((period) =>
          covers(
            parseLocalMinutes(period.startTime),
            parseLocalMinutes(period.endTime),
            candidateStart,
            candidateEnd,
          ),
        )
      )
        return false
      if (
        input.maintenance.some(
          (maintenance) =>
            maintenance.equipmentId === candidate.id &&
            maintenance.date === input.date &&
            overlaps(
              candidateStart,
              candidateEnd,
              parseLocalMinutes(maintenance.startTime),
              parseLocalMinutes(maintenance.endTime),
            ),
        )
      )
        return false
      const occupied = input.bookings.filter(
        (booking) =>
          ACTIVE_BOOKING_STATUSES.has(booking.status) &&
          (booking.equipmentIds?.includes(candidate.id) ?? false) &&
          overlaps(startAt, endAt, Date.parse(booking.startAt), Date.parse(booking.endAt)),
      ).length
      return occupied < candidate.capacity
    })
    if (!resource) throw new RangeError(`no equipment can be allocated for ${name}`)
    return resource.id
  })
  return { staffId: staff.id, equipmentIds }
}
