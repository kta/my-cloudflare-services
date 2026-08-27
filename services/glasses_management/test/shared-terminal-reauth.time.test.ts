import { describe, expect, it } from 'vitest'
import { sharedTerminalReauthAccessError } from '../src/worker/domain/shared-terminal'

const session = {
  organizationId: 'org-a',
  storeId: 'store-a',
  terminalId: 'terminal-a',
  actionClass: 'management',
  expiresAt: '2026-08-31T00:05:00.000Z',
}

describe('shared-terminal personal reauthentication boundary', () => {
  it('expires at the exact deadline but remains valid one millisecond before it', () => {
    expect(
      sharedTerminalReauthAccessError(
        session,
        {
          organizationId: 'org-a',
          storeId: 'store-a',
          terminalId: 'terminal-a',
          actionClass: 'management',
        },
        new Date('2026-08-31T00:05:00.000Z'),
      ),
    ).toBe('reauth_expired')
    expect(
      sharedTerminalReauthAccessError(
        session,
        {
          organizationId: 'org-a',
          storeId: 'store-a',
          terminalId: 'terminal-a',
          actionClass: 'management',
        },
        new Date('2026-08-31T00:04:59.999Z'),
      ),
    ).toBeNull()
  })

  it('fails closed when a reauthentication token is reused for another terminal or store', () => {
    expect(
      sharedTerminalReauthAccessError(
        session,
        {
          organizationId: 'org-a',
          storeId: 'store-a',
          terminalId: 'terminal-b',
          actionClass: 'management',
        },
        new Date('2026-08-31T00:00:00.000Z'),
      ),
    ).toBe('reauth_scope_mismatch')
    expect(
      sharedTerminalReauthAccessError(
        session,
        {
          organizationId: 'org-a',
          storeId: 'store-b',
          terminalId: 'terminal-a',
          actionClass: 'management',
        },
        new Date('2026-08-31T00:00:00.000Z'),
      ),
    ).toBe('reauth_scope_mismatch')
  })
})
