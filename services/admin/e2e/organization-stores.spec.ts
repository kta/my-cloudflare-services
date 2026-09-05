/**
 * 会社のお店の一覧（`014-store-provisioning`）。
 *
 * admin は店舗を持たないので、ドメインへ service binding で尋ねて返す。この e2e は
 * admin だけを起動するのでドメインは応えられない。**応えられないときにどう振る舞うか**
 * こそがここで確かめたいことである — 担当店舗の変更まで巻き添えで止めない。
 */
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

async function mintAdminToken(request: APIRequestContext, organizationId: string): Promise<string> {
  const res = await request.post('/api/auth/token', { data: { organizationId, role: 'admin' } })
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { token: string }).token
}

async function signIn(page: Page, token: string): Promise<void> {
  await page.addInitScript((t) => {
    sessionStorage.setItem('app.admin.dev.token', t as string)
  }, token)
}

const newOrg = (): string => `operator-${crypto.randomUUID()}`

// @e2e-covers UC-PROV-06 AC-PROV-15
test('会社のお店の一覧はドメインへ尋ね、応えられないときは内部を漏らさずに断る', async ({
  request,
}) => {
  // dev グラントは運営 org の行を作る。ドメインが居ない e2e では組織の新規作成が
  // 同期に失敗するので、確実に存在するこの org を相手にする。
  const org = newOrg()
  const token = await mintAdminToken(request, org)

  const res = await request.get(`/api/organizations/${org}/stores`, {
    headers: { authorization: `Bearer ${token}` },
  })

  // ドメインが居ない e2e なので 502。居れば 200 で一覧が返る。
  expect([200, 502]).toContain(res.status())
  const body = await res.text()
  expect(body).not.toContain('glasses-management.internal')
  expect(body).not.toContain('x-internal-key')

  const unauthenticated = await request.get(`/api/organizations/${org}/stores`)
  expect(unauthenticated.status()).toBe(401)

  const unknown = await request.get('/api/organizations/does-not-exist/stores', {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(unknown.status()).toBe(404)
})

// @e2e-covers AC-PROV-16
test('お店の一覧を読み込めなくても、権限と担当店舗の保存は止まらない', async ({
  page,
  request,
}) => {
  const org = newOrg()
  const token = await mintAdminToken(request, org)
  await signIn(page, token)

  /*
   * 利用者の一覧は差し込む。招待から一覧に出るまでの経路はこの e2e の関心ではなく、
   * ここで見たいのは**お店の一覧が読めないときに担当店舗の面がどう振る舞うか**である。
   * お店の一覧はドメインが居ないので自然に失敗させ、その姿を確かめる。
   */
  const email = 'staff-for-store-list@tenant.test'
  await page.route('**/api/users?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'u-store-list',
          email,
          role: 'staff',
          standardRole: 'staff',
          assignments: [],
          permissionDifference: { missing: [], extra: [] },
          hasPin: false,
          createdAt: '2026-09-05T00:00:00.000Z',
        },
      ]),
    })
  })

  await page.goto('/users')
  await expect(page.getByRole('heading', { name: '利用者', exact: true })).toBeVisible()
  const row = page.locator('li', { hasText: email })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: '権限を変更' }).click()

  const dialog = page.getByRole('dialog').filter({ hasText: '権限と担当店舗' })
  await expect(
    dialog.getByText('お店の一覧を読み込めませんでした。担当店舗はそのままにします。'),
  ).toBeVisible()
  await expect(dialog.getByRole('button', { name: '変更を保存' })).toBeEnabled()
})
