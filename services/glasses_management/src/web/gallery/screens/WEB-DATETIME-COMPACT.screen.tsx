import {
  CompactPhoneBody,
  CompactPhoneBookmark,
  CompactPhoneDate,
  CompactPhoneDates,
  CompactPhoneHead,
  CompactPhoneMuted,
  CompactPhoneNext,
  CompactPhoneQuestion,
  CompactPhoneScreen,
  CompactPhoneSlot,
  CompactPhoneSlots,
  CompactPhoneSummary,
  PhoneStatusBar,
} from '../../design/phone'

/*
 * WEB-DATETIME-COMPACT — 承認済みモック `web-booking-approved.html` の
 * 2 つ目の `.phone`（中身 322×660）。
 *
 * 直前に選んだ目的と所要時間を要約帯で持ち越す。枠の長さがそれで決まるので、
 * 何を選んだかを見失ったまま時刻だけ選ばせない。日付と時刻を別の格子に
 * 分けているのは、日を決めてから時刻を選ぶ順序を崩さないため。
 *
 * 末尾の但し書きは、他店舗の空きが出ないことを先に断るためのもの。
 * 「空いていない」ではなく「この店舗だけを見ている」と書く。
 */
export default function WebDatetimeCompact() {
  return (
    <CompactPhoneScreen>
      <PhoneStatusBar time="9:41" right="5G　100%" />
      <CompactPhoneHead store="銀座店" progress={{ current: 2, total: 5 }} />
      <CompactPhoneBody>
        <CompactPhoneMuted>{'2 / 5　日時'}</CompactPhoneMuted>
        <CompactPhoneQuestion>ご希望の日時を選んでください</CompactPhoneQuestion>
        <CompactPhoneSummary>
          <b className="font-bold">メガネを新しく作りたい</b>
          <br />
          所要時間 約60分 · 銀座店
        </CompactPhoneSummary>
        <CompactPhoneDates>
          <CompactPhoneDate>
            8/27
            <br />木
          </CompactPhoneDate>
          <CompactPhoneDate selected>
            8/28
            <br />金
          </CompactPhoneDate>
          <CompactPhoneDate>
            8/29
            <br />土
          </CompactPhoneDate>
        </CompactPhoneDates>
        <CompactPhoneSlots>
          <CompactPhoneSlot>10:00</CompactPhoneSlot>
          <CompactPhoneSlot selected>11:00</CompactPhoneSlot>
          <CompactPhoneSlot>13:30</CompactPhoneSlot>
          <CompactPhoneSlot>15:00</CompactPhoneSlot>
        </CompactPhoneSlots>
        <CompactPhoneMuted as="p">この画面には銀座店の空きだけを表示しています。</CompactPhoneMuted>
        <CompactPhoneNext>お客様情報へ進む</CompactPhoneNext>
        <CompactPhoneBookmark>銀座店で予約</CompactPhoneBookmark>
      </CompactPhoneBody>
    </CompactPhoneScreen>
  )
}
