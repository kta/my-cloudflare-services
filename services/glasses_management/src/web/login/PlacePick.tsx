import type { Terminal } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { useState } from 'react'
import { StartBar } from './StartBar'

export type PlaceTerminal = Terminal & { activeStaffName?: string }

export function PlacePick({
  terminals,
  onSelect,
  onChangeMode,
}: {
  terminals: readonly PlaceTerminal[]
  onSelect: (terminal: PlaceTerminal) => void
  onChangeMode: () => void
}) {
  const [selected, setSelected] = useState(terminals[0]?.id ?? null)
  const selectedTerminal = terminals.find((terminal) => terminal.id === selected) ?? null
  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <StartBar mode="みんなで使う端末" action="設定" />
      <main className="flex-1 overflow-auto px-11 py-10">
        <h1 className="text-title font-bold">この端末はどこに置きますか？</h1>
        <p className="mt-1 text-body text-ink-muted">
          選んだ置き場所の名前が、そのまま記録に残ります。
        </p>
        <div className="mt-7 grid grid-cols-3 gap-5">
          {terminals.map((terminal) => {
            const current = selected === terminal.id
            const status = terminal.activeStaffName
              ? `業務中（${terminal.activeStaffName}）`
              : terminal.isOnline
                ? 'まだ誰も使っていません'
                : 'つながっていません'
            return (
              <button
                key={terminal.id}
                type="button"
                onClick={() => setSelected(terminal.id)}
                aria-label={`${terminal.name} ${status}`}
                className={cn(
                  'min-h-29 rounded-card border bg-surface p-5 text-left',
                  current ? 'border-3 border-pine bg-pine-soft' : 'border-line-strong',
                  focusRing,
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-lead font-bold">{terminal.name}</span>
                  <span
                    className={cn(
                      'rounded-ctl px-2 py-px text-note font-semibold',
                      terminal.isOnline ? 'text-ink-muted' : 'bg-danger-soft text-danger',
                    )}
                  >
                    {current
                      ? '選択中'
                      : terminal.activeStaffName
                        ? '業務中'
                        : !terminal.isOnline
                          ? 'つながっていません'
                          : ''}
                  </span>
                </span>
                <span className="mt-4 block border-t border-line pt-4 text-note text-ink-muted">
                  {terminal.placeNote}
                </span>
                <span className="mt-2 block text-note text-ink-muted">{status}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-8 flex justify-end gap-4">
          <button
            type="button"
            onClick={onChangeMode}
            className={`min-h-14 px-5 font-semibold text-pine ${focusRing}`}
          >
            使い方を変える
          </button>
          <button
            type="button"
            disabled={selectedTerminal === null}
            onClick={() => selectedTerminal && onSelect(selectedTerminal)}
            className={`min-h-14 rounded-ctl bg-pine px-7 text-lead font-bold text-on-pine disabled:opacity-50 ${focusRing}`}
          >
            この置き場所で始める
          </button>
        </div>
      </main>
    </div>
  )
}
