import { AppBar, Screen, Wordmark } from '../../design/chrome'
import { GuideLayout } from '../../design/layouts'
import { Card, Preview } from '../../design/surfaces'
import { settingsSteps } from './settings-steps'

/*
 * SETTINGS-STAFF-SKILLS — 承認済みモック `settings-complete-approved.html#staff-skills`。
 *
 *   .card{background:#fff;border:1px solid var(--l);border-radius:9px;
 *         padding:14px;min-height:76px}
 *   .preview{margin-top:14px;…;padding:16px}
 *   .preview.warning{background:#fff6e5;border-color:#d4ad66}
 *
 * カードは 2 枚が隙間なく縦に接する（`.card` に margin が無い）。ここを空けると
 * 「1 人 1 枚」ではなく「別々の設定」に読めてしまう。
 *
 * 名前は `.field` と違い block ではないので、技能が同じ行に続く。
 */

export default function SettingsStaffSkills() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店 · 設定ガイド" />
      </AppBar>
      <GuideLayout steps={settingsSteps(3)}>
        <h1>スタッフと技能</h1>
        <Card className="min-h-19">
          <b>佐藤 美咲</b>
          {'　'}眼鏡作製技能・調整
          <br />
          勤務 10:00–18:00 · 休憩 13:00–14:00 · 予約受付可
        </Card>
        <Card className="min-h-19">
          <b>高橋 健</b>
          {'　'}視力測定・調整
          <br />
          勤務 11:00–19:00 · 予約受付可
        </Card>
        {/* 技能を外した結果どこが壊れるかを、外す前に件数で示す。 */}
        <Preview tone="caution">
          <b>影響</b>
          {'　'}佐藤の技能を外すと、新調相談4枠と既存予約1件が競合します。
        </Preview>
      </GuideLayout>
    </Screen>
  )
}
