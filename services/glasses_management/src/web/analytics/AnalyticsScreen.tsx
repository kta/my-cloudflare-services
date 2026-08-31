import type { AnalyticsReport, AnalyticsTargets } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { cn, focusRing } from '@app/ui'
import { type ComponentType, useEffect, useMemo, useState } from 'react'
import { client } from '../client'
import { CancelTab } from './CancelTab'
import { CountTab } from './CountTab'
import { monthEnd, monthOptions, monthStart } from './describe'
import { PurposeTab } from './PurposeTab'
import type { AnalyticsCountBy, AnalyticsGranularity, AnalyticsPanelProps } from './panel'
import { SourceTab } from './SourceTab'
import { StaffTab } from './StaffTab'
import { Toolbar } from './Toolbar'
import { TopTab } from './TopTab'
import { ANALYTICS_TABS, type AnalyticsTab, type AnalyticsTabKey, tabByKey } from './tabs'
import { VisitsTab } from './VisitsTab'
import { WaitTab } from './WaitTab'

/*
 * 分析の器（P9 T-012。承認済みモック docs/frontend/mockups/eyex/images/ANALYTICS-TOP.png）。
 *
 * 引き算の決め（mockups/eyex/README.md）:
 *   主役はグラフ 1 つ。数字は箱に入れず罫線 1 本で区切る。
 *   **下 1/3 が空いているのは正しい状態**で、埋めるために要素を足さない。
 *
 * 数え方の約束:
 *   - **「適用」を押したときだけ集計する。** 下書き（`draft`）と適用済み（`applied`）を
 *     別々に持ち、`applied` が変わったときだけ `GET /api/staff/analytics` を叩く。
 *   - 1 タブの初回描画で叩く API は 1 本。目安は画面に入ったときの 1 回だけ取って持ち回す。
 *   - 人数（「名」）を 1 か所も出さない（Q-11）。
 */

/**
 * 8 タブぶんの面。モックがあるのは 5 枚で、残る 3 枚（予約の入口・来店回数・
 * ご来店の目的）も同じ型で組む。**押しても何も出ないタブを 1 つも作らない**ので、
 * ここは `Partial` にしない（タブを足したらこの表も必ず埋まる）。
 */
const DEFAULT_PANELS: Record<AnalyticsTabKey, ComponentType<AnalyticsPanelProps>> = {
  top: TopTab,
  count: CountTab,
  source: SourceTab,
  cancel: CancelTab,
  visits: VisitsTab,
  staff: StaffTab,
  purpose: PurposeTab,
  wait: WaitTab,
}

export type AnalyticsScreenProps = {
  storeId: string
  stores?: readonly { id: string; name: string }[]
  /** いまの時刻（ISO8601）。**画面は時計を読まない**ので、ここから注ぐ。 */
  now?: string
  initialTab?: AnalyticsTabKey
  /** 面の差し込み口。渡されなかったタブは既定の面で出す。 */
  panels?: Partial<Record<AnalyticsTabKey, ComponentType<AnalyticsPanelProps>>>
  /** 権限が無くてこの面を開けなかったときの戻り先。 */
  onBack?: () => void
  onSessionExpired?: () => void
}

type Applied = {
  from: string
  to: string
  storeId: string
  granularity: AnalyticsGranularity
  countBy: AnalyticsCountBy
}

/** 下書き。ここを変えても数字は動かない（「適用」で `applied` に写す）。 */
type Draft = {
  month: string
  startMonth: string
  storeId: string
  granularity: AnalyticsGranularity
  countBy: AnalyticsCountBy
}

type Loaded =
  | { status: 'loading' }
  | { status: 'error' }
  /** `analytics.read` を持たない。**通信の失敗と取り違えない**（直し方が違う）。 */
  | { status: 'forbidden' }
  | { status: 'ready'; report: AnalyticsReport }

