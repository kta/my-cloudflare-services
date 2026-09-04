import type { AnalyticsReport } from '@app/contracts'
import type { AnalyticsPresentationReport } from './AnalyticsScreen'
import type { ChartPattern, ChartSeries, ChartTone } from './charts'

const toneFor = (name: string): ChartTone =>
  /Web|web/.test(name)
    ? 'web'
    : /無断|取消|超過/.test(name)
      ? 'danger'
      : /店頭|ウォーク/.test(name)
        ? 'walkin'
        : 'pine'

function chartSeries(report: AnalyticsReport): ChartSeries[] {
  return report.series.map((series) => ({ ...series, tone: toneFor(series.name) }))
}

const cancellationStyle: Record<string, { tone: ChartTone; pattern: ChartPattern }> = {
  お客様のご都合: { tone: 'pine', pattern: 'solid' },
  店舗の都合: { tone: 'walkin', pattern: 'hatch' },
  予約の重複: { tone: 'pine', pattern: 'dot' },
  ご来店がなかった: { tone: 'danger', pattern: 'hatch' },
  Webからの取消: { tone: 'web', pattern: 'dot' },
}

function dateAt(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1))
}

function dateString(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: string, days: number) {
  const next = dateAt(date)
  next.setUTCDate(next.getUTCDate() + days)
  return dateString(next)
}

