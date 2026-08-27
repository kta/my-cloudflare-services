import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** Admin is the source of truth; this is the tenant-authenticated local copy.
 * Organization ids retain the canonical admin format and may be non-UUID. */
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  plan: text('plan').notNull(),
  isDisabled: text('is_disabled').notNull(),
  createdAt: text('created_at').notNull(),
  // Monotonic revision from admin. Older service-binding deliveries must not
  // roll a disabled organization back to an enabled snapshot.
  syncRevision: integer('sync_revision').notNull(),
})

/** Stores belong to exactly one synced organization; foreign keys are intentionally absent. */
export const stores = sqliteTable(
  'stores',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    isActive: text('is_active').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('stores_organization_id_idx').on(table.organizationId),
    index('stores_organization_active_idx').on(table.organizationId, table.isActive),
    uniqueIndex('stores_organization_slug_unique_idx').on(table.organizationId, table.slug),
  ],
)

/** Store-level permissions are domain-owned and stored as JSON text in D1. */
export const storeMemberships = sqliteTable(
  'store_memberships',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    userId: text('user_id').notNull(),
    permissions: text('permissions').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('store_memberships_org_user_idx').on(table.organizationId, table.userId),
    uniqueIndex('store_memberships_org_store_user_idx').on(
      table.organizationId,
      table.storeId,
      table.userId,
    ),
  ],
)

/** A revocable shared-device credential; only tokenHash is ever persisted. */
export const sharedTerminals = sqliteTable(
  'shared_terminals',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull(),
    idleTimeoutSeconds: integer('idle_timeout_seconds').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at'),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
    // CAS anchor for a revoke audit row; prevents a losing concurrent revoke
    // from appending an audit event without changing the terminal.
    revocationOperationId: text('revocation_operation_id'),
  },
  (table) => [
    uniqueIndex('shared_terminals_token_hash_unique_idx').on(table.tokenHash),
    index('shared_terminals_org_store_idx').on(table.organizationId, table.storeId),
    index('shared_terminals_expiry_idx').on(table.expiresAt),
  ],
)

/** Hash-only, short-lived personal reauthentication grant for one shared terminal. */
export const sharedTerminalReauthSessions = sqliteTable(
  'shared_terminal_reauth_sessions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    terminalId: text('terminal_id').notNull(),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    actionClass: text('action_class').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('shared_terminal_reauth_token_hash_unique_idx').on(table.tokenHash),
    index('shared_terminal_reauth_terminal_expiry_idx').on(table.terminalId, table.expiresAt),
    index('shared_terminal_reauth_org_store_user_idx').on(
      table.organizationId,
      table.storeId,
      table.userId,
    ),
  ],
)

/**
 * Append-only security and business audit trail.
 *
 * The R2 object and arbitrary PII are never stored here. `metadata` is a
 * deliberately caller-shaped JSON document containing only the minimum
 * non-sensitive facts needed to explain an operation. The migration also
 * installs guards against UPDATE/DELETE so the append-only property is not
 * dependent on every future route remembering it.
 */
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id'),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    requestId: text('request_id'),
    metadata: text('metadata').notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    index('audit_events_org_occurred_idx').on(table.organizationId, table.occurredAt),
    index('audit_events_org_entity_idx').on(table.organizationId, table.entityType, table.entityId),
  ],
)

/**
 * D1-backed idempotency ledger. The unique key is tenant and operation
 * scoped, so a key from one organization can never suppress another one's
 * request. `resultJson` is populated only after the operation has committed.
 */
export const idempotencyRecords = sqliteTable(
  'idempotency_records',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    operation: text('operation').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull(),
    resultJson: text('result_json'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('idempotency_org_operation_key_idx').on(
      table.organizationId,
      table.operation,
      table.key,
    ),
    index('idempotency_expires_at_idx').on(table.expiresAt),
  ],
)

/** One atomically published configuration snapshot per organization/store. */
export const availabilitySettings = sqliteTable(
  'availability_settings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    version: integer('version').notNull(),
    receptionStatus: text('reception_status').notNull(),
    updatedBy: text('updated_by').notNull(),
    // Existing reservations predate operational progress. New writes set this
    // field, while migration-era rows use `createdAt` as their read fallback.
    updatedAt: text('updated_at'),
  },
  (table) => [
    uniqueIndex('availability_settings_org_store_idx').on(table.organizationId, table.storeId),
  ],
)

