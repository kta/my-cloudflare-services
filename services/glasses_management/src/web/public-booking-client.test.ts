import { expect, test, vi } from 'vitest'
import { createPublicBookingApi } from './public-booking-client'

const store = {
  slug: 'ginza',
  name: '銀座店',
  contactPhone: '03-0000-0000',
  region: '東京都',
  nearestStation: '銀座駅',
  // 検索カードは詳細を開かずにアクセス文と本日営業を読ませる（契約の既定値つき）。
  accessText: '銀座駅 A3出口 徒歩2分',
  todayBusinessHours: '10:00–19:00',
}

test('validates a published-store response and encodes the public availability query', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/offers?')) {
      return Response.json({ timezone: 'Asia/Tokyo', durationMinutes: 60, slots: [] })
    }
    return Response.json([store])
  })
  const api = createPublicBookingApi(fetcher)

  await expect(api.listStores()).resolves.toEqual([store])
  // 候補枠は日付を渡さない（日付は入力ではなく走査の結果である）。
  await expect(
    api.readOffers('ginza', [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]),
  ).resolves.toMatchObject({ slots: [] })
  expect(String(fetcher.mock.calls[1]?.[0])).toBe(
    '/api/public/stores/ginza/offers?purposeIds=00000000-0000-4000-8000-000000000001%2C00000000-0000-4000-8000-000000000002',
  )
})

test('rejects a non-successful or contract-invalid public API response', async () => {
  const unavailable = createPublicBookingApi(async () => new Response(null, { status: 503 }))
  await expect(unavailable.listStores()).rejects.toThrow('Public booking request failed (503)')

  const invalid = createPublicBookingApi(async () => Response.json([{ slug: 'ginza' }]))
  await expect(invalid.listStores()).rejects.toThrow()
})

test('reads only the coarse result for an in-memory confirmation key', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({ status: 'pending' }))
  const api = createPublicBookingApi(fetcher)

  await expect(api.readReservationStatus('confirmation-key-1')).resolves.toEqual({
    status: 'pending',
  })
  expect(String(fetcher.mock.calls[0]?.[0])).toBe(
    '/api/public/reservations/status?confirmationKey=confirmation-key-1',
  )
})

test('sends a company-issued management code only to the verification endpoint', async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({
      reservationId: '00000000-0000-4000-8000-000000000001',
      verificationToken: 'a'.repeat(32),
      expiresAt: '2026-09-01T00:15:00.000Z',
      version: 1,
      startAt: '2026-09-01T01:00:00.000Z',
      purposeIds: ['00000000-0000-4000-8000-000000000002'],
      storeSlug: 'ginza',
    }),
  )
  const api = createPublicBookingApi(fetcher)

  await expect(
    api.verifyReservation({ reservationNumber: 'EY-0001', managementCode: 'ABCD-1234' }),
  ).resolves.toMatchObject({ version: 1, storeSlug: 'ginza' })
  expect(String(fetcher.mock.calls[0]?.[0])).toBe('/api/public/reservations/verify')
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reservationNumber: 'EY-0001', managementCode: 'ABCD-1234' }),
  })
})
