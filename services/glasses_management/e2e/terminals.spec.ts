import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test'
import { completeSeededTerminalStart } from './support/terminal'

const ORG = 'eyex'
const NOW = new Date('2026-08-27T02:08:00.000Z')
const GINZA = '11111111-1111-4111-8111-111111111111'
const FAILED_RECORDING_ID = 'f0021000-0000-4000-8000-000000000000'
const MEMBERSHIP_ID = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d'
const PERMISSIONS = [
  'store.read',
  'store.manage',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  'recording.read',
  'recording.manage',
  'settings.read',
  'settings.manage',
  'terminal.manage',
  'audit.read',
]

test.beforeEach(async ({ request }) => {
  const response = await request.post('/api/internal/store-memberships/sync', {
    headers: { 'x-internal-key': 'dev-internal-key' },
    data: {
      id: MEMBERSHIP_ID,
      organizationId: ORG,
      storeId: GINZA,
      userId: `dev:${ORG}`,
      permissions: PERMISSIONS,
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  })
  expect(response.status()).toBe(200)
})

async function login(page: Page): Promise<void> {
  await page.clock.install({ time: NOW })
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
}

async function startShared(page: Page): Promise<void> {
  await login(page)
  await completeSeededTerminalStart(page, 'shared')
}

async function startPersonal(page: Page): Promise<void> {
  await login(page)
  await completeSeededTerminalStart(page, 'personal')
}

async function enterPin(page: Page, pin = '2580'): Promise<void> {
  for (const digit of pin) await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: /^確定/ }).click()
}

async function authHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const response = await request.post('/api/auth/token', {
    data: { organizationId: ORG, role: 'staff' },
  })
  const body = (await response.json()) as { token: string }
  return { authorization: `Bearer ${body.token}` }
}

/** seed が置く 3 件（対応が必要 1 / お知らせ 2）。AC-TERM-16 が数える母数である。 */
const SEEDED_ALERTS = [
  'f0020000-0000-4000-8000-000000000000',
  'f0020000-0000-4000-8000-000000000001',
  'f0020000-0000-4000-8000-000000000002',
] as const

/**
 * e2e は D1 を 1 本しか持たず、先に走る面（録音の再送失敗など）がお知らせを増やす。
 * AC-TERM-16 は「3 件ある」を前提に 1 件と 2 件を数えるので、**seed の 3 件以外を
 * 対応済みにして**この面の前提をそろえる。増えた行を消すのではなく解決済みにするのは、
 * お知らせに削除の経路が無いからである。
 */
async function normalizeAlerts(request: APIRequestContext): Promise<void> {
  const headers = await authHeaders(request)
  const response = await request.get('/api/staff/alerts?kind=all&limit=200', { headers })
  expect(response.status()).toBe(200)
  const { items } = (await response.json()) as {
    items: Array<{ id: string; resolvedAt: string | null }>
  }
  for (const alert of items) {
    const seeded = SEEDED_ALERTS.includes(alert.id as (typeof SEEDED_ALERTS)[number])
    // seed の 3 件は未読へ戻す（先に走る面が「すべて既読にする」を押していることがある）。
    const data = seeded ? { readAt: null } : { resolved: true }
    if (!seeded && alert.resolvedAt !== null) continue
    const patched = await request.patch(`/api/staff/alerts/${alert.id}`, { headers, data })
    expect(patched.status(), await patched.text()).toBe(200)
  }
}

// @e2e-covers UC-TERM-01 AC-TERM-01
test('未設定の iPad は個人と共有の違いを3項目ずつ読める', async ({ page }) => {
  await login(page)
  await expect(
    page.getByRole('heading', { name: 'この iPad の使い方を決めてください' }),
  ).toBeVisible()
  for (const label of ['記録される名前', 'お客様の情報', '暗証番号']) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(2)
  }
})

// @e2e-covers UC-TERM-02 AC-TERM-02
test('個人端末では勤務中のスタッフだけを選べる', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: '個人の端末にする' }).click()
  await expect(
    page.getByRole('heading', { name: '業務を始めるスタッフを選んでください' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /山田 大輔.*本日休み/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /佐藤 美咲/ })).toBeEnabled()
})

