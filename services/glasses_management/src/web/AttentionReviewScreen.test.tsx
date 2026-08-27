import { ATTENTION_INPUT_GUIDANCE } from '@app/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AttentionReviewScreen } from './AttentionReviewScreen'
import { screenSections } from './app-chrome'

const STORE_ID = '00000000-0000-4000-8000-000000000010'
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000020'
const NOTE_ID = '00000000-0000-4000-8000-000000000030'
const PUBLISHED_NOTE_ID = '00000000-0000-4000-8000-000000000031'
const TERMINAL_ID = '00000000-0000-4000-8000-000000000201'
const TODAY = '2026-08-27'
const NOW = '2026-08-27T05:30:00.000Z'
const GRANT = 'g'.repeat(48)

const REVIEWER = [
  'attention.read',
  'attention.write',
  'attention.publish',
  'attention.revise',
  'attention.hide',
] as const
const STAFF = ['attention.read', 'attention.write'] as const

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

const settings = {
  storeId: STORE_ID,
  reviewMode: 'review_required' as const,
  sharingScope: 'permitted_stores' as const,
  storeOverrideAllowed: true,
  origin: 'organization' as const,
  capabilities: [
    { capability: 'read', minimumRole: 'staff', origin: 'organization' },
    { capability: 'write', minimumRole: 'staff', origin: 'organization' },
    { capability: 'publish', minimumRole: 'store_manager', origin: 'organization' },
    { capability: 'revise', minimumRole: 'store_manager', origin: 'organization' },
    { capability: 'hide', minimumRole: 'store_manager', origin: 'organization' },
  ],
  guidance: ATTENTION_INPUT_GUIDANCE,
}

const pendingNote = {
  id: '00000000-0000-4000-8000-0000000000a1',
  noteId: NOTE_ID,
  customerId: CUSTOMER_ID,
  storeId: STORE_ID,
  status: 'pending_review' as const,
  version: 1,
  body: '度数変更の説明中に不安を訴えられた。',
  occurredAt: '2026-08-25T06:10:00.000Z',
  basis: '接客記録 EY-V-331',
  recommendedAction: '変更理由と見え方を一段階ずつ説明する。',
  sharingScope: 'permitted_stores' as const,
  recordedBy: '山田',
  recordedOn: '2026-08-25',
  publishedAt: null,
  hiddenAt: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewReason: null,
}

