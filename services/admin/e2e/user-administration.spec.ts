import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/**
 * 利用者管理(UC-EYE-149)と個人 PIN(UC-EYE-151)の e2e。
 *
 * dev グラントで運営 admin のセッションを起動し、招待 → 受諾で実在利用者を作る。
 * 受諾後のブラウザは招待された本人としてログイン済みになるため、同じ context で
 * 「本人の PIN 設定」と「管理者による再設定開始」を通せる。
 */

const STORE_ID = '5f2b1a7c-3d4e-4a9b-8c1d-2e3f4a5b6c7d'

function unique(value: string): string {
  return `${value}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

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

/** 招待を発行して acceptUrl を得る(メール送信はせず手動共有リンクを返す)。 */
async function invite(
  request: APIRequestContext,
  token: string,
  organizationId: string,
  email: string,
  role: 'admin' | 'staff',
): Promise<string> {
  const res = await request.post(`/api/organizations/${organizationId}/invitations`, {
    headers: { authorization: `Bearer ${token}` },
    data: { email, role },
  })
  expect(res.status()).toBe(201)
  const { acceptUrl } = (await res.json()) as { acceptUrl: string }
  return acceptUrl
}

async function acceptInvite(page: Page, acceptUrl: string, email: string): Promise<void> {
  await page.goto(new URL(acceptUrl).pathname + new URL(acceptUrl).search)
  await page.getByLabel('招待メールの宛先アドレス').fill(email)
  await page.getByLabel('パスワード（12 文字以上）', { exact: true }).fill('correct-horse-battery')
  await page.getByLabel('パスワード（確認）').fill('correct-horse-battery')
  await page.getByRole('button', { name: 'パスワードを設定してはじめる' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/invite'))
}

// @e2e-covers UC-ADMIN-USERS-01
test('本部管理者が利用者を検索し、権限差分を見て標準ロールと担当店舗を変更する', async ({
  page,
  request,
}) => {
  const orgId = unique('eye-admin-e2e')
  const token = await mintAdminToken(request, orgId)
  await signIn(page, token)
  const email = `${unique('staff')}@example.test`
  await invite(request, token, orgId, email, 'staff')

  /*
   * 担当店舗は会社のお店の一覧から選ぶ（014-store-provisioning）。この e2e は
   * admin だけを起動するのでドメインが応えられない。一覧そのものは admin の
   * 責務ではないため、ここでは応答を差し込んで**選ぶ操作**を確かめる。
   */
  await page.route('**/api/organizations/*/stores', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: STORE_ID,
          organizationId: orgId,
          name: '銀座店',
          slug: 'ginza-e2e',
          phone: '',
          address: '',
          accessNote: '',
          isActive: true,
          createdAt: '2026-09-05T00:00:00.000Z',
        },
      ]),
    })
  })

  await page.goto('/users')
  await expect(page.getByRole('heading', { name: '利用者', exact: true })).toBeVisible()

  // 検索(サーバは JWT の組織でスコープするので、画面から組織は送らない)
  await page.getByLabel('氏名・メールで検索').fill(email)
  await page.getByRole('button', { name: '検索' }).click()
  const row = page.locator('li', { hasText: email })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('スタッフ')
  // 担当店舗が無い状態では標準ロールどおり = 差分なし
  await expect(row).toContainText('不足: なし')
  await expect(row).toContainText('超過: なし')

  // 標準ロールと担当店舗を変更 → domain へ membership が配られる
  const patched = page.waitForResponse(
    (res) => res.url().includes('/api/users/') && res.request().method() === 'PATCH',
  )
  await row.getByRole('button', { name: '権限を変更' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: '権限と担当店舗' })
  await dialog.getByLabel('標準ロール').selectOption('store_manager')
  await dialog.getByRole('checkbox', { name: '銀座店' }).check()
  await dialog.getByRole('button', { name: '変更を保存' }).click()
  // preview には glasses-management の実体が居ないため、membership 同期は成功
  // (200)にも retryable な失敗(502)にもなり得る。どちらでも **admin 正本は
  // 保持され、失敗は再送できる警告として画面に出る** ことが仕様である。
  const patchResponse = await patched
  expect([200, 502]).toContain(patchResponse.status())
  if (patchResponse.status() === 502) {
    await expect(page.getByRole('alert')).toContainText('同期に失敗')
    expect(await patchResponse.json()).toMatchObject({
      error: 'store_membership_sync_failed',
      retryable: true,
    })
  }

  const updated = page.locator('li', { hasText: email })
  await expect(updated).toContainText('店舗管理者')
  await expect(updated).toContainText('担当店舗 1 件')

  // 担当店舗での絞り込みが効く(同期された割り当てが admin 正本にある)
  await page.getByLabel('氏名・メールで検索').fill('')
  await page.getByLabel('担当店舗 ID').fill(STORE_ID)
  await page.getByRole('button', { name: '検索' }).click()
  await expect(page.locator('li', { hasText: email })).toHaveCount(1)

  // 変更前後が監査に残る(誰が・いつ・何を)
  const userId = await page.locator('li', { hasText: email }).getAttribute('data-user-id')
  const audits = await request.get(`/api/users/${userId}/audits`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(audits.status()).toBe(200)
  const entries = (await audits.json()) as { action: string; before: string; after: string }[]
  expect(entries[0]?.action).toBe('user.assignment_changed')
  expect(JSON.parse(entries[0]?.before ?? '{}')).toMatchObject({ standardRole: 'staff' })
  expect(JSON.parse(entries[0]?.after ?? '{}')).toMatchObject({ standardRole: 'store_manager' })
})

// @e2e-covers UC-ADMIN-USERS-02
test('本人が個人PINを設定・変更し、管理者は本人確認後に再設定を開始できるがPINは見えない', async ({
  page,
  request,
}) => {
  const orgId = unique('eye-pin-e2e')
  const token = await mintAdminToken(request, orgId)
  await signIn(page, token)
  const email = `${unique('manager')}@example.test`
  const acceptUrl = await invite(request, token, orgId, email, 'admin')

  // 招待受諾でブラウザは本人としてログイン済みになる
  await acceptInvite(page, acceptUrl, email)

  // 本人が PIN を設定 → 応答にも画面にも PIN は現れない
  await page.goto('/me/pin')
  await expect(page.getByText('未設定')).toBeVisible()
  const created = page.waitForResponse(
    (res) => res.url().includes('/api/me/pin') && res.request().method() === 'POST',
  )
  await page.getByLabel('新しい PIN(4〜6 桁)').fill('1357')
  await page.getByRole('button', { name: 'PIN を設定' }).click()
  const createdBody = await (await created).text()
  expect(createdBody).not.toContain('1357')
  await expect(page.getByText('設定済み')).toBeVisible()

  // 本人が現行 PIN の証明つきで変更できる
  const changed = page.waitForResponse(
    (res) => res.url().includes('/api/me/pin') && res.request().method() === 'POST',
  )
  await page.getByLabel('新しい PIN(4〜6 桁)').fill('2468')
  await page.getByLabel('現在の PIN').fill('1357')
  await page.getByRole('button', { name: 'PIN を変更' }).click()
  const changedResponse = await changed
  expect(changedResponse.status()).toBe(200)
  expect(changedResponse.request().postData() ?? '').not.toContain('2468')

  // 誤った現行 PIN は拒否され、理由は PIN を明かさない
  const rejected = page.waitForResponse(
    (res) => res.url().includes('/api/me/pin') && res.request().method() === 'POST',
  )
  await page.getByLabel('新しい PIN(4〜6 桁)').fill('9753')
  await page.getByLabel('現在の PIN').fill('0000')
  await page.getByRole('button', { name: 'PIN を変更' }).click()
  expect((await rejected).status()).toBe(401)
  await expect(page.getByRole('alert')).toHaveText('現在の PIN が一致しません。')

  // 管理者としての再設定開始: 本人確認の記録が必須で、PIN は返らない
  await page.goto('/users')
  await page.getByLabel('氏名・メールで検索').fill(email)
  await page.getByRole('button', { name: '検索' }).click()
  const row = page.locator('li', { hasText: email })
  await expect(row).toContainText('PIN 設定済み')
  await row.getByRole('button', { name: 'PIN 再設定' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'PIN 再設定' })
  await expect(dialog.getByRole('button', { name: '再設定を開始' })).toBeDisabled()
  const started = page.waitForResponse(
    (res) => res.url().includes('/pin-reset') && res.request().method() === 'POST',
  )
  await dialog.getByLabel('本人確認の記録').fill('店頭で社員証を確認')
  await dialog.getByRole('button', { name: '再設定を開始' }).click()
  const ticketResponse = await started
  expect(ticketResponse.status()).toBe(201)
  const ticket = await ticketResponse.text()
  expect(ticket).not.toContain('2468')
  expect(ticket).not.toContain('hmac$')
  expect(JSON.parse(ticket)).toMatchObject({ status: 'pending' })
})
