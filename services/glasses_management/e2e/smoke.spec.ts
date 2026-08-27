import { expect, test } from '@playwright/test'

test('renders the staff sign-in entry when no staff session is present', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'スタッフログイン', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ログインする', exact: true })).toBeVisible()
})
