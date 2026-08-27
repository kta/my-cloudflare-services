import { PlainBar, Screen } from '../../design/chrome'
import { Action } from '../../design/controls'
import { FullScreenState } from '../../design/layouts'

/*
 * EX-SHARED-LOCK — 承認済みモック `#shared-lock`。
 *   .lock{text-align:center;padding-top:90px}
 *   .lock strong{font-size:54px;color:var(--g)}
 *
 * 個人モードの入口を `<p>` に入れて 1 段離すのはモックどおり。共有端末では
 * 「再開」が既定で、個人モードは意図して選ぶものだと段で示している。
 */
export default function ExSharedLock() {
  return (
    <Screen>
      <PlainBar subtitle="銀座店 レジ横iPad · 完全共有" />
      <FullScreenState glyph="●" title="顧客情報を隠しました">
        <p>画面が非表示になったか、2分間操作がなかったためロックしました。</p>
        <Action size="roomy" variant="primary">
          業務を再開する
        </Action>
        <p>
          <Action size="roomy">個人モードで開始</Action>
        </p>
      </FullScreenState>
    </Screen>
  )
}
