import { AppBar, Screen, Wordmark } from '../../design/chrome'
import { GuideLayout } from '../../design/layouts'
import { CardGrid, FieldCard, Preview } from '../../design/surfaces'
import { settingsSteps } from './settings-steps'

/*
 * SETTINGS-PURPOSES — 承認済みモック `settings-complete-approved.html#purposes`。
 *
 *   .grid{grid-template-columns:repeat(2,1fr);gap:12px;margin-top:16px}
 *   .field{…;min-height:76px}.field b{display:block}
 *   .preview{margin-top:14px;…;padding:16px}
 *
 * 見出しは工程名（「来店目的」）ではなく、いま開いている目的そのものの名前。
 * 目的は複数あり、どれを見ているのかがレールの工程名からは分からないため。
 */

export default function SettingsPurposes() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店 · 設定ガイド" />
      </AppBar>
      <GuideLayout steps={settingsSteps(2)}>
        <h1>視力測定・新調相談</h1>
        <CardGrid columns={2} mt={4}>
          <FieldCard title="スタッフ向け名称">視力測定・新調相談</FieldCard>
          <FieldCard title="お客様への質問">メガネを新しく作りたい</FieldCard>
          <FieldCard title="標準所要時間">60分 · 15分単位</FieldCard>
          <FieldCard title="同時受付数">1件</FieldCard>
          <FieldCard title="必要技能">眼鏡作製技能</FieldCard>
          <FieldCard title="必要設備">視力測定機・相談席</FieldCard>
        </CardGrid>
        {/* 店員向けの名称ではなく、お客様に見える言い回しで確認させる。 */}
        <Preview>
          <b>Web予約プレビュー</b>
          <br />
          メガネを新しく作りたい · 約60分
        </Preview>
      </GuideLayout>
    </Screen>
  )
}
