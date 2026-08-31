import { cn, focusRing } from '@app/ui'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { ChartSeries } from './charts'
import { type OfficialAnalyticsReport, OfficialTab } from './OfficialTab'
import { type AnalyticsSummaryItem, SimpleTab } from './SimpleTab'
import { type AnalyticsSelection, type AnalyticsStoreOption, Toolbar } from './Toolbar'
import { ANALYTICS_TABS, type AnalyticsTabKey, tabFor } from './tabs'

type AnalyticsSimpleReport = {
  tab: Extract<AnalyticsTabKey, 'source' | 'visits' | 'purpose'>
  definition: string
  series: readonly ChartSeries[]
  summary: readonly AnalyticsSummaryItem[]
  pendingDays?: number
}

export type AnalyticsPresentationReport = AnalyticsSimpleReport | OfficialAnalyticsReport

function isSimpleReport(report: AnalyticsPresentationReport): report is AnalyticsSimpleReport {
  return report.tab === 'source' || report.tab === 'visits' || report.tab === 'purpose'
}

export type AnalyticsScreenProps = {
  storeId: string
  reports: Partial<Record<AnalyticsTabKey, AnalyticsPresentationReport>>
  initialTab?: AnalyticsTabKey
  initialMonth?: string
  months?: readonly string[]
  storeOptions?: readonly AnalyticsStoreOption[]
  /** Worker 契約が完成したら Hono RPC の結果を表示モデルへ写して渡す。 */
  loadReport?: (selection: AnalyticsSelection) => Promise<AnalyticsPresentationReport>
  onBack?: () => void
}

