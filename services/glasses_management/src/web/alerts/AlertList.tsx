import { type Alert, AlertList as AlertListResult } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { useCallback, useEffect, useState } from 'react'
import { client } from '../client'
import {
  ALERT_KINDS,
  type AlertCounts,
  type AlertKind,
  alertAction,
  alertTags,
  alertTime,
  EMPTY_COUNTS,
  kindLabel,
  resolveOne,
  sortAlerts,
  todayHeading,
} from './alertLabels'

/*
 * ALERTS（承認済みモック docs/frontend/mockups/eyex/images/ALERTS.png）。
 *
 * 画面の計画（DESIGN_RULE パス 1）
 *   主役は 1 画面に 1 つ ——「次にやること」。行の右端のボタンがそれそのもので、
 *   1 行 1 件・1 行 1 操作を崩さない。
 *   状態を色だけで伝えない —— 未読は左 4px の赤い縦罫**と**「未読」の札の 2 つで示す。
 *   空いた場所を埋めない —— 左は 4 分類だけ、行は時刻・見出し・本文・操作で終わり。
 *
 * 実測（`P10-terminals-and-audit.md` T-019）
 *   2 ペイン 252px + 1fr ／ 左 padding 30px 14px・地 --color-surface-2
 *   分類 min-height 52px・角 8px。選択中は白地 + 1px --color-line + 文字 --color-pine
 *   行 白・1px --color-line・角 12px・padding 20px・行間 16px。未読は左 4px --color-danger
 */

export type AlertListProps = {
  storeId: string
  /** いまの JST の暦日（YYYY-MM-DD）。端末の時計を読まない。 */
  today: string
  /** 「台帳で確認する」「影響する予約を見る」の行き先。 */
  onOpenLedger: () => void
  /** 数が動いたことを器へ返す（左の柱と上のバーの入口が同じ数を出すため）。 */
  onCountsChange?: (counts: AlertCounts) => void
}