export function AnalyticsScreen({
  storeId,
  stores = [],
  now,
  initialTab,
  panels,
  onBack,
  onSessionExpired,
}: AnalyticsScreenProps) {
  const at = useMemo(() => now ?? new Date().toISOString(), [now])
  const months = useMemo(() => monthOptions(at), [at])
  const thisMonth = months[0] ?? '2026-01'
  const sixMonthsBack = months[5] ?? thisMonth

  const [tab, setTab] = useState<AnalyticsTab>(() => tabByKey(initialTab ?? readTabFromUrl()))
  // 下書き。ここを変えても数字は動かない。
  const [draft, setDraft] = useState<Draft>({
    month: thisMonth,
    startMonth: sixMonthsBack,
    storeId,
    granularity: tab.granularity,
    countBy: 'visit_date',
  })
  // 適用済み。これが変わったときだけサーバへ聞きに行く。
  const [applied, setApplied] = useState<Applied>(() =>
    rangeOf(
      tab,
      {
        month: thisMonth,
        startMonth: sixMonthsBack,
        storeId,
        granularity: tab.granularity,
        countBy: 'visit_date',
      },
      at,
    ),
  )
  const [reload, setReload] = useState(0)
  const [state, setState] = useState<Loaded>({ status: 'loading' })
  const [targets, setTargets] = useState<AnalyticsTargets | null>(null)

  // 目安は画面に入ったときの 1 回だけ。タブを移るたびに取り直さない。
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await client.api.staff.analytics.targets.$get({
          query: { storeId: applied.storeId },
        })
        if (alive && res.ok) setTargets(await res.json())
      } catch {
        // 目安が取れなくても数字は読める。ここで画面を止めない。
      }
    })()
    return () => {
      alive = false
    }
    // 店舗をまたいでも目安は全店共通の固定値なので、初回の 1 回だけでよい。
  }, [])

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    void (async () => {
      try {
        const res = await client.api.staff.analytics.$get({
          query: {
            storeId: applied.storeId,
            metric: tab.metric,
            from: applied.from,
            to: applied.to,
            granularity: applied.granularity,
            countBy: applied.countBy,
            now: at,
          },
        })
        if (!alive) return
        if (res.status === 401) {
          onSessionExpired?.()
          return
        }
        if (res.status === 403) {
          setState({ status: 'forbidden' })
          return
        }
        if (!res.ok) {
          setState({ status: 'error' })
          return
        }
        setState({ status: 'ready', report: await res.json() })
      } catch {
        if (alive) setState({ status: 'error' })
      }
    })()
    return () => {
      alive = false
    }
  }, [applied, tab, at, onSessionExpired, reload])

  function goToTab(next: AnalyticsTab) {
    if (next.key === tab.key) return
    // タブごとに切り口の既定が違う。移ったら下書きもそのタブの既定へ戻す。
    const fresh: Draft = { ...draft, granularity: next.granularity, countBy: 'visit_date' }
    setTab(next)
    setDraft(fresh)
    setApplied(rangeOf(next, fresh, at))
    writeTabToUrl(next.key)
  }

  const Panel = panels?.[tab.key] ?? DEFAULT_PANELS[tab.key]

  /*
   * `analytics.read` を持たない人が URL で開いたとき。EX-PERMISSION の形は当てず、
   * **サイドバーは残したまま本文だけ**を 1 枚のカードに差し替える
   * （design/05-screen-flow.md §7.3）。タブや期間を操作させても意味が無いので出さない。
   */
  if (state.status === 'forbidden') {
    return (
      <section className="flex min-h-0 flex-1 flex-col overflow-auto bg-paper px-4 py-6 sm:px-10 sm:py-8">
        <div className="flex max-w-160 flex-col items-start gap-4 rounded-panel border border-line bg-surface px-5 py-5">
          <h2 className="m-0 text-title font-bold text-ink">この画面は店長だけがご覧になれます</h2>
          <p className="m-0 text-body text-ink-muted">
            分析をご覧になるには、店長の権限が要ります。必要なときは店長にお声がけください。
          </p>
          <button
            type="button"
            onClick={() => onBack?.()}
            className={cn(
              'min-h-11 rounded-card bg-pine px-5 text-lead font-bold text-on-pine',
              focusRing,
            )}
          >
            前の画面に戻る
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-auto bg-paper">
      <div
        role="tablist"
        aria-label="分析"
        // 375px でも 8 タブすべてに指が届くよう、帯だけを横に送る（面は折り返す）。
        className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-4"
      >
        {ANALYTICS_TABS.map((item) => {
          const selected = item.key === tab.key
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => goToTab(item)}
              className={cn(
                'min-h-11.5 border-b-3 px-4 text-lead font-bold',
                selected ? 'border-pine text-pine' : 'border-transparent text-ink-muted',
                focusRing,
              )}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      <Toolbar
        title={tab.label}
        range={tab.range}
        months={months}
        month={draft.month}
        startMonth={draft.startMonth}
        storeId={draft.storeId}
        stores={stores}
        onMonthChange={(month) => setDraft((prev) => ({ ...prev, month }))}
        onStartMonthChange={(startMonth) => setDraft((prev) => ({ ...prev, startMonth }))}
        onStoreChange={(next) => setDraft((prev) => ({ ...prev, storeId: next }))}
        onApply={() => setApplied(rangeOf(tab, draft, at))}
      />

      {state.status === 'ready' && state.report.pendingDays > 0 ? (
        <p className="border-b border-line bg-surface px-4 py-2 text-grid text-ink-muted">
          {state.report.pendingDays}日ぶんはまだ集計中です
        </p>
      ) : null}

      <div role="tabpanel" aria-label={tab.label} className="px-4 py-6 sm:px-10 sm:py-8">
        {state.status === 'loading' ? (
          <p role="status" className="text-body text-ink-muted">
            読み込んでいます…
          </p>
        ) : state.status === 'error' ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-4 rounded-panel border border-danger bg-danger-soft px-5 py-4"
          >
            <span className="text-body text-danger">
              数字を読み込めませんでした。通信が届かなかったようです。もう一度読み込んでください。
            </span>
            <button
              type="button"
              onClick={() => setReload((count) => count + 1)}
              className={cn(
                'min-h-11 rounded-card bg-pine px-5 text-lead font-bold text-on-pine',
                focusRing,
              )}
            >
              もう一度読み込む
            </button>
          </div>
        ) : isEmpty(state.report) ? (
          <p className="text-body text-ink-muted">この期間に数えられるご予約はありません。</p>
        ) : (
          <Panel
            tab={tab}
            report={state.report}
            targets={targets}
            now={at}
            options={{ granularity: draft.granularity, countBy: draft.countBy }}
            onOptionsChange={(next) => setDraft((prev) => ({ ...prev, ...next }))}
          />
        )}
      </div>
    </section>
  )
}

/**
 * 下書きから、サーバへ渡す期間と切り口を作る（暦を正とする）。
 *
 * **トップは当月のあいだだけ月ではなく「本日を中心に前後 7 日」**（承認済みモック
 * ANALYTICS-TOP の 8/20〜9/3 は月をまたぐ）。当月を月で切ると見出しの
 * 「本日を中心に前後7日」と食い違い、月初には「先週」が、月末には「来週」が
 * 期間の外に落ちて 0 件に見える。
 *
 * いっぽう**別の月を選んだときはその月をそのまま渡す**。トップにも「対象の期間」の札が
 * 出ている以上、押しても何も起きない札にはできない（AC-ANA-03・AC-ANA-15・AC-ANA-19）。
 */
function rangeOf(tab: AnalyticsTab, draft: Draft, at: string): Applied {
  const currentMonth = toJstDateString(new Date(at)).slice(0, 7)
  const span =
    tab.key === 'top' && draft.month === currentMonth ? aroundToday(at) : monthSpan(tab, draft)
  return {
    ...span,
    storeId: draft.storeId,
    granularity: draft.granularity,
    countBy: draft.countBy,
  }
}

const monthSpan = (tab: AnalyticsTab, draft: Draft): { from: string; to: string } => ({
  from: monthStart(tab.range ? draft.startMonth : draft.month),
  to: monthEnd(draft.month),
})

/** 本日（JST）を中心に前後 7 日の 15 日。 */
function aroundToday(at: string): { from: string; to: string } {
  const today = toJstDateString(new Date(at))
  const shift = (days: number): string =>
    new Date(Date.parse(`${today}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10)
  return { from: shift(-7), to: shift(7) }
}

function isEmpty(report: AnalyticsReport): boolean {
  return report.series.every((series) => series.points.length === 0)
}

function readTabFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('tab')
}

function writeTabToUrl(key: AnalyticsTabKey) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('tab', key)
  window.history.replaceState(null, '', url.toString())
}