const publishedNote = {
  ...pendingNote,
  id: '00000000-0000-4000-8000-0000000000a2',
  noteId: PUBLISHED_NOTE_ID,
  status: 'published' as const,
  version: 2,
  body: '説明を段階化すると納得された。',
  publishedAt: '2026-08-26T08:00:00.000Z',
  reviewedBy: '佐藤',
  reviewedAt: '2026-08-26T08:00:00.000Z',
  reviewReason: '内容を確認した。',
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

/** The default backend: settings + one pending and one published note. */
function defaultHandler(route: Route): Response {
  if (route.url.endsWith('/attention-settings')) return jsonResponse(settings)
  if (route.url.includes('/versions'))
    return jsonResponse([publishedNote, { ...publishedNote, status: 'superseded', version: 1 }])
  if (route.url.endsWith('/attention-notes')) return jsonResponse([pendingNote, publishedNote])
  return jsonResponse(publishedNote)
}

function renderScreen(
  api: ReturnType<typeof createApi>['api'],
  options: {
    permissions?: readonly string[]
    sharedTerminal?: boolean
    terminalToken?: string
  } = {},
) {
  render(
    <AttentionReviewScreen
      storeId={STORE_ID}
      storeName="銀座店"
      api={api as never}
      navigate={vi.fn()}
      permissions={(options.permissions ?? REVIEWER) as never}
      customerId={CUSTOMER_ID}
      customerName="田中 花子"
      today={TODAY}
      now={NOW}
      sharedTerminal={
        options.sharedTerminal
          ? {
              terminalId: TERMINAL_ID,
              organizationId: 'org-eyex',
              token: options.terminalToken ?? 'device-token',
            }
          : undefined
      }
    />,
  )
}

function bodyOf(route: Route): unknown {
  return JSON.parse(String(route.init?.body))
}

function noteCard(name: string): HTMLElement {
  return screen.getByRole('article', { name })
}

afterEach(() => {
  vi.restoreAllMocks()
})

/** 承認済みモック `ATTENTION-REVIEW--pending--ipad-landscape.png` の骨格と文言 */
test('確認待ちの待ち行列・3カード・公開前チェックを出す', async () => {
  const { api } = createApi(defaultHandler)
  renderScreen(api)

  const card = await waitFor(() => noteCard('注意事項 確認待ち 版1'))
  // 管理タブは 76px の緑バーが持つ。面が 2 本目の緑帯を持つのはモックに無い。
  expect(screen.queryByRole('navigation', { name: '設定タブ' })).toBeNull()
  /* 確認待ちの並びは全画面共通の柱が持つ。面の側では渡した中身で確かめる。 */
  expect(screenSections.snapshot().length).toBeGreaterThan(0)
  expect(screen.getByRole('heading', { name: '注意事項を確認' })).toBeInTheDocument()

  expect(within(card).getByRole('region', { name: '発生した事実 版1' })).toHaveTextContent(
    '度数変更の説明中に不安を訴えられた。',
  )
  const basis = within(card).getByRole('region', { name: '発生日時・根拠 版1' })
  expect(basis).toHaveTextContent('2026年8月25日 15:10')
  expect(basis).toHaveTextContent('接客記録 EY-V-331')
  expect(within(card).getByRole('region', { name: '推奨対応 版1' })).toBeInTheDocument()
  expect(within(card).getByRole('region', { name: '公開前チェック' })).toHaveTextContent(
    '人格評価、憶測、差別につながる属性は含まれていません。',
  )
})

test('確認待ちを理由付きで公開できる (UC-EYEX-141, AC-EYEX-116)', async () => {
  const { api, calls } = createApi(defaultHandler)
  renderScreen(api)

  const card = await waitFor(() => noteCard('注意事項 確認待ち 版1'))
  expect(card).toHaveTextContent('度数変更の説明中に不安を訴えられた。')
  expect(card).toHaveTextContent('2026年8月25日 15:10')
  expect(card).toHaveTextContent('接客記録 EY-V-331')

  fireEvent.change(within(card).getByLabelText('確認の理由'), {
    target: { value: '事実と根拠を確認した。' },
  })
  fireEvent.click(within(card).getByRole('button', { name: '公開する' }))

  await waitFor(() => {
    expect(calls.some((route) => route.url.includes('/review'))).toBe(true)
  })
  const review = calls.find((route) => route.url.includes('/review')) as Route
  expect(review.url).toBe(`/api/staff/stores/${STORE_ID}/attention-notes/${NOTE_ID}/review`)
  expect(bodyOf(review)).toEqual({
    decision: 'publish',
    reason: '事実と根拠を確認した。',
    expectedVersion: 1,
  })
  await screen.findByText('公開しました。登録者と監査記録へ結果を残しました。')
})

test('差戻し・却下は理由が無いと送らない (AC-EYEX-116)', async () => {
  const { api, calls } = createApi(defaultHandler)
  renderScreen(api)

  const card = await waitFor(() => noteCard('注意事項 確認待ち 版1'))
  fireEvent.click(within(card).getByRole('button', { name: '差戻し' }))

  expect(await within(card).findByText('理由を入力してください。')).toBeInTheDocument()
  expect(calls.some((route) => route.url.includes('/review'))).toBe(false)

  fireEvent.change(within(card).getByLabelText('確認の理由'), {
    target: { value: '根拠が不足している。' },
  })
  fireEvent.click(within(card).getByRole('button', { name: '却下' }))

  await waitFor(() => {
    expect(calls.some((route) => route.url.includes('/review'))).toBe(true)
  })
  expect(bodyOf(calls.find((route) => route.url.includes('/review')) as Route)).toMatchObject({
    decision: 'reject',
    reason: '根拠が不足している。',
  })
})

test('公開権限が無いスタッフには確認待ちが存在しない (AC-EYEX-85)', async () => {
  const { api } = createApi((route) =>
    route.url.endsWith('/attention-notes') ? jsonResponse([publishedNote]) : defaultHandler(route),
  )
  renderScreen(api, { permissions: STAFF })

  await waitFor(() => noteCard('注意事項 公開済み 版2'))
  expect(screen.queryByText('確認待ち')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '公開する' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('確認の理由')).not.toBeInTheDocument()
})

test('登録は4項目を送り、契約の入力案内を出す (UC-EYEX-143, UC-EYEX-144)', async () => {
  const { api, calls } = createApi((route) =>
    route.init?.method === 'POST'
      ? jsonResponse({ ...pendingNote, id: '00000000-0000-4000-8000-0000000000a3' }, 201)
      : defaultHandler(route),
  )
  renderScreen(api)

  await waitFor(() => noteCard('注意事項 確認待ち 版1'))
  const guidance = screen.getByRole('region', { name: '入力時の案内' })
  for (const item of ATTENTION_INPUT_GUIDANCE.record)
    expect(within(guidance).getByText(new RegExp(item))).toBeInTheDocument()
  for (const item of ATTENTION_INPUT_GUIDANCE.avoid)
    expect(within(guidance).getByText(new RegExp(item))).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('発生した事実'), {
    target: { value: '説明中に不安を訴えられた。' },
  })
  fireEvent.change(screen.getByLabelText('発生日時'), { target: { value: '2026-08-25T15:10' } })
  fireEvent.change(screen.getByLabelText('根拠'), { target: { value: '接客記録 EY-V-331' } })
  fireEvent.change(screen.getByLabelText('推奨対応'), { target: { value: '段階的に説明する。' } })
  fireEvent.click(screen.getByRole('button', { name: '注意事項を登録する' }))

  await screen.findByText(
    '確認待ちとして登録しました。権限者が公開するまで通常のスタッフには表示されません。',
  )
  const post = calls.find(
    (route) => route.init?.method === 'POST' && route.url.endsWith('/attention-notes'),
  ) as Route
  expect(post.url).toBe(`/api/staff/stores/${STORE_ID}/customers/${CUSTOMER_ID}/attention-notes`)
  expect(bodyOf(post)).toEqual({
    body: '説明中に不安を訴えられた。',
    occurredAt: '2026-08-25T06:10:00.000Z',
    basis: '接客記録 EY-V-331',
    recommendedAction: '段階的に説明する。',
  })
})

