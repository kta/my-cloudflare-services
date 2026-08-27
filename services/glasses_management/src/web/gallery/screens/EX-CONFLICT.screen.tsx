import { PlainBar, Screen } from '../../design/chrome'
import { Action, Actions } from '../../design/controls'
import { Compare, ExceptionContent, Panel } from '../../design/layouts'

/*
 * EX-CONFLICT — 承認済みモック `#conflict`。
 *
 *   .compare{display:grid;grid-template-columns:1fr 1fr;gap:14px}
 *   `.panel` は `.compare` の中でも `margin-top:18px` を持つ（グリッド項目の
 *   余白は潰れないので、見出しとの間はこの 18px になる）。
 *
 * 2 つの内容を横に並べるのは、どちらを捨てるのかを読んでから選ばせるため。
 * 破棄は取り返しがつかないので `danger`。
 */
export default function ExConflict() {
  return (
    <Screen>
      <PlainBar subtitle="銀座店 · 顧客情報" />
      <ExceptionContent>
        <h1>別の端末で先に更新されています</h1>
        <Compare>
          <Panel>
            <b>最新の内容</b>
            <p>
              電話番号 090-1234-5678
              <br />
              メモ「PC作業用」
              <br />
              更新者: 銀座店 受付iPad 14:31
            </p>
          </Panel>
          <Panel tone="warning">
            <b>この端末の入力</b>
            <p>
              電話番号 090-1234-5678
              <br />
              メモ「PC作業用・鼻パッド低め」
            </p>
          </Panel>
        </Compare>
        <Actions>
          <Action size="roomy" variant="danger">
            この入力を破棄
          </Action>
          <Action size="roomy" variant="primary">
            最新内容へ再適用
          </Action>
        </Actions>
      </ExceptionContent>
    </Screen>
  )
}
