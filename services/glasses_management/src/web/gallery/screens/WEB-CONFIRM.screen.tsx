import {
  PhoneBody,
  PhoneCard,
  PhoneHead,
  PhonePrimary,
  PhoneScreen,
  PhoneSummary,
} from '../../design/phone'

/*
 * WEB-CONFIRM — 承認済みモック `#confirm`。
 *
 * 予約の中身は要約帯、期限と案内の同意は白いカードに分ける。地色が違うことで
 * 「確認するもの」と「読んで納得するもの」が一目で分かれる。
 */
export default function WebConfirm() {
  return (
    <PhoneScreen>
      <PhoneHead store="銀座店" progress={{ current: 4, total: 5 }} />
      <PhoneBody>
        <small>4 / 5　確認</small>
        <h1>予約内容をご確認ください</h1>
        <PhoneSummary>
          銀座店
          <br />
          8月28日（金）11:00
          <br />
          メガネを新しく作りたい · 約60分
          <br />
          田中 花子
          <br />
          090-1234-5678
        </PhoneSummary>
        <PhoneCard>変更・取消期限と店舗からのご案内を確認しました。</PhoneCard>
      </PhoneBody>
      <PhonePrimary>この内容で予約する</PhonePrimary>
    </PhoneScreen>
  )
}
