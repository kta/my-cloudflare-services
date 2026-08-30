import type { CustomerCandidate } from '@app/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { CustomerHandover, CustomerMatch, PickToFillHint } from './CustomerMatch'

/*
 * お客様の候補（承認済みモック docs/frontend/mockups/eyex/images/BOOK-04b-CUSTOMER-MATCH.png）。
 *
 * この面の仕事は「番号を打ち終えた瞬間に候補を出し、お名前を声に出して確かめてもらう」こと。
 * **モーダルにしない** —— 候補が開いている間もお電話番号の欄は打てるままで、
 * 右下の「録音中」も読み上げから外れない（AC-CUST-21）。
 *
 * 実測値（screens/BOOK-04b-CUSTOMER-MATCH.html と assets/eyex.css の `.popover`）:
 *   吹き出しは 幅 420px・角 16px・縁 1px --line-strong・影 0 12px 32px、
 *   番号欄の右（上 68px / 左 436px）から出て、左辺 84px に 18px の三角。
 *   頭 18px 20px / 胴 18px 20px / 足 14px 20px（足の地は --surface-2）。
 *   候補カードは padding 16px 18px・角 12px、カード間 16px、お名前 19px、`dl` は 82px 1fr。
 *   右の柱は 320px・padding 36px 26px（`dt` 12px / `dd` 16px 600）。
 *
 * この部品は予約の工程 4 と CUSTOMER-NEW の両方の手前に立つので、お電話番号・お名前・
 * ふりがなの欄そのものは持たない（欄は器の持ち物である）。下の `Flow` が、器がどう
 * 配線すればよいかを固定する。
 */

const HANAKO: CustomerCandidate = {
  customer: {
    id: '0f1b7a2c-9d64-4d1e-9d3a-2f4d6b8c1a01',
    customerNumber: 'G-01842',
    name: '田中 花子',
    kana: 'たなか はなこ',
    phone: '09012345678',
    visitCount: 4,
    lastVisitAt: '2026-05-18',
    memoShort: '',
  },
  match: 'strong',
  lastVisitAt: '2026-05-18',
  currentPrescription: {
    id: '2a6c9e11-5b73-4a58-b6a0-9c2e4d7f8b02',
    measuredAt: '2026-05-18',
    rSph: -2.25,
    lSph: -2,
    rCyl: null,
    lCyl: null,
    rAxis: null,
    lAxis: null,
    rAdd: null,
    lAdd: null,
    pd: 62,
    note: '',
    isCurrent: true,
  },
  lastStaffName: '佐藤 美咲',
  attentionSummary: 'PC作業用。鼻パッドは低め',
}

const ICHIRO: CustomerCandidate = {
  customer: {
    id: '7c3e5d90-1f28-4b6a-8e5c-3a9b7d1e5f03',
    customerNumber: 'G-02310',
    name: '田中 一郎',
    kana: 'たなか いちろう',
    phone: '09012349912',
    visitCount: 1,
    lastVisitAt: null,
    memoShort: '',
  },
  match: 'weak',
  lastVisitAt: null,
  currentPrescription: null,
  lastStaffName: null,
  attentionSummary: '',
}

/** 同姓同名で、どちらも全桁が一致している 2 件。 */
const SAME_NAME: readonly CustomerCandidate[] = [
  HANAKO,
  {
    ...HANAKO,
    customer: {
      ...HANAKO.customer,
      id: 'b8d4f6a2-3c15-4e79-9a2b-6d8f0c3e7a04',
      customerNumber: 'G-03177',
      visitCount: 2,
    },
    lastVisitAt: '2025-11-04',
  },
]

/**
 * 器（予約の工程 4 と CUSTOMER-NEW が同じ形で使う）。候補が開いている間、お名前の欄は
 * 手で入れられない（お選びになると入る）ので、器が `readOnly` を持つ。閉じたら手入力に戻る。
 */
