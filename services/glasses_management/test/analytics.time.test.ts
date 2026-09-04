import { describe, expect, it } from 'vitest'
import {
  analyticsJstDate,
  aroundRange,
  businessDaysFromClosedRows,
  monthRange,
  weekRange,
} from '../src/worker/domain/analytics'

describe('analytics JST ranges', () => {
  it('changes its business date exactly at UTC 15:00', () => {
    expect(analyticsJstDate('2026-08-31T14:59:59.999Z')).toBe('2026-08-31')
    expect(analyticsJstDate('2026-08-31T15:00:00.000Z')).toBe('2026-09-01')
    expect(analyticsJstDate('2027-12-31T15:00:00.000Z')).toBe('2028-01-01')
  })

  it('resolves around and month ranges across month, year, and leap-day boundaries', () => {
    expect(aroundRange('2026-01-01')).toEqual({ from: '2025-12-25', to: '2026-01-08' })
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('starts weekly aggregation on Monday', () => {
    expect(weekRange('2026-08-27')).toEqual({ from: '2026-08-24', to: '2026-08-30' })
  })

  it('counts only explicit open closed rows as business days', () => {
    const rows = Array.from({ length: 31 }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, '0')}`,
      value: [4, 11, 18, 25].includes(index + 1) ? 1 : 0,
    })).filter((row) => row.date !== '2026-08-31')
    expect(businessDaysFromClosedRows(rows)).toBe(26)
    expect(businessDaysFromClosedRows([...rows, { date: '2026-08-31', value: 0 }])).toBe(27)
  })
})
