import { focusRing } from '@app/ui'
import type { AnalyticsTabKey } from './tabs'

export type AnalyticsSelection = {
  tab: AnalyticsTabKey
  month: string
  startMonth?: string
  storeId: string
  granularity?: 'day' | 'month' | 'hour' | 'weekday'
  countBy?: 'visit_date' | 'received_date'
}
export type AnalyticsStoreOption = { id: string; label: string }

export function Toolbar({
  tabLabel,
  draft,
  months,
  storeOptions,
  onMonthChange,
  onStartMonthChange,
  onStoreChange,
  onApply,
}: {
  tabLabel: string
  draft: AnalyticsSelection
  months: readonly string[]
  storeOptions: readonly AnalyticsStoreOption[]
  onMonthChange: (month: string) => void
  onStartMonthChange: (month: string) => void
  onStoreChange: (storeId: string) => void
  onApply: () => void
}) {
  const option = (month: string) => (
    <option key={month} value={month}>
      {month.slice(0, 4)}年{Number(month.slice(5, 7))}月
    </option>
  )
  const startMonths = months.filter((month) => month <= draft.month)
  const endMonths = months.filter((month) => month >= (draft.startMonth ?? draft.month))
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-2.5 border-line border-b bg-surface px-4 py-1.5">
      <h2 className="text-lead font-bold text-ink">{tabLabel}</h2>
      <span className="text-grid text-ink-muted">対象の期間</span>
      {draft.tab === 'cancel' ? (
        <>
          <select
            aria-label="開始月"
            value={draft.startMonth}
            onChange={(event) => onStartMonthChange(event.target.value)}
            className={`min-h-11 rounded-card border border-line-strong bg-surface px-3.5 text-body font-semibold text-ink ${focusRing}`}
          >
            {startMonths.map(option)}
          </select>
          <span aria-hidden="true" className="text-body text-ink-muted">
            −
          </span>
          <select
            id="analytics-month"
            aria-label="終了月"
            value={draft.month}
            onChange={(event) => onMonthChange(event.target.value)}
            className={`min-h-11 rounded-card border border-line-strong bg-surface px-3.5 text-body font-semibold text-ink ${focusRing}`}
          >
            {endMonths.map(option)}
          </select>
        </>
      ) : (
        <select
          id="analytics-month"
          aria-label="対象の期間"
          value={draft.month}
          onChange={(event) => onMonthChange(event.target.value)}
          className={`min-h-11 rounded-card border border-line-strong bg-surface px-3.5 text-body font-semibold text-ink ${focusRing}`}
        >
          {months.map(option)}
        </select>
      )}
      <button
        type="button"
        onClick={onApply}
        className={`min-h-11 rounded-card bg-pine px-5.5 text-body font-semibold text-on-pine ${focusRing}`}
      >
        適用
      </button>
      <label htmlFor="analytics-store" className="sr-only">
        店舗
      </label>
      <select
        id="analytics-store"
        aria-label="店舗"
        value={draft.storeId}
        onChange={(event) => onStoreChange(event.target.value)}
        className={`ml-auto min-h-11 rounded-card border border-line-strong bg-surface px-3.5 text-body font-semibold text-ink ${focusRing}`}
      >
        {storeOptions.map((store) => (
          <option key={store.id} value={store.id}>
            {store.label}
          </option>
        ))}
      </select>
    </div>
  )
}
