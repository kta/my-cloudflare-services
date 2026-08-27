import { PlainBar, Screen } from '../../design/chrome'
import { Action, Actions } from '../../design/controls'
import { ExceptionContent, Panel } from '../../design/layouts'

/*
 * EX-STORE-UNSAVED — 承認済みモック `#unsaved-store-switch`。
 * `.warning{border-color:#d4ad66;background:#fff6e5}`。
 *
 * 失敗ではなく警告なので琥珀。切替は入力と録音を捨てるので `danger` にし、
 * 主操作（そのまま入力を続ける）を先に置いて既定の逃げ道を作る。
 */
export default function ExStoreUnsaved() {
  return (
    <Screen>
      <PlainBar subtitle="銀座店 · 入力中の予約あり" />
      {/* 判断するまで台帳へ戻れない面なので、dialog として読み上げさせる。 */}
      <ExceptionContent dialogLabelledBy="unsaved-title">
        <h1 id="unsaved-title">店舗を切り替える前に確認してください</h1>
        <Panel tone="warning">
          <b>銀座店で入力中の予約があります</b>
          <p>入力内容と録音は丸の内店へ持ち越しません。</p>
        </Panel>
        <Actions>
          <Action size="roomy" variant="primary">
            銀座店で入力を続ける
          </Action>
          <Action size="roomy" variant="danger">
            入力を破棄して丸の内店へ切り替える
          </Action>
        </Actions>
      </ExceptionContent>
    </Screen>
  )
}
