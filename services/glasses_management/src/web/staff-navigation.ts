/**
 * Where the staff workspace currently is, and nothing else.
 *
 * Screen parameters live here rather than in the URL because a shared iPad must
 * not leave a customer id or a ledger day in browser history, and because a
 * store switch has to be able to drop every parameter at once (UC-EYEX-070).
 */
export type StaffLocation =
  | { screen: 'home' }
  | { screen: 'booking' }
  | { screen: 'ledger'; date: string }
  | { screen: 'journey' }
  | { screen: 'reception-history' }
  | { screen: 'reservation-search' }
  | { screen: 'reservation-detail'; reservationId: string }
  | { screen: 'customers' }
  | { screen: 'shared-terminals' }
  | { screen: 'settings' }
  | { screen: 'attention-settings' }
  | { screen: 'attention-review'; customerId: string; customerName: string }
  | { screen: 'audit' }
  | { screen: 'customer-merge' }
  | { screen: 'recording-ops' }
  | { screen: 'analytics' }
  | { screen: 'alerts' }

const HOME: StaffLocation = { screen: 'home' }

function sameLocation(left: StaffLocation, right: StaffLocation): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function createStaffNavigation(initial: StaffLocation = HOME) {
  let location = initial
  const listeners = new Set<() => void>()
  const publish = () => {
    listeners.forEach((listener) => {
      listener()
    })
  }
  const moveTo = (next: StaffLocation) => {
    // Identity stability matters: useSyncExternalStore re-renders whenever the
    // snapshot reference changes, so an unchanged screen must keep its object.
    if (sameLocation(location, next)) return
    location = next
    publish()
  }

  return {
    snapshot(): StaffLocation {
      return location
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    navigate(next: StaffLocation) {
      moveTo(next)
    },
    /** Drop everything scoped to the store being left, including the screen. */
    resetForStoreSwitch() {
      moveTo(HOME)
    },
  }
}