export function AlertList({ storeId, today, onOpenLedger, onCountsChange }: AlertListProps) {
  const [kind, setKind] = useState<AlertKind>('all')
  const [items, setItems] = useState<readonly Alert[]>([])
  const [counts, setCounts] = useState<AlertCounts>(EMPTY_COUNTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** この画面で既読にしたもの。時計を読まずに未読の印だけ落とす。 */
  const [read, setRead] = useState<ReadonlySet<string>>(new Set())

  const load = useCallback(
    async (next: AlertKind) => {
      setLoading(true)
      setError(null)
      try {
        const res = await client.api.staff.alerts.$get({
          query: { storeId, kind: next, audience: 'store' },
        })
        if (!res.ok) {
          setError('お知らせを読み込めませんでした。画面を開き直してください。')
          return
        }
        const list = AlertListResult.parse(await res.json())
        setItems(sortAlerts(list.items))
        setCounts(list.counts)
        onCountsChange?.(list.counts)
      } catch {
        setError('通信できませんでした。画面を開き直してください。')
      } finally {
        setLoading(false)
      }
    },
    [storeId, onCountsChange],
  )

  useEffect(() => {
    void load(kind)
  }, [load, kind])

  async function markResolved(alert: Alert) {
    const res = await client.api.staff.alerts[':alertId'].$patch({
      param: { alertId: alert.id },
      json: { resolved: true },
    })
    if (!res.ok) {
      setError('対応済みにできませんでした。時間をおいてお試しください。')
      return
    }
    setItems((prev) => prev.filter((row) => row.id !== alert.id))
    setCounts((prev) => {
      const next = resolveOne(prev, alert)
      onCountsChange?.(next)
      return next
    })
  }

  /** 添えた操作。**成功したその時点で対応済みにする**（手で対応済みにする操作は無い）。 */
  async function run(alert: Alert) {
    const action = alertAction(alert)
    if (action === null) return
    setError(null)
    try {
      if (action.kind === 'retry') {
        const recordingId = alert.targetId
        if (recordingId === null) return
        const res = await client.api.staff.recordings[':recordingId'].retry.$post({
          param: { recordingId },
        })
        if (!res.ok) {
          setError('もう一度送れませんでした。時間をおいてお試しください。')
          return
        }
      } else {
        onOpenLedger()
      }
      await markResolved(alert)
    } catch {
      setError('通信できませんでした。時間をおいてお試しください。')
    }
  }

  async function readAll() {
    try {
      const res = await client.api.staff.alerts['read-all'].$post({ json: { storeId } })
      if (!res.ok) {
        setError('既読にできませんでした。時間をおいてお試しください。')
        return
      }
      setRead(new Set(items.map((row) => row.id)))
    } catch {
      setError('通信できませんでした。時間をおいてお試しください。')
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[252px_1fr]">
      <nav
        aria-label="お知らせの分類"
        className="flex flex-col gap-1.5 overflow-y-auto border-r border-line bg-surface-2 px-3.5 py-7.5"
      >
        {ALERT_KINDS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setKind(item.key)}
            aria-current={item.key === kind ? 'page' : undefined}
            aria-label={kindLabel(item.key, counts[item.key])}
            className={cn(
              'flex min-h-13 items-center gap-1.5 rounded-ctl px-3 text-grid font-semibold',
              item.key === kind ? 'border border-line bg-surface text-pine' : 'text-ink',
              focusRing,
            )}
          >
            <span aria-hidden="true">{item.label}</span>
            <span aria-hidden="true" className="ml-auto font-mono text-note text-ink-muted">
              {counts[item.key]}
            </span>
          </button>
        ))}
      </nav>

      <section className="min-h-0 overflow-auto px-6 py-7.5">
        <div className="mb-3.5 flex items-center gap-4">
          <p className="text-note text-ink-muted">{todayHeading(today)}</p>
          <button
            type="button"
            onClick={() => {
              void readAll()
            }}
            className={cn(
              'ml-auto min-h-11 rounded-ctl px-4 text-body font-semibold text-pine',
              focusRing,
            )}
          >
            すべて既読にする
          </button>
        </div>

        <p role="status" className="text-body text-danger">
          {error}
        </p>

        {loading ? (
          <p className="text-body text-ink-muted">読み込んでいます…</p>
        ) : items.length === 0 ? (
          <p className="text-body text-ink-muted">いまお伝えすることはありません。</p>
        ) : (
          <ul aria-label="お知らせ" className="flex flex-col gap-4">
            {items.map((alert) => {
              const unread = alert.readAt === null && !read.has(alert.id)
              const action = alertAction(alert)
              return (
                <li
                  key={alert.id}
                  className={cn(
                    'flex items-start gap-4 rounded-panel border border-line bg-surface p-5',
                    unread && 'border-l-4 border-l-danger',
                  )}
                >
                  <span className="w-13 shrink-0 pt-1 font-mono text-note font-semibold text-ink-muted">
                    {alertTime(alert.occurredAt)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2.5">
                      <span className="text-lead font-bold text-ink">{alert.title}</span>
                      {unread && (
                        <span className="rounded-full border border-danger px-2 py-px text-fine font-semibold text-danger">
                          未読
                        </span>
                      )}
                      {alertTags(alert).map((tag) => (
                        <span
                          key={tag.text}
                          className={cn(
                            'rounded-full px-2 py-px text-fine font-semibold',
                            tag.tone === 'danger'
                              ? 'bg-danger-soft text-danger'
                              : 'bg-web-soft text-web',
                          )}
                        >
                          {tag.text}
                        </span>
                      ))}
                    </span>
                    {alert.body !== null && (
                      <span className="mt-1.5 block text-note text-ink-muted">{alert.body}</span>
                    )}
                  </span>
                  {action && (
                    <button
                      type="button"
                      onClick={() => {
                        void run(alert)
                      }}
                      className={cn(
                        'min-h-12 shrink-0 self-center rounded-ctl border border-line-strong bg-surface px-4 text-body font-semibold text-ink',
                        focusRing,
                      )}
                    >
                      {action.label}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
