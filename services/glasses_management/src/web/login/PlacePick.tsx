import type { Terminal } from '@app/contracts'
import { focusRing } from '@app/ui'
import { useEffect, useState } from 'react'
import { client } from '../client'
import { StartBar, StartBarButton } from './StartBar'

/*
 * LOGIN-SHARED。据え置く場所を選ぶ 1 面。
 *
 * 画面の計画（DESIGN_RULE パス 1）
 *   主役は 1 画面に 1 つ ——「どの置き場所か」。
 *   状態は色だけで伝えない ——「まだ誰も使っていません」「業務中」「つながっていません」は札の文字。
 *   説明文は 2 つまで・各 1 行。空いた場所を埋めるために要素を足さない。
 */

/**
 * 置き場所の状態。`terminals` は「いま誰が使っているか」を列に持たないので、
 * `lastSeenAt` と `isOnline`（サーバが 5 分で計算する）から 3 つに読み分ける。
 *   一度も通信していない → まだ誰も使っていません
 *   5 分以内に通信した   → 業務中
 *   それ以外             → つながっていません（最終通信 …）
 */
function placeStatus(terminal: Terminal): { label: string; danger: boolean } {
  if (terminal.lastSeenAt === null) return { label: 'まだ誰も使っていません', danger: false }
  if (terminal.isOnline) return { label: '業務中', danger: false }
  return { label: 'つながっていません', danger: true }
}

export function PlacePick({
  storeId,
  storeName,
  onPick,
  onChangeMode,
  onQuit,
}: {
  storeId: string
  storeName: string
  onPick: (terminal: Terminal) => void
  /** 「使い方を変える」。START-DEVICE-MODE へ戻る（AC-TERM-21）。 */
  onChangeMode: () => void
  onQuit: () => void
}) {
  const [items, setItems] = useState<Terminal[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    client.api.staff.terminals
      .$get({ query: { storeId, kind: 'shared' } })
      .then(async (res) => {
        if (!live) return
        if (!res.ok) {
          setError('置き場所を読み込めませんでした。画面を開き直してください。')
          return
        }
        const body = await res.json()
        if (!live) return
        setItems(body.items)
        setSelected(body.items[0]?.id ?? null)
      })
      .catch(() => {
        if (live) setError('通信できませんでした。画面を開き直してください。')
      })
    return () => {
      live = false
    }
  }, [storeId])

  const chosen = items?.find((item) => item.id === selected) ?? null

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <StartBar
        storeName={storeName}
        subline="業務を始める　みんなで使う端末"
        actions={<StartBarButton label="やめる" onPress={onQuit} />}
      />
      <main className="min-h-0 flex-1 overflow-auto px-11 py-10">
        <h1 className="text-title font-bold">この端末はどこに置きますか？</h1>
        <p className="mt-1 text-body text-ink-muted">
          選んだ置き場所の名前が、そのまま記録に残ります。
        </p>

        {error !== null ? (
          <p role="status" className="mt-7.5 text-body text-danger">
            {error}
          </p>
        ) : items === null ? (
          <p role="status" className="mt-7.5 text-body text-ink-muted">
            読み込んでいます…
          </p>
        ) : items.length === 0 ? (
          <div className="mt-7.5 max-w-160 rounded-panel border border-line-strong bg-surface p-7">
            <h2 className="text-lead font-bold">置き場所がまだ登録されていません</h2>
            <p className="mt-2 text-body leading-relaxed text-ink-muted">
              「設定 › 端末」で置き場所を足すと、ここに並びます。
            </p>
          </div>
        ) : (
          <>
            <ul className="mt-7.5 grid grid-cols-3 gap-5">
              {items.map((terminal) => (
                <li key={terminal.id}>
                  <PlaceCard
                    terminal={terminal}
                    selected={terminal.id === selected}
                    onSelect={() => setSelected(terminal.id)}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-8.5 flex items-center justify-end gap-6">
              <button
                type="button"
                onClick={onChangeMode}
                className={`min-h-11 rounded-card px-3 text-lead font-semibold text-pine ${focusRing}`}
              >
                使い方を変える
              </button>
              <button
                type="button"
                disabled={chosen === null}
                onClick={() => chosen !== null && onPick(chosen)}
                className={`min-h-14 rounded-card bg-pine px-7 text-lead font-bold text-on-pine disabled:opacity-60 ${focusRing}`}
              >
                この置き場所で始める
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function PlaceCard({
  terminal,
  selected,
  onSelect,
}: {
  terminal: Terminal
  selected: boolean
  onSelect: () => void
}) {
  const status = placeStatus(terminal)
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`w-full rounded-card text-left ${focusRing} ${
        selected
          ? 'border-3 border-pine bg-pine-soft px-4.5 py-4'
          : 'border border-line-strong bg-surface px-5.5 py-5'
      }`}
    >
      <span className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-lead font-bold">{terminal.name}</span>
        {/* 選択中も状態も、色ではなく札の文字で言う。 */}
        <span
          className={`grid min-h-5.5 place-items-center rounded-ctl px-2 text-note font-semibold ${
            selected
              ? 'border border-pine-line bg-surface text-pine-deep'
              : status.danger
                ? 'bg-danger-soft text-danger'
                : 'border border-line-strong bg-surface text-ink-muted'
          }`}
        >
          {selected ? '選択中' : status.label}
        </span>
      </span>
      <span className="mt-4 block border-t border-line pt-4 text-grid text-ink-muted">
        <span className="block">{terminal.placeNote}</span>
        {/* 選択中は札が「選択中」に変わるので、状態の文字をこちらへ移して読めたままにする。 */}
        <span className="mt-2 block">
          {selected ? status.label : status.danger ? lastSeenNote(terminal.lastSeenAt) : ''}
        </span>
      </span>
    </button>
  )
}

function lastSeenNote(lastSeenAt: string | null): string {
  if (lastSeenAt === null) return ''
  const at = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(lastSeenAt))
  return `最終通信　${at}`
}
