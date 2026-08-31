import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangeScreen } from './ChangeScreen'

/*
 * 予約を探して直す面の器（CHANGE-SEARCH → CHANGE-DATETIME → CHANGE-DIFF）。
 *
 * 器の仕事は 4 つ:
 *   1. 左ペインの条件をそのままサーバへ写し、押した札で取り直す。
 *   2. 選ばれた 1 件の中身と、担当・場所・お電話番号のお名前を引き当てる。
 *   3. 変更先の枠を**先に押さえてから**確定へ進む（元を先に空けない）。
 *   4. 確定の 409 を 2 つに分ける（枠の競合＝BOOK-CONFLICT の形／版の競合＝EX-CONFLICT）。
 *
 * **URL による画面の切り替えを持ち込まない**（この製品に router は無い）。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const RESERVATION_ID = 'a0000000-0000-4000-8000-000000000001'
const STAFF_ID = 'b0000000-0000-4000-8000-000000000001'
/** JST 2026年8月27日（木）11:08。 */
const NOW = '2026-08-27T02:08:00.000Z'

const at = (clock: string, date = '2026-08-27') =>
  new Date(Date.parse(`${date}T${clock}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()

function summary(id: string, clock: string, name: string, date = '2026-08-27') {
  return {
    id,
    code: 'EY-2608-0142',
    startsAt: at(clock, date),
    durationMinutes: 60,
    status: 'confirmed',
    source: 'phone',
    customerName: name,
    visitCount: 4,
    purposeLabel: 'メガネを新しく作る',
    staffName: '佐藤 美咲',
  }
}

const TODAY_ROWS = [
  summary(RESERVATION_ID, '11:00', '田中 花子'),
  summary('r2', '10:00', '伊藤 健'),
  summary('r3', '11:00', '山口 真央'),
]
const ALL_ROWS = [...TODAY_ROWS, summary('r4', '10:30', '田中 花子', '2026-09-03')]

const DETAIL = {
  id: RESERVATION_ID,
  code: 'EY-2608-0142',
  storeId: STORE_ID,
  source: 'phone',
  status: 'confirmed',
  startsAt: at('11:00'),
  endsAt: at('12:00'),
  durationMinutes: 60,
  customerId: 'c0000000-0000-4000-8000-000000000001',
  customerName: '田中 花子',
  visitCount: 4,
  purposes: [
    { purposeId: 'p1', nameInternal: 'メガネを新しく作る', durationMinutes: 60, sortOrder: 0 },
  ],
  assignments: [{ kind: 'staff', targetId: STAFF_ID, startsAt: at('11:00'), endsAt: at('12:00') }],
  webBookingCode: null,
  purposeLabel: '新調',
  purposeLabelInternal: 'メガネを新しく作る',
  noteCustomer: '',
  noteInternal: '',
  version: 3,
  createdAt: at('09:00'),
  updatedAt: at('09:00'),
  createdBy: null,
  cancelledAt: null,
  cancelReason: null,
}

const RELAXATIONS = [
  { label: '「Web予約だけ」を外す', count: 5, query: { name: 'たなか', source: [] } },
]

let asked: { url: URL; method: string; body: unknown }[] = []
/** 直近の検索が返すもの。テストごとに差し替える。 */
let searchAnswer: (url: URL) => unknown
/** 変更の応答。既定は成功。 */
let patchAnswer: () => Response
/** 取り消しの応答。既定は成功。 */
let cancelAnswer: () => Response

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  asked = []
  sessionStorage.setItem('app.auth.token', 'header.payload.signature')
  searchAnswer = (url) =>
    url.searchParams.get('to') === '2026-08-27'
      ? { items: TODAY_ROWS, nextCursor: null, total: TODAY_ROWS.length, relaxations: [] }
      : { items: ALL_ROWS, nextCursor: null, total: ALL_ROWS.length, relaxations: [] }
  patchAnswer = () => json({ ...DETAIL, startsAt: at('14:00'), endsAt: at('15:00'), version: 4 })
  cancelAnswer = () =>
    json({ ...DETAIL, status: 'cancelled', cancelReason: 'customer', version: 4 })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://example.test')
      const method = init?.method ?? 'GET'
      asked.push({
        url,
        method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      })
      if (url.pathname.endsWith('/staff')) {
        return json([{ id: STAFF_ID, displayName: '佐藤 美咲' }])
      }
      if (url.pathname.endsWith('/equipment')) return json([])
      if (url.pathname.endsWith('/business-hours')) {
        return json({ rows: [], blackouts: [], version: 1, warnings: [] })
      }
      if (url.pathname.startsWith('/api/staff/customers/')) {
        return json({ id: 'c1', phone: '09012345678' })
      }
      if (url.pathname === '/api/staff/availability') {
        return json({
          date: url.searchParams.get('date'),
          opensAt: '10:00',
          closesAt: '19:00',
          isClosed: false,
          slotMinutes: 30,
          cleanupMinutes: 10,
          durationMinutes: 60,
          slots: [
            {
              startsAt: at('14:00'),
              endsAt: at('15:00'),
              remaining: 1,
              isAvailable: true,
              staffIds: [],
              equipmentIds: [],
              reason: null,
            },
          ],
          lanes: [],
          alternatives: [],
          reason: null,
          serverNow: NOW,
        })
      }
      if (url.pathname === '/api/staff/holds' && method === 'POST') {
        return json({
          id: 'd0000000-0000-4000-8000-000000000009',
          startsAt: at('14:00'),
          endsAt: at('15:00'),
          expiresAt: '2026-08-27T02:15:00.000Z',
          staffId: null,
          equipmentIds: [],
          receptionSessionId: null,
        })
      }
      if (url.pathname.startsWith('/api/staff/holds/')) return json({ deleted: true })
      if (url.pathname === `/api/staff/reservations/${RESERVATION_ID}/history`) {
        return json([
          { occurredAt: NOW, what: 'ご来店時刻を 11:00 から 14:00 へ', actorName: '中村 彩' },
        ])
      }
      if (url.pathname === `/api/staff/reservations/${RESERVATION_ID}/cancel`) {
        return cancelAnswer()
      }
      if (url.pathname === `/api/staff/reservations/${RESERVATION_ID}`) {
        return method === 'PATCH' ? patchAnswer() : json(DETAIL)
      }
      if (url.pathname === '/api/staff/reservations') return json(searchAnswer(url))
      return new Response('not found', { status: 404 })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

function show(overrides: Partial<Parameters<typeof ChangeScreen>[0]> = {}) {
  const props = {
    storeId: STORE_ID,
    storeName: '銀座店',
    now: NOW,
    onOpenCustomers: vi.fn(),
    onStartBooking: vi.fn(),
    onOpenLedger: vi.fn(),
    onGoHome: vi.fn(),
    ...overrides,
  }
  render(<ChangeScreen {...props} />)
  return props
}

const searches = () => asked.filter((call) => call.url.pathname === '/api/staff/reservations')

async function waitForRows() {
  await waitFor(() => expect(screen.getByText('結果 4件')).toBeInTheDocument())
}

describe('結果の絞り込み', () => {
  it('「今日」を押すと 8/27 の 3 件だけが残る', async () => {
    show()
    await waitForRows()
    await userEvent.click(screen.getByRole('button', { name: '今日' }))
    await waitFor(() => expect(screen.getByText('結果 3件')).toBeInTheDocument())
    const last = searches().at(-1)
    expect(last?.url.searchParams.get('from')).toBe('2026-08-27')
    expect(last?.url.searchParams.get('to')).toBe('2026-08-27')
  })

  it('「取消済み」を押すと取り消されたご予約も探しに行く', async () => {
    show()
    await waitForRows()
    await userEvent.click(screen.getByRole('button', { name: '取消済み' }))
    await waitFor(() =>
      expect(searches().at(-1)?.url.searchParams.get('includeCancelled')).toBe('true'),
    )
  })
})

describe('0 件', () => {
  it('案を押すとその条件だけが外れ、ほかの条件は残る', async () => {
    searchAnswer = (url) =>
      url.searchParams.get('source') === 'web'
        ? { items: [], nextCursor: null, total: 0, relaxations: RELAXATIONS }
        : { items: ALL_ROWS, nextCursor: null, total: ALL_ROWS.length, relaxations: [] }
    show()
    await waitForRows()
    await userEvent.type(screen.getByLabelText('お名前'), 'たなか')
    await waitFor(() => expect(screen.getByText('結果 4件')).toBeInTheDocument())
    // 「Web予約だけ」は 0 件の面から持ち帰る条件なので、案を出すためにここで立てる。
    await userEvent.click(screen.getByRole('button', { name: 'これから' }))
    expect(screen.getByLabelText('お名前')).toHaveValue('たなか')
  })
})

describe('1 件を選ぶ', () => {
  it('中身・担当のお名前・お電話番号を引き当てて右に出す', async () => {
    show()
    await waitForRows()
    await userEvent.click(screen.getAllByRole('button', { name: /田中 花子 様/ })[0] as HTMLElement)
    await waitFor(() => expect(screen.getByText('EY-2608-0142')).toBeInTheDocument())
    expect(screen.getByText('佐藤 美咲')).toBeInTheDocument()
    expect(screen.getByText('／090-1234-5678')).toBeInTheDocument()
  })
})

describe('日時を変える', () => {
  async function openDateTime() {
    show()
    await waitForRows()
    await userEvent.click(screen.getAllByRole('button', { name: /田中 花子 様/ })[0] as HTMLElement)
    await waitFor(() => expect(screen.getByText('EY-2608-0142')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '日時を変える' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'いまのご予約' })).toBeInTheDocument(),
    )
  }

  it('工程 2 へ移り、いまのご予約を左に置く', async () => {
    await openDateTime()
    expect(screen.getByRole('list', { name: '予約の変更の工程　全4工程' })).toBeInTheDocument()
  })

  it('変更先の枠を先に押さえてから確定へ進む（元を先に空けない）', async () => {
    await openDateTime()
    await userEvent.click(screen.getByRole('button', { name: '14:00　受付できます' }))
    await waitFor(() =>
      expect(asked.some((call) => call.url.pathname === '/api/staff/holds')).toBe(true),
    )
    expect(asked.some((call) => call.method === 'PATCH')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: '変更内容を確認する' }))
    await waitFor(() =>
      expect(screen.getByRole('table', { name: '変更前と変更後' })).toBeInTheDocument(),
    )
  })

  it('確定を押すと version を載せた PATCH を 1 本だけ投げる', async () => {
    await openDateTime()
    await userEvent.click(screen.getByRole('button', { name: '14:00　受付できます' }))
    await userEvent.click(screen.getByRole('button', { name: '変更内容を確認する' }))
    await waitFor(() =>
      expect(screen.getByRole('table', { name: '変更前と変更後' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: '変更を確定する' }))
    await waitFor(() => expect(asked.some((call) => call.method === 'PATCH')).toBe(true))
    const patch = asked.filter((call) => call.method === 'PATCH')
    expect(patch).toHaveLength(1)
    expect(patch[0]?.body).toEqual({ version: 3, startsAt: at('14:00') })
  })

  it('409 slot_taken なら BOOK-CONFLICT の形に落とし、いまのご予約は元のまま残る', async () => {
    patchAnswer = () =>
      json(
        {
          error: 'slot_taken',
          alternatives: [
            {
              startsAt: at('15:00'),
              endsAt: at('16:00'),
              remaining: 1,
              isAvailable: true,
              staffIds: [],
              equipmentIds: [],
              reason: null,
            },
          ],
        },
        409,
      )
    await openDateTime()
    await userEvent.click(screen.getByRole('button', { name: '14:00　受付できます' }))
    await userEvent.click(screen.getByRole('button', { name: '変更内容を確認する' }))
    await waitFor(() =>
      expect(screen.getByRole('table', { name: '変更前と変更後' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: '変更を確定する' }))
    await waitFor(() =>
      expect(
        screen.getByText('まだ変更していません。伺った内容は残っています。'),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByRole('table', { name: '変更前と変更後' })).not.toBeInTheDocument()
  })

  it('409 version_conflict なら、選ぶまでどちらの内容も書き換わらないことを言う', async () => {
    patchAnswer = () =>
      json(
        {
          error: 'version_conflict',
          current: {
            version: 4,
            startsAt: at('14:00'),
            endsAt: at('15:00'),
            staffName: '佐藤 美咲',
            equipmentNames: [],
            savedAt: NOW,
            savedBy: '中村 彩',
          },
        },
        409,
      )
    await openDateTime()
    await userEvent.click(screen.getByRole('button', { name: '14:00　受付できます' }))
    await userEvent.click(screen.getByRole('button', { name: '変更内容を確認する' }))
    await waitFor(() =>
      expect(screen.getByRole('table', { name: '変更前と変更後' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: '変更を確定する' }))
    await waitFor(() =>
      expect(screen.getByText('同じご予約を、ほかの端末でも直していました')).toBeInTheDocument(),
    )
    expect(
      screen.getByText(
        /中村 彩 が 11:08 に保存しました。選ぶまで、どちらの内容も書き換わりません。/,
      ),
    ).toBeInTheDocument()
  })
})

describe('顧客台帳へ渡す', () => {
  it('0 件の面の「顧客台帳で調べる」は入れたお名前を持って外へ出る', async () => {
    searchAnswer = () => ({
      items: [],
      nextCursor: null,
      total: 0,
      relaxations: RELAXATIONS,
    })
    const props = show()
    await waitFor(() => expect(screen.getByText('結果 0件')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('お名前'), 'たなか')
    await userEvent.click(screen.getByRole('button', { name: '顧客台帳で調べる' }))
    expect(props.onOpenCustomers).toHaveBeenCalledWith('たなか')
  })
})

describe('取り消す', () => {
  async function openCancel() {
    show()
    await waitForRows()
    await userEvent.click(screen.getAllByRole('button', { name: /田中 花子 様/ })[0] as HTMLElement)
    await waitFor(() => expect(screen.getByText('EY-2608-0142')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '取り消す' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'この予約を取り消します' })).toBeInTheDocument(),
    )
  }

  it('「取り消す」を押すと取り消しの面が開き、理由を選ぶまで送らない', async () => {
    await openCancel()
    expect(
      screen.getByRole('button', {
        name: 'この予約を取り消す（取り消しの理由を選ぶと押せます）',
      }),
    ).toBeDisabled()
    expect(asked.some((call) => call.url.pathname.endsWith('/cancel'))).toBe(false)
  })

  it('理由を選んで取り消すと version と理由を載せて送り、完了の面へ移る', async () => {
    await openCancel()
    await userEvent.click(screen.getByRole('radio', { name: 'お客様のご都合' }))
    await userEvent.click(screen.getByRole('button', { name: 'この予約を取り消す' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'ご予約を取り消しました' })).toBeInTheDocument(),
    )
    const sent = asked.filter((call) => call.url.pathname.endsWith('/cancel'))
    expect(sent).toHaveLength(1)
    expect(sent[0]?.body).toEqual({ version: 3, reason: 'customer' })
    expect(
      screen.getByText('この枠は、ほかのお客様にご案内できる状態に戻りました。'),
    ).toBeInTheDocument()
  })
})

describe('変更の完了', () => {
  it('確定すると完了の面へ移り、予約番号と受付履歴の 1 行が出る', async () => {
    show()
    await waitForRows()
    await userEvent.click(screen.getAllByRole('button', { name: /田中 花子 様/ })[0] as HTMLElement)
    await waitFor(() => expect(screen.getByText('EY-2608-0142')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '日時を変える' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'いまのご予約' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: '14:00　受付できます' }))
    await userEvent.click(screen.getByRole('button', { name: '変更内容を確認する' }))
    await userEvent.click(screen.getByRole('button', { name: '変更を確定する' }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'ご予約の変更を承りました' })).toBeInTheDocument(),
    )
    expect(screen.getByText('予約番号は変わりません')).toBeInTheDocument()
    expect(screen.getByText(/変更前は 11:00–12:00/)).toBeInTheDocument()
    // 脚注の操作者と時刻は端末の時計ではなく、経緯の最後の 1 行から取る。
    expect(
      screen.getByText(/この操作は受付履歴に残ります（銀座店 この端末・11:08\s+操作者 中村 彩）。/),
    ).toBeInTheDocument()
  })
})

describe('版の競合の解き方', () => {
  const CONFLICT = () =>
    json(
      {
        error: 'version_conflict',
        current: {
          version: 4,
          startsAt: at('16:00'),
          endsAt: at('17:00'),
          staffName: '佐藤 美咲',
          equipmentNames: [],
          savedAt: NOW,
          savedBy: '中村 彩',
        },
      },
      409,
    )

  async function openConflict() {
    patchAnswer = CONFLICT
    show()
    await waitForRows()
    await userEvent.click(screen.getAllByRole('button', { name: /田中 花子 様/ })[0] as HTMLElement)
    await waitFor(() => expect(screen.getByText('EY-2608-0142')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '日時を変える' }))
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'いまのご予約' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: '14:00　受付できます' }))
    await userEvent.click(screen.getByRole('button', { name: '変更内容を確認する' }))
    await userEvent.click(screen.getByRole('button', { name: '変更を確定する' }))
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: '同じご予約を、ほかの端末でも直していました' }),
      ).toBeInTheDocument(),
    )
  }

  it('両方の内容が並び、4 つの出口が出る', async () => {
    await openConflict()
    expect(screen.getByRole('region', { name: '中村 彩 が保存した内容' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'あなたが直した内容' })).toBeInTheDocument()
    for (const name of [
      '中村 彩 の内容を残す',
      'あなたの内容で上書きする',
      '1項目ずつ選ぶ',
      'やめて台帳に戻る',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('「相手の内容を残す」は 1 本も書き込みを送らない（AC-CHANGE-23）', async () => {
    await openConflict()
    const before = asked.filter((call) => call.method !== 'GET').length
    await userEvent.click(screen.getByRole('button', { name: '中村 彩 の内容を残す' }))
    await waitFor(() =>
      expect(
        screen.getByText(
          'ほかの端末の内容を残しました。この端末で入れていた変更は取り消しています。',
        ),
      ).toBeInTheDocument(),
    )
    expect(asked.filter((call) => call.method === 'PATCH')).toHaveLength(1)
    expect(asked.filter((call) => call.method !== 'GET').length).toBeLessThanOrEqual(before + 1)
  })

  it('「あなたの内容で上書きする」は空き枠を当て直してから相手の版で送る（AC-CHANGE-20）', async () => {
    await openConflict()
    patchAnswer = () => json({ ...DETAIL, startsAt: at('14:00'), endsAt: at('15:00'), version: 5 })
    const availabilityBefore = asked.filter(
      (call) => call.url.pathname === '/api/staff/availability',
    ).length
    await userEvent.click(screen.getByRole('button', { name: 'あなたの内容で上書きする' }))
    await waitFor(() => expect(asked.filter((call) => call.method === 'PATCH')).toHaveLength(2))
    expect(
      asked.filter((call) => call.url.pathname === '/api/staff/availability').length,
    ).toBeGreaterThan(availabilityBefore)
    expect(asked.filter((call) => call.method === 'PATCH').at(-1)?.body).toEqual({
      version: 4,
      startsAt: at('14:00'),
    })
  })
})
