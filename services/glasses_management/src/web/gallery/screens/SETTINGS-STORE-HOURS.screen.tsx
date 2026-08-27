import { AppBar, Screen, Wordmark } from '../../design/chrome'
import { Action, Actions } from '../../design/controls'
import { GuideLayout } from '../../design/layouts'
import { CardGrid, FieldCard, Preview, TitleRow } from '../../design/surfaces'
import { settingsSteps } from './settings-steps'

/*
 * SETTINGS-STORE-HOURS — 承認済みモック `settings-complete-approved.html#store-hours`。
 *
 *   .layout{grid-template-columns:260px 1fr}
 *   .content{padding:26px 34px;overflow:auto}
 *   .title{display:flex;align-items:center}.push{margin-left:auto}
 *   .grid{grid-template-columns:repeat(2,1fr);gap:12px;margin-top:16px}
 *   .field{background:#fff;border:1px solid var(--l);border-radius:9px;
 *          padding:14px;min-height:76px}.field b{display:block}
 *   .preview{margin-top:14px;background:#fff;border:1px solid var(--l);
 *            border-radius:9px;padding:16px}
 *   .actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
 *
 * 中身は入力フォームではなく読み取りカードである。設定を「今どうなっているか」
 * 一望してから直しに入る作りなので、欄をいきなり編集可能にしない。
 */

export default function SettingsStoreHours() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店 · 設定ガイド" />
      </AppBar>
      <GuideLayout steps={settingsSteps(1)}>
        {/* 下書きの時刻は見出しの右端。保存は明示操作ではないので押せる形にしない。 */}
        <TitleRow push={<span>下書き保存 14:32</span>}>
          <h1>店舗と営業時間</h1>
        </TitleRow>
        <CardGrid columns={2} mt={4}>
          <FieldCard title="通常営業時間">
            月–土 10:00–19:00
            <br />日 10:00–18:00
          </FieldCard>
          <FieldCard title="休業日">毎週火曜日</FieldCard>
          <FieldCard title="臨時営業">9月23日 10:00–17:00</FieldCard>
          <FieldCard title="受付停止">設定なし</FieldCard>
        </CardGrid>
        <Preview>
          <b>影響</b>
          {'　'}公開中のWeb枠2件を再確認します。
        </Preview>
        <Actions gap={2.5} mt={4}>
          <Action variant="primary">来店目的へ</Action>
        </Actions>
      </GuideLayout>
    </Screen>
  )
}
