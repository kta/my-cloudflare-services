import type { Recording } from '@app/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import {
  type RecordingView,
  ReservationSearchScreen,
  toRecordingView,
} from './ReservationSearchScreen'

const STORE_ID = '00000000-0000-4000-8000-000000000010'
const PURPOSE_ID = '00000000-0000-4000-8000-000000000020'
const TANAKA_ID = '00000000-0000-4000-8000-000000000001'
const TANAKA_ICHIRO_ID = '00000000-0000-4000-8000-000000000002'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response
}

const tanaka = {
  id: TANAKA_ID,
  organizationId: 'org-1',
  storeId: STORE_ID,
  reservationNumber: 'EY-0827-1100',
  source: 'staff' as const,
  status: 'confirmed' as const,
  startAt: '2026-08-27T02:00:00.000Z',
  endAt: '2026-08-27T03:00:00.000Z',
  purposeIds: [PURPOSE_ID],
  customer: {
    name: '田中 花子',
    kana: 'タナカ ハナコ',
    phone: '090-1234-5678',
    email: null,
  },
  recital: '8月27日11時にご来店ください。',
  reservationMemo: null,
  handoffNote: null,
  version: 3,
  createdAt: '2026-08-20T01:00:00.000Z',
}

const tanakaIchiro = {
  ...tanaka,
  id: TANAKA_ICHIRO_ID,
  reservationNumber: 'EY-0829-1330',
  customer: {
    name: '田中 一郎',
    kana: 'タナカ イチロウ',
    phone: '090-1234-9912',
    email: null,
  },
  startAt: '2026-08-29T04:30:00.000Z',
  endAt: '2026-08-29T05:30:00.000Z',
  version: 1,
}

const slotsResponse = {
  storeId: STORE_ID,
  date: '2026-08-28',
  timezone: 'Asia/Tokyo' as const,
  durationMinutes: 60,
  intervalMinutes: 30,
  slots: [
    {
      date: '2026-08-28',
      startTime: '10:00',
      endTime: '11:00',
      startAt: '2026-08-28T01:00:00.000Z',
      endAt: '2026-08-28T02:00:00.000Z',
    },
    {
      date: '2026-08-28',
      startTime: '14:00',
      endTime: '15:00',
      startAt: '2026-08-28T05:00:00.000Z',
      endAt: '2026-08-28T06:00:00.000Z',
    },
  ],
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
  handler: (route: Route) => Response | Promise<Response>,
  extra: {
    reservationId?: string
    recording?: RecordingView
    permissions?: { playRecording: boolean }
    onReservationOpened?: (reservationId: string) => void
  } = {},
) {
  const { api, calls } = createApi(handler)
  const navigate = vi.fn()
  render(
    <ReservationSearchScreen
      storeId={STORE_ID}
      storeName="銀座店"
      api={api}
      navigate={navigate}
      today="2026-08-27"
      {...extra}
    />,
  )
  return { api, calls, navigate }
}

function searchFor(term: string) {
  fireEvent.change(screen.getByLabelText('氏名・電話番号・予約番号'), { target: { value: term } })
  fireEvent.click(screen.getByRole('button', { name: '検索する' }))
}

function listResponse(reservations: unknown[]) {
  return (route: Route) => {
    if (route.url.includes('/reservations?') || route.url.endsWith('/reservations'))
      return jsonResponse(reservations)
    if (route.url.endsWith('/history')) return jsonResponse([])
    return jsonResponse({ error: 'unexpected' }, 500)
  }
}

// UC-EYEX-056 / AC-EYEX-90: the store is fixed; no store filter, no 全店舗 option.
test('fixes the search to the selected store and offers no store filter', async () => {
  const { calls } = renderScreen(listResponse([tanaka]))
  expect(screen.getByText(/銀座店の予約だけ/)).toBeInTheDocument()
  expect(screen.queryByText('全店舗')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('店舗')).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: /店舗/ })).not.toBeInTheDocument()

  searchFor('田中')
  await screen.findByRole('button', { name: /田中 花子/ })
  const searchCall = calls.find((call) => call.url.includes('/reservations?'))
  expect(searchCall?.url.startsWith(`/api/staff/stores/${STORE_ID}/reservations?`)).toBe(true)
  expect(searchCall?.url).not.toContain('storeId=')
  expect(searchCall?.url).not.toContain('allStores')
})