/** Explicit public-Web publication boundary; internal settings never imply public exposure. */
export const webBookingPublications = sqliteTable(
  'web_booking_publications',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    publicSlug: text('public_slug').notNull(),
    status: text('status').notNull(),
    startsAt: text('starts_at'),
    endsAt: text('ends_at'),
    contactPhone: text('contact_phone').notNull(),
    accessText: text('access_text').notNull(),
    notice: text('notice').notNull(),
    region: text('region').notNull(),
    nearestStation: text('nearest_station').notNull(),
    latitude: text('latitude'),
    longitude: text('longitude'),
    publicPurposeIdsJson: text('public_purpose_ids_json').notNull(),
    publicPurposesJson: text('public_purposes_json'),
    version: integer('version').notNull(),
    publishedAt: text('published_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('web_booking_publications_org_store_unique_idx').on(
      table.organizationId,
      table.storeId,
    ),
    uniqueIndex('web_booking_publications_public_slug_unique_idx').on(table.publicSlug),
    index('web_booking_publications_status_window_idx').on(
      table.status,
      table.startsAt,
      table.endsAt,
    ),
  ],
)

/** Public-Web-only evidence. Secrets are hash-only; customer input is retained as a factual submission snapshot. */
export const webBookingRecords = sqliteTable(
  'web_booking_records',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    reservationId: text('reservation_id').notNull(),
    confirmationKeyHash: text('confirmation_key_hash'),
    managementCodeHash: text('management_code_hash').notNull(),
    consentVersion: text('consent_version').notNull(),
    consentedAt: text('consented_at').notNull(),
    inputHistoryJson: text('input_history_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('web_booking_records_org_reservation_unique_idx').on(
      table.organizationId,
      table.reservationId,
    ),
    uniqueIndex('web_booking_records_confirmation_key_unique_idx').on(table.confirmationKeyHash),
    index('web_booking_records_confirmation_key_idx').on(table.confirmationKeyHash),
    index('web_booking_records_org_store_created_idx').on(
      table.organizationId,
      table.storeId,
      table.createdAt,
    ),
  ],
)

/** Append-only delivery observations; payloads and management codes never enter this table. */
export const webBookingNotificationAttempts = sqliteTable(
  'web_booking_notification_attempts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    reservationId: text('reservation_id').notNull(),
    notificationId: text('notification_id').notNull(),
    notificationType: text('notification_type').notNull(),
    status: text('status').notNull(),
    attemptedAt: text('attempted_at').notNull(),
  },
  (table) => [
    index('web_booking_notification_attempts_org_reservation_idx').on(
      table.organizationId,
      table.reservationId,
      table.attemptedAt,
    ),
    uniqueIndex('web_booking_notification_attempts_notification_status_unique_idx').on(
      table.organizationId,
      table.notificationId,
      table.status,
    ),
  ],
)

/** Company-issued code history. Hashes are immutable; counters/revocation protect the active issue. */
export const webBookingManagementCodeIssues = sqliteTable(
  'web_booking_management_code_issues',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    reservationId: text('reservation_id').notNull(),
    codeHash: text('code_hash').notNull(),
    issuedAt: text('issued_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    failedAttempts: integer('failed_attempts').notNull(),
    issuedBy: text('issued_by').notNull(),
  },
  (table) => [
    uniqueIndex('web_booking_management_code_issues_hash_unique_idx').on(table.codeHash),
    index('web_booking_management_code_issues_org_reservation_idx').on(
      table.organizationId,
      table.reservationId,
      table.issuedAt,
    ),
  ],
)

/** A successful code verification grants a short, reservation-scoped, hash-only bearer session. */
export const webBookingVerifiedSessions = sqliteTable(
  'web_booking_verified_sessions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    reservationId: text('reservation_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('web_booking_verified_sessions_token_hash_unique_idx').on(table.tokenHash),
    index('web_booking_verified_sessions_org_reservation_idx').on(
      table.organizationId,
      table.reservationId,
      table.expiresAt,
    ),
  ],
)

/** Weekly opening periods are JSON because a day can contain a lunch split. */
export const availabilityBusinessHours = sqliteTable(
  'availability_business_hours',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    dayOfWeek: integer('day_of_week').notNull(),
    periodsJson: text('periods_json').notNull(),
  },
  (table) => [
    uniqueIndex('availability_business_hours_org_store_day_idx').on(
      table.organizationId,
      table.storeId,
      table.dayOfWeek,
    ),
  ],
)

/** A date-specific closed/open/paused override for the weekly hours. */
export const availabilityExceptions = sqliteTable(
  'availability_exceptions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    date: text('date').notNull(),
    mode: text('mode').notNull(),
    periodsJson: text('periods_json').notNull(),
    reason: text('reason'),
  },
  (table) => [
    uniqueIndex('availability_exceptions_org_store_date_idx').on(
      table.organizationId,
      table.storeId,
      table.date,
    ),
  ],
)

