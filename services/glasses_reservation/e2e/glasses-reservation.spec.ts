import { expect, test } from '@playwright/test'

test('静的SPAをWorkerが配信する', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/EYEX予約/)
  await expect(page.getByRole('button', { name: '新規予約' })).toBeVisible()
})

// @e2e-covers AC-GLASSES-01 AC-GLASSES-03
test('既存顧客を選んで電話予約を確定する', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新規予約' }).click()
  await page.getByLabel('電話番号').fill('090000000')
  await page.getByRole('button', { name: /佐藤 みどり/ }).click()
  await page.getByLabel('日付').fill('2025-05-20')
  await page.getByLabel('開始時間').selectOption('14:00')
  await page.getByRole('button', { name: '検眼・カウンセリング' }).click()
  await page.getByRole('button', { name: '14:00 〜 15:30' }).click()
  await page.getByRole('button', { name: '予約を確定する' }).click()
  await expect(page.getByText('予約を確定しました')).toBeVisible()
})

// @e2e-covers AC-GLASSES-02
test('予約台帳で予約を変更して取消できる', async ({ page }) => {
  await page.goto('/?view=ledger')
  await page.getByRole('button', { name: /佐藤 みどり/ }).click()
  await page.getByRole('button', { name: '予約を変更' }).click()
  await page.getByRole('button', { name: '変更を保存' }).click()
  await expect(page.getByText('予約内容を変更しました')).toBeVisible()
  await page.getByRole('button', { name: 'キャンセル' }).click()
  await expect(page.getByText('予約をキャンセルしました')).toBeVisible()
  await expect(page.getByRole('button', { name: /佐藤 みどり/ })).toHaveCount(0)
})

// @e2e-covers AC-GLASSES-04
test('メニューから顧客カルテとダッシュボードへ遷移できる', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'メニュー' }).click()
  await page
    .getByRole('dialog', { name: 'メインメニュー' })
    .getByRole('link', { name: '顧客台帳' })
    .click()
  await expect(page.getByRole('heading', { name: '顧客カルテ' })).toBeVisible()
  for (const label of ['来店履歴', 'メガネ情報', 'コンタクト情報', '会計履歴']) {
    await page.getByRole('tab', { name: label }).click()
    await expect(page.getByRole('tabpanel')).toBeVisible()
  }
  await page.getByRole('button', { name: 'メニュー' }).click()
  await page
    .getByRole('dialog', { name: 'メインメニュー' })
    .getByRole('link', { name: 'ダッシュボード' })
    .click()
  await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible()
})

test('ホームと予約入力は600x450で操作でき、reduced-motionを尊重する', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 450 })
  await page.goto('/')
  for (const name of ['新規予約', '予約変更', '受付履歴'])
    await expect(page.getByRole('button', { name })).toBeInViewport()
  await expect(page.locator('.home-date-strip')).toBeInViewport()
  await page.getByRole('button', { name: '新規予約' }).click()
  await expect(page.locator('.booking-grid')).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.recording-widget')).toBeVisible()
  await expect(page.locator('.recording-widget')).toHaveCSS('animation-name', 'none')
})

test('主要画面の移植classと候補選択状態を維持する', async ({ page }) => {
  await page.goto('/?view=booking')
  await expect(page.locator('.booking-grid')).toBeVisible()
  await expect(page.locator('.booking-form')).toBeVisible()
  await expect(page.locator('.booking-side')).toBeVisible()
  await expect(page.locator('.recording-widget')).toBeVisible()
  await page.getByLabel('日付').fill('2025-05-20')
  await page.getByLabel('開始時間').selectOption('14:00')
  await page.getByRole('button', { name: '検眼・カウンセリング' }).click()
  await expect(page.locator('.slot-card')).toHaveCount(5)
  await page.getByRole('button', { name: '14:00 〜 15:30' }).click()
  await expect(page.locator('.booking-side')).toContainText('14:00 〜 15:30')
  await page.goto('/?view=ledger')
  await expect(page.locator('.global-nav')).toBeVisible()
  await expect(page.locator('.grid-header')).toHaveCount(6)
})

