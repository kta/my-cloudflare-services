import { PhoneBody, PhoneHead, PhoneOption, PhonePrimary, PhoneScreen } from '../../design/phone'

/*
 * WEB-PURPOSE — 承認済みモック `#purpose`。
 *
 *   .progress i{height:4px;flex:1;background:#ffffff55}.progress i.on{background:#fff}
 *   .option{border:1px solid var(--l);border-radius:9px;padding:14px;margin-top:10px}
 *   .option.selected{border:3px solid var(--g);background:var(--gs)}
 *
 * 目的ごとに所要時間を添えるのは、次の日時選びで空き枠の長さが変わるため。
 * 先に見せておかないと、時間を選んでから「そんなにかかるのか」になる。
 */
export default function WebPurpose() {
  return (
    <PhoneScreen>
      <PhoneHead store="銀座店" progress={{ current: 1, total: 5 }} />
      <PhoneBody>
        <small>1 / 5　来店目的</small>
        <h1>今回はどのようなご相談ですか？</h1>
        <PhoneOption selected>
          <b>メガネを新しく作りたい</b>
          <br />
          約60分
        </PhoneOption>
        <PhoneOption>
          <b>今のメガネを調整したい</b>
          <br />
          約20分
        </PhoneOption>
      </PhoneBody>
      <PhonePrimary>日時へ進む</PhonePrimary>
    </PhoneScreen>
  )
}
