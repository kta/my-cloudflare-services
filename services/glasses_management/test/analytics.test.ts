import { describe, expect, it } from 'vitest'
import {
  hasBackwardRevisit,
  histogramMedian,
  isOverCancellationTarget,
  isOverWaitTarget,
} from '../src/worker/domain/analytics'

describe('analytics exact calculations', () => {
  it('keeps an eight-minute wait within target and one second over it outside', () => {
    expect(isOverWaitTarget(480)).toBe(false)
    expect(isOverWaitTarget(481)).toBe(true)
  })

  it('rounds cancellation percentage before testing the displayed 10 percent target', () => {
    expect(isOverCancellationTarget(10.04)).toBe(false)
    expect(isOverCancellationTarget(10.05)).toBe(true)
  })

  it('calculates an exact odd and even median from aggregated histogram buckets', () => {
    expect(
      histogramMedian([
        { key: 'hour:10:120', value: 1 },
        { key: 'hour:11:480', value: 2 },
      ]),
    ).toBe(480)
    expect(
      histogramMedian([
        { key: 'hour:10:60', value: 1 },
        { key: 'hour:11:600', value: 1 },
      ]),
    ).toBe(330)
  })

  it('does not substitute a weighted daily median for the full histogram', () => {
    expect(
      histogramMedian([
        { key: 'hour:10:0', value: 100 },
        { key: 'hour:11:600', value: 1 },
      ]),
    ).toBe(0)
  })

  it('counts only completed visits 1 through 90 days before the current visit', () => {
    expect(hasBackwardRevisit('2026-08-31', ['2026-06-02'])).toBe(true)
    expect(hasBackwardRevisit('2026-08-31', ['2026-06-01'])).toBe(false)
    expect(hasBackwardRevisit('2026-08-31', ['2026-09-01'])).toBe(false)
  })
})
