/**
 * 予約番号の採番と、D1 の制約違反をエラーコードへ翻訳する 1 か所を固定する
 * （`src/worker/domain/booking.ts`）。
 *
 * **時刻はすべて引数で受ける。**`YYMM` は JST の暦月で決まるので、実行日に依存させると
 * 月末の 15:00 UTC を跨いだ瞬間に採番の列が変わり、テストがその日だけ落ちる。
 *
 * **制約違反の 2 本は本物の D1 に違反を起こさせる。**文字列リテラルを自分で書いて
 * 自分で読むテストは、D1 の文言が変わっても緑のままになり、409 `code_exhausted` /
 * `idempotency_conflict` が黙って 500 に化けたことを検知できない。この 2 本が
 * 「メッセージの形に依存してよい唯一の関数」の見張りである（`design/04-api.md` §5）。
 */
import { env } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import {
  constraintTable,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  nextReservationCode,
  RESERVATION_CODE_ATTEMPTS,
  readIdempotencyKey,
  withReservationCode,
} from '../src/worker/domain/booking'
import { listHoldOccupancies, putHold } from '../src/worker/domain/holds'
import { FIXED_NOW, orgId } from './helpers'

/** JST 2026年8月27日（木）11:08。世界観データの基準時刻。 */
const AUGUST = new Date(FIXED_NOW)
/** JST 2026年8月31日（月）14:00。月末だがまだ 8 月。 */
const AUGUST_LAST = new Date('2026-08-31T05:00:00.000Z')
/** JST 2026年9月1日（火）00:30 ＝ UTC 8月31日 15:30。日跨ぎの向こう側。 */
const SEPTEMBER = new Date('2026-08-31T15:30:00.000Z')
/** JST 2026年12月31日（木）23:59。 */
const DECEMBER = new Date('2026-12-31T14:59:00.000Z')
/** JST 2027年1月1日（金）00:00 ＝ UTC 2026年12月31日 15:00。年跨ぎの向こう側。 */
const JANUARY = new Date('2026-12-31T15:00:00.000Z')

/**
 * 予約番号を**狙って**置く。`helpers.insertReservation` は連番を自分で振るので、
 * `EY-2608-9999` のような桁上げの手前を置けない。ここだけ生の INSERT を持つ。
 */
async function insertCode(org: string, code: string, storeId = 'store-ginza'): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO reservations (id, organization_id, store_id, code, customer_id, source, status, starts_at, ends_at, duration_minutes, note_customer, note_internal, version, created_at, updated_at, created_by, cancelled_at, cancel_reason) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,1,?,?,NULL,NULL,NULL)',
  )
    .bind(
      crypto.randomUUID(),
      org,
      storeId,
      code,
      'phone',
      'confirmed',
      FIXED_NOW,
      FIXED_NOW,
      30,
      '',
      '',
      FIXED_NOW,
      FIXED_NOW,
    )
    .run()
}

/**
 * 本物の D1 から UNIQUE 違反を 1 つ受け取る。**文言を自作しない。**
 * これを打ち直しの試験に使うことで、採番の再試行と `constraintTable` が
 * 同じ 1 つのメッセージの形で結ばれる。
 */
async function realUniqueError(org: string): Promise<unknown> {
  const code = 'EY-2699-0001'
  await insertCode(org, code)
  let caught: unknown = null
  let inserted = false
  try {
    await insertCode(org, code)
    inserted = true
  } catch (err) {
    caught = err
  }
  expect(inserted, '同じ組織に同じ予約番号が 2 度入った（一意 index が効いていない）').toBe(false)
  return caught
}

