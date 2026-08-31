import { describe, expect, it } from 'vitest'
import { analyticsRequestForSelection } from './AnalyticsPane'

const STORE_ID = 'd0000000-0000-4000-8000-000000000001'

describe('analyticsRequestForSelection', () => {
  it('取り消しの開始月を期間とキャッシュキーの両方へ含める', () => {
    const march = analyticsRequestForSelection(
      { tab: 'cancel', month: '2026-08', startMonth: '2026-03', storeId: STORE_ID },
      '2026-08-27',
    )
    const april = analyticsRequestForSelection(
      { tab: 'cancel', month: '2026-08', startMonth: '2026-04', storeId: STORE_ID },
      '2026-08-27',
    )

    expect(march.query).toMatchObject({ from: '2026-03-01', to: '2026-08-31' })
    expect(april.query).toMatchObject({ from: '2026-04-01', to: '2026-08-31' })
    expect(march.cacheKey).not.toBe(april.cacheKey)
  })

  it('トップは同じ月でも基準日が変われば別の期間として扱う', () => {
    const before = analyticsRequestForSelection(
      { tab: 'top', month: '2026-08', storeId: STORE_ID },
      '2026-08-27',
    )
    const after = analyticsRequestForSelection(
      { tab: 'top', month: '2026-08', storeId: STORE_ID },
      '2026-08-28',
    )

    expect(before.query).toMatchObject({ from: '2026-08-20', to: '2026-09-03' })
    expect(after.query).toMatchObject({ from: '2026-08-21', to: '2026-09-04' })
    expect(before.cacheKey).not.toBe(after.cacheKey)
  })
})