export const visitPurposes = sqliteTable(
  'visit_purposes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    staffName: text('staff_name').notNull(),
    customerLabel: text('customer_label').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    slotIntervalMinutes: integer('slot_interval_minutes').notNull(),
    isPublic: text('is_public').notNull(),
    requiredSkillsJson: text('required_skills_json').notNull(),
    requiredEquipmentJson: text('required_equipment_json').notNull(),
    maxConcurrent: integer('max_concurrent').notNull(),
  },
  (table) => [index('visit_purposes_org_store_idx').on(table.organizationId, table.storeId)],
)

export const availabilityStaff = sqliteTable(
  'availability_staff',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    name: text('name').notNull(),
    skillsJson: text('skills_json').notNull(),
    canBook: text('can_book').notNull(),
    isActive: text('is_active').notNull(),
  },
  (table) => [index('availability_staff_org_store_idx').on(table.organizationId, table.storeId)],
)

export const availabilityStaffShifts = sqliteTable(
  'availability_staff_shifts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    staffId: text('staff_id').notNull(),
    date: text('date').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    breaksJson: text('breaks_json').notNull(),
  },
  (table) => [
    index('availability_staff_shifts_org_store_date_idx').on(
      table.organizationId,
      table.storeId,
      table.date,
    ),
    index('availability_staff_shifts_staff_date_idx').on(table.staffId, table.date),
  ],
)

export const availabilityEquipment = sqliteTable(
  'availability_equipment',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    name: text('name').notNull(),
    capacity: integer('capacity').notNull(),
    isActive: text('is_active').notNull(),
    availablePeriodsJson: text('available_periods_json').notNull(),
  },
  (table) => [
    index('availability_equipment_org_store_name_idx').on(
      table.organizationId,
      table.storeId,
      table.name,
    ),
  ],
)

export const availabilityMaintenances = sqliteTable(
  'availability_maintenances',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    equipmentId: text('equipment_id').notNull(),
    date: text('date').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    reason: text('reason').notNull(),
  },
  (table) => [
    index('availability_maintenances_org_store_date_idx').on(
      table.organizationId,
      table.storeId,
      table.date,
    ),
    index('availability_maintenances_equipment_date_idx').on(table.equipmentId, table.date),
  ],
)

/**
 * Reservation/hold occupancy consumed by the pure availability engine.
 * Reservation creation owns the lifecycle; this table intentionally has no
 * foreign keys so a cross-D1 reservation service is never required.
 */
export const availabilityBookings = sqliteTable(
  'availability_bookings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    startAt: text('start_at').notNull(),
    endAt: text('end_at').notNull(),
    purposeIdsJson: text('purpose_ids_json').notNull(),
    staffId: text('staff_id'),
    equipmentIdsJson: text('equipment_ids_json').notNull(),
    status: text('status').notNull(),
  },
  (table) => [
    index('availability_bookings_org_store_time_idx').on(
      table.organizationId,
      table.storeId,
      table.startAt,
      table.endAt,
    ),
  ],
)

/**
 * Discrete one-minute resource claims that make reservation confirmation
 * conflict-safe for every minute-based configured interval in D1. A claim is
 * never trusted across organizations/stores.
 */
export const reservationResourceAllocations = sqliteTable(
  'reservation_resource_allocations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    reservationId: text('reservation_id').notNull(),
    resourceKind: text('resource_kind').notNull(),
    resourceId: text('resource_id').notNull(),
    slotStartAt: text('slot_start_at').notNull(),
  },
  (table) => [
    uniqueIndex('reservation_resource_claim_unique_idx').on(
      table.organizationId,
      table.storeId,
      table.resourceKind,
      table.resourceId,
      table.slotStartAt,
    ),
    index('reservation_resource_allocations_reservation_idx').on(
      table.organizationId,
      table.reservationId,
    ),
  ],
)

