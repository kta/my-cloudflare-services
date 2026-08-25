import { expect, test } from '@playwright/test'

// @e2e-covers AC-GLASSES-05 AC-GLASSES-06
test('source parity: all views retain the source landmarks and mobile reception rail', async ({
  page,
}) => {
  for (const [view, landmark] of [
    ['home', '新規予約'],
    ['booking', '電話予約入力'],
    ['ledger', '予約台帳'],
    ['list', '予約一覧'],
    ['customer', '顧客カルテ'],
    ['dashboard', 'ダッシュボード'],
  ] as const) {
    await page.goto(`/?view=${view}`)
    if (view === 'home') {
      await expect(page.getByRole('button', { name: landmark })).toBeVisible()
    } else {
      await expect(page.getByRole('heading', { name: landmark })).toBeVisible()
      await expect(page.locator('.page-strip')).toBeVisible()
    }
  }

  await page.setViewportSize({ width: 1440, height: 1024 })
  for (const view of ['home', 'booking', 'ledger', 'list', 'customer', 'dashboard'] as const) {
    await page.goto(`/?view=${view}`)
    expect((await page.locator('.app-header').boundingBox())?.height).toBe(68)
    if (view === 'home') {
      await expect(page.locator('.app-header')).toHaveCSS('background-color', 'rgb(35, 86, 38)')
      expect((await page.locator('.home-inner').boundingBox())?.width).toBeLessThanOrEqual(900)
    } else {
      await expect(page.locator('.app-header')).toHaveCSS('background-image', /linear-gradient/)
      expect((await page.locator('.page-content').boundingBox())?.width).toBeGreaterThan(1000)
    }
  }

  await page.setViewportSize({ width: 600, height: 450 })
  await page.goto('/')
  for (const name of ['新規予約', '予約変更', '受付履歴', '予約を検索', '顧客台帳']) {
    await expect(page.getByRole('button', { name })).toBeInViewport()
  }
  await expect(page.locator('.home-date-strip')).toBeInViewport()

  await page.goto('/?view=booking')
  await expect(page.locator('.booking-grid')).toBeVisible()
  await expect(page.locator('.form-section')).toHaveCount(6)
  await expect(page.locator('.booking-side .side-card')).toHaveCount(3)
  await expect(page.locator('.recording-widget')).toBeVisible()
  await expect(page.locator('.wave-bar')).toHaveCount(6)
})

test('source parity: source-derived desktop and mobile geometry remains intact', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto('/?view=booking')
  await expect(page.locator('.app-header')).toHaveCSS(
    'background-image',
    /rgb\(35, 86, 38\).*rgb\(52, 123, 44\).*rgb\(68, 139, 53\)/,
  )
  expect((await page.locator('.page-strip').boundingBox())?.height).toBe(52)
  expect((await page.locator('.booking-side').boundingBox())?.width).toBe(335)
  expect((await page.locator('.booking-grid').boundingBox())?.width).toBeGreaterThan(1100)

  await page.goto('/?view=ledger')
  expect((await page.locator('.global-nav').boundingBox())?.width).toBe(224)
  expect((await page.locator('.ledger-grid').boundingBox())?.width).toBeGreaterThanOrEqual(980)
  await page.goto('/?view=list')
  expect((await page.locator('.list-table').boundingBox())?.width).toBeGreaterThan(1000)
  await page.goto('/?view=customer')
  expect((await page.locator('.profile-card').boundingBox())?.width).toBe(255)
  await page.goto('/?view=dashboard')
  await expect(page.locator('.kpi-card')).toHaveCount(4)

  await page.setViewportSize({ width: 600, height: 450 })
  await page.goto('/?view=home')
  expect((await page.locator('.home-inner').boundingBox())?.width).toBe(456)
  await page.goto('/?view=booking')
  await expect(page.locator('.booking-grid')).toHaveCSS('display', 'block')
  expect((await page.locator('.recording-widget').boundingBox())?.width).toBeGreaterThan(150)
})

test('source parity: booking has six purposes, three staff modes, three side cards and recording control', async ({
  page,
}) => {
  await page.goto('/?view=booking')
  await expect(page.locator('.page-strip')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'お客様情報' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '選択中の条件' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /予約可能な候補/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'メガネの作製・ご相談' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'メガネの修理・クリーニング' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'コンタクトレンズの相談・購入' })).toBeVisible()
  await expect(page.getByRole('button', { name: /前回と同じ/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /指名なし/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '別の担当者を希望' })).toBeVisible()
  await expect(page.locator('.recording-widget')).toBeVisible()
})