// AC-EYEX-14 / AC-EYEX-20: phone matching is normalised.
test('normalises hyphens, spaces and full-width digits in a phone search', async () => {
  const { calls } = renderScreen(listResponse([tanaka]))
  searchFor('０９０-１２３４ ５６７８')
  await screen.findByRole('button', { name: /田中 花子/ })
  const searchCall = calls.find((call) => call.url.includes('/reservations?'))
  expect(searchCall?.url).toContain('phone=09012345678')
  expect(searchCall?.url).not.toContain('name=')
})

// AC-EYEX-14: a reservation number search uses the reservation number field.
test('searches by reservation number when the term contains a reservation code', async () => {
  const { calls } = renderScreen(listResponse([tanaka]))
  searchFor('EY-0827-1100')
  await screen.findByRole('button', { name: /田中 花子/ })
  const searchCall = calls.find((call) => call.url.includes('/reservations?'))
  expect(searchCall?.url).toContain('reservationNumber=EY-0827-1100')
})

// AC-EYEX-14: a kana term searches the kana field rather than the name field.
test('searches by kana when the term is written in kana', async () => {
  const { calls } = renderScreen(listResponse([tanaka]))
  searchFor('タナカ')
  await screen.findByRole('button', { name: /田中 花子/ })
  const searchCall = calls.find((call) => call.url.includes('/reservations?'))
  expect(searchCall?.url).toContain('kana=')
  expect(searchCall?.url).not.toContain('name=')
})

// AC-EYEX-21: name candidates bind nothing until the operator picks one.
test('shows name candidates and binds nothing until the operator picks one', async () => {
  renderScreen(listResponse([tanaka, tanakaIchiro]))
  searchFor('田中')
  await screen.findByRole('button', { name: /田中 花子/ })
  expect(screen.getByRole('button', { name: /田中 一郎/ })).toBeInTheDocument()
  expect(screen.getByText('候補から予約を選択してください。')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '予約を取り消す' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /田中 一郎/ }))
  const detail = await screen.findByRole('region', { name: '予約詳細' })
  expect(within(detail).getByText('田中 一郎 様')).toBeInTheDocument()
  expect(within(detail).queryByText('田中 花子 様')).not.toBeInTheDocument()
})

// UC-EYEX-057: results list and the selected detail stay visible together.
test('keeps the results list visible next to the selected reservation detail', async () => {
  renderScreen(listResponse([tanaka, tanakaIchiro]))
  searchFor('田中')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  await screen.findByRole('region', { name: '予約詳細' })
  const list = screen.getByRole('region', { name: '検索結果' })
  expect(within(list).getByRole('button', { name: /田中 花子/ })).toBeInTheDocument()
  expect(within(list).getByRole('button', { name: /田中 一郎/ })).toBeInTheDocument()
})

// UC-EYEX-057 / AC-EYEX-21: a preselected reservation opens its detail directly.
test('opens the preselected reservation detail', async () => {
  renderScreen(
    (route) => {
      if (route.url.endsWith(`/reservations/${TANAKA_ID}`)) return jsonResponse(tanaka)
      if (route.url.endsWith('/history')) return jsonResponse([])
      return jsonResponse([], 200)
    },
    { reservationId: TANAKA_ID },
  )
  const detail = await screen.findByRole('region', { name: '予約詳細' })
  expect(within(detail).getByText('田中 花子 様')).toBeInTheDocument()
})

