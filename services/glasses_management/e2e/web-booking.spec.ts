import { expect, type Page, test } from '@playwright/test'

const purposeId = '00000000-0000-4000-8000-000000000001'
const reservationId = '00000000-0000-4000-8000-000000000002'
const token = 'a'.repeat(32)
const store = {
  slug: 'ginza',
  name: '銀座店',
  contactPhone: '03-0000-0000',
  region: '東京都',
  nearestStation: '銀座駅',
}
const detail = {
  ...store,
  accessText: '銀座駅 A3出口から徒歩2分',
  notice: 'ご来店前に確認してください。',
  businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
  purposes: [{ id: purposeId, label: 'メガネを新しく作りたい', durationMinutes: 60 }],
}
const slots = {
  date: '2026-09-01',
  timezone: 'Asia/Tokyo',
  durationMinutes: 60,
  intervalMinutes: 30,
  slots: [
    {
      date: '2026-09-01',
      startTime: '10:00',
      endTime: '11:00',
      startAt: '2026-09-01T01:00:00.000Z',
      endAt: '2026-09-01T02:00:00.000Z',
    },
  ],
}

async function mockPublicApi(page: Page, booking: 'success' | 'conflict' | 'unknown') {
  await page.route('**/api/public/stores', (route) => route.fulfill({ json: [store] }))
  await page.route('**/api/public/stores/ginza/slots?*', (route) => route.fulfill({ json: slots }))
  await page.route('**/api/public/stores/ginza', (route) => route.fulfill({ json: detail }))
  await page.route('**/api/public/stores/ginza/reservations', (route) => {
    if (booking === 'conflict')
      return route.fulfill({ status: 409, json: { error: 'slot_unavailable' } })
    if (booking === 'unknown') return route.abort('failed')
    return route.fulfill({
      status: 201,
      json: { reservationNumber: 'EY-0001', managementCode: 'ABCD-1234', emailStatus: 'sent' },
    })
  })
  await page.route('**/api/public/reservations/status?*', (route) =>
    route.fulfill({ json: { status: 'confirmed' } }),
  )
  await page.route('**/api/public/reservations/verify', (route) =>
    route.fulfill({
      status: 201,
      json: {
        reservationId,
        verificationToken: token,
        expiresAt: '2026-09-01T00:15:00.000Z',
        version: 1,
        startAt: '2026-09-01T01:00:00.000Z',
        purposeIds: [purposeId],
        storeSlug: 'ginza',
      },
    }),
  )
  await page.route(`**/api/public/reservations/${reservationId}`, (route) =>
    route.fulfill({
      json: {
        status: 'confirmed',
        version: 2,
        startAt: '2026-09-01T02:00:00.000Z',
        endAt: '2026-09-01T03:00:00.000Z',
        purposeIds: [purposeId],
      },
    }),
  )
  await page.route(`**/api/public/reservations/${reservationId}/cancel`, (route) =>
    route.fulfill({ json: { status: 'cancelled', version: 3 } }),
  )
}

async function reachConfirmation(page: Page) {
  await page.getByRole('button', { name: /銀座店.*店舗情報を見る/ }).click()
  await page.getByRole('button', { name: '銀座店で予約を始める' }).click()
  // 来店目的と日時は「選ぶ」と「進む」が別操作（PublicBooking.tsx の 1/5・2/5 工程）。
  await page.getByRole('button', { name: /メガネを新しく作りたい.*約60分/ }).click()
  await page.getByRole('button', { name: '日時へ進む' }).click()
  await page.getByLabel('ご希望の日').fill('2026-09-01')
  await page.getByRole('button', { name: '9月1日（火）10:00' }).click()
  await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
  await page.getByLabel('お名前', { exact: true }).fill('田中花子')
  await page.getByLabel('お名前（かな）').fill('タナカハナコ')
  await page.getByLabel('電話番号').fill('09012345678')
  await page.getByLabel('メールアドレス').fill('hanako@example.test')
  await page.getByRole('button', { name: '確認へ進む' }).click()
}

