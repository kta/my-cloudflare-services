import { focusRing, focusRingOnPine } from '@app/ui'

/*
 * テンキー（承認済みモック docs/frontend/mockups/eye/images/BOOK-04c-KEYPAD.png）。
 *
 * 受話器を持ったまま片手で打つための盤。**キーは 72pt** で、44pt の下限より大きく取る
 * （`design/06-use-cases.md` IDX-BOOK-08 の検証点）。
 *
 * 実測値（screens/BOOK-04c-KEYPAD.html と assets/eye.css の `.keypad` / `.key`）:
 *   3 列 × 96px・間 12px、キーの高さ 72px、角 12px、数字 28px。
 *   最下段は「削除」「0」「完了」で、確定キーだけが `--color-pine` の塗り。
 *
 * **最下段をモックのまま「削除／0／完了」にした。**TODO は「左下ハイフン／中央下 0／右下完了」
 * かつ「削除は 3 行目の左」と言うが、その根拠（「承認済みモック 7 面のうち 5 面が
 * 左下ハイフン・右下削除」）を数えると**逆**で、7 面のうち 5 面（BOOK-04c /
 * LOGIN-SHARED-PIN / LOGIN-PIN-ERROR / LOGIN-STAFF-PIN / MODE-PERSONAL）が
 * 左下「削除」・右下「確定／完了」である。3 列 4 行に 13 キーは入らないので
 * 「左下ハイフン」と「削除は 3 行目の左」は同時に成り立たない。承認済みモックを採る。
 * ハイフンのキーは置かない —— 欄が桁数から自動で整形するので、押しても意味が無い。
 *
 * 確定キーの語は面ごとに変える（電話番号は「完了」、暗証番号は「確定」）ので `confirmLabel`
 * で受ける。押せないときは**必ず理由を持たせる**（`07-nfr.md` §2.3）。
 */

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/** キー 1 つ。96×72px・角 12px。数字は 28px、語は 16px/600。 */
const KEY = `h-18 w-24 rounded-card border border-line-strong bg-surface text-ink ${focusRing}`

export type KeypadProps = {
  /** 盤ぜんたいの読み上げ名（「電話番号のテンキー」）。 */
  label: string
  onDigit: (digit: string) => void
  onDelete: () => void
  onConfirm: () => void
  /** 確定キーの語。電話番号の面は「完了」、暗証番号の面は「確定」。 */
  confirmLabel: string
  /** 確定キーが押せない理由（「あと3桁で押せます」）。押せるときは null。 */
  confirmBlockedReason?: string | null
  /** キーの下の 1 行（「あと3桁で「完了」を押せます」）。 */
  hint?: string | null
}

export function Keypad({
  label,
  onDigit,
  onDelete,
  onConfirm,
  confirmLabel,
  confirmBlockedReason = null,
  hint = null,
}: KeypadProps) {
  const blocked = confirmBlockedReason !== null
  return (
    <div>
      <fieldset aria-label={label} className="mx-auto grid w-fit min-w-0 grid-cols-3 gap-3">
        {DIGITS.map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => onDigit(digit)}
            className={`${KEY} text-hero`}
          >
            {digit}
          </button>
        ))}
        <button type="button" onClick={onDelete} className={`${KEY} text-body font-semibold`}>
          削除
        </button>
        <button type="button" onClick={() => onDigit('0')} className={`${KEY} text-hero`}>
          0
        </button>
        <button
          type="button"
          disabled={blocked}
          aria-label={blocked ? `${confirmLabel}　${confirmBlockedReason}` : undefined}
          onClick={onConfirm}
          className={
            blocked
              ? `h-18 w-24 rounded-card border border-line bg-surface-2 text-body font-semibold text-ink-faint ${focusRing}`
              : `h-18 w-24 rounded-card border border-pine bg-pine text-body font-bold text-on-pine ${focusRingOnPine}`
          }
        >
          {confirmLabel}
        </button>
      </fieldset>
      {hint !== null && <p className="mt-5 text-center text-grid text-ink-muted">{hint}</p>}
    </div>
  )
}
