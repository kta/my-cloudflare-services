import { expect, type Page, test } from '@playwright/test'
import { completeSeededTerminalStart } from './support/terminal'

const ORG = 'eyex'
const NOW = new Date('2026-08-27T02:08:00.000Z')

/*
 * 承認済み mock と実ブラウザ描画は、書体の字幅・OS のアンチエイリアス・既存 Shell の
 * 共通領域ぶんだけ完全一致しない。値は各画面の実測差に 0.2pt だけ余裕を持たせた上限。
 * 構成要素の欠落や位置の大きなずれは、この上限を越えて検知する。
 */
const VISUAL_LIMIT = {
  'START-DEVICE-MODE.png': 0.052,
  'LOGIN-STAFF.png': 0.032,
  'LOGIN-STAFF-PIN.png': 0.032,
  'LOGIN-SHARED.png': 0.032,
  'LOGIN-SHARED-PIN.png': 0.042,
  'LOGIN-PIN-ERROR.png': 0.052,
  'MODE-PERSONAL.png': 0.052,
  'HOME-SHARED-LOCKED.png': 0.032,
  'ALERTS.png': 0.062,
  'EX-PERMISSION.png': 0.092,
} as const

async function matchesMock(page: Page, name: keyof typeof VISUAL_LIMIT): Promise<void> {
  await expect(page).toHaveScreenshot(name, {
    scale: 'device',
    maxDiffPixelRatio: VISUAL_LIMIT[name],
  })
}

test.beforeEach(async ({ page, request }) => {
  const grant = await request.post('/api/internal/store-memberships/sync', {
    headers: { 'x-internal-key': 'dev-internal-key' },
    data: {
      id: '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d',
      organizationId: ORG,
      storeId: '11111111-1111-4111-8111-111111111111',
      userId: `dev:${ORG}`,
      permissions: [
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
      ],
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  })
  expect(grant.status()).toBe(200)
  await page.clock.install({ time: NOW })
})

async function login(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
}

async function sharedPin(page: Page): Promise<void> {
  await login(page)
  await page.getByRole('button', { name: 'みんなで使う端末にする' }).click()
  await page.getByRole('button', { name: /銀座店 レジ横iPad/ }).click()
  await page.getByRole('button', { name: 'この置き場所で始める' }).click()
}

test.describe('端末 mock との突き合わせ', () => {
  test('START-DEVICE-MODE', async ({ page }) => {
    await login(page)
    await expect(
      page.getByRole('heading', { name: 'この iPad の使い方を決めてください' }),
    ).toBeVisible()
    await matchesMock(page, 'START-DEVICE-MODE.png')
  })

  test('LOGIN-STAFF', async ({ page }) => {
    await login(page)
    await page.getByRole('button', { name: '個人の端末にする' }).click()
    await matchesMock(page, 'LOGIN-STAFF.png')
  })

  test('LOGIN-STAFF-PIN', async ({ page }) => {
    await login(page)
    await page.getByRole('button', { name: '個人の端末にする' }).click()
    await page.getByRole('button', { name: /佐藤 美咲/ }).click()
    await matchesMock(page, 'LOGIN-STAFF-PIN.png')
  })

  test('LOGIN-SHARED', async ({ page }) => {
    await login(page)
    await page.getByRole('button', { name: 'みんなで使う端末にする' }).click()
    await matchesMock(page, 'LOGIN-SHARED.png')
  })

  test('LOGIN-SHARED-PIN', async ({ page }) => {
    await sharedPin(page)
    await matchesMock(page, 'LOGIN-SHARED-PIN.png')
  })

  test('LOGIN-PIN-ERROR', async ({ page }) => {
    await page.route(/\/api\/staff\/terminals\/[^/]+\/sessions$/, async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'pin_invalid', remainingAttempts: 2 }),
      })
    })
    await login(page)
    await page.getByRole('button', { name: '個人の端末にする' }).click()
    await page.getByRole('button', { name: /佐藤 美咲/ }).click()
    for (const digit of '1111') await page.getByRole('button', { name: digit }).click()
    await page.getByRole('button', { name: '確定' }).click()
    await expect(page.getByText(/あと2回/)).toBeVisible()
    await matchesMock(page, 'LOGIN-PIN-ERROR.png')
  })

  test('MODE-PERSONAL', async ({ page }) => {
    await login(page)
    await completeSeededTerminalStart(page)
    await page.evaluate(() => {
      const runtime = globalThis as unknown as {
        dispatchEvent: (event: Event) => void
        CustomEvent: new (type: string, init: { detail: { subject: string } }) => Event
      }
      runtime.dispatchEvent(
        new runtime.CustomEvent('eyex:personal-mode-required', {
          detail: { subject: '録音の保全' },
        }),
      )
    })
    await expect(page.getByText('いまは共有モード')).toBeVisible()
    await matchesMock(page, 'MODE-PERSONAL.png')
  })

  test('HOME-SHARED-LOCKED', async ({ page }) => {
    await login(page)
    await completeSeededTerminalStart(page)
    await page.clock.fastForward(120_001)
    await expect(page.getByRole('dialog', { name: 'お客様の情報を隠しています' })).toBeVisible()
    await matchesMock(page, 'HOME-SHARED-LOCKED.png')
  })

  test('ALERTS', async ({ page }) => {
    await login(page)
    await completeSeededTerminalStart(page)
    await page.getByRole('button', { name: 'お知らせ 3件' }).click()
    await expect(page.getByText('録音の保存に3回失敗しました')).toBeVisible()
    await matchesMock(page, 'ALERTS.png')
  })

  test('EX-PERMISSION', async ({ page }) => {
    await login(page)
    await completeSeededTerminalStart(page)
    await page.getByRole('button', { name: '設定', exact: true }).click()
    await page
      .getByRole('navigation', { name: '設定の項目' })
      .getByRole('button', { name: '端末' })
      .click()
    await page.getByLabel('自動で伏せるまで').selectOption('300')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('この操作は店長だけができます')).toBeVisible()
    await matchesMock(page, 'EX-PERMISSION.png')
  })
})
