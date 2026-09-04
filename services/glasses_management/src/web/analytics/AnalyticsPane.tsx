import type { AnalyticsReport } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { useRef } from 'react'
import { client } from '../client'
import { type AnalyticsPresentationReport, AnalyticsScreen } from './AnalyticsScreen'
import { mapAnalyticsReport } from './presenter'
import type { AnalyticsSelection } from './Toolbar'

const METRIC = {
  top: 'overview',
  count: 'reservation_count',
  source: 'reservation_source',
  cancel: 'cancellation',
  visits: 'visit_frequency',
  staff: 'staff',
  purpose: 'purpose',
  wait: 'wait_time',
} as const

function shift(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}
function monthRange(month: string) {
  const [year, value] = month.split('-').map(Number)
  const end = new Date(Date.UTC(year ?? 0, value ?? 1, 0)).toISOString().slice(0, 10)
  return { from: `${month}-01`, to: end }
}
function shiftMonth(month: string, amount: number) {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (value ?? 1) - 1 + amount, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
function topRange(month: string, today: string) {
  const day = Math.min(Number(today.slice(8, 10)), Number(monthRange(month).to.slice(8, 10)))
  const center = `${month}-${String(day).padStart(2, '0')}`
  return { from: shift(center, -7), to: shift(center, 7) }
}

export function analyticsRequestForSelection(selection: AnalyticsSelection, today: string) {
  const range =
    selection.tab === 'top'
      ? topRange(selection.month, today)
      : selection.tab === 'cancel'
        ? {
            from: `${selection.startMonth ?? shiftMonth(selection.month, -5)}-01`,
            to: monthRange(selection.month).to,
          }
        : monthRange(selection.month)
  const query = {
    storeId: selection.storeId,
    metric: METRIC[selection.tab],
    from: range.from,
    to: range.to,
    granularity:
      selection.granularity ??
      (selection.tab === 'wait' ? 'hour' : selection.tab === 'cancel' ? 'month' : 'day'),
    countBy: selection.countBy ?? 'visit_date',
  } as const
  return {
    query,
    cacheKey: [
      selection.tab,
      selection.storeId,
      query.from,
      query.to,
      query.granularity,
      query.countBy,
    ].join(':'),
  }
}

export function AnalyticsPane({
  storeId,
  stores,
  onSessionExpired,
  onBack,
}: {
  storeId: string
  stores: readonly { id: string; name: string; isActive: boolean }[]
  onSessionExpired: () => void
  onBack: () => void
}) {
  const cache = useRef(new Map<string, AnalyticsPresentationReport>())
  async function load(selection: AnalyticsSelection) {
    const today = toJstDateString(new Date())
    const request = analyticsRequestForSelection(selection, today)
    const cached = cache.current.get(request.cacheKey)
    if (cached) return cached
    const res = await client.api.staff.analytics.$get({
      query: request.query,
    })
    if (res.status === 401) {
      onSessionExpired()
      throw new Error('session')
    }
    if (res.status === 403) throw new Error('forbidden')
    if (!res.ok) throw new Error('analytics')
    const next = mapAnalyticsReport(selection.tab, (await res.json()) as AnalyticsReport)
    cache.current.set(request.cacheKey, next)
    return next
  }
  return (
    <AnalyticsScreen
      storeId={storeId}
      storeOptions={stores
        .filter((store) => store.isActive)
        .map((store) => ({ id: store.id, label: `店舗：${store.name.replace(/^EYE\s+/, '')}` }))}
      reports={{}}
      initialMonth={toJstDateString(new Date()).slice(0, 7)}
      loadReport={load}
      onBack={onBack}
    />
  )
}
