import { PhoneBody, PhoneHead, PhonePrimary, PhoneScreen, PhoneSummary } from '../../design/phone'

/*
 * WEB-STORE-DETAIL — 承認済みモック `#store-detail`。
 *
 *   .summary{background:#f0f5f2;padding:14px;border-radius:9px}
 *   .primary{width:calc(100% - 40px);position:absolute;left:20px;bottom:20px}
 *
 * 店の事実（時間・住所・電話）は要約帯にまとめ、対応サービスは読み物として
 * 地の文に置く。予約を始める操作は本文の直後ではなく下端に貼り付く。
 */
export default function WebStoreDetail() {
  return (
    <PhoneScreen>
      <PhoneHead store="銀座店" />
      <PhoneBody>
        <h1>銀座店</h1>
        <PhoneSummary>
          営業時間 10:00–19:00
          <br />
          東京都中央区銀座…
          <br />
          03-1234-5678
        </PhoneSummary>
        <h2>対応サービス</h2>
        <p>メガネ新調、視力測定、フィッティング調整、修理受付</p>
      </PhoneBody>
      <PhonePrimary>銀座店で予約を始める</PhonePrimary>
    </PhoneScreen>
  )
}