test('source parity: initial ledger data, customer history and dashboard visual data match the mock', async ({
  page,
}) => {
  await page.goto('/?view=ledger')
  await expect(page.getByRole('button', { name: /09:00 〜 10:30.*鈴木 一郎/ })).toHaveCount(1)
  await expect(page.locator('.reservation-block.blue')).toHaveCount(2)
  await expect(page.locator('.reservation-block.orange')).toHaveCount(2)
  await expect(page.locator('.reservation-block:not(.blue):not(.orange)')).toHaveCount(2)

  await page.goto('/?view=customer')
  for (const label of ['来店', '調整', '購入']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(page.getByRole('button', { name: 'すべての履歴を見る' })).toBeVisible()

  await page.goto('/?view=dashboard')
  await expect(page.locator('.chart-svg circle')).toHaveCount(7)
  await expect(page.locator('.donut-legend li')).toHaveText([
    'メガネの作製　45%',
    'メガネの調整　25%',
    '検眼・相談　20%',
    'コンタクト　10%',
  ])
  await expect(page.locator('.donut')).toHaveCSS('background-image', /130, 174, 111/)
})

test('静的SPAをWorkerが配信する', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/EYEX予約/)
  await expect(page.getByRole('button', { name: '新規予約' })).toBeVisible()
})

test('source parity: 未入力の予約確定を抑止し、必要入力後だけ有効にする', async ({ page }) => {
  await page.goto('/?view=booking')
  const confirm = page.getByRole('button', { name: '予約を確定する' })
  await expect(confirm).toBeDisabled()
  await page.getByLabel('電話番号').fill('090000000')
  await page.getByRole('button', { name: /佐藤 みどり/ }).click()
  await page.getByLabel('日付').fill('2025-05-20')
  await page.getByLabel('開始時間').selectOption('14:00')
  await page.getByRole('button', { name: '検眼・カウンセリング' }).click()
  await page.getByRole('button', { name: '14:00 〜 15:30' }).click()
  await expect(confirm).toBeEnabled()
})

test('source parity: 変更モーダルの日時・担当者を保存しURLと一覧へ反映する', async ({ page }) => {
  await page.goto('/?view=ledger')
  await page.getByRole('button', { name: /佐藤 みどり/ }).click()
  await page.getByRole('button', { name: '予約を変更' }).click()
  await page.getByLabel('変更後の日付').fill('2025-05-21')
  await page.getByLabel('変更後の時間').selectOption('16:00 〜 17:30')
  await page.getByLabel('変更後の担当者').selectOption('田中 健一')
  await page.getByRole('button', { name: '変更を保存' }).click()
  await expect(page).toHaveURL(/view=ledger/)
  await expect(page.getByText('予約内容を変更しました')).toBeVisible()
  await page.getByRole('button', { name: '予約詳細を閉じる' }).click()
  await page.getByRole('link', { name: '予約一覧' }).click()
  await expect(page).toHaveURL(/view=list/)
  await expect(page.locator('tr').filter({ hasText: '佐藤 みどり' })).toHaveCount(0)
  await page.getByLabel('日付').selectOption('すべて')
  const changedReservation = page.locator('tr').filter({ hasText: '佐藤 みどり' })
  await expect(changedReservation).toHaveCount(1)
  await expect(changedReservation).toContainText('16:00 〜 17:30')
  await expect(changedReservation).toContainText('田中 健一')
})

test('source parity: 登録顧客を顧客カルテの先頭顧客として表示する', async ({ page }) => {
  await page.goto('/?view=booking')
  await page.getByLabel('お名前').fill('高橋 あかり')
  await page.getByRole('button', { name: '情報を検索' }).click()
  await page.getByRole('heading', { name: '新規顧客登録' }).waitFor()
  await page.getByLabel('登録氏名').fill('高橋 あかり')
  await page.getByLabel('登録電話番号').fill('090-1111-2222')
  await page.getByLabel('登録性別').selectOption('女性')
  await page.getByLabel('登録年代').selectOption('30代')
  await page.getByLabel('登録生年月日').fill('1990-04-12')
  await page.getByLabel('登録会員ID').fill('M-9001')
  await page.getByLabel('登録最終来店日').fill('2025-08-20')
  await page.getByLabel('登録用件').fill('メガネの作製')
  await page.getByRole('button', { name: '顧客を登録する' }).click()
  await page.getByRole('button', { name: 'メニュー' }).click()
  await page
    .getByRole('dialog', { name: 'メインメニュー' })
    .getByRole('link', { name: '顧客台帳' })
    .click()
  await expect(page.getByRole('heading', { name: '顧客カルテ' })).toBeVisible()
  await expect(page.getByText('高橋 あかり 様')).toBeVisible()
  await expect(page.getByText('女性・30代')).toBeVisible()
  await expect(page.getByText('1990/04/12')).toBeVisible()
  await expect(page.getByText('M-9001')).toBeVisible()
  await expect(page.getByText('2025/08/20')).toBeVisible()
  await expect(page.getByText('メガネの作製', { exact: true })).toBeVisible()
})

