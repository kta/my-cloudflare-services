import type { Recording, StorePermission } from '@app/contracts'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { screenSections } from './app-chrome'
import { RecordingOpsScreen } from './RecordingOpsScreen'

const STORE_ID = '00000000-0000-4000-8000-000000000010'
const STORED_ID = '00000000-0000-4000-8000-000000000101'
const FAILED_ID = '00000000-0000-4000-8000-000000000102'
const HELD_ID = '00000000-0000-4000-8000-000000000103'
const TERMINAL_ID = '00000000-0000-4000-8000-000000000200'
const NOW = '2026-09-27T02:00:00.000Z'
const MANAGE: StorePermission[] = ['recording.read', 'recording.manage']

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

const stored: Recording = {
  id: STORED_ID,
  organizationId: 'org-1',
  storeId: STORE_ID,
  receptionSessionId: '00000000-0000-4000-8000-000000000301',
  reservationId: '00000000-0000-4000-8000-000000000401',
  recorderType: 'personal',
  recorderId: '佐藤 美咲',
  startedAt: '2026-08-27T02:00:00.000Z',
  endedAt: '2026-08-27T02:01:08.000Z',
  durationSeconds: 68,
  endReason: 'completed',
  state: 'stored',
  retentionUntil: '2026-09-26T02:01:08.000Z',
  holdReason: null,
  heldBy: null,
  heldAt: null,
  deletedAt: null,
  failureReason: null,
  version: 3,
}

const failed: Recording = {
  ...stored,
  id: FAILED_ID,
  state: 'failed',
  failureReason: 'network_unavailable',
  retentionUntil: null,
  version: 2,
}

const held: Recording = {
  ...stored,
  id: HELD_ID,
  state: 'held',
  holdReason: '予約内容確認',
  heldBy: 'user-1',
  heldAt: '2026-09-01T02:00:00.000Z',
  version: 4,
}

const retention = {
  confirmedRetentionDays: 90,
  discardedRetentionHours: 72,
  updatedAt: '2026-08-01T02:00:00.000Z',
}

type ApiCall = { url: string; init?: RequestInit }

function stubApi(routes: (call: ApiCall) => Response | undefined) {
  const calls: ApiCall[] = []
  const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init }
    calls.push(call)
    return routes(call) ?? jsonResponse([])
  })
  return { api, calls }
}

function defaultRoutes(list: Recording[]) {
  return ({ url }: ApiCall): Response | undefined => {
    if (url.includes('/recording-retention')) return jsonResponse(retention)
    if (url.includes('/recordings')) {
      const state = new URL(url, 'https://x').searchParams.get('state')
      return jsonResponse(state ? list.filter((row) => row.state === state) : list)
    }
    return undefined
  }
}

function renderScreen(
  routes: (call: ApiCall) => Response | undefined,
  overrides: { permissions?: StorePermission[]; terminalId?: string | null } = {},
) {
  const { api, calls } = stubApi(routes)
  const navigate = vi.fn()
  render(
    <RecordingOpsScreen
      storeId={STORE_ID}
      storeName="銀座店"
      api={api}
      navigate={navigate}
      now={NOW}
      organizationId="org-1"
      permissions={overrides.permissions ?? MANAGE}
      terminalId={overrides.terminalId ?? null}
    />,
  )
  return { api, calls, navigate }
}

/** UC-EYEX-154 / AC-EYEX-100 */
/*
 * 録音の一覧は「保存・削除状態」の節にある。本文は選んだ節のものだけを見せる
 * ので、一覧を触るテストはここを通ってから始める（柱が押したときと同じ口）。
 */
function openList() {
  act(() => {
    screenSections.select('保存・削除状態')
  })
}

test('保存中・失敗・保全中・削除予定・削除済みを区別して並べる', async () => {
  renderScreen(defaultRoutes([stored, failed, held]))
  openList()
  for (const label of ['保存中', '保存済み', '失敗', '保全中', '削除予定', '削除済み']) {
    expect(await screen.findByRole('button', { name: label })).toBeInTheDocument()
  }
  expect((await screen.findAllByText(/佐藤 美咲/)).length).toBeGreaterThan(0)
})

/** UC-EYEX-154 / AC-EYEX-100 */
test('区分を選ぶとその状態だけを取得しなおす', async () => {
  const { calls } = renderScreen(defaultRoutes([stored, failed, held]))
  openList()
  await screen.findByRole('button', { name: '失敗' })
  fireEvent.click(screen.getByRole('button', { name: '失敗' }))
  await waitFor(() => {
    expect(calls.some((call) => call.url.includes('/recordings?state=failed'))).toBe(true)
  })
})

