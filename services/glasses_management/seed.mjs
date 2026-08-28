/*
 * glasses_management の D1 に、開発用の世界観データを入れる。
 * 何度実行しても同じ（INSERT OR IGNORE なので、手で直した行は上書きしない）。
 *
 *   local : pnpm --filter @app/glasses_management db:seed:local   （make init から呼ばれる）
 *   本番   : node services/glasses_management/seed.mjs --remote
 *
 * 入れるもの: EYEX（組織）と 3 店舗（銀座・丸の内・新宿）。
 * 組織 id は admin 側の seed（`org-admin-seed` など）とは別に、EYEX 用の 1 件を置く。
 * 実運用では組織は admin から service binding で届くので、これは開発の足場である。
 *
 * 値の正本: docs/superpowers/plans/2026-08-28-glasses-management-rebuild.md §5
 * 予約・スタッフ・設備・目的は P1 以降で足す。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REMOTE = process.argv.includes('--remote')
const NOW = '2026-08-01T00:00:00.000Z'
const ORG = 'org-eyex-seed'

const q = (s) => `'${String(s).replace(/'/g, "''")}'`

const stores = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'EYEX 銀座店',
    slug: 'ginza',
    phone: '03-1234-5678',
    address: '東京都中央区銀座4-1-1',
    accessNote: '銀座駅 A1 出口から徒歩3分',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'EYEX 丸の内店',
    slug: 'marunouchi',
    phone: '03-2345-6789',
    address: '東京都千代田区丸の内1-1-1',
    accessNote: '東京駅 丸の内南口から徒歩5分',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'EYEX 新宿店',
    slug: 'shinjuku',
    phone: '03-3456-7890',
    address: '東京都新宿区新宿3-1-1',
    accessNote: '新宿駅 東口から徒歩4分',
  },
]

const lines = [
  `INSERT OR IGNORE INTO organizations (id, name, plan, is_disabled, created_at, revision) VALUES (${q(ORG)}, 'EYEX', 'contracted', '0', ${q(NOW)}, '1');`,
  ...stores.map(
    (s) =>
      `INSERT OR IGNORE INTO stores (id, organization_id, name, slug, phone, address, access_note, is_active, created_at) VALUES (${q(s.id)}, ${q(ORG)}, ${q(s.name)}, ${q(s.slug)}, ${q(s.phone)}, ${q(s.address)}, ${q(s.accessNote)}, '1', ${q(NOW)});`,
  ),
]

const sqlPath = join(mkdtempSync(join(tmpdir(), 'glasses-seed-')), 'seed.sql')
writeFileSync(sqlPath, lines.join('\n'))

execFileSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'glasses_management',
    REMOTE ? '--remote' : '--local',
    '--file',
    sqlPath,
    '--yes',
  ],
  { cwd: import.meta.dirname, stdio: 'inherit' },
)

console.log(`\n✅ seeded glasses_management D1 [${REMOTE ? 'REMOTE(本番)' : 'local'}]`)
console.log(`   組織: ${ORG}（EYEX）／ 店舗: ${stores.map((s) => s.name).join('・')}`)
console.log('   業務開始の画面では、お店のコードに org-eyex-seed を入れる。')
