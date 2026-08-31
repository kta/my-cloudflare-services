import type { StaffMember, StaffShift } from '@app/contracts'
import { focusRing } from '@app/ui'
import { useEffect, useState } from 'react'
import { client } from '../client'
import { StartBar, StartBarButton } from './StartBar'

/*
 * LOGIN-STAFF。個人の端末で業務を始める人を、技能と本日の勤務を見ながら選ぶ 1 面。
 *
 * 画面の計画（DESIGN_RULE パス 1）
 *   主役は 1 画面に 1 つ ——「誰が業務を始めるか」。タイルは箱ではなく行として数える。
 *   状態は色だけで伝えない —— 休みのタイルは押せないうえに「本日休み」と文字で言う。
 *   空いた場所を埋めるために要素を足さない —— 6 枚で終わり。下は空けたままにする。
 */

export type PickedStaff = {
  id: string
  name: string
  /** 「視力測定・加工　／　本日の勤務 10:00–19:00」。 */
  note: string
}

type Row = { member: StaffMember; hours: string | null }

export function StaffPick({
  storeId,
  storeName,
  today,
  onPick,
  onShared,
  onQuit,
}: {
  storeId: string
  storeName: string
  /** 本日（JST の暦日）。端末の時計を画面の側で読まない。 */
  today: string
  onPick: (staff: PickedStaff) => void
  /** 行き止まりにしないための逃げ道。共有端末として始め直す。 */
  onShared: () => void
  onQuit: () => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([
      client.api.staff.stores[':storeId'].staff.$get({ param: { storeId } }),
      client.api.staff.stores[':storeId']['staff-shifts'].$get({
        param: { storeId },
        query: { from: today, to: today },
      }),
    ])
      .then(async ([staffRes, shiftRes]) => {
        if (!live) return
        if (!staffRes.ok || !shiftRes.ok) {
          setError('スタッフを読み込めませんでした。画面を開き直してください。')
          return
        }
        const members: StaffMember[] = await staffRes.json()
        const shifts: StaffShift[] = await shiftRes.json()
        if (!live) return
        setRows(
          members
            .filter((member) => member.isActive)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((member) => ({ member, hours: hoursOf(shifts, member.id) })),
        )
      })
      .catch(() => {
        if (live) setError('通信できませんでした。画面を開き直してください。')
      })
    return () => {
      live = false
    }
  }, [storeId, today])

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <StartBar
        storeName={storeName}
        subline="業務を始める　個人の端末"
        actions={<StartBarButton label="やめる" onPress={onQuit} />}
      />
      <main className="min-h-0 flex-1 overflow-auto px-11 py-10">
        <h1 className="text-title font-bold">業務を始めるスタッフを選んでください</h1>
        <p className="mt-1 text-body text-ink-muted">選んだ方の名前が、この日の記録に残ります。</p>

        {error !== null ? (
          <p role="status" className="mt-7.5 text-body text-danger">
            {error}
          </p>
        ) : rows === null ? (
          <p role="status" className="mt-7.5 text-body text-ink-muted">
            読み込んでいます…
          </p>
        ) : rows.length === 0 ? (
          /* 有効なスタッフが 0 人でも行き止まりにしない（案内と、共有端末への逃げ道）。 */
          <div className="mt-7.5 max-w-160 rounded-panel border border-line-strong bg-surface p-7">
            <h2 className="text-lead font-bold">この店舗には、まだ使えるスタッフがいません</h2>
            <p className="mt-2 text-body leading-relaxed text-ink-muted">
              「設定 › スタッフ」でスタッフを足すと、ここに並びます。
              いますぐ業務を始めるときは、みんなで使う端末として置いてください。
            </p>
            <button
              type="button"
              onClick={onShared}
              className={`mt-6 min-h-12 rounded-card bg-pine px-6 text-lead font-bold text-on-pine ${focusRing}`}
            >
              みんなで使う端末にする
            </button>
          </div>
        ) : (
          <ul className="mt-7.5 grid grid-cols-3 gap-4.5">
            {rows.map(({ member, hours }) => (
              <li key={member.id}>
                <Tile member={member} hours={hours} onPick={onPick} />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}

function Tile({
  member,
  hours,
  onPick,
}: {
  member: StaffMember
  hours: string | null
  onPick: (staff: PickedStaff) => void
}) {
  const off = hours === null
  const job = member.jobLabel ?? ''
  const line = off ? `${job}　本日休み` : `${job}　${hours}`
  return (
    <button
      type="button"
      disabled={off}
      onClick={() => onPick({ id: member.id, name: member.displayName, note: noteOf(job, hours) })}
      className={`flex min-h-29 w-full items-center gap-5 rounded-card px-5 py-4 text-left ${focusRing} ${
        off
          ? 'cursor-not-allowed border border-dashed border-line-strong bg-surface-2 text-ink-faint'
          : 'border border-line-strong bg-surface'
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid size-13 shrink-0 place-items-center rounded-circle text-lead font-bold ${
          off ? 'bg-busy text-ink-faint' : 'border border-pine-line bg-pine-soft text-pine-deep'
        }`}
      >
        {member.displayName.slice(0, 1)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-lead font-bold">{member.displayName}</span>
        <span className={`mt-1 block truncate text-grid ${off ? '' : 'text-ink-muted'}`}>
          {line}
        </span>
      </span>
    </button>
  )
}

/** 本日の勤務（`kind: 'work'`）だけを見る。休憩は勤務時間の表示に混ぜない。 */
function hoursOf(shifts: StaffShift[], staffId: string): string | null {
  const work = shifts.filter((shift) => shift.staffId === staffId && shift.kind === 'work')
  const first = work[0]
  const last = work[work.length - 1]
  if (first === undefined || last === undefined) return null
  return `${first.startsAt}–${last.endsAt}`
}

function noteOf(job: string, hours: string | null): string {
  return hours === null ? `${job}　／　本日休み` : `${job}　／　本日の勤務 ${hours}`
}
