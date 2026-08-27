import { AppBar, BarButton, Screen, Wordmark } from '../../design/chrome'
import { Action } from '../../design/controls'
import { AdminLayout, SideNavItem } from '../../design/layouts'
import { AdminRow, Card, CardGrid } from '../../design/surfaces'

/*
 * RECORDING-OPS — 承認済みモック `operations-approved.html#recording-ops`。
 *
 *   .content{padding:24px 30px}
 *   .grid{grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}
 *   .card{padding:14px;border-radius:9px}
 *   .row{margin-top:9px;padding:14px;grid-template-columns:1.4fr 1fr 1fr auto;gap:10px}
 *   .row.error{background:#fff0ed;border-color:#d4a299}
 *   .row.warning{background:#fff6e5;border-color:#d4ad66;color:#4b3713}
 *
 * 上半分が「決めごと」、下半分が「今こぼれているもの」。保存に失敗した録音は
 * 予約が成立していても消えるので、赤の行が設定より下でも見落とされないよう
 * 見出しで区切る。
 */

const SECTIONS = ['保存期間', '保存・削除状態', '保全一覧']

export default function RecordingOps() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店 · 設定" />
        <BarButton on current>
          録音運用
        </BarButton>
        <BarButton>監査ログ</BarButton>
      </AppBar>
      <AdminLayout
        navLabel="録音運用の節"
        nav={SECTIONS.map((section, index) => (
          <SideNavItem key={section} on={index === 0}>
            {section}
          </SideNavItem>
        ))}
      >
        <h1>録音の保存期間</h1>
        <CardGrid>
          <Card>
            <b>成立予約</b>
            <br />
            90日保存
            <br />
            <small>最低30日未満には設定できません</small>
          </Card>
          <Card>
            <b>破棄した受付</b>
            <br />
            3日保存
            <br />
            <small>最低24時間未満には設定できません</small>
          </Card>
          <Card>
            <b>適用元</b>
            <br />
            組織共通値
            <br />
            <Action inset="tight">店舗上書きを設定</Action>
          </Card>
        </CardGrid>

        <h2>対応が必要</h2>
        <AdminRow tone="error" label="録音 EY-R-1482">
          <b>録音 EY-R-1482</b>
          <span>保存失敗 · 3回</span>
          <span>予約は成立済み</span>
          <Action inset="tight">再試行</Action>
        </AdminRow>
        <AdminRow tone="warning" label="録音 EY-R-1401">
          <b>録音 EY-R-1401</b>
          <span>保全中</span>
          <span>理由: 予約内容確認</span>
          <Action inset="tight">詳細</Action>
        </AdminRow>
      </AdminLayout>
    </Screen>
  )
}
