import { PlainBar, Screen } from '../../design/chrome'
import { Action, Actions } from '../../design/controls'
import { ExceptionContent, Panel } from '../../design/layouts'

/*
 * EX-UPLOAD-FAILED — 承認済みモック `#upload-failed`。実測はモック冒頭の CSS
 * （`.panel` 24px / `.error` #d2a099 · #fff1ed / `.actions` gap 12px）どおり。
 *
 * 見出しは「成立した」を先に言い、失敗しているのは録音だけだと分かるように
 * 赤い面を見出しの下へ従える。再試行の回数と時刻を出すのは、同じ送信キーで
 * 自動再試行が続いていることを受付が読み取れるようにするため。
 */
export default function ExUploadFailed() {
  return (
    <Screen>
      <PlainBar subtitle="銀座店 · 予約 EY-0828-1142" />
      <ExceptionContent>
        <h1>予約は成立しました</h1>
        <Panel tone="error">
          <b>録音を保存できていません</b>
          <p>
            予約内容は登録済みです。録音は端末内の受付セッションに保持され、通信回復後に同じ送信キーで再試行します。
          </p>
          <p>再試行 2/5 · 最終試行 14:32</p>
        </Panel>
        <Actions>
          <Action size="roomy">予約詳細を見る</Action>
          <Action size="roomy" variant="primary">
            今すぐ再試行
          </Action>
        </Actions>
      </ExceptionContent>
    </Screen>
  )
}
