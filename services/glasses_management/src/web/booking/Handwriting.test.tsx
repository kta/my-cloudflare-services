import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { type CustomerDraft, CustomerStep } from './CustomerStep'
import { Handwriting } from './Handwriting'

/*
 * ご要望の手書き（承認済みモック docs/frontend/mockups/eyex/images/BOOK-04d-HANDWRITE.png）。
 *
 * この面の仕事は「伺ったことばを文字に直さず、かたちのまま残す」こと。
 *
 * 実測値（screens/BOOK-04d-HANDWRITE.html と assets/eyex.css の `.canvas` / `.pen`）:
 *   本文 1fr ／ 右の柱 320px、本文の余白 32px 40px・柱 32px 26px。
 *   道具は ペン / マーカー / 消しゴム ｜ 細 / 中 / 太 ｜ 取り消し（`.pen` = 最小 48×44px）。
 *   用紙は高さ 420px・上に 20px、罫の下に「記入　山田 大輔（店長）　11:04」（右寄せ）。
 *
 * **「文字に変換する」を出さない。**無料枠の構成にサーバ側の文字認識を置かず、端末側の
 * 手書き認識も持たないので、押しても何も起きないボタンを画面に出さない（AC-BOOK-12）。
 * キーボードだけで使う人の代替は BOOK-04-CUSTOMER の「キーボードで入力」で、これが
 * WCAG 2.1.1 の充足根拠になる（`07-nfr.md` §2.9）。
 */

const NOW = '2026-08-27T02:08:00.000Z' // 11:08 JST
const WRITER = '山田 大輔（店長）'

const SO_FAR = {
  dateTimeLabel: '2026年8月27日（木）11:00',
  purposeLabel: 'メガネを新しく作る',
  durationMinutes: 60,
  staffLabel: '佐藤 美咲',
  equipmentLabel: '視力測定機 A',
} as const

const EMPTY: CustomerDraft = {
  phoneTyped: '',
  nameTyped: '',
  kanaTyped: '',
  noteTyped: '',
  notes: [],
}

function Step() {
  const [value, setValue] = useState<CustomerDraft>(EMPTY)
  return (
    <CustomerStep
      value={value}
      onChange={setValue}
      soFar={SO_FAR}
      writer={WRITER}
      now={NOW}
      onLookup={async () => []}
    />
  )
}

/** 既定の normalizer は全角の空白（U+3000）を半角へ畳むので、文字どおり探すときに使う。 */
const asWritten = { normalizer: (text: string) => text.trim() }

function paper(): HTMLElement {
  return screen.getByTestId('handwriting-paper')
}

/** 用紙の上を 1 本なぞる。座標は jsdom では原点のままでよい（形は測らない）。 */
function scribble(): void {
  fireEvent.pointerDown(paper(), { pointerId: 1, pointerType: 'pen', clientX: 40, clientY: 40 })
  fireEvent.pointerMove(paper(), { pointerId: 1, pointerType: 'pen', clientX: 120, clientY: 44 })
  fireEvent.pointerMove(paper(), { pointerId: 1, pointerType: 'pen', clientX: 200, clientY: 60 })
  fireEvent.pointerUp(paper(), { pointerId: 1, pointerType: 'pen', clientX: 200, clientY: 60 })
}

