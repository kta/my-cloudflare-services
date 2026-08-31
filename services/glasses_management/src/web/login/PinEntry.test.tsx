import type { TerminalSession } from '@app/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { terminalNote } from '../terminal/terminalState'
import { PinEntry, type PinSubject } from './PinEntry'

/*
 * 承認済みモック LOGIN-STAFF-PIN.png / LOGIN-PIN-ERROR.png / LOGIN-SHARED-PIN.png の面
 * （UC-TERM-03 / 04 / 06、AC-TERM-03 / 05 / 06 / 07 / 19 / 20）。
 *
 * **平文の暗証番号を DOM に出さない**ことも、ここで固定する。
 */

const TERMINAL_ID = 'eeeeeeee-ffff-4aaa-8bbb-000000000001'
const STAFF_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001'
const SESSION_ID = '99999999-8888-4777-8666-000000000001'
const CORRECT = '2580'

const PERSONAL: PinSubject = {
  kind: 'personal',
  staffId: STAFF_ID,
  name: '佐藤 美咲',
  note: '視力測定・加工　／　本日の勤務 10:00–19:00',
}
const SHARED: PinSubject = {
  kind: 'shared',
  name: '銀座店 レジ横iPad',
  note: '設置場所　レジの右側　／　みんなで使う端末',
}

/** サーバ（KV・30 秒）が数える連続失敗。3 回目で 429 に変わる。 */
let failures = 0
let posts: unknown[] = []

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  failures = 0
  posts = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body: { mode: string; pin: string; staffId?: string } = JSON.parse(String(init?.body))
      posts.push({ url: String(input), body })
      if (body.pin === CORRECT) {
        return json(
          {
            id: SESSION_ID,
            terminalId: TERMINAL_ID,
            staffId: body.mode === 'personal' ? STAFF_ID : null,
            mode: body.mode,
            startedAt: '2026-08-27T00:41:00.000Z',
            expiresAt: '2026-08-27T00:43:00.000Z',
          },
          201,
        )
      }
      failures += 1
      if (failures >= 3) {
        return json({ error: 'pin_locked', retryAfterSeconds: 30, remainingAttempts: 0 }, 429)
      }
      return json({ error: 'pin_invalid', remainingAttempts: 3 - failures }, 401)
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function open(subject: PinSubject) {
  const onStarted = vi.fn<(session: TerminalSession) => void>()
  const onBack = vi.fn()
  const view = render(
    <PinEntry
      storeName="EYEX 銀座店"
      terminalId={TERMINAL_ID}
      subject={subject}
      onStarted={onStarted}
      onBack={onBack}
      onQuit={vi.fn()}
    />,
  )
  return { onStarted, onBack, view }
}

async function type(text: string) {
  for (const ch of text) await userEvent.click(screen.getByRole('button', { name: ch }))
}

