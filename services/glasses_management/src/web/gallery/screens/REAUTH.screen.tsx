import { AppBar, Screen, Wordmark } from '../../design/chrome'
import { Action } from '../../design/controls'
import { Card, TitleRow } from '../../design/surfaces'

/*
 * REAUTH — 承認済みモック `operations-approved.html#reauth`。
 *
 *   .content{padding:24px 30px;max-width:640px;margin:80px auto}
 *   .card{border-radius:9px;padding:14px}
 *   input{display:block;width:100%;min-height:52px;margin:8px 0 18px;
 *         border:1px solid var(--l);border-radius:8px;padding:12px;font-size:20px}
 *   .title{display:flex;align-items:center}  .push{margin-left:auto}
 *
 * 共有端末のまま個人を名乗り直させる面なので、バーはタブを持たない。
 * 今どの端末で誰として操作しているかだけを見せて、他所へ逃がさない。
 */

export default function Reauth() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店 レジ横iPad · 完全共有" />
      </AppBar>
      <main className="min-h-0 flex-1 overflow-auto font-sans">
        {/*
         * 個人を名乗り直すまで先へ進めない面なので、読み上げ上も dialog として
         * 閉じた場に置く。role は見た目を持たないので画素は動かない。
         */}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reauth-title"
          className="mx-auto my-20 w-full max-w-160 px-7.5 py-6"
        >
          <Card>
            <h1 id="reauth-title">管理者として確認してください</h1>
            <p>
              録音の保全指定は個人認証が必要です。共有端末と認証した個人の両方を監査記録に残します。
            </p>
            <label htmlFor="pin">個人PIN</label>
            {/*
             * 実測 min-height:52px に対して実際は 56px（20px の行 30px + 内側 24px
             * + 罫 2px）になる。高さを決め打ちせず、モックと同じ内側で組む。
             */}
            <input
              id="pin"
              inputMode="numeric"
              readOnly
              value="••••••"
              className="mt-2 mb-4.5 block min-h-13 w-full rounded-ctl border border-line bg-surface p-3 text-ink text-search"
            />
            <TitleRow
              gap={0}
              push={
                <Action variant="primary" inset="tight">
                  確認して続ける
                </Action>
              }
            >
              <Action inset="tight">キャンセル</Action>
            </TitleRow>
          </Card>
        </div>
      </main>
    </Screen>
  )
}