test('source parity: header and secondary controls produce source-like state changes', async ({
  page,
}) => {
  await page.goto('/?view=booking')
  await page.getByRole('button', { name: '通話メモ' }).click()
  await expect(page.getByText('通話メモを保存しました')).toBeVisible()

  await page.goto('/?view=ledger')
  await page.getByRole('button', { name: '？ サポート' }).click()
  await expect(page.getByText('サポートを表示しました')).toBeVisible()

  await page.goto('/?view=list')
  await page.getByRole('button', { name: '↻ 更新' }).click()
  await expect(page.getByText('予約一覧を更新しました')).toBeVisible()

  await page.goto('/?view=customer')
  await page.locator('.profile-card').getByRole('button', { name: '編集' }).click()
  await expect(page.getByText('顧客情報を編集しました')).toBeVisible()
  await page.locator('.note-card').getByRole('button', { name: '編集' }).click()
  await expect(page.getByText('メモ編集を開きました')).toBeVisible()
})

test('source parity: 全画面の参照操作が状態変化または通知を返す', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '次の日' }).click()
  await expect(page.getByRole('button', { name: '21' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '前の日' }).click()
  await expect(page.getByRole('button', { name: '20' })).toHaveAttribute('aria-pressed', 'true')

  await page.goto('/?view=booking')
  await page.getByRole('button', { name: '編集' }).click()
  await expect(page.getByText('選択中の条件を編集できます')).toBeVisible()
  await page.getByRole('button', { name: '↻ 更新' }).click()
  await expect(page.getByText('候補枠を更新しました')).toBeVisible()
  await page.getByRole('button', { name: '他の時間も見る　⌄' }).click()
  await expect(page.getByText('他の時間帯を表示しています')).toBeVisible()

  await page.goto('/?view=ledger')
  await page.getByRole('button', { name: '↻' }).click()
  await expect(page.getByText('台帳を更新しました')).toBeVisible()
  await page.goto('/?view=list')
  await page.getByLabel('担当者で絞り込み').selectOption('鈴木 明日香')
  await page.getByRole('button', { name: 'クリア' }).click()
  await expect(page.getByText('絞り込みをクリアしました')).toBeVisible()

  await page.goto('/?view=customer')
  await page.getByRole('button', { name: '顧客情報を編集' }).click()
  await expect(page.getByText('顧客情報を編集しました')).toBeVisible()
  await page.goto('/?view=dashboard')
  await page.getByRole('button', { name: /2025\/05\/20/ }).click()
  await expect(page.getByText('日付を選択できます')).toBeVisible()
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
  await expect(page).toHaveURL(/view=list/)
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
  await expect(page.locator('.home-page')).toHaveCSS('background-color', 'rgb(35, 86, 38)')
  for (const name of ['新規予約', '予約変更', '受付履歴'])
    await expect(page.getByRole('button', { name })).toBeInViewport()
  await expect(page.locator('.home-date-strip')).toBeInViewport()
  await page.getByRole('button', { name: '新規予約' }).click()
  await expect(page.locator('.booking-grid')).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.recording-widget')).toBeVisible()
  await expect(page.locator('.recording-widget')).toHaveCSS('animation-name', 'none')
})

test('ホームは元モックのdesktop/mobile構造とテーマを保つ', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')
  await expect(page.locator('.home-inner')).toHaveCSS('max-width', '900px')
  await expect(page.locator('.home-heading')).toBeHidden()
  await expect(page.locator('.home-foot')).toBeHidden()
  await expect(page.locator('.home-action.primary')).toHaveCount(2)
  const desktopDate = await page.locator('.home-date-strip').boundingBox()
  const desktopActions = await page.locator('.home-actions').boundingBox()
  expect(desktopActions?.y).toBeLessThan(desktopDate?.y ?? Number.POSITIVE_INFINITY)
  expect(desktopDate?.y).toBeGreaterThan(640)
  expect(desktopDate?.y).toBeLessThan(670)
  await expect(page.locator('.app-header')).toHaveCSS('background-color', 'rgb(35, 86, 38)')

  await page.goto('/?view=ledger')
  await expect(page.locator('.app-header')).toHaveCSS('background-image', /linear-gradient/)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.home-heading')).toBeHidden()
  const mobileActions = await page.locator('.home-actions').boundingBox()
  const mobileDate = await page.locator('.home-date-strip').boundingBox()
  expect(mobileActions?.y).toBeLessThan(mobileDate?.y ?? Number.POSITIVE_INFINITY)
  await expect(page.locator('.home-action.primary')).toHaveCount(2)
  await expect(page.locator('.home-action.utility')).toHaveCount(3)
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
