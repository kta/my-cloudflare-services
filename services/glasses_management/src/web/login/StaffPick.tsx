import type { StaffMember } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { StartBar } from './StartBar'

export function StaffPick({
  staff,
  offIds,
  onSelect,
  onShared,
}: {
  staff: readonly StaffMember[]
  offIds: ReadonlySet<string>
  onSelect: (staff: StaffMember) => void
  onShared: () => void
}) {
  const active = staff.filter((member) => member.isActive)
  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <StartBar mode="個人の端末" action="設定" />
      <main className="flex-1 overflow-auto px-11 py-10">
        <h1 className="text-title font-bold">業務を始めるスタッフを選んでください</h1>
        <p className="mt-1 text-body text-ink-muted">選んだ方の名前が、この日の記録に残ります。</p>
        {active.length === 0 ? (
          <section className="mt-8 rounded-panel border border-line-strong bg-surface p-7">
            <h2 className="text-lead font-bold">業務を始められるスタッフがいません</h2>
            <p className="mt-2 text-body text-ink-muted">設定でスタッフを足してください。</p>
            <button
              type="button"
              onClick={onShared}
              className={`mt-6 min-h-12 rounded-ctl bg-pine px-5 text-body font-bold text-on-pine ${focusRing}`}
            >
              みんなで使う端末にする
            </button>
          </section>
        ) : (
          <div className="mt-7 grid grid-cols-3 gap-4.5">
            {active.map((member) => {
              const off = offIds.has(member.id)
              return (
                <button
                  key={member.id}
                  type="button"
                  disabled={off}
                  onClick={() => onSelect(member)}
                  aria-label={`${member.displayName}${off ? ' 本日休み' : ''}`}
                  className={cn(
                    'flex min-h-29 items-center gap-5 rounded-card border px-5 text-left',
                    off
                      ? 'border-dashed border-line-strong bg-surface-2 text-ink-faint'
                      : 'border-line-strong bg-surface text-ink',
                    focusRing,
                  )}
                >
                  <span className="grid size-13 place-items-center rounded-circle border border-pine-line bg-pine-soft text-lead font-bold text-pine-deep">
                    {member.displayName.slice(0, 1)}
                  </span>
                  <span>
                    <span className="block text-lead font-bold">{member.displayName}</span>
                    <span className="mt-1 block text-note text-ink-muted">
                      {member.jobLabel ?? '担当'}　{off ? '本日休み' : '10:00–19:00'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
