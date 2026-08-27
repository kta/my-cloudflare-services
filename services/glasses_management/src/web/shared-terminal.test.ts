import { afterEach, describe, expect, it, test, vi } from 'vitest'
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

test('locks a terminal whose very first session call is refused', () => {
  // A stolen or revoked iPad presents its token before any session exists. If
  // the controller only reacted once active, that device would fall through to
  // the ordinary staff sign-in instead of the re-registration screen
  // (UC-EYEX-158, AC-EYEX-98).
  const controller = createSharedTerminalController({
    now: () => Date.parse('2026-08-31T00:00:00.000Z'),
    setTimeout,
    clearTimeout,
  })

  controller.handleApiError(401, { error: 'terminal_revoked' })

  expect(controller.snapshot()).toMatchObject({ status: 'revoked', reason: 'terminal_revoked' })
})

test('ignores an unrelated failure on a terminal that never started', () => {
  const controller = createSharedTerminalController({
    now: () => Date.parse('2026-08-31T00:00:00.000Z'),
    setTimeout,
    clearTimeout,
  })

  controller.handleApiError(500, { error: 'internal_error' })

  expect(controller.snapshot().status).toBe('inactive')
})

/*
 * ロック画面はモック `exception-states-approved.html#shared-lock` のとおり、
 * 端末名と無操作時間を名乗る。どちらもロックした瞬間には手元に無いと出せない
 * ので、セッション開始時の値をロック後も残す（顧客情報とは違い、端末の設定値
 * であって PII ではない）。
 */
test('ロック後も端末名と無操作秒数だけは残し、ロック画面がそれを名乗れるようにする', () => {
  vi.useFakeTimers()
  const controller = createSharedTerminalController(fakeClock())
  controller.start({
    token: 'terminal-token',
    terminalId: 'terminal-a',
    terminalName: 'レジ横iPad',
    storeId: 'store-a',
    expiresAt: '2026-09-01T00:00:00.000Z',
    idleTimeoutSeconds: 120,
  })
  expect(controller.snapshot().terminalName).toBe('レジ横iPad')

  vi.advanceTimersByTime(120_000)
  const locked = controller.snapshot()
  expect(locked.status).toBe('locked')
  expect(locked.terminalName).toBe('レジ横iPad')
  expect(locked.idleTimeoutSeconds).toBe(120)
  expect(locked.token).toBeUndefined()
})