// UC-EYEX-058: the destination slot is looked for while the original is held.
test('looks for a destination slot while the original reservation is still held', async () => {
  renderScreen(async (route) => {
    if (route.url.includes('/availability/slots')) return jsonResponse(slotsResponse)
    if (route.url.endsWith('/history')) return jsonResponse([])
    return jsonResponse([tanaka])
  })
  searchFor('田中')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  fireEvent.click(await screen.findByRole('button', { name: '日時・内容を変更する' }))
  fireEvent.change(screen.getByLabelText('変更先の日'), { target: { value: '2026-08-28' } })
  fireEvent.click(screen.getByRole('button', { name: '空き枠を探す' }))

  expect(await screen.findByRole('button', { name: '10:00〜11:00' })).toBeInTheDocument()
  // The original reservation is untouched while the operator looks around.
  const detail = screen.getByRole('region', { name: '予約詳細' })
  expect(within(detail).getByText('2026年8月27日 11:00')).toBeInTheDocument()
  expect(within(detail).getByText('予約済み')).toBeInTheDocument()
})

// UC-EYEX-059: the switch happens only after the destination is secured.
test('switches the reservation only after the destination slot is secured', async () => {
  const { calls } = renderScreen(async (route) => {
    if (route.url.includes('/availability/slots')) return jsonResponse(slotsResponse)
    if (route.url.endsWith('/history')) return jsonResponse([])
    if (route.init?.method === 'PATCH')
      return jsonResponse({
        ...tanaka,
        startAt: '2026-08-28T01:00:00.000Z',
        endAt: '2026-08-28T02:00:00.000Z',
        version: 4,
      })
    return jsonResponse([tanaka])
  })
  searchFor('田中')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  fireEvent.click(await screen.findByRole('button', { name: '日時・内容を変更する' }))
  fireEvent.change(screen.getByLabelText('変更先の日'), { target: { value: '2026-08-28' } })
  fireEvent.click(screen.getByRole('button', { name: '空き枠を探す' }))
  fireEvent.click(await screen.findByRole('button', { name: '10:00〜11:00' }))
  fireEvent.change(screen.getByLabelText('変更理由'), { target: { value: 'お客様都合' } })
  fireEvent.click(screen.getByRole('button', { name: 'この枠に切り替える' }))

  await waitFor(() => {
    expect(calls.some((call) => call.init?.method === 'PATCH')).toBe(true)
  })
  const patch = calls.find((call) => call.init?.method === 'PATCH')
  expect(patch?.url).toBe(`/api/staff/stores/${STORE_ID}/reservations/${TANAKA_ID}`)
  const headers = patch?.init?.headers as Record<string, string>
  expect(headers['idempotency-key']).toBeTruthy()
  expect(JSON.parse(String(patch?.init?.body))).toEqual({
    version: 3,
    date: '2026-08-28',
    startTime: '10:00',
    purposeIds: [PURPOSE_ID],
    reason: 'お客様都合',
  })
  expect(await screen.findByText('2026年8月28日 10:00')).toBeInTheDocument()
})

// AC-EYEX-22: a conflicting new slot keeps the original and offers alternatives.
test('keeps the original reservation and offers alternatives when the new slot conflicts', async () => {
  let slotCalls = 0
  renderScreen(async (route) => {
    if (route.url.includes('/availability/slots')) {
      slotCalls += 1
      return jsonResponse(
        slotCalls === 1 ? slotsResponse : { ...slotsResponse, slots: [slotsResponse.slots[1]] },
      )
    }
    if (route.url.endsWith('/history')) return jsonResponse([])
    if (route.init?.method === 'PATCH') return jsonResponse({ error: 'slot_unavailable' }, 409)
    return jsonResponse([tanaka])
  })
  searchFor('田中')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  fireEvent.click(await screen.findByRole('button', { name: '日時・内容を変更する' }))
  fireEvent.change(screen.getByLabelText('変更先の日'), { target: { value: '2026-08-28' } })
  fireEvent.click(screen.getByRole('button', { name: '空き枠を探す' }))
  fireEvent.click(await screen.findByRole('button', { name: '10:00〜11:00' }))
  fireEvent.change(screen.getByLabelText('変更理由'), { target: { value: 'お客様都合' } })
  fireEvent.click(screen.getByRole('button', { name: 'この枠に切り替える' }))

  expect(
    await screen.findByText('選択した枠を確保できませんでした。元の予約はそのままです。'),
  ).toBeInTheDocument()
  const detail = screen.getByRole('region', { name: '予約詳細' })
  expect(within(detail).getByText('2026年8月27日 11:00')).toBeInTheDocument()
  expect(within(detail).getByText('予約済み')).toBeInTheDocument()
  // Alternatives are offered instead.
  expect(await screen.findByRole('button', { name: '14:00〜15:00' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '10:00〜11:00' })).not.toBeInTheDocument()
})

