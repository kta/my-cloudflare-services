import type { StaffMember, Terminal } from '@app/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PinEntry } from './PinEntry'
import { PlacePick } from './PlacePick'
import { StaffPick } from './StaffPick'

const staff = (id: string, name: string): StaffMember => ({
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

const terminal = (id: string, name: string, online = true): Terminal => ({
  id,
  storeId: '11111111-1111-4111-8111-111111111111',
  name,
  kind: 'shared',
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

describe('スタッフを選ぶ', () => {
  it('休みを文字で示して押せず、勤務中だけ選べる', () => {
    const onSelect = vi.fn()
    render(
      <StaffPick
        staff={[staff('a', '佐藤 美咲'), staff('b', '山田 大輔（店長）')]}
        offIds={new Set(['b'])}
        onSelect={onSelect}
        onShared={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('heading', { name: '業務を始めるスタッフを選んでください' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /山田 大輔/ })).toBeDisabled()
    expect(screen.getByText(/本日休み/, { selector: 'span' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /佐藤 美咲/ }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ displayName: '佐藤 美咲' }))
  })

  it('0人でも共有端末へ進めて行き止まりにしない', () => {
    render(<StaffPick staff={[]} offIds={new Set()} onSelect={vi.fn()} onShared={vi.fn()} />)
    expect(screen.getByText('業務を始められるスタッフがいません')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'みんなで使う端末にする' })).toBeTruthy()
  })
})

describe('置き場所を選ぶ', () => {
  it('接続状態を文字で出し、通信断や業務中も選べる', () => {
    const onSelect = vi.fn()
    render(
      <PlacePick
        terminals={[
          terminal('a', '銀座店 レジ横iPad'),
          { ...terminal('b', '銀座店 受付iPad'), activeStaffName: '高橋 健' },
          terminal('c', '銀座店 検査室iPad', false),
        ]}
        onSelect={onSelect}
        onChangeMode={vi.fn()}
      />,
    )
    expect(screen.getByText('まだ誰も使っていません')).toBeTruthy()
    expect(screen.getAllByText(/業務中/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('つながっていません').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /銀座店 検査室iPad/ }))
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'この置き場所で始める' }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: '銀座店 検査室iPad' }))
  })
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
