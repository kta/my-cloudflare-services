import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closedView, resourceView, STORE_ID, staffView } from './fixtures'
import { LedgerScreen } from './LedgerScreen'

/*
 * 予約台帳の器（承認済みモック docs/frontend/mockups/eyex/images/LEDGER-STAFF.png）。
 * 日付の帯（‹ ／ 2026年8月27日（木） ／ › ／ 本日）と、並べ方・表示のかたちの
 * 2 つのセグメント、現在時刻の札を持つ。
 *
 * 現在時刻は**応答の serverNow だけ**から出す。端末の時計は「最初にどの日を尋ねるか」の
 * 初期値にしか使わない。
 */

let asked: URL[] = []
/** 通信が生きているときの応答。落として戻す試験でもう一度これを据える。 */
let serve: (input: RequestInfo | URL) => Promise<Response>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  asked = []
  sessionStorage.setItem('app.auth.token', devToken('dev:eyex'))
  serve = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://example.test')
    asked.push(url)
    const date = url.searchParams.get('date') ?? '2026-08-27'
    const axis = url.searchParams.get('axis') ?? 'staff'
    const view = url.searchParams.get('view') ?? 'timetable'
    if (date === '2026-09-01') return json(closedView(date))
    const body = axis === 'resource' ? resourceView() : staffView()
    return json({ ...body, date, axis, view })
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => serve(input)),
  )
})

/** 台帳の取り直しだけを落とす（ほかの読み出しは通る）。 */
function cutTheLine(): void {
  serve = async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/staff/ledger')) throw new Error('offline')
    return json([])
  }
}

const ledgerCalls = () => asked.filter((url) => url.pathname === '/api/staff/ledger').length

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

/** dev グラントが載せる `sub` だけを持つ、署名を確かめない見せかけの JWT。 */
function devToken(sub: string): string {
  return `header.${btoa(JSON.stringify({ sub, org: 'eyex' }))}.signature`
}

async function openLedger(date = '2026-08-27') {
  render(<LedgerScreen storeId={STORE_ID} initialDate={date} />)
  await screen.findByRole('button', { name: '本日' })
}

