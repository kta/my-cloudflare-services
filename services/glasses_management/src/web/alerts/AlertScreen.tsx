import { type Alert, AlertList, type AlertList as AlertListValue } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { useCallback, useEffect, useState } from 'react'
import { domainFetch } from '../client'

type Kind = 'all' | 'action' | 'info' | 'resolved'

const KINDS: readonly { key: Kind; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'action', label: 'アラート（対応が必要）' },
  { key: 'info', label: 'お知らせ' },
  { key: 'resolved', label: '対応済み' },
]

const EMPTY: AlertListValue = {
  items: [],
  nextCursor: null,
  total: 0,
  counts: { all: 0, action: 0, info: 0, resolved: 0 },
}

export function AlertScreen({
  storeId,
  onCountChange,
  onOpenLedger,
  now = () => new Date(),
}: {
  storeId: string
  onCountChange?: (count: number) => void
  /**
   * 「台帳で確認する」。**そのお知らせが指しているご予約を連れていく** ——
   * 捨てて今日の台帳を開くだけだと、Web からの確認待ちを 12 行の中から目で探し直す
   * ことになり、探し当てられないまま 24:00 の自動取消に間に合わない（UX 監査 NEW-05）。
   */
  onOpenLedger?: (reservationId: string | null) => void
  now?: () => Date
}) {
  const [kind, setKind] = useState<Kind>('all')
  const [data, setData] = useState<AlertListValue>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const query = new URLSearchParams({ storeId, kind })
    const response = await domainFetch(`/api/staff/alerts?${query}`)
    if (!response.ok) throw new Error('alerts')
    const next = AlertList.parse(await response.json())
    setData(next)
    onCountChange?.(next.counts.all)
  }, [kind, onCountChange, storeId])

  useEffect(() => {
    let live = true
    load().catch(() => {
      if (live) setError('お知らせを読み込めませんでした。もう一度お試しください。')
    })
    return () => {
      live = false
    }
  }, [load])

  async function readAll() {
    setBusy(true)
    setError(null)
    try {
      const response = await domainFetch('/api/staff/alerts/read-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId }),
      })
      if (!response.ok) throw new Error('read-all')
      await load()
    } catch {
      setError('既読にできませんでした。入力は変わっていません。')
    } finally {
      setBusy(false)
    }
  }

  async function resolve(item: Alert) {
    setBusy(true)
    setError(null)
    try {
      if (item.code === 'recording.upload_failed' && item.targetId !== null) {
        const retried = await domainFetch(`/api/staff/recordings/${item.targetId}/retry`, {
          method: 'POST',
        })
        if (!retried.ok) throw new Error('retry')
        // retry は再送の受付にすぎない。実際の stored 遷移がサーバ側で解決するまで残す。
        await load()
      } else if (opensLedger(item)) {
        if (!onOpenLedger) throw new Error('missing-destination')
        onOpenLedger(item.targetId ?? null)
      } else {
        throw new Error('missing-action')
      }
    } catch {
      setError('操作を完了できませんでした。通信を確かめて、もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    /*
      画面の器は `<main>` で、名前を持つ。持たなかったころ、この面には読み上げの
      ランドマークが 1 つも無く、画面を切り替えても「いまどこにいるか」を耳で
      確かめる手がかりが無かった（実装不足の洗い出し foundation-01 / T-011）。
      名前は左の柱の行き先と同じ語にする（2 通りの呼び方を覚えさせない）。
    */
    <main aria-label="お知らせ" className="flex h-full min-h-0 flex-col bg-paper lg:flex-row">
      <aside className="w-full shrink-0 border-b border-line bg-surface-2 px-3.5 py-4 lg:w-63 lg:border-r lg:border-b-0 lg:py-7.5">
        <nav aria-label="お知らせの種類" className="grid content-start gap-1.5">
          {KINDS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-label={`${entry.label} ${data.counts[entry.key]}件`}
              aria-current={kind === entry.key ? 'page' : undefined}
              onClick={() => setKind(entry.key)}
              className={cn(
                'flex min-h-13 w-full items-center gap-2.5 rounded-card px-3 text-left text-note font-semibold',
                kind === entry.key ? 'border border-line bg-surface text-pine' : 'text-ink',
                focusRing,
              )}
            >
              <span>{entry.label}</span>
              <span className="ml-auto text-grid text-ink-muted">{data.counts[entry.key]}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="min-w-0 flex-1 overflow-auto px-6 py-7.5" aria-label="お知らせ一覧">
        <div className="mb-5 flex items-center justify-between gap-4">
          <p className="text-grid text-ink-muted">本日 {formatDay(now())}</p>
          <button
            type="button"
            onClick={readAll}
            disabled={busy || data.items.every((item) => item.readAt !== null)}
            className={`min-h-12 rounded-ctl border border-line-strong bg-surface px-5 text-body font-bold disabled:opacity-50 ${focusRing}`}
          >
            {busy ? '更新しています…' : 'すべて既読にする'}
          </button>
        </div>
        {error && (
          <p role="alert" className="mb-4 text-body text-danger">
            {error}
          </p>
        )}
        {data.items.length === 0 ? (
          <p className="rounded-panel border border-line bg-surface p-7 text-body text-ink-muted">
            この種類のお知らせはありません。
          </p>
        ) : (
          <div className="grid gap-4">
            {data.items.map((item) => {
              const action = actionLabel(item)
              const tag = codeLabel(item)
              const canAct =
                action !== null &&
                (item.code === 'recording.upload_failed' || onOpenLedger !== undefined)
              return (
                <article
                  key={item.id}
                  className={cn(
                    'flex flex-col gap-3.5 rounded-panel border border-line bg-surface px-5 py-5 sm:flex-row',
                    item.readAt === null && 'border-l-4 border-l-danger',
                  )}
                >
                  <time className="w-13 shrink-0 pt-1 text-grid font-semibold text-ink-muted">
                    {formatTime(item.occurredAt)}
                  </time>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lead font-bold">
                      {item.title}{' '}
                      {item.severity === 'action' && (
                        <span className="inline-block rounded-ctl bg-danger-soft px-2 py-1 text-note text-danger">
                          対応が必要
                        </span>
                      )}
                      <span className="ml-2 inline-block rounded-ctl bg-pine-soft px-2 py-1 text-note text-pine">
                        {tag}
                      </span>
                      {item.readAt === null && (
                        <span className="ml-2 inline-block rounded-ctl border border-danger px-2 py-1 text-note text-danger">
                          未読
                        </span>
                      )}
                    </h2>
                    {item.body && <p className="mt-1.5 text-grid text-ink-muted">{item.body}</p>}
                  </div>
                  {item.resolvedAt === null && canAct && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => resolve(item)}
                      className={`min-h-11 self-center rounded-ctl border border-line-strong bg-surface px-4 text-note font-bold disabled:opacity-50 ${focusRing}`}
                    >
                      {action}
                    </button>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}

function actionLabel(item: Alert): string | null {
  if (item.code === 'recording.upload_failed') return 'もう一度送る'
  if (
    item.code === 'equipment.maintenance_scheduled' ||
    item.code === 'store.closed_with_reservations'
  )
    return '影響する予約を見る'
  if (opensLedger(item)) return '台帳で確認する'
  return null
}

function opensLedger(item: Alert): boolean {
  return (
    ['web_booking.pending', 'web_booking.auto_cancelled', 'reservation.unclosed'].includes(
      item.code,
    ) || ['equipment.maintenance_scheduled', 'store.closed_with_reservations'].includes(item.code)
  )
}

function codeLabel(item: Alert): string {
  if (item.code.startsWith('web_booking.')) return 'Web予約'
  if (item.code.startsWith('recording.')) return '録音'
  if (item.code.startsWith('equipment.')) return '設備'
  if (item.code.startsWith('reservation.')) return '予約'
  return '店舗'
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

function formatDay(now: Date): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(now)
}
