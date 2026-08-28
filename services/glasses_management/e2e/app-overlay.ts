/*
 * 実アプリを撮って、承認済みモックの基準画像と重ねる。
 *
 * `gallery.diff.ts` が見ているのは突き合わせ台（表示だけの複製）で、そこが
 * 一致していても実アプリが一致している証明にはならない。実際、台が 47 枚
 * 一致している間に、実アプリの側では要素が落ちたり寸法が崩れたりしていた。
 *
 * ここでは実アプリを同じ実寸で撮り、`overlay.ts` の突き合わせにかける。
 * 出力は `docs/frontend/diff/app--<ID>.png` と、画面ごとの判定。
 *
 * なお実アプリには承認済みモックに無いものが 1 つある——全画面共通の左サイド
 * バーで、`docs/frontend/REBUILD.md` に理由を書いた意図的な逸脱である。柱の
 * ぶんだけ本文が右へ寄るので、割合そのものは必ず大きく出る。**この道具で見る
 * のは割合ではなく、面の中身が基準と同じ語彙・同じ並びかどうか**である。
 */
import { writeFileSync } from 'node:fs'
import { chromium, type Page } from '@playwright/test'
import { compare } from './overlay.ts'

const BASE = process.env.APP_BASE ?? 'http://localhost:5199'
const OUT = '../../docs/frontend/diff'

const IPAD = { width: 1176, height: 814 }

/** 契約を満たす店舗。ここが崩れると全画面が「読み込めませんでした」になる。 */
const STORE = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: 'org-admin-seed',
  name: '銀座店',
  slug: 'ginza',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const PERMISSIONS = [
  'store.read',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'recording.read',
  'settings.read',
  'audit.read',
  'analytics.read',
  'attention.read',
]

function json(body: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

/** 実アプリを認証済みの状態で開く。API は空で返し、骨格だけを見る。 */
async function openApp(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/api/auth/refresh')) await route.fulfill(json({ token: 'test-token' }))
    else if (url.endsWith('/api/staff/stores')) await route.fulfill(json([STORE]))
    else if (url.includes('/permissions')) await route.fulfill(json(PERMISSIONS))
    else await route.fulfill(json([]))
  })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
}

/** 柱から面を開く。柱を持たない面（ホーム・予約フロー）はここでは撮らない。 */
async function openScreen(page: Page, label: string) {
  const sidebar = page.getByRole('navigation', { name: '画面の一覧' })
  if ((await sidebar.count()) === 0) {
    const ledger = page.getByRole('button', { name: '予約台帳', exact: true }).first()
    if ((await ledger.count()) > 0) await ledger.click()
    await page.waitForTimeout(600)
  }
  const link = page
    .getByRole('navigation', { name: '画面の一覧' })
    .getByRole('button', { name: label })
  if ((await link.count()) === 0) return false
  await link.click()
  await page.waitForTimeout(900)
  return true
}

/** 画面 ID → 柱での名前。柱から辿れる面だけを対象にする。 */
const SCREENS: [string, string][] = [
  ['LEDGER-DAY', '予約台帳'],
  ['JOURNEY-DEFAULT', '来店受付'],
  ['RECEPTION-HISTORY', '受付履歴'],
  ['RES-SEARCH', '予約検索'],
  ['CUSTOMER-CURRENT', '顧客台帳'],
  ['SETTINGS-STORE-HOURS', '設定ガイド'],
  ['DEVICE-LIST', '共有端末'],
  ['RECORDING-OPS', '録音運用'],
  ['ATTENTION-PERMISSIONS', '注意事項'],
  ['AUDIT-DETAIL', '監査ログ'],
  ['ANALYTICS', '分析'],
]

async function main() {
  const only = process.argv.slice(2)
  const browser = await chromium.launch()
  const rows: { id: string; ratio: number; note: string }[] = []

  for (const [id, label] of SCREENS) {
    if (only.length > 0 && !only.includes(id)) continue
    const page = await browser.newPage({ viewport: IPAD, deviceScaleFactor: 1 })
    await openApp(page)
    const opened = await openScreen(page, label)
    if (!opened) {
      rows.push({ id, ratio: 1, note: `柱から ${label} へ行けない` })
      await page.close()
      continue
    }
    const path = `${OUT}/app--${id}.png`
    writeFileSync(path, await page.screenshot())
    await page.close()

    const report = compare(id, path)
    rows.push({ id, ratio: report.ratio, note: report.note })
  }
  await browser.close()

  for (const row of rows.sort((left, right) => right.ratio - left.ratio))
    console.log(
      `${row.id.padEnd(24)} ${(row.ratio * 100).toFixed(2).padStart(6)}%  ${row.note}`.trimEnd(),
    )
}

await main()
