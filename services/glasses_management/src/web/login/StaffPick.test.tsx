import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StaffPick } from './StaffPick'

/*
 * 承認済みモック docs/frontend/mockups/eyex/images/LOGIN-STAFF.png の面
 * （UC-TERM-02 / AC-TERM-02）。世界観データは銀座店の 6 人。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const TODAY = '2026-08-27'
const id = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, '0')}`

type Member = {
  id: string
  displayName: string
  jobLabel: string
  role: 'staff' | 'manager'
  isActive: boolean
  sortOrder: number
}

const MEMBERS: Member[] = [
  {
    id: id(1),
    displayName: '佐藤 美咲',
    jobLabel: '視力測定・加工',
    role: 'staff',
    isActive: true,
    sortOrder: 0,
  },
  {
    id: id(2),
    displayName: '高橋 健',
    jobLabel: 'フィッティング',
    role: 'staff',
    isActive: true,
    sortOrder: 1,
  },
  {
    id: id(3),
    displayName: '中村 彩',
    jobLabel: '販売・受付',
    role: 'staff',
    isActive: true,
    sortOrder: 2,
  },
  {
    id: id(4),
    displayName: '小林 学',
    jobLabel: '視力測定',
    role: 'staff',
    isActive: true,
    sortOrder: 3,
  },
  {
    id: id(5),
    displayName: '渡辺 由紀',
    jobLabel: '販売',
    role: 'staff',
    isActive: true,
    sortOrder: 4,
  },
  {
    id: id(6),
    displayName: '山田 大輔（店長）',
    jobLabel: '店舗の管理',
    role: 'manager',
    isActive: true,
    sortOrder: 5,
  },
  {
    id: id(7),
    displayName: '辞めた人',
    jobLabel: '販売',
    role: 'staff',
    isActive: false,
    sortOrder: 6,
  },
]

/** 山田（店長）だけ本日休み＝勤務の行が 1 本も無い。 */
const SHIFTS = [
  { staffId: id(1), startsAt: '10:00', endsAt: '19:00' },
  { staffId: id(2), startsAt: '10:00', endsAt: '19:00' },
  { staffId: id(3), startsAt: '10:00', endsAt: '16:00' },
  { staffId: id(4), startsAt: '13:00', endsAt: '19:00' },
  { staffId: id(5), startsAt: '10:00', endsAt: '19:00' },
].map((row, index) => ({ id: id(100 + index), date: TODAY, kind: 'work' as const, ...row }))

let members: Member[] = []
let urls: string[] = []

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  members = MEMBERS
  urls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('staff-shifts')) return json(SHIFTS)
      if (url.includes('/staff')) {
        return json(
          members.map((member) => ({
            ...member,
            kana: null,
            skills: [],
            adminUserId: null,
            hasPin: true,
            maxParallelReservations: 1,
            pinUpdatedAt: null,
          })),
        )
      }
      return new Response('not found', { status: 404 })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function open(onPick = vi.fn(), onShared = vi.fn()) {
  render(
    <StaffPick
      storeId={STORE_ID}
      storeName="EYEX 銀座店"
      today={TODAY}
      onPick={onPick}
      onShared={onShared}
      onQuit={vi.fn()}
    />,
  )
  return { onPick, onShared }
}

describe('スタッフを選ぶ', () => {
  it('「業務を始めるスタッフを選んでください」と「選んだ方の名前が、この日の記録に残ります。」が出る', async () => {
    open()
    expect(
      await screen.findByRole('heading', { name: '業務を始めるスタッフを選んでください' }),
    ).toBeInTheDocument()
    expect(screen.getByText('選んだ方の名前が、この日の記録に残ります。')).toBeInTheDocument()
  })

  it('本日休みのスタッフは押せず、「本日休み」と文字でも示される', async () => {
    const { onPick } = open()
    const off = await screen.findByRole('button', { name: /山田 大輔（店長）/ })
    expect(off).toBeDisabled()
    expect(off).toHaveTextContent('本日休み')
    await userEvent.click(off)
    expect(onPick).not.toHaveBeenCalled()

    const working = screen.getByRole('button', { name: /佐藤 美咲/ })
    expect(working).toBeEnabled()
    expect(working).toHaveTextContent('10:00–19:00')
    await userEvent.click(working)
    expect(onPick).toHaveBeenCalledWith({
      id: id(1),
      name: '佐藤 美咲',
      note: '視力測定・加工　／　本日の勤務 10:00–19:00',
    })
  })

  it('選択中店舗のスタッフだけが並ぶ', async () => {
    open()
    await screen.findByRole('button', { name: /佐藤 美咲/ })
    // 使えなくしたスタッフは並べない。問い合わせ先も選択中の店舗に閉じている。
    expect(screen.queryByText('辞めた人')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(urls.every((url) => url.includes(STORE_ID))).toBe(true)
  })

  it('有効なスタッフが 0 人なら、設定で足す案内と「みんなで使う端末にする」を出して行き止まりにしない', async () => {
    members = []
    const { onShared } = open()
    expect(
      await screen.findByRole('heading', { name: 'この店舗には、まだ使えるスタッフがいません' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/「設定 › スタッフ」でスタッフを足すと/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'みんなで使う端末にする' }))
    expect(onShared).toHaveBeenCalledTimes(1)
  })
})
