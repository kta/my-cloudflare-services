import type { StaffMember, Terminal } from '@app/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PinEntry } from './PinEntry'

const _staff = (id: string, name: string): StaffMember => ({
  id,
  displayName: name,
  kana: null,
  jobLabel: '販売・受付',
  role: 'staff',
  isActive: true,
  sortOrder: 0,
  skills: [],
  adminUserId: null,
  hasPin: true,
  maxParallelReservations: 1,
  pinUpdatedAt: null,
})

const _terminal = (id: string, name: string, online = true): Terminal => ({
  id,
  storeId: '11111111-1111-4111-8111-111111111111',
  name,
  kind: 'shared',
  staffId: null,
  placeNote: 'レジの右側',
  deviceLabel: 'EYE-iPad-07',
  autoLockSeconds: 120,
  isActive: true,
  hasPin: true,
  lastSeenAt: online ? '2026-08-27T02:08:00.000Z' : null,
  isOnline: online,
  version: 1,
  createdAt: '2026-08-27T02:08:00.000Z',
})

describe('暗証番号', () => {
  it('3桁では確定できず、4桁で送れる', () => {
    const onSubmit = vi.fn()
    render(
      <PinEntry
        kind="personal"
        title="佐藤 美咲"
        detail="視力測定・加工 ／ 本日の勤務 10:00–19:00"
        onSubmit={onSubmit}
        onBack={vi.fn()}
      />,
    )
    for (const digit of ['2', '5', '8'])
      fireEvent.click(screen.getByRole('button', { name: digit }))
    expect(screen.getByRole('button', { name: /確定/ })).toBeDisabled()
    expect(screen.getByText(/あと1桁/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    fireEvent.click(screen.getByRole('button', { name: /確定/ }))
    expect(onSubmit).toHaveBeenCalledWith('2580')
  })

  it('誤りは入力を空にし、残り回数と30秒待ちを文字で出す', () => {
    render(
      <PinEntry
        kind="personal"
        title="佐藤 美咲"
        detail="視力測定・加工"
        remainingAttempts={2}
        retryAfterSeconds={30}
        onSubmit={vi.fn()}
        onBack={vi.fn()}
      />,
    )
    expect(screen.getByText('暗証番号が違います。あと2回お試しいただけます')).toBeTruthy()
    expect(screen.getByText(/30秒/)).toBeTruthy()
    expect(screen.getByText('店長に暗証番号の再設定を頼む')).toBeTruthy()
    expect(screen.getByRole('button', { name: /確定/ })).toBeDisabled()
  })
})
