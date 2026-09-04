import type { CustomerCandidate } from '@app/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmStep } from './ConfirmStep'
import { type CustomerDraft, CustomerStep, customerStepReady } from './CustomerStep'
import { nextButtonLabel } from './steps'

/*
 * 工程 4 お客様（承認済みモック docs/frontend/mockups/eye/images/BOOK-04-CUSTOMER.png と
 * BOOK-04c-KEYPAD.png）。
 *
 * この面の仕事は「受話器を持ったまま片手で番号を打ち切り、伺えないときはお名前だけで進む」こと。
 *
 * 実測値（screens/BOOK-04-CUSTOMER.html / BOOK-04c-KEYPAD.html と assets/eye.css）:
 *   本文 1fr ／ 右の柱 372px、本文の余白 36px 44px・柱 36px 28px。
 *   番号の欄は 幅 420px・最小高 96px・34px のモノスペース（テンキーを開くと 520px / 104px）。
 *   お名前とふりがなは 2 列・間 26px・最大 700px・最小高 60px。ご要望の箱は最小高 168px。
 *   テンキーは 3 列 × 96px・間 12px、キーの高さ 72px、角 12px。
 *
 * **候補の吹き出し（BOOK-04b-CUSTOMER-MATCH）はこの工程では作らない。**候補の元になる
 * `customers` は P4（`007-customer-records`）で初めてできるので、ここでは番号を打ち終えて
 * お名前の欄へ進むところまでを持つ。
 */

const NOW = '2026-08-27T02:08:00.000Z' // 11:08 JST
const STARTS_AT = '2026-08-27T02:00:00.000Z' // 11:00 JST
const ENDS_AT = '2026-08-27T03:00:00.000Z' // 12:00 JST

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
  customerId: null,
  notes: [],
}

/**
 * 受付の器。工程は props だけを受け取る部品なので、下の帯（工程の札・録音・「次へ進む」）と
 * 工程のあいだの持ち回りは器の仕事である。器がどう配線すればよいかをここで固定する。
 * 「次へ進む」の押せる・押せないは `customerStepReady` が決める（同じ判断を器で書き直さない）。
 */
function Flow({
  initial = EMPTY,
  onLookup = async () => [],
}: {
  initial?: CustomerDraft
  onLookup?: (phoneDigits: string) => Promise<readonly CustomerCandidate[]>
}) {
  const [value, setValue] = useState<CustomerDraft>(initial)
  const [step, setStep] = useState<4 | 5>(4)
  const gate = customerStepReady(value)
  if (step === 5) {
    return (
      <ConfirmStep
        storeName="EYE 銀座店"
        startsAt={STARTS_AT}
        endsAt={ENDS_AT}
        durationMinutes={60}
        purposeNames={['メガネを新しく作る']}
        customerName={value.nameTyped}
        phoneDigits={value.phoneTyped}
        staffName="佐藤 美咲"
        equipmentNames={['視力測定機 A']}
        holdExpiresAt={null}
        now={NOW}
        onJumpTo={() => {}}
        onKeepEditing={() => {}}
      />
    )
  }
  return (
    <>
      <CustomerStep
        value={value}
        onChange={setValue}
        soFar={SO_FAR}
        writer="山田 大輔（店長）"
        now={NOW}
        onLookup={onLookup}
      />
      <footer>
        <ol aria-label="予約の工程　全5工程">
          <li aria-current="step">4　お客様</li>
        </ol>
        <p role="status">録音中　02:14</p>
        <button
          type="button"
          disabled={!gate.canProceed}
          aria-label={nextButtonLabel(gate)}
          onClick={() => setStep(5)}
        >
          ›
        </button>
      </footer>
    </>
  )
}

function keypad(): HTMLElement {
  return screen.getByRole('group', { name: '電話番号のテンキー' })
}

async function press(...keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    await userEvent.click(within(keypad()).getByRole('button', { name: key }))
  }
}

