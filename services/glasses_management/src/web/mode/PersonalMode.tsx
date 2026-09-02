import type { StaffMember } from '@app/contracts'
import { cn, focusRing, Keypad, PinField } from '@app/ui'
import { useMemo, useState } from 'react'

export function PersonalMode({
  subject,
  staff,
  offIds,
  onConfirm,
  onCancel,
}: {
  subject: string
  staff: readonly StaffMember[]
  offIds: ReadonlySet<string>
  onConfirm: (staffId: string, pin: string) => Promise<boolean>
  onCancel: () => void
}) {
  const available = useMemo(
    () => staff.filter((member) => member.isActive && !offIds.has(member.id)),
    [offIds, staff],
  )
  const [staffId, setStaffId] = useState(available[0]?.id ?? '')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const selected = available.find((member) => member.id === staffId) ?? available[0]

  async function confirm() {
    if (!selected || pin.length < 4 || busy) return
    setBusy(true)
    setFailed(false)
    const ok = await onConfirm(selected.id, pin).catch(() => false)
    if (!ok) {
      setPin('')
      setFailed(true)
    }
    setBusy(false)
  }

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <header className="flex h-16 shrink-0 items-center bg-pine px-6 text-on-pine">
        <div>
          <p className="text-bar font-bold">EYEX 銀座店</p>
          <p className="text-note opacity-90">銀座店 レジ横iPad（みんなで使う端末）</p>
        </div>
        <span className="ml-auto rounded-ctl bg-surface px-3 py-1.5 text-grid font-semibold text-ink">
          いまは共有モード
        </span>
      </header>
      <main className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-auto px-10 py-9">
          <h1 className="text-title font-bold">{subject}にはご本人の確認が必要です</h1>
          <p className="mt-2 text-body text-ink-muted">操作するスタッフを選んでください。</p>
          <div className="mt-7 grid grid-cols-3 gap-4">
            {staff
              .filter((member) => member.isActive)
              .map((member) => {
                const off = offIds.has(member.id)
                return (
                  <button
                    key={member.id}
                    type="button"
                    disabled={off}
                    onClick={() => {
                      setStaffId(member.id)
                      setPin('')
                    }}
                    className={cn(
                      'flex min-h-28 items-center gap-4 rounded-card border bg-surface px-5 text-left',
                      member.id === selected?.id
                        ? 'border-3 border-pine bg-pine-soft'
                        : 'border-line-strong',
                      off && 'border-dashed opacity-55',
                      focusRing,
                    )}
                  >
                    <span className="grid size-13 place-items-center rounded-circle border border-pine-line bg-pine-soft text-lead font-bold text-pine-deep">
                      {member.displayName.slice(0, 1)}
                    </span>
                    <span>
                      <span className="block text-lead font-bold">{member.displayName}</span>
                      <span className="mt-1 block text-note text-ink-muted">
                        {member.jobLabel ?? '担当'}
                        {off ? '　本日休み' : ''}
                      </span>
                    </span>
                  </button>
                )
              })}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className={`mt-7 min-h-12 rounded-ctl border border-line-strong bg-surface px-5 text-body font-semibold ${focusRing}`}
          >
            やめて台帳に戻る
          </button>
        </section>
        <aside className="grid w-105 shrink-0 content-center justify-center border-l border-line bg-surface px-6 py-9">
          <p className="mb-5 text-body font-bold">
            {selected?.displayName ?? 'スタッフ'} さんの暗証番号　4〜6桁
          </p>
          <PinField value={pin} onChange={setPin} onConfirm={confirm} invalid={failed} />
          {failed && (
            <p role="alert" className="mt-2 text-grid text-danger">
              暗証番号が違います。
            </p>
          )}
          <div className="mt-6">
            <Keypad value={pin} onChange={setPin} onConfirm={confirm} />
          </div>
          {busy && (
            <p role="status" className="mt-2 text-grid text-ink-muted">
              確認しています…
            </p>
          )}
        </aside>
      </main>
    </div>
  )
}
