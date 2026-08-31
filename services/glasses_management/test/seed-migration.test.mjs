import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { dynamicE2eShiftDates } from '../seed-e2e.mjs'
import {
  LEGACY_SEED_ORG,
  LEGACY_TODAY_EXCEPTION_ID,
  legacySeedMigrationStatements,
  ORGANIZATION_SCOPED_TABLES,
} from '../seed-migration.mjs'

test('ローカル seed は旧組織の全スコープ行を eyex へ移す SQL を出す', () => {
  const statements = legacySeedMigrationStatements(false)

  assert.ok(statements[0].includes("DELETE FROM organizations WHERE id = 'eyex'"))
  assert.ok(statements.some((statement) => statement.startsWith('UPDATE stores ')))
  assert.ok(statements.some((statement) => statement.startsWith('UPDATE staff ')))
  assert.ok(
    statements.some((statement) => statement.includes(`organization_id = '${LEGACY_SEED_ORG}'`)),
  )
  assert.equal(
    statements.at(-1),
    "UPDATE organizations SET id = 'eyex', name = 'EYEX' WHERE id = 'org-eyex-seed' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = 'eyex');",
  )
})

test('リモート seed は旧組織を移行しない', () => {
  assert.deepEqual(legacySeedMigrationStatements(true), [])
})

test('ローカル seed は旧版が実行日に作った特別営業だけを掃除する', () => {
  const statements = legacySeedMigrationStatements(false)
  assert.ok(
    statements.includes(
      `DELETE FROM store_calendar_exceptions WHERE id = '${LEGACY_TODAY_EXCEPTION_ID}';`,
    ),
  )
})

test('E2E の勤務日は注入日から45日を作り、固定seedと重なる日は増やさない', () => {
  const dates = dynamicE2eShiftDates('2026-09-01', '2026-08-27', 35, 45)
  assert.equal(dates[0], '2026-10-01')
  assert.equal(dates.at(-1), '2026-10-15')
  assert.equal(dates.length, 15)
})

test('E2E の勤務日は将来日でも注入した45日だけを決定的に作る', () => {
  const dates = dynamicE2eShiftDates('2030-10-01', '2026-08-27', 35, 45)
  assert.equal(dates[0], '2030-10-01')
  assert.equal(dates.at(-1), '2030-11-14')
  assert.equal(dates.length, 45)
})

test('旧 seed を入れたローカル DB を eyex へ移行する', () => {
  const db = new DatabaseSync(':memory:')
  const schema = [
    'CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT);',
    ...ORGANIZATION_SCOPED_TABLES.map((table) =>
      table === 'store_calendar_exceptions'
        ? `CREATE TABLE ${table} (id TEXT, organization_id TEXT);`
        : `CREATE TABLE ${table} (organization_id TEXT);`,
    ),
    "INSERT INTO organizations VALUES ('org-eyex-seed', 'EYEX');",
    "INSERT INTO organizations VALUES ('eyex', 'eyex');",
    "INSERT INTO stores VALUES ('org-eyex-seed');",
    "INSERT INTO staff VALUES ('org-eyex-seed');",
    `INSERT INTO store_calendar_exceptions VALUES ('${LEGACY_TODAY_EXCEPTION_ID}', 'org-eyex-seed');`,
    ...legacySeedMigrationStatements(false),
    'SELECT id FROM organizations;',
    'SELECT organization_id FROM staff;',
  ].join('\n')

  db.exec(schema)
  assert.deepEqual(
    db
      .prepare('SELECT id FROM organizations')
      .all()
      .map((row) => ({ ...row })),
    [{ id: 'eyex' }],
  )
  assert.deepEqual(
    db
      .prepare('SELECT organization_id FROM staff')
      .all()
      .map((row) => ({ ...row })),
    [{ organization_id: 'eyex' }],
  )
  assert.equal(db.prepare('SELECT count(*) AS count FROM store_calendar_exceptions').get().count, 0)
})
