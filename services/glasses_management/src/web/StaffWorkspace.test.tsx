import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { StaffWorkspace } from './StaffWorkspace'

test('loads accessible stores after restoring the same-origin staff session and wires the switch audit call', async () => {
  const api = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/staff/stores'))
      return new Response(
        JSON.stringify([
          {
            id: '11111111-1111-4111-8111-111111111111',
            organizationId: 'org',
            name: '銀座店',
            slug: 'ginza',
            isActive: true,
            createdAt: '2026-08-31T00:00:00.000Z',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            organizationId: 'org',
            name: '丸の内店',
            slug: 'marunouchi',
            isActive: true,
            createdAt: '2026-08-31T00:00:00.000Z',
          },
        ]),
        { status: 200 },
      )
    if (url.endsWith('/store-switches')) return new Response('{}', { status: 201 })
    return new Response('[]', { status: 200 })
  })

  render(<StaffWorkspace restore={async () => true} api={api} />)

  await waitFor(() => expect(screen.getByRole('button', { name: /銀座店/ })).toBeInTheDocument())
  await screen.findByRole('button', { name: /新しい予約を取る/ })
})

test('lets a new browser sign in through the EYEX same-origin auth proxy before loading stores', async () => {
  const signIn = vi.fn().mockResolvedValue(true)
  const api = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify([
        {
          id: '11111111-1111-4111-8111-111111111111',
          organizationId: 'org',
          name: '銀座店',
          slug: 'ginza',
          isActive: true,
          createdAt: '2026-08-31T00:00:00.000Z',
        },
      ]),
      { status: 200 },
    ),
  )
  render(<StaffWorkspace restore={async () => false} signIn={signIn} api={api} />)

  fireEvent.change(await screen.findByLabelText('メールアドレス'), {
    target: { value: 'staff@example.test' },
  })
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'safe-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'ログインする' }))

  await waitFor(() => expect(signIn).toHaveBeenCalledWith('staff@example.test', 'safe-password'))
  await screen.findByRole('button', { name: /新しい予約を取る/ })
})

function storeListResponse() {
  return new Response(
    JSON.stringify([
      {
        id: '11111111-1111-4111-8111-111111111111',
        organizationId: 'org',
        name: '銀座店',
        slug: 'ginza',
        isActive: true,
        createdAt: '2026-08-31T00:00:00.000Z',
      },
    ]),
    { status: 200 },
  )
}

test('opens the workspace on the home screen with the selected store and its reception state', async () => {
  const api = vi.fn().mockResolvedValue(storeListResponse())

  render(<StaffWorkspace restore={async () => true} api={api} today="2026-08-31" />)

  expect(await screen.findByRole('button', { name: /新しい予約を取る/ })).toBeInTheDocument()
  // 店舗名と営業状態は本文ではなくヘッダーのワードマークが持つ (承認済みモック)。
  expect(screen.getByRole('button', { name: /EYEX予約/ })).toHaveTextContent('銀座店 · 営業中')
})

test('moves from home to the booking flow and back to home through navigation only', async () => {
  // The workspace keeps its location in memory rather than in the URL, so a
  // shared iPad leaves no customer id or ledger day in browser history.
  const api = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/api/staff/stores')) return storeListResponse()
    return new Response('{}', { status: 200 })
  })

  render(<StaffWorkspace restore={async () => true} api={api} today="2026-08-31" />)

  fireEvent.click(await screen.findByRole('button', { name: /新しい予約を取る/ }))

  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /新しい予約を取る/ })).not.toBeInTheDocument(),
  )
  expect(window.location.search).toBe('')
})

test('opens the selected day ledger from the home date strip', async () => {
  const api = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/api/staff/stores')) return storeListResponse()
    if (String(input).includes('/ledger')) return new Response('[]', { status: 200 })
    return new Response('{}', { status: 200 })
  })

  render(<StaffWorkspace restore={async () => true} api={api} today="2026-08-31" />)

  fireEvent.click(await screen.findByRole('button', { name: /2026-08-31|8月31日|31/ }))

  await waitFor(() =>
    expect(api.mock.calls.some(([input]) => String(input).includes('/ledger?date='))).toBe(true),
  )
})

