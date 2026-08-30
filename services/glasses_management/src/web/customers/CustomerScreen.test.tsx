import type {
  CustomerDetail as CustomerDetailShape,
  CustomerNote,
  CustomerSummary,
} from '@app/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerScreen } from './CustomerScreen'

/*
 * 顧客台帳の器。**URL による画面の切り替えを持ち込まない**ので、一覧・詳細・新規登録・
 * おまとめ・手書きの行き来はこの器の `pane` だけで起きる。ここでは繋ぎ（何を取りに行き、
 * 押すとどこへ移り、応答をどの部品へ渡すか）だけを見る。各面の中身は
 * `CustomerList` / `CustomerDetail` / `CustomerNew` / `CustomerMerge` / `CustomerHandwrite`
 * それぞれのテストが見る。
 */

const GINZA = 'd0000000-0000-4000-8000-000000000001'
const HANAKO_ID = 'c0000000-0000-4000-8000-000000000008'
const ICHIRO_ID = 'c0000000-0000-4000-8000-000000000009'
const MEGUMI_ID = 'c0000000-0000-4000-8000-000000000006'

const HANAKO: CustomerSummary = {
  id: HANAKO_ID,
  customerNumber: 'G-01842',
  name: '田中 花子',
  kana: 'たなか はなこ',
  phone: '09012345678',
  visitCount: 4,
  lastVisitAt: '2026-05-12',
  memoShort: 'PC作業用・鼻パッド低め',
}

const MEGUMI: CustomerSummary = {
  id: MEGUMI_ID,
  customerNumber: 'G-01006',
  name: '川上 恵',
  kana: 'かわかみ めぐみ',
  phone: null,
  visitCount: 0,
  lastVisitAt: null,
  memoShort: 'お子様の分もご一緒に',
}

const ATTENTION_NOTE: CustomerNote = {
  id: 'c0000000-0000-4000-8000-000000000401',
  kind: 'attention',
  body: '金属アレルギーのお申し出があります。',
  handwritingSvg: '<svg viewBox="0 0 10 10"><path d="M0 0L1 1" /></svg>',
  authorId: null,
  authorName: '中村 彩',
  revision: 1,
  status: 'published',
  storeId: GINZA,
  createdAt: '2026-05-12T02:00:00.000Z',
}

function detailOf(id: string, overrides: Partial<CustomerDetailShape> = {}): CustomerDetailShape {
  return {
    ...HANAKO,
    id,
    email: null,
    birthDate: null,
    address: null,
    memo: 'PC作業用・鼻パッド低め',
    firstVisitAt: '2024-03-15',
    frequentStaffName: '佐藤 美咲',
    prescriptions: [
      {
        id: 'c0000000-0000-4000-8000-000000000201',
        measuredAt: '2026-05-12',
        rSph: -2.25,
        lSph: -2,
        rCyl: -0.5,
        lCyl: -0.75,
        rAxis: 180,
        lAxis: 175,
        rAdd: null,
        lAdd: null,
        pd: 62,
        note: '',
        isCurrent: true,
      },
    ],
    glasses: [],
    notes: [ATTENTION_NOTE],
    nextReservation: null,
    mergedIntoId: null,
    version: 3,
    ...overrides,
  }
}

const DETAIL = detailOf(HANAKO_ID)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Handler = (url: URL, init?: RequestInit) => Response | null

/** 台帳・詳細・スタッフ一覧の 3 本を返す既定のルーター。テストごとに `extra` で足す。 */
function stub(extra: Handler = () => null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://example.test')
      const custom = extra(url, init)
      if (custom !== null) return custom
      if (url.pathname === '/api/staff/customers' && (init?.method ?? 'GET') === 'GET') {
        return json({ items: [MEGUMI, HANAKO], nextCursor: null, total: 2 })
      }
      if (url.pathname === `/api/staff/customers/${HANAKO_ID}`) return json(DETAIL)
      if (url.pathname === `/api/staff/stores/${GINZA}/staff`) return json([])
      if (url.pathname === '/api/staff/customers/lookup') return json([])
      return json({ error: 'not_found' }, 404)
    }),
  )
}

const onStartBooking = vi.fn()
const onSessionExpired = vi.fn()

