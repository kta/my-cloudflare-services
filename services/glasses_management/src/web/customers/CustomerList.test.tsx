import type { CustomerDetail, CustomerSummary } from '@app/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CustomerList, type CustomerListPhase } from './CustomerList'

/*
 * 顧客台帳の一覧と右の要約（承認済みモック docs/frontend/mockups/eyex/images/CUSTOMER-LIST.png）。
 *
 * この面の仕事は「お名前があいまいなままでも 1 名に手繰り、選んだ 1 名の要約を
 * 一覧を閉じずに右へ出し続ける」こと。見た目の寸法は e2e の突き合わせで見るので、
 * ここでは「何が読めて、何が押せるか」を見る。
 *
 * 実測（screens/CUSTOMER-LIST.html と assets/eyex.css）:
 *   本文 2 ペイン `1fr 360px`。検索欄の帯 padding 16px 20px・下に 1px の罫。
 *   見出し行 34px・地 --surface-2・下に 1px の --line-strong・12px。
 *   行は 4 列 `220px 72px 132px 1fr`・gap 12px・padding 0 20px・min-height 60px。
 *   お名前 16px/600、ふりがな 12px、回数 16px/600 等幅、最後のご来店 13px、覚えておくこと 13px。
 *   選択行は地 --brand-tint ＋ `inset 4px 0 0 --brand`。行は 8 行で切り「ほか 34名」「続きを見る ›」。
 *   右の要約 padding 32px 28px・お名前 21px・4 項目（見出し 13px / 値 17px 600 / 補足 13px）。
 */

const ID = (index: number): string => `c0000000-0000-4000-8000-${String(index).padStart(12, '0')}`

function customer(
  index: number,
  name: string,
  kana: string,
  visitCount: number,
  lastVisitAt: string | null,
  memoShort: string,
  phone: string | null = null,
): CustomerSummary {
  return {
    id: ID(index),
    customerNumber: `G-${String(1000 + index).padStart(5, '0')}`,
    name,
    kana,
    phone,
    visitCount,
    lastVisitAt,
    memoShort,
  }
}

/** モックが描いている 8 行（ふりがなの五十音順）。 */
const HANAKO: CustomerSummary = {
  ...customer(
    8,
    '田中 花子',
    'たなか はなこ',
    4,
    '2026-05-12',
    'PC作業用・鼻パッド低め',
    '09012345678',
  ),
  customerNumber: 'G-01842',
}

const MOCK_ROWS: CustomerSummary[] = [
  customer(1, '相川 みどり', 'あいかわ みどり', 2, '2026-07-03', '調整の途中です'),
  customer(2, '青木 律子', 'あおき りつこ', 4, '2026-06-21', '遠近両用を長くお使い'),
  customer(3, '石井 孝', 'いしい たかし', 2, '2026-08-11', '2回目のご来店です'),
  customer(4, '伊藤 健', 'いとう けん', 2, '2026-08-27', '本日 10:00 に調整'),
  customer(5, '大森 千夏', 'おおもり ちなつ', 2, '2025-12-08', 'まぶしさに弱い'),
  customer(6, '川上 恵', 'かわかみ めぐみ', 0, null, 'お子様の分もご一緒に'),
  customer(7, '木下 亮太', 'きのした りょうた', 2, '2026-02-14', 'ご連絡先が未登録'),
  HANAKO,
]

/** 「当てはまるお客様 42名」「ほか 34名」を作る 34 名。ご来店は 1回 で、2〜4回 の札からは外れる。 */
const REST: CustomerSummary[] = Array.from({ length: 34 }, (_, index) =>
  customer(
    100 + index,
    `松本 ${index + 1}`,
    `まつもと ${String(index + 1).padStart(2, '0')}`,
    1,
    '2026-01-05',
    'ご来店は 1 度だけです',
  ),
)

const ROWS: CustomerSummary[] = [...MOCK_ROWS, ...REST]

const STAFF = 'd0000000-0000-4000-8000-000000000001'

