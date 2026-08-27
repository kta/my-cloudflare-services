import { PlainBar, Screen } from '../../design/chrome'
import { Action, Actions } from '../../design/controls'
import { ExceptionContent, Panel } from '../../design/layouts'

/*
 * EX-MIC-DENIED — 承認済みモック `exception-states-approved.html#mic-denied`。
 *
 *   .content{padding:34px;max-width:900px;margin:auto}
 *   .panel{border:1px solid var(--l);border-radius:12px;padding:24px;margin-top:18px}
 *   .error{border-color:#d2a099;background:#fff1ed}
 *   .actions{display:flex;gap:12px;justify-content:flex-end;margin-top:20px}
 *
 * 録音は始まらないが予約入力は生きている。だから「破棄」は既定の見た目のまま
 * 一番左に置き、押しやすい右端は回復（権限を再確認）に取ってある。
 */
export default function ExMicDenied() {
  return (
    <Screen>
      <PlainBar subtitle="銀座店 · 新規予約" />
      <ExceptionContent>
        <h1>録音を開始できません</h1>
        <Panel tone="error">
          <b>Safariでマイクが許可されていません</b>
          <p>
            iPadの「設定」→「Safari」→「マイク」でEYEX予約へのアクセスを許可してから、もう一度お試しください。
          </p>
        </Panel>
        <Actions>
          <Action size="roomy">予約入力を破棄</Action>
          <Action size="roomy">録音なしで続ける</Action>
          <Action size="roomy" variant="primary">
            権限を再確認
          </Action>
        </Actions>
      </ExceptionContent>
    </Screen>
  )
}
