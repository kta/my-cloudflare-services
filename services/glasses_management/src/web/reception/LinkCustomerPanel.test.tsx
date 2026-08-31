import type { CustomerCandidate, Walkin } from '@app/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { LinkCustomerPanel } from './LinkCustomerPanel'

/*
 * お客様を特定しないまま受け付けた来店を、あとから結びつける面
 * （AC-RECEP-08「今までのお客様へ」／AC-RECEP-09「新しく登録して」）。
 *
 * この面は承認済みモックに絵が無い。芯は**受付を止めないこと**なので、姿を確かめるのでは
 * なく「受け付けたあとに結び直せるか」「版をいつ読むか」「断られたときに言うか」を見る。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const DATE = '2026-08-27'
const WALKIN_ID = 'a0000000-0000-4000-8000-000000000003'
const HANAKO_ID = 'c0000000-0000-4000-8000-000000000001'

const WALKIN: Walkin = {
  id: WALKIN_ID,
  ticketNo: 3,
  arrivedAt: '2026-08-27T01:50:00.000Z',
  purposeId: null,
  purposeNote: 'フレームの相談',
  customerId: null,
  reservationId: 'b0000000-0000-4000-8000-000000000003',
  status: 'waiting',
  waitedMinutes: 18,
  leftAt: null,
  version: 4,
}

const HANAKO: CustomerCandidate = {
  customer: {
    id: HANAKO_ID,
    customerNumber: 'G-01842',
    name: '田中 花子',
    kana: 'たなか はなこ',
    phone: '09012345678',
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

type Served = { status: number; body: unknown }

let patched: { url: URL; body: unknown }[] = []
let createdCustomers: unknown[] = []
let walkinList: Served
let patchReply: Served
let createReply: Served
let candidates: CustomerCandidate[] = []

const linked = vi.fn()
const closed = vi.fn()

function json(served: Served): Response {
  return new Response(JSON.stringify(served.body), {
    status: served.status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  patched = []
  createdCustomers = []
  candidates = []
  walkinList = { status: 200, body: [WALKIN] }
  patchReply = { status: 200, body: { ...WALKIN, customerId: HANAKO_ID, version: 5 } }
  createReply = { status: 200, body: { id: 'c0000000-0000-4000-8000-0000000000ff' } }
  linked.mockClear()
  closed.mockClear()
  sessionStorage.setItem('app.auth.token', 'header.payload.signature')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://example.test')
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.pathname === '/api/staff/walkins' && method === 'GET') return json(walkinList)
      if (url.pathname.startsWith('/api/staff/walkins/') && method === 'PATCH') {
        patched.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
        return json(patchReply)
      }
      if (url.pathname === '/api/staff/customers/lookup')
        return json({ status: 200, body: candidates })
      if (url.pathname === '/api/staff/customers' && method === 'POST') {
        createdCustomers.push(JSON.parse(String(init?.body ?? '{}')))
        return json(createReply)
      }
      return json({ status: 404, body: { error: 'not_found' } })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

function open() {
  return render(
    <LinkCustomerPanel
      storeId={STORE_ID}
      date={DATE}
      walkinId={WALKIN_ID}
      displayName="ウォークイン 003"
      onLinked={linked}
      onClose={closed}
    />,
  )
}

it('どの行を触っているかを整理番号で言い直す', async () => {
  open()
  await screen.findByText('ウォークイン 003 のご来店です。')
})

it('開いたときは見出しへフォーカスが移る', async () => {
  open()
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'お客様を結びつけます' })).toHaveFocus(),
  )
})

it('電話番号の下 4 桁で出てきたお客様を選ぶと、いまの版で結びつける', async () => {
  candidates = [HANAKO]
  const user = userEvent.setup()
  open()
  await screen.findByRole('textbox', { name: '電話番号で探す（下4桁でも探せます）' })
  await user.type(
    screen.getByRole('textbox', { name: '電話番号で探す（下4桁でも探せます）' }),
    '5678',
  )
  await user.click(await screen.findByRole('button', { name: /田中 花子 様/ }))

  await waitFor(() => expect(linked).toHaveBeenCalledTimes(1))
  expect(patched).toHaveLength(1)
  // 端末が控えていた版ではなく、開いたときに読み直した版（4）で送る。
  expect(patched[0]?.body).toEqual({ version: 4, customerId: HANAKO_ID })
  expect(patched[0]?.url.pathname).toBe(`/api/staff/walkins/${WALKIN_ID}`)
})

it('お名前を入れて登録すると、新しいお客様を作ってそのまま結びつける', async () => {
  const user = userEvent.setup()
  open()
  await user.type(await screen.findByRole('textbox', { name: 'お名前' }), '受付 太郎')
  await user.type(screen.getByRole('textbox', { name: 'ふりがな' }), 'うけつけ たろう')
  await user.click(screen.getByRole('button', { name: '登録して結びつける' }))

  await waitFor(() => expect(linked).toHaveBeenCalledTimes(1))
  expect(createdCustomers).toEqual([{ name: '受付 太郎', kana: 'うけつけ たろう' }])
  expect(patched[0]?.body).toEqual({
    version: 4,
    customerId: 'c0000000-0000-4000-8000-0000000000ff',
  })
})

it('お名前が空のあいだは登録の主操作を押せない', async () => {
  open()
  await screen.findByRole('textbox', { name: 'お名前' })
  expect(screen.getByRole('button', { name: '登録して結びつける' })).toBeDisabled()
})

it('ほかの端末が先に触っていたら（409）そのことを文で言い、面を閉じない', async () => {
  candidates = [HANAKO]
  patchReply = { status: 409, body: { error: 'version_conflict' } }
  const user = userEvent.setup()
  open()
  await user.type(
    await screen.findByRole('textbox', { name: '電話番号で探す（下4桁でも探せます）' }),
    '5678',
  )
  await user.click(await screen.findByRole('button', { name: /田中 花子 様/ }))

  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent('ほかの端末がこのご来店を触りました')
  expect(linked).not.toHaveBeenCalled()
})

it('そのご来店が見つからないときは理由だけを出し、押せる入力を出さない', async () => {
  walkinList = { status: 200, body: [] }
  open()
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent('このご来店が見つかりませんでした')
  expect(screen.queryByRole('textbox', { name: 'お名前' })).toBeNull()
})

it('Esc で閉じる', async () => {
  const user = userEvent.setup()
  open()
  await screen.findByText('ウォークイン 003 のご来店です。')
  await user.keyboard('{Escape}')
  expect(closed).toHaveBeenCalledTimes(1)
})

it('「やめる」で閉じる', async () => {
  const user = userEvent.setup()
  open()
  await user.click(await screen.findByRole('button', { name: 'やめる' }))
  expect(closed).toHaveBeenCalledTimes(1)
})