async function openKeypad(): Promise<void> {
  await userEvent.click(screen.getByLabelText('お電話番号'))
}

describe('工程 4', () => {
  it('お客様が決まるまで「次へ進む」が押せず「お客様が決まると進めます」が読み上げられる', () => {
    render(<Flow />)
    const next = screen.getByRole('button', { name: /次へ進む/ })
    expect(next).toBeDisabled()
    expect(next).toHaveAccessibleName('次へ進む　お客様が決まると進めます')
  })
})

describe('テンキー', () => {
  it('番号の欄を押すと右にテンキーが出て、iPadOS のソフトキーボードは出ない', async () => {
    render(<Flow />)
    expect(screen.queryByRole('group', { name: '電話番号のテンキー' })).not.toBeInTheDocument()
    await openKeypad()
    expect(keypad()).toBeVisible()
    // テンキーで打つ欄はソフトキーボードを出さない（`07-nfr.md` §2.9）。
    expect(screen.getByLabelText('お電話番号')).toHaveAttribute('inputmode', 'none')
    expect(screen.getByLabelText('お電話番号')).toHaveAttribute('type', 'tel')
    expect(screen.getByLabelText('お電話番号')).toHaveAttribute('autocomplete', 'off')
  })

  it('「090-1234-5」まで打つと「あと3桁」と出て「完了」が押せない', async () => {
    render(<Flow />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5')
    expect(screen.getByLabelText('お電話番号')).toHaveValue('090-1234-5')
    expect(screen.getByText('あと3桁')).toBeVisible()
    expect(screen.getByText('あと3桁で「完了」を押せます')).toBeVisible()
    const done = within(keypad()).getByRole('button', { name: /完了/ })
    expect(done).toBeDisabled()
    expect(done).toHaveAccessibleName('完了　あと3桁で押せます')
    expect(screen.getByRole('button', { name: /次へ進む/ })).toBeDisabled()
  })

  it('残り 3 桁を打つと「完了」が押せるようになる', async () => {
    render(<Flow />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    expect(screen.getByLabelText('お電話番号')).toHaveValue('090-1234-5678')
    expect(screen.queryByText(/^あと\d+桁$/)).not.toBeInTheDocument()
    expect(within(keypad()).getByRole('button', { name: '完了' })).toBeEnabled()
  })

  it('「削除」で 1 文字消え、残り桁数の表示が追いかける', async () => {
    render(<Flow />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    await press('削除')
    expect(screen.getByLabelText('お電話番号')).toHaveValue('090-1234-567')
    expect(screen.getByText('あと1桁')).toBeVisible()
    await press('削除')
    expect(screen.getByLabelText('お電話番号')).toHaveValue('090-1234-56')
    expect(screen.getByText('あと2桁')).toBeVisible()
  })

  it('テンキーを使っている間も、工程の帯と録音の表示が見えている', async () => {
    render(<Flow />)
    await openKeypad()
    await press('0', '9', '0')
    expect(screen.getByRole('list', { name: '予約の工程　全5工程' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('録音中')
    // テンキーは面をかぶせない（かぶせると帯が隠れる）。
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('同じお電話番号のご登録が無ければ、フォーカスがお名前の欄へ移る', async () => {
    render(<Flow />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    await press('完了')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('お名前')))
    expect(screen.queryByRole('group', { name: '電話番号のテンキー' })).not.toBeInTheDocument()
  })

  it('打ち終えた番号は工程 5 の要約にそのまま出る', async () => {
    render(<Flow initial={{ ...EMPTY, nameTyped: '田中 花子' }} />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    await press('完了')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('お名前')))
    await userEvent.click(screen.getByRole('button', { name: '次へ進む' }))
    const summary = screen.getByRole('complementary', { name: '確保する内容' })
    expect(within(summary).getByText('田中 花子 様')).toBeVisible()
    expect(within(summary).getByText('090-1234-5678')).toBeVisible()
  })
})

const HANAKO: CustomerCandidate = {
  customer: {
    id: 'c0000000-0000-4000-8000-000000000008',
    customerNumber: 'G-01842',
    name: '田中 花子',
    kana: 'たなか はなこ',
    phone: '09012345678',
    visitCount: 4,
    lastVisitAt: '2026-05-12',
    memoShort: '',
  },
  match: 'strong',
  lastVisitAt: '2026-05-12',
  currentPrescription: null,
  lastStaffName: '佐藤 美咲',
  attentionSummary: '金属アレルギー',
}

const ICHIRO: CustomerCandidate = {
  customer: {
    id: 'c0000000-0000-4000-8000-000000000009',
    customerNumber: 'G-02180',
    name: '田中 一郎',
    kana: '',
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

describe('候補の吹き出し（BOOK-04b-CUSTOMER-MATCH）', () => {
  it('11 桁を打ち終えて「完了」を押すと候補が開き、フォーカスはお電話番号の欄に残る', async () => {
    const onLookup = vi.fn().mockResolvedValue([HANAKO, ICHIRO])
    render(<Flow onLookup={onLookup} />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    await press('完了')
    expect(onLookup).toHaveBeenCalledWith('09012345678')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
    const dialog = screen.getByRole('dialog', { name: 'お客様の候補' })
    expect(within(dialog).getByText('同じ番号のご来店が2件見つかりました。')).toBeVisible()
    // AC-CUST-21: 候補が開いてもフォーカスはお電話番号の欄に残る。
    expect(document.activeElement).toBe(screen.getByLabelText('お電話番号'))
    // お名前の欄はまだ「お選びになると入ります」のまま（自動で確定しない）。
    expect(screen.getByLabelText('お名前')).toHaveValue('')
  })

  it('候補が出ている間、お名前とふりがなの欄は「お選びになると入ります」を手順として持つ', async () => {
    // AC-CUST-05 / AC-CUST-22。飾りではなく手順なので、欄を読み上げたときにも読まれる
    // （`aria-describedby`）ところまでを固定する。
    const onLookup = vi.fn().mockResolvedValue([HANAKO, ICHIRO])
    render(<Flow onLookup={onLookup} />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    await press('完了')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))

    expect(screen.getByLabelText('お名前')).toHaveAccessibleDescription('お選びになると入ります')
    expect(screen.getByLabelText('ふりがな')).toHaveAccessibleDescription('お選びになると入ります')
    // 薄い飾り（`text-ink-faint`）で描かない。
    for (const hint of screen.getAllByText('お選びになると入ります')) {
      expect(hint).toHaveClass('text-ink-muted')
    }

    // 1 件を選ぶと欄が埋まるので、手順の 1 行は消える。
    await userEvent.click(
      screen.getAllByRole('button', { name: 'このお客様で進む' })[0] as HTMLElement,
    )
    expect(screen.queryByText('お選びになると入ります')).not.toBeInTheDocument()
  })

  it('候補を選ぶとお名前とふりがなが入り、引き継がれる内容が右に出る', async () => {
    const onLookup = vi.fn().mockResolvedValue([HANAKO, ICHIRO])
    render(<Flow onLookup={onLookup} />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    await press('完了')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))

    await userEvent.click(
      screen.getAllByRole('button', { name: 'このお客様で進む' })[0] as HTMLElement,
    )
    expect(screen.getByLabelText('お名前')).toHaveValue('田中 花子')
    expect(screen.getByLabelText('ふりがな')).toHaveValue('たなか はなこ')
    expect(
      screen.getByRole('complementary', { name: 'お選びになると引き継がれること' }),
    ).toHaveTextContent('佐藤 美咲')
    expect(screen.queryByRole('dialog', { name: 'お客様の候補' })).not.toBeInTheDocument()
  })

  it('Esc または「どちらでもありません」で閉じ、フォーカスがお電話番号の欄へ戻る', async () => {
    const onLookup = vi.fn().mockResolvedValue([HANAKO, ICHIRO])
    render(<Flow onLookup={onLookup} />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    await press('完了')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))

    await userEvent.click(screen.getByRole('button', { name: 'どちらでもありません' }))
    expect(screen.queryByRole('dialog', { name: 'お客様の候補' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByLabelText('お電話番号'))
    // 退けても打った番号は消えない。
    expect(screen.getByLabelText('お電話番号')).toHaveValue('090-1234-5678')
    // お名前は手で入れられる。
    await userEvent.type(screen.getByLabelText('お名前'), '田中 花子')
    expect(screen.getByLabelText('お名前')).toHaveValue('田中 花子')
  })

  it('「番号を入れ直す」は打った桁を捨ててテンキーを開き直す', async () => {
    const onLookup = vi.fn().mockResolvedValue([HANAKO])
    render(<Flow onLookup={onLookup} />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    await press('完了')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))

    await userEvent.click(screen.getByRole('button', { name: '番号を入れ直す' }))
    expect(screen.getByLabelText('お電話番号')).toHaveValue('')
    expect(keypad()).toBeVisible()
  })

  it('録音の表示は候補が開いている間も読み上げから外れない（非モーダル）', async () => {
    const onLookup = vi.fn().mockResolvedValue([HANAKO])
    render(<Flow onLookup={onLookup} />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    await press('完了')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(screen.getByRole('dialog', { name: 'お客様の候補' })).not.toHaveAttribute('aria-modal')
    expect(screen.getAllByRole('status').some((el) => el.textContent?.includes('録音中'))).toBe(
      true,
    )
  })
})

describe('名前だけ', () => {
  it('お名前「田中 花子」とふりがな「たなか はなこ」だけで「次へ進む」が押せる', async () => {
    render(<Flow />)
    await userEvent.type(screen.getByLabelText('お名前'), '田中 花子')
    await userEvent.type(screen.getByLabelText('ふりがな'), 'たなか はなこ')
    const next = screen.getByRole('button', { name: '次へ進む' })
    expect(next).toBeEnabled()
    expect(screen.getByLabelText('お電話番号')).toHaveValue('')
  })
})

describe('ふりがな', () => {
  function compose(field: HTMLElement, kana: string): void {
    fireEvent.compositionStart(field)
    fireEvent.compositionUpdate(field, { data: kana })
    fireEvent.change(field, { target: { value: kana } })
  }

  it('変換の確定前はふりがなの欄に未確定の文字が入らない', () => {
    render(<Flow />)
    const name = screen.getByLabelText('お名前')
    compose(name, 'たなか')
    expect(screen.getByLabelText('ふりがな')).toHaveValue('')
    expect(screen.queryByText('自動で入れました')).not.toBeInTheDocument()
  })

  it('変換が確定すると 1 度だけ埋まり、「自動で入れました」の 1 行が出る', () => {
    render(<Flow />)
    const name = screen.getByLabelText('お名前')
    compose(name, 'たなか')
    fireEvent.compositionUpdate(name, { data: '田中' })
    fireEvent.change(name, { target: { value: '田中' } })
    fireEvent.compositionEnd(name, { data: '田中' })
    expect(screen.getByLabelText('ふりがな')).toHaveValue('たなか')
    expect(screen.getByText('自動で入れました')).toBeVisible()
  })

  it('人が一度でも直したふりがなは、そのあと自動で上書きされない', async () => {
    render(<Flow />)
    const name = screen.getByLabelText('お名前')
    compose(name, 'たなか')
    fireEvent.compositionEnd(name, { data: '田中' })
    expect(screen.getByLabelText('ふりがな')).toHaveValue('たなか')

    await userEvent.clear(screen.getByLabelText('ふりがな'))
    await userEvent.type(screen.getByLabelText('ふりがな'), 'たなか はなこ')
    expect(screen.queryByText('自動で入れました')).not.toBeInTheDocument()

    compose(name, 'たなかはなこ')
    fireEvent.compositionEnd(name, { data: '田中 花子' })
    expect(screen.getByLabelText('ふりがな')).toHaveValue('たなか はなこ')
  })
})

describe('工程 4 の状態', () => {
  it('読み込み中は欄の枠だけを出し、回るアイコンを置かない', () => {
    render(
      <CustomerStep
        value={EMPTY}
        onChange={() => {}}
        soFar={SO_FAR}
        writer="山田 大輔（店長）"
        now={NOW}
        onLookup={async () => []}
        phase="loading"
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('読み込んでいます')
    expect(screen.queryByLabelText('お電話番号')).not.toBeInTheDocument()
  })

  it('通信が切れている間は帯を出し、書き込みの操作を押せない', () => {
    render(
      <CustomerStep
        value={EMPTY}
        onChange={() => {}}
        soFar={SO_FAR}
        writer="山田 大輔（店長）"
        now={NOW}
        onLookup={async () => []}
        isOffline
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('通信が切れています')
    expect(screen.getByRole('button', { name: '手書きで書く' })).toBeDisabled()
  })

  it('うまく処理できなかったときと、権限が無いときの 1 文を持つ', () => {
    const { rerender } = render(
      <CustomerStep
        value={EMPTY}
        onChange={() => {}}
        soFar={SO_FAR}
        writer="山田 大輔（店長）"
        now={NOW}
        onLookup={async () => []}
        phase="error"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'うまく処理できませんでした。入力はそのまま残っています。もう一度お試しください。',
    )
    rerender(
      <CustomerStep
        value={EMPTY}
        onChange={() => {}}
        soFar={SO_FAR}
        writer="山田 大輔（店長）"
        now={NOW}
        onLookup={async () => []}
        phase="forbidden"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('この画面は店長だけがご覧になれます')
  })
})

describe('選んだ 1 名を予約へ結び付ける', () => {
  /*
   * 候補から選んでも予約行の `customer_id` が NULL のままだったころ、台帳の帯に
   * お名前も来店回数も出ず（AC-CUST-24 / 25）、来店回数と最後のご来店も一生
   * 増えなかった（AC-CUST-10 / 11。実装不足の洗い出し customers-01）。
   */
  function Watch({ onDraft }: { onDraft: (draft: CustomerDraft) => void }) {
    const [value, setValue] = useState<CustomerDraft>(EMPTY)
    return (
      <CustomerStep
        value={value}
        onChange={(next) => {
          setValue(next)
          onDraft(next)
        }}
        soFar={SO_FAR}
        writer="山田 大輔（店長）"
        now={NOW}
        onLookup={async () => [HANAKO]}
      />
    )
  }

  async function pick(onDraft: (draft: CustomerDraft) => void) {
    render(<Watch onDraft={onDraft} />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    await press('完了')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    await userEvent.click(
      screen.getAllByRole('button', { name: 'このお客様で進む' })[0] as HTMLElement,
    )
  }

  it('候補を押すと、お名前・ふりがなと一緒にその方の id も下書きに入る', async () => {
    const seen: CustomerDraft[] = []
    await pick((draft) => seen.push(draft))
    const last = seen[seen.length - 1]
    expect(last?.customerId).toBe(HANAKO.customer.id)
    expect(last?.nameTyped).toBe(HANAKO.customer.name)
  })

  it('お電話番号を打ち直すと id を捨てる（違う番号の答えを引きずらない）', async () => {
    const seen: CustomerDraft[] = []
    await pick((draft) => seen.push(draft))
    expect(seen[seen.length - 1]?.customerId).toBe(HANAKO.customer.id)

    // 番号の欄を直に書き換えた＝別の番号を打ち始めた。
    fireEvent.change(screen.getByLabelText('お電話番号'), { target: { value: '08099998888' } })
    expect(seen[seen.length - 1]?.customerId).toBeNull()
  })
})