/** 田中 花子 様の要約に要る中身（次のご予約・いまの度数・メガネ・注意ごと）。 */
const HANAKO_DETAIL: CustomerDetail = {
  ...HANAKO,
  email: null,
  birthDate: null,
  address: '東京都中央区銀座 1-1-1',
  memo: 'PC作業用・鼻パッド低め',
  firstVisitAt: '2024-03-15',
  frequentStaffName: '佐藤 美咲',
  prescriptions: [
    {
      id: ID(201),
      measuredAt: '2026-05-12',
      rSph: -2.25,
      lSph: -2,
      rCyl: -0.5,
      lCyl: -0.75,
      rAxis: 180,
      lAxis: 175,
      rAdd: null,
      lAdd: null,
      pd: 62,
      note: '',
      isCurrent: true,
    },
    {
      id: ID(202),
      measuredAt: '2025-04-18',
      rSph: -2.25,
      lSph: -2,
      rCyl: -0.5,
      lCyl: -0.75,
      rAxis: 180,
      lAxis: 175,
      rAdd: null,
      lAdd: null,
      pd: 62,
      note: '',
      isCurrent: false,
    },
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
  ],
  notes: [
    {
      id: ID(401),
      kind: 'attention',
      body: '金属アレルギー\nフレームはチタン・樹脂から',
      handwritingSvg: null,
      authorId: null,
      authorName: '中村 彩',
      revision: 1,
      status: 'published',
      storeId: STAFF,
      createdAt: '2026-05-12T02:00:00.000Z',
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

const DETAILS: Record<string, CustomerDetail> = { [HANAKO.id]: HANAKO_DETAIL }

const onOpenDetail = vi.fn()
const onStartBooking = vi.fn()
const onCreate = vi.fn()
const onConditions = vi.fn()

/**
 * 器のふるまい（選ばれた 1 名の要約を取り直す）だけを写した殻。
 * 一覧そのものが持つ状態（検索語・並べ方・絞り込み・選択）は部品の中にある。
 */
function Harness({
  items = ROWS,
  phase,
  onRetry,
}: {
  items?: CustomerSummary[] | null
  phase?: CustomerListPhase
  onRetry?: () => void
}) {
  const [summary, setSummary] = useState<CustomerDetail | null>(null)
  return (
    <CustomerList
      items={items}
      phase={phase}
      summary={summary}
      onSelect={(id) => setSummary(id === null ? null : (DETAILS[id] ?? null))}
      onOpenDetail={onOpenDetail}
      onStartBooking={onStartBooking}
      onCreate={onCreate}
      onConditions={onConditions}
      onRetry={onRetry}
    />
  )
}

/** 各行の読み上げ名の先頭（お名前）。行そのものが選べるので名前は `aria-label` に畳んである。 */
function rowNames(): (string | undefined)[] {
  return screen.getAllByRole('option').map((row) => row.getAttribute('aria-label')?.split('　')[0])
}

/**
 * `getByText` は全角空白を半角 1 つへ潰してから比べる（`getByRole` の名前は潰さない）。
 * モックの文言をそのまま書いて、比べるときだけ同じ変換を通す。
 */
const spaced = (text: string): string => text.replace(/\u3000/g, ' ')

async function search(text: string): Promise<void> {
  const field = screen.getByRole('searchbox', { name: 'お名前・電話番号　一部でも探せます' })
  await userEvent.clear(field)
  if (text !== '') await userEvent.type(field, text)
}

describe('一覧', () => {
  it('列は お名前 / ご来店 / 最後のご来店 / 覚えておくこと の 4 つ', () => {
    render(<Harness />)
    for (const label of ['お名前', 'ご来店', '最後のご来店', '覚えておくこと']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // 見出しの帯は飾りで、値そのものは各行の読み上げ名に畳んである。
    expect(screen.getByRole('option', { name: /田中 花子 様/ }).getAttribute('aria-label')).toBe(
      '田中 花子 様　たなか はなこ　ご来店 4回　最後のご来店 2026年5月12日　PC作業用・鼻パッド低め',
    )
  })

  it('1 画面に出る行は 8 行までで、続きは「ほか 34名」と「続きを見る」に逃がす', async () => {
    render(<Harness />)
    expect(screen.getAllByRole('option')).toHaveLength(8)
    expect(rowNames()).toEqual([
      '相川 みどり 様',
      '青木 律子 様',
      '石井 孝 様',
      '伊藤 健 様',
      '大森 千夏 様',
      '川上 恵 様',
      '木下 亮太 様',
      '田中 花子 様',
    ])
    expect(screen.getByText('当てはまるお客様 42名')).toBeInTheDocument()
    expect(screen.getByText('ほか 34名')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '続きを見る' }))
    expect(screen.getAllByRole('option')).toHaveLength(16)
    expect(screen.getByText('ほか 26名')).toBeInTheDocument()
  })

  it('来店が 0 件の行は「初」と出て、最後のご来店は「—」', () => {
    render(<Harness />)
    const row = screen.getByRole('option', { name: /川上 恵 様/ })
    expect(within(row).getByText('初')).toBeInTheDocument()
    expect(within(row).getByText('—')).toBeInTheDocument()
  })
})

describe('検索', () => {
  it('「5678」と入れると 090-1234-5678 の行だけが残る', async () => {
    render(<Harness />)
    await search('5678')
    expect(rowNames()).toEqual(['田中 花子 様'])
    expect(screen.getByText('当てはまるお客様 1名')).toBeInTheDocument()
  })

  it('「1234」では残らない', async () => {
    render(<Harness />)
    await search('1234')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.queryByText('田中 花子 様')).not.toBeInTheDocument()
  })

  it('「たなか」でも「花子」でも同じ行が残る', async () => {
    render(<Harness />)
    await search('たなか')
    expect(rowNames()).toEqual(['田中 花子 様'])
    await search('花子')
    expect(rowNames()).toEqual(['田中 花子 様'])
  })

  it('当てはまるお客様が 0 名のとき、見出し 1 行・理由 1 行・「検索をやめて全件を見る」の 3 つだけを出す', async () => {
    render(<Harness />)
    await search('9999')

    const notice = screen.getByRole('status')
    expect(notice.children).toHaveLength(3)
    expect(
      within(notice).getByRole('heading', { name: '「9999」で当てはまるお客様はいません。' }),
    ).toBeInTheDocument()
    expect(
      within(notice).getByText('お電話番号は下 4 桁の一致で探しています。'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    // 行き止まりにしない。
    await userEvent.click(within(notice).getByRole('button', { name: '検索をやめて全件を見る' }))
    expect(screen.getAllByRole('option')).toHaveLength(8)
  })
})

describe('並べ方と絞り込み', () => {
  it('「ご来店の回数順」に切り替えると回数の多い順になる', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'ご来店の回数順' }))
    expect(rowNames().slice(0, 2)).toEqual(['青木 律子 様', '田中 花子 様'])
    expect(onConditions).toHaveBeenCalledWith({ query: '', sort: 'visits', visitRange: null })
  })

  it('絞り込みが持つ条件はご来店の回数の 4 段（初 / 1回 / 2〜4回 / 5回以上）だけ', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    const group = screen.getByRole('group', { name: 'ご来店の回数で絞り込む' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['初', '1回', '2〜4回', '5回以上'])
  })

  it('札を付けても、選んでいた行の選択が外れない', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('option', { name: /田中 花子 様/ }))
    expect(screen.getByRole('option', { name: /田中 花子 様/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await userEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    await userEvent.click(
      within(screen.getByRole('group', { name: 'ご来店の回数で絞り込む' })).getByRole('button', {
        name: '2〜4回',
      }),
    )

    expect(screen.getByText('ご来店 2〜4回')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /田中 花子 様/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(
      within(screen.getByRole('complementary')).getByRole('heading', { name: '田中 花子 様' }),
    ).toBeInTheDocument()
  })

  it('右上の人数が絞り込み後の数になる', async () => {
    render(<Harness />)
    expect(screen.getByText('当てはまるお客様 42名')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '絞り込み' }))
    await userEvent.click(
      within(screen.getByRole('group', { name: 'ご来店の回数で絞り込む' })).getByRole('button', {
        name: '2〜4回',
      }),
    )
    expect(screen.getByText('当てはまるお客様 7名')).toBeInTheDocument()
  })
})