function Flow({
  candidates = [HANAKO, ICHIRO],
  phone = '09012345678',
}: {
  candidates?: readonly CustomerCandidate[]
  phone?: string
}) {
  const phoneRef = useRef<HTMLInputElement>(null)
  const [digits, setDigits] = useState(phone)
  const [dismissed, setDismissed] = useState(false)
  const [picked, setPicked] = useState<CustomerCandidate | null>(null)
  const [name, setName] = useState('')
  const [kana, setKana] = useState('')
  const open = digits.length >= 11 && !dismissed && picked === null

  return (
    <div className="relative">
      <label htmlFor="phone">お電話番号</label>
      <input
        id="phone"
        ref={phoneRef}
        type="tel"
        role="combobox"
        aria-expanded={open}
        aria-controls="customer-match-list"
        value={digits}
        onChange={(event) => setDigits(event.target.value.replace(/\D/g, ''))}
      />

      <label htmlFor="name">お名前</label>
      <input
        id="name"
        value={name}
        readOnly={open}
        placeholder={open ? 'お選びになると入ります' : '例：田中 花子'}
        aria-describedby={open ? 'name-hint' : undefined}
        onChange={(event) => setName(event.target.value)}
      />
      {open && <PickToFillHint id="name-hint" />}

      <label htmlFor="kana">ふりがな</label>
      <input
        id="kana"
        value={kana}
        readOnly={open}
        placeholder={open ? 'お選びになると入ります' : '例：たなか はなこ'}
        onChange={(event) => setKana(event.target.value)}
      />

      {open && (
        <CustomerMatch
          candidates={candidates}
          returnFocusTo={phoneRef}
          onSelect={(candidate) => {
            setPicked(candidate)
            setName(candidate.customer.name)
            setKana(candidate.customer.kana)
          }}
          onDismiss={() => setDismissed(true)}
          onReenter={() => {
            setDismissed(true)
            setDigits('')
          }}
        />
      )}

      <CustomerHandover candidate={picked} />
      <p role="status">録音中　02:14</p>
    </div>
  )
}

function popover(): HTMLElement {
  return screen.getByRole('dialog', { name: 'お客様の候補' })
}

function options(): HTMLElement[] {
  return within(screen.getByRole('listbox', { name: 'お客様の候補' })).getAllByRole('option')
}

