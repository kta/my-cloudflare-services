import type { CustomerCandidate, VisitPurpose, Walkin } from '@app/contracts'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalkinPanel } from './WalkinPanel'

/*
 * 台帳に重なる受付パネル（承認済みモック
 * docs/frontend/mockups/eyex/images/LEDGER-WALKIN.png）。
 *
 * この面の仕事は「台帳を見たまま、店頭のお客様のご用件を 3 タップで伺って受け付ける」こと。
 * **お客様を後回しにできる**ことがこの面の芯なので、「あとで登録する」のまま主操作が押せる。
 * 見た目の寸法は e2e の突き合わせで見るので、ここでは「何が読めて、何が押せるか」を見る。
 *
 * 実測（screens/LEDGER-WALKIN.html の <style> と assets/eyex.css）:
 *   パネルは `position:absolute` の top/right/bottom 0・幅 400px・左罫 1px --line-strong・地は白。
 *   見出し帯 padding 12px 22px（h2 18px ＋ 右に「やめる」min-height 44px / padding 0 10px）・下罫 1px。
 *   本文 padding 22px 22px 0、節の間 24px。足元 padding 20px 22px。
 *   待ち状況の帯 min-height 44px / padding 0 12px / 角 12px / 地 --walkin-tint / 枠 1px --walkin。
 *   ご用件は 2×2（gap 10px）・1 枚 min-height 60px / padding 8px 10px / 角 8px、
 *   見出し 15px/600・所要 12px。選択中は枠 3px --brand ＋ 地 --brand-tint（padding 6px 8px）。
 *   お客様のラベル 13px（下に 10px）＋ 入力 min-height 52px / 16px、丸い札 min-height 44px。
 *   主操作は幅いっぱい・min-height 56px。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'

function purpose(index: number, nameInternal: string, durationMinutes: number): VisitPurpose {
  return {
    id: `e0000000-0000-4000-8000-00000000000${index}`,
    storeId: null,
    nameInternal,
    namePublic: nameInternal,
    nameShort: nameInternal.slice(0, 2),
    durationMinutes,
    isWebPublished: true,
    isActive: true,
    sortOrder: index,
    requirements: [],
    version: 1,
  }
}

/** モックが描いている 4 択（メガネを新しく作る 約60分 …）。 */
const PURPOSES: VisitPurpose[] = [
  purpose(1, 'メガネを新しく作る', 60),
  purpose(2, 'メガネを調整したい', 20),
  purpose(3, 'できあがりを受け取る', 20),
  purpose(4, '視力測定だけ', 30),
]

const HANAKO: CustomerCandidate = {
  customer: {
    id: 'c0000000-0000-4000-8000-000000000001',
    customerNumber: 'G-01842',
    name: '田中 花子',
    kana: 'たなか はなこ',
    phone: '09012341234',
    visitCount: 4,
    lastVisitAt: '2026-05-12',
    memoShort: 'PC作業用',
  },
  match: 'strong',
  lastVisitAt: '2026-05-12',
  currentPrescription: null,
  lastStaffName: null,
  attentionSummary: '',
}

const RECEIVED: Walkin = {
  id: 'a0000000-0000-4000-8000-000000000005',
  ticketNo: 5,
  arrivedAt: '2026-08-27T02:08:00.000Z',
  purposeId: PURPOSES[0]?.id ?? null,
  purposeNote: null,
  customerId: null,
  reservationId: 'b0000000-0000-4000-8000-000000000005',
  status: 'waiting',
  waitedMinutes: 0,
  leftAt: null,
  version: 1,
}

type Served = { status: number; body: unknown }

let posted: unknown[] = []
let lookedUp: URL[] = []
let walkinReply: () => Promise<Served>
let candidates: CustomerCandidate[] = []