test('公開済みの改訂は上書きせず新版を作り、過去版を読める (UC-EYEX-145, AC-EYEX-86)', async () => {
  const { api, calls } = createApi((route) =>
    route.url.includes('/revisions')
      ? jsonResponse({ ...publishedNote, version: 3, body: '三段階に分けて説明する。' })
      : defaultHandler(route),
  )
  renderScreen(api)

  const card = await waitFor(() => noteCard('注意事項 公開済み 版2'))
  fireEvent.click(within(card).getByRole('button', { name: '改訂する' }))
  const form = await screen.findByRole('dialog', { name: '注意事項を改訂' })
  expect(within(form).getByLabelText('発生した事実')).toHaveValue('説明を段階化すると納得された。')
  expect(within(form).getByLabelText('発生日時')).toHaveValue('2026-08-25T15:10')

  fireEvent.change(within(form).getByLabelText('発生した事実'), {
    target: { value: '三段階に分けて説明すると納得された。' },
  })
  fireEvent.click(within(form).getByRole('button', { name: '改訂版を公開する' }))

  await screen.findByText('改訂版を公開しました。過去の版は残っています。')
  const revision = calls.find((route) => route.url.includes('/revisions')) as Route
  expect(revision.url).toBe(
    `/api/staff/stores/${STORE_ID}/attention-notes/${PUBLISHED_NOTE_ID}/revisions`,
  )
  expect(bodyOf(revision)).toMatchObject({
    body: '三段階に分けて説明すると納得された。',
    expectedVersion: 2,
  })

  fireEvent.click(
    within(noteCard('注意事項 公開済み 版3')).getByRole('button', { name: '過去の版を見る' }),
  )
  const versions = await screen.findByRole('dialog', { name: '注意事項の版履歴' })
  expect(within(versions).getByText('版2 · 公開済み')).toBeInTheDocument()
  expect(within(versions).getByText('版1 · 旧版')).toBeInTheDocument()
})