describe('候補', () => {
  it('2 件が listbox の option として読める', () => {
    render(<Flow />)
    const list = screen.getByRole('listbox', { name: 'お客様の候補' })
    const rows = within(list).getAllByRole('option')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('田中 花子 様')
    expect(rows[1]).toHaveTextContent('田中 一郎 様')
    expect(screen.getByRole('heading', { name: 'このお客様でしょうか？' })).toBeVisible()
    expect(screen.getByText('お名前を声に出してお確かめください。')).toBeVisible()
  })

  it('全桁一致の 1 件が「よく一致しています」、前方だけ一致の 1 件が「確かめが必要です」', () => {
    render(<Flow />)
    const [strong, weak] = options()
    expect(within(strong as HTMLElement).getByText('よく一致しています')).toBeVisible()
    expect(within(weak as HTMLElement).getByText('確かめが必要です')).toBeVisible()
    // 来店回数は色だけでなく数字の文字で出す。
    expect(within(strong as HTMLElement).getByText('4回目')).toBeVisible()
  })

  it('開いた時点ではどちらも選ばれておらず、お名前の欄は「お選びになると入ります」のまま', () => {
    render(<Flow />)
    for (const option of options()) expect(option).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByLabelText('お名前')).toHaveValue('')
    expect(screen.getByLabelText('ふりがな')).toHaveValue('')
    expect(screen.getByLabelText('お名前')).toHaveAccessibleDescription('お選びになると入ります')
  })

  it('同姓同名でも全桁一致でも自動で確定しない', () => {
    render(<Flow candidates={SAME_NAME} />)
    const rows = options()
    expect(rows).toHaveLength(2)
    for (const option of rows) expect(option).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByLabelText('お名前')).toHaveValue('')
    expect(screen.getAllByRole('button', { name: 'このお客様で進む' })).toHaveLength(2)
  })

  it('1 件を選ぶとお名前とふりがなの欄が埋まり、右に引き継がれる 4 項目が出る', async () => {
    render(<Flow />)
    const [strong] = options()
    await userEvent.click(
      within(strong as HTMLElement).getByRole('button', { name: 'このお客様で進む' }),
    )

    expect(screen.getByLabelText('お名前')).toHaveValue('田中 花子')
    expect(screen.getByLabelText('ふりがな')).toHaveValue('たなか はなこ')

    const handover = screen.getByRole('complementary', { name: 'お選びになると引き継がれること' })
    expect(within(handover).getByText('現在の度数')).toBeVisible()
    expect(within(handover).getByText('R -2.25 L -2.00 PD 62.0')).toBeVisible()
    expect(within(handover).getByText('前回の担当')).toBeVisible()
    expect(within(handover).getByText('佐藤 美咲')).toBeVisible()
    expect(within(handover).getByText('注意ごと')).toBeVisible()
    expect(within(handover).getByText('PC作業用。鼻パッドは低め')).toBeVisible()
    expect(within(handover).getByText('ご連絡先')).toBeVisible()
    expect(within(handover).getByText('090-1234-5678')).toBeVisible()
  })

  it('「どちらでもありません」で閉じるとお名前を手で入れられる状態になる', async () => {
    render(<Flow />)
    await userEvent.click(screen.getByRole('button', { name: 'どちらでもありません' }))
    expect(screen.queryByRole('listbox', { name: 'お客様の候補' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('お名前'), '山田 太郎')
    expect(screen.getByLabelText('お名前')).toHaveValue('山田 太郎')
  })

  it('「番号を入れ直す」で候補が閉じ、お電話番号の欄が空になる', async () => {
    render(<Flow />)
    await userEvent.click(screen.getByRole('button', { name: '番号を入れ直す' }))
    expect(screen.queryByRole('listbox', { name: 'お客様の候補' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('お電話番号')).toHaveValue('')
    expect(screen.getByLabelText('お電話番号')).toHaveFocus()
  })

  it('「どちらでもありません」で閉じてもお電話番号の値は消えない', async () => {
    render(<Flow />)
    await userEvent.click(screen.getByRole('button', { name: 'どちらでもありません' }))
    expect(screen.getByLabelText('お電話番号')).toHaveValue('09012345678')
  })
})

describe('非モーダル', () => {
  it('候補が開いてもフォーカスは電話番号の欄に残る（残りの桁が打てる）', async () => {
    render(<Flow phone="0901234567" />)
    const phone = screen.getByLabelText('お電話番号')
    expect(screen.queryByRole('listbox', { name: 'お客様の候補' })).not.toBeInTheDocument()

    await userEvent.type(phone, '8')
    expect(screen.getByRole('listbox', { name: 'お客様の候補' })).toBeVisible()
    expect(phone).toHaveFocus()
  })

  it('下矢印で候補へ降り、上矢印でお電話番号の欄へ戻る', async () => {
    render(<Flow />)
    await userEvent.keyboard('{ArrowDown}')
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    const [strong, weak] = options()
    expect(
      within(strong as HTMLElement).getByRole('button', { name: 'このお客様で進む' }),
    ).toHaveFocus()

    await userEvent.keyboard('{ArrowDown}')
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    expect(
      within(weak as HTMLElement).getByRole('button', { name: 'このお客様で進む' }),
    ).toHaveFocus()

    // いちばん下でもう一度押しても、外へは出ない。
    await userEvent.keyboard('{ArrowDown}')
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{ArrowUp}')
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')

    await userEvent.keyboard('{ArrowUp}')
    for (const option of options()) expect(option).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByLabelText('お電話番号')).toHaveFocus()
  })

  it('aria-modal を付けない（右下の「録音中」が読み上げから外れない）', () => {
    render(<Flow />)
    expect(popover()).not.toHaveAttribute('aria-modal')
    const recording = screen.getByText('録音中 02:14')
    expect(recording).toBeVisible()
    expect(recording.closest('[aria-hidden="true"]')).toBeNull()
    expect(recording.closest('[inert]')).toBeNull()
  })

  it('件数の知らせ「同じ番号のご来店が2件見つかりました。」は role="status" で 1 度だけ伝わる', () => {
    render(<Flow />)
    const told = screen.getAllByText('同じ番号のご来店が2件見つかりました。')
    expect(told).toHaveLength(1)
    expect(told[0]?.closest('[role="status"]')).not.toBeNull()
    expect(told[0]?.closest('[role="alert"]')).toBeNull()
  })

  it('Esc で候補だけが閉じ、フォーカスはお電話番号の欄へ戻る', async () => {
    render(<Flow />)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox', { name: 'お客様の候補' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('お電話番号')).toHaveFocus()
    expect(screen.getByLabelText('お電話番号')).toHaveValue('09012345678')
    expect(screen.getByText('録音中 02:14')).toBeVisible()
  })

  it('外側を押しても候補だけが閉じ、入力値は消えない', async () => {
    render(<Flow />)
    await userEvent.click(screen.getByText('録音中 02:14'))
    expect(screen.queryByRole('listbox', { name: 'お客様の候補' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('お電話番号')).toHaveValue('09012345678')
  })
})

describe('欄の文言', () => {
  it('「お選びになると入ります」は欄を読み上げたときにも手順として読まれる', () => {
    render(<Flow />)
    const name = screen.getByLabelText('お名前')
    expect(name).toHaveAccessibleDescription('お選びになると入ります')
    // 飾りではなく手順なので、薄い文字（--color-ink-faint）で描かない。
    const hint = screen.getByText('お選びになると入ります')
    expect(hint).toHaveClass('text-ink-muted')
    expect(hint.className).not.toContain('ink-faint')
  })
})

describe('読み込み中・空・エラー・権限なし', () => {
  const noop = () => {}

  it('照会している間は「お調べしています…」を割り込まない知らせで出す', () => {
    render(
      <CustomerMatch
        candidates={[]}
        phase="loading"
        onSelect={noop}
        onDismiss={noop}
        onReenter={noop}
      />,
    )
    const told = screen.getByText('同じ番号のご来店をお調べしています…')
    expect(told.closest('[role="status"]')).not.toBeNull()
  })

  it('当てはまる方がいないときは、次の行動の 1 行を添えて行き止まりにしない', () => {
    render(<CustomerMatch candidates={[]} onSelect={noop} onDismiss={noop} onReenter={noop} />)
    expect(screen.getByText('同じ番号のご来店は見つかりませんでした。')).toBeVisible()
    expect(screen.getByRole('button', { name: '番号を入れ直す' })).toBeEnabled()
  })

  it('照会に失敗したときは、やり直せることまで出す', () => {
    render(
      <CustomerMatch
        candidates={[]}
        phase="error"
        onSelect={noop}
        onDismiss={noop}
        onReenter={noop}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      '同じ番号のご来店をお調べできませんでした。もう一度お試しいただくか、お名前で承れます。',
    )
  })

  it('権限がないときは、お客様の名前も件数も出さない', () => {
    render(
      <CustomerMatch
        candidates={[HANAKO, ICHIRO]}
        phase="forbidden"
        onSelect={noop}
        onDismiss={noop}
        onReenter={noop}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('この画面は店長だけがご覧になれます')
    expect(screen.queryByText('田中 花子 様')).not.toBeInTheDocument()
    expect(screen.queryByText('同じ番号のご来店が2件見つかりました。')).not.toBeInTheDocument()
  })
})
