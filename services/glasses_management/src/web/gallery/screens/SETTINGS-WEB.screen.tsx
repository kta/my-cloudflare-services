import { AppBar, Screen, Wordmark } from '../../design/chrome'
import { GuideLayout } from '../../design/layouts'
import { CardGrid, FieldCard, Preview } from '../../design/surfaces'
import { settingsSteps } from './settings-steps'

/*
 * SETTINGS-WEB — 承認済みモック `settings-complete-approved.html#web-settings`。
 *
 *   .grid{grid-template-columns:repeat(2,1fr);gap:12px;margin-top:16px}
 *   .field{…;min-height:76px}
 *   .preview{margin-top:14px;…;padding:16px}
 *
 * 期限は「いつまで受けるか」と「過ぎたらどう案内するか」を必ず対で置く。
 * 案内文が無いまま締め切ると、電話が鳴るだけで理由が伝わらない。
 */

export default function SettingsWeb() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店 · 設定ガイド" />
      </AppBar>
      <GuideLayout steps={settingsSteps(5)}>
        <h1>Web予約</h1>
        <CardGrid columns={2} mt={4}>
          <FieldCard title="公開状態">9月15日 10:00に公開</FieldCard>
          <FieldCard title="受付終了">設定なし</FieldCard>
          <FieldCard title="予約可能期間">60日先まで</FieldCard>
          <FieldCard title="直前受付期限">開始2時間前</FieldCard>
          <FieldCard title="変更・取消期限">前日18:00</FieldCard>
          <FieldCard title="期限後の案内">銀座店へお電話ください</FieldCard>
        </CardGrid>
        <Preview>
          <b>店舗ページ</b>
          {'　'}店舗名、アクセス、電話番号、注意事項をプレビュー
        </Preview>
      </GuideLayout>
    </Screen>
  )
}