// @e2e-covers UC-TERM-03 AC-TERM-03
test('個人 PIN は4桁から確定でき、本人名が端末名として残る', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: '個人の端末にする' }).click()
  await page.getByRole('button', { name: /佐藤 美咲/ }).click()
  for (const digit of '258') await page.getByRole('button', { name: digit, exact: true }).click()
  await expect(page.getByRole('button', { name: /^確定/ })).toBeDisabled()
  await page.getByRole('button', { name: '0', exact: true }).click()
  await page.getByRole('button', { name: /^確定/ }).click()
  await expect(page.getByText('佐藤 美咲の iPad')).toBeVisible()
  await expect(page.getByText('個人で使っています')).toBeVisible()
})

// @e2e-covers UC-TERM-05 AC-TERM-04
test('共有端末は置き場所と接続状態を選んでから PIN へ進む', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: 'みんなで使う端末にする' }).click()
  await expect(page.getByText('つながっていません').first()).toBeVisible()
  await page.getByRole('button', { name: /銀座店 レジ横iPad/ }).click()
  await page.getByRole('button', { name: 'この置き場所で始める' }).click()
  await expect(page.getByText('個人を選ばずにできる')).toBeVisible()
  await expect(page.getByText('ご本人の確認が必要')).toBeVisible()
})

test('375px・200%相当でも開始画面は横にあふれず、キーボードで主要操作へ届く', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  await login(page)
  await page.addStyleTag({ content: 'html { font-size: 200%; }' })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const runtime = globalThis as unknown as {
          document: { documentElement: { scrollWidth: number; clientWidth: number } }
        }
        return (
          runtime.document.documentElement.scrollWidth <=
          runtime.document.documentElement.clientWidth
        )
      }),
    )
    .toBe(true)
  const personal = page.getByRole('button', { name: '個人の端末にする' })
  await personal.focus()
  await expect(personal).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: '業務を始めるスタッフを選んでください' }),
  ).toBeVisible()
})

// @e2e-covers UC-TERM-06 AC-TERM-05
test('共有 PIN で始めると置き場所の名前が左柱に残る', async ({ page }) => {
  await startShared(page)
  await expect(page.getByText('銀座店 レジ横iPad')).toBeVisible()
  await expect(page.getByText('共有で使っています')).toBeVisible()
})

// @e2e-covers UC-TERM-04 AC-TERM-06
test('PIN の1回目の誤りは入力を空にして残り2回と直し方を示す', async ({ page }) => {
  await page.route(/\/api\/staff\/terminals\/[^/]+\/sessions$/, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'pin_invalid', remainingAttempts: 2 }),
    })
  })
  await login(page)
  await page.getByRole('button', { name: 'みんなで使う端末にする' }).click()
  await page.getByRole('button', { name: 'この置き場所で始める' }).click()
  await enterPin(page, '1111')
  await expect(page.getByText('暗証番号が違います。あと2回お試しいただけます')).toBeVisible()
  await expect(page.getByText(/3回続くと、30秒/)).toBeVisible()
  await expect(page.getByText(/店長に暗証番号の再設定を頼む/)).toBeVisible()
})

// @e2e-covers AC-TERM-07
test('PIN を3回続けて誤ると30秒の待機中は確定できない', async ({ page }) => {
  let attempts = 0
  await page.route(/\/api\/staff\/terminals\/[^/]+\/sessions$/, async (route) => {
    attempts += 1
    const locked = attempts === 3
    await route.fulfill({
      status: locked ? 429 : 401,
      contentType: 'application/json',
      body: JSON.stringify(
        locked
          ? { error: 'pin_locked', remainingAttempts: 0, retryAfterSeconds: 30 }
          : { error: 'pin_invalid', remainingAttempts: 3 - attempts },
      ),
    })
  })
  await login(page)
  await page.getByRole('button', { name: 'みんなで使う端末にする' }).click()
  await page.getByRole('button', { name: 'この置き場所で始める' }).click()
  for (let attempt = 0; attempt < 3; attempt += 1) await enterPin(page, '1111')
  await expect(page.getByText('30秒お待ちください')).toBeVisible()
  await expect(page.getByRole('button', { name: /^確定/ })).toBeDisabled()
})

