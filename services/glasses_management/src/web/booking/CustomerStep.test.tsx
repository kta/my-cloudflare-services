import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ConfirmStep } from './ConfirmStep'
import { type CustomerDraft, CustomerStep, customerStepReady } from './CustomerStep'
import { nextButtonLabel } from './steps'

/*
 * 工程 4 お客様（承認済みモック docs/frontend/mockups/eyex/images/BOOK-04-CUSTOMER.png と
 * BOOK-04c-KEYPAD.png）。
 *
 * この面の仕事は「受話器を持ったまま片手で番号を打ち切り、伺えないときはお名前だけで進む」こと。
 *
 * 実測値（screens/BOOK-04-CUSTOMER.html / BOOK-04c-KEYPAD.html と assets/eyex.css）:
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
  notes: [],
}

/**
 * 受付の器。工程は props だけを受け取る部品なので、下の帯（工程の札・録音・「次へ進む」）と
 * 工程のあいだの持ち回りは器の仕事である。器がどう配線すればよいかをここで固定する。
 * 「次へ進む」の押せる・押せないは `customerStepReady` が決める（同じ判断を器で書き直さない）。
 */
function Flow({ initial = EMPTY }: { initial?: CustomerDraft }) {
  const [value, setValue] = useState<CustomerDraft>(initial)
  const [step, setStep] = useState<4 | 5>(4)
  const gate = customerStepReady(value)
  if (step === 5) {
    return (
      <ConfirmStep
        storeName="EYEX 銀座店"
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

  it('「完了」を押すとフォーカスがお名前の欄へ移る', async () => {
    render(<Flow />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    await press('完了')
    expect(document.activeElement).toBe(screen.getByLabelText('お名前'))
    expect(screen.queryByRole('group', { name: '電話番号のテンキー' })).not.toBeInTheDocument()
  })

  it('打ち終えた番号は工程 5 の要約にそのまま出る', async () => {
    render(<Flow initial={{ ...EMPTY, nameTyped: '田中 花子' }} />)
    await openKeypad()
    await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
    await press('完了')
    await userEvent.click(screen.getByRole('button', { name: '次へ進む' }))
    const summary = screen.getByRole('complementary', { name: '確保する内容' })
    expect(within(summary).getByText('田中 花子 様')).toBeVisible()
    expect(within(summary).getByText('090-1234-5678')).toBeVisible()
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
        phase="forbidden"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('この画面は店長だけがご覧になれます')
  })
})