function json(served: Served): Response {
  return new Response(JSON.stringify(served.body), {
    status: served.status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  posted = []
  lookedUp = []
  candidates = []
  walkinReply = async () => ({ status: 200, body: RECEIVED })
  received.mockClear()
  closed.mockClear()
  sessionStorage.setItem('app.auth.token', 'header.payload.signature')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://example.test')
      if (url.pathname === '/api/staff/customers/lookup') {
        lookedUp.push(url)
        return json({ status: 200, body: candidates })
      }
      if (url.pathname === '/api/staff/walkins') {
        posted.push(JSON.parse(String(init?.body ?? '{}')))
        return json(await walkinReply())
      }
      return json({ status: 404, body: { error: 'not_found' } })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

const received = vi.fn()
const closed = vi.fn()

/** 台帳側の「店頭のお客様を受け付ける」。閉じたときフォーカスがここへ戻る。 */
function Harness(props: {
  waitingCount?: number
  estimatedWaitMinutes?: number | null
  hasOpenSlot?: boolean
}) {
  const opener = useRef<HTMLButtonElement>(null)
  return (
    <div>
      <button type="button" ref={opener}>
        店頭のお客様を受け付ける
      </button>
      <WalkinPanel
        storeId={STORE_ID}
        purposes={PURPOSES}
        walkinWaitingCount={props.waitingCount ?? 2}
        estimatedWaitMinutes={
          props.estimatedWaitMinutes === undefined ? 15 : props.estimatedWaitMinutes
        }
        nextTicketNo={5}
        hasOpenSlot={props.hasOpenSlot ?? true}
        onReceived={received}
        onClose={closed}
        returnFocusTo={opener}
      />
    </div>
  )
}

function open(props: Parameters<typeof Harness>[0] = {}) {
  render(<Harness {...props} />)
}

const band = () => screen.getByRole('group', { name: 'いまの待ち状況' })
const pick = (name: string | RegExp) => screen.getByRole('button', { name })
const submit = () => screen.getByRole('button', { name: '受付して台帳に載せる' })
const phone = () => screen.getByRole('textbox', { name: /電話番号で探す/ })

describe('受付パネル', () => {
  it('「いまお待ち 2名」「目安 15分」「ウォークイン 005」が 1 行に並ぶ', () => {
    open()
    const line = band()
    expect(within(line).getByText('いまお待ち 2名')).toBeInTheDocument()
    expect(within(line).getByText('目安 15分')).toBeInTheDocument()
    expect(within(line).getByText('ウォークイン 005')).toBeInTheDocument()
  })

  it('目安を出せないときは「いまお待ち 2名」だけを出す', () => {
    open({ estimatedWaitMinutes: null })
    const line = band()
    expect(within(line).getByText('いまお待ち 2名')).toBeInTheDocument()
    expect(within(line).queryByText(/目安/)).toBeNull()
    expect(within(line).getByText('ウォークイン 005')).toBeInTheDocument()
  })

  it('ご用件は 4 択で、選ぶと 1 つだけが選択中になる', async () => {
    open()
    const choices = within(screen.getByRole('group', { name: 'ご用件' })).getAllByRole('button')
    expect(choices).toHaveLength(4)
    await userEvent.click(pick(/メガネを新しく作る/))
    await userEvent.click(pick(/視力測定だけ/))
    expect(pick(/視力測定だけ/)).toHaveAttribute('aria-pressed', 'true')
    expect(pick(/メガネを新しく作る/)).toHaveAttribute('aria-pressed', 'false')
  })

  it('4 択に無いご用件は自由記述として残せる', async () => {
    open()
    await userEvent.click(pick('4 択にないご用件'))
    await userEvent.type(screen.getByRole('textbox', { name: /ご用件を書く/ }), 'フレームの相談')
    await userEvent.click(submit())
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ purposeNote: 'フレームの相談' })
    expect(posted[0]).not.toHaveProperty('purposeId')
  })

  it('ご用件を選ぶまで主操作を押せない', async () => {
    open()
    expect(submit()).toBeDisabled()
    await userEvent.click(pick(/メガネを新しく作る/))
    expect(submit()).toBeEnabled()
  })

  it('お客様は「あとで登録する」のまま受け付けられる', async () => {
    open()
    expect(pick('あとで登録する')).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(pick(/メガネを新しく作る/))
    await userEvent.click(submit())
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).not.toHaveProperty('customerId')
    expect(received).toHaveBeenCalledWith(RECEIVED)
  })

  it('電話番号の下 4 桁で候補を出す', async () => {
    candidates = [HANAKO]
    open()
    await userEvent.type(phone(), '1234')
    expect(await screen.findByRole('button', { name: /田中 花子 様/ })).toBeInTheDocument()
    expect(lookedUp[0]?.searchParams.get('phoneLast4')).toBe('1234')
  })

  it('候補を出しても入力欄からフォーカスを奪わない', async () => {
    candidates = [HANAKO]
    open()
    await userEvent.type(phone(), '1234')
    await screen.findByRole('button', { name: /田中 花子 様/ })
    expect(document.activeElement).toBe(phone())
  })

  it('「受付して台帳に載せる」は 1 回だけ効く（二度押しで 2 件作らない）', async () => {
    const gate: { release: () => void } = { release: () => undefined }
    walkinReply = async () => {
      await new Promise<void>((resolve) => {
        gate.release = resolve
      })
      return { status: 200, body: RECEIVED }
    }
    open()
    await userEvent.click(pick(/メガネを新しく作る/))
    await userEvent.click(submit())
    await waitFor(() => expect(posted).toHaveLength(1))
    await userEvent.click(submit())
    gate.release()
    await waitFor(() => expect(received).toHaveBeenCalledTimes(1))
    expect(posted).toHaveLength(1)
  })

  it('入る枠が無いときは「いまお入れできる枠がありません。お待ちの列に入れます。」を 1 文で出す', () => {
    open({ hasOpenSlot: false })
    expect(
      screen.getByText('いまお入れできる枠がありません。お待ちの列に入れます。'),
    ).toBeInTheDocument()
    expect(screen.getAllByText(/枠がありません/)).toHaveLength(1)
  })

  it('409 slot_taken のときも入力を捨てない', async () => {
    walkinReply = async () => ({ status: 409, body: { error: 'slot_taken' } })
    candidates = []
    open()
    await userEvent.click(pick(/メガネを新しく作る/))
    await userEvent.type(phone(), '1234')
    await userEvent.click(submit())
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ちょうど同じ時間がふさがりました。もう一度お試しください。',
    )
    expect(pick(/メガネを新しく作る/)).toHaveAttribute('aria-pressed', 'true')
    expect(phone()).toHaveValue('1234')
    expect(received).not.toHaveBeenCalled()
  })

  it('開いたときは見出しへフォーカスが移る', () => {
    open()
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: '店頭のお客様を受け付けます' }),
    )
  })

  it('「やめる」で閉じ、開いた要素へフォーカスが戻る', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(closed).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '店頭のお客様を受け付ける' }),
    )
  })
})
