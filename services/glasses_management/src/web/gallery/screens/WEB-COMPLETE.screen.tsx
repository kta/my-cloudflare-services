import { PhoneBody, PhoneButton, PhoneHead, PhoneScreen, PhoneSummary } from '../../design/phone'

/*
 * WEB-COMPLETE — 承認済みモック `#complete`。
 *
 *   .complete{text-align:center;padding-top:80px}
 *   .complete strong{font-size:54px;color:var(--g)}
 *
 * ここだけ操作が下端に貼り付かない。成立を伝えるのが主で、変更・取消は
 * あくまで副導線だから、主操作の位置と重さを与えない。
 */
export default function WebComplete() {
  return (
    <PhoneScreen>
      <PhoneHead store="銀座店" progress={{ current: 5, total: 5 }} />
      <PhoneBody centered>
        {/* ✓ は和文書体が持たない記号なので、モックと同じ代替書体へ落とす。 */}
        <strong className="font-glyph text-glyph text-pine">✓</strong>
        <h1>予約を承りました</h1>
        <PhoneSummary>
          予約番号 EY-0828-1142
          <br />
          8月28日（金）11:00
          <br />
          銀座店
        </PhoneSummary>
        <PhoneButton>予約を変更・取り消す</PhoneButton>
      </PhoneBody>
    </PhoneScreen>
  )
}
