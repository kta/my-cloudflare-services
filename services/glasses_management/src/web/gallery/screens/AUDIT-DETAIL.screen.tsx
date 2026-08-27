import { AppBar, BarButton, Screen, Wordmark } from '../../design/chrome'
import { AdminLayout, SideNavItem } from '../../design/layouts'
import { AuditRecord, Card, DiffPair } from '../../design/surfaces'

/*
 * AUDIT-DETAIL — 承認済みモック `operations-approved.html#audit`。
 *
 *   .content{padding:24px 30px}
 *   .card{padding:14px;border-radius:9px}
 *   .audit{font:14px/1.6 ui-monospace,monospace}
 *   .diff{grid-template-columns:1fr 1fr;gap:12px}
 *
 * 記録は要約せず、保存されている姿のまま等幅で出す。整形して読みやすく
 * すると、後から「本当にこう記録されていたのか」を確かめられなくなる。
 * 前後の差分だけは人が読む形に開いて、2 面で並べる。
 */

const SECTIONS = ['本日の管理操作', '録音再生', '店舗切替', '注意事項']

const RECORD = [
  'event: attention.published',
  'organization: eyex',
  'store: ginza',
  'actor_type: person',
  'actor: 佐藤 美咲',
  'device: 銀座店 レジ横iPad',
  'target: attention EY-A-220',
  'correlation_id: corr-6f82…',
  'occurred_at: 2026-08-26T17:42:13+09:00',
]

export default function AuditDetail() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="監査" />
        <BarButton on current>
          監査ログ
        </BarButton>
        <BarButton>録音運用</BarButton>
      </AppBar>
      <AdminLayout
        navLabel="監査ログの絞り込み"
        nav={SECTIONS.map((section, index) => (
          <SideNavItem key={section} on={index === 0}>
            {section}
          </SideNavItem>
        ))}
      >
        <h1>監査イベント詳細</h1>
        <AuditRecord label="監査イベントの記録" lines={RECORD} />
        <DiffPair>
          <Card label="変更前">
            <b>変更前</b>
            <br />
            確認待ち
            <br />
            version 2
          </Card>
          <Card label="変更後">
            <b>変更後</b>
            <br />
            公開済み
            <br />
            version 3
          </Card>
        </DiffPair>
      </AdminLayout>
    </Screen>
  )
}