describe('予約番号', () => {
  it('EY-2608-0142 の形で採る（組織ごと・YYMM ごとの 4 桁ゼロ埋め）', async () => {
    const org = orgId()
    const other = orgId()
    await insertCode(org, 'EY-2608-0141')
    // 別の組織がどれだけ先へ進んでいても、こちらの連番には効かない。
    await insertCode(other, 'EY-2608-0500')

    expect(await nextReservationCode(env.DB, org, AUGUST)).toBe('EY-2608-0142')
    expect(await nextReservationCode(env.DB, other, AUGUST)).toBe('EY-2608-0501')
  })

  it('月をまたぐと連番が 1 に戻る（8月31日と9月1日）', async () => {
    const org = orgId()
    await insertCode(org, 'EY-2608-0142')

    // JST 8月31日 14:00 はまだ 8 月。
    expect(await nextReservationCode(env.DB, org, AUGUST_LAST)).toBe('EY-2608-0143')
    // JST 9月1日 00:30（UTC 8月31日 15:30）から 9 月の列に移る。
    expect(await nextReservationCode(env.DB, org, SEPTEMBER)).toBe('EY-2609-0001')
  })

  it('年をまたぐと YYMM が 2612 から 2701 になる', async () => {
    const org = orgId()
    await insertCode(org, 'EY-2612-0007')

    expect(await nextReservationCode(env.DB, org, DECEMBER)).toBe('EY-2612-0008')
    expect(await nextReservationCode(env.DB, org, JANUARY)).toBe('EY-2701-0001')
  })

  it('9999 の次は 5 桁へ桁上げして EY-2608-10000 になる', async () => {
    const org = orgId()
    await insertCode(org, 'EY-2608-9999')
    expect(await nextReservationCode(env.DB, org, AUGUST)).toBe('EY-2608-10000')

    // 桁が伸びたあとも連番は伸び続ける。文字列の MAX で採ると
    // 'EY-2608-9999' > 'EY-2608-10000' なのでここが 10000 に戻り、必ず衝突する。
    await insertCode(org, 'EY-2608-10000')
    expect(await nextReservationCode(env.DB, org, AUGUST)).toBe('EY-2608-10001')
  })

  it('店舗が違っても組織が同じなら同じ連番の列を使う', async () => {
    const org = orgId()
    await insertCode(org, 'EY-2608-0300', 'store-ginza')
    await insertCode(org, 'EY-2608-0301', 'store-marunouchi')

    // 店舗をまたぐ検索で番号が衝突しないよう、採るのは組織ごと（`03-data-model.md` §7.1）。
    expect(await nextReservationCode(env.DB, org, AUGUST)).toBe('EY-2608-0302')
  })

  it('衝突したら +1 して最大 5 回まで打ち直す', async () => {
    const org = orgId()
    const collision = await realUniqueError(org)
    await insertCode(org, 'EY-2608-0141')

    const tried: string[] = []
    const answer = await withReservationCode(env.DB, org, AUGUST, async (code) => {
      tried.push(code)
      if (tried.length < RESERVATION_CODE_ATTEMPTS) throw collision
      return `ok:${code}`
    })

    expect(tried).toEqual([
      'EY-2608-0142',
      'EY-2608-0143',
      'EY-2608-0144',
      'EY-2608-0145',
      'EY-2608-0146',
    ])
    expect(answer).toEqual({
      ok: true,
      code: 'EY-2608-0146',
      value: 'ok:EY-2608-0146',
      attempts: 5,
    })
  })

  it('5 回打ち直しても取れなければ 409 code_exhausted を返す（500 にしない）', async () => {
    const org = orgId()
    const collision = await realUniqueError(org)
    await insertCode(org, 'EY-2608-0141')

    const tried: string[] = []
    // throw ではなく戻り値で返す。握りつぶした 500 と区別が付く形にする。
    const answer = await withReservationCode(env.DB, org, AUGUST, async (code) => {
      tried.push(code)
      throw collision
    })

    expect(answer).toEqual({ ok: false, error: 'code_exhausted', attempts: 5 })
    expect(tried).toHaveLength(RESERVATION_CODE_ATTEMPTS)
    // 6 本目は試さない。人を呼ぶ（`design/04-api.md` §5 の `code_exhausted`）。
    expect(tried[tried.length - 1]).toBe('EY-2608-0146')
  })
})

