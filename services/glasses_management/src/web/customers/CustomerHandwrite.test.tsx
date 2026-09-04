import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  CustomerHandwrite,
  type HandwrittenSheet,
  publishedAttentionCount,
} from './CustomerHandwrite'

/*
 * 手書きメモ（承認済みモック docs/frontend/mockups/eye/images/CUSTOMER-HANDWRITE.png）。
 *
 * この面の仕事は「測定中に紙へ書いたメモを、言い換えずにそのまま台帳へ置く」こと。
 *
 * 実測値（screens/CUSTOMER-HANDWRITE.html の <style> と assets/eye.css）:
 *   本文 2 列 260px / 1fr。左は padding 28px 20px、サムネは 1px の line-strong・角 8px・
 *   SVG の高さ 118px、下の帯は surface-2・padding 10px 12px（日付 14px/600 ＋ 店舗と記入者 13px）。
 *   サムネ間は margin-top 18px。選択中は 3px の緑枠＋帯が薄い緑。
 *   右は padding 28px 32px・gap 22px。見出しは日付＋用件 18px、店舗と記入者 13px、右端に札「1枚目 / 3枚」。
 *   読み取り欄は 2px の緑枠・角 12px・padding 14px 16px・min-height 92px・16px・行間 1.6。
 *
 * 「大きく」「小さく」「赤ペンも見る」「紙を撮り直す」は出さない（押して何も起きないボタンを作らない）。
 * 筆跡そのものは P3 の `booking/Handwriting.tsx` をそのまま使う（同じものを二度作らない）。
 */

/** 既定の normalizer は全角の空白（U+3000）を半角へ畳むので、文字どおり探すときに使う。 */
const asWritten = { normalizer: (text: string) => text.trim() }

const NOW = '2026-08-27T02:08:00.000Z' // 11:08 JST
const WRITER = '佐藤 美咲'

const BODY =
  'PC作業用のレンズ交換のご相談。鼻パッドは低めに調整ずみ。右の見え方が落ちたとのこと。フレームは 52□17。次回は遠近両用も一緒に考える。'

const INK = '<svg viewBox="0 0 848 340"><path d="M3 6 C9 4 17 5 22 6"/></svg>'

const SHEETS: readonly HandwrittenSheet[] = [
  {
    id: 'sheet-1',
    svg: INK,
    body: BODY,
    subject: '視力測定のご相談',
    writtenOn: '2026-05-12',
    storeName: '銀座店',
    authorName: '佐藤 美咲',
    revision: 2,
    attention: 'none',
    uncertain: ['低めに調整ずみ', '52□17', '遠近両用'],
  },
  {
    id: 'sheet-2',
    svg: '<svg viewBox="0 0 848 340"><path d="M4 5 C10 4 17 4 21 5"/></svg>',
    body: '鼻パッドの高さを直しました。',
    subject: 'かけ具合の調整',
    writtenOn: '2025-11-02',
    storeName: '銀座店',
    authorName: '高橋 健',
    revision: 1,
    attention: 'published',
    uncertain: [],
  },
  {
    id: 'sheet-3',
    svg: '<svg viewBox="0 0 848 340"><path d="M12 2 C11 8 12 16 11 23"/></svg>',
    body: '遠近両用をご検討中。',
    subject: 'レンズのご相談',
    writtenOn: '2025-04-20',
    storeName: '丸の内店',
    authorName: '中村 彩',
    revision: 1,
    attention: 'none',
    uncertain: [],
  },
]

function Screen(props: Partial<Parameters<typeof CustomerHandwrite>[0]> = {}) {
  return (
    <CustomerHandwrite
      sheets={SHEETS}
      writer={WRITER}
      now={NOW}
      onSaveSheet={() => {}}
      onSaveText={() => {}}
      onRequestAttention={() => {}}
      onBack={() => {}}
      {...props}
    />
  )
}

/** 保存すると本当に 1 枚増えることを見るための器。 */
function Stateful() {
  const [sheets, setSheets] = useState<readonly HandwrittenSheet[]>(SHEETS)
  return (
    <CustomerHandwrite
      sheets={sheets}
      writer={WRITER}
      now={NOW}
      onSaveSheet={({ svg }) =>
        setSheets((kept) => [
          {
            id: `sheet-${kept.length + 1}-new`,
            svg,
            body: '',
            subject: '',
            writtenOn: '2026-08-27',
            storeName: '銀座店',
            authorName: WRITER,
            revision: 0,
            attention: 'none',
            uncertain: [],
          },
          ...kept,
        ])
      }
      onSaveText={() => {}}
      onRequestAttention={() => {}}
      onBack={() => {}}
    />
  )
}

