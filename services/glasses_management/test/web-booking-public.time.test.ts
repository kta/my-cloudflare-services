import { describe, expect, it } from 'vitest'
import { publicationUnavailableReason } from '../src/worker/domain/publication'

describe('public web-booking publication window', () => {
  const publication = {
    status: 'published' as const,
    startsAt: '2026-08-31T01:00:00.000Z',
    endsAt: '2026-08-31T02:00:00.000Z',
  }

  it.each([
    ['開始の1ms前', '2026-08-31T00:59:59.999Z', 'not_started'],
    ['開始ちょうど', '2026-08-31T01:00:00.000Z', undefined],
    ['終了の1ms前', '2026-08-31T01:59:59.999Z', undefined],
    ['終了ちょうど', '2026-08-31T02:00:00.000Z', 'ended'],
  ] as const)('%s は公開可否を境界どおりに判定する', (_name, now, expected) => {
    expect(
      publicationUnavailableReason(
        { ...publication, isActive: true, isOrganizationDisabled: false, receptionStatus: 'open' },
        new Date(now),
      ),
    ).toBe(expected)
  })
})
