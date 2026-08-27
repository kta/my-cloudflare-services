import { PlainBar, Screen } from '../../design/chrome'
import { Action } from '../../design/controls'
import { FullScreenState } from '../../design/layouts'

/*
 * EX-EMPTY — 承認済みモック `#empty`。この面だけ 54px の記号を持たない
 * （空は異常ではないので、目を引く印を置かないというモックの判断）。
 */
export default function ExEmpty() {
  return (
    <Screen>
      <PlainBar subtitle="銀座店 · 受付履歴" />
      <FullScreenState title="条件に一致する受付履歴はありません">
        <p>検索語またはフィルターを変更してください。履歴自体は削除されていません。</p>
        <Action size="roomy" variant="primary">
          フィルターをすべて解除
        </Action>
      </FullScreenState>
    </Screen>
  )
}