function sheetList(): HTMLElement {
  return screen.getByRole('radiogroup', { name: '手書きメモの一覧' })
}

function paper(): HTMLElement {
  return screen.getByTestId('handwriting-paper')
}

/** 用紙の上をペンで 1 本なぞる。`pressure` は線の太さに使われない。 */
function scribble(pressure = 0.5): void {
  fireEvent.pointerDown(paper(), {
    pointerId: 1,
    pointerType: 'pen',
    pressure,
    clientX: 40,
    clientY: 40,
  })
  fireEvent.pointerMove(paper(), {
    pointerId: 1,
    pointerType: 'pen',
    pressure,
    clientX: 120,
    clientY: 44,
  })
  fireEvent.pointerUp(paper(), {
    pointerId: 1,
    pointerType: 'pen',
    pressure,
    clientX: 120,
    clientY: 44,
  })
}

describe('一覧', () => {
  it('見出しの枚数とサムネの本数が一致する', () => {
    render(<Screen />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('手書きメモ　3枚')
    expect(within(sheetList()).getAllByRole('radio')).toHaveLength(3)
  })

  it('新しい順に並び、各枚に日付・記入した店舗・記入者が添う', () => {
    render(<Screen />)
    const thumbs = within(sheetList()).getAllByRole('radio')
    expect(thumbs.map((thumb) => thumb.textContent)).toEqual([
      '2026年5月12日銀座店　記入 佐藤 美咲',
      '2025年11月2日銀座店　記入 高橋 健',
      '2025年4月20日丸の内店　記入 中村 彩',
    ])
  })

  it('丸の内店で書かれた 1 枚も銀座店の端末から読める', async () => {
    render(<Screen />)
    await userEvent.click(within(sheetList()).getAllByRole('radio')[2] as HTMLElement)
    // 左のサムネにも同じ文字が出るので、開いている 1 枚の側だけを見る。
    const view = screen.getByRole('region', { name: '選んだ手書きメモ' })
    expect(within(view).getByText('2025年4月20日　レンズのご相談', asWritten)).toBeVisible()
    expect(within(view).getByText('丸の内店　記入 中村 彩', asWritten)).toBeVisible()
    expect(screen.getByLabelText('読み取った文字（直せます）')).toHaveValue('遠近両用をご検討中。')
  })

  it('選んでいる位置が「1枚目 / 3枚」と一致する', async () => {
    render(<Screen />)
    expect(screen.getByText('1枚目 / 3枚')).toBeVisible()
    await userEvent.click(within(sheetList()).getAllByRole('radio')[2] as HTMLElement)
    expect(screen.getByText('3枚目 / 3枚')).toBeVisible()
  })

  it('0 枚のときは「手書きのメモはまだありません」と次の行動の 1 行を出し、「新しく書く」だけを残す', () => {
    render(<Screen sheets={[]} />)
    const empty = screen.getByRole('status')
    expect(within(empty).getByText('手書きのメモはまだありません')).toBeVisible()
    expect(
      within(empty).getByText('「新しく書く」から、紙に書くのと同じように書き残せます。'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '新しく書く' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '文字を保存する' })).toBeNull()
    expect(screen.queryByRole('button', { name: '注意ごととして登録を申し込む' })).toBeNull()
  })
})

