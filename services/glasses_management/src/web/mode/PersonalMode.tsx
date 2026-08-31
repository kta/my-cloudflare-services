import { PinInvalidError, PinLockedError, type ReauthInput, TerminalSession } from '@app/contracts'
import { focusRing, Keypad, PinField } from '@app/ui'
import { useState } from 'react'
import { client } from '../client'
import { StartBar, StartBarButton } from '../login/StartBar'

/*
 * MODE-PERSONAL.png（UC-TERM-07 / AC-TERM-09 / AC-TERM-10）。
 *
 * 画面の計画（DESIGN_RULE パス 1）
 *   主役は 1 画面に 1 つ ——「いま誰が操作しているか」。テンキーは右 400px の道具。
 *   状態は色だけで伝えない —— 本日休みのタイルは押せないうえに「本日休み」と文字で言う。
 *   空いた場所を埋めるために要素を足さない —— タイルと「やめて台帳に戻る」で終わり。
 *
 * **平文の暗証番号は state の外へ出さない。**送るのは本文だけで、画面にも `console` にも
 * 出さない。昇格に通ったら**元の操作へ戻す**（やり直させない）。やめても下書きは消さない。
 */

export type ElevateReason = ReauthInput['reason']

export type ElevateCandidate = {
  id: string
  name: string
  /** 「視力測定・加工」。 */
  job: string
  offToday: boolean
}

const HEADINGS: Record<ElevateReason, string> = {
  recording: '録音の保全にはご本人の確認が必要です',
  attention: '注意ごとの公開にはご本人の確認が必要です',
  settings: '設定の変更にはご本人の確認が必要です',
  customer_merge: 'お客様のおまとめにはご本人の確認が必要です',
}

export function PersonalMode({
  storeName,
  terminalName,
  terminalId,
  reason,
  staff,
  onElevated,
  onCancel,
}: {
  storeName: string
  terminalName: string
  terminalId: string
  reason: ElevateReason
  staff: readonly ElevateCandidate[]
  /** 昇格できた。呼ぶ側は**元の操作の画面へ戻す**。 */
  onElevated: (session: TerminalSession, staffName: string) => void
  /** 「やめて台帳に戻る」。下書きは呼ぶ側が持ったままにする。 */
  onCancel: () => void
}) {
  const [picked, setPicked] = useState<ElevateCandidate | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (picked === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await client.api.staff.terminals[':terminalId'].elevate.$post({
        param: { terminalId },
        json: { staffId: picked.id, pin: value, reason },
      })
      const status: number = res.status
      if (status === 201) {
        onElevated(TerminalSession.parse(await res.json()), picked.name)
        return
      }
      setValue('')
      if (status === 401) {
        const left = PinInvalidError.parse(await res.json()).remainingAttempts
        setError(`暗証番号が違います。あと${left}回お試しいただけます。`)
        return
      }
      if (status === 429) {
        const wait = PinLockedError.parse(await res.json()).retryAfterSeconds
        setError(`暗証番号を3回続けて間違えました。あと${wait}秒お待ちください。`)
        return
      }
      setError('確認できませんでした。もう一度お試しください。')
    } catch {
      setValue('')
      setError('通信できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <StartBar
        storeName={storeName}
        subline={terminalName}
        actions={
          <>
            <span className="rounded-full bg-surface px-3 py-1 text-note font-semibold text-ink-muted">
              いまは共有モード
            </span>
            <StartBarButton label="やめる" onPress={onCancel} />
          </>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_400px]">
        <main className="min-h-0 overflow-auto px-10 py-10">
          <h1 className="text-title font-bold">{HEADINGS[reason]}</h1>
          <p className="mt-1 text-body text-ink-muted">操作するスタッフを選んでください。</p>

          <ul className="mt-3.5 grid grid-cols-3 gap-4">
            {staff.map((member) => (
              <li key={member.id}>
                <Tile
                  member={member}
                  selected={picked?.id === member.id}
                  onPick={() => {
                    setPicked(member)
                    setValue('')
                    setError(null)
                  }}
                />
              </li>
            ))}
          </ul>

          {error !== null && (
            <p role="status" className="mt-6 text-body text-danger">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={onCancel}
            className={`mt-8 min-h-12 rounded-card border border-line-strong bg-surface px-6 text-lead font-semibold text-ink ${focusRing}`}
          >
            やめて台帳に戻る
          </button>
        </main>

        <aside className="min-h-0 overflow-auto border-l border-line px-6 py-10">
          <p className="text-center text-lead">
            {picked === null
              ? '左でスタッフを選んでください'
              : `${picked.name} さんの暗証番号　4〜6桁`}
          </p>
          <div className="mt-6 grid justify-items-center gap-6">
            <PinField label="暗証番号" filled={value.length} />
            <Keypad
              value={value}
              onChange={setValue}
              onSubmit={submit}
              {...(picked === null ? { blockedReason: 'スタッフを選ぶと押せます' } : {})}
              readyHint="「確定」で個人モードになります"
            />
          </div>
        </aside>
      </div>
    </div>
  )
}

function Tile({
  member,
  selected,
  onPick,
}: {
  member: ElevateCandidate
  selected: boolean
  onPick: () => void
}) {
  const line = member.offToday ? `${member.job}　本日休み` : member.job
  return (
    <button
      type="button"
      disabled={member.offToday}
      onClick={onPick}
      aria-pressed={selected}
      className={`flex min-h-25 w-full items-center gap-4 rounded-card text-left ${focusRing} ${
        member.offToday
          ? 'cursor-not-allowed border border-dashed border-line-strong bg-surface-2 px-4 py-3.5 text-ink-faint'
          : selected
            ? 'border-3 border-pine bg-pine-soft px-3.5 py-3'
            : 'border border-line-strong bg-surface px-4 py-3.5'
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid size-11.5 shrink-0 place-items-center rounded-circle text-lead font-bold ${
          member.offToday
            ? 'bg-busy text-ink-faint'
            : selected
              ? 'bg-pine text-on-pine'
              : 'border border-pine-line bg-pine-soft text-pine-deep'
        }`}
      >
        {member.name.slice(0, 1)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-lead font-bold">{member.name}</span>
        <span className="mt-1 block truncate text-grid text-ink-muted">{line}</span>
      </span>
    </button>
  )
}
