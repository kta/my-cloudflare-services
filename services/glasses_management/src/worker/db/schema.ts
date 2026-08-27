import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
    // A grant proves one manager stood at the iPad for one action. Once spent it
    // must never authorise another: otherwise a single PIN entry becomes a
    // bearer capability over every management action until it expires.
    consumedAt: text('consumed_at'),
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
    // Whether this store runs the chain-wide value or an explicit override
    // (AC-EYEX-48). Rows written before the settings-publication loop are null
    // and read as a store override.
    origin: text('origin'),
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
    /* 店舗ページの「対応サービス」。来店目的とは別軸なので別列で持つ。既存行は null。 */
    publicServicesJson: text('public_services_json'),
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
    /**
     * Set only by an explicit, acknowledged merge (UC-EYEX-181). The losing
     * record is kept — never deleted — so the merge stays auditable and
     * reversible by inspection.
     */
    mergedIntoCustomerId: text('merged_into_customer_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('customers_org_phone_unique_idx').on(table.organizationId, table.phoneNormalized),
    index('customers_org_phone_idx').on(table.organizationId, table.phoneNormalized),
    index('customers_org_primary_store_idx').on(table.organizationId, table.primaryStoreId),
  ],
)

/**
 * One prescription measurement. The latest row is the current prescription and
 * every older row stays readable as history, so the two are never confused.
 * Powers are stored as numbers and formatted once, server-side, on read.
 */
export const customerPrescriptions = sqliteTable(
  'customer_prescriptions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    customerId: text('customer_id').notNull(),
    measuredOn: text('measured_on').notNull(),
    recordedBy: text('recorded_by').notNull(),
    rightSphere: real('right_sphere').notNull(),
    leftSphere: real('left_sphere').notNull(),
    pupillaryDistance: real('pupillary_distance').notNull(),
    addPower: real('add_power'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('customer_prescriptions_org_customer_idx').on(
      table.organizationId,
      table.customerId,
      table.measuredOn,
    ),
    index('customer_prescriptions_org_store_customer_idx').on(
      table.organizationId,
      table.storeId,
      table.customerId,
    ),
  ],
)

/** A staff service note, attributed to the store and person who wrote it. */
export const customerNotes = sqliteTable(
  'customer_notes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    customerId: text('customer_id').notNull(),
    recordedOn: text('recorded_on').notNull(),
    recordedBy: text('recorded_by').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('customer_notes_org_customer_idx').on(
      table.organizationId,
      table.customerId,
      table.recordedOn,
    ),
    index('customer_notes_org_store_customer_idx').on(
      table.organizationId,
      table.storeId,
      table.customerId,
    ),
  ],
)

/** Glasses the customer already owns, kept per selling store. */
export const customerOwnedGlasses = sqliteTable(
  'customer_owned_glasses',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    customerId: text('customer_id').notNull(),
    label: text('label').notNull(),
    purchasedOn: text('purchased_on').notNull(),
    lensType: text('lens_type').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('customer_owned_glasses_org_customer_idx').on(
      table.organizationId,
      table.customerId,
      table.purchasedOn,
    ),
    index('customer_owned_glasses_org_store_customer_idx').on(
      table.organizationId,
      table.storeId,
      table.customerId,
    ),
  ],
)

/**
 * Restricted 注意事項. Only a published, never-hidden row is readable, and only
 * by an actor holding `attention.read`. `status` / `version` / `published_at` /
 * `hidden_at` carry the versioned publish, revise and hide workflow that the
 * permission split (UC-EYEX-140) will drive; reads already honour them.
 */
export const customerAttentionNotes = sqliteTable(
  'customer_attention_notes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    customerId: text('customer_id').notNull(),
    /**
     * The logical note every version of it shares. Rows written before the
     * versioned workflow existed carry no value and are read as their own id.
     */
    noteId: text('note_id'),
    body: text('body').notNull(),
    /** 発生日時 (UC-EYEX-143); an ISO instant, distinct from `recorded_on`. */
    occurredAt: text('occurred_at'),
    // An attention note without a basis is a rumour, so this is not nullable.
    basis: text('basis').notNull(),
    /** 推奨対応 (UC-EYEX-143). */
    recommendedAction: text('recommended_action'),
    /** 権限店舗のみ / チェーン全体 (UC-EYEX-142), frozen per version. */
    sharingScope: text('sharing_scope'),
    status: text('status').notNull(),
    version: integer('version').notNull(),
    /** The review outcome (公開 / 差戻し / 却下) and its mandatory reason. */
    reviewedBy: text('reviewed_by'),
    reviewedAt: text('reviewed_at'),
    reviewReason: text('review_reason'),
    /** The version this one revised; the previous row is never overwritten. */
    previousVersionId: text('previous_version_id'),
    recordedBy: text('recorded_by').notNull(),
    recordedOn: text('recorded_on').notNull(),
    publishedAt: text('published_at'),
    hiddenAt: text('hidden_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('customer_attention_notes_org_customer_idx').on(
      table.organizationId,
      table.customerId,
      table.recordedOn,
    ),
    index('customer_attention_notes_org_store_customer_idx').on(
      table.organizationId,
      table.storeId,
      table.customerId,
    ),
    index('customer_attention_notes_org_note_idx').on(
      table.organizationId,
      table.noteId,
      table.version,
    ),
  ],
)

