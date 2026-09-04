/**
 * Canonical organization → domain synchronization.
 *
 * The admin D1 write is authoritative and is intentionally performed before
 * this call. A downstream outage therefore cannot lose an organization; the
 * caller receives an explicit retryable failure and the next reconciliation or
 * operator retry can converge the domain copy.
 */
import {
  type Organization,
  OrganizationSync,
  type OrganizationSync as OrganizationSyncValue,
} from '@app/contracts'
import type { Fetcher } from '@cloudflare/workers-types'

const ORGANIZATION_SYNC_URL = 'https://glasses-management.internal/api/internal/organizations/sync'

type OrganizationSyncFailure = {
  ok: false
  /** Deliberately coarse: do not expose service URLs or transport details. */
  retryable: boolean
}

export type OrganizationSyncOutcome = { ok: true } | OrganizationSyncFailure

function matchesCanonicalSnapshot(
  received: OrganizationSyncValue,
  expected: OrganizationSyncValue,
): boolean {
  return (
    received.id === expected.id &&
    received.name === expected.name &&
    received.plan === expected.plan &&
    received.isDisabled === expected.isDisabled &&
    received.createdAt === expected.createdAt &&
    received.revision === expected.revision
  )
}

/**
 * Send a validated organization snapshot to the domain Worker. Missing
 * binding/key is fail-closed and treated as retryable configuration failure.
 * The key is never included in logs or response data.
 */
export async function syncOrganization(
  binding: Fetcher | undefined,
  internalKey: string | undefined,
  value: Organization,
  revision = 0,
): Promise<OrganizationSyncOutcome> {
  const organization: OrganizationSyncValue = OrganizationSync.parse({ ...value, revision })
  if (!binding || !internalKey) {
    console.error('organization sync unavailable: binding or internal key is not configured')
    return { ok: false, retryable: true }
  }

  try {
    const response = await binding.fetch(ORGANIZATION_SYNC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-key': internalKey,
      },
      body: JSON.stringify(organization),
    })

    if (!response.ok) {
      console.error('organization sync rejected by domain', { status: response.status })
      return { ok: false, retryable: response.status === 429 || response.status >= 500 }
    }
    const applied = OrganizationSync.safeParse(await response.json())
    if (!applied.success || !matchesCanonicalSnapshot(applied.data, organization)) {
      console.error('organization sync returned an invalid application result')
      return { ok: false, retryable: true }
    }
  } catch {
    console.error('organization sync unavailable: domain binding request failed')
    return { ok: false, retryable: true }
  }
  return { ok: true }
}

/* ------------------------------------------------------------------------- *
 * Store membership synchronization (UC-EYE-149).
 *
 * admin owns users, standard roles and store assignments; the domain receives
 * only the resulting membership. A revoked assignment is delivered as the same
 * membership id with an empty permission list, so the domain converges without
 * needing a separate delete channel.
 * ------------------------------------------------------------------------- */

const STORE_MEMBERSHIP_SYNC_URL =
  'https://glasses-management.internal/api/internal/store-memberships/sync'

export type StoreMembershipPayload = {
  id: string
  organizationId: string
  storeId: string
  userId: string
  permissions: readonly string[]
  createdAt: string
}

/**
 * Deliver every membership snapshot. The admin D1 write already happened, so a
 * downstream outage yields an explicit retryable failure rather than a rollback
 * or a false success. The internal key is never logged.
 */
export async function syncStoreMemberships(
  binding: Fetcher | undefined,
  internalKey: string | undefined,
  memberships: readonly StoreMembershipPayload[],
): Promise<OrganizationSyncOutcome> {
  if (memberships.length === 0) return { ok: true }
  if (!binding || !internalKey) {
    console.error('store membership sync unavailable: binding or internal key is not configured')
    return { ok: false, retryable: true }
  }
  for (const membership of memberships) {
    try {
      const response = await binding.fetch(STORE_MEMBERSHIP_SYNC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify(membership),
      })
      if (!response.ok) {
        console.error('store membership sync rejected by domain', { status: response.status })
        return { ok: false, retryable: response.status === 429 || response.status >= 500 }
      }
    } catch {
      console.error('store membership sync unavailable: domain binding request failed')
      return { ok: false, retryable: true }
    }
  }
  return { ok: true }
}
