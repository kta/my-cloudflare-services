import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionWall } from './PermissionWall'

/*
 * 承認済みモック docs/frontend/mockups/eyex/images/EX-PERMISSION.png。
 *
 * 断るときに**打ちかけの下書きを捨てない**ことと、店長がその場にいるなら
 * 暗証番号で続けられることを見る。「この下書きを店長に依頼する」は出さない
 * （依頼を立てる `AlertCode` が許可リストに無い。押せて何も起きないボタンを置かない）。
 */

const TERMINAL_ID = '11111111-2222-4333-8444-555555555555'
const MANAGER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001'
const CHANGES = ['8月30日（日）を臨時休業にする', '8月31日（月）の開店を 10:00 から 11:00 に変える']

let elevateStatus: number
let sent: unknown

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  elevateStatus = 201
  sent = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== `/api/staff/terminals/${TERMINAL_ID}/elevate`) {
        return json({ error: 'not_found' }, 404)
      }
      sent = init?.body === undefined ? null : JSON.parse(String(init.body))
      if (elevateStatus !== 201) return json({ error: 'pin_invalid', remainingAttempts: 2 }, 401)
      return json(
        {
          id: 'bbbbbbbb-cccc-4ddd-8eee-000000000002',
          terminalId: TERMINAL_ID,
          staffId: MANAGER_ID,
          mode: 'personal',
          startedAt: '2026-08-27T02:07:00.000Z',
          expiresAt: '2026-08-27T02:09:00.000Z',
        },
        201,
      )
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function open(changes: readonly string[] = CHANGES) {
  const onElevated = vi.fn()
  const onBack = vi.fn()
  render(
    <PermissionWall
      terminalId={TERMINAL_ID}
      managerStaffId={MANAGER_ID}
      target="営業時間・定休日"
      permission="設定の変更"
      actor={{ name: '中村 彩', roleLabel: 'スタッフ' }}
      changes={changes}
      onElevated={onElevated}
      onBack={onBack}
    />,
  )
  return { onElevated, onBack }
}

async function typePin(pin: string) {
  const keypad = screen.getByRole('region', { name: '店長の暗証番号' })
  for (const digit of pin) {
    await userEvent.click(within(keypad).getByRole('button', { name: digit }))
  }
  await userEvent.click(within(keypad).getByRole('button', { name: '確定' }))
}

describe('権限不足', () => {
  it('「この操作は店長だけができます」と足りない権限の名前が出る', () => {
    open()
    expect(
      screen.getByRole('heading', { name: 'この操作は店長だけができます' }),
    ).toBeInTheDocument()
    expect(screen.getByText('設定の変更')).toBeInTheDocument()
    expect(screen.getByText(/中村 彩（スタッフ）の権限では保存できません。/)).toBeInTheDocument()
  })

  it('「設定はまだ何も変わっていません」が出る', () => {
    open()
    expect(screen.getByText(/設定はまだ何も変わっていません。/)).toBeInTheDocument()
  })

  it('「下書きは残っています」の下に、書き換えた 2 行がそのまま読める', () => {
    open()
    expect(screen.getByRole('heading', { name: '下書きは残っています' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: '下書きは残っています' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual(CHANGES)
  })

  it('「この下書きを店長に依頼する」を画面に出さない（Q-10 の答えが来るまで）', () => {
    open()
    expect(screen.queryByText('この下書きを店長に依頼する')).not.toBeInTheDocument()
  })

  it('右に「店長の暗証番号で続ける」のテンキーがあり、通ると元の操作が実行できる', async () => {
    const { onElevated } = open()
    expect(screen.getByRole('heading', { name: '店長の暗証番号で続ける' })).toBeInTheDocument()
    await typePin('2580')
    expect(onElevated).toHaveBeenCalledTimes(1)
    expect(sent).toEqual({ staffId: MANAGER_ID, pin: '2580', reason: 'settings' })
  })

  it('「設定に戻る」で下書きを保ったまま戻る', async () => {
    const { onBack, onElevated } = open()
    await userEvent.click(screen.getByRole('button', { name: '設定に戻る' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onElevated).not.toHaveBeenCalled()
  })

  it('下書きが無いまま開いたときは「下書きは残っています」を出さない', () => {
    open([])
    expect(screen.queryByText('下書きは残っています')).not.toBeInTheDocument()
    expect(screen.getByText('設定の変更')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '店長の暗証番号で続ける' })).toBeInTheDocument()
  })
})
