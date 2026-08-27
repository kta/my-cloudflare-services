import {
  ATTENTION_INPUT_GUIDANCE,
  type AttentionCapability,
  AttentionCapabilityAssignment as AttentionCapabilityAssignmentSchema,
  type AttentionNoteFieldDifference,
  type AttentionNoteInput,
  AttentionReviewMode,
  type AttentionRole,
  AttentionSettings,
  AttentionSharingScope,
  type StorePermission,
} from '@app/contracts'

/**
 * Store id used by the organization-wide default row. SQLite treats NULLs as
 * distinct inside a unique index, so a NULL scope would silently allow two
 * organization defaults; a sentinel that is not a UUID cannot collide with a
 * real store id.
 */
export const ATTENTION_ORGANIZATION_SCOPE = '*'

export type AttentionCapabilityAssignment = {
  capability: AttentionCapability
  minimumRole: AttentionRole
}

/**
 * The initial value applied to a new organization (UC-EYEX-148): every staff
 * member may read and register for review, and only 店舗管理者以上 may publish,
 * revise or hide.
 */
export const DEFAULT_ATTENTION_CAPABILITIES: readonly AttentionCapabilityAssignment[] = [
  { capability: 'read', minimumRole: 'staff' },
  { capability: 'write', minimumRole: 'staff' },
  { capability: 'publish', minimumRole: 'store_manager' },
  { capability: 'revise', minimumRole: 'store_manager' },
  { capability: 'hide', minimumRole: 'store_manager' },
]

const StoredCapabilities = AttentionCapabilityAssignmentSchema.array()

export function serializeAttentionCapabilities(
  capabilities: readonly AttentionCapabilityAssignment[],
): string {
  return JSON.stringify(capabilities)
}

/** A corrupt or partial configuration falls back to the stricter default. */
function parseCapabilities(serialized: string): AttentionCapabilityAssignment[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    return [...DEFAULT_ATTENTION_CAPABILITIES]
  }
  const result = StoredCapabilities.safeParse(parsed)
  if (!result.success) return [...DEFAULT_ATTENTION_CAPABILITIES]
  const stored = new Map(result.data.map((rule) => [rule.capability, rule.minimumRole]))
  // A partial configuration is a corrupt one: fall back to the whole default
  // matrix rather than granting the capabilities it happens to mention.
  if (stored.size !== DEFAULT_ATTENTION_CAPABILITIES.length)
    return [...DEFAULT_ATTENTION_CAPABILITIES]
  return DEFAULT_ATTENTION_CAPABILITIES.map((fallback) => ({
    capability: fallback.capability,
    minimumRole: stored.get(fallback.capability) ?? fallback.minimumRole,
  }))
}

export type AttentionSettingsRow = {
  reviewMode: string
  sharingScope: string
  storeOverrideAllowed: string
  capabilitiesJson: string
}

function reviewModeOf(row: AttentionSettingsRow | null | undefined) {
  const parsed = AttentionReviewMode.safeParse(row?.reviewMode)
  return parsed.success ? parsed.data : 'review_required'
}

function sharingScopeOf(row: AttentionSettingsRow | null | undefined) {
  const parsed = AttentionSharingScope.safeParse(row?.sharingScope)
  return parsed.success ? parsed.data : 'permitted_stores'
}

/**
 * Resolve the configuration applied to one store: the organization default,
 * overridden by the store row only while the organization allows overriding
 * at all. The applied origin travels with the answer (AC-EYEX-84).
 */
export function resolveAttentionSettings(input: {
  storeId: string
  organization: AttentionSettingsRow | null | undefined
  store: AttentionSettingsRow | null | undefined
}): AttentionSettings {
  const organization = input.organization ?? null
  const storeOverrideAllowed = organization === null || organization.storeOverrideAllowed === '1'
  const override = storeOverrideAllowed ? (input.store ?? null) : null
  const applied = override ?? organization
  const origin = override === null ? 'organization' : 'store'
  const capabilities =
    applied === null
      ? [...DEFAULT_ATTENTION_CAPABILITIES]
      : parseCapabilities(applied.capabilitiesJson)

  return AttentionSettings.parse({
    storeId: input.storeId,
    reviewMode: reviewModeOf(applied),
    sharingScope: sharingScopeOf(applied),
    storeOverrideAllowed,
    origin,
    capabilities: capabilities.map((rule) => ({ ...rule, origin })),
    guidance: ATTENTION_INPUT_GUIDANCE,
  })
}

const ROLE_RANK: Record<AttentionRole, number> = {
  staff: 1,
  store_manager: 2,
  organization_admin: 3,
}

/**
 * Derive the configuration role. The JWT only distinguishes admin from staff,
 * so 店舗管理者 is proven by holding `store.manage` in the selected store.
 */
export function attentionRoleFor(
  jwtRole: 'admin' | 'staff',
  permissions: readonly StorePermission[],
): AttentionRole {
  if (jwtRole === 'admin') return 'organization_admin'
  return permissions.includes('store.manage') ? 'store_manager' : 'staff'
}

export function mayUseAttentionCapability(
  settings: AttentionSettings,
  capability: AttentionCapability,
  role: AttentionRole,
): boolean {
  const rule = settings.capabilities.find((entry) => entry.capability === capability)
  if (rule === undefined) return false
  return ROLE_RANK[role] >= ROLE_RANK[rule.minimumRole]
}

/** The old/new difference shown when a stale version is published (AC-EYEX-117). */
export function noteDifferences(
  before: AttentionNoteInput,
  after: AttentionNoteInput,
): AttentionNoteFieldDifference[] {
  const fields: (keyof AttentionNoteInput)[] = ['body', 'occurredAt', 'basis', 'recommendedAction']
  return fields
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field], after: after[field] }))
}
