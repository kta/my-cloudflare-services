import type { CustomerDetail as CustomerDetailShape, Prescription } from '@app/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CustomerDetail } from './CustomerDetail'
import { currentPowerLabel } from './CustomerList'

/*
 * お客様の詳細（承認済みモック docs/frontend/mockups/eyex/images/CUSTOMER-DETAIL.png）。
 *
 * この面の仕事は「前回どう見えていたか」から接客を始めさせること。主役は左の
 * 「度数の移り変わり」1 枚で、いま有効な 1 行に「いま使っています」の札が**文字で**付く。
 *
 * 実測（screens/CUSTOMER-DETAIL.html と assets/eyex.css）:
 *   本文 padding 32px 40px・行 `auto minmax(0,1fr)`・gap 28px、中は 2 列 `1fr 300px`・gap 28px。
 *   お名前 26px/700、ふりがな＋お客様番号 13px、`dt` 13px・`dd` 16px/600・各項目 padding 0 16px。
 *   度数の表: セル padding 12px 6px・下 1px の罫・右寄せ（1 列目だけ左）、見出し行 13px/600、
 *   本体 16px 等幅（1 列目だけ 15px の本文書体）、いま有効な行は --brand-dark の 600。
 *   いまお使いのメガネ: 上に margin 32px・各行 padding 16px 0・題 16px・補足 13px。
 *   右: 注意ごと（--alert）と 次のご予約（--brand-dark）の 2 枚。
 */

const ID = (index: number): string => `c0000000-0000-4000-8000-${String(index).padStart(12, '0')}`

const STORE = 'd0000000-0000-4000-8000-000000000001'

function prescription(
  index: number,
  measuredAt: string,
  rSph: number,
  lSph: number,
  pd: number,
  isCurrent: boolean,
): Prescription {
  return {
    id: ID(index),
    measuredAt,
    rSph,
    lSph,
    rCyl: -0.5,
    lCyl: -0.75,
    rAxis: 180,
    lAxis: 175,
    rAdd: null,
    lAdd: null,
    pd,
    note: '',
    isCurrent,
  }
}

/** 田中 花子 様（モックが描いている 1 名）。 */
const DETAIL: CustomerDetailShape = {
  id: ID(8),
  customerNumber: 'G-01842',
  name: '田中 花子',
  kana: 'たなか はなこ',
  phone: '09012345678',
  visitCount: 4,
  lastVisitAt: '2026-05-12',
  memoShort: 'PC作業用・鼻パッド低め',
  email: null,
  birthDate: null,
  address: '東京都中央区銀座 1-1-1',
  memo: 'PC作業用・鼻パッド低め',
  firstVisitAt: '2024-03-15',
  frequentStaffName: '佐藤 美咲',
  // 応答は測定日の新しい順で来るが、画面でも並べ直して古い順の応答に引きずられないようにする。
  prescriptions: [
    prescription(202, '2025-04-18', -2.25, -2, 62, false),
    prescription(201, '2026-05-12', -2.25, -2, 62, true),
    prescription(203, '2024-03-15', -2, -1.75, 61.5, false),
  ],
  glasses: [
    {
      id: ID(301),
      purchasedAt: '2025-04-20',
      frameName: 'クラシック TR-88 マットブラウン 52□17',
      lensName: '',
      usageLabel: '遠近両用（お出かけ用）',
      note: '',
      isCurrent: true,
    },
    {
      id: ID(302),
      purchasedAt: '2024-03-15',
      frameName: 'ライト AL-12 ガンメタル 50□18',
      lensName: '',
      usageLabel: '近用（PC作業用）',
      note: '',
      isCurrent: true,
    },
    {
      id: ID(303),
      purchasedAt: '2020-01-10',
      frameName: '古いフレーム',
      lensName: '',
      usageLabel: '遠用（もうお使いでない）',
      note: '',
      isCurrent: false,
    },
  ],
  notes: [
    {
      id: ID(401),
      kind: 'attention',
      body: '金属アレルギーのお申し出があります。\nフレームはチタン・樹脂からご案内します。',
      handwritingSvg: null,
      authorId: null,
      authorName: '中村 彩',
      revision: 1,
      status: 'published',
      storeId: STORE,
      createdAt: '2026-05-12T02:00:00.000Z',
    },
    // 申し込みだけの下書きは「注意ごと N件」に数えない（AC-CUST-20）。
    {
      id: ID(402),
      kind: 'attention',
      body: '申し込み中のメモ',
      handwritingSvg: null,
      authorId: null,
      authorName: '中村 彩',
      revision: 1,
      status: 'draft',
      storeId: STORE,
      createdAt: '2026-05-13T02:00:00.000Z',
    },
  ],
  nextReservation: {
    id: ID(501),
    code: 'R-260827-001',
    startsAt: '2026-08-27T02:00:00.000Z',
    durationMinutes: 60,
    status: 'confirmed',
    source: 'phone',
    customerName: '田中 花子',
    visitCount: 4,
    purposeLabel: '新調相談・視力測定',
    staffName: '佐藤 美咲',
  },
  mergedIntoId: null,
  version: 3,
}

