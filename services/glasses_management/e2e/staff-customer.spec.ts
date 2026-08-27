import { expect, type Page, test } from '@playwright/test'

/*
 * EYEX スタッフ端末の顧客台帳（顧客記録）の E2E。
 *
 * ホームの副操作「顧客台帳」から開き、候補を選ぶと
 * `GET /api/staff/stores/:storeId/customers/:customerId` の CustomerDetail が
 * 領域ごとに描画される。何が見えるかは
 * `GET /api/staff/stores/:storeId/permissions` の応答だけで決まるため、
 * 権限の有無はその payload を差し替えて駆動する。
 *
 * 共有 iPad（横向き 1180×820）が前提なので viewport をそれに合わせる。
 */

const VIEWPORT = { width: 1180, height: 820 }

const ginzaId = '11111111-1111-4111-8111-111111111111'
const marunouchiId = '22222222-2222-4222-8222-222222222222'
const hanakoId = '55555555-5555-4555-8555-555555555555'

const stores = [
  {
    id: ginzaId,
    organizationId: 'org-eyex',
    name: '銀座店',
    slug: 'ginza',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: marunouchiId,
    organizationId: 'org-eyex',
    name: '丸の内店',
    slug: 'marunouchi',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
]

const hanako = {
  id: hanakoId,
  name: '田中花子',
  kana: 'タナカハナコ',
  phone: '090-1234-5678',
  email: null,
  primaryStoreId: ginzaId,
  visitCount: 4,
}

/** 選択中店舗（銀座）と他店舗（丸の内）の行が必ず両方入った顧客記録。 */
const detail = {
  customerId: hanakoId,
  currentPrescription: {
    measuredOn: '2026-06-01',
    storeId: ginzaId,
    storeName: '銀座店',
    recordedBy: '山田検査員',
    rightSphere: '-3.25',
    leftSphere: '-3.00',
    pupillaryDistance: '62.0',
    addPower: null,
  },
  pastPrescriptions: [
    {
      measuredOn: '2024-05-10',
      storeId: ginzaId,
      storeName: '銀座店',
      recordedBy: '佐藤検査員',
      rightSphere: '-2.75',
      leftSphere: '-2.50',
      pupillaryDistance: '61.5',
      addPower: null,
    },
    {
      measuredOn: '2023-04-02',
      storeId: marunouchiId,
      storeName: '丸の内店',
      recordedBy: '高橋検査員',
      rightSphere: '-2.25',
      leftSphere: '-2.00',
      pupillaryDistance: '61.0',
      addPower: '+1.00',
    },
  ],
  latestNote: {
    recordedOn: '2026-06-01',
    storeId: ginzaId,
    storeName: '銀座店',
    recordedBy: '鈴木',
    body: '遠近両用を検討中。手元の見え方を気にされている。',
  },
  ownedGlasses: [
    {
      label: 'メタルフレーム(黒)',
      purchasedOn: '2024-05-10',
      storeId: ginzaId,
      storeName: '銀座店',
      lensType: '単焦点',
    },
    {
      label: 'セルフレーム(べっ甲)',
      purchasedOn: '2023-04-02',
      storeId: marunouchiId,
      storeName: '丸の内店',
      lensType: '遠近両用',
    },
  ],
  attentionNotes: [
    {
      body: '鼻あての金属で肌が荒れやすい。',
      basis: '2025-02-10のご本人申告',
      recordedBy: '鈴木',
      recordedOn: '2025-02-12',
    },
  ],
  visitHistory: [
    { visitedOn: '2026-06-01', storeId: ginzaId, storeName: '銀座店', summary: '視力測定' },
    {
      visitedOn: '2025-12-20',
      storeId: marunouchiId,
      storeName: '丸の内店',
      summary: 'フィッティング調整',
    },
  ],
}

const allPermissions = [
  'store.read',
  'reservation.read',
  'customer.read',
  'customer.history',
  'attention.read',
]

/**
 * スタッフ API をすべて差し替える。`permissions` は毎回読み直されるので、
 * mutable な参照から返して、リロードだけで権限を切り替えられるようにする。
 */
async function mockStaffApi(page: Page, permissions: { current: string[] }) {
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({ json: { token: 'staff-e2e' } }),
  )
  await page.route('**/api/staff/stores', (route) => route.fulfill({ json: stores }))
  await page.route('**/api/staff/store-switches', (route) =>
    route.fulfill({ status: 201, json: {} }),
  )
  await page.route('**/api/staff/stores/*/permissions', (route) =>
    route.fulfill({ json: permissions.current }),
  )
  await page.route('**/api/staff/stores/*/ledger*', (route) => route.fulfill({ json: [] }))
  await page.route('**/api/staff/stores/*/customers**', (route) => {
    const path = new URL(route.request().url()).pathname
    // 候補検索と 1 件取得は同じ接頭辞なので、パスの形で振り分ける。
    return path.endsWith('/customers')
      ? route.fulfill({ json: [hanako] })
      : route.fulfill({ json: detail })
  })
}

/** ホーム → 副操作「顧客台帳」 → 電話番号で検索 → 候補を選ぶ、まで進める。 */
async function openCustomerRecord(page: Page) {
  await page.setViewportSize(VIEWPORT)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '銀座店のホーム' })).toBeVisible()
  await page
    .getByRole('navigation', { name: '副操作' })
    .getByRole('button', { name: '顧客台帳' })
    .click()
  await expect(page.getByRole('heading', { name: 'お客様を探す' })).toBeVisible()
  await page.getByLabel('電話番号', { exact: true }).fill('09012345678')
  await page.getByRole('button', { name: '候補を探す' }).click()
  const option = page.getByRole('listbox', { name: '顧客候補' }).getByRole('option')
  await expect(option).toHaveCount(1)
  await option.click()
  await expect(option).toHaveAttribute('aria-selected', 'true')
  return page.getByRole('region', { name: '選択中のお客様' })
}

