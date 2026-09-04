import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  type ConflictAlternative,
  type ConflictChoice,
  ConflictNotice,
  type ConflictNoticeProps,
  type ConflictStaffSwap,
} from './ConflictNotice'
import { nextButtonLabel, type StepGuard } from './steps'

/*
 * 枠が先に埋まっていた面（承認済みモック docs/frontend/mockups/eye/images/BOOK-CONFLICT.png）。
 *
 * 実測（screens/BOOK-CONFLICT.html の <style>）:
 *   .flow  = 1fr / 372px。本文 padding 36px 44px、要約 36px 28px・左に 1px の罫
 *   .warn  = padding 26px 28px、見出し 22px（--alert）、本文 15px / 行間 1.6
 *   .lbl   = 上に 32px・下に 12px、14px/700 ＋ 補足 13px（--ink-2）
 *   .alt   = 3 列・min-height 96px、時刻 26px/700 ＋ 設備 13px
 *   .same  = 1 枚・min-height 88px、時刻 26px/700 ＋ 説明 16px/600 ＋ 補足 13px
 *   .sum   = dt 12px（上に 24px）/ dd 17px/600。埋まった時刻は取り消し線（--alert）
 *   .fab   = disabled・aria-label「時刻か担当を選ぶと進めます」
 *
 * 赤はいちばん上の 1 枚だけ。代わりの時刻の札は白のままにして、赤を選択肢へ広げない。
 */

const DATE = '2026-08-27'

