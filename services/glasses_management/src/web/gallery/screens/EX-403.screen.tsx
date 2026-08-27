import { PlainBar, Screen } from '../../design/chrome'
import { Action } from '../../design/controls'
import { FullScreenState } from '../../design/layouts'

/*
 * EX-403 — 承認済みモック `#permission-denied`。
 *
 * 記号は「—」で、設定の名前も件数も出さない。存在自体を漏らさないという
 * 方針をモックが記号と文言の両方で表している。
 */
export default function Ex403() {
  return (
    <Screen>
      <PlainBar subtitle="銀座店 · 設定" />
      <FullScreenState glyph="—" title="この設定を表示する権限がありません">
        <p>権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。</p>
        <Action size="roomy" variant="primary">
          業務開始画面へ戻る
        </Action>
      </FullScreenState>
    </Screen>
  )
}
