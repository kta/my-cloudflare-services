import { describe, expect, it, test, vi } from 'vitest'
import { createStoreSwitchController } from './store-switch'

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
