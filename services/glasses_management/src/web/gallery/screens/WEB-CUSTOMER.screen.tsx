import { PhoneBody, PhoneField, PhoneHead, PhonePrimary, PhoneScreen } from '../../design/phone'

/*
 * WEB-CUSTOMER — 承認済みモック `#customer-info`。
 *
 *   input{width:100%;min-height:50px;border:1px solid var(--l);
 *         border-radius:9px;padding:12px}
 *
 * 突き合わせ台は静止画なので値は固定で持つ（通信も入力の検証もここには無い）。
 */
export default function WebCustomer() {
  return (
    <PhoneScreen>
      <PhoneHead store="銀座店" progress={{ current: 3, total: 5 }} />
      <PhoneBody>
        <small>3 / 5　お客様情報</small>
        <h1>ご連絡先を入力してください</h1>
        <PhoneField label="お名前" value="田中 花子" />
        <PhoneField label="電話番号" inputMode="tel" value="090-1234-5678" />
        <PhoneField label="メールアドレス" inputMode="email" value="hanako@example.jp" />
      </PhoneBody>
      <PhonePrimary>確認へ進む</PhonePrimary>
    </PhoneScreen>
  )
}