const onBack = vi.fn()
const onEdit = vi.fn()
const onStartBooking = vi.fn()
const onOpenHandwriting = vi.fn()

function open(detail: CustomerDetailShape = DETAIL) {
  return render(
    <CustomerDetail
      detail={detail}
      onBack={onBack}
      onEdit={onEdit}
      onStartBooking={onStartBooking}
      onOpenHandwriting={onOpenHandwriting}
    />,
  )
}

/**
 * `getByText` は全角空白を半角 1 つへ潰してから比べる（`getByRole` の名前は潰さない）。
 * モックの文言をそのまま書いて、比べるときだけ同じ変換を通す。
 */
const spaced = (text: string): string => text.replace(/\u3000/g, ' ')

function powerTable(): HTMLElement {
  return screen.getByRole('table', { name: '度数の移り変わり' })
}

function dataRows(): HTMLElement[] {
  return within(powerTable()).getAllByRole('row').slice(1)
}

describe('見出し', () => {
  it('お名前・ふりがな・お客様番号・お電話・ご来店・最後のご来店・よくご担当した者が並ぶ', () => {
    open()
    expect(screen.getByRole('heading', { name: '田中 花子 様' })).toBeInTheDocument()
    const who = screen.getByRole('region', { name: '基本情報' })
    expect(
      within(who).getByText(spaced('たなか はなこ　／　お客様番号 G-01842')),
    ).toBeInTheDocument()
    for (const [term, value] of [
      ['お電話', '090-1234-5678'],
      ['ご来店', '4回'],
      ['最後のご来店', '2026年5月12日'],
      ['よくご担当した者', '佐藤 美咲'],
    ] as const) {
      expect(within(who).getByText(term)).toBeInTheDocument()
      expect(within(who).getByText(value)).toBeInTheDocument()
    }
  })

  it('注意ごとの札の件数が、右の箱の件数と一致する', () => {
    open()
    // 申し込みだけの下書きは数に入らない（published の 1 件だけ）。
    const who = screen.getByRole('region', { name: '基本情報' })
    expect(within(who).getByText('注意ごと 1件')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '注意ごと　1件' })).toBeInTheDocument()
  })
})

describe('度数', () => {
  it('測定日の新しい順に並ぶ', () => {
    open()
    expect(dataRows().map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      '2026年5月12日いま使っています',
      '2025年4月18日',
      '2024年3月15日',
    ])
  })

  it('いま有効な 1 行だけに「いま使っています」の札が文字で付く', () => {
    open()
    expect(screen.getAllByText('いま使っています')).toHaveLength(1)
    const current = dataRows()[0] as HTMLElement
    expect(within(current).getByText('いま使っています')).toBeInTheDocument()
  })

  it('札の付いた行の値が、一覧の要約の「いまの度数」と同じ', () => {
    open()
    const cells = Array.from((dataRows()[0] as HTMLElement).querySelectorAll('td')).map(
      (cell) => cell.textContent ?? '',
    )
    const right = cells[1]?.split('　')[0]
    const left = cells[2]?.split('　')[0]
    expect(currentPowerLabel(DETAIL.prescriptions)).toBe(`R ${right}　／　L ${left}`)
  })

  it('記録が 0 件のときは表の代わりに「度数の記録はまだありません」と次の行動の 1 行を出す', () => {
    open({ ...DETAIL, prescriptions: [] })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('度数の記録はまだありません。')).toBeInTheDocument()
    expect(screen.getByText('ご予約を取って測定すると、ここに記録が残ります。')).toBeInTheDocument()
  })
})

