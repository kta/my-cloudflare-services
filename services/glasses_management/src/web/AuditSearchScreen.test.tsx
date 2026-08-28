import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AuditSearchScreen } from './AuditSearchScreen'
import { screenSections } from './app-chrome'

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
  return render(
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

/**
 * 検索の姿を開く。既定は詳細ビューなので、絞り込みと一覧を読むテストは
 * まずここを通る（モックの面がどちらを既定にしているかを毎回明示する）。
 */
async function openSearch() {
  await screen.findByRole('heading', { name: '監査イベント詳細' })
  fireEvent.click(screen.getByRole('button', { name: '監査を検索' }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('期間・操作・主体種別・対象で監査を絞り込む (UC-EYEX-155, AC-EYEX-102)', async () => {
  const { api, calls } = createApi(() => jsonResponse([publishedEvent, readEvent]))
  renderScreen(api)

  await openSearch()
  await screen.findByRole('table', { name: '監査イベント' })
  const first = queryOf(calls[0]?.url ?? '')
  expect(calls[0]?.url.startsWith(`/api/staff/stores/${STORE_ID}/audit-events?`)).toBe(true)
  expect(first.get('limit')).toBe('50')

  fireEvent.change(screen.getByLabelText('開始日時'), { target: { value: '2026-08-26T00:00' } })
  fireEvent.change(screen.getByLabelText('終了日時'), { target: { value: '2026-08-27T00:00' } })
  fireEvent.change(screen.getByLabelText('操作'), { target: { value: 'attention_note.published' } })
  fireEvent.click(
    within(screen.getByRole('group', { name: '主体種別' })).getByRole('button', {
      name: '共有端末',
    }),
  )
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

  await openSearch()
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
  // 主体の種別と対象の種別は面の言葉で出す（記録の機械可読な名を素で出さない）。
  expect(detail).toHaveTextContent('actor_type: 共有端末')
  expect(detail).toHaveTextContent('actor: 銀座店 レジ横iPad')
  expect(detail).toHaveTextContent('device: 銀座店 レジ横iPad')
  expect(detail).toHaveTextContent('target: 注意事項 EY-A-220')
  expect(detail).toHaveTextContent('correlation_id: corr-6f82')
  expect(detail).toHaveTextContent('occurred_at: 2026年8月26日 17:42')

  /*
   * 承認済みモック `AUDIT-DETAIL` の変更前後は「確認待ち」「公開済み」と日本語で
   * 書かれている。生値のまま出すと、監査を読む人が画面の言葉と突き合わせられない。
   * 日本語の言い方が決まっていない鍵（version）は鍵と値をそのまま並べる。
   */
  const before = within(detail).getByRole('region', { name: '変更前' })
  expect(before).toHaveTextContent('確認待ち')
  expect(before).not.toHaveTextContent('pending_review')
  expect(before).toHaveTextContent('version 2')
  const after = within(detail).getByRole('region', { name: '変更後' })
  expect(after).toHaveTextContent('公開済み')
  expect(after).not.toHaveTextContent('published')
  expect(after).toHaveTextContent('version 3')
})

/** 承認済みモックの副タブと監査の節 */
test('監査の節をモックどおりに出す', async () => {
  const { api } = createApi(() => jsonResponse([publishedEvent]))
  renderScreen(api)

  /* 節は面が描かず、全画面共通の柱へ渡す。面の側では渡した中身で確かめる。 */
  await screen.findByRole('heading', { name: '監査イベント詳細' })
  expect(screenSections.snapshot().map((section) => section.label)).toEqual([
    '本日の管理操作',
    '録音再生',
    '店舗切替',
    '注意事項',
  ])
  expect(screen.queryByRole('navigation')).toBeNull()
})

test('変更前後の無いイベントはその旨を示す (AC-EYEX-102)', async () => {
  const { api } = createApi(() => jsonResponse([readEvent]))
  renderScreen(api)

  await openSearch()
  const table = await screen.findByRole('table', { name: '監査イベント' })
  fireEvent.click(within(table).getByRole('button', { name: '詳細' }))
  const detail = await screen.findByRole('region', { name: '監査イベント詳細' })
  expect(detail).toHaveTextContent('correlation_id: なし')
  expect(within(detail).getByText('変更前後の記録はありません。')).toBeInTheDocument()
})

test('該当が無ければ理由と回復操作を出す (UC-EYEX-155)', async () => {
  const { api, calls } = createApi(() => jsonResponse([]))
  renderScreen(api)

  await openSearch()
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

  await openSearch()
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
  expect(detail).toHaveTextContent('target: 注意事項 EY-A-220')
})

/* --- 承認済みモック `operations-approved.html#audit` の骨格 ---------------- */

/**
 * モックのこの面は詳細ビューである。絞り込みの板を既定で開くと、監査を
 * 「まず条件を組み立てる面」に変えてしまう。監査で最初に読みたいのは
 * 直近の 1 件そのものなので、詳細を既定にし、検索はそこから開く。
 */
test('既定は詳細ビューで、絞り込みの板は開いていない', async () => {
  const { api } = createApi(() => jsonResponse([publishedEvent, readEvent]))
  renderScreen(api)

  const detail = await screen.findByRole('region', { name: '監査イベント詳細' })
  expect(detail).toHaveTextContent('event: attention_note.published')
  expect(screen.queryByRole('region', { name: '監査の絞り込み' })).toBeNull()
  expect(screen.queryByRole('table', { name: '監査イベント' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '監査を検索' }))
  expect(screen.getByRole('region', { name: '監査の絞り込み' })).toBeInTheDocument()
  expect(await screen.findByRole('table', { name: '監査イベント' })).toBeInTheDocument()
})

/** 主体種別はブラウザ既定の `<select>` を使わない（既定の青も英語表記も出さない）。 */
test('主体種別は押しボタンで選ぶ', async () => {
  const { api, calls } = createApi(() => jsonResponse([publishedEvent]))
  const { container } = renderScreen(api)

  await screen.findByRole('region', { name: '監査イベント詳細' })
  fireEvent.click(screen.getByRole('button', { name: '監査を検索' }))
  expect(container.querySelector('select')).toBeNull()

  const group = screen.getByRole('group', { name: '主体種別' })
  expect(within(group).getByRole('button', { name: 'すべて' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  fireEvent.click(within(group).getByRole('button', { name: '共有端末' }))
  fireEvent.click(screen.getByRole('button', { name: '監査を検索する' }))
  await waitFor(() => {
    expect(calls.length).toBeGreaterThan(1)
  })
  expect(queryOf(calls[calls.length - 1]?.url ?? '').get('actorType')).toBe('shared_terminal')
})

/** モックの節ナビは 4 つ。兄弟の面への行き先はその後ろに続ける。 */