function open() {
  return render(
    <CustomerScreen
      storeId={GINZA}
      stores={
        [
          {
            id: GINZA,
            organizationId: 'org-eyex',
            name: 'EYEX 銀座店',
            slug: 'ginza',
            isActive: true,
          },
        ] as never
      }
      onStartBooking={onStartBooking}
      onSessionExpired={onSessionExpired}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('顧客台帳の器', () => {
  it('台帳を 1 ページ取り、ふりがなの順で行を出す', async () => {
    stub()
    open()
    expect(screen.getByRole('status').textContent).toBe('お客様の一覧を読み込んでいます…')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    expect(
      screen.getAllByRole('option').map((row) => row.getAttribute('aria-label')?.split('　')[0]),
    ).toEqual(['川上 恵 様', '田中 花子 様'])
  })

  it('行を選ぶと要約が出て、「くわしく見る」で詳細へ移り、戻ってこられる', async () => {
    stub()
    open()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))

    await userEvent.click(screen.getByRole('option', { name: /田中 花子 様/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'くわしく見る' })).toBeInTheDocument(),
    )

    await userEvent.click(screen.getByRole('button', { name: 'くわしく見る' }))
    expect(screen.getByRole('table', { name: '度数の移り変わり' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'この方のご予約を取る' }))
    expect(onStartBooking).toHaveBeenCalledWith({
      id: HANAKO_ID,
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: '09012345678',
    })

    await userEvent.click(screen.getByRole('button', { name: 'お客様の一覧へ戻る' }))
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('一覧の要約からの「ご予約を取る」も、その行のお客様を持って渡す', async () => {
    stub()
    open()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    await userEvent.click(screen.getByRole('option', { name: /田中 花子 様/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ご予約を取る' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'ご予約を取る' }))
    expect(onStartBooking).toHaveBeenCalledWith({
      id: HANAKO_ID,
      name: '田中 花子',
      kana: 'たなか はなこ',
      phone: '09012345678',
    })
  })

  it('顧客情報を直す画面は、まだ作っていない事実を 1 行で答える', async () => {
    stub()
    open()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    await userEvent.click(screen.getByRole('option', { name: /田中 花子 様/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'くわしく見る' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'くわしく見る' }))

    await userEvent.click(screen.getByRole('button', { name: '内容を直す' }))
    expect(screen.getByRole('status').textContent).toBe(
      'お客様の情報を直す画面はこれから作ります。',
    )
  })

  it('選んだ行の要約が読めなかったときは、その事実を出して選び直させる', async () => {
    stub()
    open()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    // 川上 恵 様の中身は返らない（他社の ID と同じ 404 の道）。
    await userEvent.click(screen.getByRole('option', { name: /川上 恵 様/ }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'この方の要約を読み込めませんでした。もう一度お選びください。',
      ),
    )
  })

  it('顧客台帳を見る権限が無いときは、その理由を出す', async () => {
    stub((url) =>
      url.pathname === '/api/staff/customers' ? json({ error: 'forbidden' }, 403) : null,
    )
    open()
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        '顧客台帳を見る権限がありません。お店の管理者にご確認ください。',
      ),
    )
    expect(onSessionExpired).not.toHaveBeenCalled()
  })

  it('業務の期限が切れたら（401）外へ知らせる', async () => {
    stub((url) =>
      url.pathname === '/api/staff/customers' ? json({ error: 'unauthorized' }, 401) : null,
    )
    open()
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled())
    expect(screen.getByRole('alert').textContent).toContain(
      'お客様の一覧を読み込めませんでした。通信が切れているかもしれません。',
    )
  })
})

describe('新しいお客様の登録（CUSTOMER-NEW）', () => {
  it('「＋新しいお客様を登録」を押すと、その面が開く', async () => {
    stub()
    open()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', { name: '新しいお客様を登録' }))
    expect(screen.getByRole('heading', { name: 'お客様のことをお伺いします' })).toBeVisible()
  })

  it('登録すると、その方を持って予約へ渡す', async () => {
    const created = detailOf('c0000000-0000-4000-8000-000000000099', {
      name: '新規 太郎',
      kana: 'しんき たろう',
      phone: null,
    })
    stub((url, init) => {
      if (url.pathname === '/api/staff/customers' && init?.method === 'POST') return json(created)
      return null
    })
    open()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', { name: '新しいお客様を登録' }))
    await userEvent.type(screen.getByLabelText('お名前'), '新規 太郎')
    await userEvent.click(screen.getByRole('button', { name: '登録してご予約に進む' }))
    await waitFor(() =>
      expect(onStartBooking).toHaveBeenCalledWith({
        id: created.id,
        name: '新規 太郎',
        kana: 'しんき たろう',
        phone: null,
      }),
    )
  })

  it('「あとで登録する」で一覧へ戻る', async () => {
    stub()
    open()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', { name: '新しいお客様を登録' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'あとで登録する（ウォークインのまま）' }),
    )
    expect(await screen.findAllByRole('option')).toHaveLength(2)
  })
})