test('古い版からの公開は拒否し、新旧差分を見せる (AC-EYEX-117)', async () => {
  const conflict = {
    error: 'attention_version_conflict',
    currentVersion: 3,
    expectedVersion: 2,
    differences: [
      { field: 'body', before: '説明を段階化', after: '三段階に分ける' },
      { field: 'recommendedAction', before: '', after: '一段階ずつ説明する' },
    ],
  }
  const { api } = createApi((route) =>
    route.url.includes('/revisions') ? jsonResponse(conflict, 409) : defaultHandler(route),
  )
  renderScreen(api)

  const card = await waitFor(() => noteCard('注意事項 公開済み 版2'))
  fireEvent.click(within(card).getByRole('button', { name: '改訂する' }))
  const form = await screen.findByRole('dialog', { name: '注意事項を改訂' })
  fireEvent.click(within(form).getByRole('button', { name: '改訂版を公開する' }))

  // `exception-states-approved.html#conflict` — 最新と手元を並べ、
  // 破棄か再適用のどちらかを必ず選ばせる。
  const dialog = await screen.findByRole('dialog', { name: '別の端末で先に更新されています' })
  expect(dialog).toHaveTextContent('この画面は版2です。現在の版は版3です。')
  const latest = within(dialog).getByRole('region', { name: '最新の内容' })
  expect(latest).toHaveTextContent('三段階に分ける')
  expect(latest).toHaveTextContent('一段階ずつ説明する')
  const mine = within(dialog).getByRole('region', { name: 'この端末の入力' })
  expect(mine).toHaveTextContent('説明を段階化')
  expect(mine).toHaveTextContent('（未記録）')
  expect(within(dialog).getByRole('button', { name: 'この入力を破棄' })).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: '最新内容へ再適用' }))
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: '別の端末で先に更新されています' })).toBeNull()
  })
})

test('削除の代わりに理由付きで非表示化する (UC-EYEX-146)', async () => {
  const { api, calls } = createApi((route) =>
    route.url.includes('/hide')
      ? jsonResponse({ ...publishedNote, status: 'hidden', hiddenAt: NOW })
      : defaultHandler(route),
  )
  renderScreen(api)

  const card = await waitFor(() => noteCard('注意事項 公開済み 版2'))
  expect(within(card).queryByRole('button', { name: '削除する' })).not.toBeInTheDocument()
  fireEvent.click(within(card).getByRole('button', { name: '非表示にする' }))
  const dialog = await screen.findByRole('dialog', { name: '注意事項を非表示にする' })
  fireEvent.change(within(dialog).getByLabelText('非表示にする理由'), {
    target: { value: '事実誤認が判明した。' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '非表示にする' }))

  await screen.findByText('非表示にしました。記録自体は削除されていません。')
  expect(bodyOf(calls.find((route) => route.url.includes('/hide')) as Route)).toEqual({
    reason: '事実誤認が判明した。',
    expectedVersion: 2,
  })
})

