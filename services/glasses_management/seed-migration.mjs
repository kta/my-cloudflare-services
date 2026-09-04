/**
 * 旧開発 seed の組織 ID を、現在の `eye` へ一度だけ移す。
 *
 * **注意**: 組織コードを全面改称したとき、ここの旧 ID も併せて改称した。改称より前に
 * 作ったローカル DB は旧 ID が改称前のままなので、この移行では拾えない。
 * その場合は `make db/reset/local` で作り直す。
 */
export const LEGACY_SEED_ORG = 'org-eye-seed'
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
 * 実際に打ち間違いから生まれた行が残っていて、正規の組織と並んで見分けが付かなかった。
 * 掃除しないと `make db/reset/local` を回しても増え続けるので、ローカルだけで消す。
 */
export const SEEDED_ORGANIZATIONS = ['eye', 'org-analytics-other-seed']

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

/** ローカルだけで旧 seed を移行し、既存の `eye` 店舗データは保持する。 */
export function legacySeedMigrationStatements(remote) {
  if (remote) return []

  const legacy = `'${LEGACY_SEED_ORG}'`
  const current = "'eye'"
  const noCurrentOrganization = `NOT EXISTS (SELECT 1 FROM organizations WHERE id = ${current})`

  return [
    `DELETE FROM organizations WHERE id = ${current} AND EXISTS (SELECT 1 FROM organizations WHERE id = ${legacy}) AND NOT EXISTS (SELECT 1 FROM stores WHERE organization_id = ${current});`,
    `DELETE FROM store_calendar_exceptions WHERE id = '${LEGACY_TODAY_EXCEPTION_ID}';`,
    ...ORGANIZATION_SCOPED_TABLES.map(
      (table) =>
        `UPDATE ${table} SET organization_id = ${current} WHERE organization_id = ${legacy} AND ${noCurrentOrganization};`,
    ),
    `UPDATE organizations SET id = ${current}, name = 'EYE' WHERE id = ${legacy} AND ${noCurrentOrganization};`,
  ]
}
