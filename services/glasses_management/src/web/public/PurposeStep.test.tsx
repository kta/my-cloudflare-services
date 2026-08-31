import type { PublicStorePurpose } from '@app/contracts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PurposeStep } from './PurposeStep'

/*
 * 工程 2「ご用件を選ぶ」（承認済みモック docs/frontend/mockups/eyex/images/WEB-02-PURPOSE.png）。
 *
 * 実測（screens/WEB-02-PURPOSE.html の <style>）:
 *   並び 間 10px・上 28px、1 件は最小高 60px・padding 0 16px・角 12px・16px/600
 *   選択中は縁 3px + 地 --brand-tint + padding 0 14px、分数は右寄せ 13px/600 --ink-2、
 *   その下に「選択中」を --brand-dark で改行
 *
 * **モックの 6 件・独自表記は採らない**。出るのは `visit_purposes.name_public` の公開 5 件で、
 * 「修理・部品の交換」は `is_web_published='0'` なので API からも返らない（TODO 0.2 の #2 / #3）。
 */

const PURPOSES: PublicStorePurpose[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: '新しいメガネを作る', durationMinutes: 60 },
  { id: '22222222-2222-4222-8222-222222222222', name: 'かけ具合の調整', durationMinutes: 20 },
  { id: '33333333-3333-4333-8333-333333333333', name: 'できあがりの受け取り', durationMinutes: 20 },
  { id: '44444444-4444-4444-8444-444444444444', name: 'コンタクトのご相談', durationMinutes: 40 },
  { id: '55555555-5555-4555-8555-555555555555', name: '視力測定', durationMinutes: 30 },
]

const PHONE = '03-1234-5678'

describe('ご用件を選ぶ', () => {
  it('見出しは「ご用件をお選びください」で、補足は「お時間は目安です。」', () => {
    render(
      <PurposeStep
        purposes={PURPOSES}
        selectedId={null}
        storePhone={PHONE}
        onSelect={vi.fn()}
        onNext={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'ご用件をお選びください' })).toBeInTheDocument()
    expect(screen.getByText('お時間は目安です。')).toBeInTheDocument()
  })

  it('出るのは対客名だけで、「メガネを新しく作る」は 1 つも出ない', async () => {
    const onSelect = vi.fn()
    render(
      <PurposeStep
        purposes={PURPOSES}
        selectedId={null}
        storePhone={PHONE}
        onSelect={onSelect}
        onNext={vi.fn()}
      />,
    )

    expect(screen.getByRole('radio', { name: /新しいメガネを作る/ })).toBeInTheDocument()
    expect(screen.queryByText('メガネを新しく作る')).toBeNull()
    expect(screen.getByText('約60分')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: /新しいメガネを作る/ }))
    expect(onSelect).toHaveBeenCalledWith(PURPOSES[0])
  })

  it('Web 非公開の「修理・部品の交換」を出さない', () => {
    render(
      <PurposeStep
        purposes={PURPOSES}
        selectedId={null}
        storePhone={PHONE}
        onSelect={vi.fn()}
        onNext={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('radio')).toHaveLength(5)
    expect(screen.queryByText(/修理/)).toBeNull()
  })

  it('目的を選ぶまで「日時を選ぶ」は押せず、理由が読める', async () => {
    const onNext = vi.fn()
    const { rerender } = render(
      <PurposeStep
        purposes={PURPOSES}
        selectedId={null}
        storePhone={PHONE}
        onSelect={vi.fn()}
        onNext={onNext}
      />,
    )

    const action = screen.getByRole('button', { name: /日時を選ぶ/ })
    expect(action).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('ご用件をお選びになると進めます。')).toBeInTheDocument()

    await userEvent.click(action)
    expect(onNext).not.toHaveBeenCalled()

    rerender(
      <PurposeStep
        purposes={PURPOSES}
        selectedId={PURPOSES[1]?.id ?? ''}
        storePhone={PHONE}
        onSelect={vi.fn()}
        onNext={onNext}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '日時を選ぶ' }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('公開している目的が 0 件なら、電話番号の案内を出して工程へ進ませない', () => {
    render(
      <PurposeStep
        purposes={[]}
        selectedId={null}
        storePhone={PHONE}
        onSelect={vi.fn()}
        onNext={vi.fn()}
      />,
    )

    expect(screen.getByText('いまはWebでご予約を承れません')).toBeInTheDocument()
    expect(screen.getByText('この店舗のご用件が 1 件も出ていません。')).toBeInTheDocument()
    expect(screen.getByText(`お電話（${PHONE}）でご予約を承ります。`)).toBeInTheDocument()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('button', { name: /日時を選ぶ/ })).toBeNull()
  })
})
