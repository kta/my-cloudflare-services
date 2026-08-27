import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AuditSearchScreen } from './AuditSearchScreen'

const STORE_ID = '00000000-0000-4000-8000-000000000010'
const TODAY = '2026-08-27'
const NOW = '2026-08-27T05:30:00.000Z'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

const publishedEvent = {
  id: '00000000-0000-4000-8000-000000000301',
  occurredAt: '2026-08-26T08:42:13.000Z',
  storeId: STORE_ID,
  actorType: 'shared_terminal',
  actorId: '銀座店 レジ横iPad',
  action: 'attention_note.published',
  entityType: 'attention_note',
  entityId: 'EY-A-220',
  correlationId: 'corr-6f82',
  before: { status: 'pending_review', version: 2 },
  after: { status: 'published', version: 3 },
}

const readEvent = {
  id: '00000000-0000-4000-8000-000000000302',
  occurredAt: '2026-08-26T00:05:00.000Z',
  storeId: STORE_ID,
  actorType: 'user',
  actorId: '佐藤 美咲',
  action: 'attention_note.read',
  entityType: 'customer',
  entityId: 'EY-C-901',
  correlationId: null,
  before: null,
  after: null,
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
  permissions: readonly string[] = ['audit.read'],
) {
  render(
    <AuditSearchScreen
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

function queryOf(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?') + 1))
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('期間・操作・主体種別・対象で監査を絞り込む (UC-EYEX-155, AC-EYEX-102)', async () => {
  const { api, calls } = createApi(() => jsonResponse([publishedEvent, readEvent]))
  renderScreen(api)

  await screen.findByRole('table', { name: '監査イベント' })
  const first = queryOf(calls[0]?.url ?? '')
  expect(calls[0]?.url.startsWith(`/api/staff/stores/${STORE_ID}/audit-events?`)).toBe(true)
  expect(first.get('limit')).toBe('50')

  fireEvent.change(screen.getByLabelText('開始日時'), { target: { value: '2026-08-26T00:00' } })
  fireEvent.change(screen.getByLabelText('終了日時'), { target: { value: '2026-08-27T00:00' } })
  fireEvent.change(screen.getByLabelText('操作'), { target: { value: 'attention_note.published' } })
  fireEvent.change(screen.getByLabelText('主体種別'), { target: { value: 'shared_terminal' } })
  fireEvent.change(screen.getByLabelText('対象種別'), { target: { value: 'attention_note' } })
  fireEvent.change(screen.getByLabelText('対象ID'), { target: { value: 'EY-A-220' } })
  fireEvent.click(screen.getByRole('button', { name: '監査を検索する' }))

  await waitFor(() => {
    expect(calls).toHaveLength(2)
  })
  const query = queryOf(calls[1]?.url ?? '')
  expect(Object.fromEntries(query.entries())).toEqual({
    from: '2026-08-25T15:00:00.000Z',
    to: '2026-08-26T15:00:00.000Z',
    action: 'attention_note.published',
    actorType: 'shared_terminal',
    entityType: 'attention_note',
    entityId: 'EY-A-220',
    limit: '50',
  })
})

test('変更前後と相関IDを詳細で読める (UC-EYEX-155, AC-EYEX-102)', async () => {
  const { api } = createApi(() => jsonResponse([publishedEvent]))
  renderScreen(api)

  const table = await screen.findByRole('table', { name: '監査イベント' })
  const row = within(table).getAllByRole('row')[1] as HTMLElement
  expect(row).toHaveTextContent('2026年8月26日 17:42')
  expect(row).toHaveTextContent('attention_note.published')
  expect(row).toHaveTextContent('共有端末')
  fireEvent.click(within(row).getByRole('button', { name: '詳細' }))

  // 承認済みモック `AUDIT-DETAIL--default--ipad-landscape.png` — 等幅の
  // イベント本文と、変更前 / 変更後 の 2 枚。
  const detail = await screen.findByRole('region', { name: '監査イベント詳細' })
  expect(detail).toHaveTextContent('event: attention_note.published')
  expect(detail).toHaveTextContent('actor_type: shared_terminal')
  expect(detail).toHaveTextContent('actor: 銀座店 レジ横iPad')
  expect(detail).toHaveTextContent('target: attention_note EY-A-220')
  expect(detail).toHaveTextContent('correlation_id: corr-6f82')
  expect(detail).toHaveTextContent('occurred_at: 2026年8月26日 17:42')

  const before = within(detail).getByRole('region', { name: '変更前' })
  expect(before).toHaveTextContent('status pending_review')
  expect(before).toHaveTextContent('version 2')
  const after = within(detail).getByRole('region', { name: '変更後' })
  expect(after).toHaveTextContent('status published')
  expect(after).toHaveTextContent('version 3')
})

/** 承認済みモックの副タブと監査の節 */
test('監査の節をモックどおりに出す', async () => {
  const { api } = createApi(() => jsonResponse([publishedEvent]))
  renderScreen(api)

  const sections = await screen.findByRole('navigation', { name: '監査の節' })
  // 管理タブは 76px の緑バーが持つ。面が 2 本目の緑帯を持つのはモックに無い。
  expect(screen.queryByRole('navigation', { name: '設定タブ' })).toBeNull()

  for (const label of ['本日の管理操作', '録音再生', '店舗切替', '注意事項'])
    expect(within(sections).getByRole('button', { name: label })).toBeInTheDocument()
})

test('変更前後の無いイベントはその旨を示す (AC-EYEX-102)', async () => {
  const { api } = createApi(() => jsonResponse([readEvent]))
  renderScreen(api)

  const table = await screen.findByRole('table', { name: '監査イベント' })
  fireEvent.click(within(table).getByRole('button', { name: '詳細' }))
  const detail = await screen.findByRole('region', { name: '監査イベント詳細' })
  expect(detail).toHaveTextContent('correlation_id: なし')
  expect(within(detail).getByText('変更前後の記録はありません。')).toBeInTheDocument()
})

test('該当が無ければ理由と回復操作を出す (UC-EYEX-155)', async () => {
  const { api, calls } = createApi(() => jsonResponse([]))
  renderScreen(api)

  const empty = await screen.findByRole('region', { name: '該当なし' })
  expect(empty).toHaveTextContent('条件に一致する監査イベントはありません')
  expect(empty).toHaveTextContent(
    '検索語またはフィルターを変更してください。履歴自体は削除されていません。',
  )
  fireEvent.change(screen.getByLabelText('対象ID'), { target: { value: 'EY-A-220' } })
  fireEvent.click(within(empty).getByRole('button', { name: 'フィルターをすべて解除' }))
  await waitFor(() => {
    expect(calls.length).toBeGreaterThan(1)
  })
  expect(screen.getByLabelText('対象ID')).toHaveValue('')
})

test('権限外は取得も表示もしない (AC-EYEX-102)', () => {
  const { api } = createApi(() => jsonResponse([publishedEvent]))
  renderScreen(api, ['store.read'])

  expect(api).not.toHaveBeenCalled()
  expect(screen.getByText('この設定を表示する権限がありません')).toBeInTheDocument()
  expect(
    screen.getByText(
      '権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。',
    ),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '業務開始画面へ戻る' })).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

test('サーバが拒否したら権限内に限られることを伝える (AC-EYEX-102)', async () => {
  const { api } = createApi(() => jsonResponse({ error: 'forbidden' }, 403))
  renderScreen(api)

  expect(
    await screen.findByText('権限のある範囲の監査イベントだけを表示できます。'),
  ).toBeInTheDocument()
})

test('端末に監査内容を残さない (完全共有iPad)', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  const { api } = createApi(() => jsonResponse([publishedEvent]))
  renderScreen(api)

  await screen.findByRole('table', { name: '監査イベント' })
  fireEvent.change(screen.getByLabelText('対象ID'), { target: { value: 'EY-A-220' } })
  expect(setItem).not.toHaveBeenCalled()
})

/**
 * `AUDIT-DETAIL`。モックのファーストビューは詳細ビューなので、一覧に
 * 結果があるかぎり先頭の 1 件を選んだ状態で開く。
 */
test('検索結果があれば先頭のイベントの詳細を既定で開く', async () => {
  const { api } = createApi(() => jsonResponse([publishedEvent, readEvent]))
  renderScreen(api)

  const detail = await screen.findByRole('region', { name: '監査イベント詳細' })
  expect(detail).toHaveTextContent('event: attention_note.published')
  expect(detail).toHaveTextContent('target: attention_note EY-A-220')
})