describe('要約', () => {
  it('行を選ぶと、次のご予約・いまの度数・いまお使いのメガネ・注意ごとが同時に出る', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('option', { name: /田中 花子 様/ }))

    const pane = screen.getByRole('complementary')
    expect(within(pane).getByRole('heading', { name: '田中 花子 様' })).toBeInTheDocument()
    expect(within(pane).getByText(spaced('たなか はなこ　／　G-01842'))).toBeInTheDocument()
    expect(within(pane).getByText('次のご予約')).toBeInTheDocument()
    expect(within(pane).getByText('8月27日（木）11:00')).toBeInTheDocument()
    expect(within(pane).getByText('新調相談・視力測定／担当 佐藤 美咲')).toBeInTheDocument()
    expect(within(pane).getByText('いまの度数')).toBeInTheDocument()
    expect(within(pane).getByText(spaced('R -2.25　／　L -2.00'))).toBeInTheDocument()
    expect(within(pane).getByText('2026年5月12日 測定／PD 62.0 mm')).toBeInTheDocument()
    expect(within(pane).getByText('いまお使いのメガネ')).toBeInTheDocument()
    expect(within(pane).getByText('2本')).toBeInTheDocument()
    expect(within(pane).getByText('遠近両用（お出かけ用）・近用（PC作業用）')).toBeInTheDocument()
    expect(within(pane).getByText('注意ごと')).toBeInTheDocument()
  })

  it('要約に度数の履歴表は出さない', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('option', { name: /田中 花子 様/ }))
    expect(within(screen.getByRole('complementary')).queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('2025年4月18日')).not.toBeInTheDocument()
  })

  it('注意ごとは色だけでなく「注意ごと」という文字を持つ', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('option', { name: /田中 花子 様/ }))
    const pane = screen.getByRole('complementary')
    expect(within(pane).getByText('注意ごと')).toBeInTheDocument()
    expect(within(pane).getByText('金属アレルギー')).toBeInTheDocument()
    expect(within(pane).getByText('フレームはチタン・樹脂から')).toBeInTheDocument()
  })
})

