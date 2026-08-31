/**
 * 変更と取消のドメイン（`src/worker/domain/reservation-change.ts`）を固定する。
 *
 * ここで見るのは**純関数だけ**である。D1 へ 1 文も投げず、組み立てた文の
 * **並びとガード**をそのまま読む。時刻は引数で受ける（`Date.now()` を書かない）。
 *
 * 盤面はモック CHANGE-DIFF の 8月27日（木）。11:00–12:00・メガネを新しく作る（60分）・
 * 佐藤 美咲・視力測定機 A ／ 相談カウンター 1 のご予約を、14:00–15:00 と
 * 相談カウンター 2 へ動かす。
 *
 * **並びとガードは「409 が二重予約を作らない」ための唯一の仕掛けである。**
 * D1 のバッチは 0 行しか当たらない `UPDATE` で止まらないので、版の条件を最後の 1 文だけに
 * 置くと、版が合わなかった端末が「何も起きていません」と言われながら割当と占有行だけを
 * 書き換えてしまう。だから置き換え・削除・追記のどの文にも版のガードを配り、
 * `version` を +1 する文をいちばん最後に置く。
 */
import { ReservationCancelInput } from '@app/contracts'
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import {
  buildCancelBatch,
  buildChangeBatch,
  cancelOutcome,
  diffReservation,
  type ReservationSnapshot,
  sayOnConfirm,
} from '../src/worker/domain/reservation-change'

/** JST 2026年8月27日（木）11:12。バッチの時刻。 */
const BATCH_AT = '2026-08-27T02:12:00.000Z'

const BEFORE: ReservationSnapshot = {
  startsAt: '2026-08-27T02:00:00.000Z',
  endsAt: '2026-08-27T03:00:00.000Z',
  durationMinutes: 60,
  purposeIds: ['purpose-new-glasses'],
  purposeLabel: 'メガネを新しく作る',
  staffId: 'staff-sato',
  staffName: '佐藤 美咲',
  equipmentIds: ['eq-vision-a', 'eq-counter-1'],
  equipmentNames: ['視力測定機 A', '相談カウンター 1'],
}

/** 14:00–15:00 へ動かした姿。 */
const MOVED: ReservationSnapshot = {
  ...BEFORE,
  startsAt: '2026-08-27T05:00:00.000Z',
  endsAt: '2026-08-27T06:00:00.000Z',
}

function labels(rows: readonly { label: string }[]): string[] {
  return rows.map((row) => row.label)
}

function changedLabels(rows: readonly { label: string; changed: boolean }[]): string[] {
  return rows.filter((row) => row.changed).map((row) => row.label)
}

/** 組み立てた文をそのまま覚える偽の D1。1 文も実行しない。 */
type Recorded = { sql: string; params: unknown[] }

function recorder(): { db: D1Database; statements: Recorded[] } {
  const statements: Recorded[] = []
  const db = {
    prepare(sql: string) {
      const entry: Recorded = { sql, params: [] }
      statements.push(entry)
      const stmt = {
        bind: (...params: unknown[]) => {
          entry.params = params
          return stmt as unknown as D1PreparedStatement
        },
      }
      return stmt as unknown as D1PreparedStatement
    },
  } as unknown as D1Database
  return { db, statements }
}

/** 14:00–15:00・相談カウンター 2 への変更 1 件ぶんの材料。 */
function changeBatch(): Recorded[] {
  const { db, statements } = recorder()
  buildChangeBatch({
    db,
    organizationId: 'org-eyex',
    storeId: 'store-ginza',
    reservationId: 'res-0142',
    version: 3,
    batchAt: BATCH_AT,
    requests: [
      { kind: 'store', targetKey: 'store', slotStart: '2026-08-27T05:00:00.000Z', cap: 3 },
      { kind: 'staff', targetKey: 'staff-sato', slotStart: '2026-08-27T05:00:00.000Z', cap: 1 },
    ],
    after: {
      startsAt: MOVED.startsAt,
      endsAt: MOVED.endsAt,
      durationMinutes: 60,
      noteCustomer: '',
      noteInternal: '',
    },
    purposes: [{ purposeId: 'purpose-new-glasses', durationMinutes: 60, sortOrder: 0 }],
    assignments: [
      { kind: 'staff', targetId: 'staff-sato' },
      { kind: 'equipment', targetId: 'eq-counter-2' },
    ],
    actorId: 'staff-nakamura',
    correlationId: 'corr-1',
    audit: { before: { startsAt: BEFORE.startsAt }, after: { startsAt: MOVED.startsAt } },
    newId: () => 'generated-id',
  })
  return statements
}

