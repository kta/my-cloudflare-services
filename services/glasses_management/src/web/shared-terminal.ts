export type SharedTerminalClock = {
  now: () => number
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void
}

type SharedTerminalDailyState = {
  selectedReservationId?: string
  selectedCustomerId?: string
  searchDraft?: string
  formDraft?: Record<string, unknown>
}

type SharedTerminalStart = {
  token: string
  terminalId: string
  storeId: string
  expiresAt: string
  idleTimeoutSeconds: number
}

type SharedTerminalReason =
  | 'idle'
  | 'page_exit'
  | 'terminal_revoked'
  | 'terminal_expired'
  | 'terminal_locked'

type SharedTerminalSnapshot = {
  status: 'inactive' | 'active' | 'locked' | 'revoked'
  reason?: SharedTerminalReason
  token?: string
  terminalId?: string
  storeId?: string
  expiresAt?: string
  dailyState: SharedTerminalDailyState
}

const terminalErrors = new Set<SharedTerminalReason>([
  'terminal_revoked',
  'terminal_expired',
  'terminal_locked',
])

/**
 * Holds a shared-terminal credential only in memory. Locking deliberately
 * replaces the complete daily state rather than attempting field-by-field
 * redaction, so a newly added PII-bearing field cannot survive by accident.
 */
export function createSharedTerminalController(clock: SharedTerminalClock) {
  let state: SharedTerminalSnapshot = { status: 'inactive', dailyState: {} }
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()

  const publish = () => {
    listeners.forEach((listener) => {
      listener()
    })
  }

  const clearIdleTimer = () => {
    if (idleTimer !== undefined) {
      clock.clearTimeout(idleTimer)
      idleTimer = undefined
    }
  }

  const lock = (reason: SharedTerminalReason) => {
    clearIdleTimer()
    state = {
      status: reason === 'terminal_revoked' ? 'revoked' : 'locked',
      reason,
      terminalId: state.terminalId,
      storeId: state.storeId,
      expiresAt: state.expiresAt,
      dailyState: {},
    }
    publish()
  }

  const scheduleIdleLock = (idleTimeoutSeconds: number) => {
    clearIdleTimer()
    idleTimer = clock.setTimeout(() => lock('idle'), idleTimeoutSeconds * 1000)
  }

  return {
    start(session: SharedTerminalStart) {
      clearIdleTimer()
      state = { status: 'active', ...session, dailyState: {} }
      scheduleIdleLock(session.idleTimeoutSeconds)
      publish()
    },
    snapshot(): SharedTerminalSnapshot {
      // State is replaced, never mutated. Returning this stable reference is
      // required by React's external-store contract and avoids stale PII.
      return state
    },
    setDailyState(next: SharedTerminalDailyState) {
      if (state.status !== 'active') return
      state = { ...state, dailyState: { ...state.dailyState, ...next } }
      publish()
    },
    lockForPageExit() {
      if (state.status === 'active') lock('page_exit')
    },
    handleApiError(status: number, body: { error?: string }) {
      if (state.status !== 'active' || status !== 401 || body.error === undefined) return
      if (terminalErrors.has(body.error as SharedTerminalReason))
        lock(body.error as SharedTerminalReason)
    },
    dispose() {
      clearIdleTimer()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Attach the two browser lifecycle paths that may expose a shared iPad. */
export function bindSharedTerminalLifecycle(
  controller: ReturnType<typeof createSharedTerminalController>,
  documentTarget: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>,
  windowTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>,
) {
  const onVisibilityChange = () => {
    if (documentTarget.visibilityState === 'hidden') controller.lockForPageExit()
  }
  const onPageHide = () => controller.lockForPageExit()
  documentTarget.addEventListener('visibilitychange', onVisibilityChange)
  windowTarget.addEventListener('pagehide', onPageHide)
  return () => {
    documentTarget.removeEventListener('visibilitychange', onVisibilityChange)
    windowTarget.removeEventListener('pagehide', onPageHide)
  }
}