function shiftMonth(month: string, amount: number) {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 0, (value ?? 1) - 1 + amount, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthOptions(endMonth: string) {
  return Array.from({ length: 25 }, (_, index) => shiftMonth(endMonth, -index))
}

function selectionForTab(selection: AnalyticsSelection, tab: AnalyticsTabKey) {
  const next: AnalyticsSelection = {
    tab,
    month: selection.month,
    storeId: selection.storeId,
  }
  if (tab === 'cancel') next.startMonth = selection.startMonth ?? shiftMonth(selection.month, -5)
  if (tab === 'count') {
    if (selection.granularity) next.granularity = selection.granularity
    if (selection.countBy) next.countBy = selection.countBy
  }
  return next
}

export function AnalyticsScreen({
  storeId,
  reports,
  initialTab = 'top',
  initialMonth = '2026-08',
  months,
  storeOptions = [{ id: storeId, label: '選択中' }],
  loadReport,
  onBack,
}: AnalyticsScreenProps) {
  const [selectedTab, setSelectedTab] = useState(initialTab)
  const initialStartMonth = initialTab === 'cancel' ? shiftMonth(initialMonth, -5) : undefined
  const availableMonths = months ?? monthOptions(initialMonth)
  const [draft, setDraft] = useState<AnalyticsSelection>({
    tab: initialTab,
    month: initialMonth,
    startMonth: initialStartMonth,
    storeId,
  })
  const [applied, setApplied] = useState<AnalyticsSelection>({
    tab: initialTab,
    month: initialMonth,
    startMonth: initialStartMonth,
    storeId,
  })
  const [report, setReport] = useState<AnalyticsPresentationReport | undefined>(reports[initialTab])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<false | 'failed' | 'forbidden'>(false)
  const tabRefs = useRef<Partial<Record<AnalyticsTabKey, HTMLButtonElement | null>>>({})
  const latestRequest = useRef(0)

  const selected = tabFor(selectedTab)
  const pendingDays = report && 'pendingDays' in report ? report.pendingDays : undefined

  function selectTab(tab: AnalyticsTabKey) {
    setSelectedTab(tab)
    setDraft(selectionForTab(draft, tab))
    void apply(selectionForTab(applied, tab))
  }

  async function apply(selection = draft) {
    const request = ++latestRequest.current
    setApplied(selection)
    setError(false)
    setLoading(true)
    setReport(undefined)
    try {
      const next = loadReport ? await loadReport(selection) : reports[selection.tab]
      if (request !== latestRequest.current) return
      setReport(next)
    } catch (caught) {
      if (request !== latestRequest.current) return
      setError(caught instanceof Error && caught.message === 'forbidden' ? 'forbidden' : 'failed')
    } finally {
      if (request === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (loadReport && !reports[initialTab])
      void apply({ tab: initialTab, month: initialMonth, storeId })
  }, [])

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: AnalyticsTabKey) {
    const index = ANALYTICS_TABS.findIndex((tab) => tab.key === current)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % ANALYTICS_TABS.length
    if (event.key === 'ArrowLeft')
      nextIndex = (index - 1 + ANALYTICS_TABS.length) % ANALYTICS_TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = ANALYTICS_TABS.length - 1
    if (nextIndex !== null) {
      event.preventDefault()
      const nextTab = ANALYTICS_TABS[nextIndex]
      if (nextTab) tabRefs.current[nextTab.key]?.focus()
      return
    }
    if (
      event.key === 'Enter' ||
      event.key === ' ' ||
      event.key === 'Spacebar' ||
      event.key === 'Space'
    ) {
      event.preventDefault()
      selectTab(current)
    }
  }

  const panelId = 'analytics-panel'
  return (
    <main
      className="flex h-full min-h-0 min-w-0 max-w-full flex-col bg-paper"
      aria-labelledby="analytics-title"
    >
      <div
        role="tablist"
        aria-label="分析の内訳を選ぶ"
        className="flex min-h-11 shrink-0 gap-1 overflow-x-auto border-line border-b bg-surface px-4"
      >
        {ANALYTICS_TABS.map((tab) => (
          <button
            key={tab.key}
            ref={(node) => {
              tabRefs.current[tab.key] = node
            }}
            id={`analytics-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={tab.key === selectedTab}
            aria-controls={panelId}
            tabIndex={tab.key === selectedTab ? 0 : -1}
            onClick={() => selectTab(tab.key)}
            onKeyDown={(event) => onTabKeyDown(event, tab.key)}
            className={cn(
              'min-h-11 shrink-0 border-b-3 px-4 text-body font-semibold',
              tab.key === selectedTab
                ? 'border-pine text-pine'
                : 'border-transparent text-ink-muted',
              focusRing,
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <Toolbar
        tabLabel={selected.label}
        draft={draft}
        months={[
          ...new Set(
            [draft.month, draft.startMonth, ...availableMonths].filter((month): month is string =>
              Boolean(month),
            ),
          ),
        ].sort((left, right) => right.localeCompare(left))}
        storeOptions={
          storeOptions.some((store) => store.id === draft.storeId)
            ? storeOptions
            : [{ id: draft.storeId, label: '選択中' }, ...storeOptions]
        }
        onMonthChange={(month) =>
          setDraft((current) => ({
            ...current,
            month,
            startMonth:
              current.tab === 'cancel' && current.startMonth && current.startMonth > month
                ? month
                : current.startMonth,
          }))
        }
        onStartMonthChange={(startMonth) =>
          setDraft((current) => ({
            ...current,
            startMonth,
            month:
              current.tab === 'cancel' && startMonth > current.month ? startMonth : current.month,
          }))
        }
        onStoreChange={(nextStoreId) =>
          setDraft((current) => ({ ...current, storeId: nextStoreId }))
        }
        onApply={() => void apply()}
      />
      {pendingDays ? (
        <p className="px-10 pt-3 text-grid text-ink-muted">{pendingDays}日ぶんはまだ集計中です</p>
      ) : null}
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`analytics-tab-${selectedTab}`}
        className="min-h-0 min-w-0 max-w-full flex-1 overflow-y-auto"
      >
        <h1 id="analytics-title" className="sr-only">
          {selected.label}
        </h1>
        {loading ? (
          <p role="status" className="px-10 py-8 text-body text-ink-muted">
            読み込んでいます…
          </p>
        ) : error ? (
          <div className="px-10 py-8">
            <p
              role="alert"
              className="rounded-panel border border-danger bg-danger-soft px-5 py-4 text-body text-danger"
            >
              {error === 'forbidden'
                ? 'この店舗の分析を見る権限がありません。'
                : '分析を読み込めませんでした。もう一度読み込んでください。'}
            </p>
            {error === 'forbidden' && onBack ? (
              <button
                type="button"
                onClick={onBack}
                className={cn(
                  'mt-4 min-h-11 rounded-card border border-line-strong px-4 text-body font-semibold text-ink',
                  focusRing,
                )}
              >
                戻る
              </button>
            ) : null}
          </div>
        ) : report ? (
          isSimpleReport(report) ? (
            <SimpleTab {...report} />
          ) : (
            <OfficialTab
              report={report}
              onCountDraftChange={(next) =>
                setDraft((current) => ({
                  ...current,
                  granularity: next.granularity ?? current.granularity,
                  countBy:
                    next.countBy === 'received'
                      ? 'received_date'
                      : next.countBy === 'visit'
                        ? 'visit_date'
                        : current.countBy,
                }))
              }
            />
          )
        ) : (
          <p className="px-10 py-8 text-body text-ink-muted">
            この期間に数えられるご予約はありません。
          </p>
        )}
      </div>
      <p className="sr-only">
        適用中の対象期間：{applied.tab} {applied.month}
      </p>
    </main>
  )
}
