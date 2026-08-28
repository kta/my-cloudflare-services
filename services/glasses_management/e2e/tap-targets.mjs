/*
 * 実アプリのタップ目標を測る。
 *
 * iPad は指で触る端末なので、押せるものは 44pt 以上でなければ狙って押せない。
 * 見た目が合っていても、ここが小さいと現場では使えない。
 */
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
  if (url.includes('/api/auth/refresh')) await route.fulfill(json({ token: 't' }))
  else if (url.endsWith('/api/staff/stores'))
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
await p.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
/* 柱が出る面へ移る。ホームは柱を持たないので、そこだけ見ても足りない。 */
const enter = p.getByRole('button', { name: '予約台帳', exact: true }).first()
if (await enter.count()) {
  await enter.click().catch(() => {})
  await p.waitForTimeout(900)
}
const measure = () =>
  p.evaluate(() =>
    [...document.querySelectorAll('button, [role="option"], [role="combobox"], a')]
      .map((el) => {
        const r = el.getBoundingClientRect()
        return {
          text: (el.textContent ?? '').trim().slice(0, 16),
          w: Math.round(r.width),
          h: Math.round(r.height),
        }
      })
      .filter((row) => row.h > 0 && (row.h < 44 || row.w < 44)),
  )
for (const [label, name] of [
  ['予約台帳', null],
  ['設定ガイド', '設定ガイド'],
  ['分析', '分析'],
  ['共有端末', '共有端末'],
  ['監査ログ', '監査ログ'],
  ['注意事項', '注意事項'],
]) {
  if (name) {
    const link = p.getByRole('navigation', { name: '画面の一覧' }).getByRole('button', { name })
    if (await link.count()) {
      await link.click().catch(() => {})
      await p.waitForTimeout(900)
    }
  }
  const small = await measure()
  if (label === '予約台帳')
    console.log('画面:', (await p.locator('body').innerText()).slice(0, 90).replace(/\n/g, ' / '))
  const rail = await p.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="画面の一覧"]')
    if (!nav) return null
    const box = nav.getBoundingClientRect()
    const rows = [...nav.querySelectorAll('button')]
    const heights = rows.map((el) => Math.round(el.getBoundingClientRect().height))
    /* 行き先（節ではない）が全部 viewport の中に見えているか。 */
    const offscreen = rows.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.bottom > box.bottom + 1 || r.bottom > window.innerHeight + 1
    }).length
    return { count: rows.length, heights: [...new Set(heights)].sort((a, b) => a - b), offscreen }
  })
  console.log(`${label}: 44px 未満 ${small.length} 件 / 柱 ${JSON.stringify(rail)}`)
  for (const row of small.slice(0, 8)) console.log(`   ${row.w}x${row.h}  ${row.text}`)
}
await b.close()
