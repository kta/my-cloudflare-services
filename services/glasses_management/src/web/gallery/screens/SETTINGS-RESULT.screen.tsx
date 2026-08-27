import { AppBar, BarButton, Screen, Wordmark } from '../../design/chrome'
import { Action } from '../../design/controls'
import { AdminRow, Card, CardGrid, StatePill, TitleRow } from '../../design/surfaces'

/*
 * SETTINGS-RESULT — 承認済みモック `operations-approved.html#publish-result`。
 *
 *   .content{padding:24px 30px}（節ナビを持たないので幅いっぱい）
 *   .title{display:flex;align-items:center}  .title h2{margin:0}
 *   .grid{grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}
 *   .card strong{font-size:28px}
 *   .row.error{background:#fff0ed;border-color:#d4a299}
 *
 * 「12店舗成功」で終わらせず、失敗した 1 店舗をそのまま行にして再試行を
 * 並べる。まとめだけを見せると、反映されていない店舗が翌日まで残る。
 */

export default function SettingsResult() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="設定公開" />
        <BarButton>設定一覧</BarButton>
        <BarButton on current>
          公開結果
        </BarButton>
        <BarButton>版履歴</BarButton>
      </AppBar>
      <main className="min-h-0 flex-1 overflow-auto px-7.5 py-6 font-sans">
        <TitleRow gap={0} push={<StatePill>一部失敗</StatePill>}>
          <div>
            {/* `.title h2{margin:0}` — 実行者・承認者の行がすぐ下に続く。 */}
            <h1 className="my-0">版 v2026.08.26-04 の公開結果</h1>
            <p>2026年8月26日 18:00 · 実行者 山田 · 承認者 佐藤</p>
          </div>
        </TitleRow>

        <CardGrid>
          <Card>
            <b>成功</b>
            <br />
            <strong className="text-figure">12店舗</strong>
            <br />
            公開枠 428件
          </Card>
          <Card tone="error">
            <b>失敗</b>
            <br />
            <strong className="text-figure">1店舗</strong>
            <br />
            新宿店 · 設備設定競合
          </Card>
          <Card>
            <b>反映確認</b>
            <br />
            Web予約 12/13
            <br />
            予約台帳 12/13
          </Card>
        </CardGrid>

        <AdminRow tone="error" label="新宿店">
          <b>新宿店</b>
          <span>視力測定機が停止中</span>
          <span>公開未反映</span>
          <Action variant="primary" inset="tight">
            この店舗だけ再試行
          </Action>
        </AdminRow>

        <TitleRow
          gap={0}
          className="mt-4.5"
          push={<Action inset="tight">過去版から新しい下書きを作る</Action>}
        >
          <Action inset="tight">版の差分を見る</Action>
        </TitleRow>
      </main>
    </Screen>
  )
}
