/** 旧開発 seed の組織 ID を、現在の `eyex` へ一度だけ移す。 */
export const LEGACY_SEED_ORG = 'org-eyex-seed'
/** 旧seedが実行日の特別営業に使っていた固定ID。 */
export const LEGACY_TODAY_EXCEPTION_ID = 'b0040000-0000-4000-8000-000000000001'

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

/**
 * seed が作る組織。これ以外で **店舗を 1 つも持たない** 組織は、業務開始の画面で
 * コードを打ち間違えたときに dev グラント（`/api/auth/token`）が作った残骸である。
 * 実際に `eye` という行が残っていて、`eyex` と並んで見分けが付かなかった。
 * 掃除しないと `make db/reset/local` を回しても増え続けるので、ローカルだけで消す。
 */
export const SEEDED_ORGANIZATIONS = ['eyex', 'org-analytics-other-seed']

/**
 * 打ち間違いから生まれた空の組織を消す（ローカル限定）。
 * 店舗が 1 つも無い組織だけを対象にするので、admin から同期された正規の組織を
 * 巻き込まない —— 同期は組織と店舗を続けて押し込むうえ、消えても再同期で戻る。
 */
export function strayOrganizationCleanupStatements(remote) {
  if (remote) return []
  const keep = SEEDED_ORGANIZATIONS.map((id) => `'${id}'`).join(', ')
  return [
    `DELETE FROM organizations WHERE id NOT IN (${keep}) AND NOT EXISTS (SELECT 1 FROM stores WHERE stores.organization_id = organizations.id);`,
  ]
}

/** ローカルだけで旧 seed を移行し、既存の `eyex` 店舗データは保持する。 */
export function legacySeedMigrationStatements(remote) {
  if (remote) return []

  const legacy = `'${LEGACY_SEED_ORG}'`
  const current = "'eyex'"
  const noCurrentOrganization = `NOT EXISTS (SELECT 1 FROM organizations WHERE id = ${current})`

  return [
    `DELETE FROM organizations WHERE id = ${current} AND EXISTS (SELECT 1 FROM organizations WHERE id = ${legacy}) AND NOT EXISTS (SELECT 1 FROM stores WHERE organization_id = ${current});`,
    `DELETE FROM store_calendar_exceptions WHERE id = '${LEGACY_TODAY_EXCEPTION_ID}';`,
    ...ORGANIZATION_SCOPED_TABLES.map(
      (table) =>
        `UPDATE ${table} SET organization_id = ${current} WHERE organization_id = ${legacy} AND ${noCurrentOrganization};`,
    ),
    `UPDATE organizations SET id = ${current}, name = 'EYEX' WHERE id = ${legacy} AND ${noCurrentOrganization};`,
  ]
}
