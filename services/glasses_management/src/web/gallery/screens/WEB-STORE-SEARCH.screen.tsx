import {
  PhoneBody,
  PhoneButton,
  PhoneCard,
  PhoneHead,
  PhoneScreen,
  PhoneSearch,
} from '../../design/phone'

/*
 * WEB-STORE-SEARCH — 承認済みモック `web-booking-complete-approved.html#store-search`。
 *
 *   .head{background:var(--g);color:#fff;padding:20px}.head b{font-size:19px}
 *   .body{padding:20px}.body h2{font-size:24px}
 *   .search{width:100%;min-height:50px;border:1px solid var(--l);
 *           border-radius:9px;padding:12px}
 *   .card{border:1px solid var(--l);border-radius:9px;padding:14px;margin-top:10px}
 *
 * 予約の入口なので工程の目盛りをまだ持たない。店を決めるまでは、何工程の
 * どこにいるかを示しても意味がないため。
 */
export default function WebStoreSearch() {
  return (
    <PhoneScreen>
      <PhoneHead store="店舗を探す" />
      <PhoneBody>
        <h1>予約する店舗を探す</h1>
        <PhoneSearch label="店舗を検索">現在地・駅名・店舗名・地域</PhoneSearch>
        <PhoneCard>
          <b>銀座店</b>
          <br />
          銀座駅 A3出口 徒歩2分
          <br />
          本日営業 10:00–19:00
          <br />
          <PhoneButton>店舗情報を見る</PhoneButton>
        </PhoneCard>
        <PhoneCard>
          <b>丸の内店</b>
          <br />
          東京駅 丸の内南口 徒歩3分
        </PhoneCard>
      </PhoneBody>
    </PhoneScreen>
  )
}
