import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { HomeScreen } from './HomeScreen'
import type { StaffLocation } from './staff-navigation'

function renderHome(overrides: Partial<Parameters<typeof HomeScreen>[0]> = {}): {
  navigate: ReturnType<typeof vi.fn>
} {
  const navigate = vi.fn<(location: StaffLocation) => void>()
  render(
    <HomeScreen
      storeId="11111111-1111-4111-8111-111111111111"
      storeName="銀座店"
      api={vi.fn()}
      navigate={navigate}
      today="2026-08-27"
      {...overrides}
    />,
  )
  return { navigate }
}

/** Index access with a real failure message instead of an undefined deref. */
function at(elements: HTMLElement[], index: number): HTMLElement {
  const element = elements[index]
  if (!element) throw new RangeError(`expected an element at index ${index}`)
  return element
}

// UC-EYEX-001 / AC-EYEX-01
test('starts a new reservation from the most prominent primary action', () => {
  const { navigate } = renderHome()
  fireEvent.click(screen.getByRole('button', { name: /新しい予約を取る/ }))
  expect(navigate).toHaveBeenCalledWith({ screen: 'booking' })
})

// UC-EYEX-001 — the approved mock states who the primary action is for
test('names the audience of the primary action exactly as the approved mock does', () => {
  renderHome()
  expect(screen.getByRole('button', { name: /新しい予約を取る/ })).toHaveTextContent(
    '電話・店頭のお客様',
  )
})

// UC-EYEX-002 — the second hero card carries no hint text in the approved mock
test('starts a reservation change from the second primary action', () => {
  const { navigate } = renderHome()
  const change = screen.getByRole('button', { name: '予約を変更する' })
  fireEvent.click(change)
  expect(navigate).toHaveBeenCalledWith({ screen: 'reservation-search' })
  expect(change).toHaveTextContent('予約を変更する')
})

// UC-EYEX-003 / AC-EYEX-09 — the approved mock's quick list, in its order and wording
test('lists the quick actions in the approved order and wording', () => {
  renderHome()
  const quick = within(screen.getByRole('navigation', { name: '副操作' })).getAllByRole('button')
  expect(quick.map((button) => button.textContent)).toEqual([
    '受付履歴',
    '予約を検索',
    '顧客台帳',
    '予約台帳',
    '来店受付',
  ])
})

test.each([
  ['受付履歴', { screen: 'reception-history' }],
  ['予約を検索', { screen: 'reservation-search' }],
  ['顧客台帳', { screen: 'customers' }],
  ['来店受付', { screen: 'journey' }],
  ['予約台帳', { screen: 'ledger', date: '2026-08-27' }],
] as const)('quick action %s navigates to its screen', (label, expected) => {
  const { navigate } = renderHome()
  fireEvent.click(
    within(screen.getByRole('navigation', { name: '副操作' })).getByRole('button', { name: label }),
  )
  expect(navigate).toHaveBeenCalledWith(expected)
})

// AC-EYEX-09 — primary and secondary actions are separate, labelled groups
test('separates primary actions from secondary actions as labelled groups', () => {
  renderHome()
  expect(
    within(screen.getByRole('navigation', { name: '主操作' })).getAllByRole('button'),
  ).toHaveLength(2)
  expect(
    within(screen.getByRole('navigation', { name: '副操作' })).getAllByRole('button'),
  ).toHaveLength(5)
})

// UC-EYEX-004 — 前後3日 + カレンダー
test('covers the three days before and after the selected day plus a calendar entry', () => {
  const { navigate } = renderHome()
  const days = within(screen.getByRole('navigation', { name: '日付' })).getAllByRole('button')
  expect(days).toHaveLength(8)
  expect(at(days, 0)).toHaveAccessibleName(expect.stringContaining('8月24日'))
  expect(at(days, 6)).toHaveAccessibleName(expect.stringContaining('8月30日'))
  expect(at(days, 7)).toHaveTextContent('カレンダー')
  fireEvent.click(at(days, 6))
  expect(navigate).toHaveBeenCalledWith({ screen: 'ledger', date: '2026-08-30' })
})

// UC-EYEX-004 — the mock prints the day number and its weekday, e.g. 「24 月」
test('prints each day as the approved mock does', () => {
  renderHome()
  const days = within(screen.getByRole('navigation', { name: '日付' })).getAllByRole('button')
  expect(at(days, 0)).toHaveTextContent('24 月')
  expect(at(days, 6)).toHaveTextContent('30 日')
})

