import type { StaffMember } from '@app/contracts'
import { cn, focusRing, Keypad, PinField } from '@app/ui'
import { useState } from 'react'
import { refusalText, type SettingsActor } from './sections'

/*
 * 設定 6 面の上に固定する 56px のバー（承認済みモック SETTINGS-*.html の `.setbar`）。
 * 実測: 高さ 56px / padding 0 20px / 地 --color-surface / 下に 1px --color-line。
 * 見出し 17px 中央、ボタンは min-height 44px / padding 0 16px。
 *
 * 左は「変更を捨てる」。モックの「キャンセル」とは書かない —— 予約の「取り消し」と
 * 取り違えるため（P1 の決め #2。AC-SET-03 の「キャンセル」は操作の意味を指す）。
 */

export type SaveBarProps = {
  /** 面の名前（第2サイドバーの項目名と同じ）。 */
  title: string
  dirtyCount: number
  /** 影響が 1 件以上あるとき。未保存の札を赤くする（件数の文字はそのまま残す）。 */
  danger: boolean
  /** 赤くした理由を色以外でも伝える 1 行。`danger` が false なら null。 */
  dangerNote: string | null
  /** 保存を拒む 2 文。あれば「保存」を押せなくする。文そのものは面が画面に出す。 */
  blocked: string | null
  saving: boolean
  onSave: () => void
  onDiscard: () => void
}

export function SaveBar({
  title,
  dirtyCount,
  danger,
  dangerNote,
  blocked,
  saving,
  onSave,
  onDiscard,
}: SaveBarProps) {
  const dirty = dirtyCount > 0
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-5">
      <div className="flex flex-1 justify-start">
        <button
          type="button"
          onClick={onDiscard}
          disabled={!dirty || saving}
          className={cn(
            'min-h-11 rounded-ctl px-4 text-body font-semibold',
            dirty && !saving ? 'text-pine' : 'text-ink-faint',
            focusRing,
          )}
        >
          変更を捨てる
        </button>
      </div>

      <h2 className="text-lead font-bold text-ink">{title}</h2>

      <div className="flex flex-1 items-center justify-end gap-2.5">
        {/*
          件数の変化は割り込まない知らせとして 1 度だけ伝える（AC-SET-19）。
          接客中の読み上げを断ち切らないよう role="alert" にはしない。
        */}
        <p role="status" className="flex items-center gap-2.5">
          {/* 赤いだけで理由が分からない札を作らない（AC-SET-14 / AC-SET-18）。 */}
          {danger && dangerNote && (
            <span className="text-note font-semibold text-danger">{dangerNote}</span>
          )}
          {dirty && (
            <span
              className={cn(
                'inline-block min-h-5.5 rounded-ctl border px-2 py-px text-note font-semibold',
                danger
                  ? 'border-danger bg-danger-soft text-danger'
                  : 'border-line-strong bg-surface text-ink-muted',
              )}
            >
              未保存の変更 {dirtyCount}件
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || saving || blocked !== null}
          className={cn(
            'min-h-11 rounded-ctl px-4 text-body font-semibold',
            !dirty || saving || blocked !== null
              ? 'border border-line bg-surface-2 text-ink-faint'
              : 'bg-pine text-on-pine',
            focusRing,
          )}
        >
          {saving ? '保存しています…' : '保存'}
        </button>
      </div>
    </div>
  )
}

/**
 * 403 で跳ねられたときの断り（承認済みモック EX-PERMISSION.html）。
 * 打ち込んだ値は消さず、「下書きは残っています」の下に何を直したかを並べる。
 *
 * 「この下書きを店長に依頼する」のボタンは出さない —— 依頼の受け取り先が
 * まだ決まっていないので、押せて何も起きないボタンを作らない（P1 の決め #11 / Q-10）。
 * 店長の暗証番号での続行（EX-PERMISSION の右半分）は P10 の担当。
 */
export function PermissionRefusal({
  target,
  actor,
  changes,
  staff = [],
  onElevate,
}: {
  target: string
  actor: SettingsActor
  changes: readonly string[]
  staff?: readonly StaffMember[]
  onElevate?: (staffId: string, pin: string) => Promise<boolean>
}) {
  const managers = staff.filter((member) => member.isActive && member.role === 'manager')
  const [staffId, setStaffId] = useState(managers[0]?.id ?? '')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function confirmPin() {
    if (busy || pin.length < 4) return
    setBusy(true)
    setFailed(false)
    const ok = await onElevate?.(staffId, pin).catch(() => false)
    setFailed(!ok)
    if (!ok) setPin('')
    setBusy(false)
  }

  return (
    <div className="mb-6 rounded-panel border border-danger bg-danger-soft px-5.5 py-5">
      <h3 className="text-lead font-bold text-ink">この操作は店長だけができます</h3>
      <p className="mt-2 text-body leading-relaxed text-ink">{refusalText(target, actor)}</p>
      {changes.length > 0 && (
        <>
          <h4 className="mt-5 text-grid font-semibold text-ink-muted">下書きは残っています</h4>
          <ul className="mt-1">
            {changes.map((change) => (
              <li key={change} className="border-t border-line py-2 text-body first:border-t-0">
                {change}
              </li>
            ))}
          </ul>
        </>
      )}
      {onElevate && managers.length > 0 && (
        <div className="mt-5 border-t border-danger/30 pt-5">
          <h4 className="text-body font-bold">店長の暗証番号で続ける</h4>
          <div className="mt-3 grid gap-5 lg:grid-cols-2">
            <label className="grid min-w-52 gap-1 text-grid font-semibold">
              操作する店長
              <select
                value={staffId}
                onChange={(event) => setStaffId(event.target.value)}
                className={`min-h-11 rounded-ctl border border-line bg-surface px-3 text-body font-normal ${focusRing}`}
              >
                {managers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4">
              <PinField
                value={pin}
                onChange={setPin}
                onConfirm={() => void confirmPin()}
                label="店長の暗証番号"
                invalid={failed}
              />
              <Keypad
                value={pin}
                onChange={setPin}
                onConfirm={() => void confirmPin()}
                label="店長の暗証番号のテンキー"
                confirmLabel={busy ? '確認しています…' : '店長として続ける'}
              />
            </div>
          </div>
          {failed && (
            <p role="alert" className="mt-2 text-grid text-danger">
              暗証番号を確認できませんでした。
            </p>
          )}
        </div>
      )}
    </div>
  )
}