// AC-EYEX-22: a stale version keeps the original reservation intact too.
test('reports a version conflict without losing the original reservation', async () => {
  renderScreen(async (route) => {
    if (route.url.includes('/availability/slots')) return jsonResponse(slotsResponse)
    if (route.url.endsWith('/history')) return jsonResponse([])
    if (route.init?.method === 'PATCH')
      return jsonResponse({ error: 'version_conflict', currentVersion: 7 }, 409)
    return jsonResponse([tanaka])
  })
  searchFor('田中')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  fireEvent.click(await screen.findByRole('button', { name: '日時・内容を変更する' }))
  fireEvent.change(screen.getByLabelText('変更先の日'), { target: { value: '2026-08-28' } })
  fireEvent.click(screen.getByRole('button', { name: '空き枠を探す' }))
  fireEvent.click(await screen.findByRole('button', { name: '10:00〜11:00' }))
  fireEvent.change(screen.getByLabelText('変更理由'), { target: { value: 'お客様都合' } })
  fireEvent.click(screen.getByRole('button', { name: 'この枠に切り替える' }))

  expect(
    await screen.findByText('別の端末で更新されました。最新の内容を読み直してください。'),
  ).toBeInTheDocument()
  const detail = screen.getByRole('region', { name: '予約詳細' })
  expect(within(detail).getByText('2026年8月27日 11:00')).toBeInTheDocument()
})

// UC-EYEX-060 / AC-EYEX-23: cancellation needs a reason and a deliberate confirmation.
test('refuses to cancel without a reason and a deliberate confirmation', async () => {
  const { calls } = renderScreen(listResponse([tanaka]))
  searchFor('田中')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  fireEvent.click(await screen.findByRole('button', { name: '予約を取り消す' }))
  fireEvent.click(screen.getByRole('button', { name: '取消を実行する' }))
  expect(await screen.findByText('取消理由を入力してください。')).toBeInTheDocument()
  expect(calls.some((call) => call.init?.method === 'POST')).toBe(false)

  fireEvent.change(screen.getByLabelText('取消理由'), { target: { value: 'お客様都合' } })
  fireEvent.click(screen.getByRole('button', { name: '取消を実行する' }))
  expect(await screen.findByText('確認のため「取消」と入力してください。')).toBeInTheDocument()
  expect(calls.some((call) => call.init?.method === 'POST')).toBe(false)
})

// UC-EYEX-060, UC-EYEX-061 / AC-EYEX-23: the audit history shows actor, time and before.
test('cancels with a reason and shows the actor, time and previous content in the history', async () => {
  const historyEntry = {
    id: '00000000-0000-4000-8000-0000000000a1',
    reservationId: TANAKA_ID,
    action: 'cancelled' as const,
    reason: 'お客様都合',
    before: {
      status: 'confirmed' as const,
      startAt: '2026-08-27T02:00:00.000Z',
      endAt: '2026-08-27T03:00:00.000Z',
      purposeIds: [PURPOSE_ID],
      version: 3,
    },
    after: {
      status: 'cancelled' as const,
      startAt: '2026-08-27T02:00:00.000Z',
      endAt: '2026-08-27T03:00:00.000Z',
      purposeIds: [PURPOSE_ID],
      version: 4,
    },
    actorId: '鈴木',
    occurredAt: '2026-08-27T01:30:00.000Z',
  }
  let cancelled = false
  const { calls } = renderScreen(async (route) => {
    if (route.url.endsWith('/history')) return jsonResponse(cancelled ? [historyEntry] : [])
    if (route.url.endsWith('/cancel')) {
      cancelled = true
      return jsonResponse({ ...tanaka, status: 'cancelled', version: 4 })
    }
    return jsonResponse([tanaka])
  })
  searchFor('田中')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  fireEvent.click(await screen.findByRole('button', { name: '予約を取り消す' }))
  fireEvent.change(screen.getByLabelText('取消理由'), { target: { value: 'お客様都合' } })
  fireEvent.change(screen.getByLabelText('確認入力'), { target: { value: '取消' } })
  fireEvent.click(screen.getByRole('button', { name: '取消を実行する' }))

  const cancelCall = await waitFor(() => {
    const call = calls.find((entry) => entry.url.endsWith('/cancel'))
    expect(call).toBeDefined()
    return call
  })
  expect(JSON.parse(String(cancelCall?.init?.body))).toEqual({
    version: 3,
    reason: 'お客様都合',
    confirmation: '取消',
  })
  const history = await screen.findByRole('region', { name: '変更履歴' })
  await waitFor(() => {
    const text = history.textContent ?? ''
    expect(text).toContain('鈴木')
    expect(text).toContain('2026年8月27日 10:30')
    expect(text).toContain('変更前')
    expect(text).toContain('2026年8月27日 11:00')
  })
})