test('asks the server what the operator may do in the selected store before showing a customer record', async () => {
  // The client must never infer permissions from a role: doing so either leaks
  // restricted customer information or hides it from staff entitled to it
  // (UC-EYEX-026, UC-EYEX-029, AC-EYEX-91).
  const api = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/staff/stores')) return storeListResponse()
    if (url.endsWith('/permissions'))
      return new Response(JSON.stringify(['store.read', 'customer.read']), { status: 200 })
    return new Response('[]', { status: 200 })
  })

  render(<StaffWorkspace restore={async () => true} api={api} today="2026-08-31" />)

  await screen.findByRole('button', { name: /新しい予約を取る/ })
  await waitFor(() =>
    expect(
      api.mock.calls.some(([input]) =>
        String(input).endsWith(
          '/api/staff/stores/11111111-1111-4111-8111-111111111111/permissions',
        ),
      ),
    ).toBe(true),
  )
})

test('interrupts a store switch while the booking flow still holds unsaved input', async () => {
  // Without this wiring the discard confirmation in App is unreachable: the
  // controller never learns that anything would be lost (UC-EYEX-065, AC-EYEX-29).
  const api = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/staff/stores'))
      return new Response(
        JSON.stringify([
          {
            id: '11111111-1111-4111-8111-111111111111',
            organizationId: 'org',
            name: '銀座店',
            slug: 'ginza',
            isActive: true,
            createdAt: '2026-08-31T00:00:00.000Z',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            organizationId: 'org',
            name: '丸の内店',
            slug: 'marunouchi',
            isActive: true,
            createdAt: '2026-08-31T00:00:00.000Z',
          },
        ]),
        { status: 200 },
      )
    if (url.includes('/availability/settings'))
      return new Response(
        JSON.stringify({
          storeId: '11111111-1111-4111-8111-111111111111',
          version: 1,
          receptionStatus: 'open',
          businessHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
            dayOfWeek,
            periods: [{ startTime: '10:00', endTime: '19:00' }],
          })),
          exceptions: [],
          purposes: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              staffName: '視力測定',
              customerLabel: 'メガネを新しく作りたい',
              durationMinutes: 60,
              slotIntervalMinutes: 30,
              maxConcurrent: 1,
              requiredSkills: [],
              requiredEquipment: [],
              isPublic: true,
            },
          ],
          staff: [],
          shifts: [],
          equipment: [],
          maintenance: [],
        }),
        { status: 200 },
      )
    return new Response('[]', { status: 200 })
  })

  render(<StaffWorkspace restore={async () => true} api={api} today="2026-08-27" />)

  fireEvent.click(await screen.findByRole('button', { name: /新しい予約を取る/ }))
  fireEvent.click(await screen.findByRole('button', { name: '8月27日（木）' }))

  fireEvent.click(screen.getByRole('button', { name: /銀座店/ }))
  fireEvent.click(screen.getByRole('button', { name: /^丸の内店/ }))

  // 文言は承認済みモック `#unsaved-store-switch` のもの。
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveTextContent('店舗を切り替える前に確認してください')
  expect(dialog).toHaveTextContent('入力内容と録音は丸の内店へ持ち越しません。')
})

const RECORDING_ROW = {
  id: '99999999-9999-4999-8999-999999999999',
  organizationId: 'org',
  storeId: '11111111-1111-4111-8111-111111111111',
  receptionSessionId: '88888888-8888-4888-8888-888888888888',
  reservationId: '77777777-7777-4777-8777-777777777777',
  recorderType: 'personal' as const,
  recorderId: '鈴木',
  startedAt: '2026-08-31T01:00:00.000Z',
  endedAt: '2026-08-31T01:03:12.000Z',
  durationSeconds: 192,
  endReason: 'completed' as const,
  state: 'stored' as const,
  retentionUntil: null,
  holdReason: null,
  heldBy: null,
  heldAt: null,
  deletedAt: null,
  failureReason: null,
  version: 1,
}

/*
 * UC-EYEX-032 / AC-EYEX-60: without this fetch the recording panel in the
 * reception history is unreachable — nothing ever hands it a recording.
 */
