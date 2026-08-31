import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { type ElevateCandidate, PersonalMode } from './PersonalMode'

/*
 * MODE-PERSONAL.png（UC-TERM-07 / AC-TERM-09 / AC-TERM-10）。
 *
 * 共有の端末で責任の残る操作に入るとき、その 1 回だけ本人の暗証番号で個人モードへ上げる。
 * **上げたら元の操作へ戻す**（やり直させない）。**やめても元の画面の入力は消さない**。
 */

const TERMINAL_ID = 'eeeeeeee-ffff-4aaa-8bbb-000000000001'
const MISAKI = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001'
const OFF = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000009'
const SESSION_ID = '99999999-8888-4777-8666-000000000001'
const CORRECT = '2580'

const CANDIDATES: ElevateCandidate[] = [
  { id: MISAKI, name: '佐藤 美咲', job: '視力測定・加工', offToday: false },
  { id: OFF, name: '山田 大輔（店長）', job: '店舗の管理', offToday: true },
]

let posts: unknown[] = []

beforeEach(() => {
  posts = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body: { pin: string; staffId: string; reason: string } = JSON.parse(String(init?.body))
      posts.push({ url: String(input), body })
      if (body.pin !== CORRECT) {
        return new Response(JSON.stringify({ error: 'pin_invalid', remainingAttempts: 2 }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          id: SESSION_ID,
          terminalId: TERMINAL_ID,
          staffId: body.staffId,
          mode: 'personal',
          startedAt: '2026-08-27T02:08:00.000Z',
          expiresAt: '2026-08-27T02:10:00.000Z',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

/** 元の操作（録音の保全）の下書きを持ったまま昇格の面へ入る器。 */
function Harness() {
  const [memo, setMemo] = useState('')
  const [elevating, setElevating] = useState(false)
  const [staffName, setStaffName] = useState<string | null>(null)
  return elevating ? (
    <PersonalMode
      storeName="EYEX 銀座店"
      terminalName="銀座店 レジ横iPad（みんなで使う端末）"
      terminalId={TERMINAL_ID}
      reason="recording"
      staff={CANDIDATES}
      onElevated={(session, name) => {
        setStaffName(name)
        setElevating(false)
        expect(session.mode).toBe('personal')
      }}
      onCancel={() => setElevating(false)}
    />
  ) : (
    <div>
      <h1>録音の保全</h1>
      {staffName !== null && <p>{`いまの担当　${staffName}`}</p>}
      <label htmlFor="memo">メモ</label>
      <textarea id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
      <button type="button" onClick={() => setElevating(true)}>
        この録音を保全する
      </button>
    </div>
  )
}

async function elevate() {
  const user = userEvent.setup()
  render(<Harness />)
  await user.type(screen.getByLabelText('メモ'), 'レンズの相談')
  await user.click(screen.getByRole('button', { name: 'この録音を保全する' }))
  return user
}

it('「録音の保全にはご本人の確認が必要です」と「操作するスタッフを選んでください。」が出る', async () => {
  await elevate()
  expect(
    screen.getByRole('heading', { name: '録音の保全にはご本人の確認が必要です' }),
  ).toBeInTheDocument()
  expect(screen.getByText('操作するスタッフを選んでください。')).toBeInTheDocument()
})

it('上のバーに「いまは共有モード」の札が出る', async () => {
  await elevate()
  expect(screen.getByText('いまは共有モード')).toBeInTheDocument()
})

it('本日休みのスタッフは押せない', async () => {
  await elevate()
  expect(screen.getByRole('button', { name: /山田 大輔（店長）/ })).toBeDisabled()
  expect(screen.getByText(/本日休み/)).toBeInTheDocument()
})

it('4 桁入れて確定すると元の操作の画面へ戻り、「いまは共有モード」が消える', async () => {
  const user = await elevate()
  await user.click(screen.getByRole('button', { name: /佐藤 美咲/ }))
  for (const digit of CORRECT) await user.click(screen.getByRole('button', { name: digit }))
  await user.click(screen.getByRole('button', { name: '確定' }))
  expect(await screen.findByText(/いまの担当\s*佐藤 美咲/)).toBeInTheDocument()
  expect(screen.queryByText('いまは共有モード')).not.toBeInTheDocument()
  expect(screen.getByLabelText('メモ')).toHaveValue('レンズの相談')
  expect(posts).toHaveLength(1)
})

it('「やめて台帳に戻る」で昇格をやめても、元の画面の入力は消えない', async () => {
  const user = await elevate()
  await user.click(screen.getByRole('button', { name: 'やめて台帳に戻る' }))
  expect(screen.getByLabelText('メモ')).toHaveValue('レンズの相談')
  expect(posts).toHaveLength(0)
})
