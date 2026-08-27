import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CustomerMergeScreen } from './CustomerMergeScreen'

const STORE_ID = '00000000-0000-4000-8000-000000000010'
const PRIMARY_ID = '00000000-0000-4000-8000-000000000401'
const DUPLICATE_ID = '00000000-0000-4000-8000-000000000402'
const RESERVATION_ID = '00000000-0000-4000-8000-000000000501'
const TODAY = '2026-08-27'
const NOW = '2026-08-27T05:30:00.000Z'

const FULL = ['customer.read', 'customer.write', 'customer.history'] as const

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

const impact = {
  reservations: 4,
  walkins: 1,
  prescriptions: 2,
  notes: 3,
  attentionNotes: 1,
  ownedGlasses: 2,
}

const preview = {
  primary: {
    customerId: PRIMARY_ID,
    name: '田中 花子',
    kana: 'タナカ ハナコ',
    phone: '090-1234-5678',
    primaryStoreId: STORE_ID,
    visitCount: 7,
  },
  duplicate: {
    customerId: DUPLICATE_ID,
    name: '田中 花子',
    kana: 'タナカ ハナコ',
    phone: '090-1234-5679',
    primaryStoreId: STORE_ID,
    visitCount: 2,
  },
  impact,
  alreadyMerged: false,
}

type Route = { url: string; init?: RequestInit }

function createApi(handler: (route: Route) => Response | Promise<Response>) {
  const calls: Route[] = []
  const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = { url: String(input), init }
    calls.push(route)
    return handler(route)
  })
  return { api, calls }
}

function renderScreen(
  api: ReturnType<typeof createApi>['api'],
  permissions: readonly string[] = FULL,
) {
  render(
    <CustomerMergeScreen
      storeId={STORE_ID}
      storeName="銀座店"
      api={api as never}
      navigate={vi.fn()}
      permissions={permissions as never}
      today={TODAY}
      now={NOW}
    />,
  )
}

function bodyOf(route: Route): unknown {
  return JSON.parse(String(route.init?.body))
}