describe('手書き', () => {
  it('「手書きで書く」を押すと罫線つきの用紙が出る', async () => {
    render(<Step />)
    expect(screen.queryByTestId('handwriting-paper')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '手書きで書く' }))
    expect(paper()).toBeVisible()
    // 罫は用紙の中に引く（背景画像にしない。読み上げの邪魔をしない装飾として aria-hidden）。
    expect(paper().querySelectorAll('[data-testid="handwriting-rule"]').length).toBeGreaterThan(0)
    expect(screen.getByRole('group', { name: 'ペンと太さ' })).toBeVisible()
  })

  it('「手書きのまま残す」で、文字に変換しないままご要望が残る', async () => {
    render(<Step />)
    await userEvent.click(screen.getByRole('button', { name: '手書きで書く' }))
    scribble()
    await userEvent.click(screen.getByRole('button', { name: '手書きのまま残す' }))
    expect(screen.queryByTestId('handwriting-paper')).not.toBeInTheDocument()
    const kept = screen.getByRole('group', { name: '残したご要望' })
    expect(within(kept).getByRole('img')).toBeVisible()
    // 文字にしていないので、ご要望の文の欄は空のまま。
    expect(screen.getByLabelText('ご要望・伝言（任意）')).toHaveValue('')
  })

  it('残したご要望に記入した人と時刻が添えられる', async () => {
    render(<Step />)
    await userEvent.click(screen.getByRole('button', { name: '手書きで書く' }))
    expect(screen.getByText('記入　山田 大輔（店長）　11:08', asWritten)).toBeVisible()
    scribble()
    await userEvent.click(screen.getByRole('button', { name: '手書きのまま残す' }))
    const kept = screen.getByRole('group', { name: '残したご要望' })
    expect(within(kept).getByText('記入　山田 大輔（店長）　11:08', asWritten)).toBeVisible()
  })

  it('「文字に変換する」のボタンを画面に出さない', async () => {
    render(<Step />)
    await userEvent.click(screen.getByRole('button', { name: '手書きで書く' }))
    expect(screen.queryByRole('button', { name: '文字に変換する' })).not.toBeInTheDocument()
    expect(screen.queryByText('文字にするとこうなります')).not.toBeInTheDocument()
  })

  it('用紙の上をなぞっている間、背後の画面がスクロールしない', () => {
    render(<Handwriting writer={WRITER} now={NOW} onSave={() => {}} onCancel={() => {}} />)
    // `touch-action: none` が無いと、本文のほぼ全面を占める用紙の上を指で滑らせたときに
    // 背後の本文がスクロールする（`07-nfr.md` §2.9）。
    expect(paper().className).toContain('touch-none')
    fireEvent.pointerDown(paper(), { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 })
    const moved = fireEvent.pointerMove(paper(), {
      pointerId: 1,
      pointerType: 'pen',
      clientX: 30,
      clientY: 18,
    })
    expect(moved).toBe(false)
  })

  it('「キーボードで入力」から同じご要望を文字で残せる', async () => {
    render(<Step />)
    await userEvent.click(screen.getByRole('button', { name: 'キーボードで入力' }))
    const memo = screen.getByLabelText('ご要望・伝言（任意）')
    expect(document.activeElement).toBe(memo)
    await userEvent.type(memo, '遠近は初めて')
    expect(memo).toHaveValue('遠近は初めて')
  })

  it('残した筆跡に role="img" と読み上げ用の説明が付く', async () => {
    const onSave = vi.fn()
    render(<Handwriting writer={WRITER} now={NOW} onSave={onSave} onCancel={() => {}} />)
    scribble()
    await userEvent.click(screen.getByRole('button', { name: '手書きのまま残す' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const note = onSave.mock.calls[0]?.[0]
    expect(note.description).toBe(
      '手書きのご要望　文字にしていません　記入　山田 大輔（店長）　11:08',
    )
    expect(note.svg).toContain('<svg')
    expect(note.writtenBy).toBe(WRITER)
  })
})

describe('手書きの道具', () => {
  it('何も書いていないうちは「手書きのまま残す」を押せず、理由が読み上げられる', () => {
    render(<Handwriting writer={WRITER} now={NOW} onSave={() => {}} onCancel={() => {}} />)
    const keep = screen.getByRole('button', { name: /手書きのまま残す/ })
    expect(keep).toBeDisabled()
    expect(keep).toHaveAccessibleName('手書きのまま残す　用紙に書くと押せます')
  })

  it('「取り消し」で最後の 1 本が消え、選んだ道具は押されたことが分かる', async () => {
    render(<Handwriting writer={WRITER} now={NOW} onSave={() => {}} onCancel={() => {}} />)
    scribble()
    expect(paper().querySelectorAll('[data-testid="handwriting-stroke"]')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: '取り消し' }))
    expect(paper().querySelectorAll('[data-testid="handwriting-stroke"]')).toHaveLength(0)

    expect(screen.getByRole('button', { name: 'ペン' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'マーカー' }))
    expect(screen.getByRole('button', { name: 'マーカー' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'ペン' })).toHaveAttribute('aria-pressed', 'false')
  })
})
