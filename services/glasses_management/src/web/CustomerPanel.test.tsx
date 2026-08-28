import type { CustomerCandidate, CustomerDetail } from '@app/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { BookingCustomerStepContext, CustomerPanel } from './CustomerPanel'
import type { StaffScreenProps } from './staff-screen'

const storeId = '00000000-0000-4000-8000-0000000000a1'
const otherStoreId = '00000000-0000-4000-8000-0000000000a2'

const hanako: CustomerCandidate = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: '田中 花子',
  kana: 'タナカ ハナコ',
  phone: '090-1234-5678',
  email: 'hanako@example.com',
  primaryStoreId: storeId,
  visitCount: 4,
}
const ichiro: CustomerCandidate = {
  id: '00000000-0000-4000-8000-0000000000c2',
  name: '田中 一郎',
  kana: 'タナカ イチロウ',
  phone: '090-1234-9912',
  email: null,
  primaryStoreId: storeId,
  visitCount: 1,
}

const detail: CustomerDetail = {
  customerId: hanako.id,
  currentPrescription: {
    measuredOn: '2026-05-18',
    storeId,
    storeName: '銀座店',
    recordedBy: '佐藤 美咲',
    rightSphere: '-2.25',
    leftSphere: '-2.00',
    pupillaryDistance: '62.0',
    addPower: '+1.00',
  },
  pastPrescriptions: [
    {
      measuredOn: '2024-11-02',
      storeId: otherStoreId,
      storeName: '丸の内店',
      recordedBy: '山田 太郎',
      rightSphere: '-2.00',
      leftSphere: '-1.75',
      pupillaryDistance: '62.0',
      addPower: null,
    },
  ],
  latestNote: {
    recordedOn: '2026-05-18',
    storeId,
    storeName: '銀座店',
    recordedBy: '佐藤 美咲',
    body: 'PC作業用。鼻パッドは低め。',
  },
  ownedGlasses: [
    {
      label: '遠近両用',
      purchasedOn: '2026-02-10',
      storeId: otherStoreId,
      storeName: '丸の内店',
      lensType: '遠近両用',
    },
  ],
  attentionNotes: [
    {
      body: '度数変更の理由を段階的に説明する。',
      basis: '接客記録',
      recordedBy: '佐藤 美咲',
      recordedOn: '2026-02-10',
    },
  ],
  visitHistory: [
    { visitedOn: '2026-05-18', storeId, storeName: '銀座店', summary: 'フィッティング調整' },
    {
      visitedOn: '2026-02-10',
      storeId: otherStoreId,
      storeName: '丸の内店',
      summary: '視力測定・新調',
    },
  ],
}

const allowed = { crossStoreHistory: true, attentionNotes: true }
const denied = { crossStoreHistory: false, attentionNotes: false }

function staffProps(api: StaffScreenProps['api']): StaffScreenProps {
  return { storeId, storeName: '銀座店', api, navigate: vi.fn() }
}

function jsonApi(candidates: CustomerCandidate[]) {
  return vi.fn(async () => new Response(JSON.stringify(candidates), { status: 200 }))
}

/*
 * 顧客台帳の左レールはモックどおり検索欄が 1 本きり（`氏名・電話番号`）で、
 * 探すボタンを持たない。Enter（form submit）で確定的に探す。
 */
async function searchLedger(value: string) {
  const field = screen.getByLabelText('顧客を検索')
  fireEvent.change(field, { target: { value } })
  fireEvent.submit(field.closest('form') as HTMLFormElement)
}

/** 予約フローの 4 工程目として描くときの足場（工程見出しは予約フローのもの）。 */
function renderBooking(
  api: StaffScreenProps['api'],
  overrides: Partial<Parameters<typeof CustomerPanel>[0]> = {},
) {
  const onSelect = vi.fn()
  const onConfirm = vi.fn()
  render(
    <BookingCustomerStepContext.Provider value={{ header: null, onConfirm }}>
      <CustomerPanel
        {...staffProps(api)}
        mode="booking"
        onSelect={onSelect}
        permissions={allowed}
        {...overrides}
      />
    </BookingCustomerStepContext.Provider>,
  )
  return { onSelect, onConfirm }
}

/** モックには探すボタンが無いので、Enter（form submit）で確定的に探す。 */
async function searchPhone(value: string) {
  const field = screen.getByLabelText('お電話番号')
  fireEvent.change(field, { target: { value } })
  fireEvent.submit(field.closest('form') as HTMLFormElement)
}

