import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlacePick } from './PlacePick'

/*
 * 承認済みモック docs/frontend/mockups/eyex/images/LOGIN-SHARED.png の面
 * （UC-TERM-05 / AC-TERM-04 / AC-TERM-21）。世界観データは銀座店の 3 台。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const id = (n: number) => `eeeeeeee-ffff-4aaa-8bbb-${String(n).padStart(12, '0')}`

/**
 * レジ横＝一度も通信していない／受付＝5 分以内に通信（業務中）／
 * 検査室＝昨日 18:42 が最後（つながっていません）。
 */
const TERMINALS = [
  {
    id: id(1),
    name: '銀座店 レジ横iPad',
    placeNote: 'レジの右側　固定スタンド',
    lastSeenAt: null,
    isOnline: false,
  },
  {
    id: id(2),
    name: '銀座店 受付iPad',
    placeNote: '入口の受付台',
    lastSeenAt: '2026-08-27T00:32:00.000Z',
    isOnline: true,
  },
  {
    id: id(3),
    name: '銀座店 検査室iPad',
    placeNote: '検査室 1　測定機の脇',
    lastSeenAt: '2026-08-26T09:42:00.000Z',
    isOnline: false,
  },
].map((row) => ({
  ...row,
  storeId: STORE_ID,
  kind: 'shared' as const,
  deviceLabel: 'EYEX-iPad-07',
  autoLockSeconds: 120,
  isActive: true,
  hasPin: true,
  version: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
}))

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items: TERMINALS }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  )
})

afterEach(() => vi.unstubAllGlobals())

function open(onPick = vi.fn(), onChangeMode = vi.fn()) {
  render(
    <PlacePick
      storeId={STORE_ID}
      storeName="EYEX 銀座店"
      onPick={onPick}
      onChangeMode={onChangeMode}
      onQuit={vi.fn()}
    />,
  )
  return { onPick, onChangeMode }
}

describe('置き場所を選ぶ', () => {
  it('「この端末はどこに置きますか？」と「選んだ置き場所の名前が、そのまま記録に残ります。」が出る', async () => {
    open()
    expect(
      await screen.findByRole('heading', { name: 'この端末はどこに置きますか？' }),
    ).toBeInTheDocument()
    expect(screen.getByText('選んだ置き場所の名前が、そのまま記録に残ります。')).toBeInTheDocument()
  })

  it('3 件の状態が「まだ誰も使っていません」「業務中」「つながっていません」と文字で出る', async () => {
    open()
    const first = await screen.findByRole('button', { name: /銀座店 レジ横iPad/ })
    // 先頭は選択中。札は「選択中」に変わるが、状態の文字は下段に残る。
    expect(first).toHaveAttribute('aria-pressed', 'true')
    expect(first).toHaveTextContent('選択中')
    expect(first).toHaveTextContent('まだ誰も使っていません')
    expect(screen.getByRole('button', { name: /銀座店 受付iPad/ })).toHaveTextContent('業務中')
    const offline = screen.getByRole('button', { name: /銀座店 検査室iPad/ })
    expect(offline).toHaveTextContent('つながっていません')
    expect(offline).toHaveTextContent('最終通信')
  })

  it('つながっていない置き場所も、業務中の置き場所も押せる', async () => {
    const { onPick } = open()
    const offline = await screen.findByRole('button', { name: /銀座店 検査室iPad/ })
    expect(offline).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /銀座店 受付iPad/ }))
    await userEvent.click(screen.getByRole('button', { name: 'この置き場所で始める' }))
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: '銀座店 受付iPad' }))
  })

  it('「使い方を変える」で端末の使い方の画面へ戻る', async () => {
    const { onChangeMode } = open()
    await userEvent.click(await screen.findByRole('button', { name: '使い方を変える' }))
    expect(onChangeMode).toHaveBeenCalledTimes(1)
  })
})
