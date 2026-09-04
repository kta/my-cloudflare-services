import type { StaffMember } from '@app/contracts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PersonalMode } from './PersonalMode'

const member = (id: string, displayName: string): StaffMember => ({
  id,
  displayName,
  kana: null,
  jobLabel: '視力測定・加工',
  role: 'staff',
  isActive: true,
  sortOrder: 0,
  skills: [],
  adminUserId: null,
  hasPin: true,
  maxParallelReservations: 1,
  pinUpdatedAt: null,
})

describe('共有端末から個人モードへ上げる', () => {
  it('操作する本人を選び、4桁の PIN で元の操作へ戻せる', async () => {
    const onConfirm = vi.fn().mockResolvedValue(true)
    render(
      <PersonalMode
        subject="録音の保全"
        staff={[member('a', '佐藤 美咲'), member('b', '高橋 健')]}
        offIds={new Set()}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('いまは共有モード')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /高橋 健/ }))
    for (const digit of '2580') fireEvent.click(screen.getByRole('button', { name: digit }))
    fireEvent.click(screen.getByRole('button', { name: '確定' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('b', '2580'))
  })
})
