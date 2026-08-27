import { describe, expect, it, test } from 'vitest'
import {
  isPublicBookingPath,
  isSharedTerminalPath,
  publicBookingSlug,
  sharedTerminalEntry,
} from './app-route'

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

describe('shared terminal entry', () => {
  it('reads the terminal id and its one-time token from the entry path', () => {
    // The session API is addressed by terminal id, and the device knows only
    // what the entry link carries, so the link must carry both.
    expect(isSharedTerminalPath('/terminal/term-1/abc123')).toBe(true)
    expect(sharedTerminalEntry('/terminal/term-1/abc123')).toEqual({
      terminalId: 'term-1',
      token: 'abc123',
    })
  })

  it('decodes each segment exactly once', () => {
    expect(sharedTerminalEntry('/terminal/a%2Fb/c%2Bd')).toEqual({
      terminalId: 'a/b',
      token: 'c+d',
    })
  })

  it('refuses anything that is not the exact entry shape', () => {
    for (const path of ['/terminal', '/terminal/', '/terminal/only-one', '/book/ginza', '/']) {
      expect(isSharedTerminalPath(path)).toBe(false)
      expect(sharedTerminalEntry(path)).toBeUndefined()
    }
  })

  it('refuses a malformed encoding rather than guessing', () => {
    expect(sharedTerminalEntry('/terminal/term-1/%E0%A4%A')).toBeUndefined()
  })

  it('keeps the public booking entry and the terminal entry apart', () => {
    expect(isPublicBookingPath('/terminal/term-1/abc123')).toBe(false)
    expect(isSharedTerminalPath('/book/ginza')).toBe(false)
  })
})