describe('手書きメモ（CUSTOMER-HANDWRITE）', () => {
  it('注意ごとの行から開くと、手書きの筆跡を持つメモが並ぶ', async () => {
    stub((url) => {
      if (url.pathname === `/api/staff/customers/${HANAKO_ID}/notes`) return json([ATTENTION_NOTE])
      return null
    })
    open()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    await userEvent.click(screen.getByRole('option', { name: /田中 花子 様/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'くわしく見る' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'くわしく見る' }))
    await userEvent.click(screen.getByRole('button', { name: /手書きメモを見る/ }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '手書きメモ　1枚' })).toBeVisible(),
    )
    // 記入した店舗は `stores` から解決する。
    expect(screen.getAllByText(/EYEX 銀座店/).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: /お客様の詳細へ戻る/ }))
    expect(screen.getByRole('table', { name: '度数の移り変わり' })).toBeInTheDocument()
  })
})

describe('おまとめ（CUSTOMER-MERGE）', () => {
  const ICHIRO_DETAIL = detailOf(ICHIRO_ID, {
    name: '田中 一郎',
    kana: '',
    customerNumber: 'G-02180',
    notes: [],
  })

  function withDuplicate(previewStatus: number): Handler {
    return (url, init) => {
      if (url.pathname === '/api/staff/customers/lookup') {
        return json([
          {
            customer: HANAKO,
            match: 'strong',
            lastVisitAt: null,
            currentPrescription: null,
            lastStaffName: null,
            attentionSummary: '',
          },
          {
            customer: { ...HANAKO, id: ICHIRO_ID, name: '田中 一郎', customerNumber: 'G-02180' },
            match: 'weak',
            lastVisitAt: null,
            currentPrescription: null,
            lastStaffName: null,
            attentionSummary: '',
          },
        ])
      }
      if (url.pathname === '/api/staff/customers/merge/preview' && init?.method === 'POST') {
        return previewStatus === 200
          ? json({
              fields: [],
              result: HANAKO,
              noteCount: 1,
              losingCustomerNumber: 'G-02180',
            })
          : json({ error: 'forbidden' }, previewStatus)
      }
      if (url.pathname === `/api/staff/customers/${ICHIRO_ID}`) return json(ICHIRO_DETAIL)
      return null
    }
  }

  it('店長のときだけ入口が出て、開くと見比べ表が出る', async () => {
    stub(withDuplicate(200))
    open()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    await userEvent.click(screen.getByRole('option', { name: /田中 花子 様/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'くわしく見る' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'くわしく見る' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'おまとめ' })).toBeVisible())

    await userEvent.click(screen.getByRole('button', { name: 'おまとめ' }))
    await waitFor(() =>
      expect(screen.getByText('田中 花子 様 が ふたつ登録されています')).toBeVisible(),
    )
  })

  it('店長でないとき（下見が403）は、入口がどこにも出ない', async () => {
    stub(withDuplicate(403))
    open()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    await userEvent.click(screen.getByRole('option', { name: /田中 花子 様/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'くわしく見る' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'くわしく見る' }))
    await waitFor(() =>
      expect(screen.getByRole('table', { name: '度数の移り変わり' })).toBeVisible(),
    )
    expect(screen.queryByRole('button', { name: 'おまとめ' })).not.toBeInTheDocument()
  })

  it('重複が無いお客様には入口が出ない', async () => {
    stub((url) => (url.pathname === '/api/staff/customers/lookup' ? json([]) : null))
    open()
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    await userEvent.click(screen.getByRole('option', { name: /田中 花子 様/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'くわしく見る' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'くわしく見る' }))
    await waitFor(() =>
      expect(screen.getByRole('table', { name: '度数の移り変わり' })).toBeVisible(),
    )
    expect(screen.queryByRole('button', { name: 'おまとめ' })).not.toBeInTheDocument()
  })
})