// UC-EYEX-062: recording state is one of 録音なし / 処理中 / 保存失敗 / 削除済み.
test.each([
  [{ state: 'none' } as RecordingView, '録音なし'],
  [{ state: 'processing' } as RecordingView, '処理中'],
  [{ state: 'failed' } as RecordingView, '保存失敗'],
  [{ state: 'deleted' } as RecordingView, '削除済み'],
])('shows the recording state %#', async (recording, label) => {
  renderScreen(listResponse([tanaka]), {
    recording,
    permissions: { playRecording: true },
  })
  searchFor('田中')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const region = await screen.findByRole('region', { name: 'iPad録音' })
  expect(within(region).getByText('予約受付時の録音')).toBeInTheDocument()
  expect(within(region).getByText(label)).toBeInTheDocument()
  expect(within(region).queryByRole('button', { name: '再生' })).not.toBeInTheDocument()
})

// UC-EYEX-062: with no recording information at all the screen says so.
test('shows 未取得 when no recording information is supplied', async () => {
  renderScreen(listResponse([tanaka]), { permissions: { playRecording: true } })
  searchFor('田中')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const region = await screen.findByRole('region', { name: 'iPad録音' })
  expect(within(region).getByText('未取得')).toBeInTheDocument()
})

// AC-EYEX-15 / AC-EYEX-79: permitted staff get metadata and playback, never a download.
test('shows recording metadata and playback controls without any download control', async () => {
  renderScreen(listResponse([tanaka]), {
    recording: {
      state: 'available',
      recordedAt: '2026-08-20T01:05:00.000Z',
      recordedBy: '鈴木',
      durationSeconds: 192,
      src: '/api/staff/recordings/stream',
    },
    permissions: { playRecording: true },
  })
  searchFor('田中')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const region = await screen.findByRole('region', { name: 'iPad録音' })
  // モックの `.audio` ブロック: 44px 円形 pine の再生ボタン + 承認済みの一行。
  expect(within(region).getByText('予約受付時の録音')).toBeInTheDocument()
  expect(within(region).queryByText('iPad録音')).not.toBeInTheDocument()
  expect(within(region).getByText('保存済み')).toBeInTheDocument()
  expect(
    within(region).getByText('ダウンロードはできません。再生操作は監査されます。'),
  ).toBeInTheDocument()
  expect(within(region).getByText('2026年8月20日 10:05')).toBeInTheDocument()
  expect(within(region).getByText('鈴木')).toBeInTheDocument()
  expect(within(region).getAllByText('03:12').length).toBeGreaterThan(0)
  const play = within(region).getByRole('button', { name: '再生' })
  expect(play.className).toContain('size-11')
  expect(play.className).toContain('rounded-circle')
  expect(play.className).toContain('bg-pine')
  expect(within(region).getByRole('button', { name: '再生' })).toBeInTheDocument()
  expect(within(region).getByRole('button', { name: '一時停止' })).toBeInTheDocument()
  expect(within(region).getByLabelText('再生位置')).toBeInTheDocument()
  expect(within(region).queryByRole('button', { name: /ダウンロード/ })).not.toBeInTheDocument()
  expect(within(region).queryByRole('link', { name: /ダウンロード/ })).not.toBeInTheDocument()
  expect(region.querySelector('a[download]')).toBeNull()
})

