import { cn, focusRing } from '@app/ui'
import { monthLabel } from './describe'

/*
 * 分析のツールバー（承認済みモック ANALYTICS-TOP.png の 56px の帯）。
 * 見出し・「対象の期間」・期間の札・「適用」・右端の「店舗：銀座店 ▾」。
 *
 * **ここは下書きを変えるだけで、集計は「適用」を押したときにしか起きない。**
 * 期間や店舗を選び替えた瞬間にサーバを叩くと、店長が選び終える前に古い数字が
 * 何度も入れ替わって読めなくなる。
 */

/** 期間の札と店舗の札は同じ見た目（高さ 44px・角 12px・縁 1px）。 */
const PILL =
  'min-h-11 rounded-card border border-line-strong bg-surface px-3 text-lead font-bold text-ink'

export type ToolbarProps = {
  title: string
  /** 期間の札を 2 つ並べるか（取り消しだけ）。 */
  range: boolean
  months: readonly string[]
  startMonth: string
  month: string
  storeId: string
  stores: readonly { id: string; name: string }[]
  onStartMonthChange: (month: string) => void
  onMonthChange: (month: string) => void
  onStoreChange: (storeId: string) => void
  onApply: () => void
}

export function Toolbar({
  title,
  range,
  months,
  startMonth,
  month,
  storeId,
  stores,
  onStartMonthChange,
  onMonthChange,
  onStoreChange,
  onApply,
}: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-surface px-4 py-1.5">
      <h2 className="text-title font-bold text-ink">{title}</h2>
      <span className="text-grid text-ink-muted">対象の期間</span>
      {range ? (
        <>
          <select
            aria-label="対象の期間（開始）"
            className={cn(PILL, focusRing)}
            value={startMonth}
            onChange={(e) => onStartMonthChange(e.target.value)}
          >
            {months.map((value) => (
              <option key={value} value={value}>
                {monthLabel(value)}
              </option>
            ))}
          </select>
          <span className="text-grid text-ink-muted">−</span>
          <select
            aria-label="対象の期間（終了）"
            className={cn(PILL, focusRing)}
            value={month}
            onChange={(e) => onMonthChange(e.target.value)}
          >
            {/* 開始より前の終了月は選べない（選べると空の期間ができる）。 */}
            {months
              .filter((value) => value >= startMonth)
              .map((value) => (
                <option key={value} value={value}>
                  {monthLabel(value)}
                </option>
              ))}
          </select>
        </>
      ) : (
        <select
          aria-label="対象の期間"
          className={cn(PILL, focusRing)}
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
        >
          {months.map((value) => (
            <option key={value} value={value}>
              {monthLabel(value)}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={onApply}
        className={cn(
          'min-h-11 rounded-card bg-pine px-5 text-lead font-bold text-on-pine',
          focusRing,
        )}
      >
        適用
      </button>
      <select
        aria-label="店舗"
        className={cn(PILL, 'ml-auto', focusRing)}
        value={storeId}
        onChange={(e) => onStoreChange(e.target.value)}
      >
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            店舗：{store.name}
          </option>
        ))}
      </select>
    </div>
  )
}
