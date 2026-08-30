import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORE_ID, staffView } from '../ledger/fixtures'
import { MyReservations } from './MyReservations'

/*
 * 個人端末のトップの「本日わたしが担当するご予約」
 * （承認済みモック docs/frontend/mockups/eyex/images/HOME-PERSONAL.png の右の一覧）。
 *
 * 「わたし」は JWT の `sub` と `staff.adminUserId` を突き合わせて引き当てる。
 * **誰にも当たらない端末（共有端末）にはこの面を出さない**。
 */

const SATO = 'b0000000-0000-4000-8000-000000000001'
const ME = 'dev:eyex'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** dev グラントが載せる `sub` だけを持つ、署名を確かめない見せかけの JWT。 */
function devToken(sub: string): string {
  return `header.${btoa(JSON.stringify({ sub, org: 'eyex' }))}.signature`
}

function staffRow(id: string, displayName: string, adminUserId: string | null) {
  return {
    id,
    displayName,
    kana: null,
    jobLabel: null,
    role: 'staff',
    isActive: true,
    sortOrder: 0,
    skills: [],
    adminUserId,
    hasPin: false,
    maxParallelReservations: 1,
    pinUpdatedAt: null,
  }
}

/** 名簿と台帳の 2 本を返す。`me` に null を渡すと誰とも結びついていない端末になる。 */
function stub(me: string | null, lanes = staffView().lanes) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://example.test')
      if (url.pathname.endsWith('/staff')) {
        return json([staffRow(SATO, '佐藤 美咲', me), staffRow('x', '高橋 健', null)])
      }
      return json({ ...staffView(), lanes })
    }),
  )
}

const open = () =>
  render(<MyReservations storeId={STORE_ID} onOpen={vi.fn()} onOpenLedger={vi.fn()} />)

beforeEach(() => {
  sessionStorage.setItem('app.auth.token', devToken(ME))
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('本日わたしが担当するご予約', () => {
  it('見出しは「本日わたしが担当するご予約」で、件数が行数と一致する', async () => {
    stub(ME)
    open()
    const list = await screen.findByRole('list')
    expect(screen.getByRole('region', { name: '本日わたしが担当するご予約' })).toBeInTheDocument()
    expect(screen.getByRole('heading')).toHaveTextContent('本日わたしが担当するご予約2件')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('時刻・ご用件・状態が時間順に並ぶ', async () => {
    stub(ME)
    open()
    const rows = await screen.findAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('11:00')
    expect(rows[0]).toHaveTextContent('新調相談・視力測定')
    expect(rows[0]).toHaveTextContent('ご予約')
    expect(rows[1]).toHaveTextContent('14:00')
  })

  it('状態は「ご予約」だけでなく「ご案内中」も出る', async () => {
    // 状態の語は 6 つあるが、seed の当日は confirmed と arrived しか作れないので、
    // 応答が `serving` を返したときに「ご案内中」が出ることを誰も読んでいなかった。
    const lanes = staffView().lanes.map((lane, index) =>
      index === 0
        ? {
            ...lane,
            entries: lane.entries.map((entry, position) =>
              position === 0 ? { ...entry, status: 'serving' as const } : entry,
            ),
          }
        : lane,
    )
    stub(ME, lanes)
    open()
    const rows = await screen.findAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('ご案内中')
    expect(rows[1]).toHaveTextContent('ご予約')
  })

  it('1 行を押すと、その予約の id を器へ渡す（台帳のその帯の詳細が開く）', async () => {
    stub(ME)
    const onOpen = vi.fn()
    render(<MyReservations storeId={STORE_ID} onOpen={onOpen} onOpenLedger={vi.fn()} />)
    const rows = await screen.findAllByRole('listitem')
    await userEvent.click(within(rows[0] as HTMLElement).getByRole('button'))
    expect(onOpen).toHaveBeenCalledWith('a0000000-0000-4000-8000-000000000003')
  })

  it('0 件の日は事実 1 行となぜ空かの 1 行と「店全体の台帳を見る」を出す', async () => {
    stub(ME, [])
    const onOpenLedger = vi.fn()
    render(<MyReservations storeId={STORE_ID} onOpen={vi.fn()} onOpenLedger={onOpenLedger} />)
    expect(await screen.findByText('本日ご担当のご予約はありません。')).toBeInTheDocument()
    expect(
      screen.getByText('本日はお休みか、まだ 1 件も割り当てられていません。'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '店全体の台帳を見る' }))
    expect(onOpenLedger).toHaveBeenCalledOnce()
  })

  it('わたしが誰か分からない端末（共有端末）にはこの面を出さない', async () => {
    stub(null)
    const { container } = open()
    // 名簿と台帳が届いても、わたしに当たる行が無ければ 1 つも要素を描かない。
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('名簿も台帳も読めなかった端末には何も出さない（トップを壊さない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'not_found' }, 404)),
    )
    const { container } = open()
    expect(container).toBeEmptyDOMElement()
  })
})