// @e2e-covers UC-EYEX-025 UC-EYEX-027 UC-EYEX-030 AC-EYEX-04 AC-EYEX-16 AC-EYEX-24
test('shows the picked customer の現在情報・注意事項 before the history, with 現在度数 and 過去度数 kept apart', async ({
  page,
}) => {
  await mockStaffApi(page, { current: [...allPermissions] })
  const selected = await openCustomerRecord(page)
  await expect(selected).toContainText('田中花子 様')

  // 候補を選ぶだけで、現在度数・最新メモ・保有メガネ・注意事項が揃う（UC-EYEX-025 / AC-EYEX-04）。
  const current = selected.getByRole('region', { name: '現在の度数' })
  const note = selected.getByRole('region', { name: '最新メモ' })
  const glasses = selected.getByRole('region', { name: '保有メガネ' })
  const attention = selected.getByRole('region', { name: '注意事項' })
  await expect(current).toBeVisible()
  await expect(note).toBeVisible()
  await expect(glasses).toBeVisible()
  await expect(attention).toBeVisible()
  await expect(note).toContainText('遠近両用を検討中')
  await expect(note).toContainText('鈴木')
  await expect(glasses).toContainText('メタルフレーム(黒)（単焦点）')

  // 現在の度数と過去の度数は別領域で、どちらの行にも測定日・店舗・記録者がある
  // （UC-EYEX-027 / AC-EYEX-24）。
  const past = selected.getByRole('region', { name: '過去の度数' })
  await expect(past).toBeVisible()
  expect(await current.getByRole('region').count()).toBe(0)
  await expect(current).toContainText('R -3.25 / L -3.00 / PD 62.0')
  await expect(current).toContainText('測定日 2026-06-01・店舗 銀座店・記録者 山田検査員')
  await expect(current).not.toContainText('2024-05-10')
  const pastRows = past.getByRole('listitem')
  await expect(pastRows).toHaveCount(2)
  await expect(pastRows.nth(0)).toContainText('測定日 2024-05-10・店舗 銀座店・記録者 佐藤検査員')
  await expect(pastRows.nth(1)).toContainText('測定日 2023-04-02・店舗 丸の内店・記録者 高橋検査員')

  // 注意事項は必ず根拠・記録者・記録日つき（UC-EYEX-030）。
  const attentionRows = attention.getByRole('listitem')
  await expect(attentionRows).toHaveCount(1)
  await expect(attentionRows.first()).toContainText('鼻あての金属で肌が荒れやすい。')
  await expect(attentionRows.first()).toContainText(
    '根拠 2025-02-10のご本人申告・記録者 鈴木・記録日 2025-02-12',
  )

  // 現在の情報は履歴より先に出る（AC-EYEX-16）。DOM 順・描画位置の両方で確かめる。
  const history = selected.getByRole('region', { name: '来店履歴' })
  await expect(history).toBeVisible()
  const labels = await selected
    .getByRole('region')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
  expect(labels).toEqual([
    '現在の度数',
    '最新メモ',
    '保有メガネ',
    '注意事項',
    '過去の度数',
    '来店履歴',
  ])
  const currentBox = await current.boundingBox()
  const historyBox = await history.boundingBox()
  const pastBox = await past.boundingBox()
  if (!currentBox || !historyBox || !pastBox) throw new Error('customer record not measurable')
  expect(currentBox.y).toBeLessThan(pastBox.y)
  expect(pastBox.y).toBeLessThan(historyBox.y)
})

// @e2e-covers UC-EYEX-026 AC-EYEX-10
test('shows the chain-wide history only while the store grants customer.history', async ({
  page,
}) => {
  const permissions = { current: [...allPermissions] }
  await mockStaffApi(page, permissions)
  const granted = await openCustomerRecord(page)

  // 権限があれば、他店舗で記録された来店・購入・度数まで見える（UC-EYEX-026 / AC-EYEX-10）。
  const grantedVisits = granted.getByRole('region', { name: '来店履歴' }).getByRole('listitem')
  await expect(grantedVisits).toHaveCount(2)
  await expect(grantedVisits.nth(0)).toContainText('2026-06-01・銀座店・視力測定')
  await expect(grantedVisits.nth(1)).toContainText('2025-12-20・丸の内店・フィッティング調整')
  await expect(granted.getByRole('region', { name: '保有メガネ' })).toContainText('丸の内店')
  await expect(granted.getByRole('region', { name: '過去の度数' })).toContainText('丸の内店')

  // 同じ顧客・同じ API 応答でも、customer.history が無い店舗では選択中店舗の行だけ。
  permissions.current = ['store.read', 'reservation.read', 'customer.read', 'attention.read']
  const withheld = await openCustomerRecord(page)
  const withheldVisits = withheld.getByRole('region', { name: '来店履歴' }).getByRole('listitem')
  await expect(withheldVisits).toHaveCount(1)
  await expect(withheldVisits.first()).toContainText('2026-06-01・銀座店・視力測定')
  await expect(withheld.getByRole('region', { name: '来店履歴' })).not.toContainText('丸の内店')
  await expect(
    withheld.getByRole('region', { name: '過去の度数' }).getByRole('listitem'),
  ).toHaveCount(1)
  await expect(withheld.getByRole('region', { name: '保有メガネ' })).not.toContainText('丸の内店')
  // 伏せた行の件数も、存在の標識も出さない。
  await expect(withheld).not.toContainText('丸の内店')
})
