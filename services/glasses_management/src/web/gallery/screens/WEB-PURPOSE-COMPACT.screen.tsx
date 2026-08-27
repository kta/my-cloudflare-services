import {
  CompactPhoneBody,
  CompactPhoneBookmark,
  CompactPhoneHead,
  CompactPhoneMuted,
  CompactPhoneNext,
  CompactPhoneOption,
  CompactPhoneQuestion,
  CompactPhoneScreen,
  PhoneStatusBar,
} from '../../design/phone'

/*
 * WEB-PURPOSE-COMPACT — 承認済みモック `web-booking-approved.html` の
 * 1 つ目の `.phone`（外枠 10px を除いた中身 322×660）。
 *
 * 顧客向け Web 予約には承認済みの方言が 2 つある。`-complete-` 版（359px・
 * 本文 16px）が `WEB-PURPOSE`、こちらが小さい端末での見え方で、選択肢は
 * 12px・見出しは 14px まで落ちる。どちらも却下されていないので両方を持つ。
 *
 * 目的ごとに所要時間を添えるのは、次の日時選びで空き枠の長さが変わるため。
 * 先に見せておかないと、時刻を選んでから「そんなにかかるのか」になる。
 */
export default function WebPurposeCompact() {
  return (
    <CompactPhoneScreen>
      <PhoneStatusBar time="9:41" right="5G　100%" />
      <CompactPhoneHead store="銀座店" progress={{ current: 1, total: 5 }} />
      <CompactPhoneBody>
        <CompactPhoneMuted>{'1 / 5　来店目的'}</CompactPhoneMuted>
        <CompactPhoneQuestion>今回はどのようなご相談ですか？</CompactPhoneQuestion>
        <CompactPhoneMuted as="p">
          一番近いものを選んでください。あとから変更できます。
        </CompactPhoneMuted>
        <CompactPhoneOption selected title="メガネを新しく作りたい">
          {'視力測定とフレーム・レンズ相談　約60分'}
        </CompactPhoneOption>
        <CompactPhoneOption title="今のメガネを調整したい">
          {'かかり具合、鼻パッド、ネジ調整　約20分'}
        </CompactPhoneOption>
        <CompactPhoneOption title="メガネを受け取りたい">
          {'完成品のお渡しと最終調整　約20分'}
        </CompactPhoneOption>
        <CompactPhoneNext>日時へ進む</CompactPhoneNext>
        <CompactPhoneBookmark>銀座店で予約</CompactPhoneBookmark>
      </CompactPhoneBody>
    </CompactPhoneScreen>
  )
}
