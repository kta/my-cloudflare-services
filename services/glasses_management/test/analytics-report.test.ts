import { describe, expect, it } from 'vitest'
import { analyticsStoredMetrics, buildAnalyticsReport } from '../src/worker/domain/analytics-report'

describe('buildAnalyticsReport', () => {
  it('期間合算ヒストグラムから厳密中央値を返す', () => {
    const report = buildAnalyticsReport({
      metric: 'wait_time',
      from: '2026-08-01',
      to: '2026-08-02',
      granularity: 'day',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'wait_seconds_histogram', 'wait_seconds', 'hour:10:300', 1),
        row('2026-08-02', 'wait_seconds_histogram', 'wait_seconds', 'hour:11:480', 1),
      ],
    })

    expect(report.summary[0]?.value).toBe('390')
  })

  it('担当が未定と19件の再来率を常に null にする', () => {
    const report = buildAnalyticsReport({
      metric: 'staff',
      from: '2026-08-01',
      to: '2026-08-01',
      granularity: 'day',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'revisit_eligible', 'staff', 'unassigned', 20),
        row('2026-08-01', 'revisit_returning_90d', 'staff', 'unassigned', 10),
        row('2026-08-01', 'revisit_eligible', 'staff', 'staff-1', 19),
        row('2026-08-01', 'revisit_returning_90d', 'staff', 'staff-1', 10),
      ],
    })

    expect(report.suppressed).toBe(true)
    expect(
      report.series.flatMap((series) => series.points).map((point) => point.secondaryValue),
    ).toEqual([null, null])
  })

  it('staff snapshot名で担当を並べ、totalは出さずunassignedを最後にする', () => {
    const report = buildAnalyticsReport({
      metric: 'staff',
      from: '2026-08-01',
      to: '2026-08-01',
      granularity: 'day',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'receptions', 'staff', 'staff-b', 0, '鈴木 健'),
        row('2026-08-01', 'receptions', 'staff', 'staff-a', 1, '佐藤 美咲'),
        row('2026-08-01', 'receptions', 'staff', 'unassigned', 2, '担当が未定'),
        row('2026-08-01', 'receptions', 'total', '', 3, '合計'),
      ],
    })

    expect(report.series.map((series) => series.name)).toEqual([
      '佐藤 美咲',
      '鈴木 健',
      '担当が未定',
    ])
    expect(report.series.map((series) => series.points)).toEqual([
      [expect.objectContaining({ key: 'staff-a', label: '佐藤 美咲', value: 1 })],
      [expect.objectContaining({ key: 'staff-b', label: '鈴木 健', value: 0 })],
      [expect.objectContaining({ key: 'unassigned', label: '担当が未定', value: 2 })],
    ])
  })

  it('staffは日次snapshot名の安定した名前順で並べ、unassignedを最後にする', () => {
    const report = buildAnalyticsReport({
      metric: 'staff',
      from: '2026-08-01',
      to: '2026-08-01',
      granularity: 'day',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'receptions', 'staff', 'a-id', 1, '森 花子'),
        row('2026-08-01', 'receptions', 'staff', 'z-id', 1, '伊藤 美咲'),
        row('2026-08-01', 'receptions', 'staff', 'unassigned', 1, '担当が未定'),
      ],
    })

    expect(report.series.map((series) => series.name)).toEqual([
      '伊藤 美咲',
      '森 花子',
      '担当が未定',
    ])
  })

  it('source・来店回数・目的は期間合算した次元ごとの1点を返す', () => {
    const source = buildAnalyticsReport({
      metric: 'reservation_source',
      from: '2026-08-01',
      to: '2026-08-02',
      granularity: 'day',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'reservations', 'source', 'walkin', 2, 'ウォークイン'),
        row('2026-08-02', 'reservations', 'source', 'walkin', 3, 'ウォークイン'),
      ],
    })
    const visits = buildAnalyticsReport({
      metric: 'visit_frequency',
      from: '2026-08-01',
      to: '2026-08-02',
      granularity: 'day',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'receptions', 'visit_frequency', 'first', 1),
        row('2026-08-02', 'receptions', 'visit_frequency', 'first', 2),
      ],
    })
    const purpose = buildAnalyticsReport({
      metric: 'purpose',
      from: '2026-08-01',
      to: '2026-08-02',
      granularity: 'day',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'reservations', 'purpose', 'purpose-1', 4, '視力測定'),
        row('2026-08-02', 'reservations', 'purpose', 'purpose-1', 5, '視力測定'),
      ],
    })

    expect(source.series).toMatchObject([
      { name: 'ウォークイン', points: [{ key: 'walkin', label: 'ウォークイン', value: 5 }] },
    ])
    expect(visits.series).toMatchObject([
      { name: '初めて', points: [{ key: 'first', label: '初めて', value: 3 }] },
    ])
    expect(purpose.series).toMatchObject([
      { name: '視力測定', points: [{ key: 'purpose-1', label: '視力測定', value: 9 }] },
    ])
  })

  it('時間別予約数、closedの0点、future予約のpending除外を日次表だけから作る', () => {
    const report = buildAnalyticsReport({
      metric: 'reservation_count',
      from: '2026-08-01',
      to: '2026-08-03',
      granularity: 'hour',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'closed', 'total', '', 1, '定休日'),
        row('2026-08-02', 'closed', 'total', '', 0, '営業日'),
        row('2026-08-01', 'reservations', 'hour', '10', 2, '10時'),
        row('2026-08-02', 'reservations', 'hour', '10', 1, '10時'),
        row('2026-08-03', 'scheduled_reservations', 'total', '', 1, '予定総数'),
      ],
    })

    expect(report.series[0]?.points).toMatchObject([{ key: '10', label: '10時台', value: 3 }])
    expect(report.pendingDays).toBe(0)

    const days = buildAnalyticsReport({
      ...report,
      metric: 'overview',
      granularity: 'day',
      rows: reportRows(report),
    })
    expect(days.series[0]?.points).toMatchObject([
      { key: '2026-08-01', value: 0, isClosed: true },
      { key: '2026-08-02', value: 0, isClosed: false },
    ])
  })

  it('時間別予約数の最大は日別合計ではなく時間bucketから求める', () => {
    const report = buildAnalyticsReport({
      metric: 'reservation_count',
      from: '2026-08-01',
      to: '2026-08-02',
      granularity: 'hour',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'closed', 'total', '', 0, '営業日'),
        row('2026-08-02', 'closed', 'total', '', 0, '営業日'),
        row('2026-08-01', 'reservations', 'total', '', 10, '合計'),
        row('2026-08-02', 'reservations', 'total', '', 10, '合計'),
        row('2026-08-01', 'reservations', 'hour', '10', 3, '10時台'),
        row('2026-08-02', 'reservations', 'hour', '10', 2, '10時台'),
        row('2026-08-01', 'reservations', 'hour', '11', 4, '11時台'),
        row('2026-08-02', 'reservations', 'hour', '11', 3, '11時台'),
      ],
    })

    expect(report.summary[2]).toMatchObject({ label: '最大', value: '7', unit: '件' })
    expect(report.series[0]?.points).toMatchObject([
      { key: '10', label: '10時台', value: 5 },
      { key: '11', label: '11時台', value: 7 },
    ])
  })

  it('トップの15日グラフ外も週のまとめ専用行から数える', () => {
    const mainRows = [
      row('2026-08-20', 'reservations', 'total', '', 10, '合計'),
      row('2026-08-21', 'reservations', 'total', '', 10, '合計'),
      row('2026-08-22', 'reservations', 'total', '', 9, '合計'),
      row('2026-08-23', 'reservations', 'total', '', 9, '合計'),
      row('2026-08-24', 'reservations', 'total', '', 72, '合計'),
      row('2026-08-31', 'reservations', 'total', '', 42, '合計'),
    ]
    const report = buildAnalyticsReport({
      metric: 'overview',
      from: '2026-08-20',
      to: '2026-09-03',
      granularity: 'day',
      countBy: 'visit_date',
      rows: mainRows,
      overviewRows: [
        row('2026-08-17', 'reservations', 'total', '', 10, '合計'),
        row('2026-08-18', 'reservations', 'total', '', 10, '合計'),
        row('2026-08-19', 'reservations', 'total', '', 10, '合計'),
        ...mainRows,
      ],
    })

    expect(report.summary).toMatchObject([
      { label: '先週', value: '68' },
      { label: '今週', value: '72' },
      { label: '来週', value: '42' },
    ])
    expect(report.series[0]?.points.some((point) => point.key === '2026-08-17')).toBe(false)
  })

  it('全期間と時間別の待ち秒中央値をexactに返し、481秒を超過にする', () => {
    const report = buildAnalyticsReport({
      metric: 'wait_time',
      from: '2026-08-01',
      to: '2026-08-02',
      granularity: 'hour',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'wait_seconds_histogram', 'wait_seconds', 'hour:10:480', 1, '10時 480秒'),
        row('2026-08-02', 'wait_seconds_histogram', 'wait_seconds', 'hour:10:481', 1, '10時 481秒'),
        row('2026-08-01', 'wait_seconds_histogram', 'wait_seconds', 'hour:11:300', 1, '11時 300秒'),
      ],
    })

    expect(report.summary[0]?.value).toBe('480')
    expect(report.series[0]?.points).toMatchObject([
      { key: '10', label: '10時台', value: 480.5, isOverTarget: true },
      { key: '11', label: '11時台', value: 300, isOverTarget: false },
    ])
  })

  it('本体APIだけで描けるsummaryと取消月率を日次表から返す', () => {
    const count = buildAnalyticsReport({
      metric: 'reservation_count',
      from: '2026-08-01',
      to: '2026-08-02',
      granularity: 'day',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'closed', 'total', '', 0, '営業日'),
        row('2026-08-02', 'closed', 'total', '', 0, '営業日'),
        row('2026-08-01', 'reservations', 'total', '', 4, '合計'),
        row('2026-08-02', 'reservations', 'total', '', 6, '合計'),
      ],
    })
    expect(count.summary).toMatchObject([
      { label: '合計', value: '10', unit: '件' },
      { label: '1日あたり', value: '5.0', unit: '件' },
      { label: '最大', value: '6', unit: '件' },
    ])

    const cancellation = buildAnalyticsReport({
      metric: 'cancellation',
      from: '2026-08-01',
      to: '2026-09-01',
      granularity: 'month',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'scheduled_reservations', 'total', '', 20, '予定総数'),
        row('2026-09-01', 'scheduled_reservations', 'total', '', 20, '予定総数'),
        row('2026-08-01', 'cancellations', 'cancellation_category', 'web', 2, 'Webからの取消'),
        row(
          '2026-09-01',
          'cancellations',
          'cancellation_category',
          'customer',
          4,
          'お客様のご都合',
        ),
      ],
    })
    expect(
      cancellation.series.flatMap((series) => series.points).map((point) => point.secondaryValue),
    ).toEqual([0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.1, 0.2, 0.1, 0.2])
    expect(cancellation.series.map((series) => series.name)).toEqual([
      'お客様のご都合',
      '店舗の都合',
      '予約の重複',
      'ご来店がなかった',
      'Webからの取消',
    ])
    expect(
      cancellation.series
        .flatMap((series) => series.points)
        .map((point) => ({
          key: point.key,
          label: point.label,
        })),
    ).toEqual([
      { key: '2026-08', label: '8月' },
      { key: '2026-09', label: '9月' },
      { key: '2026-08', label: '8月' },
      { key: '2026-09', label: '9月' },
      { key: '2026-08', label: '8月' },
      { key: '2026-09', label: '9月' },
      { key: '2026-08', label: '8月' },
      { key: '2026-09', label: '9月' },
      { key: '2026-08', label: '8月' },
      { key: '2026-09', label: '9月' },
    ])
    expect(cancellation.summary.map((item) => item.label)).toEqual([
      '取消率',
      '最も高い月',
      '該当内訳',
    ])

    const wait = buildAnalyticsReport({
      metric: 'wait_time',
      from: '2026-08-01',
      to: '2026-08-01',
      granularity: 'hour',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'wait_seconds_histogram', 'wait_seconds', 'hour:10:481', 1, '10時 481秒'),
      ],
      comparisonRows: [
        row('2026-07-01', 'wait_seconds_histogram', 'wait_seconds', 'hour:10:480', 1, '10時 480秒'),
      ],
    })
    expect(wait.summary).toMatchObject([
      { label: '待ち時間中央値', value: '481' },
      { label: '前の月', value: '480' },
      { label: '受付', value: '0' },
    ])
  })

  it('取消は要求した全月を正式5分類で補完し、分母20未満の月を最高率から除く', () => {
    const report = buildAnalyticsReport({
      metric: 'cancellation',
      from: '2026-03-01',
      to: '2026-08-31',
      granularity: 'month',
      countBy: 'visit_date',
      rows: [
        row('2026-03-01', 'scheduled_reservations', 'total', '', 10, '予定総数'),
        row('2026-03-01', 'cancellations', 'cancellation_category', 'customer', 9),
        row('2026-08-01', 'scheduled_reservations', 'total', '', 20, '予定総数'),
        row('2026-08-01', 'cancellations', 'cancellation_category', 'web', 2),
      ],
    })

    expect(report.series.map((series) => series.name)).toEqual([
      'お客様のご都合',
      '店舗の都合',
      '予約の重複',
      'ご来店がなかった',
      'Webからの取消',
    ])
    for (const series of report.series) {
      expect(series.points).toHaveLength(6)
      expect(series.points.map((point) => point.key)).toEqual([
        '2026-03',
        '2026-04',
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
      ])
    }
    expect(report.series[0]?.points[0]).toMatchObject({ value: 9, secondaryValue: null })
    expect(report.series[4]?.points[5]).toMatchObject({ value: 2, secondaryValue: 0.1 })
    expect(report.summary[1]).toMatchObject({ label: '最も高い月', value: '2026-08' })
  })

  it('タブごとの表示に必要な日次metricだけを選ぶ', () => {
    expect(analyticsStoredMetrics('overview', 'visit_date')).toEqual([
      'closed',
      'scheduled_reservations',
      'reservations',
    ])
    expect(analyticsStoredMetrics('reservation_source', 'received_date')).toEqual([
      'closed',
      'scheduled_reservations',
      'reservations_received',
    ])
    expect(analyticsStoredMetrics('staff', 'visit_date')).toEqual([
      'closed',
      'scheduled_reservations',
      'receptions',
      'revisit_eligible',
      'revisit_returning_90d',
    ])
    expect(analyticsStoredMetrics('wait_time', 'visit_date')).toEqual([
      'closed',
      'scheduled_reservations',
      'wait_seconds_histogram',
      'receptions',
    ])
  })

  it('未来予約を月合計には含めるが、集計済み営業日の1日平均には混ぜない', () => {
    const report = buildAnalyticsReport({
      metric: 'reservation_count',
      from: '2026-08-01',
      to: '2026-08-31',
      granularity: 'day',
      countBy: 'visit_date',
      rows: [
        row('2026-08-01', 'closed', 'total', '', 0, '営業日'),
        row('2026-08-01', 'reservations', 'total', '', 4, '合計'),
        row('2026-08-31', 'reservations', 'total', '', 100, '合計'),
      ],
    })

    expect(report.summary.slice(0, 2)).toMatchObject([
      { label: '合計', value: '104' },
      { label: '1日あたり', value: '4.0' },
    ])
    expect(report.pendingDays).toBe(30)
  })
})

function row(
  date: string,
  metric: string,
  dimension: string,
  dimensionKey: string,
  value: number,
  dimensionLabel = '',
) {
  return { date, metric, dimension, dimensionKey, dimensionLabel, value }
}

function reportRows(_report: unknown) {
  return [
    row('2026-08-01', 'closed', 'total', '', 1, '定休日'),
    row('2026-08-02', 'closed', 'total', '', 0, '営業日'),
  ]
}
