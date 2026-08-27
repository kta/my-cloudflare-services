import { AppBar, Screen, Wordmark } from '../../design/chrome'
import { GuideLayout } from '../../design/layouts'
import { CardGrid, FieldCard, Preview } from '../../design/surfaces'
import { settingsSteps } from './settings-steps'

/*
 * SETTINGS-EQUIPMENT — 承認済みモック `settings-complete-approved.html#equipment`。
 *
 *   .grid{grid-template-columns:repeat(2,1fr);gap:12px;margin-top:16px}
 *   .field{…;min-height:76px}
 *   .preview.warning{background:#fff6e5;border-color:#d4ad66}
 *
 * 点検停止も設備と同じ 1 枚のカードで並ぶ。停止だけ別扱いにすると、
 * 「今日この店で使えるもの」を数えるのに 2 か所を見ることになる。
 */

export default function SettingsEquipment() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店 · 設定ガイド" />
      </AppBar>
      <GuideLayout steps={settingsSteps(4)}>
        <h1>設備と点検</h1>
        <CardGrid columns={2} mt={4}>
          <FieldCard title="視力測定機">2台 · 10:00–19:00</FieldCard>
          <FieldCard title="相談席">4席 · 10:00–19:00</FieldCard>
          <FieldCard title="調整台">2台 · 10:00–19:00</FieldCard>
          <FieldCard title="点検停止">測定機B · 9/10 13:00–17:00</FieldCard>
        </CardGrid>
        <Preview tone="caution">
          <b>影響予約 2件</b>
          {'　'}代替設備の割当または顧客連絡が必要です。
        </Preview>
      </GuideLayout>
    </Screen>
  )
}
