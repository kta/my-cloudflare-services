import {
  PhoneBody,
  PhoneCard,
  PhoneHead,
  PhonePrimary,
  PhoneScreen,
  PhoneSummary,
} from '../../design/phone'

/*
 * WEB-UNKNOWN — 承認済みモック `#unknown`。
 *
 *   .error{background:#fff3e8;border-color:#c49550}
 *
 * 成立したか分からない状態。二重予約を防ぐため、再送ではなく「確認」を主操作に
 * 置き、照会番号を添えて問い合わせでも辿れるようにしている。
 */
export default function WebUnknown() {
  return (
    <PhoneScreen>
      <PhoneHead store="予約状況の確認" />
      <PhoneBody>
        {/*
         * 確認が進んでいることは見出しだけが持っている。読み上げでは
         * 「今どうなっているか」が伝わらないので、状態として告知する領域を
         * 添える。sr-only なので画素は変わらない。
         */}
        <h1>予約結果を確認しています</h1>
        <p role="status" aria-live="polite" className="sr-only">
          予約結果を確認しています
        </p>
        <PhoneCard tone="error">
          <b>通信が途中で切れました</b>
          <br />
          もう一度予約ボタンを押さず、この画面で成立状況を確認してください。
        </PhoneCard>
        <PhoneSummary>照会番号 CHECK-6F82</PhoneSummary>
      </PhoneBody>
      <PhonePrimary>成立状況を再確認する</PhonePrimary>
    </PhoneScreen>
  )
}
