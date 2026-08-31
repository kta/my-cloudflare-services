/**
 * 分析の暦と目安の境界。期間の解決は JST の暦日で行い、目安の超過判定が
 * 「ちょうど」で倒れないことをここで固定する。
 *
 * **基準時刻はすべて引数で渡す**（`Date.now()` を 1 度も呼ばない）。
 * 8 タブの応答そのものは analytics.integration.test.ts に分ける。
 */

import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_TARGETS,
  businessDaysIn,
  clampRange,
  datesInRange,
  formatSeconds,
  isOverCancellationTarget,
  isOverWaitTarget,
  isRevisitWithinWindow,
  jstWeekday,
  MAX_RANGE_DAYS,
  medianOf,
  pendingDaysIn,
  rateOrNull,
  resolveRange,
  roundRate1,
  SMALL_SAMPLE_THRESHOLD,
  spanDays,
  weekBuckets,
  weightedMedian,
} from '../src/worker/domain/analytics'

/** その期間の「火曜だけ定休」の閉店表を作る。臨時休業は追加で足す。 */
function closedMap(
  from: string,
  to: string,
  closedWeekday: number,
  extraClosed: readonly string[] = [],
): Map<string, boolean> {
  const map = new Map<string, boolean>()
  for (const date of datesInRange(from, to)) {
    map.set(date, jstWeekday(date) === closedWeekday || extraClosed.includes(date))
  }
  return map
}

describe('期間の解決', () => {
  it('2026-08-27T14:59:59.999Z は JST の 2026-08-27 に落ちる', () => {
    const range = resolveRange('around', {}, '2026-08-27T14:59:59.999Z')
    expect(range).toEqual({ from: '2026-08-20', to: '2026-09-03' })
  })

  it('2026-08-27T15:00:00.000Z は JST の 2026-08-28 に落ちる（日跨ぎ）', () => {
    const range = resolveRange('around', {}, '2026-08-27T15:00:00.000Z')
    expect(range).toEqual({ from: '2026-08-21', to: '2026-09-04' })
  })

  it('2025-12-31T15:00:00.000Z は JST の 2026-01-01 に落ちる（年跨ぎ）', () => {
    const range = resolveRange('around', {}, '2025-12-31T15:00:00.000Z')
    expect(range).toEqual({ from: '2025-12-25', to: '2026-01-08' })
  })

  it('2026年8月の単月は 2026-08-01 から 2026-08-31 の 31 日', () => {
    const range = resolveRange('month', { from: '2026-08' }, '2026-08-27T00:00:00.000Z')
    expect(range).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(spanDays(range.from, range.to)).toBe(31)
  })

  it('2026年2月の単月は 28 日、2028年2月は 29 日（うるう年）', () => {
    const common = resolveRange('month', { from: '2026-02' }, '2026-02-10T00:00:00.000Z')
    expect(common).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(spanDays(common.from, common.to)).toBe(28)

    const leap = resolveRange('month', { from: '2028-02' }, '2028-02-10T00:00:00.000Z')
    expect(leap).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(spanDays(leap.from, leap.to)).toBe(29)
  })

  it('トップの前後7日は 2026-08-27 を中心に 2026-08-20 から 2026-09-03 の 15 日（月跨ぎ）', () => {
    const range = resolveRange('around', {}, '2026-08-27T03:00:00.000Z')
    expect(range).toEqual({ from: '2026-08-20', to: '2026-09-03' })
    expect(spanDays(range.from, range.to)).toBe(15)
  })

  it('週の区切りは月曜始まりで、先週 8/17〜8/23・今週 8/24〜8/30・来週 8/31〜9/6 になる', () => {
    expect(weekBuckets('2026-08-27T03:00:00.000Z')).toEqual({
      last: { from: '2026-08-17', to: '2026-08-23' },
      current: { from: '2026-08-24', to: '2026-08-30' },
      next: { from: '2026-08-31', to: '2026-09-06' },
    })
  })

  it('取り消しのレンジ 2026-03 から 2026-08 は 2026-03-01 から 2026-08-31 になる', () => {
    expect(
      resolveRange('range', { from: '2026-03', to: '2026-08' }, '2026-08-27T03:00:00.000Z'),
    ).toEqual({ from: '2026-03-01', to: '2026-08-31' })
  })

  it('2026-01-01 から 2027-02-04 は 400 日で通り、2027-02-05 は 401 日で 400 を返す', () => {
    expect(spanDays('2026-01-01', '2027-02-04')).toBe(MAX_RANGE_DAYS)
    expect(clampRange('2026-01-01', '2027-02-04')).toEqual({
      from: '2026-01-01',
      to: '2027-02-04',
    })

    expect(spanDays('2026-01-01', '2027-02-05')).toBe(401)
    const clamped = clampRange('2026-01-01', '2027-02-05')
    expect(clamped).toEqual({ from: '2026-01-01', to: '2027-02-04' })
    expect(spanDays(clamped.from, clamped.to)).toBe(MAX_RANGE_DAYS)
  })
})