// @e2e-covers UC-EYEX-073 UC-EYEX-074 UC-EYEX-075 UC-EYEX-076 UC-EYEX-077 UC-EYEX-078 UC-EYEX-080 UC-EYEX-081 UC-EYEX-085 UC-EYEX-086 UC-EYEX-167 UC-EYEX-169 UC-EYEX-170 AC-EYEX-32 AC-EYEX-33 AC-EYEX-34 AC-EYEX-35 AC-EYEX-37 AC-EYEX-39 AC-EYEX-92 AC-EYEX-93 AC-EYEX-94
test('allows a customer to book and manage only the verified reservation on a 375px screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await mockPublicApi(page, 'success')
  await page.goto('/book')
  await expect(page.getByRole('heading', { name: '予約する店舗を探す' })).toBeVisible()
  await page.getByLabel('店舗を検索').fill('銀座')
  await reachConfirmation(page)
  await expect(page.getByText('ご来店前に確認してください。')).toBeVisible()
  await page.getByRole('button', { name: 'この内容で予約する' }).click()
  await expect(page.getByRole('heading', { name: '予約を承りました' })).toBeVisible()
  await expect(page.getByText('EY-0001')).toBeVisible()
  await page.getByRole('button', { name: '予約を変更・取り消す' }).click()
  await page.getByLabel('会社発行の管理コード').fill('ABCD-1234')
  await page.getByRole('button', { name: '予約を表示する' }).click()
  await page.getByRole('button', { name: '予約日時を変更する' }).click()
  await page.getByLabel('変更後の日').fill('2026-09-01')
  await page.getByRole('button', { name: '9月1日（火）10:00' }).click()
  await expect(page.getByText('予約を変更しました。')).toBeVisible()
  await page.getByRole('button', { name: '予約を取り消す' }).click()
  await expect(page.getByRole('heading', { name: '予約を取り消しました' })).toBeVisible()
})

// @e2e-covers UC-EYEX-079 UC-EYEX-082 UC-EYEX-083 UC-EYEX-168 AC-EYEX-36 AC-EYEX-38
test('retains the same-store booking input when the chosen slot conflicts', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await mockPublicApi(page, 'conflict')
  await page.goto('/book/ginza')
  await page.getByRole('button', { name: '銀座店で予約を始める' }).click()
  // 来店目的と日時は「選ぶ」と「進む」が別操作（PublicBooking.tsx の 1/5・2/5 工程）。
  await page.getByRole('button', { name: /メガネを新しく作りたい.*約60分/ }).click()
  await page.getByRole('button', { name: '日時へ進む' }).click()
  await page.getByLabel('ご希望の日').fill('2026-09-01')
  await page.getByRole('button', { name: '9月1日（火）10:00' }).click()
  await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
  await page.getByLabel('お名前', { exact: true }).fill('田中花子')
  await page.getByLabel('お名前（かな）').fill('タナカハナコ')
  await page.getByLabel('電話番号').fill('09012345678')
  await page.getByLabel('メールアドレス').fill('hanako@example.test')
  await page.getByRole('button', { name: '確認へ進む' }).click()
  await page.getByRole('button', { name: 'この内容で予約する' }).click()
  await expect(page.getByRole('alert')).toContainText(
    '選択した時間は他のお客様の予約で埋まりました',
  )
  await page.getByRole('button', { name: '9月1日（火）10:00' }).click()
  await page.getByRole('button', { name: 'お客様情報へ進む' }).click()
  await expect(page.getByLabel('お名前', { exact: true })).toHaveValue('田中花子')
})

// @e2e-covers UC-EYEX-084 UC-EYEX-171 AC-EYEX-95
test('checks the result instead of creating another reservation after response loss', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await mockPublicApi(page, 'unknown')
  await page.goto('/book')
  await reachConfirmation(page)
  await page.getByRole('button', { name: 'この内容で予約する' }).click()
  await expect(page.getByRole('heading', { name: '予約結果を確認しています' })).toBeVisible()
  await page.getByRole('button', { name: '成立状況を再確認する' }).click()
  await expect(page.getByRole('heading', { name: '予約の成立を確認しました' })).toBeVisible()
})