describe('差分', () => {
  it('日時だけを変えたら「お日にちとお時間」の 1 行だけが変更になる', () => {
    expect(changedLabels(diffReservation(BEFORE, MOVED))).toEqual(['お日にちとお時間'])
  })

  it('場所だけを変えたら「場所」の 1 行だけが変更になる', () => {
    const after: ReservationSnapshot = {
      ...BEFORE,
      equipmentIds: ['eq-vision-a', 'eq-counter-2'],
      equipmentNames: ['視力測定機 A', '相談カウンター 2'],
    }
    expect(changedLabels(diffReservation(BEFORE, after))).toEqual(['場所'])
  })

  it('担当を変えずに場所を変えたとき、「担当」の行に「変更」の札が付かない', () => {
    const after: ReservationSnapshot = {
      ...MOVED,
      equipmentIds: ['eq-vision-a', 'eq-counter-2'],
      equipmentNames: ['視力測定機 A', '相談カウンター 2'],
    }
    const rows = diffReservation(BEFORE, after)
    expect(changedLabels(rows)).toEqual(['お日にちとお時間', '場所'])
    expect(rows.find((row) => row.label === '担当')?.changed).toBe(false)
  })

  it('ご用件と所要が同じなら「ご用件」の行は変更にならない', () => {
    const rows = diffReservation(BEFORE, MOVED)
    const purpose = rows.find((row) => row.label === 'ご用件')
    expect(purpose?.changed).toBe(false)
    expect(purpose?.after).toEqual({ text: 'メガネを新しく作る', note: '所要 60分' })
  })

  it('担当を未定へ戻したら「担当が未定」を変更後に出す', () => {
    const after: ReservationSnapshot = { ...BEFORE, staffId: null, staffName: null }
    const staff = diffReservation(BEFORE, after).find((row) => row.label === '担当')
    expect(staff?.changed).toBe(true)
    expect(staff?.after.text).toBe('担当が未定')
  })

  it('変更点が 1 つも無ければ空の差分を返す（画面は確定を押させない）', () => {
    expect(diffReservation(BEFORE, { ...BEFORE })).toEqual([])
  })

  it('場所を 1 つも押さえていないご予約は「指定なし」と描く', () => {
    // 空欄のまま並べると「場所が消えた」と読めてしまう。
    const nowhere: ReservationSnapshot = { ...BEFORE, equipmentIds: [], equipmentNames: [] }
    const place = diffReservation(nowhere, MOVED).find((row) => row.label === '場所')
    expect(place?.before).toEqual({ text: '指定なし', note: '' })
    expect(place?.after).toEqual({ text: '視力測定機 A', note: '相談カウンター 1' })
    expect(place?.changed).toBe(true)
  })

  it('行の並びは お日にちとお時間 → ご用件 → 担当 → 場所 で固定する', () => {
    expect(labels(diffReservation(BEFORE, MOVED))).toEqual([
      'お日にちとお時間',
      'ご用件',
      '担当',
      '場所',
    ])
  })
})

describe('読み上げ文', () => {
  it('確定前なので「変更いたします」で終わり、「変更いたしました」にしない', () => {
    const said = sayOnConfirm(MOVED)
    expect(said).toContain('変更いたします')
    expect(said).not.toContain('変更いたしました')
  })

  it('丁重語（でございます）を使わず「です・ます」で書く', () => {
    const said = sayOnConfirm(MOVED)
    expect(said).not.toContain('でございます')
    expect(said).toContain('約60分です')
  })

  it('「8月27日木曜日、午後2時へお時間を変更いたします。担当は佐藤 美咲、所要時間は約60分です。こちらでお間違いないでしょうか？」を組み立てる', () => {
    expect(sayOnConfirm(MOVED)).toBe(
      '8月27日木曜日、午後2時へお時間を変更いたします。担当は佐藤 美咲、所要時間は約60分です。こちらでお間違いないでしょうか？',
    )
  })

  it('午前・分のある時刻・担当が未定でも、読み上げ文が崩れない', () => {
    // 「担当は担当が未定、」と読める文を作らない（節をまるごと落とす）。
    const morning: ReservationSnapshot = {
      ...BEFORE,
      startsAt: '2026-08-27T01:30:00.000Z',
      endsAt: '2026-08-27T02:30:00.000Z',
      staffId: null,
      staffName: null,
    }
    expect(sayOnConfirm(morning)).toBe(
      '8月27日木曜日、午前10時30分へお時間を変更いたします。所要時間は約60分です。こちらでお間違いないでしょうか？',
    )
  })

  it('正午は「午後12時」と読む（0 時と言い間違えない）', () => {
    const noon: ReservationSnapshot = {
      ...BEFORE,
      startsAt: '2026-08-27T03:00:00.000Z',
      endsAt: '2026-08-27T04:00:00.000Z',
    }
    expect(sayOnConfirm(noon)).toContain('午後12時へ')
  })
})

