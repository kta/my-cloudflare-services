import {
  PublicAvailabilityResponse,
  type PublicBookingCreate,
  PublicBookingResult,
  type PublicReservationCancel,
  type PublicReservationChange,
  PublicReservationChangeResult,
  PublicReservationMutationResult,
  PublicReservationStatus,
  type PublicReservationVerification,
  PublicReservationVerificationResult,
  PublicStoreDetail,
  PublicStoreSummary,
} from '@app/contracts'
import type { PublicBookingApi } from './PublicBooking'

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class PublicBookingRequestError extends Error {
  constructor(
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(`Public booking request failed (${status})`)
    this.name = 'PublicBookingRequestError'
  }
}

async function readJson(fetcher: Fetcher, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetcher(path, init)
  if (!response.ok) {
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      /* error responses may have no JSON body */
    }
    throw new PublicBookingRequestError(response.status, payload)
  }
  return response.json()
}

export function createPublicBookingApi(fetcher: Fetcher = fetch): PublicBookingApi {
  return {
    listStores: async () =>
      PublicStoreSummary.array().parse(await readJson(fetcher, '/api/public/stores')),
    readStore: async (slug) =>
      PublicStoreDetail.parse(
        await readJson(fetcher, `/api/public/stores/${encodeURIComponent(slug)}`),
      ),
    readSlots: async (slug, date, purposeIds) => {
      const query = new URLSearchParams({ date, purposeIds: purposeIds.join(',') })
      return PublicAvailabilityResponse.parse(
        await readJson(
          fetcher,
          `/api/public/stores/${encodeURIComponent(slug)}/slots?${query.toString()}`,
        ),
      )
    },
    createReservation: async (slug, input: PublicBookingCreate, idempotencyKey) =>
      PublicBookingResult.parse(
        await readJson(fetcher, `/api/public/stores/${encodeURIComponent(slug)}/reservations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
          body: JSON.stringify(input),
        }),
      ),
    readReservationStatus: async (confirmationKey) =>
      PublicReservationStatus.parse(
        await readJson(
          fetcher,
          `/api/public/reservations/status?${new URLSearchParams({ confirmationKey }).toString()}`,
        ),
      ),
    verifyReservation: async (input: PublicReservationVerification) =>
      PublicReservationVerificationResult.parse(
        await readJson(fetcher, '/api/public/reservations/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      ),
    cancelReservation: async (
      reservationId: string,
      input: PublicReservationCancel,
      verificationToken,
      idempotencyKey,
    ) =>
      PublicReservationMutationResult.parse(
        await readJson(
          fetcher,
          `/api/public/reservations/${encodeURIComponent(reservationId)}/cancel`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-reservation-verification-token': verificationToken,
              'idempotency-key': idempotencyKey,
            },
            body: JSON.stringify(input),
          },
        ),
      ),
    changeReservation: async (
      reservationId: string,
      input: PublicReservationChange,
      verificationToken,
      idempotencyKey,
    ) =>
      PublicReservationChangeResult.parse(
        await readJson(fetcher, `/api/public/reservations/${encodeURIComponent(reservationId)}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-reservation-verification-token': verificationToken,
            'idempotency-key': idempotencyKey,
          },
          body: JSON.stringify(input),
        }),
      ),
  }
}
