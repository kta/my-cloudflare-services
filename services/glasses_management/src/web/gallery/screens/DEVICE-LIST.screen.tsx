import { AppBar, BarButton, Screen, Wordmark } from '../../design/chrome'
import { Action } from '../../design/controls'
import { AdminLayout, SideNavItem } from '../../design/layouts'
import { AdminRow, Card, CardGrid, StatePill, TitleRow } from '../../design/surfaces'

/*
 * DEVICE-LIST — 承認済みモック `operations-approved.html#devices`。
 *
 *   .bar{height:76px;gap:12px;padding:0 20px}
 *   .layout{grid-template-columns:250px 1fr}
 *   .side{padding:18px}  .side button{min-height:48px;padding:10px}
 *   .content{padding:24px 30px}
 *   .title{display:flex;align-items:center}  .title h2{margin:0}
 *   .row{margin-top:9px;padding:14px;grid-template-columns:1.4fr 1fr 1fr auto;gap:10px}
 *   .state{border-radius:14px;padding:4px 9px}
 *   .grid{grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}
 *   .button{padding:0 14px;min-height:44px}
 *
 * 端末は「今つながっているか」と「止めるか」だけを並べる。失効・削除は
 * 取り返しがつかないので、どちらも danger で描いて既定の見た目にしない。
 */

const SECTIONS = ['共有iPad', '無操作ロック', '個人PIN', '共有セッション']

export default function DeviceList() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店 · 設定" />
        <BarButton on current>
          端末とセキュリティ
        </BarButton>
        <BarButton>利用者とロール</BarButton>
        <BarButton>監査ログ</BarButton>
      </AppBar>
      <AdminLayout
        navLabel="端末とセキュリティの節"
        nav={SECTIONS.map((section, index) => (
          <SideNavItem key={section} on={index === 0}>
            {section}
          </SideNavItem>
        ))}
      >
        <TitleRow
          gap={0}
          push={
            <Action variant="primary" inset="tight">
              共有iPadを登録
            </Action>
          }
        >
          <div>
            {/* `.title h2{margin:0}` — 見出しの下に副題が続くので既定の余白を落とす。 */}
            <h1 className="my-0">共有iPad</h1>
            <p>店舗へ登録された端末と共有セッション</p>
          </div>
        </TitleRow>

        <AdminRow label="銀座店 レジ横iPad">
          <b>銀座店 レジ横iPad</b>
          <span>最終通信 1分前</span>
          <StatePill>利用中</StatePill>
          <Action variant="danger" inset="tight">
            失効
          </Action>
        </AdminRow>
        <AdminRow label="銀座店 受付iPad">
          <b>銀座店 受付iPad</b>
          <span>最終通信 18日前</span>
          <StatePill>停止中</StatePill>
          <Action variant="danger" inset="tight">
            削除確認
          </Action>
        </AdminRow>

        <CardGrid>
          <Card>
            <b>無操作ロック</b>
            <br />
            既定 2分
            <br />
            <Action inset="tight">変更</Action>
          </Card>
          <Card>
            <b>画面非表示時</b>
            <br />
            直ちに顧客情報を隠す
          </Card>
          <Card>
            <b>個人モード</b>
            <br />
            スタッフ選択＋4〜6桁PIN
          </Card>
        </CardGrid>
      </AdminLayout>
    </Screen>
  )
}