// @e2e-covers UC-TERM-07 AC-TERM-08
test('共有モードで予約を確定し、受付履歴に共有端末の操作主体が残る', async ({ page }) => {
  await startShared(page)
  await page.getByRole('button', { name: /新しい予約を取る/ }).click()
  await expect(
    page.getByRole('heading', { name: 'お日にちはいつがよろしいですか？' }),
  ).toBeVisible()
  await expect(page.getByText(/暗証番号/)).toHaveCount(0)

  await page.getByRole('button', { name: /^8月27日（木）/ }).click()
  // 時刻の札は営業時間ぶんを全部出す（UX 監査 BOOK-05 で折りたたみをやめた）。
  await page.getByRole('button', { name: /^18:00 / }).click()
  await page.getByRole('button', { name: /^次へ進む/ }).click()
  await page.getByRole('button', { name: /^今のメガネを調整したい/ }).click()
  /*
   * 木曜は閉店前の片付けが 18:40–19:00 なので、18:00 から所要 45 分は収まらない
   * （`booking.spec.ts` の AC-BOOK-03 が同じ枠を「収まらない時刻」の例に使っている）。
   * 押せる時刻を焼き込むと、ほかの e2e がその枠を埋めたときに揺れる。アプリ自身が
   * 出す「受付できない時刻のご案内」の先頭へ寄せて、いま取れる枠で確定させる。
   */
  const guidance = page.getByRole('group', { name: '受付できない時刻のご案内' })
  await expect(guidance.getByRole('button').first()).toBeVisible()
  await guidance.getByRole('button').first().click()
  await expect(page.getByRole('button', { name: /^次へ進む/ })).toBeEnabled()
  await page.getByRole('button', { name: /^次へ進む/ }).click()
  await expect(page.getByRole('table', { name: 'ご予約を置く盤' })).toBeVisible()
  await page.getByRole('button', { name: '担当はあとで決める' }).click()
  await page.getByRole('button', { name: '設備・場所', exact: true }).click()
  await page.getByRole('button', { name: '設備はあとで決める' }).click()
  await page.getByRole('button', { name: '担当者', exact: true }).click()
  await page.getByRole('button', { name: /^次へ進む/ }).click()
  await page.getByLabel('お名前').fill('端末 確認')
  await page.getByLabel('ふりがな').fill('たんまつ かくにん')
  await page.getByRole('button', { name: /^次へ進む/ }).click()
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()

  await page.getByRole('button', { name: '台帳で見る' }).click()
  await page.getByRole('button', { name: '受付履歴', exact: true }).click()
  await expect(page.getByRole('main', { name: '受付履歴' })).toBeVisible()
  await page.getByRole('button', { name: /端末 確認/ }).click()
  const detail = page.getByRole('region', { name: '選んだ受付の中身' })
  await expect(detail).toContainText('新しく受け付けました')
  await expect(detail).toContainText('銀座店 レジ横iPad')
})

// @e2e-covers UC-TERM-08 AC-TERM-09
test('共有端末は2分を過ぎると内容を覆い、明示操作で戻る', async ({ page }) => {
  await startShared(page)
  // ロック専用snapshotをホームの通常表示中に確定させてから、時計を進める。
  await page.waitForTimeout(100)
  const lockedApiRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) lockedApiRequests.push(request.url())
  })
  await page.clock.fastForward(120_001)
  const dialog = page.getByRole('dialog', { name: 'お客様の情報を隠しています' })
  await expect(dialog).toBeVisible()
  await expect(page.getByText(/2分間さわらなかったので伏せました/)).toBeVisible()
  await expect(dialog.getByText('●●●● 様')).toBeVisible()
  await expect(dialog.getByText('090-●●●●-●●●●')).toBeVisible()
  await expect(dialog.getByText(/本日のご予約\s+\d+件/)).toBeVisible()
  await page.clock.fastForward(60_001)
  expect(lockedApiRequests).toEqual([])

  let resumedStoreReads = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/staff/stores') resumedStoreReads += 1
  })
  await page.getByRole('button', { name: '画面にさわって続ける' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => resumedStoreReads).toBe(1)
})

