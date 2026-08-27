import { describe, expect, it } from 'vitest'
import { distanceKilometers } from '../src/worker/domain/public-location'

describe('public store location ordering', () => {
  it('orders the same station before a distant store from the customer location', () => {
    const customer = { latitude: 35.6717, longitude: 139.765 }
    expect(distanceKilometers(customer, { latitude: 35.6718, longitude: 139.7651 })).toBeLessThan(
      distanceKilometers(customer, { latitude: 35.6812, longitude: 139.7671 }),
    )
  })
})
