import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ReservationSnapshot } from '../../worker/domain/reservation-change'
import { ChangeDiff } from './ChangeDiff'

/*
 * 変更内容の確認（承認済みモック docs/frontend/mockups/eyex/images/CHANGE-DIFF.png）。
 *
 * 実測（screens/CHANGE-DIFF.html と assets/eyex.css）:
 *   `1fr 360px` gap 32px・padding 36px。見出し 18px、補足は 400/13px を 10px 右に。
 *   差分表は `132px 1fr 1fr` の grid、隙間 1px を --line で見せ、外枠 1px --line-strong・
 *   角 12px。セルは padding 16px 14px・16px。見出し行は --surface-2 の 12px/600。
 *   右の読み上げカードは 2px の --brand-line の縁、本文 24px/1.6。
 *
 * **読み上げ文は確定前の形**（「…変更いたします。…こちらでお間違いないでしょうか？」）。
 * モックの「変更いたしました」「でございます」は採らない（`design/06-use-cases.md` §5）。
 */

const AT = (clock: string, date = '2026-08-27') =>
  new Date(Date.parse(`${date}T${clock}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()

const BEFORE: ReservationSnapshot = {
  startsAt: AT('11:00'),
  endsAt: AT('12:00'),
  durationMinutes: 60,
  purposeIds: ['p1'],
  purposeLabel: 'メガネを新しく作る',
  staffId: 's1',
  staffName: '佐藤 美咲',
  equipmentIds: ['e1', 'e2'],
  equipmentNames: ['視力測定機 A', '相談カウンター 1'],
}

/** モックと同じ変更（日時と場所だけが変わり、ご用件と担当は変わらない）。 */
const AFTER: ReservationSnapshot = {
  ...BEFORE,
  startsAt: AT('14:00'),
  endsAt: AT('15:00'),
  equipmentIds: ['e1', 'e3'],
  equipmentNames: ['視力測定機 A', '相談カウンター 2'],
}

type Overrides = Partial<Parameters<typeof ChangeDiff>[0]>

function show(overrides: Overrides = {}) {
  const props = {
    source: 'phone' as const,
    before: BEFORE,
    after: AFTER,
    confirming: false,
    error: null,
    onBack: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  }
  render(<ChangeDiff {...props} />)
  return props
}

/** 差分表のある行。 */
function row(label: string): HTMLElement {
  return screen.getByRole('row', { name: new RegExp(label) })
}

describe('差分', () => {
  it('「この内容に変更します」「変わる行だけ色を付けています」が出る', () => {
    show()
    expect(screen.getByRole('heading', { name: /この内容に変更します/ })).toBeInTheDocument()
    expect(screen.getByText('変わる行だけ色を付けています')).toBeInTheDocument()
  })

  it('表は 項目／変更前／変更後 の 3 列', () => {
    show()
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '項目',
      '変更前',
      '変更後',
    ])
  })

  it('お日にちとお時間 と 場所 の行に「変更」の札が付く', () => {
    show()
    expect(within(row('お日にちとお時間')).getByText('変更')).toBeInTheDocument()
    expect(within(row('場所')).getByText('変更')).toBeInTheDocument()
    expect(within(row('お日にちとお時間')).getByText('14:00–15:00')).toBeInTheDocument()
    expect(within(row('場所')).getByText('相談カウンター 2')).toBeInTheDocument()
  })

  it('ご用件 と 担当 の行に「変更」の札が付かない', () => {
    show()
    expect(within(row('ご用件')).queryByText('変更')).not.toBeInTheDocument()
    expect(within(row('担当')).queryByText('変更')).not.toBeInTheDocument()
  })

  it('行の並びは お日にちとお時間 → ご用件 → 担当 → 場所 で固定する', () => {
    show()
    const table = screen.getByRole('table', { name: '変更前と変更後' })
    const labels = within(table)
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent)
    expect(labels).toEqual(['お日にちとお時間', 'ご用件', '担当', '場所'])
  })
})

describe('読み上げ', () => {
  it('右に読み上げ文が出て、末尾が「こちらでお間違いないでしょうか？」になる', () => {
    show()
    const card = within(screen.getByRole('region', { name: 'お客様へ、このまま読み上げます' }))
    const say = card.getByText(/変更いたします。/)
    expect(say).toHaveTextContent(
      '8月27日木曜日、午後2時へお時間を変更いたします。担当は佐藤 美咲、所要時間は約60分です。こちらでお間違いないでしょうか？',
    )
    expect(say.textContent?.endsWith('こちらでお間違いないでしょうか？')).toBe(true)
  })

  it('店内予約では「お電話でのご予約のため、メールは送りません。」が出る', () => {
    show()
    expect(screen.getByText('お電話でのご予約のため、メールは送りません。')).toBeInTheDocument()
  })

  it('Web予約では「Webでのご予約のため、変更をメールでお知らせします。」に変わる', () => {
    show({ source: 'web' })
    expect(
      screen.getByText('Webでのご予約のため、変更をメールでお知らせします。'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('お電話でのご予約のため、メールは送りません。'),
    ).not.toBeInTheDocument()
  })
})

describe('出口', () => {
  it('「戻って直す」で日時を選ぶ画面へ戻り、まだ何も保存されていない', async () => {
    const props = show()
    expect(
      screen.getByText('読み上げてご了承をいただいてから確定してください。'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '戻って直す' }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('変更点が 1 つも無ければ「変更を確定する」を押せない', async () => {
    const props = show({ after: BEFORE })
    const confirm = screen.getByRole('button', {
      name: '変更を確定する　変えるところがまだありません',
    })
    expect(confirm).toBeDisabled()
    await userEvent.click(confirm)
    expect(props.onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('変えるところがまだありません。')).toBeInTheDocument()
  })

  it('確定しているあいだは 2 度目の押下を届かせない', async () => {
    const props = show({ confirming: true })
    await userEvent.click(screen.getByRole('button', { name: '確定しています…' }))
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('確定できなかったときは、その事実と入力が残っていることを出す', () => {
    show({ error: 'うまく処理できませんでした。伺った内容は残っています。' })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'うまく処理できませんでした。伺った内容は残っています。',
    )
  })
})

describe('枠が先に埋まっていたとき（409 slot_taken）', () => {
  const SLOT_TAKEN = {
    takenAt: AT('14:00'),
    takenLabel: '佐藤 美咲・視力測定機 A',
    staffName: '佐藤 美咲',
    summary: {
      date: '2026-08-27' as const,
      purposeLabel: 'メガネを新しく作る',
      durationMinutes: 60,
      customerLabel: '田中 花子 様',
    },
    alternatives: [
      { startsAt: AT('15:00'), endsAt: AT('16:00'), resourceLabel: '相談カウンター 2' },
    ],
    staffSwap: null,
  }

  it('BOOK-CONFLICT と同じ形で代わりの時刻を出し、いまのご予約は元のまま残る', () => {
    show({ slotTaken: SLOT_TAKEN, onReselect: vi.fn() })
    expect(screen.getByText('まだ変更していません。伺った内容は残っています。')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: '変更前と変更後' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'この枠は、ほかの端末で先に確定されました' }),
    ).toBeInTheDocument()
  })

  it('代わりの時刻を選ぶと、押さえ直しを器へ渡す', async () => {
    const onReselect = vi.fn()
    show({ slotTaken: SLOT_TAKEN, onReselect })
    await userEvent.click(screen.getAllByRole('button', { name: /15:00/ })[0] as HTMLElement)
    expect(onReselect).toHaveBeenCalledWith({
      kind: 'time',
      startsAt: AT('15:00'),
      endsAt: AT('16:00'),
    })
  })
})
