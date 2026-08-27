export type SelectedStore = { id: string; name: string; isActive: boolean }

export type StoreBoundDraftState = {
  search?: string
  reservationId?: string
  customerId?: string
  form?: Record<string, unknown>
}

export type StoreSwitchSnapshot = {
  selectedStore: SelectedStore
  draftState: StoreBoundDraftState
}

/**
 * Owns only transient, selected-store state. It deliberately has no browser
 * persistence: a browser reload must not silently revive another store's PII
 * or unfinished reservation input.
 */
export function createStoreSwitchController(
  initialStore: SelectedStore,
  recordAudit: (fromStoreId: string, toStoreId: string) => Promise<boolean>,
) {
  let state: StoreSwitchSnapshot = { selectedStore: initialStore, draftState: {} }
  const listeners = new Set<() => void>()
  const publish = () => {
    listeners.forEach((listener) => {
      listener()
    })
  }
  const hasUnsavedState = () => Object.keys(state.draftState).length > 0
  let switchInFlight = false

  const apply = (nextStore: SelectedStore) => {
    state = { selectedStore: nextStore, draftState: {} }
    publish()
  }

  return {
    snapshot(): StoreSwitchSnapshot {
      return state
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setDraftState(next: StoreBoundDraftState) {
      state = { ...state, draftState: { ...state.draftState, ...next } }
      publish()
    },
    /** Withdraw the claim that unsaved work exists, once it no longer does. */
    clearDraftState() {
      if (Object.keys(state.draftState).length === 0) return
      state = { ...state, draftState: {} }
      publish()
    },
    /** Preview a cross-store change without mutating client state or drafts. */
    prepareSwitch(
      nextStore: SelectedStore,
    ): { kind: 'ready' } | { kind: 'confirm_discard'; fromStore: string; toStore: string } {
      if (nextStore.id === state.selectedStore.id || !hasUnsavedState()) return { kind: 'ready' }
      return {
        kind: 'confirm_discard',
        fromStore: state.selectedStore.name,
        toStore: nextStore.name,
      }
    },
    /** The only mutation entry point: the durable server audit happens before local state changes. */
    async switchAfterAudit(nextStore: SelectedStore): Promise<boolean> {
      if (nextStore.id === state.selectedStore.id) return true
      if (switchInFlight) return false
      switchInFlight = true
      try {
        if (!(await recordAudit(state.selectedStore.id, nextStore.id))) return false
        apply(nextStore)
        return true
      } finally {
        switchInFlight = false
      }
    },
  }
}