// AC-EYEX-79: staff without the permission never see the recording or its controls.
test('hides the recording entirely from staff without playback permission', async () => {
  renderScreen(listResponse([tanaka]), {
    recording: {
      state: 'available',
      recordedAt: '2026-08-20T01:05:00.000Z',
      recordedBy: '鈴木',
      durationSeconds: 192,
      src: '/api/staff/recordings/stream',
    },
    permissions: { playRecording: false },
  })
  searchFor('田中')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  await screen.findByRole('region', { name: '予約詳細' })
  expect(screen.queryByRole('region', { name: 'iPad録音' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '再生' })).not.toBeInTheDocument()
})

// UC-EYEX-056: period, source and status narrow the fixed-store search.
test('narrows the fixed-store search by period, source and status', async () => {
  const { calls } = renderScreen(listResponse([tanaka]))
  fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2026-08-27' } })
  fireEvent.change(screen.getByLabelText('終了日'), { target: { value: '2026-08-31' } })
  fireEvent.change(screen.getByLabelText('予約元'), { target: { value: 'web' } })
  fireEvent.change(screen.getByLabelText('状態'), { target: { value: 'confirmed' } })
  searchFor('田中')
  await screen.findByRole('button', { name: /田中 花子/ })
  const searchCall = calls.find((call) => call.url.includes('/reservations?'))
  expect(searchCall?.url).toContain('dateFrom=2026-08-27')
  expect(searchCall?.url).toContain('dateTo=2026-08-31')
  expect(searchCall?.url).toContain('source=web')
  expect(searchCall?.url).toContain('status=confirmed')
})

// AC-EYEX-14: a failed search says so instead of silently showing nothing.
test('reports a failed search', async () => {
  renderScreen(() => jsonResponse({ error: 'boom' }, 500))
  searchFor('田中')
  expect(
    await screen.findByText('予約を検索できませんでした。もう一度お試しください。'),
  ).toBeInTheDocument()
})

/*
 * UC-EYEX-062 / AC-EYEX-15: the contract's nine recording states collapse onto
 * the four this screen distinguishes — 録音なし / 処理中 / 保存失敗 / 削除済み —
 * plus 保存済み with playback. 保全中 and 削除予定 are still playable evidence,
 * so they read as 保存済み here; their operational wording lives in 録音運用.
 */
const RECORDING_SRC = `/api/staff/stores/${STORE_ID}/recordings/r1/audio`

function contractRecording(state: Recording['state']): Recording {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    organizationId: 'org',
    storeId: STORE_ID,
    receptionSessionId: '00000000-0000-4000-8000-0000000000bb',
    reservationId: null,
    recorderType: 'personal',
    recorderId: '鈴木',
    startedAt: '2026-08-27T05:00:00.000Z',
    endedAt: '2026-08-27T05:03:12.000Z',
    durationSeconds: 192,
    endReason: 'completed',
    state,
    retentionUntil: null,
    holdReason: null,
    heldBy: null,
    heldAt: null,
    deletedAt: null,
    failureReason: null,
    version: 1,
  }
}

test('契約の録音状態を画面の語彙へ写す', () => {
  expect(toRecordingView(undefined, RECORDING_SRC)).toEqual({ state: 'none' })
  for (const state of ['permission_check', 'recording', 'stopped', 'uploading'] as const)
    expect(toRecordingView(contractRecording(state), RECORDING_SRC)).toEqual({
      state: 'processing',
    })
  expect(toRecordingView(contractRecording('failed'), RECORDING_SRC)).toEqual({ state: 'failed' })
  expect(toRecordingView(contractRecording('deleted'), RECORDING_SRC)).toEqual({
    state: 'deleted',
  })
  for (const state of ['stored', 'held', 'pending_deletion'] as const)
    expect(toRecordingView(contractRecording(state), RECORDING_SRC)).toEqual({
      state: 'available',
      recordedAt: '2026-08-27T05:03:12.000Z',
      recordedBy: '鈴木',
      durationSeconds: 192,
      src: RECORDING_SRC,
    })
})

