import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bindSharedTerminalLifecycle,
  createSharedTerminalController,
  type SharedTerminalClock,
} from './shared-terminal'

function fakeClock(now = Date.parse('2026-08-31T00:00:00.000Z')): SharedTerminalClock {
  return {
    now: () => now,
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => clearTimeout(handle),
  }
}

afterEach(() => vi.useRealTimers())

describe('memory-only shared terminal session', () => {
  it('locks at the exact idle deadline and clears the terminal token and PII-bearing state', () => {
    vi.useFakeTimers()
    const controller = createSharedTerminalController(fakeClock())
    controller.start({
      token: 'terminal-token',
      terminalId: 'terminal-a',
      storeId: 'store-a',
      expiresAt: '2026-09-01T00:00:00.000Z',
      idleTimeoutSeconds: 120,
    })
    controller.setDailyState({
      selectedReservationId: 'reservation-a',
      selectedCustomerId: 'customer-a',
      searchDraft: '09012345678',
      formDraft: { customerName: '田中花子' },
    })

    vi.advanceTimersByTime(119_999)
    expect(controller.snapshot().status).toBe('active')
    expect(controller.snapshot().token).toBe('terminal-token')

    vi.advanceTimersByTime(1)
    expect(controller.snapshot()).toEqual({
      status: 'locked',
      reason: 'idle',
      terminalId: 'terminal-a',
      storeId: 'store-a',
      expiresAt: '2026-09-01T00:00:00.000Z',
      dailyState: {},
    })
  })

  it('locks immediately when the page is hidden and removes all browser-session state', () => {
    const controller = createSharedTerminalController(fakeClock())
    controller.start({
      token: 'terminal-token',
      terminalId: 'terminal-a',
      storeId: 'store-a',
      expiresAt: '2026-09-01T00:00:00.000Z',
      idleTimeoutSeconds: 120,
    })
    controller.setDailyState({ selectedCustomerId: 'customer-a', searchDraft: '田中' })

    const dispose = bindSharedTerminalLifecycle(controller, document, window)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(controller.snapshot().status).toBe('locked')
    expect(controller.snapshot().token).toBeUndefined()
    expect(controller.snapshot().dailyState).toEqual({})
    dispose()
  })

  it.each(['terminal_revoked', 'terminal_expired', 'terminal_locked'] as const)(
    'does not restore cached state after a 401 %s response',
    (error) => {
      const controller = createSharedTerminalController(fakeClock())
      controller.start({
        token: 'terminal-token',
        terminalId: 'terminal-a',
        storeId: 'store-a',
        expiresAt: '2026-09-01T00:00:00.000Z',
        idleTimeoutSeconds: 120,
      })
      controller.setDailyState({
        selectedReservationId: 'reservation-a',
        selectedCustomerId: 'customer-a',
      })

      controller.handleApiError(401, { error })
      controller.setDailyState({ selectedReservationId: 'reservation-b' })

      expect(controller.snapshot()).toEqual({
        status: error === 'terminal_revoked' ? 'revoked' : 'locked',
        reason: error,
        terminalId: 'terminal-a',
        storeId: 'store-a',
        expiresAt: '2026-09-01T00:00:00.000Z',
        dailyState: {},
      })
    },
  )
})