describe('制約違反', () => {
  it('UNIQUE constraint failed: reservations.code から reservations を取り出す', async () => {
    const org = orgId()
    const err = await realUniqueError(org)

    expect(constraintTable(err)).toBe('reservations')
    // 一意 index は (organization_id, code) の 2 列なので、メッセージには列が 2 つ並ぶ。
    // 先頭の `<表>.<列>` から表だけを取り出せることまで見る。
    expect(String((err as Error).message)).toContain('reservations.')
  })

  it('SQLITE_CONSTRAINT_PRIMARYKEY: idempotency_records.key から idempotency_records を取り出す', async () => {
    const org = orgId()
    const key = `${org}:reservation.create:${crypto.randomUUID()}`
    const insert = async () =>
      env.DB.prepare(
        'INSERT INTO idempotency_records (key, organization_id, scope, request_hash, response_json, status, created_at, expires_at) VALUES (?,?,?,?,NULL,?,?,?)',
      )
        .bind(key, org, 'reservation.create', 'a'.repeat(64), 'in_progress', FIXED_NOW, FIXED_NOW)
        .run()

    await insert()
    let caught: unknown = null
    let inserted = false
    try {
      await insert()
      inserted = true
    } catch (err) {
      caught = err
    }

    expect(inserted, '同じ冪等キーが 2 度入った（主キーが排他になっていない）').toBe(false)
    expect(constraintTable(caught)).toBe('idempotency_records')
  })

  it('知らない形のメッセージには null を返す（推測で表名を作らない）', () => {
    expect(constraintTable(new Error('D1_ERROR: no such table: reservations'))).toBeNull()
    expect(constraintTable(new Error('NOT NULL constraint failed: reservations.code'))).toBeNull()
    expect(constraintTable(new Error('D1_ERROR: network error'))).toBeNull()
  })

  it('Error でないもの・message が空のものにも null を返して落ちない', () => {
    expect(constraintTable(new Error(''))).toBeNull()
    expect(constraintTable('UNIQUE constraint failed: reservations.code')).toBeNull()
    expect(constraintTable(null)).toBeNull()
    expect(constraintTable(undefined)).toBeNull()
    expect(constraintTable({ message: 'UNIQUE constraint failed: reservations.code' })).toBeNull()
  })
})

describe('冪等キーの読み取り', () => {
  it('ヘッダーが無い・空文字・空白だけは「送っていない」（組織で 1 本の鍵を共有しない）', () => {
    // `?? null` で空文字を素通しすると、鍵が `<org>:reservation.create:` になり、
    // その組織のすべての端末が 1 本の鍵を共有する（別のお客様のご予約を replay する）。
    for (const raw of [undefined, '', '   ', '\t\n']) {
      expect(readIdempotencyKey(raw)).toEqual({ ok: true, key: null })
    }
  })

  it('前後の空白を落として鍵にする', () => {
    expect(readIdempotencyKey('  6f9619ff-8b86-d011-b42d-00cf4fc964ff  ')).toEqual({
      ok: true,
      key: '6f9619ff-8b86-d011-b42d-00cf4fc964ff',
    })
  })

  it('255 文字ちょうどは通し、256 文字は断る（主キーに入る長さを閉じる）', () => {
    expect(IDEMPOTENCY_KEY_MAX_LENGTH).toBe(255)
    const longest = 'k'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH)
    expect(readIdempotencyKey(longest)).toEqual({ ok: true, key: longest })
    expect(readIdempotencyKey(`${longest}k`)).toEqual({ ok: false })
  })

  it('印字できない文字・途中の空白・全角の混じった鍵は断る', () => {
    for (const raw of ['あ', 'key with space', 'key\nnext', 'key\u0000', '鍵']) {
      expect(readIdempotencyKey(raw), raw).toEqual({ ok: false })
    }
  })
})

describe('仮の押さえ', () => {
  it('空き枠 1 回につき KV.list を 1 回だけ叩く', async () => {
    const org = orgId()
    const storeId = crypto.randomUUID()
    const spy = vi.spyOn(env.SHORT_LIVED, 'list')

    // 1 予約ぶん（担当 1 + 設備 2）＝ 塞がりは 3 行。読むのは 1 回。
    await putHold(
      env.SHORT_LIVED,
      {
        organizationId: org,
        storeId,
        holdId: crypto.randomUUID(),
        startsAt: '2026-08-27T02:00:00.000Z',
        endsAt: '2026-08-27T03:00:00.000Z',
        staffId: crypto.randomUUID(),
        equipmentIds: [crypto.randomUUID(), crypto.randomUUID()],
        receptionSessionId: crypto.randomUUID(),
      },
      AUGUST,
    )

    const holds = await listHoldOccupancies(env.SHORT_LIVED, org, storeId, AUGUST)

    expect(holds).toHaveLength(3)
    // 無料枠の list は 1,000 回/日で、この設計で最初に当たる上限である
    // （`design/04-api.md` §6.3）。cursor を追って 2 回目を叩かない。
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})