describe('暗証番号（個人）', () => {
  it('左に誰の番号かを名前・技能・本日の勤務で出す', () => {
    open(PERSONAL)
    const who = screen.getByRole('region', { name: 'この暗証番号の持ち主' })
    expect(within(who).getByText('佐藤 美咲')).toBeInTheDocument()
    expect(
      within(who).getByText(/視力測定・加工\s+／\s+本日の勤務 10:00–19:00/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '4〜6桁の暗証番号を入力してください' }),
    ).toBeInTheDocument()
  })

  it('3 桁では確定を押せず、4 桁目で押せるようになる', async () => {
    open(PERSONAL)
    await type('258')
    const confirm = screen.getByRole('button', { name: '確定' })
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAccessibleDescription('あと1桁で「確定」を押せます')
    await type('0')
    expect(screen.getByRole('button', { name: '確定' })).toBeEnabled()
  })

  it('確定すると業務が始まり、左の柱の下に「佐藤 美咲の iPad」と「個人で使っています」が出る', async () => {
    const { onStarted } = open(PERSONAL)
    await type(CORRECT)
    await userEvent.click(screen.getByRole('button', { name: '確定' }))
    expect(onStarted).toHaveBeenCalledTimes(1)
    const session = onStarted.mock.calls[0]?.[0]
    if (session === undefined) throw new Error('セッションが渡らなかった')
    expect(session).toMatchObject({ id: SESSION_ID, mode: 'personal', staffId: STAFF_ID })
    expect(
      terminalNote({
        terminalId: TERMINAL_ID,
        terminalName: '銀座店 個人の端末',
        mode: 'personal',
        staffId: STAFF_ID,
        staffName: '佐藤 美咲',
        sessionId: session.id,
        autoLockSeconds: 120,
      }),
    ).toEqual(['佐藤 美咲の iPad', '個人で使っています'])
  })

  it('「別のスタッフを選ぶ」で選び直せる', async () => {
    const { onBack } = open(PERSONAL)
    await userEvent.click(screen.getByRole('button', { name: '別のスタッフを選ぶ' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('暗証番号の誤り', () => {
  async function failOnce() {
    await type('1111')
    await userEvent.click(screen.getByRole('button', { name: '確定' }))
  }

  it('「暗証番号が違います。あと2回お試しいただけます」と「3回続くと、30秒お待ちいただきます。」が出る', async () => {
    open(PERSONAL)
    await failOnce()
    expect(
      await screen.findByRole('heading', {
        name: '暗証番号が違います。あと2回お試しいただけます',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('3回続くと、30秒お待ちいただきます。')).toBeInTheDocument()
  })

  it('入力欄は空になり、残り回数が目盛りと文字の両方で出る', async () => {
    open(PERSONAL)
    await failOnce()
    expect(
      await screen.findByRole('group', { name: /暗証番号\s+はじめから打ち直してください/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '残り2回お試しいただけます' })).toBeInTheDocument()
  })

  it('「店長に暗証番号の再設定を頼む」と「別のスタッフを選ぶ」が同じ画面にある', async () => {
    open(PERSONAL)
    await failOnce()
    const ask = await screen.findByRole('button', { name: '店長に暗証番号の再設定を頼む' })
    expect(screen.getByRole('button', { name: '別のスタッフを選ぶ' })).toBeInTheDocument()
    await userEvent.click(ask)
    expect(
      screen.getByText('店長に、「設定 › スタッフ」から暗証番号を作り直してもらってください。'),
    ).toBeInTheDocument()
  })

  it('3 回目の誤りで 30 秒待つことが文字で出て、その間は確定を押しても業務が始まらない', async () => {
    const { onStarted } = open(PERSONAL)
    await failOnce()
    await failOnce()
    await failOnce()
    expect(
      await screen.findByRole('heading', { name: '暗証番号を3回続けて間違えました' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'あと30秒お待ちください。そのあと、もう一度お試しいただけます。',
    )
    const before = posts.length
    await type(CORRECT)
    const confirm = screen.getByRole('button', { name: '確定' })
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAccessibleDescription('あと30秒お待ちください')
    await userEvent.click(confirm)
    expect(posts).toHaveLength(before)
    expect(onStarted).not.toHaveBeenCalled()
  })
})

describe('暗証番号（共有）', () => {
  it('「個人を選ばずにできる」と「ご本人の確認が必要」の 2 群がそれぞれ 3 語ずつ出る', () => {
    open(SHARED)
    const alone = screen.getByRole('list', { name: '個人を選ばずにできる' })
    const needsMe = screen.getByRole('list', { name: 'ご本人の確認が必要' })
    expect(
      within(alone)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['予約を受ける', '台帳を見る', 'ご来店を受け付ける'])
    expect(
      within(needsMe)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['録音の保全', '注意ごとの公開', '設定の変更'])
  })

  it('確定すると左の柱の下に「銀座店 レジ横iPad」と「共有で使っています」が出る', async () => {
    const { onStarted } = open(SHARED)
    await type(CORRECT)
    await userEvent.click(screen.getByRole('button', { name: '確定' }))
    expect(onStarted).toHaveBeenCalledTimes(1)
    const session = onStarted.mock.calls[0]?.[0]
    if (session === undefined) throw new Error('セッションが渡らなかった')
    expect(session).toMatchObject({ mode: 'shared', staffId: null })
    expect(
      terminalNote({
        terminalId: TERMINAL_ID,
        terminalName: '銀座店 レジ横iPad',
        mode: 'shared',
        staffId: null,
        staffName: null,
        sessionId: session.id,
        autoLockSeconds: 120,
      }),
    ).toEqual(['銀座店 レジ横iPad', '共有で使っています'])
  })
})

describe('すべての面', () => {
  it('入力欄はすべて autocomplete="off" を持つ', async () => {
    const { view } = open(SHARED)
    await type('25')
    // 暗証番号の面は `<input>` を 1 つも置かない（平文が DOM に載らない）。
    // 置くことになったときのために、ここで `autocomplete` を要求しておく。
    const inputs = [...view.container.querySelectorAll('input, textarea')]
    expect(inputs.every((el) => el.getAttribute('autocomplete') === 'off')).toBe(true)
    expect(view.container.textContent).not.toContain('25')
  })
})
