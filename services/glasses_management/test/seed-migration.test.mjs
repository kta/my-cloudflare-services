import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  LEGACY_SEED_ORG,
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

test('旧 seed を入れたローカル DB を eyex へ移行する', () => {
  const db = new DatabaseSync(':memory:')
  const schema = [
    'CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT);',
    ...ORGANIZATION_SCOPED_TABLES.map((table) => `CREATE TABLE ${table} (organization_id TEXT);`),
    "INSERT INTO organizations VALUES ('org-eyex-seed', 'EYEX');",
    "INSERT INTO organizations VALUES ('eyex', 'eyex');",
    "INSERT INTO stores VALUES ('org-eyex-seed');",
    "INSERT INTO staff VALUES ('org-eyex-seed');",
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
})
