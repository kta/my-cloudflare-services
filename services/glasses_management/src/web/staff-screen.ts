import type { StaffLocation } from './staff-navigation'

/** The authenticated, selected-store fetch every staff screen is given. */
export type StaffApi = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * What every staff screen needs and nothing more.
 *
 * The store is passed in rather than read from a global so a screen can never
 * outlive a store switch: the workspace remounts screens with the new store,
 * and a screen that forgot to use these props would fail its own tests.
 */
export type StaffScreenProps = {
  storeId: string
  storeName: string
  api: StaffApi
  navigate: (location: StaffLocation) => void
}