describe('用紙', () => {
  it('筆跡の SVG は role="img" と読み取った文字の aria-label を持つ', () => {
    render(<Screen />)
    const ink = screen.getByRole('img', { name: /2026年5月12日の手書きメモ/ })
    // 全角の空白が読み上げ名の計算で畳まれないよう、属性そのものを見る。
    expect(ink.getAttribute('aria-label')).toBe(`2026年5月12日の手書きメモ　${BODY}`)
    // 筆跡そのものは読み上げに二重に出さない。
    expect(within(ink).queryAllByRole('img')).toHaveLength(0)
  })

  it('なぞっている間、背後の本文がスクロールしない（touch-action: none）', async () => {
    render(<Screen />)
    await userEvent.click(screen.getByRole('button', { name: '新しく書く' }))
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

  it('ペンが触れている間、手のひらの touch は線にならない', async () => {
    render(<Screen />)
    await userEvent.click(screen.getByRole('button', { name: '新しく書く' }))
    fireEvent.pointerDown(paper(), { pointerId: 1, pointerType: 'pen', clientX: 10, clientY: 10 })
    // 手のひらが同時に触れる。
    fireEvent.pointerDown(paper(), { pointerId: 2, pointerType: 'touch', clientX: 60, clientY: 90 })
    fireEvent.pointerMove(paper(), { pointerId: 2, pointerType: 'touch', clientX: 80, clientY: 95 })
    fireEvent.pointerUp(paper(), { pointerId: 2, pointerType: 'touch', clientX: 80, clientY: 95 })
    fireEvent.pointerMove(paper(), { pointerId: 1, pointerType: 'pen', clientX: 40, clientY: 20 })
    fireEvent.pointerUp(paper(), { pointerId: 1, pointerType: 'pen', clientX: 40, clientY: 20 })
    expect(paper().querySelectorAll('[data-testid="handwriting-stroke"]')).toHaveLength(1)
  })

  it('線の太さは筆圧で変えない', async () => {
    render(<Screen />)
    await userEvent.click(screen.getByRole('button', { name: '新しく書く' }))
    scribble(0.05)
    scribble(0.98)
    const widths = [...paper().querySelectorAll('[data-testid="handwriting-stroke"]')].map((path) =>
      path.getAttribute('stroke-width'),
    )
    expect(widths).toHaveLength(2)
    expect(new Set(widths).size).toBe(1)
  })
})

describe('保存', () => {
  it('「手書きのまま残す」で 1 枚増え、見出しが「手書きメモ　4枚」になる', async () => {
    render(<Stateful />)
    await userEvent.click(screen.getByRole('button', { name: '新しく書く' }))
    scribble()
    await userEvent.click(screen.getByRole('button', { name: '手書きのまま残す' }))
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('手書きメモ　4枚')
    expect(within(sheetList()).getAllByRole('radio')).toHaveLength(4)
  })

  it('6 枚目は保存できず、どの 1 枚を置き換えるかを尋ねる', async () => {
    const onSaveSheet = vi.fn()
    const five = [
      ...SHEETS,
      { ...SHEETS[0], id: 'sheet-4', writtenOn: '2025-02-10' },
      { ...SHEETS[0], id: 'sheet-5', writtenOn: '2024-12-01' },
    ] as HandwrittenSheet[]
    render(<Screen sheets={five} onSaveSheet={onSaveSheet} />)
    await userEvent.click(screen.getByRole('button', { name: '新しく書く' }))
    scribble()
    await userEvent.click(screen.getByRole('button', { name: '手書きのまま残す' }))

    // 黙って古い 1 枚を消さない。
    expect(onSaveSheet).not.toHaveBeenCalled()
    const ask = screen.getByRole('radiogroup', { name: '置き換える 1 枚' })
    expect(screen.getByText('手書きメモは 5枚までです。どの 1 枚と置き換えますか。')).toBeVisible()
    expect(within(ask).getAllByRole('radio')).toHaveLength(5)

    await userEvent.click(within(ask).getAllByRole('radio')[4] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: 'この 1 枚と置き換える' }))
    expect(onSaveSheet).toHaveBeenCalledTimes(1)
    expect(onSaveSheet.mock.calls[0]?.[0].replacesId).toBe('sheet-5')
    expect(onSaveSheet.mock.calls[0]?.[0].svg).toContain('<svg')
  })
})