// 品質回帰: exact-one のUC/ACマッピングは直前のロックシナリオが担う。
test('共有端末の予約中もロックし、背面の業務画面へ移動できない', async ({ page }) => {
  await startShared(page)
  await page.getByRole('button', { name: /新しい予約を取る/ }).click()
  await expect(
    page.getByRole('heading', { name: 'お日にちはいつがよろしいですか？' }),
  ).toBeVisible()

  await page.clock.fastForward(120_001)
  const dialog = page.getByRole('dialog', { name: 'お客様の情報を隠しています' })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('heading', { name: 'お日にちはいつがよろしいですか？' })).toHaveCount(
    0,
  )
  await expect(page.getByRole('navigation', { name: '画面の切り替え' })).toHaveCount(0)
})

// @e2e-covers UC-TERM-09 AC-TERM-10
test('共有端末で録音保全を始めると本人確認画面を開く', async ({ page }) => {
  await startShared(page)
  await page.evaluate(() => {
    const runtime = globalThis as unknown as {
      dispatchEvent: (event: Event) => boolean
      CustomEvent: new (type: string, init: { detail: { subject: string } }) => Event
    }
    runtime.dispatchEvent(
      new runtime.CustomEvent('eyex:personal-mode-required', { detail: { subject: '録音の保全' } }),
    )
  })
  await expect(
    page.getByRole('heading', { name: '録音の保全にはご本人の確認が必要です' }),
  ).toBeVisible()
  await expect(page.getByText('いまは共有モード')).toBeVisible()
  await expect(page.getByRole('button', { name: /佐藤 美咲/ })).toBeVisible()
})

// @e2e-covers AC-TERM-11
test('本人確認で正しいPINを入れると元の業務画面へ戻り、個人モードになる', async ({ page }) => {
  await startShared(page)
  await page.evaluate(() => {
    const runtime = globalThis as unknown as {
      dispatchEvent: (event: Event) => boolean
      CustomEvent: new (type: string, init: { detail: { subject: string } }) => Event
    }
    runtime.dispatchEvent(
      new runtime.CustomEvent('eyex:personal-mode-required', { detail: { subject: '録音の保全' } }),
    )
  })
  await page.getByRole('button', { name: /佐藤 美咲/ }).click()
  await enterPin(page)
  await expect(page.getByText('いまは共有モード')).toHaveCount(0)
  await expect(page.getByText('個人で使っています')).toBeVisible()
})

// @e2e-covers UC-TERM-10 AC-TERM-12
test('個人モードも2分後には共有表示へ戻る', async ({ page }) => {
  await startPersonal(page)
  await expect(page.getByText('個人で使っています')).toBeVisible()
  await page.clock.fastForward(120_001)
  await expect(page.getByText('共有で使っています')).toBeVisible()
})

// @e2e-covers UC-TERM-11 AC-TERM-13
test('共有端末の設定変更は下書きを残し、店長 PIN で続けられる', async ({ page }) => {
  await startShared(page)
  await page.getByRole('button', { name: '設定', exact: true }).click()
  await page
    .getByRole('navigation', { name: '設定の項目' })
    .getByRole('button', { name: '端末' })
    .click()
  await page.getByLabel('自動で伏せるまで').selectOption('300')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('この操作は店長だけができます')).toBeVisible()
  await expect(page.getByText('下書きは残っています')).toBeVisible()
  await expect(page.getByText(/自動で伏せるまで：120秒 → 300秒/)).toBeVisible()
  await expect(page.getByRole('button', { name: /この下書きを店長に依頼する/ })).toHaveCount(0)
  for (const digit of '2580') {
    await page
      .getByRole('group', { name: '店長の暗証番号のテンキー' })
      .getByRole('button', {
        name: digit,
        exact: true,
      })
      .click()
  }
  const elevation = page.waitForResponse(
    (response) => response.url().endsWith('/elevate') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '店長として続ける' }).click()
  const elevationResponse = await elevation
  expect(await elevationResponse.json()).toMatchObject({ mode: 'personal' })
  await expect(page.getByText('保存しました')).toBeVisible()

  // 同じ使い捨て D1 を後続ケースも使うため、検証後は seed の値へ戻す。
  await page.getByLabel('自動で伏せるまで').selectOption('120')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('保存しました')).toBeVisible()
})