test('未登録顧客を登録できる', async ({ page }) => {
  await page.goto('/?view=booking')
  await page.getByLabel('お名前').fill('高橋 あかり')
  await page.getByRole('button', { name: '情報を検索' }).click()
  await expect(page.getByRole('heading', { name: '新規顧客登録' })).toBeVisible()
  await page.getByLabel('登録氏名').fill('高橋 あかり')
  await page.getByLabel('登録電話番号').fill('090-1111-2222')
  await page.getByRole('button', { name: '顧客を登録する' }).click()
  await expect(page.getByText('顧客情報を登録しました')).toBeVisible()
})

test('逐次入力中も電話番号のフォーカスを維持する', async ({ page }) => {
  await page.goto('/?view=booking')
  const phone = page.getByLabel('電話番号')
  await phone.focus()
  await page.keyboard.type('090000000', { delay: 10 })
  await expect(phone).toHaveValue('090000000')
  await expect(phone).toBeFocused()
  await expect(page.getByText('このお客様ですか？')).toBeVisible()
})

test('booking初期状態は未選択で候補を表示しない', async ({ page }) => {
  await page.goto('/?view=booking')
  await expect(page.getByLabel('日付')).toHaveValue('')
  await expect(page.getByLabel('開始時間')).toHaveValue('')
  await expect(page.getByLabel('お名前')).toHaveValue('')
  await expect(page.getByLabel('電話番号')).toHaveValue('')
  await expect(page.locator('.slot-card')).toHaveCount(0)
  await expect(page.getByText('日付・時間・ご用件を選ぶと候補を表示します')).toBeVisible()
  await expect(page.locator('.global-nav')).toHaveCount(0)
  await expect(page.locator('.booking-grid')).toHaveCSS('grid-template-columns', /335px/)
})

test('ロゴ、menu全行先、予約中止が機能する', async ({ page }) => {
  await page.goto('/?view=booking')
  await page.getByRole('link', { name: 'EYEX予約 ホーム' }).click()
  await expect(page.getByRole('button', { name: '新規予約' })).toBeVisible()
  await page.getByRole('button', { name: 'メニュー' }).click()
  const dialog = page.getByRole('dialog', { name: 'メインメニュー' })
  for (const [label, heading] of [
    ['ホーム', '新規予約'],
    ['新規予約', '電話予約入力'],
    ['予約台帳', '予約台帳'],
    ['予約一覧', '予約一覧'],
    ['顧客台帳', '顧客カルテ'],
    ['ダッシュボード', 'ダッシュボード'],
  ] as const) {
    await page.goto('/')
    await page.getByRole('button', { name: 'メニュー' }).click()
    await dialog.getByRole('link', { name: label }).click()
    if (label === 'ホーム') await expect(page.getByRole('button', { name: heading })).toBeVisible()
    else await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  }
  await page.goto('/?view=booking')
  await page.getByRole('button', { name: '受付をやめてホームへ戻る' }).click()
  await expect(page.getByRole('button', { name: '新規予約' })).toBeVisible()
})

test('録音widgetはbooking限定で6本波形とpause/resumeを持つ', async ({ page }) => {
  await page.goto('/?view=booking')
  const widget = page.locator('.recording-widget')
  await expect(widget.locator('.wave-bar')).toHaveCount(6)
  await page.getByRole('button', { name: '録音を一時停止' }).click()
  await expect(page.getByRole('button', { name: '録音を再開' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '録音を再開' }).click()
  await page.setViewportSize({ width: 600, height: 450 })
  await expect(widget).toHaveCSS('right', '16px')
  await page.goto('/?view=list')
  await expect(page.locator('.recording-widget')).toHaveCount(0)
})

test('各viewの主要操作対象をクリックできる', async ({ page }) => {
  for (const view of ['home', 'booking', 'ledger', 'list', 'customer', 'dashboard']) {
    await page.goto(`/?view=${view}`)
    await expect(
      page.locator('button:not([disabled]), a[href], select, [role="tab"]').first(),
    ).toBeVisible()
  }
})