describe('文字', () => {
  it('「文字を保存する」で本文だけが新しくなり、筆跡は書いたときのまま残る', async () => {
    const onSaveText = vi.fn()
    render(<Screen onSaveText={onSaveText} />)
    const field = screen.getByLabelText('読み取った文字（直せます）')
    await userEvent.clear(field)
    await userEvent.type(field, '遠近両用も一緒に考える。')
    await userEvent.click(screen.getByRole('button', { name: '文字を保存する' }))

    expect(onSaveText).toHaveBeenCalledWith({
      noteId: 'sheet-1',
      revision: 2,
      body: '遠近両用も一緒に考える。',
    })
    // 筆跡は 1 本も減らない（書いたときのまま）。
    const ink = screen.getByRole('img', { name: /2026年5月12日の手書きメモ/ })
    expect(ink.innerHTML).toContain('M3 6 C9 4 17 5 22 6')
  })

  it('読み取り結果が空でも保存できる', async () => {
    const onSaveText = vi.fn()
    render(<Screen onSaveText={onSaveText} />)
    await userEvent.clear(screen.getByLabelText('読み取った文字（直せます）'))
    await userEvent.click(screen.getByRole('button', { name: '文字を保存する' }))
    expect(onSaveText).toHaveBeenCalledWith({ noteId: 'sheet-1', revision: 2, body: '' })
  })

  it('点線の箇所の数と「3か所」の数字が一致する', () => {
    render(<Screen />)
    expect(screen.getByText('点線の 3か所は読み取りに自信がありません。', asWritten)).toBeVisible()
    expect(screen.getAllByTestId('uncertain')).toHaveLength(3)
    expect(screen.getAllByTestId('uncertain').map((mark) => mark.textContent)).toEqual([
      '低めに調整ずみ',
      '52□17',
      '遠近両用',
    ])
  })
})

describe('申し込み', () => {
  it('「注意ごととして登録を申し込む」を押すと札が「注意ごとに申し込み済み」になる', async () => {
    const onRequestAttention = vi.fn()
    render(<Screen onRequestAttention={onRequestAttention} />)
    await userEvent.click(screen.getByRole('button', { name: '注意ごととして登録を申し込む' }))
    expect(onRequestAttention).toHaveBeenCalledWith({
      noteId: 'sheet-1',
      revision: 2,
      body: BODY,
    })
    expect(screen.getByText('注意ごとに申し込み済み')).toBeVisible()
    expect(screen.queryByRole('button', { name: '注意ごととして登録を申し込む' })).toBeNull()
  })

  it('申し込んでも詳細の「注意ごと　1件」の件数は増えない', async () => {
    // 数えるのは `published` の注意ごとだけ。申し込みは `draft` のままなので増えない。
    expect(publishedAttentionCount(SHEETS)).toBe(1)
    render(<Screen />)
    await userEvent.click(screen.getByRole('button', { name: '注意ごととして登録を申し込む' }))
    expect(publishedAttentionCount(SHEETS)).toBe(1)
    expect(
      publishedAttentionCount([{ ...(SHEETS[0] as HandwrittenSheet), attention: 'requested' }]),
    ).toBe(0)
  })
})

describe('代替', () => {
  it('手書きが使えなくても「読み取った文字（直せます）」から同じ内容を文字で残せる', async () => {
    const onSaveText = vi.fn()
    const textOnly: HandwrittenSheet[] = [
      { ...(SHEETS[0] as HandwrittenSheet), svg: null, body: '', revision: 0, uncertain: [] },
    ]
    render(<Screen sheets={textOnly} onSaveText={onSaveText} />)
    // 筆跡が無くても行き止まりにしない。
    expect(screen.getByText('筆跡はありません')).toBeVisible()
    const field = screen.getByLabelText('読み取った文字（直せます）')
    expect(field.tagName).toBe('TEXTAREA')
    expect(field).toBeEnabled()
    await userEvent.type(field, 'PC作業用のレンズ交換のご相談。')
    await userEvent.click(screen.getByRole('button', { name: '文字を保存する' }))
    expect(onSaveText).toHaveBeenCalledWith({
      noteId: 'sheet-1',
      revision: 0,
      body: 'PC作業用のレンズ交換のご相談。',
    })
  })
})

describe('読み込み中とエラー', () => {
  it('読み込み中はサムネの高さを保った灰色の帯を置き、回るアイコンを置かない', () => {
    render(<Screen loading />)
    expect(screen.getAllByTestId('handwrite-skeleton')).toHaveLength(3)
    expect(screen.queryByRole('radiogroup', { name: '手書きメモの一覧' })).toBeNull()
  })

  it('取れなかったときは理由と「もう一度読み込む」を出す', async () => {
    const onReload = vi.fn()
    render(<Screen error="通信が届きませんでした。" onReload={onReload} />)
    expect(screen.getByRole('alert')).toHaveTextContent('通信が届きませんでした。')
    await userEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})
