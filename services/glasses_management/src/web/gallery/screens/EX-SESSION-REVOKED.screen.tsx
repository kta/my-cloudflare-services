import { PlainBar, Screen } from '../../design/chrome'
import { Action } from '../../design/controls'
import { FullScreenState } from '../../design/layouts'

/*
 * EX-SESSION-REVOKED — 承認済みモック `#session-revoked`。
 *
 * 失効した端末に残る操作は再登録の 1 つだけ。未送信の内容が送られないことを
 * 本文で明言するのは、受付が「送っておこう」と粘るのを止めるため。
 */
export default function ExSessionRevoked() {
  return (
    <Screen>
      <PlainBar subtitle="共有iPad" />
      <FullScreenState glyph="!" title="この端末の利用は停止されています">
        <p>
          共有セッションが管理者によって失効されました。未送信の顧客情報や録音は送信されません。
        </p>
        <Action size="roomy" variant="primary">
          端末を再登録する
        </Action>
      </FullScreenState>
    </Screen>
  )
}
