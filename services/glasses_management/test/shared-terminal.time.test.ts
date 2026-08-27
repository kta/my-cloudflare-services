import { describe, expect, it } from 'vitest'
import { sharedTerminalAccessError } from '../src/worker/domain/shared-terminal'

describe('shared terminal expiry boundary', () => {
  const expiresAt = '2026-08-31T00:00:00.000Z'

  it('expires at the exact terminal expiry instant', () => {
    expect(sharedTerminalAccessError({ status: 'active', expiresAt }, new Date(expiresAt))).toBe(
      'terminal_expired',
    )
  })

  it('remains active one millisecond before expiry', () => {
    expect(
      sharedTerminalAccessError(
        { status: 'active', expiresAt },
        new Date(Date.parse(expiresAt) - 1),
      ),
    ).toBeNull()
  })

  it('locks at the exact two-minute idle deadline', () => {
    expect(
      sharedTerminalAccessError(
        {
          status: 'active',
          expiresAt: '2026-09-01T00:00:00.000Z',
          lastSeenAt: '2026-08-31T00:00:00.000Z',
          idleTimeoutSeconds: 120,
        },
        new Date('2026-08-31T00:02:00.000Z'),
      ),
    ).toBe('terminal_locked')
  })
})
