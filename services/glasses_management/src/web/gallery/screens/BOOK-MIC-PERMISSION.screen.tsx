import { AppBar, Screen, ScreenBody, Wordmark } from '../../design/chrome'
import { ConsentAction, ConsentSheet } from '../../design/layouts'

/*
 * BOOK-MIC-PERMISSION — 承認済みモック `approved.html#permission`。
 *
 *   .permission{max-width:660px;margin:90px auto;padding:32px;border-radius:14px}
 *                        → 面は x=258 / y=166、実高 261.8px
 *   h2（既定の 24px・margin .83em） → y=218.9  p（margin 1em） → y=274.8
 *   .actions{justify-content:flex-end;gap:12px;margin-top:24px} → y=346.8
 *
 * 断る側の操作を先に、太字にもせず同じ高さで並べる。録音は業務の都合であって
 * お客様の都合ではないので、断ることが例外に見えてはいけない。
 */

export default function BookMicPermission() {
  return (
    <Screen>
      <AppBar variant="booking">
        <Wordmark variant="booking" subtitle="銀座店 · 新規予約" />
      </AppBar>
      <ScreenBody>
        <ConsentSheet
          title="予約内容の復唱を記録します"
          actions={
            <>
              <ConsentAction>今回は録音せず続ける</ConsentAction>
              <ConsentAction primary>録音を開始する</ConsentAction>
            </>
          }
        >
          <p>
            予約受付中の周囲音を、聞き間違いの確認のために保存します。選択中店舗のスタッフが再生でき、成立予約は最低30日、破棄した受付は最低24時間保持します。
          </p>
        </ConsentSheet>
      </ScreenBody>
    </Screen>
  )
}
