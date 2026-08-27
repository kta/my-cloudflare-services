export type SelectedStore = {
  id: string
  name: string
  isActive: boolean
  /**
   * 自分の担当店舗か。切替シートの副題（`担当店舗`）にだけ出る。名簿に載って
   * いるだけの店舗と、日々入る店舗を、切り替える前に見分けさせるため。
   */
  isAssigned?: boolean
  /** 未対応の警告件数。0 と「未取得」を混ぜないので、未取得は undefined のまま。 */
  openAlerts?: number
  /** 受付を止めている理由（`設備点検中`）。理由が分からないときは付けない。 */
  suspendedReason?: string
}

/** 切替シートの 1 行。副題も状態語も、色ではなく語で持つ。 */
export type StoreSwitchOption = {
  store: SelectedStore
  /** 名前の下の副題（`営業中 · 警告2件`）。 */
  note: string
  /** 行の右端に出る状態（`選択中` / `営業中` / `受付停止`）。 */
  state: string
  selected: boolean
  /** 受付停止として赤で示す行か。選択中の店舗は今いる場所なので赤にしない。 */
  suspended: boolean
}

/**
 * 承認済みモック `store-switch-approved.html` の行を組み立てる。
 *
 * 副題は「今どこにいるか（営業中）」「担当か」「警告が出ているか」の順で、
 * 停止している店舗だけは理由が先に立つ。切り替えてよいかどうかの判断材料を、
 * 押す前に 1 行で読み切らせるための並びである。
 */
export function storeSwitchOptions(
  stores: SelectedStore[],
  selectedStoreId: string,
): StoreSwitchOption[] {
  return stores.map((store) => {
    const selected = store.id === selectedStoreId
    const parts: string[] = []
    // 停止の理由が分からないときは副題を空にする。状態語がすでに「受付停止」と
    // 言っているので、同じ語を 2 度重ねても読む人には何も足さない。
    if (!store.isActive) {
      if (store.suspendedReason !== undefined) parts.push(store.suspendedReason)
    } else if (selected) parts.push('営業中')
    else if (store.isAssigned === true) parts.push('担当店舗')
    if (store.openAlerts !== undefined && store.openAlerts > 0)
      parts.push(`警告${store.openAlerts}件`)
    return {
      store,
      note: parts.join(' · '),
      // 状態語は「今ここにいる」を最優先にする。選択中の店舗が停止していても
      // 受付停止とは言わない（切り替え先ではないので、押す判断に関わらない）。
      state: selected ? '選択中' : store.isActive ? '営業中' : '受付停止',
      selected,
      suspended: !selected && !store.isActive,
    }
  })
}

/** 店舗名での絞り込み。名前以外（副題・状態語）では絞らない。 */
export function filterStores(stores: SelectedStore[], query: string): SelectedStore[] {
  const needle = query.trim()
  if (needle === '') return stores
  return stores.filter((store) => store.name.includes(needle))
}

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