test('reads the store recordings so a reception event can show its own recording', async () => {
  const api = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/staff/stores')) return storeListResponse()
    if (url.endsWith('/permissions'))
      return new Response(JSON.stringify(['store.read', 'recording.read']), { status: 200 })
    if (url.includes('/recordings'))
      return new Response(JSON.stringify([RECORDING_ROW]), { status: 200 })
    if (url.includes('/reception-history'))
      return new Response(
        JSON.stringify([
          {
            id: '66666666-6666-4666-8666-666666666666',
            occurredAt: '2026-08-31T01:05:00.000Z',
            source: 'staff',
            action: 'created',
            entityType: 'reservation',
            entityId: '77777777-7777-4777-8777-777777777777',
            reservationId: '77777777-7777-4777-8777-777777777777',
            customerName: '田中 花子',
            customerPhone: '090-1234-5678',
            reservationNumber: 'EY-0831-1000',
            actorId: '鈴木',
            requiresAttention: false,
            recordingStatus: 'none',
          },
        ]),
        { status: 200 },
      )
    return new Response('[]', { status: 200 })
  })

  render(<StaffWorkspace restore={async () => true} api={api} today="2026-08-31" />)

  await screen.findByRole('button', { name: /新しい予約を取る/ })
  await waitFor(() =>
    expect(
      api.mock.calls.some(([input]) =>
        String(input).endsWith('/api/staff/stores/11111111-1111-4111-8111-111111111111/recordings'),
      ),
    ).toBe(true),
  )

  fireEvent.click(screen.getByRole('button', { name: '受付履歴' }))
  fireEvent.click(await screen.findByRole('button', { name: /田中 花子/ }))
  const region = await screen.findByRole('region', { name: 'iPad録音' })
  expect(region).toHaveTextContent('鈴木')
  expect(region).toHaveTextContent('03:12')
})

/*
 * AC-EYEX-101: on a fully shared iPad, a hold must be preceded by a personal
 * re-authentication. With terminalId hardcoded to null that branch was dead.
 */
test('threads the shared-terminal id into the recording operations screen', async () => {
  const api = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/staff/stores')) return storeListResponse()
    if (url.endsWith('/permissions'))
      return new Response(JSON.stringify(['store.read', 'recording.read', 'recording.manage']), {
        status: 200,
      })
    if (url.includes('/recordings/retention'))
      return new Response(
        JSON.stringify({ storeId: 'x', confirmedRetentionDays: 30, discardedRetentionHours: 24 }),
        { status: 200 },
      )
    if (url.includes('/recordings'))
      return new Response(JSON.stringify([RECORDING_ROW]), { status: 200 })
    return new Response('[]', { status: 200 })
  })

  render(
    <StaffWorkspace
      restore={async () => true}
      api={api}
      today="2026-08-31"
      terminalId="55555555-5555-4555-8555-555555555555"
    />,
  )

  await screen.findByRole('button', { name: /新しい予約を取る/ })
  /*
   * 緑帯は 1 本しかないので、運用の面へはバーのタブと各面の左サイドを辿って
   * 行く（operations-approved.html）。録音運用は 端末とセキュリティ の節ナビの
   * 先にある。ここが切れると実アプリから到達できなくなる。
   */
  fireEvent.click(screen.getByRole('button', { name: '設定' }))
  fireEvent.click(await screen.findByRole('button', { name: '設定一覧' }))
  fireEvent.click(await screen.findByRole('button', { name: '録音運用' }))
  fireEvent.click(await screen.findByRole('button', { name: '保全する' }))
  expect(await screen.findByRole('dialog')).toHaveTextContent('個人')
})

test('starts a fully shared terminal session from its one-time entry token', async () => {
  // Without this, the locked / revoked screens in App are unreachable: nothing
  // ever constructs the shared-terminal controller (UC-EYEX-133, 135, 157).
  const api = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
  const terminalFetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: '33333333-3333-4333-8333-333333333333',
        organizationId: 'org',
        storeId: '11111111-1111-4111-8111-111111111111',
        name: '受付iPad',
        status: 'active',
        idleTimeoutSeconds: 120,
        expiresAt: '2099-01-01T00:00:00.000Z',
        lastSeenAt: null,
        createdAt: '2026-08-31T00:00:00.000Z',
        revokedAt: null,
      }),
      { status: 200 },
    ),
  )

  render(
    <StaffWorkspace
      restore={async () => false}
      api={api}
      today="2026-08-31"
      terminalId="33333333-3333-4333-8333-333333333333"
      terminalToken="terminal-token"
      terminalFetch={terminalFetch}
    />,
  )

  await waitFor(() => expect(terminalFetch).toHaveBeenCalled())
  expect(String(terminalFetch.mock.calls[0]?.[0])).toContain('/session')
})