/** AC-EYEX-100 */
test('再試行できるのは失敗した録音だけ', async () => {
  const { calls } = renderScreen(defaultRoutes([stored, failed, held]))
  openList()
  const failedRow = await screen.findByTestId(`recording-${FAILED_ID}`)
  expect(
    within(await screen.findByTestId(`recording-${STORED_ID}`)).queryByRole('button', {
      name: '再試行',
    }),
  ).toBeNull()
  expect(
    within(await screen.findByTestId(`recording-${HELD_ID}`)).queryByRole('button', {
      name: '再試行',
    }),
  ).toBeNull()

  fireEvent.click(within(failedRow).getByRole('button', { name: '再試行' }))
  await waitFor(() => {
    expect(
      calls.some(
        (call) =>
          call.url.endsWith(`/recordings/${FAILED_ID}/retry`) && call.init?.method === 'POST',
      ),
    ).toBe(true)
  })
})

/** UC-EYEX-037 / AC-EYEX-15 */
test('録音日時・録音者・長さを示し、再生・一時停止・シークができる', async () => {
  renderScreen(defaultRoutes([stored]))
  openList()
  fireEvent.click(
    within(await screen.findByTestId(`recording-${STORED_ID}`)).getByRole('button', {
      name: '再生する',
    }),
  )
  const player = await screen.findByRole('region', { name: '録音の再生' })
  expect(player).toHaveTextContent('2026年8月27日 11:00')
  expect(player).toHaveTextContent('佐藤 美咲')
  expect(player).toHaveTextContent('01:08')
  expect(within(player).getByRole('button', { name: '再生' })).toBeInTheDocument()
  expect(within(player).getByRole('button', { name: '一時停止' })).toBeInTheDocument()
  expect(within(player).getByRole('slider', { name: '再生位置' })).toBeInTheDocument()
})

/** UC-EYEX-129 / AC-EYEX-79 */
test('画面のどこにもダウンロード操作を出さない', async () => {
  renderScreen(defaultRoutes([stored, failed, held]))
  openList()
  fireEvent.click(
    within(await screen.findByTestId(`recording-${STORED_ID}`)).getByRole('button', {
      name: '再生する',
    }),
  )
  await screen.findByRole('region', { name: '録音の再生' })
  expect(screen.queryByText(/ダウンロード/)).toBeNull()
  expect(document.querySelectorAll('a[download]')).toHaveLength(0)
  expect(document.querySelectorAll('a[href]')).toHaveLength(0)
  const audio = document.querySelector('audio')
  expect(audio).not.toBeNull()
  expect(audio?.getAttribute('controlsList')).toContain('nodownload')
})

