import { describe, expect, it, vi } from 'vitest'
import { createStaffNavigation } from './staff-navigation'

describe('staff navigation', () => {
  it('starts on the home screen with no screen parameters', () => {
    expect(createStaffNavigation().snapshot()).toEqual({ screen: 'home' })
  })

  it('opens the ledger for a chosen day from the date strip', () => {
    const navigation = createStaffNavigation()
    navigation.navigate({ screen: 'ledger', date: '2026-08-31' })
    expect(navigation.snapshot()).toEqual({ screen: 'ledger', date: '2026-08-31' })
  })

  it('notifies subscribers when the screen changes and stops after unsubscribe', () => {
    const navigation = createStaffNavigation()
    const listener = vi.fn()
    const unsubscribe = navigation.subscribe(listener)
    navigation.navigate({ screen: 'reservation-search' })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    navigation.navigate({ screen: 'home' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the same snapshot object when navigating to the screen already shown', () => {
    // useSyncExternalStore compares snapshots by identity; a fresh object for an
    // unchanged screen would loop the render forever.
    const navigation = createStaffNavigation()
    navigation.navigate({ screen: 'ledger', date: '2026-08-31' })
    const before = navigation.snapshot()
    navigation.navigate({ screen: 'ledger', date: '2026-08-31' })
    expect(navigation.snapshot()).toBe(before)
  })

  it('returns to home and drops every screen parameter when the selected store changes', () => {
    // A store switch must not carry the previous store's selected reservation,
    // search terms or ledger day across the boundary.
    const navigation = createStaffNavigation()
    navigation.navigate({ screen: 'reservation-detail', reservationId: 'res-1' })
    navigation.resetForStoreSwitch()
    expect(navigation.snapshot()).toEqual({ screen: 'home' })
  })

  it('publishes the reset so a mounted screen cannot keep rendering foreign data', () => {
    const navigation = createStaffNavigation()
    navigation.navigate({ screen: 'reservation-detail', reservationId: 'res-1' })
    const listener = vi.fn()
    navigation.subscribe(listener)
    navigation.resetForStoreSwitch()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not publish a reset that changes nothing', () => {
    const navigation = createStaffNavigation()
    const listener = vi.fn()
    navigation.subscribe(listener)
    navigation.resetForStoreSwitch()
    expect(listener).not.toHaveBeenCalled()
  })
})

it('reaches the shared-terminal management screen and drops it on a store switch', () => {
  // Device management is store-scoped: a terminal belongs to one store, so the
  // screen must not survive into another store's workspace.
  const navigation = createStaffNavigation()
  navigation.navigate({ screen: 'shared-terminals' })
  expect(navigation.snapshot()).toEqual({ screen: 'shared-terminals' })
  navigation.resetForStoreSwitch()
  expect(navigation.snapshot()).toEqual({ screen: 'home' })
})

it('reaches the settings guide and drops it on a store switch', () => {
  // Settings belong to one store; carrying the guide across a switch would let
  // an operator edit store B while reading store A's values.
  const navigation = createStaffNavigation()
  navigation.navigate({ screen: 'settings' })
  expect(navigation.snapshot()).toEqual({ screen: 'settings' })
  navigation.resetForStoreSwitch()
  expect(navigation.snapshot()).toEqual({ screen: 'home' })
})

it.each([
  ['attention-settings', { screen: 'attention-settings' } as const],
  ['audit', { screen: 'audit' } as const],
  ['customer-merge', { screen: 'customer-merge' } as const],
  ['recording-ops', { screen: 'recording-ops' } as const],
])('reaches the %s screen and drops it on a store switch', (_label, location) => {
  // Every one of these is store-scoped: notes, audit rows, customer records and
  // recordings all belong to one store, so none may survive a switch.
  const navigation = createStaffNavigation()
  navigation.navigate(location)
  expect(navigation.snapshot()).toEqual(location)
  navigation.resetForStoreSwitch()
  expect(navigation.snapshot()).toEqual({ screen: 'home' })
})

it('carries the customer an attention review is about, and forgets it on a store switch', () => {
  const navigation = createStaffNavigation()
  navigation.navigate({
    screen: 'attention-review',
    customerId: '00000000-0000-4000-8000-0000000000c1',
    customerName: '田中 花子',
  })
  expect(navigation.snapshot()).toMatchObject({ screen: 'attention-review' })
  navigation.resetForStoreSwitch()
  expect(navigation.snapshot()).toEqual({ screen: 'home' })
})

it.each([
  ['analytics', { screen: 'analytics' } as const],
  ['alerts', { screen: 'alerts' } as const],
])('reaches the %s screen and drops it on a store switch', (_label, location) => {
  const navigation = createStaffNavigation()
  navigation.navigate(location)
  expect(navigation.snapshot()).toEqual(location)
  navigation.resetForStoreSwitch()
  expect(navigation.snapshot()).toEqual({ screen: 'home' })
})
