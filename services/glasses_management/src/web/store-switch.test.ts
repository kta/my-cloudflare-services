import { describe, expect, it, test, vi } from 'vitest'
import { createStoreSwitchController, filterStores, storeSwitchOptions } from './store-switch'

describe('selected-store state', () => {
  it('previews an explicit discard and clears all store-bound state only after its enclosed audit succeeds', async () => {
    const audit = vi.fn().mockResolvedValue(true)
    const controller = createStoreSwitchController(
      { id: 'store-a', name: '銀座店', isActive: true },
      audit,
    )
    controller.setDraftState({
      search: '田中',
      reservationId: 'reservation-a',
      form: { purpose: '新調相談' },
    })

    expect(controller.prepareSwitch({ id: 'store-b', name: '丸の内店', isActive: true })).toEqual({
      kind: 'confirm_discard',
      fromStore: '銀座店',
      toStore: '丸の内店',
    })
    expect(controller.snapshot().selectedStore.id).toBe('store-a')

    await expect(
      controller.switchAfterAudit({ id: 'store-b', name: '丸の内店', isActive: true }),
    ).resolves.toBe(true)
    expect(audit).toHaveBeenCalledWith('store-a', 'store-b')
    expect(controller.snapshot()).toEqual({
      selectedStore: { id: 'store-b', name: '丸の内店', isActive: true },
      draftState: {},
    })
  })

  it('does not expose a local mutation API that can bypass the server audit', () => {
    const controller = createStoreSwitchController(
      { id: 'store-a', name: '銀座店', isActive: true },
      async () => true,
    )

    expect(controller).not.toHaveProperty('requestSwitch')
    expect(controller).not.toHaveProperty('confirmDiscard')
    expect(controller).not.toHaveProperty('commitSwitch')
  })
})

test('forgets the unsaved input once the operator no longer has any', () => {
  // Draft state is a claim about right now. Without a way to withdraw it, a
  // finished or discarded booking would keep interrupting every later switch
  // with a discard prompt that has nothing to discard (UC-EYEX-065).
  const controller = createStoreSwitchController(
    { id: 'store-a', name: '銀座店', isActive: true },
    async () => true,
  )
  controller.setDraftState({ form: { date: '2026-09-01' } })
  expect(controller.prepareSwitch({ id: 'store-b', name: '丸の内店', isActive: true }).kind).toBe(
    'confirm_discard',
  )

  controller.clearDraftState()

  expect(controller.prepareSwitch({ id: 'store-b', name: '丸の内店', isActive: true }).kind).toBe(
    'ready',
  )
})

/*
 * 切替シートの 1 行に出す文言（承認済みモック `store-switch-approved.html`）。
 *
 *   銀座店   営業中 · 警告2件      選択中
 *   丸の内店 担当店舗              営業中
 *   日本橋店 担当店舗 · 警告1件    営業中
 *   新宿店   設備点検中            受付停止
 *
 * 「今どこにいるか」「担当か」「警告が出ているか」を 1 行で読み切らせるための
 * 副題なので、色ではなく語で持つ。表示の都合ではなく状態の写像なので、React に
 * 持たせず純粋な関数として境界を直接試せるようにする。
 */
describe('切替シートの行', () => {
  const stores = [
    { id: 'a', name: '銀座店', isActive: true, openAlerts: 2 },
    { id: 'b', name: '丸の内店', isActive: true, isAssigned: true },
    { id: 'c', name: '日本橋店', isActive: true, isAssigned: true, openAlerts: 1 },
    { id: 'd', name: '新宿店', isActive: false, suspendedReason: '設備点検中' },
  ]

  it('モックの副題と状態語をそのまま組み立てる', () => {
    expect(storeSwitchOptions(stores, 'a')).toEqual([
      {
        store: stores[0],
        note: '営業中 · 警告2件',
        state: '選択中',
        selected: true,
        suspended: false,
      },
      { store: stores[1], note: '担当店舗', state: '営業中', selected: false, suspended: false },
      {
        store: stores[2],
        note: '担当店舗 · 警告1件',
        state: '営業中',
        selected: false,
        suspended: false,
      },
      { store: stores[3], note: '設備点検中', state: '受付停止', selected: false, suspended: true },
    ])
  })

  it('停止理由が分からなければ副題は空にする（状態語と同じ語を重ねない）', () => {
    expect(storeSwitchOptions([{ id: 'x', name: '青山店', isActive: false }], 'a')[0]).toEqual({
      store: { id: 'x', name: '青山店', isActive: false },
      note: '',
      state: '受付停止',
      selected: false,
      suspended: true,
    })
  })

  it('選択中の店舗が停止していても、状態は 選択中 と言う（今ここにいるため）', () => {
    const [option] = storeSwitchOptions([{ id: 'a', name: '銀座店', isActive: false }], 'a')
    expect(option?.state).toBe('選択中')
    expect(option?.note).toBe('')
    expect(option?.suspended).toBe(false)
  })

  it('店舗名で絞り込む（前後の空白は無視する）', () => {
    expect(filterStores(stores, ' 丸の内 ').map((store) => store.id)).toEqual(['b'])
    expect(filterStores(stores, '').map((store) => store.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})
