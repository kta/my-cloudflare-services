export type PublicPublicationState = Readonly<{
  isActive: boolean
  isOrganizationDisabled: boolean
  receptionStatus: 'open' | 'paused' | undefined
  status: 'published' | 'hidden'
  startsAt: string | null
  endsAt: string | null
}>

/** Return no reason only when the store is safe to expose for a public flow. */
export function publicationUnavailableReason(
  publication: PublicPublicationState,
  now: Date,
):
  | 'organization_disabled'
  | 'store_inactive'
  | 'reception_paused'
  | 'not_published'
  | 'not_started'
  | 'ended'
  | undefined {
  if (publication.isOrganizationDisabled) return 'organization_disabled'
  if (!publication.isActive) return 'store_inactive'
  if (publication.receptionStatus === 'paused') return 'reception_paused'
  if (publication.status !== 'published') return 'not_published'
  const instant = now.toISOString()
  if (publication.startsAt !== null && instant < publication.startsAt) return 'not_started'
  if (publication.endsAt !== null && instant >= publication.endsAt) return 'ended'
  return undefined
}