describe('営業日数', () => {
  it('2026年8月は暦 31 日から火曜 4 日を引いて 27 日（AC-ANA-21 の 26 は 8/31 を数え落としている）', () => {
    const dates = datesInRange('2026-08-01', '2026-08-31')
    expect(dates).toHaveLength(31)
    expect(dates.filter((date) => jstWeekday(date) === 2)).toEqual([
      '2026-08-04',
      '2026-08-11',
      '2026-08-18',
      '2026-08-25',
    ])
    expect(businessDaysIn(dates, closedMap('2026-08-01', '2026-08-31', 2))).toBe(27)
  })

  it('臨時休業の 1 日も分母から抜く', () => {
    const dates = datesInRange('2026-08-01', '2026-08-31')
    // 8/13 は木曜（定休ではない）。臨時休業にした 1 日だけ減る。
    expect(businessDaysIn(dates, closedMap('2026-08-01', '2026-08-31', 2, ['2026-08-13']))).toBe(26)
    // 行が無い日（未集計）は営業日に数えない。
    expect(businessDaysIn(dates, new Map())).toBe(0)
    expect(pendingDaysIn(dates, new Set(dates.slice(0, 29)))).toBe(2)
  })
})

describe('目安の境界', () => {
  it('お待ち時間 480 秒（8分ちょうど）は超過にしない', () => {
    expect(isOverWaitTarget(480, ANALYTICS_TARGETS)).toBe(false)
  })

  it('お待ち時間 481 秒（8分1秒）は超過にする', () => {
    expect(isOverWaitTarget(481, ANALYTICS_TARGETS)).toBe(true)
    expect(formatSeconds(481)).toBe('8分1秒')
    expect(formatSeconds(0)).toBe('0分0秒')
    expect(formatSeconds(40)).toBe('0分40秒')
  })

  it('取消率 10.0% は超過にしない', () => {
    expect(roundRate1(0.1)).toBe(10)
    expect(isOverCancellationTarget(0.1, ANALYTICS_TARGETS)).toBe(false)
  })

  it('取消率 10.04% は 10.0% に丸まるので超過にしない', () => {
    expect(roundRate1(0.1004)).toBe(10)
    expect(isOverCancellationTarget(0.1004, ANALYTICS_TARGETS)).toBe(false)
  })

  it('取消率 10.05% は 10.1% に丸まるので超過にする', () => {
    expect(roundRate1(0.1005)).toBe(10.1)
    expect(isOverCancellationTarget(0.1005, ANALYTICS_TARGETS)).toBe(true)
  })
})

describe('再来の窓', () => {
  it('来店から 90 日ちょうどの再来は数える。91 日目は数えない', () => {
    expect(isRevisitWithinWindow('2026-06-01', '2026-08-30', ANALYTICS_TARGETS)).toBe(true)
    expect(isRevisitWithinWindow('2026-06-01', '2026-08-31', ANALYTICS_TARGETS)).toBe(false)
    // 同じ日の 2 度目は「再来」ではない。
    expect(isRevisitWithinWindow('2026-06-01', '2026-06-01', ANALYTICS_TARGETS)).toBe(false)
  })
})

describe('中央値と小標本抑制', () => {
  it('中央値は平均ではなく、偶数個は中央 2 つの平均になる', () => {
    expect(medianOf([])).toBeNull()
    expect(medianOf([300, 480, 4800])).toBe(480)
    expect(medianOf([300, 400, 500, 600])).toBe(450)
    expect(
      weightedMedian([
        { value: 300, weight: 1 },
        { value: 520, weight: 9 },
      ]),
    ).toBe(520)
  })

  it('分母 20 件ちょうどは率を出し、19 件は伏せる', () => {
    expect(SMALL_SAMPLE_THRESHOLD).toBe(20)
    expect(rateOrNull(10, 20)).toBe(0.5)
    expect(rateOrNull(10, 19)).toBeNull()
    expect(rateOrNull(0, 0)).toBeNull()
  })
})