// UC-EYEX-004 — month and year boundaries are handled by date arithmetic, not locale drift
test('crosses a month boundary in the date strip', () => {
  renderHome({ today: '2026-03-01' })
  const days = within(screen.getByRole('navigation', { name: '日付' })).getAllByRole('button')
  expect(at(days, 0)).toHaveAccessibleName(expect.stringContaining('2月26日'))
  expect(at(days, 3)).toHaveAccessibleName(expect.stringContaining('3月1日'))
})

// UC-EYEX-004 — leap day
test('handles a leap day in the date strip', () => {
  renderHome({ today: '2028-02-29' })
  const days = within(screen.getByRole('navigation', { name: '日付' })).getAllByRole('button')
  expect(at(days, 3)).toHaveAccessibleName(expect.stringContaining('2月29日'))
  expect(at(days, 4)).toHaveAccessibleName(expect.stringContaining('3月1日'))
})

// UC-EYEX-004 / AC-EYEX-125 — selection is not colour-only
test('marks the selected day with text and aria-current, not colour alone', () => {
  renderHome()
  const days = within(screen.getByRole('navigation', { name: '日付' })).getAllByRole('button')
  expect(at(days, 3)).toHaveAttribute('aria-current', 'date')
  expect(at(days, 3)).toHaveAccessibleName(expect.stringContaining('選択中'))
})

// §2.1 — the top screen must not lead with 集計値, and the store status lives in
// the chrome wordmark, not in the body.
test('leads with entry points only: no page heading, no status line, no count cards', () => {
  renderHome()
  expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByText(/営業中/)).not.toBeInTheDocument()
  expect(screen.queryByText(/お知らせ/)).not.toBeInTheDocument()
  expect(screen.queryByText(/アラート/)).not.toBeInTheDocument()
})

/*
 * HOME-DEFAULT の実測（`.hero button{min-height:108px;border-radius:12px;
 * font-size:24px}` / `.quick button{min-height:76px;font-size:18px}` /
 * `.home{grid-template-columns:1fr .8fr;gap:70px}`）。突き合わせ台の複製
 * （`gallery/screens/HOME-DEFAULT.screen.tsx`）と同じ語彙で組まれていることを、
 * 画素を撮らずに確かめる。
 */
test('draws the hero, the quick list and the two columns with the approved measurements', () => {
  renderHome()
  const primary = within(screen.getByRole('navigation', { name: '主操作' })).getAllByRole('button')
  for (const hero of primary) {
    expect(hero.className).toContain('min-h-27')
    expect(hero.className).toContain('rounded-panel')
    expect(hero.className).toContain('text-title')
  }
  const quick = within(screen.getByRole('navigation', { name: '副操作' })).getAllByRole('button')
  for (const action of quick) expect(action.className).toContain('text-lead')
  // 列幅 `1fr .8fr` は 4 の倍数でない実測値なので、配置としてインラインで持つ。
  const columns = at(primary, 0).closest('nav')?.parentElement as HTMLElement
  expect(columns.style.gridTemplateColumns).toBe('1fr .8fr')
})

// UC-EYEX-008 / AC-EYEX-123
test('reaches both primary actions in order with the keyboard and activates them', () => {
  const { navigate } = renderHome()
  const primary = within(screen.getByRole('navigation', { name: '主操作' })).getAllByRole('button')
  const newReservation = at(primary, 0)
  const change = at(primary, 1)
  newReservation.focus()
  expect(document.activeElement).toBe(newReservation)
  expect(
    newReservation.compareDocumentPosition(change) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  expect(newReservation).not.toHaveAttribute('tabindex')
  expect(change).not.toHaveAttribute('tabindex')
  // Native <button> answers Enter/Space with a click; assert we kept native buttons.
  expect(newReservation.tagName).toBe('BUTTON')
  fireEvent.click(newReservation)
  expect(navigate).toHaveBeenCalledWith({ screen: 'booking' })
})

// AC-EYEX-122 — 44 CSS px touch targets
test('gives every action the 44px touch-target floor', () => {
  renderHome()
  for (const button of screen.getAllByRole('button')) {
    expect(button.className).toMatch(/min-h-(1[1-9]|[2-9]\d)\b/)
  }
})
