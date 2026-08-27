import {
  PhoneBody,
  PhoneHead,
  PhoneOption,
  PhonePrimary,
  PhoneScreen,
  PhoneSummary,
} from '../../design/phone'

/*
 * WEB-DATETIME — 承認済みモック `#datetime`。
 *
 * 直前に選んだ目的と所要時間を要約帯で持ち越す。枠の長さがそれで決まるので、
 * 何を選んだかを見失ったまま時刻だけ選ばせない。
 */
export default function WebDatetime() {
  return (
    <PhoneScreen>
      <PhoneHead store="銀座店" progress={{ current: 2, total: 5 }} />
      <PhoneBody>
        <small>2 / 5　日時</small>
        <h1>ご希望の日時を選んでください</h1>
        <PhoneSummary>メガネを新しく作りたい · 約60分</PhoneSummary>
        <PhoneOption selected>8月28日（金）11:00</PhoneOption>
        <PhoneOption>8月28日（金）13:30</PhoneOption>
      </PhoneBody>
      <PhonePrimary>お客様情報へ進む</PhonePrimary>
    </PhoneScreen>
  )
}