function weekPeriod(center: string, offset: -1 | 0 | 1) {
  const current = dateAt(center)
  const mondayOffset = (current.getUTCDay() + 6) % 7
  current.setUTCDate(current.getUTCDate() - mondayOffset + offset * 7)
  const end = new Date(current)
  end.setUTCDate(end.getUTCDate() + 6)
  const format = (date: Date) => `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
  return `${format(current)}〜${format(end)}`
}

function displayDate(label: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label)
  return matched ? `${Number(matched[2])}/${Number(matched[3])}` : label
}

function monthLabel(date: string) {
  return `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月`
}

function sameMonthDefinition(report: AnalyticsReport) {
  const basis = report.countBy === 'received_date' ? '受付日' : 'ご来店日'
  return `${monthLabel(report.from)}／${basis}でかぞえます`
}

function stripPercent(value: string) {
  return value.replace(/%$/, '')
}

function weekdayDates(from: string, to: string, weekday: number) {
  const dates: number[] = []
  for (let day = dateAt(from); day <= dateAt(to); day.setUTCDate(day.getUTCDate() + 1))
    if (day.getUTCDay() === weekday) dates.push(day.getUTCDate())
  return dates
}

function minutes(seconds: number) {
  const minute = Math.floor(seconds / 60)
  const second = seconds % 60
  return `${minute}分${second === 0 ? '' : `${second}秒`}`
}

function clock(seconds: number) {
  const remainder = Math.round(((seconds % 60) + Number.EPSILON) * 10) / 10
  const displayed = Number.isInteger(remainder)
    ? String(remainder).padStart(2, '0')
    : remainder.toFixed(1).padStart(4, '0')
  return `${Math.floor(seconds / 60)}:${displayed}`
}

export function mapAnalyticsReport(
  tab: AnalyticsPresentationReport['tab'],
  report: AnalyticsReport,
): AnalyticsPresentationReport {
  const series = chartSeries(report)
  const summary = report.summary
  if (tab === 'source' || tab === 'visits' || tab === 'purpose') {
    const total = series
      .flatMap((entry) => entry.points)
      .reduce((sum, point) => sum + point.value, 0)
    const highest = series
      .flatMap((entry) => entry.points)
      .sort((left, right) => right.value - left.value)[0]
    const labels =
      tab === 'source'
        ? [`${Number(report.from.slice(5, 7))}月の合計`, '最も多い入口']
        : tab === 'visits'
          ? [`${Number(report.from.slice(5, 7))}月の合計`, '最も多い回数帯']
          : [`${Number(report.from.slice(5, 7))}月の合計`, '最も多い目的']
    const derived = [
      { label: labels[0] ?? '合計', value: String(total), unit: '件', isOverTarget: false },
      {
        label: labels[1] ?? '最多',
        value: highest?.label ?? '—',
        unit: highest ? `${highest.value}件` : '',
        isOverTarget: false,
      },
      {
        label: 'その割合',
        value: total > 0 && highest ? ((highest.value / total) * 100).toFixed(1) : '—',
        unit: '%',
        isOverTarget: false,
      },
    ]
    return {
      tab,
      definition: `${monthLabel(report.from)}／${report.countBy === 'received_date' ? '受付日' : 'ご来店日'}を基準に、${tab === 'visits' ? '受付' : '取消を除くご予約'} ${total}件を数えます`,
      series,
      summary: derived,
      pendingDays: report.pendingDays,
    }
  }
  if (tab === 'top')
    return {
      tab,
      title: '予約の入り具合',
      definition: '本日を中心に前後7日／件数・火曜は定休日です',
      points:
        series[0]?.points.map((point) => ({ ...point, label: displayDate(point.label) })) ?? [],
      todayLabel: displayDate(addDays(report.from, 7)),
      pendingDays: report.pendingDays,
      weeks: (['先週', '今週', '来週'] as const).map((label, index) => {
        const item = summary.find((entry) => entry.label === label)
        return {
          label,
          period: weekPeriod(addDays(report.from, 7), (index - 1) as -1 | 0 | 1),
          reservations: item?.value ? `${item.value}件` : '—',
        }
      }),
    }
  if (tab === 'count') {
    const points =
      series[0]?.points.map((point) => ({
        ...point,
        label:
          report.granularity === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(point.label)
            ? String(Number(point.label.slice(8, 10)))
            : displayDate(point.label),
      })) ?? []
    const maximum = points.reduce<(typeof points)[number] | undefined>(
      (best, point) => (!best || point.value > best.value ? point : best),
      undefined,
    )
    const maximumLabel =
      report.granularity === 'day'
        ? '最も多い日'
        : report.granularity === 'hour'
          ? '最も多い時間帯'
          : report.granularity === 'weekday'
            ? '最も多い曜日'
            : '最も多い月'
    const maximumValue =
      report.granularity === 'day' && maximum?.key
        ? `${Number(report.from.slice(5, 7))}月${Number(maximum.key.slice(8, 10))}日`
        : (maximum?.label ?? '—')
    const normalizedSummary = [
      {
        ...(summary[0] ?? { value: '0', unit: '件', isOverTarget: false }),
        label: `${Number(report.from.slice(5, 7))}月の合計`,
      },
      summary[1] ?? { label: '1日あたり', value: '—', unit: '件', isOverTarget: false },
      {
        label: maximumLabel,
        value: maximumValue,
        unit: maximum ? `${maximum.value}件` : '',
        isOverTarget: false,
      },
    ]
    const days =
      Math.floor((dateAt(report.to).getTime() - dateAt(report.from).getTime()) / 86_400_000) + 1
    const closedDays = Math.max(0, days - report.businessDays - report.pendingDays)
    const tuesdays = weekdayDates(report.from, report.to, 2)
    return {
      tab,
      title: `${report.granularity === 'month' ? '月別' : report.granularity === 'hour' ? '時間帯別' : report.granularity === 'weekday' ? '曜日別' : '日別'}の予約数`,
      definition: `${monthLabel(report.from)}／火曜（${tuesdays.join('・')}日）の${closedDays}日を除く営業日${report.businessDays}日　${report.countBy === 'received_date' ? '受付日' : 'ご来店日'}でかぞえます`,
      selectedGranularity: report.granularity,
      selectedCountBy: report.countBy === 'received_date' ? 'received' : 'visit',
      points,
      summary: normalizedSummary,
      pendingDays: report.pendingDays,
    }
  }
  if (tab === 'staff')
    return {
      tab,
      title: '担当者ごとの件数',
      definition: `${sameMonthDefinition(report)}　合計 ${series.reduce((sum, entry) => sum + entry.points.reduce((subtotal, point) => subtotal + point.value, 0), 0)}件`,
      staff: series
        .map((entry) => {
          const point = entry.points[0]
          return {
            name: point?.label ?? entry.name,
            role: point?.key === 'unassigned' ? '受付では未定' : '',
            value: point?.value ?? 0,
            returnRate:
              point?.secondaryValue === null || point?.secondaryValue === undefined
                ? '—'
                : `${Math.round(point.secondaryValue * 100)}%`,
            unassigned: point?.key === 'unassigned',
          }
        })
        .sort(
          (left, right) => Number(Boolean(left.unassigned)) - Number(Boolean(right.unassigned)),
        ),
      pendingDays: report.pendingDays,
    }
  if (tab === 'wait') {
    const median = Number(
      report.summary.find((item) => item.label === '待ち時間中央値')?.value ??
        series[0]?.points[0]?.value ??
        0,
    )
    const target = report.target ?? 480
    const previous = report.summary.find((item) => item.label === '前の月')
    const sample = report.summary.find((item) => item.label === '母数' || item.label === '受付')
    const previousSeconds = Number(previous?.value)
    const [year, month] = report.from.split('-')
    return {
      tab,
      median: median > 0 ? minutes(median) : '—',
      previousMedian:
        previous?.value === '—' || !Number.isFinite(previousSeconds)
          ? '—'
          : minutes(previousSeconds),
      sample: sample
        ? `${year}年${Number(month)}月・受付 ${sample.value}${sample.unit || '件'}`
        : `${year}年${Number(month)}月・受付`,
      target: minutes(target),
      targetSeconds: target,
      isOverTarget: median > target,
      hourly: series
        .flatMap((entry) => entry.points)
        .filter((point) => point.label !== '中央値')
        .map((point) => ({
          label: point.label,
          value: point.value,
          display: clock(point.value),
          isOverTarget: Boolean(point.isOverTarget),
        })),
      pendingDays: report.pendingDays,
    }
  }
  const cancelSeries = series.map((entry) => {
    const style = cancellationStyle[entry.name]
    return {
      ...entry,
      tone: style?.tone ?? entry.tone,
      pattern: style?.pattern ?? entry.pattern,
    }
  })
  const cancellationPoints = cancelSeries.flatMap((entry) => entry.points)
  const byMonth = new Map<string, number>()
  for (const point of cancellationPoints)
    if (point.key && point.secondaryValue !== null) byMonth.set(point.key, point.secondaryValue)
  const highest = [...byMonth.entries()].sort((left, right) => right[1] - left[1])[0]
  const cancelled = cancellationPoints.reduce((sum, point) => sum + point.value, 0)
  const noShow = cancelSeries
    .find((entry) => entry.name === 'ご来店がなかった')
    ?.points.reduce((sum, point) => sum + point.value, 0)
  const overall = summary.find((item) => item.label === '取消率')
  const threshold = report.target ?? 10
  const highestRate =
    highest === undefined ? null : Math.round((highest[1] * 100 + Number.EPSILON) * 10) / 10
  const normalizedSummary = [
    {
      label: '取消率',
      value: overall ? stripPercent(overall.value) : '—',
      unit: `%　${overall?.isOverTarget ? '目安を超過' : `目安 ${threshold}%以内`}`,
      isOverTarget: Boolean(overall?.isOverTarget),
    },
    {
      label: '最も高い月',
      value: highestRate === null ? '—' : highestRate.toFixed(1),
      unit:
        highestRate === null
          ? ''
          : `%　${highest?.[0].slice(0, 4)}年${Number(highest?.[0].slice(5, 7))}月・${highestRate > threshold ? '目安を超過' : '目安内'}`,
      isOverTarget: highestRate !== null && highestRate > threshold,
    },
    {
      label: 'ご来店がなかった',
      value: String(noShow ?? 0),
      unit: `件　取り消し ${cancelled}件のうち`,
      isOverTarget: false,
    },
  ]
  return {
    tab,
    title: '月ごとの取り消し',
    definition: `${monthLabel(report.from)}〜${Number(report.to.slice(5, 7))}月／ご来店予定だった予約（取り消し・ご来店なしを含む）を分母に数えます`,
    series: cancelSeries,
    target: `目安 ${report.target ?? 10}%以内`,
    summary: normalizedSummary,
    pendingDays: report.pendingDays,
  }
}