/** The durable business reservation. Availability occupancy is written in the same D1 batch. */
export const reservations = sqliteTable(
  'reservations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    reservationNumber: text('reservation_number').notNull(),
    source: text('source').notNull(),
    status: text('status').notNull(),
    startAt: text('start_at').notNull(),
    endAt: text('end_at').notNull(),
    purposeIdsJson: text('purpose_ids_json').notNull(),
    customerId: text('customer_id'),
    customerName: text('customer_name').notNull(),
    customerKana: text('customer_kana').notNull(),
    customerPhone: text('customer_phone').notNull(),
    customerPhoneNormalized: text('customer_phone_normalized'),
    customerEmail: text('customer_email'),
    recital: text('recital').notNull(),
    reservationMemo: text('reservation_memo'),
    handoffNote: text('handoff_note'),
    progress: text('progress'),
    waitStartedAt: text('wait_started_at'),
    assignedStaffId: text('assigned_staff_id'),
    assignedEquipmentIdsJson: text('assigned_equipment_ids_json'),
    nextGuidance: text('next_guidance'),
    // Per-write token that lets the following batch statements prove that
    // their conditional reservation update, rather than a concurrent write,
    // succeeded before appending history and audit rows.
    progressOperationId: text('progress_operation_id'),
    version: integer('version').notNull(),
    createdAt: text('created_at').notNull(),
    // 0008 backfills legacy rows, but SQLite cannot add a NOT NULL column to
    // an already populated table without rebuilding it. Reads remain tolerant
    // of a pre-migration null while every new write supplies this value.
    updatedAt: text('updated_at'),
  },
  (table) => [
    uniqueIndex('reservations_org_number_unique_idx').on(
      table.organizationId,
      table.reservationNumber,
    ),
    index('reservations_org_store_start_idx').on(
      table.organizationId,
      table.storeId,
      table.startAt,
    ),
  ],
)

/**
 * Append-only operational history for a reservation's reception lifecycle.
 * Audit events explain who performed a change; this table preserves the
 * business-facing before/after assignment and guidance state.
 */
export const reservationProgressEvents = sqliteTable(
  'reservation_progress_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    reservationId: text('reservation_id').notNull(),
    fromProgress: text('from_progress'),
    toProgress: text('to_progress').notNull(),
    assignedStaffId: text('assigned_staff_id'),
    assignedEquipmentIdsJson: text('assigned_equipment_ids_json').notNull(),
    nextGuidance: text('next_guidance'),
    version: integer('version').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('reservation_progress_events_org_reservation_idx').on(
      table.organizationId,
      table.reservationId,
      table.createdAt,
    ),
  ],
)

/** Immutable business history for a reservation change or cancellation. */
export const reservationChanges = sqliteTable(
  'reservation_changes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    reservationId: text('reservation_id').notNull(),
    action: text('action').notNull(),
    reason: text('reason'),
    beforeJson: text('before_json').notNull(),
    afterJson: text('after_json').notNull(),
    actorId: text('actor_id').notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    index('reservation_changes_org_reservation_idx').on(
      table.organizationId,
      table.reservationId,
      table.occurredAt,
    ),
  ],
)

/** A customer may be associated after reception; this record is retained after departure. */
export const walkins = sqliteTable(
  'walkins',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    serviceDate: text('service_date').notNull(),
    sequence: integer('sequence').notNull(),
    customerId: text('customer_id'),
    status: text('status').notNull(),
    progress: text('progress').notNull(),
    arrivedAt: text('arrived_at').notNull(),
    operationId: text('operation_id'),
    version: integer('version').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('walkins_org_store_date_sequence_idx').on(
      table.organizationId,
      table.storeId,
      table.serviceDate,
      table.sequence,
    ),
    index('walkins_org_store_arrived_idx').on(table.organizationId, table.storeId, table.arrivedAt),
  ],
)

/** Atomic, per-store daily allocator. Gaps are allowed; duplicate identifiers are not. */
export const walkinDailySequences = sqliteTable(
  'walkin_daily_sequences',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    serviceDate: text('service_date').notNull(),
    nextSequence: integer('next_sequence').notNull(),
  },
  (table) => [
    uniqueIndex('walkin_daily_sequences_org_store_date_idx').on(
      table.organizationId,
      table.storeId,
      table.serviceDate,
    ),
  ],
)

/** Immutable business history for a walk-in, separate from the actor audit trail. */
export const walkinEvents = sqliteTable(
  'walkin_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    walkinId: text('walkin_id').notNull(),
    eventType: text('event_type').notNull(),
    fromCustomerId: text('from_customer_id'),
    toCustomerId: text('to_customer_id'),
    fromProgress: text('from_progress'),
    toProgress: text('to_progress'),
    version: integer('version').notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    index('walkin_events_org_walkin_idx').on(
      table.organizationId,
      table.walkinId,
      table.occurredAt,
    ),
  ],
)

/** Organization-scoped customer identity; reservation-specific facts remain on reservations. */
export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    primaryStoreId: text('primary_store_id').notNull(),
    name: text('name').notNull(),
    kana: text('kana').notNull(),
    phoneNormalized: text('phone_normalized').notNull(),
    email: text('email'),
    visitCount: integer('visit_count').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('customers_org_phone_unique_idx').on(table.organizationId, table.phoneNormalized),
    index('customers_org_phone_idx').on(table.organizationId, table.phoneNormalized),
    index('customers_org_primary_store_idx').on(table.organizationId, table.primaryStoreId),
  ],
)