/**
 * 注意事項の権限・公開方式・共有範囲の設定 (UC-EYEX-139〜142).
 *
 * One row per organization default and one per store override. The default row
 * uses the `'*'` store sentinel rather than NULL, because SQLite treats NULLs
 * as distinct in a unique index and would silently allow two defaults.
 */
export const attentionSettings = sqliteTable(
  'attention_settings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    reviewMode: text('review_mode').notNull(),
    sharingScope: text('sharing_scope').notNull(),
    /** '0' / '1'; whether a store override may exist at all (UC-EYEX-139). */
    storeOverrideAllowed: text('store_override_allowed').notNull(),
    /** `[{ capability, minimumRole }]`, validated by Zod on every read. */
    capabilitiesJson: text('capabilities_json').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('attention_settings_org_store_idx').on(table.organizationId, table.storeId),
  ],
)

/**
 * A parked settings change. Distinct from `availability_settings`: the draft
 * carries its own monotonic version and never affects reception until a
 * publication applies it (UC-EYEX-095).
 */
export const settingsDrafts = sqliteTable(
  'settings_drafts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    draftVersion: integer('draft_version').notNull(),
    /** The published settings version this draft was derived from. */
    baseVersion: integer('base_version').notNull(),
    status: text('status').notNull(),
    origin: text('origin').notNull(),
    restoredFromVersionId: text('restored_from_version_id'),
    payloadJson: text('payload_json').notNull(),
    savedBy: text('saved_by').notNull(),
    savedAt: text('saved_at').notNull(),
  },
  (table) => [
    // One open draft per store keeps "the draft" an unambiguous object for the
    // impact step and for publication.
    uniqueIndex('settings_drafts_org_store_idx').on(table.organizationId, table.storeId),
  ],
)

/** How a conflicting future reservation was handled before publication (UC-EYEX-165). */
export const settingsDraftConflictResolutions = sqliteTable(
  'settings_draft_conflict_resolutions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    draftId: text('draft_id').notNull(),
    reservationId: text('reservation_id').notNull(),
    resolution: text('resolution').notNull(),
    note: text('note').notNull(),
    resolvedBy: text('resolved_by').notNull(),
    resolvedAt: text('resolved_at').notNull(),
  },
  (table) => [
    uniqueIndex('settings_conflict_resolution_draft_reservation_idx').on(
      table.draftId,
      table.reservationId,
    ),
  ],
)

/** An immutable published settings snapshot; restoring one only creates a draft. */
export const settingsVersions = sqliteTable(
  'settings_versions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    version: integer('version').notNull(),
    origin: text('origin').notNull(),
    payloadJson: text('payload_json').notNull(),
    changedFieldsJson: text('changed_fields_json').notNull(),
    sourceDraftId: text('source_draft_id'),
    publicationId: text('publication_id'),
    publishedBy: text('published_by').notNull(),
    publishedAt: text('published_at').notNull(),
  },
  (table) => [
    uniqueIndex('settings_versions_org_store_version_idx').on(
      table.organizationId,
      table.storeId,
      table.version,
    ),
  ],
)

/** One publication run: immediate or scheduled for a JST instant (UC-EYEX-094). */
export const settingsPublications = sqliteTable(
  'settings_publications',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    draftId: text('draft_id').notNull(),
    versionId: text('version_id').notNull(),
    status: text('status').notNull(),
    /** Null for an immediate publication. */
    scheduledAt: text('scheduled_at'),
    executedAt: text('executed_at'),
    appliedCount: integer('applied_count').notNull(),
    failedCount: integer('failed_count').notNull(),
    ledgerEntriesAffected: integer('ledger_entries_affected').notNull(),
    slotDate: text('slot_date').notNull(),
    previousSlotCount: integer('previous_slot_count').notNull(),
    publishedSlotCount: integer('published_slot_count').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('settings_publications_org_scheduled_idx').on(
      table.organizationId,
      table.status,
      table.scheduledAt,
    ),
  ],
)

/** Per-store outcome; the unique index is what makes a retry non-duplicating. */
export const settingsPublicationTargets = sqliteTable(
  'settings_publication_targets',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    publicationId: text('publication_id').notNull(),
    storeId: text('store_id').notNull(),
    status: text('status').notNull(),
    appliedVersion: integer('applied_version'),
    failureReason: text('failure_reason'),
    appliedAt: text('applied_at'),
  },
  (table) => [
    uniqueIndex('settings_publication_targets_publication_store_idx').on(
      table.publicationId,
      table.storeId,
    ),
  ],
)

