import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmStep, type ConfirmTarget, type PublicBookingDraft } from './ConfirmStep'
import { FormStep } from './FormStep'

/*
 * 工程 5 ご確認（承認済みモック docs/frontend/mockups/eyex/images/WEB-05-CONFIRM.png）。
 *
 * この面の仕事は「送る前に 5 行で読み返させ、直したい行からその工程へ戻す」こと。
 *
 * 実測値（screens/WEB-05-CONFIRM.html と assets/eyex.css）:
 *   表は上に 28px・角 12px・縁 1px `--color-line`、行の間に 1px の罫（最後の行は無し）。
 *   行は最小高 56px / 内側 12px 16px / 間 12px。見出し列 66px・13px、値 16px 太さ 600、
 *   補足 13px 標準、「変更」は 13px 太さ 600 `--color-pine`。1 行目だけ地が `--color-pine-soft`。
 */

const STARTS_AT = '2026-08-29T02:00:00.000Z' // JST 8月29日（土）11:00

const DRAFT: PublicBookingDraft = {
  storeName: 'EYEX 銀座店',
  purposeName: '新しいメガネを作る',
  durationMinutes: 60,
  startsAt: STARTS_AT,
  contact: {
    name: '山口 真央',
    kana: 'やまぐち まお',
    phone: '080-2345-6789',
    email: 'm.yamaguchi@example.jp',
  },
}

function open(props: Partial<Parameters<typeof ConfirmStep>[0]> = {}) {
  return render(<ConfirmStep draft={DRAFT} onEdit={() => {}} onSubmit={() => {}} {...props} />)
}

function confirm(): HTMLElement {
  return screen.getByRole('button', { name: 'この内容で予約する' })
}

function row(term: string): HTMLElement {
  return screen.getByRole('group', { name: term })
}

/** 「変更」で工程 4 へ戻ったとき、伺った 4 欄がそのまま残っていることを見る器。 */
function Flow() {
  const [step, setStep] = useState<'confirm' | ConfirmTarget>('confirm')
  if (step === 'contact') {
    return <FormStep initialValue={DRAFT.contact} onProceed={() => setStep('confirm')} />
  }
  if (step !== 'confirm') return <p>{`工程：${step}`}</p>
  return <ConfirmStep draft={DRAFT} onEdit={setStep} onSubmit={() => {}} />
}

describe('ご確認', () => {
  it('見出しは「この内容でお間違いないですか」で、補足は「まだ確定していません。」', () => {
    open()
    expect(screen.getByRole('heading', { name: 'この内容でお間違いないですか' })).toBeVisible()
    expect(screen.getByText('まだ確定していません。')).toBeVisible()
  })

  it('5 行（ご来店・店舗・ご用件・お名前・ご連絡先）が入力と一致する', () => {
    open()
    expect(within(row('ご来店')).getByText('8月29日（土）11:00')).toBeVisible()
    expect(within(row('店舗')).getByText('EYEX 銀座店')).toBeVisible()
    expect(within(row('ご用件')).getByText('新しいメガネを作る')).toBeVisible()
    expect(within(row('ご用件')).getByText('約60分')).toBeVisible()
    expect(within(row('お名前')).getByText('山口 真央 様')).toBeVisible()
    expect(within(row('ご連絡先')).getByText('080-2345-6789')).toBeVisible()
    expect(within(row('ご連絡先')).getByText('m.yamaguchi@example.jp')).toBeVisible()
  })

  it('ご用件の行は対客名（新しいメガネを作る）で、店内名を出さない', () => {
    open()
    // 店内名は `visit_purposes.name_internal`（「メガネを新しく作る」）。お客様の面には出さない。
    expect(screen.queryByText('メガネを新しく作る')).not.toBeInTheDocument()
    expect(screen.queryByText(/技能|設備|担当/)).not.toBeInTheDocument()
  })

  it('各行の「変更」を押すと該当の工程へ戻り、入力は保たれる', async () => {
    const onEdit = vi.fn()
    open({ onEdit })
    for (const [term, target] of [
      ['ご来店', 'datetime'],
      ['店舗', 'store'],
      ['ご用件', 'purpose'],
      ['お名前', 'contact'],
      ['ご連絡先', 'contact'],
    ] as const) {
      await userEvent.click(within(row(term)).getByRole('button', { name: `${term}を変更する` }))
      expect(onEdit).toHaveBeenLastCalledWith(target)
    }

    cleanup()
    render(<Flow />)
    await userEvent.click(within(row('お名前')).getByRole('button', { name: 'お名前を変更する' }))
    expect(screen.getByLabelText('お名前')).toHaveValue('山口 真央')
    expect(screen.getByLabelText('ふりがな')).toHaveValue('やまぐち まお')
    expect(screen.getByLabelText('お電話番号')).toHaveValue('080-2345-6789')
    expect(screen.getByLabelText('メールアドレス')).toHaveValue('m.yamaguchi@example.jp')
  })

  it('送信中はボタンの文字が「送信しています…」に変わり、aria-busy が立ち、二度押しできない', async () => {
    const onSubmit = vi.fn()
    open({ onSubmit, submitting: true })
    const button = screen.getByRole('button', { name: '送信しています…' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('送信中も焦点はボタンに残る（disabled 属性にしない）', () => {
    open({ submitting: true })
    const button = screen.getByRole('button', { name: '送信しています…' })
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    button.focus()
    expect(button).toHaveFocus()
  })

  it('送信の瞬間に枠を取られたら、まだ取れていないことを先に言い、埋まった時刻に「満」を付け、同じ日の空いている時刻を並べる', async () => {
    const onPickAlternative = vi.fn()
    open({
      conflict: {
        takenAt: STARTS_AT,
        alternatives: ['2026-08-29T02:30:00.000Z', '2026-08-29T04:00:00.000Z'],
      },
      onPickAlternative,
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'この時間は、ちょうど埋まってしまいました。',
    )
    const taken = screen.getByRole('group', { name: '11:00' })
    expect(within(taken).getByText('満')).toBeVisible()
    expect(taken).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(screen.getByRole('button', { name: '11:30 に予約する' }))
    expect(onPickAlternative).toHaveBeenCalledWith('2026-08-29T02:30:00.000Z')
    expect(screen.getByRole('button', { name: '日時を選び直す' })).toBeVisible()
  })

  it('回線が切れて同じ内容が再送されても、同じ Idempotency-Key を送り続ける', async () => {
    const onSubmit = vi.fn()
    open({ onSubmit })
    await userEvent.click(confirm())
    await userEvent.click(confirm())
    expect(onSubmit).toHaveBeenCalledTimes(2)
    const first = onSubmit.mock.calls[0]?.[0]
    expect(typeof first).toBe('string')
    expect(first).not.toBe('')
    expect(onSubmit.mock.calls[1]?.[0]).toBe(first)
  })
})
