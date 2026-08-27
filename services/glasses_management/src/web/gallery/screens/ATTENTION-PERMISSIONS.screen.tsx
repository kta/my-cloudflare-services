import { AppBar, BarButton, Screen, Wordmark } from '../../design/chrome'
import { Action } from '../../design/controls'
import { AdminLayout, SideNavItem } from '../../design/layouts'
import { Card, CardGrid, Matrix, StatePill, TitleRow } from '../../design/surfaces'

/*
 * ATTENTION-PERMISSIONS — 承認済みモック
 * `operations-approved.html#attention-settings`。
 *
 *   .title{display:flex;align-items:center}  .title h2{margin:0}
 *   .matrix{width:100%;border-collapse:collapse;margin-top:16px;background:#fff}
 *   .matrix th,.matrix td{border:1px solid var(--l);padding:10px;text-align:center}
 *   .matrix th:first-child,.matrix td:first-child{text-align:left}
 *   .toggle{font-weight:700;color:var(--g)}
 *   .grid{gap:12px;margin-top:18px}
 *
 * 注意事項は人について書かれる。誰が書けて誰が公開できるかを 1 枚の表で
 * 見せるのは、権限が文章で散っていると「スタッフは公開できない」が読めなく
 * なるため。列幅は中身で決まるので決め打ちしない。
 */

const SECTIONS = ['権限', '確認待ち 4件', '共有範囲', '入力ルール']

const COLUMNS = ['ロール', '閲覧', '登録', '公開', '改訂', '非表示']

/** 許可されている操作だけ緑の太字（`.toggle`）。不可は本文色のまま置く。 */
const ROWS = [
  {
    label: 'スタッフ',
    cells: [
      { text: '許可', granted: true },
      { text: '確認待ち', granted: true },
      { text: '不可' },
      { text: '不可' },
      { text: '不可' },
    ],
  },
  {
    label: '店舗管理者',
    cells: [
      { text: '許可', granted: true },
      { text: '許可', granted: true },
      { text: '許可', granted: true },
      { text: '許可', granted: true },
      { text: '許可', granted: true },
    ],
  },
  {
    label: '本部管理者',
    cells: [
      { text: '許可', granted: true },
      { text: '許可', granted: true },
      { text: '許可', granted: true },
      { text: '許可', granted: true },
      { text: '許可', granted: true },
    ],
  },
]

export default function AttentionPermissions() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="組織共通設定" />
        <BarButton on current>
          注意事項
        </BarButton>
        <BarButton>設定履歴</BarButton>
      </AppBar>
      <AdminLayout
        navLabel="注意事項の節"
        nav={SECTIONS.map((section, index) => (
          <SideNavItem key={section} on={index === 0}>
            {section}
          </SideNavItem>
        ))}
      >
        <TitleRow gap={0} push={<StatePill>組織共通値</StatePill>}>
          {/* `.title h2{margin:0}` — 表がすぐ下に続くので既定の余白を落とす。 */}
          <h1 className="my-0">注意事項の権限</h1>
        </TitleRow>
        <Matrix label="ロールごとの注意事項の権限" columns={COLUMNS} rows={ROWS} />
        <CardGrid>
          <Card>
            <b>登録方式</b>
            <br />
            管理者確認後に公開
          </Card>
          <Card>
            <b>共有範囲</b>
            <br />
            権限のある店舗
          </Card>
          <Card>
            <b>店舗上書き</b>
            <br />
            2店舗
            <Action inset="tight">差分を確認</Action>
          </Card>
        </CardGrid>
      </AdminLayout>
    </Screen>
  )
}