/** UC-EYEX-128 / AC-EYEX-78, 101 */
test('保全は理由が無ければ実行できない', async () => {
  const { calls } = renderScreen(defaultRoutes([stored]))
  openList()
  fireEvent.click(
    within(await screen.findByTestId(`recording-${STORED_ID}`)).getByRole('button', {
      name: '保全する',
    }),
  )
  const dialog = await screen.findByRole('dialog', { name: '録音を保全する' })
  fireEvent.click(within(dialog).getByRole('button', { name: '保全を実行' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('理由')
  expect(calls.some((call) => call.url.includes('/hold'))).toBe(false)

  fireEvent.change(within(dialog).getByLabelText('保全の理由'), {
    target: { value: '開示請求のため' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '保全を実行' }))
  await waitFor(() => {
    const call = calls.find((entry) => entry.url.endsWith(`/recordings/${STORED_ID}/hold`))
    expect(call?.init?.method).toBe('POST')
    expect(JSON.parse(String(call?.init?.body))).toEqual({ version: 3, reason: '開示請求のため' })
  })
})

/** UC-EYEX-128 / AC-EYEX-101 */
test('保全解除も理由を必須とする', async () => {
  const { calls } = renderScreen(defaultRoutes([held]))
  openList()
  fireEvent.click(
    within(await screen.findByTestId(`recording-${HELD_ID}`)).getByRole('button', {
      name: '保全を解除する',
    }),
  )
  const dialog = await screen.findByRole('dialog', { name: '録音の保全を解除する' })
  fireEvent.click(within(dialog).getByRole('button', { name: '解除を実行' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('理由')

  fireEvent.change(within(dialog).getByLabelText('解除の理由'), {
    target: { value: '調査が終わったため' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: '解除を実行' }))
  await waitFor(() => {
    const call = calls.find((entry) => entry.url.endsWith(`/recordings/${HELD_ID}/hold/release`))
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      version: 4,
      reason: '調査が終わったため',
    })
  })
})

/** UC-EYEX-128 / AC-EYEX-101 */
test('共有端末では個人再認証を終えるまで保全を送らない', async () => {
  const { calls } = renderScreen(defaultRoutes([stored]), { terminalId: TERMINAL_ID })
  openList()
  fireEvent.click(
    within(await screen.findByTestId(`recording-${STORED_ID}`)).getByRole('button', {
      name: '保全する',
    }),
  )
  expect(await screen.findByLabelText('個人PIN')).toBeInTheDocument()
  expect(calls.some((call) => call.url.includes('/hold'))).toBe(false)
  expect(screen.queryByRole('dialog', { name: '録音を保全する' })).toBeNull()
})

/** UC-EYEX-125 / AC-EYEX-75, 76 */
test('最低保持期限より前の削除は拒否され、最低保持期限を示す', async () => {
  const base = defaultRoutes([stored])
  const { calls } = renderScreen((call) => {
    if (call.init?.method === 'DELETE') {
      return jsonResponse(
        {
          error: 'retention_active',
          retentionUntil: '2026-11-25T02:01:08.000Z',
          minimumRetentionUntil: '2026-09-26T02:01:08.000Z',
        },
        409,
      )
    }
    return base(call)
  })
  openList()
  fireEvent.click(
    within(await screen.findByTestId(`recording-${STORED_ID}`)).getByRole('button', {
      name: '削除する',
    }),
  )
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('最低保持期限')
  expect(alert).toHaveTextContent('2026年9月26日 11:01')
  expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(true)
})

/*
 * 承認済みモック `RECORDING-OPS` の保存期間は `90日保存` / `3日保存` という
 * 読み取りの表示で、欄ではない。単位のない裸の `90` / `72` を面に置くと、
 * 日なのか時間なのかが読めず、モックにある事実がそのぶん消える。
 * `REBUILD.md` のとおり、設定の本文は読み取りが既定で編集は操作の先である。
 */
test('保存期間は既定で読み取りの表示にする (RECORDING-OPS)', async () => {
  renderScreen(defaultRoutes([stored]))
  const confirmed = await screen.findByRole('region', { name: '成立予約' })
  expect(confirmed).toHaveTextContent('90日保存')
  // モックの読み方は `3日保存`（隣の `90日保存` と同じ単位で並べる）。
  expect(screen.getByRole('region', { name: '破棄した受付' })).toHaveTextContent('3日保存')
  expect(screen.queryByLabelText('成立予約の保存日数')).toBeNull()
  expect(screen.queryByRole('button', { name: '保存期間を更新' })).toBeNull()
})

test('保存期間の編集は明示の操作の先にある (RECORDING-OPS)', async () => {
  renderScreen(defaultRoutes([stored]))
  const confirmed = await screen.findByRole('region', { name: '成立予約' })
  fireEvent.click(within(confirmed).getByRole('button', { name: '変更' }))

  expect(screen.getByLabelText('成立予約の保存日数')).toBeInTheDocument()
  expect(screen.getByLabelText('破棄受付の保存時間')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '保存期間を更新' })).toBeInTheDocument()
})

/** 権限が無ければ編集の口は出ない（保存期間そのものも取りに行かないので未取得）。 */
test('保存期間を変える権限が無ければ変更の口を出さない (RECORDING-OPS)', async () => {
  renderScreen(defaultRoutes([stored]), { permissions: ['recording.read'] })
  const confirmed = await screen.findByRole('region', { name: '成立予約' })
  expect(within(confirmed).queryByRole('button', { name: '変更' })).toBeNull()
  expect(screen.queryByLabelText('成立予約の保存日数')).toBeNull()
})

/** 保全の個人再認証の本文は、モックの `録音の保全指定は…` と一字一句同じにする。 */
test('保全の個人再認証はモックの文言で名乗る (REAUTH)', async () => {
  renderScreen(defaultRoutes([stored]), { terminalId: TERMINAL_ID })
  openList()
  fireEvent.click(
    within(await screen.findByTestId(`recording-${STORED_ID}`)).getByRole('button', {
      name: '保全する',
    }),
  )
  expect(
    await screen.findByText(
      '録音の保全指定は個人認証が必要です。共有端末と認証した個人の両方を監査記録に残します。',
    ),
  ).toBeInTheDocument()
})

/** AC-EYEX-99 */
test('最低値を下回る保存期間は理由つきで拒否し、送信しない', async () => {
  const { calls } = renderScreen(defaultRoutes([stored]))
  fireEvent.click(
    within(await screen.findByRole('region', { name: '成立予約' })).getByRole('button', {
      name: '変更',
    }),
  )
  const days = screen.getByLabelText('成立予約の保存日数')
  fireEvent.change(days, { target: { value: '10' } })
  fireEvent.click(screen.getByRole('button', { name: '保存期間を更新' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('最低30日')
  expect(calls.some((call) => call.init?.method === 'PUT')).toBe(false)

  fireEvent.change(screen.getByLabelText('破棄受付の保存時間'), { target: { value: '2' } })
  fireEvent.change(days, { target: { value: '30' } })
  fireEvent.click(screen.getByRole('button', { name: '保存期間を更新' }))
  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent('最低24時間')
  })
  expect(calls.some((call) => call.init?.method === 'PUT')).toBe(false)
})

/** AC-EYEX-99 */
test('最低値以上なら保存期間を送信する', async () => {
  const { calls } = renderScreen(defaultRoutes([stored]))
  fireEvent.click(
    within(await screen.findByRole('region', { name: '成立予約' })).getByRole('button', {
      name: '変更',
    }),
  )
  fireEvent.change(screen.getByLabelText('成立予約の保存日数'), { target: { value: '120' } })
  fireEvent.click(screen.getByRole('button', { name: '保存期間を更新' }))
  await waitFor(() => {
    const call = calls.find((entry) => entry.init?.method === 'PUT')
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      confirmedRetentionDays: 120,
      discardedRetentionHours: 72,
    })
  })
})

/** UC-EYEX-127 / AC-EYEX-79 */
test('録音を扱う権限が無ければ一覧も再生も出さず、承認済みの回復操作を出す', async () => {
  const { navigate } = renderScreen(defaultRoutes([stored]), { permissions: [] })
  openList()
  const denied = await screen.findByRole('region', { name: '権限がありません' })
  expect(denied).toHaveTextContent('この設定を表示する権限がありません')
  expect(denied).toHaveTextContent(
    '権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。',
  )
  expect(screen.queryByTestId(`recording-${STORED_ID}`)).toBeNull()
  fireEvent.click(within(denied).getByRole('button', { name: '業務開始画面へ戻る' }))
  expect(navigate).toHaveBeenCalledWith({ screen: 'home' })
})

/** 承認済みモック `operations-approved.html#recording-ops` の骨格 */
test('録音運用の節をモックどおりに出す', async () => {
  renderScreen(defaultRoutes([stored]))
  openList()
  /* 節は面が描かず、全画面共通の柱へ渡す。面の側では渡した中身で確かめる。 */
  await screen.findByRole('heading', { name: '録音の保存期間' })
  expect(screenSections.snapshot().map((section) => section.label)).toEqual([
    '保存期間',
    '保存・削除状態',
    '保全一覧',
  ])
  expect(screen.queryByRole('navigation')).toBeNull()
})

/** 承認済みモックの保存期間 3 カード */
test('保存期間は成立予約・破棄した受付・適用元の3枚で示す', async () => {
  renderScreen(defaultRoutes([stored]))
  const confirmed = await screen.findByRole('region', { name: '成立予約' })
  expect(confirmed).toHaveTextContent('最低30日未満には設定できません')
  expect(screen.getByRole('region', { name: '破棄した受付' })).toHaveTextContent(
    '最低24時間未満には設定できません',
  )
  const origin = screen.getByRole('region', { name: '適用元' })
  expect(origin).toHaveTextContent('組織共通値')
  expect(within(origin).getByRole('button', { name: '店舗上書きを設定' })).toBeInTheDocument()
})

/** 承認済みモックの「対応が必要」 */
test('失敗と保全中は対応が必要としてモックの行で先に出す', async () => {
  renderScreen(defaultRoutes([stored, failed, held]))
  const attention = await screen.findByRole('region', { name: '対応が必要' })
  const failedRow = within(attention).getByRole('article', { name: /保存失敗/ })
  expect(failedRow).toHaveTextContent('保存失敗')
  expect(within(failedRow).getByRole('button', { name: '再試行' })).toBeInTheDocument()

  const heldRow = within(attention).getByRole('article', { name: /保全中/ })
  expect(heldRow).toHaveTextContent('理由: 予約内容確認')
  expect(within(heldRow).getByRole('button', { name: '詳細' })).toBeInTheDocument()
})

/** 閲覧のみのスタッフは再生できるが保全・削除・再試行は出さない (AC-EYEX-100, 101) */
test('閲覧権限だけでは保全・解除・削除・再試行を出さない', async () => {
  renderScreen(defaultRoutes([stored, failed, held]), { permissions: ['recording.read'] })
  openList()
  await screen.findByTestId(`recording-${STORED_ID}`)
  expect(screen.queryByRole('button', { name: '保全する' })).toBeNull()
  expect(screen.queryByRole('button', { name: '保全を解除する' })).toBeNull()
  expect(screen.queryByRole('button', { name: '削除する' })).toBeNull()
  expect(screen.queryByRole('button', { name: '再試行' })).toBeNull()
  expect(screen.queryByLabelText('成立予約の保存日数')).toBeNull()
})

test('操作面は44px以上で、ブラウザストレージへ何も書かない', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  renderScreen(defaultRoutes([stored, failed, held]))
  openList()
  await screen.findByTestId(`recording-${STORED_ID}`)
  for (const button of screen.getAllByRole('button')) {
    expect(button.className).toMatch(/min-h-1[12]/)
  }
  expect(setItem).not.toHaveBeenCalled()
  setItem.mockRestore()
})

