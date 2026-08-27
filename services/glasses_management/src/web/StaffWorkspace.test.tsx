import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { StaffWorkspace } from './StaffWorkspace'

test('loads accessible stores after restoring the same-origin staff session and wires the switch audit call', async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            id: '11111111-1111-4111-8111-111111111111',
            organizationId: 'org',
            name: '銀座店',
            slug: 'ginza',
            isActive: true,
            createdAt: '2026-08-31T00:00:00.000Z',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            organizationId: 'org',
            name: '丸の内店',
            slug: 'marunouchi',
            isActive: true,
            createdAt: '2026-08-31T00:00:00.000Z',
          },
        ]),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(new Response('{}', { status: 201 }))

  render(<StaffWorkspace restore={async () => true} api={api} />)

  await waitFor(() => expect(screen.getByRole('button', { name: /銀座店/ })).toBeInTheDocument())
  await screen.findByText('銀座店の予約台帳')
})

test('lets a new browser sign in through the EYEX same-origin auth proxy before loading stores', async () => {
  const signIn = vi.fn().mockResolvedValue(true)
  const api = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: '11111111-1111-4111-8111-111111111111',
            organizationId: 'org',
            name: '銀座店',
            slug: 'ginza',
            isActive: true,
            createdAt: '2026-08-31T00:00:00.000Z',
          },
        ]),
        { status: 200 },
      ),
    )
  render(<StaffWorkspace restore={async () => false} signIn={signIn} api={api} />)

  fireEvent.change(await screen.findByLabelText('メールアドレス'), {
    target: { value: 'staff@example.test' },
  })
  fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'safe-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'ログインする' }))

  await waitFor(() => expect(signIn).toHaveBeenCalledWith('staff@example.test', 'safe-password'))
  await screen.findByText('銀座店の予約台帳')
})