function compare() {
  fireEvent.change(screen.getByLabelText('残す顧客ID'), { target: { value: PRIMARY_ID } })
  fireEvent.change(screen.getByLabelText('重複している顧客ID'), {
    target: { value: DUPLICATE_ID },
  })
  fireEvent.click(screen.getByRole('button', { name: '重複候補を比較する' }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('比較しただけでは決して統合しない (UC-EYEX-181, AC-EYEX-121)', async () => {
  const { api, calls } = createApi(() => jsonResponse(preview))
  renderScreen(api)
  compare()

  const comparison = await screen.findByRole('region', { name: '重複候補の比較' })
  expect(within(comparison).getByText('090-1234-5678')).toBeInTheDocument()
  expect(within(comparison).getByText('090-1234-5679')).toBeInTheDocument()

  const impactList = screen.getByRole('region', { name: '統合の影響' })
  expect(within(impactList).getByText('予約')).toBeInTheDocument()
  expect(within(impactList).getByText('注意事項')).toBeInTheDocument()
  expect(within(impactList).getByText('合計 13件')).toBeInTheDocument()

  expect(calls).toHaveLength(1)
  expect(calls[0]?.url).toBe(`/api/staff/stores/${STORE_ID}/customer-merges/preview`)
  expect(bodyOf(calls[0] as Route)).toEqual({
    primaryCustomerId: PRIMARY_ID,
    duplicateCustomerId: DUPLICATE_ID,
  })
  expect(calls.some((route) => route.url.endsWith('/customer-merges'))).toBe(false)
})

test('影響と理由を確認したうえでのみ統合する (UC-EYEX-181, AC-EYEX-121)', async () => {
  const { api, calls } = createApi((route) =>
    route.url.endsWith('/customer-merges')
      ? jsonResponse({
          primaryCustomerId: PRIMARY_ID,
          mergedCustomerId: DUPLICATE_ID,
          impact,
          mergedAt: NOW,
        })
      : jsonResponse(preview),
  )
  renderScreen(api)
  compare()

  await screen.findByRole('region', { name: '統合の影響' })
  fireEvent.click(screen.getByRole('button', { name: '統合する' }))

  // 取り返しのつかない書き込みの確認なので alertdialog（design/dialogs の urgent）。
  const dialog = await screen.findByRole('alertdialog', { name: '顧客の統合を確認' })
  expect(dialog).toHaveTextContent('13件の履歴が残す顧客へ移ります。')
  fireEvent.click(within(dialog).getByRole('button', { name: '統合を実行する' }))
  expect(await within(dialog).findByText('理由を入力してください。')).toBeInTheDocument()
  expect(calls.some((route) => route.url.endsWith('/customer-merges'))).toBe(false)

  fireEvent.change(within(dialog).getByLabelText('統合する理由'), {
    target: { value: '同一人物と確認できた。' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '統合を実行する' }))

  await screen.findByText('統合しました。実行者・日時・変更前後を監査記録に残しました。')
  expect(bodyOf(calls.find((route) => route.url.endsWith('/customer-merges')) as Route)).toEqual({
    primaryCustomerId: PRIMARY_ID,
    duplicateCustomerId: DUPLICATE_ID,
    reason: '同一人物と確認できた。',
    acknowledgedImpactTotal: 13,
  })
})

test('影響が食い違えば統合せず最新の影響を見せ直す (AC-EYEX-121)', async () => {
  const changed = { ...impact, reservations: 9 }
  const { api } = createApi((route) =>
    route.url.endsWith('/customer-merges')
      ? jsonResponse({ error: 'merge_impact_unacknowledged', impact: changed }, 409)
      : jsonResponse(preview),
  )
  renderScreen(api)
  compare()

  await screen.findByRole('region', { name: '統合の影響' })
  fireEvent.click(screen.getByRole('button', { name: '統合する' }))
  // 取り返しのつかない書き込みの確認なので alertdialog（design/dialogs の urgent）。
  const dialog = await screen.findByRole('alertdialog', { name: '顧客の統合を確認' })
  fireEvent.change(within(dialog).getByLabelText('統合する理由'), {
    target: { value: '同一人物。' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '統合を実行する' }))

  await screen.findByText(
    '影響件数が変わりました。最新の影響を確認してからもう一度実行してください。',
  )
  expect(
    within(screen.getByRole('region', { name: '統合の影響' })).getByText('合計 18件'),
  ).toBeInTheDocument()
})

test('統合済みの顧客は統合できない (UC-EYEX-181)', async () => {
  const { api } = createApi(() => jsonResponse({ ...preview, alreadyMerged: true }))
  renderScreen(api)
  compare()

  expect(await screen.findByText('この顧客はすでに統合されています。')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '統合する' })).not.toBeInTheDocument()
})

test('誤関連解除は明示操作と理由を要求する (UC-EYEX-181, AC-EYEX-121)', async () => {
  const { api, calls } = createApi(() =>
    jsonResponse({
      entryType: 'reservation',
      entryId: RESERVATION_ID,
      previousCustomerId: DUPLICATE_ID,
      releasedAt: NOW,
    }),
  )
  renderScreen(api)

  fireEvent.change(screen.getByLabelText('受付種別'), { target: { value: 'reservation' } })
  fireEvent.change(screen.getByLabelText('受付ID'), { target: { value: RESERVATION_ID } })
  fireEvent.click(screen.getByRole('button', { name: '誤関連を解除する' }))

  const dialog = await screen.findByRole('alertdialog', { name: '誤った顧客関連の解除を確認' })
  fireEvent.click(within(dialog).getByRole('button', { name: '解除を実行する' }))
  expect(await within(dialog).findByText('理由を入力してください。')).toBeInTheDocument()
  expect(calls).toHaveLength(0)

  fireEvent.change(within(dialog).getByLabelText('解除する理由'), {
    target: { value: '別人の予約に紐づいていた。' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '解除を実行する' }))

  await screen.findByText(
    '顧客との関連を解除しました。実行者・日時・変更前後を監査記録に残しました。',
  )
  expect(calls[0]?.url).toBe(`/api/staff/stores/${STORE_ID}/customer-links/release`)
  expect(bodyOf(calls[0] as Route)).toEqual({
    entryType: 'reservation',
    entryId: RESERVATION_ID,
    reason: '別人の予約に紐づいていた。',
  })
})

test('監査に残せない統合は成立させず、入力を保持して再試行を出す (UC-EYEX-156, AC-EYEX-103)', async () => {
  let attempts = 0
  const { api, calls } = createApi((route) => {
    if (!route.url.endsWith('/customer-merges')) return jsonResponse(preview)
    attempts += 1
    return attempts === 1
      ? jsonResponse({ error: 'audit_append_failed' }, 500)
      : jsonResponse({
          primaryCustomerId: PRIMARY_ID,
          mergedCustomerId: DUPLICATE_ID,
          impact,
          mergedAt: NOW,
        })
  })
  renderScreen(api)
  compare()

  await screen.findByRole('region', { name: '統合の影響' })
  fireEvent.click(screen.getByRole('button', { name: '統合する' }))
  // 取り返しのつかない書き込みの確認なので alertdialog（design/dialogs の urgent）。
  const dialog = await screen.findByRole('alertdialog', { name: '顧客の統合を確認' })
  fireEvent.change(within(dialog).getByLabelText('統合する理由'), {
    target: { value: '同一人物。' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '統合を実行する' }))

  await screen.findByText(
    '監査記録に残せなかったため、この操作は成立していません。入力はそのまま保持しています。',
  )
  expect(within(screen.getByRole('alertdialog')).getByLabelText('統合する理由')).toHaveValue(
    '同一人物。',
  )
  fireEvent.click(screen.getByRole('button', { name: '再試行する' }))

  await screen.findByText('統合しました。実行者・日時・変更前後を監査記録に残しました。')
  expect(calls.filter((route) => route.url.endsWith('/customer-merges'))).toHaveLength(2)
})

test('権限外は顧客の突き合わせ画面そのものを出さない (AC-EYEX-121)', () => {
  const { api } = createApi(() => jsonResponse(preview))
  renderScreen(api, ['customer.read'])

  expect(api).not.toHaveBeenCalled()
  // 権限が無い面は EX-403 の全画面状態そのもの。名乗るのはモックの見出し。
  const denied = screen.getByRole('region', { name: 'この設定を表示する権限がありません' })
  expect(denied).toHaveTextContent(
    '権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。',
  )
  expect(within(denied).getByRole('button', { name: '業務開始画面へ戻る' })).toBeInTheDocument()
  // モック `#permission-denied` の 54px の記号。
  expect(within(denied).getByText('—')).toBeInTheDocument()
  expect(screen.queryByLabelText('残す顧客ID')).not.toBeInTheDocument()
})

// 承認済みモックの語彙: 取り返しのつかない操作は `danger`（白地に警告色の罫と字）で、
// 既定の見た目にしない。
test('統合と解除の確定は危険な操作として描く', async () => {
  const { api } = createApi(() => jsonResponse(preview))
  renderScreen(api)
  compare()
  await screen.findByRole('region', { name: '統合の影響' })

  for (const name of ['統合する', '誤関連を解除する']) {
    const button = screen.getByRole('button', { name })
    expect(button.className).toContain('border-danger')
    expect(button.className).toContain('text-danger')
  }

  fireEvent.click(screen.getByRole('button', { name: '統合する' }))
  // 取り返しのつかない書き込みの確認なので alertdialog（design/dialogs の urgent）。
  const dialog = await screen.findByRole('alertdialog', { name: '顧客の統合を確認' })
  const run = within(dialog).getByRole('button', { name: '統合を実行する' })
  expect(run.className).toContain('border-danger')
  expect(run.className).toContain('text-danger')
})

// 突き合わせは 2 面を並べて見せる（モックの `.compare{grid-template-columns:1fr 1fr}`）。
test('残す顧客と重複している顧客を 2 面で並べる', async () => {
  const { api } = createApi(() => jsonResponse(preview))
  renderScreen(api)
  compare()

  const comparison = await screen.findByRole('region', { name: '重複候補の比較' })
  const pair = comparison.firstElementChild as HTMLElement
  expect(pair.className).toContain('grid-cols-2')
  expect(within(comparison).getByRole('region', { name: '残す顧客' })).toBeInTheDocument()
  expect(within(comparison).getByRole('region', { name: '重複している顧客' })).toBeInTheDocument()
})

test('端末に顧客情報を残さない (完全共有iPad)', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  const { api } = createApi(() => jsonResponse(preview))
  renderScreen(api)
  compare()

  await screen.findByRole('region', { name: '統合の影響' })
  expect(setItem).not.toHaveBeenCalled()
})