/*
 * BOOK-CUSTOMER（承認済みモック）の 4 工程目。
 *
 * 主列は「フォーム」ではなく「お客様の特定」である: 大きな電話番号欄 1 本、
 * 候補カード、そして「新しいお客様として登録する」。氏名・かな・メモは、この
 * 工程で候補を選んだ後の入力面（`BookingFlow` 側）に移った。
 */
test('主列は 1 本の電話番号欄と候補カードだけを持ち、氏名やメモの欄を持たない (UC-EYEX-021, AC-EYEX-03)', async () => {
  const api = jsonApi([hanako, ichiro])
  renderBooking(api, { storeNames: { [storeId]: '銀座店' } })
  await searchPhone('090-1234')

  const list = await screen.findByRole('list', { name: '顧客候補' })
  expect(api).toHaveBeenCalledWith(`/api/staff/stores/${storeId}/customers?phone=0901234`)
  expect(list).toHaveTextContent('田中 花子 様')
  expect(list).toHaveTextContent('090-1234-5678 · 銀座店4回')
  expect(list).toHaveTextContent('田中 一郎 様')
  expect(screen.queryByLabelText('氏名')).toBeNull()
  expect(screen.queryByLabelText('氏名かな')).toBeNull()
  expect(screen.queryByRole('button', { name: '候補を探す' })).toBeNull()
})

test('選んだ候補は 選択中、他は 候補 と語で示す (AC-EYEX-03)', async () => {
  renderBooking(jsonApi([hanako, ichiro]))
  await searchPhone('090-1234')
  const cards = await screen.findAllByRole('button', { name: /^田中/ })
  expect(cards[0]).toHaveTextContent('候補')
  fireEvent.click(cards[0] as HTMLElement)
  const chosen = screen.getByRole('button', { name: /田中 花子/ })
  expect(chosen).toHaveTextContent('選択中')
  expect(chosen).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /田中 一郎/ })).toHaveTextContent('候補')
})

test('新規登録の文言はモックのまま 新しいお客様として登録する である (UC-EYEX-024)', async () => {
  const { onSelect, onConfirm } = renderBooking(jsonApi([]))
  await searchPhone('090-9999')
  expect(await screen.findByText('該当するお客様は見つかりませんでした')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '新しいお客様として進む' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '新しいお客様として登録する' }))
  expect(onSelect).toHaveBeenLastCalledWith(undefined)
  expect(onConfirm).toHaveBeenLastCalledWith(undefined, '090-9999')
})

test('normalises a full-width phone number before searching (AC-EYEX-20)', async () => {
  const api = jsonApi([hanako])
  renderBooking(api)
  await searchPhone('０９０－１２３４－５６７８')
  await screen.findByRole('button', { name: /田中 花子/ })
  expect(api).toHaveBeenCalledWith(`/api/staff/stores/${storeId}/customers?phone=09012345678`)
})

test('入力が止まったら押さずに候補を探す (モックに探すボタンが無い)', async () => {
  const api = jsonApi([hanako])
  renderBooking(api)
  fireEvent.change(screen.getByLabelText('お電話番号'), { target: { value: '090-1234' } })
  await screen.findByRole('button', { name: /田中 花子/ })
  expect(api).toHaveBeenCalledWith(`/api/staff/stores/${storeId}/customers?phone=0901234`)
})

test('binds no customer until the staff member picks one (UC-EYEX-023, AC-EYEX-21)', async () => {
  const { onSelect, onConfirm } = renderBooking(jsonApi([hanako]))
  await searchPhone('090-1234')
  const card = await screen.findByRole('button', { name: /田中 花子/ })
  expect(card).toHaveAttribute('aria-pressed', 'false')
  expect(onSelect).not.toHaveBeenCalled()
  expect(screen.getByText('お客様は未確定です')).toBeInTheDocument()

  fireEvent.click(card)
  expect(onSelect).toHaveBeenCalledWith(hanako)
  expect(onConfirm).toHaveBeenCalledWith(hanako, '090-1234')
})

