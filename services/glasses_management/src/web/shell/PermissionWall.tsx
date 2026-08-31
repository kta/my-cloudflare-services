import { PinInvalidError, PinLockedError, TerminalSession } from '@app/contracts'
import { cn, focusRing, Keypad, PinField, TryMeter } from '@app/ui'
import { useState } from 'react'
import { client } from '../client'

/*
 * EX-PERMISSION（承認済みモック docs/frontend/mockups/eyex/images/EX-PERMISSION.png）。
 * 403 を受けた**その場**に出す。設定の先頭へ戻さない。
 *
 * 画面の計画（DESIGN_RULE パス 1）
 *   主役は 1 画面に 1 つ ——「いま何が起きていないか」。左は警告のカードと下書きだけ。
 *   状態を色だけで伝えない —— 赤いカードには必ず「設定はまだ何も変わっていません。」が付く。
 *   空いた場所を埋めない ——「この下書きを店長に依頼する」は**出さない**（依頼を立てる
 *   `AlertCode` が許可リストに無い。押せて何も起きないボタンを置かない）。
 *
 * 実測: 枠 1fr + 400px ／ 左 padding 40px・右 padding 40px 32px + 左 1px --color-line。
 * 警告のカード = 地 --color-danger-soft・角 16px・左 6px --color-danger・見出し 22px。
 */

export type PermissionWallProps = {
  terminalId: string
  /** その場にいる店長。この人の暗証番号で続ける。 */
  managerStaffId: string
  /** 変えようとしたもの（「営業時間・定休日」）。 */
  target: string
  /** 足りない権限の名前（「設定の変更」）。 */
  permission: string
  actor: { name: string; roleLabel: string }
  /** 打ちかけの下書き。**捨てない。** */
  changes: readonly string[]
  /** 暗証番号が通ったとき。呼び出し元がもう一度保存を投げる。 */
  onElevated: () => void
  onBack: () => void
}

export function PermissionWall({
  terminalId,
  managerStaffId,
  target,
  permission,
  actor,
  changes,
  onElevated,
  onBack,
}: PermissionWallProps) {
  const [value, setValue] = useState('')
  const [remaining, setRemaining] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [lockSeconds, setLockSeconds] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await client.api.staff.terminals[':terminalId'].elevate.$post({
        param: { terminalId },
        json: { staffId: managerStaffId, pin: value, reason: 'settings' },
      })
      const status: number = res.status
      if (status === 201) {
        TerminalSession.parse(await res.json())
        setValue('')
        onElevated()
        return
      }
      setValue('')
      if (status === 401) {
        setFailed(true)
        setRemaining(PinInvalidError.parse(await res.json()).remainingAttempts)
        return
      }
      if (status === 429) {
        setFailed(true)
        setRemaining(0)
        setLockSeconds(PinLockedError.parse(await res.json()).retryAfterSeconds)
        return
      }
      setError('続けられませんでした。もう一度お試しください。')
    } catch {
      setValue('')
      setError('通信できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  const locked = lockSeconds !== null && lockSeconds > 0

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_400px]">
      <div className="min-h-0 overflow-auto p-10">
        <section className="rounded-panel border-l-6 border-l-danger bg-danger-soft px-7 py-6">
          <h2 className="text-title font-bold text-danger">この操作は店長だけができます</h2>
          <p className="mt-2.5 text-body leading-relaxed text-ink">
            {`${target}を変えられるのは 店長 だけです。${actor.name}（${actor.roleLabel}）の権限では保存できません。設定はまだ何も変わっていません。`}
          </p>
          <p className="mt-2.5 text-body text-ink">
            <span className="text-ink-muted">足りない権限　</span>
            <span className="font-semibold">{permission}</span>
          </p>
        </section>

        {changes.length > 0 && (
          <>
            <h3 className="mt-7 text-body font-bold text-ink">下書きは残っています</h3>
            <ul aria-label="下書きは残っています" className="mt-1">
              {changes.map((change) => (
                <li key={change} className="border-b border-line py-3.5 text-body text-ink">
                  {change}
                </li>
              ))}
            </ul>
          </>
        )}

        <button
          type="button"
          onClick={onBack}
          className={cn(
            'mt-7 min-h-12 rounded-ctl px-4 text-lead font-semibold text-pine',
            focusRing,
          )}
        >
          設定に戻る
        </button>
      </div>

      <section
        aria-label="店長の暗証番号"
        className="grid min-h-0 content-start justify-center gap-5 overflow-auto border-l border-line bg-surface px-8 py-10"
      >
        <div>
          <h3 className="text-body font-bold text-ink">店長の暗証番号で続ける</h3>
          <p className="mt-1 text-note text-ink-muted">
            店長がその場にいらっしゃるときは、ここで入れていただけます。
          </p>
        </div>
        <PinField
          label="店長の暗証番号"
          filled={value.length}
          invalid={failed && value.length === 0}
        />
        {failed && !locked && (
          <p role="status" className="text-note text-danger">
            暗証番号が違います。あと{remaining ?? 0}回お試しいただけます。
            <TryMeter used={3 - (remaining ?? 0)} />
          </p>
        )}
        {locked && (
          <p role="status" className="text-note text-danger">
            あと{lockSeconds}秒お待ちください。
          </p>
        )}
        {error !== null && (
          <p role="status" className="text-note text-danger">
            {error}
          </p>
        )}
        <Keypad
          value={value}
          onChange={setValue}
          onSubmit={() => {
            void submit()
          }}
          readyHint="「確定」でこの操作を続けます"
          {...(locked ? { blockedReason: `あと${lockSeconds}秒お待ちください` } : {})}
        />
      </section>
    </div>
  )
}