/**
 * `RECORDING-OPS`。モックの `適用元` は保存操作ではなく、店舗上書きを
 * 「これから設定する」導線。押しただけで保存が走るのは実装バグだった。
 */
test('適用元の店舗上書きボタンは保存せず、保存日数の入力へ送る', async () => {
  const { calls } = renderScreen(defaultRoutes([stored]))
  const origin = await screen.findByRole('region', { name: '適用元' })
  const button = within(origin).getByRole('button', { name: '店舗上書きを設定' })
  fireEvent.click(button)
  expect(calls.some((call) => call.init?.method === 'PUT')).toBe(false)
  // 読み取りの面から押しても、欄を開いたうえでそこへ送る。
  await waitFor(() => expect(screen.getByLabelText('成立予約の保存日数')).toHaveFocus())
})

/*
 * 承認済みモック `operations-approved.html#recording-ops` の「破棄した受付」は
 * `3日保存` と読む。契約は時間で持つが、隣の「成立予約」が `90日保存` なので
 * 時間のまま出すと同じ段の 2 枚が別の単位で並び、長短をその場で比べられない。
 * 24 で割り切れないときだけ時間のまま出す（丸めて実際より短く見せない）。
 */
function renderWithRetentionHours(hours: number) {
  renderScreen(({ url }: ApiCall): Response | undefined => {
    if (url.includes('/recording-retention'))
      return jsonResponse({ ...retention, discardedRetentionHours: hours })
    if (url.includes('/recordings')) return jsonResponse([])
    return undefined
  })
}

