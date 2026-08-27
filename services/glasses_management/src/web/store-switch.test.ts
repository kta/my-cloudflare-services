import { describe, expect, it, vi } from 'vitest'
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