// @e2e-covers UC-TERM-12 AC-TERM-14
test('通信断でも台帳を読み続け、最終同期と次回試行を文字で示す', async ({ page, context }) => {
  await startShared(page)
  await page.getByRole('button', { name: '予約台帳', exact: true }).click()
  await context.setOffline(true)
  await page.evaluate(() => {
    const runtime = globalThis as unknown as { dispatchEvent: (event: Event) => void }
    runtime.dispatchEvent(new Event('offline'))
  })
  await expect(page.getByRole('status').filter({ hasText: '通信が切れています' })).toBeVisible()
  await expect(page.getByText(/現在.*予約の確定・変更・ご来店の受付/)).toBeVisible()
  await expect(page.getByText(/11:09 に自動でも試します/)).toBeVisible()
  await page.clock.fastForward(60_001)
  await expect(page.getByText(/11:10 に自動でも試します/)).toBeVisible()
  await expect(page.getByRole('button', { name: '予約台帳', exact: true })).toBeVisible()
})

// @e2e-covers UC-TERM-13 AC-TERM-15
test('共有端末の操作主体は削除不能な監査イベントとして取得できる', async ({ page, request }) => {
  await startShared(page)
  const headers = await authHeaders(request)
  const stores = (await (await request.get('/api/staff/stores', { headers })).json()) as Array<{
    id: string
  }>
  const store = stores[0]
  expect(store).toBeDefined()
  const response = await request.get(`/api/staff/audit?storeId=${store?.id ?? ''}`, { headers })
  expect(response.status()).toBe(200)
  const body = (await response.json()) as {
    items: Array<{ actorType: string; terminalId: string | null }>
  }
  expect(body.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ actorType: 'terminal', terminalId: expect.any(String) }),
    ]),
  )
  expect((await request.delete('/api/staff/audit', { headers })).status()).toBe(404)
})

// @e2e-covers UC-TERM-14 AC-TERM-16
test('お知らせは対応要否を分け、未読をまとめて既読にできる', async ({ page, request }) => {
  await normalizeAlerts(request)
  await startShared(page)
  await page.getByRole('button', { name: /^お知らせ \d+件$/ }).click()
  const kinds = page.getByRole('navigation', { name: 'お知らせの種類' })
  await expect(kinds.getByRole('button', { name: 'アラート（対応が必要） 1件' })).toBeVisible()
  await expect(kinds.getByRole('button', { name: 'お知らせ 2件' })).toBeVisible()
  await expect(page.getByText('未読').first()).toBeVisible()
  await page.getByRole('button', { name: 'すべて既読にする' }).click()
  await expect(page.getByText('未読')).toHaveCount(0)
})

// @e2e-covers AC-TERM-17
test('裏に回った共有端末は復帰時刻との差でただちに伏せる', async ({ page }) => {
  await startShared(page)
  await page.evaluate(() => {
    const runtime = globalThis as unknown as {
      document: { dispatchEvent: (event: Event) => void }
    }
    Object.defineProperty(runtime.document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    runtime.document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(120_001)
  await page.evaluate(() => {
    const runtime = globalThis as unknown as {
      document: { dispatchEvent: (event: Event) => void }
    }
    Object.defineProperty(runtime.document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    runtime.document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('dialog', { name: 'お客様の情報を隠しています' })).toBeVisible()
})

// @e2e-covers AC-TERM-18
test('お知らせ件数は数字だけでなく入口の名前として読み上げられる', async ({ page }) => {
  await startShared(page)
  const entry = page.getByRole('button', { name: /^お知らせ \d+件$/ })
  await expect(entry).toBeVisible()
  const accessibleName = await entry.getAttribute('aria-label')
  expect(accessibleName).toMatch(/^お知らせ \d+件$/)
  await entry.click()
  await expect(
    page
      .getByRole('navigation', { name: '画面の切り替え' })
      .getByRole('button', { name: accessibleName ?? '' }),
  ).toBeVisible()
})

// @e2e-covers AC-TERM-19
test('3桁の PIN は確定できない理由も読み上げ名に入る', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: 'みんなで使う端末にする' }).click()
  await page.getByRole('button', { name: 'この置き場所で始める' }).click()
  for (const digit of '258') await page.getByRole('button', { name: digit, exact: true }).click()
  const confirm = page.getByRole('button', { name: '確定', exact: true })
  await expect(confirm).toBeDisabled()
  await expect(confirm).toHaveAttribute('aria-describedby', /.+/)
  await expect(page.getByText('あと1桁で「確定」を押せます。')).toBeVisible()
})

// @e2e-covers AC-TERM-20
test('共有端末の業務入力には前の利用者を残さない指定が付く', async ({ page }) => {
  await startShared(page)
  await page.getByRole('button', { name: '顧客台帳', exact: true }).click()
  const fields = page.locator('input, textarea')
  await expect(fields.first()).toBeVisible()
  const count = await fields.count()
  for (let index = 0; index < count; index += 1) {
    await expect(fields.nth(index)).toHaveAttribute('autocomplete', 'off')
  }
})

// @e2e-covers AC-TERM-21
test('共有端末の置き場所選択から使い方を決め直せる', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: 'みんなで使う端末にする' }).click()
  await page.getByRole('button', { name: '使い方を変える' }).click()
  await expect(
    page.getByRole('heading', { name: 'この iPad の使い方を決めてください' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '個人の端末にする' })).toBeVisible()
})

