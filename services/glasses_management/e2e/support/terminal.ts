import { expect, type Page } from '@playwright/test'

export type SeededTerminalSession = {
  id: string
  terminalId: string
  mode: 'personal' | 'shared'
  sessionToken: string
}

/** seed の銀座店。`seed.mjs` の `slug: 'ginza'` と揃えている。 */
export const SEEDED_SITE_PATH = '/s/ginza'

/**
 * seed 済みの端末で、各 E2E が業務画面まで入るための共通導線。
 *
 * 入口は `/s/:storeSlug`（未認証）である。置き場所を選んで暗証番号を入れるだけで、
 * パスワードもお店のコードも打たない。共有端末はレジ横 iPad、個人端末は
 * 「佐藤 美咲の iPad」を使う（`terminals.staff_id` で持ち主が決まっているので、
 * 業務開始時にスタッフを選ぶ面は無い）。
 */
export async function completeSeededTerminalStart(
  page: Page,
  mode: 'shared' | 'personal' = 'shared',
  site: { storeName: string; place: RegExp } = {
    storeName: 'EYE 銀座店',
    place: /銀座店 レジ横iPad/,
  },
): Promise<SeededTerminalSession | null> {
  const navigation = page.getByRole('navigation', { name: '画面の切り替え' })
  const placeHeading = page.getByRole('heading', { name: site.storeName })

  await navigation.or(placeHeading).waitFor()
  if (await navigation.isVisible()) return null

  const place = mode === 'shared' ? site.place : /佐藤 美咲の iPad/
  await page.getByRole('button', { name: place }).click()
  await page.getByRole('button', { name: 'この置き場所で始める' }).click()

  await expect(
    page.getByRole('heading', { name: '4〜6桁の暗証番号を入力してください' }),
  ).toBeVisible()
  // seed は共有端末の暗証番号もスタッフの暗証番号も 000000 に揃えている。
  for (const digit of ['0', '0', '0', '0', '0', '0']) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  const started = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/public\/sites\/[^/]+\/terminals\/[^/]+\/sessions$/.test(response.url()),
  )
  await page.getByRole('button', { name: /^確定/ }).click()
  const response = await started
  await expect(navigation).toBeVisible()
  const body = (await response.json()) as { session: SeededTerminalSession }
  return body.session
}