describe('メガネ', () => {
  it('is_current の本数が見出しの「2本」と一致する', () => {
    open()
    expect(screen.getByRole('heading', { name: 'いまお使いのメガネ　2本' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'いまお使いのメガネ' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    // 買い替えで落ちた 1 本は並べない（見出しの数と行数を食い違わせない）。
    expect(screen.queryByText('遠用（もうお使いでない）')).not.toBeInTheDocument()
  })

  it('1 本も無いときは「ご登録がありません」と出す', () => {
    open({ ...DETAIL, glasses: [] })
    expect(screen.getByRole('heading', { name: 'いまお使いのメガネ　0本' })).toBeInTheDocument()
    expect(screen.getByText('ご登録がありません。')).toBeInTheDocument()
  })
})

describe('手書きへの入口', () => {
  it('注意ごと・ご要望の行から手書きメモの面を開く（「内容を直す」の中には置かない）', async () => {
    open()
    const entry = screen.getByRole('button', {
      name: '金属アレルギーのお申し出があります。　手書きメモを見る',
    })
    await userEvent.click(entry)
    expect(onOpenHandwriting).toHaveBeenCalledWith(ID(401))

    const edit = screen.getByRole('button', { name: '内容を直す' })
    expect(edit.textContent).toBe('内容を直す')
    expect(within(edit).queryByText('手書き', { exact: false })).not.toBeInTheDocument()
  })
})

describe('入口', () => {
  it('「この方のご予約を取る」で予約の 5 工程へ、そのお客様を持って渡す', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'この方のご予約を取る' }))
    expect(onStartBooking).toHaveBeenCalledWith(DETAIL.id)

    await userEvent.click(screen.getByRole('button', { name: 'お客様の一覧へ戻る' }))
    expect(onBack).toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '内容を直す' }))
    expect(onEdit).toHaveBeenCalled()
  })
})

describe('200%', () => {
  it('表の列が入らないときは横スクロールの器に入り、名前も時刻も省略しない', () => {
    open()
    const table = powerTable()
    expect(table.parentElement?.className).toContain('overflow-x-auto')
    expect(table.querySelector('thead')?.className).toContain('sticky')
    for (const cell of table.querySelectorAll('td')) {
      expect(cell.className).not.toContain('truncate')
      expect(cell.className).not.toContain('text-ellipsis')
    }
    // 次のご予約の日時も切らない。
    expect(screen.getByText('2026年8月27日（木）11:00').className).not.toContain('truncate')
  })
})

describe('読み込みと行き止まり', () => {
  it('読み込み中・見つからない・読み込めなかった・権限が無いときを持つ', () => {
    const { rerender } = render(
      <CustomerDetail
        detail={null}
        onBack={onBack}
        onEdit={onEdit}
        onStartBooking={onStartBooking}
        onOpenHandwriting={onOpenHandwriting}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe('お客様を読み込んでいます…')

    for (const [phase, message] of [
      ['notFound', 'このお客様は見つかりませんでした。一覧からもう一度お選びください。'],
      ['error', 'お客様を読み込めませんでした。画面を開き直してください。'],
      ['forbidden', '顧客台帳を見る権限がありません。お店の管理者にご確認ください。'],
    ] as const) {
      rerender(
        <CustomerDetail
          detail={null}
          phase={phase}
          onBack={onBack}
          onEdit={onEdit}
          onStartBooking={onStartBooking}
          onOpenHandwriting={onOpenHandwriting}
        />,
      )
      expect(screen.getByRole('alert').textContent).toBe(message)
    }
  })
})