describe('日付の帯', () => {
  it('上のバーに「2026年8月27日（木）」が出て、左右に ‹ と › と「本日」が並ぶ', async () => {
    await openLedger()
    expect(screen.getByText('2026年8月27日（木）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '前の日' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '次の日' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本日' })).toBeInTheDocument()
  })

  it('› を押すと日付が「2026年8月28日（金）」になり、並べ方と表示のかたちが保たれる', async () => {
    await openLedger()
    await userEvent.click(screen.getByRole('button', { name: '次の日' }))
    expect(await screen.findByText('2026年8月28日（金）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '担当者' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'タイムテーブル' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(asked.at(-1)?.searchParams.get('date')).toBe('2026-08-28')
  })

  it('本日でない日を出している間は現在時刻の線と「現在 11:08」の札を出さない', async () => {
    const { container } = render(<LedgerScreen storeId={STORE_ID} initialDate="2026-08-27" />)
    await screen.findByRole('button', { name: '本日' })
    await userEvent.click(screen.getByRole('button', { name: '次の日' }))
    await screen.findByText('2026年8月28日（金）')
    expect(screen.queryByText('現在 11:08')).not.toBeInTheDocument()
    expect(container.querySelector('[data-ledger-nowline]')).toBeNull()
  })

  it('「本日」を押すと 2026年8月27日（木）へ戻り、線と札が戻る', async () => {
    const { container } = render(<LedgerScreen storeId={STORE_ID} initialDate="2026-08-27" />)
    await screen.findByRole('button', { name: '本日' })
    await userEvent.click(screen.getByRole('button', { name: '次の日' }))
    await screen.findByText('2026年8月28日（金）')
    await userEvent.click(screen.getByRole('button', { name: '本日' }))
    expect(await screen.findByText('2026年8月27日（木）')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('現在 11:08')
    expect(container.querySelector('[data-ledger-nowline]')).toHaveStyle({ left: '16.19%' })
  })

  it('‹ と › と「本日」は押せる大きさが 44pt 以上ある', async () => {
    await openLedger()
    for (const name of ['前の日', '次の日', '本日']) {
      expect(screen.getByRole('button', { name }).className).toMatch(/min-h-11/)
    }
  })
})

describe('並べ方と表示のかたち', () => {
  it('2 つのセグメントは別々の指定として並ぶ', async () => {
    await openLedger()
    expect(screen.getByRole('group', { name: '台帳の並べ方' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '表示のかたち' })).toBeInTheDocument()
  })

  it('並べ方を「設備・場所」にすると縦軸が設備の行に入れ替わり、日付と表示のかたちは保たれる', async () => {
    await openLedger()
    await userEvent.click(screen.getByRole('button', { name: '設備・場所' }))
    expect(await screen.findByRole('rowheader', { name: /視力測定機 A/ })).toBeInTheDocument()
    expect(screen.getByText('2026年8月27日（木）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'タイムテーブル' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(asked.at(-1)?.searchParams.get('axis')).toBe('resource')
  })

  it('表示のかたちを「予約リスト」にしても日付と並べ方は保たれる', async () => {
    await openLedger()
    await userEvent.click(screen.getByRole('button', { name: '予約リスト' }))
    expect(await screen.findByRole('button', { name: 'すべて 10件' })).toBeInTheDocument()
    expect(screen.getByText('2026年8月27日（木）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '担当者' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('現在時刻の札', () => {
  it('札は role=status で「現在 11:08」と読める', async () => {
    await openLedger()
    expect(screen.getByRole('status')).toHaveTextContent('現在 11:08')
  })

  it('端末の時計を 1 時間進めても札の時刻は動かない', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-08-27T03:08:00.000Z'))
    try {
      await openLedger()
      expect(screen.getByRole('status')).toHaveTextContent('現在 11:08')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('定休日と読み込み', () => {
  it('定休日は「9月1日（火）は定休日です。」と「本日」を出す', async () => {
    await openLedger('2026-09-01')
    expect(screen.getByText('9月1日（火）は定休日です。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本日' })).toBeInTheDocument()
  })

  it('読み込んでいる間は台帳のかわりに「読み込んでいます…」を出す', () => {
    render(<LedgerScreen storeId={STORE_ID} initialDate="2026-08-27" />)
    expect(screen.getByText('読み込んでいます…')).toBeInTheDocument()
  })

  it('この店舗を見る権限が無いときは、やり直す道を出さずに理由だけを出す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'forbidden' }, 403)),
    )
    render(<LedgerScreen storeId={STORE_ID} initialDate="2026-08-27" />)
    expect(
      await screen.findByText('このお店の予約台帳を見る権限がありません。'),
    ).toBeInTheDocument()
    // やり直しても結果は同じなので、やり直す道を置かない。
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).not.toBeInTheDocument()
  })

  it('業務の期限が切れたら通信断のふりをせず、外へ知らせて事実を出す', async () => {
    // 401 を通信断として扱うと、通信は生きているのに「再接続を試す」を押し続ける
    // 行き止まりになる。やり直しても同じ 401 なので、やり直す道を置かない。
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'unauthorized' }, 401)),
    )
    const onSessionExpired = vi.fn()
    render(
      <LedgerScreen
        storeId={STORE_ID}
        initialDate="2026-08-27"
        onSessionExpired={onSessionExpired}
      />,
    )
    expect(await screen.findByText('業務の時間が切れました。')).toBeInTheDocument()
    expect(screen.queryByText('通信が切れています')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '再接続を試す' })).not.toBeInTheDocument()
    expect(onSessionExpired).toHaveBeenCalled()
  })

  it('読み込めなかったときは事実とやり直しの道を 1 つ出す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'not_found' }, 404)),
    )
    render(<LedgerScreen storeId={STORE_ID} initialDate="2026-08-27" />)
    expect(
      await screen.findByText('台帳を読み込めませんでした。もう一度お試しください。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeInTheDocument()
  })
})

describe('通信が切れたとき', () => {
  it('タイムテーブルのまま切れても、時間順のリストとして読める状態に寄せる', async () => {
    await openLedger()
    expect(await screen.findByRole('grid', { name: '予約台帳' })).toBeInTheDocument()

    cutTheLine()
    await userEvent.click(screen.getByRole('button', { name: '次の日' }))

    expect(await screen.findByText('通信が切れています')).toBeInTheDocument()
    // AC-LEDGER-18・IDX-LEDGER-09 主フロー 4。切れた瞬間の見た目のまま残さない。
    expect(await screen.findByRole('table', { name: '本日のご予約' })).toBeInTheDocument()
    expect(screen.queryByRole('grid', { name: '予約台帳' })).not.toBeInTheDocument()
    // 届いていない日を出しているふりをしない。
    expect(screen.getByText('2026年8月27日（木）')).toBeInTheDocument()
  })

  it('「現在 11:08」の札を出さず、いつ時点かは帯の 1 か所だけで言う', async () => {
    await openLedger()
    cutTheLine()
    await userEvent.click(screen.getByRole('button', { name: '次の日' }))

    expect(await screen.findByText('通信が切れています')).toBeInTheDocument()
    expect(screen.queryByText('現在 11:08')).not.toBeInTheDocument()
    expect(screen.getByText('11:08 現在')).toBeInTheDocument()
  })

  it('次に自動で試す時刻を帯に添える（最後に読めた時刻の 60 秒あと）', async () => {
    await openLedger()
    cutTheLine()
    await userEvent.click(screen.getByRole('button', { name: '次の日' }))

    expect(await screen.findByText('11:09 に自動でも試します')).toBeInTheDocument()
  })

  it('通信が戻ると帯が消えて、新しい台帳に入れ替わる', async () => {
    const good = serve
    await openLedger()
    cutTheLine()
    await userEvent.click(screen.getByRole('button', { name: '次の日' }))
    expect(await screen.findByText('通信が切れています')).toBeInTheDocument()

    serve = good
    await userEvent.click(screen.getByRole('button', { name: '再接続を試す' }))
    await waitFor(() => expect(screen.queryByText('通信が切れています')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('現在 11:08')
  })
})

describe('自動の取り直し', () => {
  it('60 秒ごとに台帳を取り直す（開いたままの iPad の線と札が朝で止まらない）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<LedgerScreen storeId={STORE_ID} initialDate="2026-08-27" />)
      await screen.findByRole('button', { name: '本日' })
      const before = ledgerCalls()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(ledgerCalls()).toBe(before + 1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('店頭のお客様の受付パネル', () => {
  it('閉じたら台帳へフォーカスが戻る（body へ落とさない）', async () => {
    const user = userEvent.setup()
    const ledger = serve
    serve = async (input) =>
      new URL(String(input), 'https://example.test').pathname === '/api/staff/purposes'
        ? json([])
        : ledger(input)
    render(<LedgerScreen storeId={STORE_ID} initialDate="2026-08-27" initialWalkinOpen />)
    const panel = await screen.findByRole('complementary', { name: '店頭のお客様の受け付け' })
    expect(panel).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'やめる' }))
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: '店頭のお客様の受け付け' })).toBeNull(),
    )
    // 受付パネルは来店受付ボードから開くので、この面に開いた要素が無い。
    // それでも body へ落とさず、台帳そのものへ焦点を返す。
    expect(document.activeElement).not.toBe(document.body)
  })
})