test('tells the workspace which reservation is open so its recording can be supplied', async () => {
  // List and detail stay on screen together (UC-EYEX-057), so the recording for
  // the open reservation cannot be delivered by navigating away — the screen has
  // to say which one it is (UC-EYEX-032, AC-EYEX-15).
  const onReservationOpened = vi.fn()
  renderScreen(listResponse([tanaka]), { onReservationOpened })

  fireEvent.change(screen.getByLabelText('氏名・電話番号・予約番号'), {
    target: { value: '田中' },
  })
  fireEvent.click(screen.getByRole('button', { name: '検索する' }))
  const results = await screen.findByRole('region', { name: '検索結果' })
  fireEvent.click(within(results).getAllByRole('button')[0] as HTMLElement)

  await waitFor(() => expect(onReservationOpened).toHaveBeenCalledWith(tanaka.id))
})

/* ------------------------------------------------------------------ *
 * 承認済みモックの構造（staff-approved.html `#reservation-search`）
 * ------------------------------------------------------------------ */

// `.workspace{grid-template-columns:390px 1fr}` / `.list` は panel 面 + 右ヘアライン。
test('lays the workspace out as the approved two-pane 390px + 1fr grid', async () => {
  renderScreen(listResponse([tanaka]))
  const list = screen.getByRole('region', { name: '検索結果' })
  const pane = list.closest('aside') as HTMLElement
  expect(pane.className).toContain('bg-panel')
  expect(pane.className).toContain('border-line')
  expect(pane.className).toContain('border-r')
  expect(pane.className).toContain('overflow-auto')
  const workspace = pane.parentElement as HTMLElement
  // 390px は 4 の倍数でない実測値なので、design/layouts の `Workspace` は
  // 純粋な配置としてインライン style で持つ（`docs/frontend/REBUILD.md`）。
  expect(workspace.style.gridTemplateColumns).toBe('390px 1fr')
  expect(workspace.className).toContain('grid')
  // バーの下いっぱいに伸ばすのは面の側の責務（`Workspace` は flex-1 で伸びる）。
  expect((workspace.parentElement as HTMLElement).className).toContain('h-full')
  const detail = workspace.lastElementChild as HTMLElement
  expect(detail.className).toContain('overflow-auto')
})

// `.search{min-height:48px;border:2px solid var(--g);background:#fff;border-radius:8px}`
test('renders the search field as the approved 2px pine box', () => {
  renderScreen(listResponse([tanaka]))
  const field = screen.getByLabelText('氏名・電話番号・予約番号')
  expect(field.className).toContain('min-h-12')
  expect(field.className).toContain('border-2')
  expect(field.className).toContain('border-pine')
  expect(field.className).toContain('bg-surface')
  expect(field.className).toContain('rounded-ctl')
})

// `.filter{min-height:44px;border:1px solid var(--l);background:#fff;border-radius:8px}`
test('renders the filters as the approved chip line', () => {
  renderScreen(listResponse([tanaka]))
  for (const label of ['予約元', '状態', '開始日', '終了日']) {
    const control = screen.getByLabelText(label)
    expect(control.className).toContain('min-h-11')
    expect(control.className).toContain('border-line')
    expect(control.className).toContain('bg-surface')
    expect(control.className).toContain('rounded-ctl')
  }
})

