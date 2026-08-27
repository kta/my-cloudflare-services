import { AppBar, BarButton, Screen, Wordmark } from '../../design/chrome'
import { Action } from '../../design/controls'
import { AdminLayout, SideNavItem } from '../../design/layouts'
import { Card, CardGrid, TitleRow } from '../../design/surfaces'

/*
 * ATTENTION-REVIEW — 承認済みモック
 * `operations-approved.html#attention-review`。
 *
 *   .content{padding:24px 30px}
 *   .grid{grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}
 *   .card.warning{background:#fff6e5;border:1px solid #d4ad66;color:#4b3713}
 *   .title{display:flex;align-items:center}  .push{margin-left:auto}
 *
 * 公開前チェックの面を 3 枚のカードの直下に余白なしで置くのは、事実・根拠・
 * 推奨対応と地続きに読ませるため。ここで一段空けると「別の話」に見えて、
 * 人格評価が混じった注意事項がそのまま公開される。
 */

const PENDING = ['田中 花子 · 本日', '伊藤 健 · 昨日']

export default function AttentionReview() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店 · 注意事項" />
        <BarButton on current>
          確認待ち 4件
        </BarButton>
        <BarButton>公開済み</BarButton>
      </AppBar>
      <AdminLayout
        navLabel="確認待ちの注意事項"
        nav={PENDING.map((entry, index) => (
          <SideNavItem key={entry} on={index === 0}>
            {entry}
          </SideNavItem>
        ))}
      >
        <h1>注意事項を確認</h1>
        <CardGrid>
          <Card>
            <b>発生した事実</b>
            <br />
            前回、度数変更の説明中に不安を訴え、説明を段階化すると納得された。
          </Card>
          <Card>
            <b>発生日時・根拠</b>
            <br />
            2026.08.25 15:10
            <br />
            接客記録 EY-V-331
          </Card>
          <Card>
            <b>推奨対応</b>
            <br />
            変更理由と見え方を一段階ずつ説明する。
          </Card>
        </CardGrid>
        <Card tone="warning" label="公開前チェック">
          <b>公開前チェック</b>
          <br />
          人格評価、憶測、差別につながる属性は含まれていません。
        </Card>
        <TitleRow
          gap={0}
          push={
            <Action variant="primary" inset="tight">
              公開する
            </Action>
          }
        >
          <Action variant="danger" inset="tight">
            却下
          </Action>
          <Action inset="tight">差戻し</Action>
        </TitleRow>
      </AdminLayout>
    </Screen>
  )
}