test('脇の列は 現在の度数・対応時に確認・最新メモ をこの順で出す (UC-EYEX-025, AC-EYEX-04)', async () => {
  renderBooking(jsonApi([hanako]), { detail })
  await searchPhone('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))

  const rail = screen.getByRole('complementary', { name: '選択中のお客様' })
  const regions = within(rail)
    .getAllByRole('region')
    .map((region) => region.getAttribute('aria-label'))
  expect(regions).toEqual(['現在の度数', '対応時に確認', '最新メモ'])
  expect(rail).toHaveTextContent('R -2.25 / L -2.00 / PD 62.0')
  expect(rail).toHaveTextContent('度数変更の理由を段階的に説明する。')
  expect(rail).toHaveTextContent('根拠: 2026.02.10の接客記録')
  expect(rail).toHaveTextContent('PC作業用。鼻パッドは低め。')
})

test('注意事項を見られないスタッフには 対応時に確認 の存在ごと出さない (AC-EYEX-91)', async () => {
  renderBooking(jsonApi([hanako]), { detail, permissions: denied })
  await searchPhone('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const rail = screen.getByRole('complementary', { name: '選択中のお客様' })
  expect(within(rail).queryByRole('region', { name: '対応時に確認' })).toBeNull()
  expect(rail).not.toHaveTextContent('度数変更の理由')
})

test('shows possible duplicates without merging them (UC-EYEX-028)', async () => {
  const twin: CustomerCandidate = {
    ...ichiro,
    id: '00000000-0000-4000-8000-0000000000c3',
    phone: '09012345678',
  }
  const { onSelect } = renderBooking(jsonApi([hanako, twin]))
  await searchPhone('090-1234')
  expect(
    await screen.findByText('同じ電話番号の候補があります。統合はされません。'),
  ).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /^田中/ })).toHaveLength(2)
  expect(onSelect).not.toHaveBeenCalled()
})

test('候補カードはキーボードだけで辿って選べる', async () => {
  const { onSelect } = renderBooking(jsonApi([hanako, ichiro]))
  await searchPhone('090-1234')
  const cards = await screen.findAllByRole('button', { name: /^田中/ })
  for (const card of cards) expect(card).not.toHaveAttribute('tabindex', '-1')
  ;(cards[1] as HTMLElement).focus()
  expect(document.activeElement).toBe(cards[1])
  fireEvent.click(cards[1] as HTMLElement)
  expect(onSelect).toHaveBeenLastCalledWith(ichiro)
})

test('refuses to search without a term and reports a failed search', async () => {
  const failing = vi.fn(async () => new Response('nope', { status: 500 }))
  renderBooking(failing)
  await searchPhone('')
  expect(
    await screen.findByText('検索する電話番号・氏名・氏名かなを入力してください'),
  ).toBeInTheDocument()
  expect(failing).not.toHaveBeenCalled()

  await searchPhone('090-1234')
  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent('顧客候補を取得できませんでした')
  })
})

test('a new search unbinds the previously selected customer', async () => {
  const { onSelect } = renderBooking(jsonApi([hanako]))
  await searchPhone('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  expect(onSelect).toHaveBeenLastCalledWith(hanako)

  await searchPhone('090-5555')
  await waitFor(() => {
    expect(onSelect).toHaveBeenLastCalledWith(undefined)
  })
  expect(screen.getByText('お客様は未確定です')).toBeInTheDocument()
})

test('keeps 現在度数 and 過去度数 in separate regions with 測定日・店舗・記録者 (UC-EYEX-027, AC-EYEX-24)', async () => {
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))

  const current = screen.getByRole('region', { name: '現在の度数' })
  const past = screen.getByRole('region', { name: '過去の度数' })
  expect(current).not.toBe(past)
  expect(current).not.toContainElement(past)
  /*
   * 承認済みモック `CUSTOMER-CURRENT` の日付は `2026.02.10` の形で、生の ISO は
   * どの面にも無い。既に「根拠」と「記録日」だけが点に直されており、測定日・
   * 購入日・最新メモだけ生のままだった。
   */
  expect(current).toHaveTextContent('2026.05.18')
  expect(current).not.toHaveTextContent('2026-05-18')
  expect(current).toHaveTextContent('銀座店')
  expect(current).toHaveTextContent('佐藤 美咲')
  expect(current).not.toHaveTextContent('2024.11.02')
  expect(past).toHaveTextContent('2024.11.02')
  expect(past).not.toHaveTextContent('2024-11-02')
  expect(past).toHaveTextContent('丸の内店')
  expect(past).toHaveTextContent('山田 太郎')
})

test('最新メモの日付も点で区切る (CUSTOMER-CURRENT)', async () => {
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))

  /* 現在のメガネは日付を持たない（用途ごとの本数だけを名乗る）。日付の書き方は
     日付を出す面——最新メモと来店履歴——で確かめる。 */
  const note = screen.getByRole('region', { name: '最新メモ' })
  expect(note).toHaveTextContent('2026.05.18')
  expect(note).not.toHaveTextContent('2026-05-18')
})

