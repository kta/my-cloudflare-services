import { describe, expect, it } from 'vitest'
import { mapAnalyticsReport } from './presenter'

describe('mapAnalyticsReport', () => {
  it('担当者の未定を末尾にし、secondaryValue nullを再来率—へ写す', () => {
    const mapped = mapAnalyticsReport('staff', {
      metric: 'staff',
      from: '2026-08-01',
      to: '2026-08-31',
      granularity: 'day',
      countBy: 'visit_date',
      target: null,
      suppressed: false,
      businessDays: 27,
      pendingDays: 0,
      summary: [],
      series: [
        {
          name: '担当が未定',
          pattern: 'hatch',
          points: [
            {
              key: 'unassigned',
              label: '担当が未定',
              value: 9,
              secondaryValue: null,
              isClosed: false,
              isOverTarget: false,
            },
          ],
        },
        {
          name: '佐藤 美咲',
          pattern: 'solid',
          points: [
            {
              key: 'staff-1',
              label: '佐藤 美咲',
              value: 78,
              secondaryValue: 0.68,
              isClosed: false,
              isOverTarget: false,
            },
          ],
        },
      ],
    })
    expect(mapped.tab).toBe('staff')
    if (mapped.tab !== 'staff') throw new Error('staff expected')
    expect(mapped.staff.map((item) => item.name)).toEqual(['佐藤 美咲', '担当が未定'])
    expect(mapped.staff.at(-1)?.returnRate).toBe('—')
  })

  it('トップの週summaryから件数と週の期間を組み立てる', () => {
    const mapped = mapAnalyticsReport('top', {
      metric: 'overview',
      from: '2026-08-20',
      to: '2026-09-03',
      granularity: 'day',
      countBy: 'visit_date',
      target: null,
      suppressed: false,
      businessDays: 13,
      pendingDays: 2,
      summary: [
        { label: '先週', value: '68', unit: '件', isOverTarget: false },
        { label: '今週', value: '72', unit: '件', isOverTarget: false },
        { label: '来週', value: '42', unit: '件', isOverTarget: false },
      ],
      series: [
        {
          name: '予約数',
          pattern: 'solid',
          points: [
            {
              key: '2026-08-20',
              label: '2026-08-20',
              value: 12,
              secondaryValue: null,
              isClosed: false,
              isOverTarget: false,
            },
          ],
        },
      ],
    })

    expect(mapped.tab).toBe('top')
    if (mapped.tab !== 'top') throw new Error('top expected')
    expect(mapped.points[0]?.label).toBe('8/20')
    expect(mapped.weeks).toEqual([
      { label: '先週', period: '8月17日〜8月23日', reservations: '68件' },
      { label: '今週', period: '8月24日〜8月30日', reservations: '72件' },
      { label: '来週', period: '8月31日〜9月6日', reservations: '42件' },
    ])
  })

  it('待ち時間の秒を分秒へ、予約入口を案Bの4区分と3つのまとめへ写す', () => {
    const wait = mapAnalyticsReport('wait', {
      metric: 'wait_time',
      from: '2026-08-01',
      to: '2026-08-31',
      granularity: 'hour',
      countBy: 'received_date',
      target: 480,
      suppressed: false,
      businessDays: 27,
      pendingDays: 0,
      summary: [
        { label: '待ち時間中央値', value: '520', unit: '秒', isOverTarget: true },
        { label: '前の月', value: '440', unit: '秒', isOverTarget: false },
        { label: '母数', value: '328', unit: '件', isOverTarget: false },
      ],
      series: [
        {
          name: '中央値',
          pattern: 'solid',
          points: [
            {
              key: 'hour:14:800',
              label: '14時台',
              value: 800,
              secondaryValue: null,
              isClosed: false,
              isOverTarget: true,
            },
          ],
        },
      ],
    })
    expect(wait.tab).toBe('wait')
    if (wait.tab !== 'wait') throw new Error('wait expected')
    expect(wait.median).toBe('8分40秒')
    expect(wait.previousMedian).toBe('7分20秒')
    expect(wait.sample).toBe('2026年8月・受付 328件')
    expect(wait.hourly[0]?.display).toBe('13:20')
    const source = mapAnalyticsReport('source', {
      metric: 'reservation_source',
      from: '2026-08-01',
      to: '2026-08-31',
      granularity: 'day',
      countBy: 'visit_date',
      target: null,
      suppressed: false,
      businessDays: 27,
      pendingDays: 0,
      summary: [],
      series: [
        {
          name: '電話',
          pattern: 'solid',
          points: [
            {
              key: 'phone',
              label: 'お電話',
              value: 136,
              secondaryValue: null,
              isClosed: false,
              isOverTarget: false,
            },
          ],
        },
      ],
    })
    expect(source.tab).toBe('source')
    if (source.tab !== 'source') throw new Error('source expected')
    expect(source.summary).toHaveLength(3)
    expect(source.definition).toContain('ご予約 136件を数えます')
    expect(source.summary.map((item) => item.label)).toEqual([
      '8月の合計',
      '最も多い入口',
      'その割合',
    ])
  })

  it('取消の正式5語と色・地模様の識別をキーから一定にする', () => {
    const mapped = mapAnalyticsReport('cancel', {
      metric: 'cancellation',
      from: '2026-03-01',
      to: '2026-08-31',
      granularity: 'month',
      countBy: 'visit_date',
      target: 10,
      suppressed: false,
      businessDays: 0,
      pendingDays: 0,
      summary: [],
      series: [
        {
          name: 'お客様のご都合',
          pattern: 'solid',
          points: [
            {
              key: '2026-03',
              label: '3月',
              value: 2,
              secondaryValue: 0.01,
              isClosed: false,
              isOverTarget: false,
            },
          ],
        },
        {
          name: '店舗の都合',
          pattern: 'solid',
          points: [
            {
              key: '2026-03',
              label: '3月',
              value: 2,
              secondaryValue: 0.01,
              isClosed: false,
              isOverTarget: false,
            },
          ],
        },
        {
          name: '予約の重複',
          pattern: 'solid',
          points: [
            {
              key: '2026-03',
              label: '3月',
              value: 2,
              secondaryValue: 0.01,
              isClosed: false,
              isOverTarget: false,
            },
          ],
        },
        {
          name: 'ご来店がなかった',
          pattern: 'solid',
          points: [
            {
              key: '2026-03',
              label: '3月',
              value: 2,
              secondaryValue: 0.01,
              isClosed: false,
              isOverTarget: false,
            },
          ],
        },
        {
          name: 'Webからの取消',
          pattern: 'solid',
          points: [
            {
              key: '2026-03',
              label: '3月',
              value: 2,
              secondaryValue: 0.01,
              isClosed: false,
              isOverTarget: false,
            },
          ],
        },
      ],
    })

    expect(mapped.tab).toBe('cancel')
    if (mapped.tab !== 'cancel') throw new Error('cancel expected')
    expect(mapped.series.map(({ name, tone, pattern }) => ({ name, tone, pattern }))).toEqual([
      { name: 'お客様のご都合', tone: 'pine', pattern: 'solid' },
      { name: '店舗の都合', tone: 'walkin', pattern: 'hatch' },
      { name: '予約の重複', tone: 'pine', pattern: 'dot' },
      { name: 'ご来店がなかった', tone: 'danger', pattern: 'hatch' },
      { name: 'Webからの取消', tone: 'web', pattern: 'dot' },
    ])
    expect(mapped.definition).toBe(
      '2026年3月〜8月／ご来店予定だった予約（取り消し・ご来店なしを含む）を分母に数えます',
    )
  })

  it('予約数のまとめを選択月と粒度に合わせたモックの文言へ写す', () => {
    const mapped = mapAnalyticsReport('count', {
      metric: 'reservation_count',
      from: '2026-08-01',
      to: '2026-08-31',
      granularity: 'day',
      countBy: 'visit_date',
      target: null,
      suppressed: false,
      businessDays: 27,
      pendingDays: 0,
      summary: [
        { label: '合計', value: '320', unit: '件', isOverTarget: false },
        { label: '1日あたり', value: '11.9', unit: '件', isOverTarget: false },
        { label: '最大', value: '18', unit: '件', isOverTarget: false },
      ],
      series: [
        {
          name: '件数',
          pattern: 'solid',
          points: [
            {
              key: '2026-08-15',
              label: '2026-08-15',
              value: 18,
              secondaryValue: null,
              isClosed: false,
              isOverTarget: false,
            },
          ],
        },
      ],
    })

    expect(mapped.tab).toBe('count')
    if (mapped.tab !== 'count') throw new Error('count expected')
    expect(mapped.definition).toContain('火曜（4・11・18・25日）の4日を除く営業日27日')
    expect(mapped.summary).toEqual([
      { label: '8月の合計', value: '320', unit: '件', isOverTarget: false },
      { label: '1日あたり', value: '11.9', unit: '件', isOverTarget: false },
      { label: '最も多い日', value: '8月15日', unit: '18件', isOverTarget: false },
    ])
  })

  it('最高取消率は小数1桁の表示値で10%超過を判定する', () => {
    const mapRate = (rate: number) =>
      mapAnalyticsReport('cancel', {
        metric: 'cancellation',
        from: '2026-08-01',
        to: '2026-08-31',
        granularity: 'month',
        countBy: 'visit_date',
        target: 10,
        suppressed: false,
        businessDays: 0,
        pendingDays: 0,
        summary: [],
        series: [
          {
            name: 'お客様のご都合',
            pattern: 'solid',
            points: [
              {
                key: '2026-08',
                label: '8月',
                value: 1,
                secondaryValue: rate,
                isClosed: false,
                isOverTarget: false,
              },
            ],
          },
        ],
      })

    const roundedDown = mapRate(0.1004)
    const roundedUp = mapRate(0.1005)
    if (roundedDown.tab !== 'cancel' || roundedUp.tab !== 'cancel')
      throw new Error('cancel expected')
    expect(roundedDown.summary[1]).toMatchObject({
      value: '10.0',
      isOverTarget: false,
      unit: expect.stringContaining('目安内'),
    })
    expect(roundedUp.summary[1]).toMatchObject({
      value: '10.1',
      isOverTarget: true,
      unit: expect.stringContaining('目安を超過'),
    })
  })

  it('0.5秒の厳密中央値を分秒と時刻で桁落ちさせない', () => {
    const mapped = mapAnalyticsReport('wait', {
      metric: 'wait_time',
      from: '2026-08-01',
      to: '2026-08-31',
      granularity: 'hour',
      countBy: 'visit_date',
      target: 480,
      suppressed: false,
      businessDays: 1,
      pendingDays: 0,
      summary: [{ label: '待ち時間中央値', value: '480.5', unit: '秒', isOverTarget: true }],
      series: [
        {
          name: '中央値',
          pattern: 'solid',
          points: [
            {
              key: '10',
              label: '10時台',
              value: 480.5,
              secondaryValue: null,
              isClosed: false,
              isOverTarget: true,
            },
          ],
        },
      ],
    })

    if (mapped.tab !== 'wait') throw new Error('wait expected')
    expect(mapped.median).toBe('8分0.5秒')
    expect(mapped.hourly[0]?.display).toBe('8:00.5')
  })
})