// @e2e-covers UC-TERM-16
test('端末設定で保存した使い方は、業務終了後の次の開始画面に反映される', async ({ page }) => {
  await startShared(page)
  const terminalId = await page.evaluate(() => sessionStorage.getItem('eyex.active-terminal-id'))
  await page.evaluate((id) => {
    const browserWindow = globalThis as unknown as {
      dispatchEvent: (event: CustomEvent) => boolean
    }
    browserWindow.dispatchEvent(
      new CustomEvent('eyex:terminal-updated', { detail: { id, kind: 'personal' } }),
    )
  }, terminalId)

  await page.clock.fastForward(120_001)
  await page
    .getByRole('dialog', { name: 'お客様の情報を隠しています' })
    .getByRole('button', {
      name: '業務を終える',
    })
    .click()
  await expect(
    page.getByRole('heading', { name: '業務を始めるスタッフを選んでください' }),
  ).toBeVisible()
})

// @e2e-covers UC-TERM-15 AC-TERM-22
test('録音再送の操作が成功すると対応済みへ移る', async ({ page, request }) => {
  await startShared(page)
  await page.getByRole('button', { name: /^お知らせ \d+件$/ }).click()
  const actionTab = page.getByRole('button', { name: /^アラート（対応が必要） \d+件$/ })
  const resolvedTab = page.getByRole('button', { name: /^対応済み \d+件$/ })
  const target = page.locator('article').filter({ hasText: 'EY-R-1482' })
  await expect(target).toHaveCount(1)
  const countOf = async (button: Locator) =>
    Number((await button.getAttribute('aria-label'))?.match(/(\d+)件$/)?.[1] ?? '0')
  const actionBefore = await countOf(actionTab)
  const resolvedBefore = await countOf(resolvedTab)
  await target.getByRole('button', { name: 'もう一度送る' }).click()
  await expect(target).toHaveCount(1)
  await expect(actionTab).toHaveAttribute('aria-label', `アラート（対応が必要） ${actionBefore}件`)
  const stored = await request.patch(`/api/staff/recordings/${FAILED_RECORDING_ID}`, {
    headers: await authHeaders(request),
    data: { state: 'stored' },
  })
  expect(stored.status()).toBe(200)
  await resolvedTab.click()
  await expect(target).toHaveCount(1)
  await expect(actionTab).toHaveAttribute(
    'aria-label',
    `アラート（対応が必要） ${actionBefore - 1}件`,
  )
  await expect(resolvedTab).toHaveAttribute('aria-label', `対応済み ${resolvedBefore + 1}件`)
})

// 品質回帰: exact-one のUCマッピングは端末設定同期シナリオが担う。
test('設定の端末面で一覧・使い方・自動ロック・PINを変更できる', async ({ page }) => {
  await startPersonal(page)
  await page.getByRole('button', { name: '設定', exact: true }).click()
  await page
    .getByRole('navigation', { name: '設定の項目' })
    .getByRole('button', { name: '端末' })
    .click()
  await expect(page.getByText('この店舗の端末')).toBeVisible()
  await expect(page.getByLabel('使い方')).toBeVisible()
  await expect(page.getByLabel('自動で伏せるまで')).toBeVisible()
  await expect(page.getByLabel('新しい暗証番号')).toBeVisible()
})
