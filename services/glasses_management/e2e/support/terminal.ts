import { expect, type Page } from '@playwright/test'

export type SeededTerminalSession = {
  id: string
  terminalId: string
  mode: 'personal' | 'shared'
  sessionToken: string
}

/** Seed 済みの端末で、従来の各 E2E が業務画面まで入るための共通導線。 */
export async function completeSeededTerminalStart(
  page: Page,
  mode: 'shared' | 'personal' = 'shared',
): Promise<SeededTerminalSession | null> {
  const navigation = page.getByRole('navigation', { name: '画面の切り替え' })
  const deviceMode = page.getByRole('heading', {
    name: 'この iPad の使い方を決めてください',
  })
  const placePick = page.getByRole('heading', { name: 'この端末はどこに置きますか？' })
  const staffPick = page.getByRole('heading', {
    name: '業務を始めるスタッフを選んでください',
  })

  await navigation.or(deviceMode).or(placePick).or(staffPick).waitFor()
  if (await navigation.isVisible()) return null

  if (await deviceMode.isVisible()) {
    await page
      .getByRole('button', {
        name: mode === 'shared' ? 'みんなで使う端末にする' : '個人の端末にする',
      })
      .click()
  }

  if (mode === 'shared') {
    await expect(placePick).toBeVisible()
    await page.getByRole('button', { name: /銀座店 レジ横iPad/ }).click()
    await page.getByRole('button', { name: 'この置き場所で始める' }).click()
  } else {
    await expect(staffPick).toBeVisible()
    await page.getByRole('button', { name: /佐藤 美咲/ }).click()
  }

  await expect(
    page.getByRole('heading', { name: '4〜6桁の暗証番号を入力してください' }),
  ).toBeVisible()
  for (const digit of ['2', '5', '8', '0']) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/staff\/terminals\/[^/]+\/sessions$/.test(response.url()),
  )
  await page.getByRole('button', { name: /^確定/ }).click()
  const response = await started
  await expect(navigation).toBeVisible()
  return (await response.json()) as SeededTerminalSession
}
