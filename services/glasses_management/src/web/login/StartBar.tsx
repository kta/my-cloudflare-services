import { focusRingOnPine } from '@app/ui'

/*
 * 業務を始めるまでの上のバー。
 *
 * 右の操作は **名前と押したときの動きを 1 つの組で受け取る**。
 * 以前は `action?: string` と `onAction?: () => void` を別々の任意プロパティにしており、
 * 置き場所選択とスタッフ選択が名前だけを渡していた。結果、両方の画面の右上に
 * 押しても何も起きない「設定」が出ていた（UX 監査 UI-ERR-02）。
 * 組にすれば、名前だけを渡すことが型のうえで書けなくなる。
 */
export function StartBar({
  mode,
  action,
  showWorkPrefix = true,
  title = 'EYE 銀座店',
}: {
  mode: string
  action?: { label: string; onPress: () => void }
  showWorkPrefix?: boolean
  /**
   * 左上に出す名前。既定はモック由来の店名で、承認済みの 3 面はこの値を使う。
   * **お店がまだ無い会社では実在しない店名を出してはならない**ので、最初のお店を
   * 登録する面は会社のコードを渡す（014-store-provisioning）。
   */
  title?: string
}) {
  return (
    <header className="flex h-16 shrink-0 items-center bg-pine px-6 text-on-pine">
      <div>
        <p className="text-bar font-bold">{title}</p>
        <p className="text-note opacity-90">{showWorkPrefix ? `業務を始める　${mode}` : mode}</p>
      </div>
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onPress}
          className={`ml-auto min-h-12 rounded-card px-3 text-lead font-semibold ${focusRingOnPine}`}
        >
          {action.label}
        </button>
      )}
    </header>
  )
}