describe('入口', () => {
  it('「くわしく見る」で詳細の面へ、「ご予約を取る」で予約の 5 工程へ渡す', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('option', { name: /田中 花子 様/ }))

    await userEvent.click(screen.getByRole('button', { name: 'くわしく見る' }))
    expect(onOpenDetail).toHaveBeenCalledWith(HANAKO.id)

    await userEvent.click(screen.getByRole('button', { name: 'ご予約を取る' }))
    expect(onStartBooking).toHaveBeenCalledWith(HANAKO.id)

    await userEvent.click(screen.getByRole('button', { name: '新しいお客様を登録' }))
    expect(onCreate).toHaveBeenCalled()
  })
})

describe('読み込み中', () => {
  it('行の高さを保った灰色の帯を 8 本置き、回るアイコンを置かない', () => {
    const { container } = render(<Harness items={null} />)
    expect(screen.getByRole('status').textContent).toBe('お客様の一覧を読み込んでいます…')
    const bars = container.querySelectorAll('ul[aria-hidden="true"] > li')
    expect(bars).toHaveLength(8)
    expect(bars[0]?.className).toContain('min-h-15')
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('読み込めなかったときと、権限が無いときは理由を出す', () => {
    const { rerender } = render(<Harness items={null} phase="error" />)
    expect(screen.getByRole('alert').textContent).toBe(
      'お客様の一覧を読み込めませんでした。通信が切れているかもしれません。',
    )
    rerender(<Harness items={null} phase="forbidden" />)
    expect(screen.getByRole('alert').textContent).toBe(
      '顧客台帳を見る権限がありません。お店の管理者にご確認ください。',
    )
  })

  it('読み込めなかったときは行き止まりにせず「もう一度読み込む」から引き直せる', async () => {
    // 通信が切れたときもここへ落ちる。この製品に router は無く「画面を開き直す」道が
    // 無いので、同じ場所から引き直せることを固定する。
    const onRetry = vi.fn()
    render(<Harness items={null} phase="error" onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('権限が無いときは「もう一度読み込む」を出さない', () => {
    // 引き直しても答えは変わらない。押して何も変わらないボタンを置かない。
    render(<Harness items={null} phase="forbidden" onRetry={() => {}} />)
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).not.toBeInTheDocument()
  })
})
