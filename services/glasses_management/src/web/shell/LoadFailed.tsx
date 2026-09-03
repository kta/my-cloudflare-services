import { focusRing } from '@app/ui'

/*
 * 読み込みに失敗したことを伝える面。**必ずその場でやり直す手立てを添える。**
 *
 * 以前は 7 つの設定パネルと分析・受付履歴が「画面を開き直してください」「もう一度
 * 読み込んでください」とだけ書いていた。ところがこの製品は画面ごとの URL を持たず、
 * 再読み込みすると置き場所選択と暗証番号からやり直しになる。
 * **指示されたことが実行できない**（UX 監査 UI-ERR-01）。
 * 予約台帳だけが「もう一度読み込む」ボタンを持っていたので、その形に揃える。
 */
export function LoadFailed({
  what,
  onRetry,
  hint,
}: {
  /** 何が読めなかったか。「営業日」「分析」のように、その面の名前を入れる。 */
  what: string
  onRetry: () => void
  /** 添える一言（「通信が切れているかもしれません。」など）。省いてよい。 */
  hint?: string
}) {
  return (
    <div role="alert" className="grid justify-items-start gap-3 p-8">
      <p className="text-body text-ink">
        {`${what}を読み込めませんでした。`}
        {hint !== undefined && hint}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className={`min-h-12 rounded-ctl bg-pine px-6 text-lead font-bold text-on-pine ${focusRing}`}
      >
        もう一度読み込む
      </button>
    </div>
  )
}
