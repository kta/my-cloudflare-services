import { AppBar, Screen, Wordmark } from '../../design/chrome'
import { Action, Actions } from '../../design/controls'
import { GuideLayout } from '../../design/layouts'
import { CardGrid, FieldCard, Preview, TitleRow } from '../../design/surfaces'
import { settingsSteps } from './settings-steps'

/*
 * SETTINGS-IMPACT — 承認済みモック `settings-complete-approved.html#impact`。
 *
 *   .title{display:flex;align-items:center}.push{margin-left:auto}
 *   .grid{grid-template-columns:repeat(2,1fr);gap:12px;margin-top:16px}
 *   .card{…;min-height:76px}.card.warning{background:#fff6e5;border-color:#d4ad66}
 *   .preview.warning{…}
 *   .actions{justify-content:flex-end;gap:10px;margin-top:16px}
 *
 * 公開できない理由（ブロッキング）は数だけを琥珀で立て、やることは下の
 * 警告面が文章で持つ。数と指示を同じ面に混ぜると、どちらも読まれない。
 */

export default function SettingsImpact() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店 · 設定ガイド" />
      </AppBar>
      <GuideLayout steps={settingsSteps(6)}>
        <TitleRow push={<span>版 draft-04</span>}>
          <h1>影響を確認して公開</h1>
        </TitleRow>
        <CardGrid columns={2} mt={4}>
          <FieldCard title="公開予定枠">42件</FieldCard>
          <FieldCard title="既存予約">18件</FieldCard>
          <FieldCard title="ブロッキング" tone="caution">
            影響予約2件
          </FieldCard>
          <FieldCard title="警告">技能不足候補1件</FieldCard>
        </CardGrid>
        <Preview id="impact-reason" tone="caution">
          <b>公開できません</b>
          <br />
          影響予約ごとに代替設備、例外維持、顧客連絡を記録してください。
        </Preview>
        <Actions gap={2.5} mt={4}>
          <Action>影響予約を解消</Action>
          {/*
           * 押せないのは事実だが、押せない理由は上の警告面が持っている。
           * `aria-describedby` でその面へ結び付け、読み上げでも理由に届かせる。
           */}
          <Action disabled describedBy="impact-reason">
            公開する
          </Action>
        </Actions>
      </GuideLayout>
    </Screen>
  )
}
