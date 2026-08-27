import { describe, expect, test } from 'vitest'
import {
  entryPlacement,
  formatJstMinutes,
  gridColumnLabels,
  jstDayOf,
  jstMinutesOf,
  LEDGER_GRID,
  nowLine,
} from './ledger-timeline'

// Every case injects the instant. The ledger must never read the wall clock:
// a now line that moved with the test runner's timezone or with the passage of
// a minute would be untestable exactly where it matters (AC-EYEX-13, 19).

describe('Asia/Tokyo day boundaries', () => {
  test('the last instant of a JST day still belongs to that day', () => {
    expect(jstDayOf('2026-08-26T14:59:59.999Z')).toBe('2026-08-26')
  })

  test('midnight JST starts the next day', () => {
    expect(jstDayOf('2026-08-26T15:00:00.000Z')).toBe('2026-08-27')
    expect(jstMinutesOf('2026-08-26T15:00:00.000Z')).toBe(0)
  })

  test('minutes are counted from JST midnight', () => {
    expect(jstMinutesOf('2026-08-27T02:08:00.000Z')).toBe(11 * 60 + 8)
  })

  test('minutes render as zero-padded wall time', () => {
    expect(formatJstMinutes(11 * 60 + 8)).toBe('11:08')
    expect(formatJstMinutes(9 * 60)).toBe('09:00')
  })
})

describe('now line position', () => {
  const date = '2026-08-27'

  test('sits at the very start of the grid at the exact grid start', () => {
    // 10:00 JST
    expect(nowLine({ now: '2026-08-27T01:00:00.000Z', date, grid: LEDGER_GRID })).toEqual({
      label: '現在 10:00',
      time: '10:00',
      ratio: 0,
    })
  })

  test('sits at the very end of the grid at the exact grid end', () => {
    // 13:30 JST — the right edge of the approved mock's seven columns.
    expect(nowLine({ now: '2026-08-27T04:30:00.000Z', date, grid: LEDGER_GRID })).toEqual({
      label: '現在 13:30',
      time: '13:30',
      ratio: 1,
    })
  })

  test('is absent one minute before the grid starts', () => {
    expect(nowLine({ now: '2026-08-27T00:59:00.000Z', date, grid: LEDGER_GRID })).toBeNull()
  })

  test('is absent one minute after the grid ends', () => {
    expect(nowLine({ now: '2026-08-27T04:31:00.000Z', date, grid: LEDGER_GRID })).toBeNull()
  })

  test('places the middle of the grid halfway across', () => {
    // 11:45 JST, exactly half of 10:00–13:30
    expect(nowLine({ now: '2026-08-27T02:45:00.000Z', date, grid: LEDGER_GRID })).toEqual({
      label: '現在 11:45',
      time: '11:45',
      ratio: 0.5,
    })
  })

  test('is absent on a past day even at an in-grid wall time', () => {
    expect(
      nowLine({ now: '2026-08-27T02:00:00.000Z', date: '2026-08-28', grid: LEDGER_GRID }),
    ).toBeNull()
  })

  test('is absent on a future day even at an in-grid wall time', () => {
    expect(
      nowLine({ now: '2026-08-27T02:00:00.000Z', date: '2026-08-26', grid: LEDGER_GRID }),
    ).toBeNull()
  })

  test('compares days in Asia/Tokyo, not UTC', () => {
    // Same UTC date as the requested day, but already the next day in Tokyo.
    expect(
      nowLine({ now: '2026-08-27T15:00:00.000Z', date: '2026-08-27', grid: LEDGER_GRID }),
    ).toBeNull()
  })
})

describe('entry placement on the shared time axis', () => {
  test('columns cover the whole business grid in step-sized cells', () => {
    const labels = gridColumnLabels(LEDGER_GRID)
    expect(labels[0]).toBe('10:00')
    expect(labels.at(-1)).toBe('13:00')
    expect(labels).toHaveLength(7)
  })

  test('an entry starting on a grid step begins in that column', () => {
    expect(
      entryPlacement({
        startAt: '2026-08-27T02:00:00.000Z',
        endAt: '2026-08-27T03:00:00.000Z',
        grid: LEDGER_GRID,
      }),
    ).toEqual({ startColumn: 3, spanColumns: 2 })
  })

  test('an entry that starts before the grid is clamped to the first column', () => {
    expect(
      entryPlacement({
        startAt: '2026-08-27T00:30:00.000Z',
        endAt: '2026-08-27T01:30:00.000Z',
        grid: LEDGER_GRID,
      }),
    ).toEqual({ startColumn: 1, spanColumns: 1 })
  })

  test('an entry that ends after the grid is clamped to the last column', () => {
    expect(
      entryPlacement({
        // 13:00–14:00 JST: it starts in the last column and overhangs it.
        startAt: '2026-08-27T04:00:00.000Z',
        endAt: '2026-08-27T05:00:00.000Z',
        grid: LEDGER_GRID,
      }),
    ).toEqual({ startColumn: 7, spanColumns: 1 })
  })

  test('an entry entirely outside the grid has no placement', () => {
    expect(
      entryPlacement({
        startAt: '2026-08-27T10:00:00.000Z',
        endAt: '2026-08-27T11:00:00.000Z',
        grid: LEDGER_GRID,
      }),
    ).toBeNull()
    expect(
      entryPlacement({
        startAt: '2026-08-26T23:00:00.000Z',
        endAt: '2026-08-27T01:00:00.000Z',
        grid: LEDGER_GRID,
      }),
    ).toBeNull()
  })

  test('a zero-length entry still occupies one column', () => {
    expect(
      entryPlacement({
        startAt: '2026-08-27T02:00:00.000Z',
        endAt: '2026-08-27T02:00:00.000Z',
        grid: LEDGER_GRID,
      }),
    ).toEqual({ startColumn: 3, spanColumns: 1 })
  })
})

describe('the approved LEDGER-DAY geometry', () => {
  /** 7 columns of 30 minutes from 10:00, exactly as the approved mock draws. */
  const MOCK_GRID = { startMinutes: 10 * 60, endMinutes: 13 * 60 + 30, stepMinutes: 30 }

  test('heads the mock’s seven half-hour columns', () => {
    expect(gridColumnLabels(MOCK_GRID)).toEqual([
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '12:00',
      '12:30',
      '13:00',
    ])
  })

  test('places 11:08 where the mock places it, at .324 of the column area', () => {
    const line = nowLine({ now: '2026-08-27T02:08:00.000Z', date: '2026-08-27', grid: MOCK_GRID })
    expect(line?.label).toBe('現在 11:08')
    expect(line?.ratio).toBeCloseTo(0.324, 3)
  })
})
