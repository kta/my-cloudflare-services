import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PermissionRefusal } from './SaveBar'

const manager = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  displayName: '山田 大輔',
  kana: 'やまだ だいすけ',
  jobLabel: '店長',
  role: 'manager' as const,
  isActive: true,
  sortOrder: 1,
  skills: [],
  adminUserId: 'dev:eyex-manager',
  hasPin: true,
  maxParallelReservations: 1,
  pinUpdatedAt: null,
}

describe('権限不足から店長PINで続ける', () => {
  it('共通の秘匿PIN欄とテンキーを使い、平文PINを表示DOMへ出さない', async () => {
    const onElevate = vi.fn(async () => true)
    render(
      <PermissionRefusal
        target="営業時間"
        actor={{ name: '中村 彩', role: 'staff', roleLabel: 'スタッフ' }}
        changes={['営業時間：10:00 → 10:30']}
        staff={[manager]}
        onElevate={onElevate}
      />,
    )

    for (const digit of '2580') await userEvent.click(screen.getByRole('button', { name: digit }))

    expect(document.body).not.toHaveTextContent('2580')
    expect(screen.getByLabelText(/暗証番号 6桁のうち4桁を入力済み/)).toHaveValue('●●●●')
    await userEvent.click(screen.getByRole('button', { name: '店長として続ける' }))
    expect(onElevate).toHaveBeenCalledWith(manager.id, '2580')
  })
})
