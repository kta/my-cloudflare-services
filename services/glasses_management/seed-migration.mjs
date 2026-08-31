/** 旧開発 seed の組織 ID を、現在の `eyex` へ一度だけ移す。 */
export const LEGACY_SEED_ORG = 'org-eyex-seed'

export const ORGANIZATION_SCOPED_TABLES = [
  'alerts',
  'audit_events',
  'customer_glasses',
  'customer_notes',
  'customer_prescriptions',
  'customers',
  'equipment',
  'equipment_maintenance',
  'idempotency_records',
  'purpose_requirements',
  'reception_sessions',
  'recordings',
  'reservation_assignments',
  'reservation_purposes',
  'reservation_slot_locks',
  'reservations',
  'staff',
  'staff_shifts',
  'staff_skills',
  'staff_weekly_shifts',
  'store_blackout_windows',
  'store_business_hours',
  'store_calendar_exceptions',
  'store_memberships',
  'store_settings_revision',
  'store_slot_rules',
  'stores',
  'visit_events',
  'visit_purposes',
  'walk_ins',
  'web_booking_settings',
  'web_bookings',
]

/** ローカルだけで旧 seed を移行し、既存の `eyex` 店舗データは保持する。 */
export function legacySeedMigrationStatements(remote) {
  if (remote) return []

  const legacy = `'${LEGACY_SEED_ORG}'`
  const current = "'eyex'"
  const noCurrentOrganization = `NOT EXISTS (SELECT 1 FROM organizations WHERE id = ${current})`

  return [
    `DELETE FROM organizations WHERE id = ${current} AND EXISTS (SELECT 1 FROM organizations WHERE id = ${legacy}) AND NOT EXISTS (SELECT 1 FROM stores WHERE organization_id = ${current});`,
    ...ORGANIZATION_SCOPED_TABLES.map(
      (table) =>
        `UPDATE ${table} SET organization_id = ${current} WHERE organization_id = ${legacy} AND ${noCurrentOrganization};`,
    ),
    `UPDATE organizations SET id = ${current}, name = 'EYEX' WHERE id = ${legacy} AND ${noCurrentOrganization};`,
  ]
}
