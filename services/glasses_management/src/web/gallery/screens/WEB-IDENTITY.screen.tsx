import { PhoneBody, PhoneHead, PhoneInput, PhonePrimary, PhoneScreen } from '../../design/phone'

/*
 * WEB-IDENTITY — 承認済みモック `#identity`。
 *
 * 有効期限と再送までの残りを同じ行に並べる。片方だけ見えていると、
 * 待てばよいのか入れ直すのかが判断できない。
 */
export default function WebIdentity() {
  return (
    <PhoneScreen>
      <PhoneHead store="予約の変更・取消" />
      <PhoneBody>
        <h1>本人確認コードを入力</h1>
        <p>電話番号末尾5678へ送信しました。</p>
        <PhoneInput inputMode="numeric" label="本人確認コード" value="123456" />
        <p>
          <small>有効期限 04:32 · 再送は00:28後</small>
        </p>
      </PhoneBody>
      <PhonePrimary>予約を表示する</PhonePrimary>
    </PhoneScreen>
  )
}
