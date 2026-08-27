import { expect, test } from 'vitest'
import { isPublicBookingPath, publicBookingSlug } from './app-route'

test('routes only the public booking entry path away from the staff workspace', () => {
  expect(isPublicBookingPath('/book')).toBe(true)
  expect(isPublicBookingPath('/book/')).toBe(true)
  expect(isPublicBookingPath('/book/ginza')).toBe(true)
  expect(isPublicBookingPath('/')).toBe(false)
  expect(isPublicBookingPath('/staff/book')).toBe(false)
})

test('takes a public store slug only from the dedicated booking URL shape', () => {
  expect(publicBookingSlug('/book/ginza')).toBe('ginza')
  expect(publicBookingSlug('/book/%E9%8A%80%E5%BA%A7')).toBe('銀座')
  expect(publicBookingSlug('/book')).toBeUndefined()
  expect(publicBookingSlug('/book/ginza/extra')).toBeUndefined()
})
