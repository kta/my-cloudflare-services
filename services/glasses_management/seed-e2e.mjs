const MS_PER_DAY = 86_400_000

const daysFrom = (from, days) => {
  const base = Date.parse(`${from}T00:00:00.000Z`)
  return Array.from({ length: days }, (_, index) =>
    new Date(base + index * MS_PER_DAY).toISOString().slice(0, 10),
  )
}

/**
 * E2E が実日付で予約を作る期間だけを返す。
 * 固定モック用seedと重なる日は二重に勤務を作らない。
 */
export function dynamicE2eShiftDates(today, fixedFrom, fixedDays, days = 45) {
  const fixed = new Set(daysFrom(fixedFrom, fixedDays))
  return daysFrom(today, days).filter((date) => !fixed.has(date))
}