test('shows the shared terminal as revoked when its session is refused', async () => {
  const api = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
  const terminalFetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ error: 'terminal_revoked' }), { status: 401 }))

  render(
    <StaffWorkspace
      restore={async () => false}
      api={api}
      today="2026-08-31"
      terminalId="33333333-3333-4333-8333-333333333333"
      terminalToken="stale-token"
      terminalFetch={terminalFetch}
    />,
  )

  expect(
    await screen.findByRole('heading', { name: 'この端末の利用は停止されています' }),
  ).toBeInTheDocument()
})

test('hides customer information on a shared iPad the moment the page leaves the foreground', async () => {
  // The lock has to be armed while the staff surface is on screen, not only
  // after something already went wrong (UC-EYEX-135, 157; AC-EYEX-97).
  const api = vi.fn().mockResolvedValue(storeListResponse())
  const terminalFetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: '33333333-3333-4333-8333-333333333333',
        organizationId: 'org',
        storeId: '11111111-1111-4111-8111-111111111111',
        name: '受付iPad',
        status: 'active',
        idleTimeoutSeconds: 120,
        expiresAt: '2099-01-01T00:00:00.000Z',
        lastSeenAt: null,
        createdAt: '2026-08-31T00:00:00.000Z',
        revokedAt: null,
      }),
      { status: 200 },
    ),
  )

  render(
    <StaffWorkspace
      restore={async () => true}
      api={api}
      today="2026-08-31"
      terminalId="33333333-3333-4333-8333-333333333333"
      terminalToken="terminal-token"
      terminalFetch={terminalFetch}
    />,
  )
  await screen.findByRole('button', { name: /新しい予約を取る/ })
  await waitFor(() => expect(terminalFetch).toHaveBeenCalled())
  // Let the session response settle: a lock only applies to a started session.
  await act(async () => {})

  act(() => window.dispatchEvent(new Event('pagehide')))

  expect(await screen.findByRole('heading', { name: '顧客情報を隠しました' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /新しい予約を取る/ })).not.toBeInTheDocument()
})

test('shows real unread and open counts in the header instead of a permanent 未取得', async () => {
  // 「未取得」が出たままなら、お知らせとアラートは事実上存在しないのと同じで、
  // UC-EYEX-007 の「未読と要対応を区別して確認できる」が満たせない。
  const alerts = [
    { kind: 'notice', readAt: null, resolvedAt: null },
    { kind: 'notice', readAt: '2026-08-31T00:00:00.000Z', resolvedAt: null },
    { kind: 'alert', readAt: null, resolvedAt: null },
    { kind: 'alert', readAt: null, resolvedAt: '2026-08-31T00:00:00.000Z' },
  ].map((partial, index) => ({
    id: `0000000${index}-0000-4000-8000-00000000000${index}`,
    storeId: '11111111-1111-4111-8111-111111111111',
    code: 'long_wait',
    title: '長時間お待ちのお客様',
    reason: '受付から30分経過しています。',
    subject: 'ウォークイン 3',
    subjectType: 'walkin',
    subjectId: 'walkin-3',
    nextAction: '担当者を割り当ててご案内してください。',
    occurredAt: '2026-08-31T00:00:00.000Z',
    readBy: null,
    resolvedBy: null,
    resolutionNote: null,
    ...partial,
  }))
  const api = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/staff/stores')) return storeListResponse()
    if (url.endsWith('/permissions')) return new Response('["store.read"]', { status: 200 })
    if (url.includes('/alerts')) return new Response(JSON.stringify(alerts), { status: 200 })
    return new Response('[]', { status: 200 })
  })

  render(<StaffWorkspace restore={async () => true} api={api} today="2026-08-31" />)

  // 未読のお知らせは 1 件、未対応のアラートは 1 件。既読と対応済みは別に数える。
  expect(await screen.findByRole('button', { name: 'お知らせ 1件' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'アラート 1件' })).toBeInTheDocument()
})