test('the ledger puts 現在情報 before 履歴 (AC-EYEX-16)', async () => {
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))

  const current = screen.getByRole('region', { name: '現在の度数' })
  const history = screen.getByRole('region', { name: '来店履歴' })
  expect(current.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('shows cross-store visit history only to permitted staff (UC-EYEX-026, AC-EYEX-10)', async () => {
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const history = screen.getByRole('region', { name: '来店履歴' })
  expect(history).toHaveTextContent('丸の内店')
  expect(history).toHaveTextContent('視力測定・新調')
})

test('carries 根拠・記録者・記録日 on every 対応時に確認 (UC-EYEX-030)', async () => {
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const attention = screen.getByRole('region', { name: '対応時に確認' })
  expect(attention).toHaveTextContent('根拠 接客記録')
  expect(attention).toHaveTextContent('記録者 佐藤 美咲')
  expect(attention).toHaveTextContent('記録日 2026.02.10')
})

test('hides even the existence of restricted information from unpermitted staff (UC-EYEX-029, AC-EYEX-91)', async () => {
  const { container } = render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={denied}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))

  // 注意事項は権限がなければ領域ごと存在しない。来店履歴は自店舗分だけが残り、
  // 他店舗分が「ある」ことを示す痕跡（件数・伏字・無効化された枠）を一切出さない。
  expect(screen.queryByRole('region', { name: '対応時に確認' })).toBeNull()
  const history = screen.getByRole('region', { name: '来店履歴' })
  expect(history).toHaveTextContent('銀座店')
  expect(history).toHaveTextContent('フィッティング調整')
  const text = container.textContent ?? ''
  for (const marker of [
    '注意事項',
    '丸の内店',
    '度数変更の理由を段階的に説明する。',
    '視力測定・新調',
    '権限',
    '閲覧できません',
    '件あります',
    '非表示',
    '制限',
  ]) {
    expect(text).not.toContain(marker)
  }
  expect(container.querySelectorAll('[disabled],[aria-disabled="true"]')).toHaveLength(0)
  // 現在情報は権限に依らず見える。
  expect(screen.getByRole('region', { name: '現在の度数' })).toHaveTextContent('R -2.25')
})

test('renders an explicit 未取得 state when no detail has been loaded', async () => {
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  expect(screen.getByText('顧客情報は未取得です')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '現在の度数' })).toBeNull()
})

test('never writes customer data to browser storage', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  expect(setItem).not.toHaveBeenCalled()
  setItem.mockRestore()
})

test('loads the chosen customer record from the server instead of waiting to be handed one', async () => {
  // The panel is given a store-scoped api; the record it shows must come from
  // the server's own permission evaluation, not from whatever a parent guessed.
  const api = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input).includes('/customers?')) return new Response(JSON.stringify([hanako]))
    if (String(input).endsWith(`/customers/${hanako.id}`))
      return new Response(JSON.stringify({ ...detail, customerId: hanako.id }))
    throw new Error(`unexpected request ${String(input)}`)
  })
  render(
    <CustomerPanel
      {...({ storeId, storeName: '銀座店', api, navigate: () => {} } as StaffScreenProps)}
      mode="ledger"
      onSelect={() => {}}
      permissions={{ crossStoreHistory: true, attentionNotes: true }}
    />,
  )

  await searchLedger('090')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))

  await waitFor(() =>
    expect(
      api.mock.calls.some(([input]) => String(input).endsWith(`/customers/${hanako.id}`)),
    ).toBe(true),
  )
  expect(await screen.findByText(/-2\.25/)).toBeInTheDocument()
})

test('opens the attention-note review for the chosen customer from the ledger', async () => {
  // Notes are recorded and reviewed against one customer, so the only honest
  // entry point is a customer the operator has already chosen.
  const navigate = vi.fn()
  const api = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input).includes('/customers?')) return new Response(JSON.stringify([hanako]))
    return new Response(JSON.stringify({ ...detail, customerId: hanako.id }))
  })
  render(
    <CustomerPanel
      {...({ storeId, storeName: '銀座店', api, navigate } as StaffScreenProps)}
      mode="ledger"
      onSelect={() => {}}
      permissions={{ crossStoreHistory: true, attentionNotes: true }}
    />,
  )

  await searchLedger('090')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))

  fireEvent.click(await screen.findByRole('button', { name: '注意事項を確認・登録する' }))

  expect(navigate).toHaveBeenCalledWith({
    screen: 'attention-review',
    customerId: hanako.id,
    customerName: hanako.name,
  })
})