test('破棄した受付の保存期間は日で読める値なら日で出す (RECORDING-OPS)', async () => {
  renderWithRetentionHours(72)
  expect(await screen.findByRole('region', { name: '破棄した受付' })).toHaveTextContent('3日保存')
})

test('24 で割り切れない保存期間は時間のまま出す (RECORDING-OPS)', async () => {
  renderWithRetentionHours(30)
  expect(await screen.findByRole('region', { name: '破棄した受付' })).toHaveTextContent(
    '30時間保存',
  )
})

/*
 * 承認済みモック `operations-approved.html#recording-ops` の柱は 3 つの節を持ち、
 * 本文は選んだ節のものだけを見せる。3 つを縦に積むと、保存期間を確かめに来た
 * 人の目の前に録音の一覧が続き、柱の節が「どこへ行く札」なのかも読めなくなる。
 */
test('本文は選んだ節のものだけを見せる', async () => {
  renderScreen(defaultRoutes([stored]))
  await screen.findByRole('region', { name: '対応が必要' })
  expect(screen.queryByText('録音の状態で絞り込む')).toBeNull()

  /* 節の列は面の中ではなく全画面共通の柱にある。面だけを描くテストからは、
     柱が押したときと同じ口を叩いて選ぶ。 */
  act(() => {
    screenSections.select('保存・削除状態')
  })
  expect(await screen.findByText('録音の状態で絞り込む')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '対応が必要' })).toBeNull()
})