// `.row` は白 1px `line` の rounded-card、`.row.selected` は pine-soft 上の 3px pine。
test('renders result rows and the selected row exactly as the mock does', async () => {
  renderScreen(listResponse([tanaka, tanakaIchiro]))
  searchFor('田中')
  const trigger = await screen.findByRole('button', { name: /田中 花子/ })
  // 行そのものは `article`（1 件のまとまり）で、押せるのはその内側。
  const row = trigger.closest('article') as HTMLElement
  expect(row.className).toContain('rounded-card')
  expect(row.className).toContain('border-line')
  expect(row.className).toContain('bg-surface')
  expect(row.className).not.toContain('bg-pine-soft')

  fireEvent.click(trigger)
  await screen.findByRole('region', { name: '予約詳細' })
  const selected = screen
    .getByRole('button', { name: /田中 花子/ })
    .closest('article') as HTMLElement
  expect(selected.className).toContain('border-3')
  expect(selected.className).toContain('border-pine')
  expect(selected.className).toContain('bg-pine-soft')
  // 色だけで伝えない: 選択中であることは語でも、読み上げの状態でも出す。
  expect(within(selected).getByText('選択中')).toBeInTheDocument()
  expect(selected).toHaveAttribute('aria-current', 'true')
  expect(
    (screen.getByRole('button', { name: /田中 一郎/ }).closest('article') as HTMLElement).className,
  ).toContain('border-line')
})

// 承認済みモックの詳細ペイン: `8月27日（木）11:00` + `.card` 3 枚 + `.danger`。
test('renders the detail pane as the approved heading, card grid and danger action', async () => {
  renderScreen(listResponse([tanaka]))
  searchFor('田中')
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const detail = await screen.findByRole('region', { name: '予約詳細' })
  expect(within(detail).getByRole('heading', { name: '8月27日（木）11:00' })).toBeInTheDocument()
  expect(within(detail).getByText('予約内容')).toBeInTheDocument()
  expect(within(detail).getByText('お客様')).toBeInTheDocument()
  expect(within(detail).getByText('状態')).toBeInTheDocument()

  const cancel = screen.getByRole('button', { name: '予約を取り消す' })
  expect(cancel.className).toContain('text-danger')
  expect(cancel.className).toContain('border-danger')
  expect(cancel.className).toContain('bg-surface')
})

// exception-states-approved.html `#empty`: 空表示は回復操作を必ず連れてくる。
test('offers the approved recovery action when nothing matches', async () => {
  // 空は面ごと EX-EMPTY の全画面状態になる。1 回目の検索は 0 件、解除したあとは
  // 見つかる、という筋にして「解除で条件が本当に消えた」ことを両方から確かめる。
  let searches = 0
  const { calls } = renderScreen((route) => {
    if (route.url.includes('/reservations?')) {
      searches += 1
      return jsonResponse(searches === 1 ? [] : [tanaka])
    }
    if (route.url.endsWith('/history')) return jsonResponse([])
    return jsonResponse({ error: 'unexpected' }, 500)
  })
  fireEvent.change(screen.getByLabelText('予約元'), { target: { value: 'web' } })
  searchFor('田中')

  expect(await screen.findByText('条件に一致する予約はありません')).toBeInTheDocument()
  expect(
    screen.getByText('検索語またはフィルターを変更してください。履歴自体は削除されていません。'),
  ).toBeInTheDocument()
  // 空は「何も見えない workspace」ではなく、全画面の状態そのものに入れ替わる。
  expect(screen.queryByRole('region', { name: '検索結果' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'フィルターをすべて解除' }))
  await waitFor(() => {
    expect(calls.at(-1)?.url).not.toContain('source=web')
  })
  expect(await screen.findByLabelText('氏名・電話番号・予約番号')).toHaveValue('')
  expect(screen.getByLabelText('予約元')).toHaveValue('')
})

// exception-states-approved.html `#permission-denied`: 403 も回復操作つき。
test('shows the approved permission-denied state with a way back', async () => {
  const { navigate } = renderScreen(() => jsonResponse({ error: 'forbidden' }, 403))
  searchFor('田中')
  expect(await screen.findByText('この設定を表示する権限がありません')).toBeInTheDocument()
  expect(
    screen.getByText(
      '権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。',
    ),
  ).toBeInTheDocument()
  // モック `#permission-denied` の 54px の記号。名前も件数も出さない面なので、
  // これが「何かがある」ことを言う唯一の印になっている。
  expect(screen.getByText('—')).toBeInTheDocument()
  // 一覧は残さない。権限が無い面は業務のクロムごと入れ替わる。
  expect(screen.queryByRole('region', { name: '検索結果' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '業務開始画面へ戻る' }))
  expect(navigate).toHaveBeenCalledWith({ screen: 'home' })
})