/*
 * 承認済みモック `.customer-top{grid-template-columns:repeat(3,1fr)}`。
 * 柱を引いた幅でも 3 枚が横に並び続けること、そして和文が板からはみ出さない
 * こと。自動の枚数決めに任せると 2 列へ落ち、「現在のメガネ」が段を下げる。
 */
test('現在の度数・最新メモ・現在のメガネ は 1 枚の幅を守って並べる', async () => {
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const columns = screen
    .getByRole('region', { name: '現在の度数' })
    .closest('div[style*="grid-template-columns"]')
  expect(columns).not.toBeNull()
  /*
   * 守るのは枚数ではなく 1 枚の幅。3 列を固定すると、柱 250px と詳細レール
   * 390px を引いた残りで 1 枚 152px になり `測定日 2026-06-` / `01・店舗` と
   * 語中で折れる。モックのこのカードは 236〜247px あった。
   */
  expect(columns?.getAttribute('style')).toContain('repeat(auto-fit, minmax(200px, 1fr))')
  // `keep-all` は和文をどこでも折らないので、狭い列からはみ出す。
  expect(columns?.getAttribute('style')).not.toContain('keep-all')
})

/*
 * 承認済みモック `staff-approved.html#customer-ledger` の来店履歴は
 * 「2026.05.18 銀座店 フィッティング調整」と、点区切りの日付・店舗・要約を
 * 空白で並べる。中黒で繋ぐと店舗名と要約の切れ目が読めなくなる。
 */
test('来店履歴 reads as the approved mock writes it (AC-EYEX-16)', async () => {
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const history = screen.getByRole('region', { name: '来店履歴' })
  expect(history).toHaveTextContent('2026.05.18 銀座店 フィッティング調整')
  expect(history).toHaveTextContent('2026.02.10 丸の内店 視力測定・新調')
})

/* モックの注記は「日付が先、根拠が次」で、区切りは中黒ではなく `·`。 */
test('対応時に確認 leads with the date, as the approved mock does (UC-EYEX-030)', async () => {
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const attention = screen.getByRole('region', { name: '対応時に確認' })
  expect(attention).toHaveTextContent('記録日 2026.02.10 · 根拠 接客記録 · 記録者 佐藤 美咲')
})

/*
 * 承認済みモック `staff-approved.html#customer-ledger` の並びそのもの。
 *
 *   .customer-top（現在の度数 / 最新メモ / 現在のメガネ）→ 対応時に確認 → 来店履歴
 *
 * 「過去の度数」はモックに無い増補（`CustomerPanel` の注記のとおり）なので、
 * モックの並びを崩さないように最後へ回す。ここが崩れると、接客の直前に読む
 * 面（現在値と注意）より先に過去の記録が目に入る。
 */
test('顧客台帳の面はモックの並びで出る (CUSTOMER-CURRENT)', async () => {
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))

  const order = ['現在の度数', '最新メモ', '現在のメガネ', '対応時に確認', '来店履歴', '過去の度数']
  const regions = order.map((name) => screen.getByRole('region', { name }))
  for (const [index, region] of regions.entries()) {
    const next = regions[index + 1]
    if (next === undefined) continue
    expect(region.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
})

/*
 * 承認済みモックの「現在のメガネ」は `遠近両用1本 · 近用1本` という数の要約で、
 * 1 本ずつの購入日や店舗は並べていない。3 枚組の 1 枚に収まる分量で「いま何を
 * 使っているお客様か」を先に言う面であり、本数より細かい話は来店履歴が持つ。
 */
test('現在のメガネは用途ごとの本数で要約する', async () => {
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const region = await screen.findByRole('region', { name: '現在のメガネ' })
  expect(region.textContent).toContain('遠近両用1本')
  expect(region.textContent).not.toContain('メタルフレーム')
})

/*
 * 承認済みモックの「現在の度数」は `R -2.25 / L -2.00` と `PD 62.0 · ADD +1.00`
 * の 2 行に分かれている。1 行に繋ぐと、3 枚組の狭い 1 枚で語中に折れる。
 * 出所（測定日・店舗・記録者）はモックに無いが AC-EYEX-24 が求めるので残す。
 */
test('現在の度数はモックと同じ 2 行に分ける', async () => {
  render(
    <CustomerPanel
      {...staffProps(jsonApi([hanako]))}
      mode="ledger"
      onSelect={vi.fn()}
      permissions={allowed}
      detail={detail}
    />,
  )
  await searchLedger('090-1234')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const region = await screen.findByRole('region', { name: '現在の度数' })
  expect(region.textContent).toContain('PD 62.0 · ADD')
  expect(region.textContent).toContain('測定日')
})