describe('取消', () => {
  /** JST 2026年8月27日（木）11:12。 */
  const NOW = new Date('2026-08-27T02:12:00.000Z')

  it('理由が no_show のときだけ status は no_show になる', () => {
    expect(cancelOutcome('no_show', NOW).status).toBe('no_show')
  })

  it('customer / store / duplicate の 3 つは status が cancelled になる', () => {
    for (const reason of ['customer', 'store', 'duplicate'] as const) {
      expect(cancelOutcome(reason, NOW).status).toBe('cancelled')
    }
  })

  it('どの理由でも cancelled_at にサーバ時刻が入る', () => {
    for (const reason of ['customer', 'store', 'duplicate', 'no_show'] as const) {
      expect(cancelOutcome(reason, NOW).cancelledAt).toBe('2026-08-27T02:12:00.000Z')
    }
  })

  it('理由が未選択の入力は取消の組み立てに渡せない', () => {
    expect(ReservationCancelInput.safeParse({ version: 3 }).success).toBe(false)
    expect(ReservationCancelInput.safeParse({ version: 3, reason: 'customer' }).success).toBe(true)
  })
})

describe('バッチの並び', () => {
  it('新しい枠の INSERT が 1 文目、version を +1 する UPDATE が最後の文になる', () => {
    const statements = changeBatch()
    expect(statements[0]?.sql).toContain('INSERT INTO reservation_slot_locks')
    const last = statements[statements.length - 1]
    expect(last?.sql).toContain('UPDATE reservations')
    expect(last?.sql).toContain('version = version + 1')
  })

  it('古い枠の DELETE は version を +1 する文より前に置く', () => {
    const statements = changeBatch()
    const release = statements.findIndex(
      (statement) =>
        statement.sql.includes('DELETE FROM reservation_slot_locks') &&
        statement.sql.includes('created_at <> ?'),
    )
    const bump = statements.findIndex((statement) =>
      statement.sql.includes('version = version + 1'),
    )
    expect(release).toBeGreaterThan(0)
    expect(release).toBeLessThan(bump)
  })
})

describe('バッチのガード', () => {
  const VERSION_GUARD =
    'EXISTS (SELECT 1 FROM reservations WHERE organization_id = ? AND id = ? AND version = ?)'

  it('置き換え・削除・追記のすべての文に版の EXISTS ガードが付く', () => {
    const statements = changeBatch()
    for (const statement of statements.slice(0, -1)) {
      expect(statement.sql).toContain(VERSION_GUARD)
    }
    // 最後の 1 文だけは自分自身の版を見て +1 する。
    expect(statements[statements.length - 1]?.sql).toContain('AND version = ?')
  })

  it('監査の追記にも版のガードが付く', () => {
    const change = changeBatch().find((statement) => statement.sql.includes('audit_events'))
    expect(change?.sql).toContain(VERSION_GUARD)

    const { db, statements } = recorder()
    buildCancelBatch({
      db,
      organizationId: 'org-eyex',
      storeId: 'store-ginza',
      reservationId: 'res-0142',
      version: 3,
      reason: 'customer',
      now: new Date(BATCH_AT),
      actorId: 'staff-nakamura',
      correlationId: 'corr-2',
      audit: { before: { status: 'confirmed' } },
      newId: () => 'generated-id',
    })
    for (const statement of statements.slice(0, -1)) {
      expect(statement.sql).toContain(VERSION_GUARD)
    }
    expect(statements[statements.length - 1]?.sql).toContain('version = version + 1')
  })
})