test('共有端末では登録に個人認証を求めず、公開には求める (UC-EYEX-137, AC-EYEX-87)', async () => {
  const { api, calls } = createApi((route) => {
    if (route.url.endsWith('/reauthenticate')) return jsonResponse({ token: GRANT, expiresAt: NOW })
    if (route.url.endsWith('/reauthentication')) return jsonResponse({ ok: true })
    if (route.url.includes('/review')) return jsonResponse({ ...pendingNote, status: 'published' })
    if (route.init?.method === 'POST' && route.url.endsWith('/attention-notes'))
      return jsonResponse(pendingNote, 201)
    return defaultHandler(route)
  })
  renderScreen(api, { sharedTerminal: true })

  await waitFor(() => noteCard('注意事項 確認待ち 版1'))
  fireEvent.change(screen.getByLabelText('発生した事実'), {
    target: { value: '不安を訴えられた。' },
  })
  fireEvent.change(screen.getByLabelText('発生日時'), { target: { value: '2026-08-25T15:10' } })
  fireEvent.change(screen.getByLabelText('根拠'), { target: { value: '接客記録' } })
  fireEvent.change(screen.getByLabelText('推奨対応'), { target: { value: '段階的に説明する。' } })
  fireEvent.click(screen.getByRole('button', { name: '注意事項を登録する' }))

  await waitFor(() => {
    expect(
      calls.some(
        (route) => route.init?.method === 'POST' && route.url.includes('/attention-notes'),
      ),
    ).toBe(true)
  })
  expect(screen.queryByLabelText('個人PIN')).not.toBeInTheDocument()

  const card = noteCard('注意事項 確認待ち 版1')
  fireEvent.change(within(card).getByLabelText('確認の理由'), { target: { value: '確認した。' } })
  fireEvent.click(within(card).getByRole('button', { name: '公開する' }))

  const prompt = await screen.findByRole('dialog', { name: '管理者として確認してください' })
  expect(prompt).toHaveTextContent('注意事項の公開は個人認証が必要です')
  expect(calls.some((route) => route.url.includes('/review'))).toBe(false)

  fireEvent.change(within(prompt).getByLabelText('個人ログインID'), {
    target: { value: 'manager-1' },
  })
  fireEvent.change(within(prompt).getByLabelText('個人PIN'), { target: { value: '123456' } })
  fireEvent.click(within(prompt).getByRole('button', { name: '確認して続ける' }))

  await waitFor(() => {
    expect(calls.some((route) => route.url.includes('/review'))).toBe(true)
  })
  // グラントは worker が実際に読むヘッダーで運ぶ。`authorization` に載せても
  // 無視され、共有 iPad の公開・改訂・非表示化はすべて 401 になる。
  const grantedReview = calls.find((route) => route.url.includes('/review'))
  const grantHeaders = (grantedReview?.init?.headers ?? {}) as Record<string, string>
  expect(grantHeaders['x-shared-terminal-reauth-token']).toBe(GRANT)
  expect(grantHeaders.authorization).toBeUndefined()
  const review = calls.find((route) => route.url.includes('/review')) as Route
  expect(review.url).toBe(
    `/api/shared-terminals/${TERMINAL_ID}/stores/${STORE_ID}/attention-notes/${NOTE_ID}/review`,
  )
  const headers = review.init?.headers as Record<string, string> | undefined
  expect(headers?.['x-shared-terminal-reauth-token']).toBe(GRANT)
})

test('監査に残せない公開は成立させず、理由を保持して再試行を出す (UC-EYEX-156, AC-EYEX-103)', async () => {
  let attempts = 0
  const { api, calls } = createApi((route) => {
    if (!route.url.includes('/review')) return defaultHandler(route)
    attempts += 1
    return attempts === 1
      ? jsonResponse({ error: 'audit_append_failed' }, 500)
      : jsonResponse({ ...pendingNote, status: 'published' })
  })
  renderScreen(api)

  const card = await waitFor(() => noteCard('注意事項 確認待ち 版1'))
  fireEvent.change(within(card).getByLabelText('確認の理由'), { target: { value: '確認した。' } })
  fireEvent.click(within(card).getByRole('button', { name: '公開する' }))

  await screen.findByText(
    '監査記録に残せなかったため、この操作は成立していません。入力はそのまま保持しています。',
  )
  expect(within(noteCard('注意事項 確認待ち 版1')).getByLabelText('確認の理由')).toHaveValue(
    '確認した。',
  )
  fireEvent.click(screen.getByRole('button', { name: '再試行する' }))

  await waitFor(() => {
    expect(calls.filter((route) => route.url.includes('/review'))).toHaveLength(2)
  })
})

test('端末に注意事項を残さない (完全共有iPad)', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  const { api } = createApi(defaultHandler)
  renderScreen(api)

  await waitFor(() => noteCard('注意事項 確認待ち 版1'))
  fireEvent.change(screen.getByLabelText('根拠'), { target: { value: '接客記録' } })
  expect(setItem).not.toHaveBeenCalled()
})