function at(clock: string): string {
  return new Date(Date.parse(`${DATE}T${clock}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

const ALTERNATIVES: ConflictAlternative[] = [
  { startsAt: at('14:30'), endsAt: at('15:30'), resourceLabel: '相談カウンター 2' },
  { startsAt: at('15:00'), endsAt: at('16:00'), resourceLabel: '相談カウンター 2' },
  { startsAt: at('15:30'), endsAt: at('16:30'), resourceLabel: '相談カウンター 1' },
]

const SWAP: ConflictStaffSwap = {
  staffId: 'b0000000-0000-4000-8000-000000000002',
  staffName: '小林 学',
  staffSubtitle: '視力測定',
  resourceLabel: '視力測定機 B・相談カウンター 1',
}

/**
 * 受付の器。**この面は自分の帯を持たない** —— 下端の帯は工程 3 のときと同じ 1 本きり
 * （承認済みモック BOOK-CONFLICT の `.stepbar`）で、器が描く。
 */
function Harness({
  onChoose,
  onNext,
  onBackToDate,
  ...overrides
}: Partial<ConflictNoticeProps> & {
  onChoose: (choice: ConflictChoice) => void
  onNext: () => void
  onBackToDate: () => void
}) {
  const [guard, setGuard] = useState<StepGuard>({
    canProceed: false,
    blockedReason: '時刻か担当を選ぶと進めます',
  })
  return (
    <>
      <ConflictNotice
        takenAt={at('11:00')}
        takenLabel="佐藤 美咲・視力測定機 A"
        staffName="佐藤 美咲"
        summary={{
          date: DATE,
          purposeLabel: 'メガネを新しく作る',
          durationMinutes: 60,
          customerLabel: '田中 花子 様',
        }}
        alternatives={ALTERNATIVES}
        staffSwap={SWAP}
        onChoose={onChoose}
        onGuardChange={setGuard}
        onBackToDate={onBackToDate}
        {...overrides}
      />
      <footer>
        <button
          type="button"
          disabled={!guard.canProceed}
          aria-label={nextButtonLabel(guard)}
          onClick={onNext}
        >
          ›
        </button>
      </footer>
    </>
  )
}

function renderNotice(overrides: Partial<ConflictNoticeProps> = {}) {
  const onChoose = vi.fn()
  const onNext = vi.fn()
  const onBackToDate = vi.fn()
  const view = render(
    <Harness onChoose={onChoose} onNext={onNext} onBackToDate={onBackToDate} {...overrides} />,
  )
  const again = (next: Partial<ConflictNoticeProps>) =>
    view.rerender(
      <Harness onChoose={onChoose} onNext={onNext} onBackToDate={onBackToDate} {...next} />,
    )
  return { onChoose, onNext, onBackToDate, again }
}

function nextButton(): HTMLElement {
  return screen.getByRole('button', { name: /次へ進む/ })
}

describe('競合', () => {
  it('「この枠は、ほかの端末で先に確定されました」と出る', () => {
    renderNotice()
    expect(screen.getByRole('alert')).toHaveTextContent('この枠は、ほかの端末で先に確定されました')
  })

  it('伺った内容が残っていることを先に言い、要約の埋まった時刻に取り消し線が付く', () => {
    renderNotice()
    /* 全角空白（U+3000）は jest-dom の正規化で半角 1 つに潰れるが、照合する文字列は
       潰れない。UI が全角空白で区切っている箇所は `\s` で照らす。 */
    expect(screen.getByRole('alert')).toHaveTextContent(
      /11:00\s佐藤 美咲・視力測定機 A が、たった今埋まりました。伺った内容は残っています。時刻か担当を選び直してください。/,
    )
    const gone = screen.getByText('11:00', { selector: 'span.line-through' })
    expect(gone).toBeInTheDocument()
    expect(screen.getByText('埋まりました')).toBeInTheDocument()
    // ほかの入力はそのまま残っている。
    expect(screen.getByText('8月27日（木）')).toBeInTheDocument()
    expect(screen.getByText('メガネを新しく作る（60分）')).toBeInTheDocument()
    expect(screen.getByText('田中 花子 様')).toBeInTheDocument()
  })

  it('同じ担当で案内できる時刻が 3 つ並ぶ', () => {
    renderNotice()
    expect(screen.getByText('同じ担当（佐藤 美咲）でご案内できる時刻')).toBeInTheDocument()
    for (const clock of ['14:30', '15:00', '15:30']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${clock}`) })).toBeInTheDocument()
    }
  })

  it('担当を入れ替える案が 1 つ並ぶ', () => {
    renderNotice()
    expect(screen.getByText('時刻を変えたくない場合')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /担当を 小林 学（視力測定）に変える/ }),
    ).toHaveTextContent('視力測定機 B・相談カウンター 1')
  })

  it('技能が分からない担当では、空の括弧を画面に出さない', () => {
    renderNotice({
      staffSwap: {
        staffId: SWAP.staffId,
        staffName: '小林 学',
        staffSubtitle: '',
        resourceLabel: '',
      },
    })
    expect(screen.getByRole('button', { name: /担当を 小林 学 に変える/ })).toBeInTheDocument()
    expect(screen.queryByText(/（）/)).toBeNull()
  })

  it('どれかを選ぶまで「次へ進む」が押せず、理由が読み上げられる', () => {
    renderNotice()
    expect(nextButton()).toBeDisabled()
    expect(nextButton()).toHaveAccessibleName('次へ進む　時刻か担当を選ぶと進めます')
  })

  it('代わりの時刻を選ぶとその場で押さえ直し、工程 5 へ戻る', async () => {
    const user = userEvent.setup()
    const { onChoose, onNext } = renderNotice()
    await user.click(screen.getByRole('button', { name: /^15:00/ }))
    expect(onChoose).toHaveBeenCalledWith({
      kind: 'time',
      startsAt: at('15:00'),
      endsAt: at('16:00'),
    })
    expect(nextButton()).toBeEnabled()
    await user.click(nextButton())
    expect(onNext).toHaveBeenCalled()
  })

  it('担当を入れ替える案を選ぶと、時刻はそのままで担当だけが変わる', async () => {
    const user = userEvent.setup()
    const { onChoose } = renderNotice()
    await user.click(screen.getByRole('button', { name: /担当を 小林 学/ }))
    expect(onChoose).toHaveBeenCalledWith({
      kind: 'staff',
      staffId: SWAP.staffId,
      startsAt: at('11:00'),
    })
  })

  it('代替が 0 件なら「この時刻に代わるお時間がありません」と「別の日を選ぶ」だけを出す', async () => {
    const user = userEvent.setup()
    const { onBackToDate } = renderNotice({ alternatives: [], staffSwap: null })
    expect(screen.getByText('この時刻に代わるお時間がありません。')).toBeInTheDocument()
    expect(screen.queryByText('同じ担当（佐藤 美咲）でご案内できる時刻')).not.toBeInTheDocument()
    expect(screen.queryByText('時刻を変えたくない場合')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '別の日を選ぶ' }))
    expect(onBackToDate).toHaveBeenCalled()
  })

  it('選び直した枠も埋まっていたら同じ面を出し直す', async () => {
    const user = userEvent.setup()
    const { again } = renderNotice()
    await user.click(screen.getByRole('button', { name: /^15:00/ }))
    expect(nextButton()).toBeEnabled()

    again({
      takenAt: at('15:00'),
      takenLabel: '佐藤 美咲・相談カウンター 2',
      alternatives: [ALTERNATIVES[2] as ConflictAlternative],
      staffSwap: null,
    })
    expect(screen.getByRole('alert')).toHaveTextContent('この枠は、ほかの端末で先に確定されました')
    expect(screen.getByRole('alert')).toHaveTextContent(/15:00\s佐藤 美咲・相談カウンター 2/)
    // 選び直しはやり直しなので、前に選んだものは残さない。
    expect(nextButton()).toBeDisabled()
  })
})
