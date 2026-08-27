/* 実アプリの左サイドバーを撮る。API はスタブして、柱の形だけを見る。 */
import { chromium } from '@playwright/test'

const BASE = process.env.GALLERY_BASE ?? 'http://localhost:5199'
const json = (body) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
})
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1176, height: 814 } })
await p.route('**/api/**', async (route) => {
  const url = route.request().url()
  if (url.endsWith('/api/staff/stores'))
    await route.fulfill(
      json([
        {
          id: '11111111-1111-4111-8111-111111111111',
          organizationId: 'org-admin-seed',
          name: '銀座店',
          slug: 'ginza',
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    )
  else if (url.includes('/permissions'))
    await route.fulfill(json(['store.read', 'reservation.read', 'reservation.write']))
  else await route.fulfill(json([]))
})
await p.route('**/api/auth/refresh', (route) => route.fulfill(json({ token: 'test-token' })))
await p.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await p.evaluate(() => document.fonts.ready)
await p.screenshot({ path: '../../docs/frontend/diff/app--HOME.png' })
const sidebar = p.getByRole('navigation', { name: '画面の一覧' })
const ledger = p.getByRole('button', { name: '予約台帳' }).first()
if (await ledger.count()) {
  await ledger.click().catch(() => {})
  await p.waitForTimeout(800)
}
console.log('柱の有無:', await sidebar.count())
await p.screenshot({ path: '../../docs/frontend/diff/app--SIDEBAR.png' })
console.log('撮った')
await b.close()