/** The chain-wide common value a store override can be released back to (UC-EYEX-092, 160). */
export const settingsChainDefaults = sqliteTable(
  'settings_chain_defaults',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    version: integer('version').notNull(),
    payloadJson: text('payload_json').notNull(),
    updatedBy: text('updated_by').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('settings_chain_defaults_org_idx').on(table.organizationId)],
)

/**
 * Recording metadata. The audio body itself lives only in the private R2
 * bucket; D1 keeps the reception session, the lifecycle state, the retention
 * deadline, the hold and the object key so a deletion can be reconciled.
 */
export const recordings = sqliteTable(
  'recordings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    // A recording belongs to a reception session; the reservation is optional
    // and only linked once the reception actually produced one.
    receptionSessionId: text('reception_session_id').notNull(),
    reservationId: text('reservation_id'),
    recorderType: text('recorder_type').notNull(),
    recorderId: text('recorder_id').notNull(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at').notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    endReason: text('end_reason').notNull(),
    state: text('state').notNull(),
    contentType: text('content_type').notNull(),
    // Unguessable, tenant-scoped R2 key. Never returned to a client.
    storageKey: text('storage_key').notNull(),
    retentionUntil: text('retention_until'),
    holdReason: text('hold_reason'),
    heldBy: text('held_by'),
    heldAt: text('held_at'),
    failureReason: text('failure_reason'),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull(),
  },
  (table) => [
    index('recordings_org_store_state_idx').on(table.organizationId, table.storeId, table.state),
    index('recordings_org_retention_idx').on(table.organizationId, table.retentionUntil),
    index('recordings_org_reservation_idx').on(table.organizationId, table.reservationId),
    uniqueIndex('recordings_org_session_unique_idx').on(
      table.organizationId,
      table.receptionSessionId,
    ),
    uniqueIndex('recordings_storage_key_unique_idx').on(table.storageKey),
  ],
)

/** Operational retention per store; it may only lengthen the legal minimum. */
export const recordingRetentionSettings = sqliteTable(
  'recording_retention_settings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    confirmedRetentionDays: integer('confirmed_retention_days').notNull(),
    discardedRetentionHours: integer('discarded_retention_hours').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('recording_retention_org_store_unique_idx').on(table.organizationId, table.storeId),
  ],
)

/**
 * Organization-wide analytics configuration (UC-EYEX-180). The suppression
 * threshold is a privacy control, so it belongs to the organization rather
 * than to a store that could quietly lower it for itself.
 */
export const analyticsSettings = sqliteTable(
  'analytics_settings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    smallSampleThreshold: integer('small_sample_threshold').notNull(),
    /** `AnalyticsTarget[]`; absent metrics simply have no target. */
    targetsJson: text('targets_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('analytics_settings_org_unique_idx').on(table.organizationId)],
)

/** Per-store warning conditions and their notification targets (UC-EYEX-179). */
export const alertSettings = sqliteTable(
  'alert_settings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    /** `AlertCondition[]`. */
    conditionsJson: text('conditions_json').notNull(),
    /** Email addresses a dispatcher would notify. */
    notificationTargetsJson: text('notification_targets_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('alert_settings_org_store_unique_idx').on(table.organizationId, table.storeId),
  ],
)

/**
 * One inbox for お知らせ and アラート (UC-EYEX-178). 既読 and 対応済み are
 * separate columns on purpose: reading an alert is not handling it, and the
 * two are frequently done by different people.
 */
export const operationalAlerts = sqliteTable(
  'operational_alerts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    kind: text('kind').notNull(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    reason: text('reason').notNull(),
    subject: text('subject').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    occurredAt: text('occurred_at').notNull(),
    nextAction: text('next_action').notNull(),
    /** Condition + subject + occurrence; makes re-evaluation idempotent. */
    dedupeKey: text('dedupe_key').notNull(),
    readAt: text('read_at'),
    readBy: text('read_by'),
    resolvedAt: text('resolved_at'),
    resolvedBy: text('resolved_by'),
    resolutionNote: text('resolution_note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('operational_alerts_org_dedupe_unique_idx').on(
      table.organizationId,
      table.dedupeKey,
    ),
    index('operational_alerts_org_store_occurred_idx').on(
      table.organizationId,
      table.storeId,
      table.occurredAt,
    ),
  ],
)

/**
 * Anonymous web booking funnel steps (UC-EYEX-103). The session id is a
 * client-generated opaque uuid and is never linked to a customer, so a funnel
 * count can never be walked back to a person.
 */
export const webBookingFunnelEvents = sqliteTable(
  'web_booking_funnel_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    sessionId: text('session_id').notNull(),
    stage: text('stage').notNull(),
    occurredAt: text('occurred_at').notNull(),
  },
  (table) => [
    // At most four rows per session: a replayed step cannot inflate a funnel.
    uniqueIndex('web_booking_funnel_org_session_stage_unique_idx').on(
      table.organizationId,
      table.sessionId,
      table.stage,
    ),
    index('web_booking_funnel_org_store_occurred_idx').on(
      table.organizationId,
      table.storeId,
      table.occurredAt,
    ),
  ],
)
