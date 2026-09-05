/**
 * 保存の前に出す影響の試算の境界。止める期間・受付できる区間・Web 枠の期間は
 * すべて半開区間 `[開始, 終わり)` で読み、左端は含み右端は含まない。
 * 基準時刻はすべて引数で渡す（`Date.now()` を 1 度も呼ばない）。
 * 読み書きの代表フローは store-settings.integration.test.ts に分ける。
 */

import { env } from 'cloudflare:test'
import { toJstDateString } from '@app/shared'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'
import {
  reservationAssignments,
  reservationPurposes,
  reservations,
  visitPurposes,
} from '../src/worker/db/schema'
import {
  type ImpactBusinessDay,
  type ImpactReservation,
  type ImpactWebSlot,
  impactOfBusinessHours,
  impactOfEquipmentStop,
  impactOfPurposeDuration,
  readAffectedReservations,
  severityOf,
} from '../src/worker/domain/settings-impact'

/** JST の壁時計を UTC の ISO8601 に直す。読み手に +9 時間の暗算をさせない。 */
function jst(date: string, time: string): string {
  const [h, m] = time.split(':').map(Number)
  const base = Date.parse(`${date}T00:00:00.000Z`)
  return new Date(base + ((h as number) - 9) * 3_600_000 + (m as number) * 60_000).toISOString()
}

const MEASURE_A = '11111111-1111-4111-8111-111111111111'
const COUNTER_1 = '22222222-2222-4222-8222-222222222222'

let seq = 0

/** 影響の試算が読む、ご予約 1 件の最小の形。 */
function reservationOn(input: {
  date: string
  from: string
  to: string
  customerName?: string | null
  purposeNameShort?: string
  equipmentIds?: string[]
}): ImpactReservation {
  seq += 1
  return {
    id: `res-${seq}`,
    startsAt: jst(input.date, input.from),
    endsAt: jst(input.date, input.to),
    customerName: input.customerName === undefined ? '山口 真央' : input.customerName,
    purposeNameShort: input.purposeNameShort ?? '視力測定',
    equipmentIds: input.equipmentIds ?? [MEASURE_A],
  }
}

/* --- 止める期間（設備を止める。AC-SET-13 / AC-SET-14） -------------------- */

describe('止める期間', () => {
  // JST 2026-08-28（金）10:00–12:00 に視力測定機 A を止める。
  const stop = {
    equipmentId: MEASURE_A,
    startsAt: jst('2026-08-28', '10:00'),
    endsAt: jst('2026-08-28', '12:00'),
  }
  const NOW = jst('2026-08-28', '09:00')

  it('10:00 ちょうどに始まるご予約は影響する（半開区間の左端を含む）', () => {
    const items = impactOfEquipmentStop({
      ...stop,
      now: NOW,
      reservations: [reservationOn({ date: '2026-08-28', from: '10:00', to: '10:30' })],
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.label).toBe('山口 真央 様　視力測定')
    expect(items[0]?.targetType).toBe('reservation')
  })

  it('12:00 ちょうどに始まるご予約は影響しない（半開区間の右端を含まない）', () => {
    const items = impactOfEquipmentStop({
      ...stop,
      now: NOW,
      reservations: [reservationOn({ date: '2026-08-28', from: '12:00', to: '12:30' })],
    })
    expect(items).toEqual([])
  })

  it('9:59 に始まり 10:01 に終わるご予約は影響する（またぐものを取りこぼさない）', () => {
    const items = impactOfEquipmentStop({
      ...stop,
      now: NOW,
      reservations: [reservationOn({ date: '2026-08-28', from: '09:59', to: '10:01' })],
    })
    expect(items).toHaveLength(1)
  })

  it('その設備を使わないご予約は影響しない', () => {
    const items = impactOfEquipmentStop({
      ...stop,
      now: NOW,
      reservations: [
        reservationOn({
          date: '2026-08-28',
          from: '10:30',
          to: '11:00',
          equipmentIds: [COUNTER_1],
        }),
      ],
    })
    expect(items).toEqual([])
  })

  it('過去のご予約は数えない（基準時刻より前に終わったもの）', () => {
    const items = impactOfEquipmentStop({
      ...stop,
      now: jst('2026-08-28', '11:30'),
      reservations: [
        reservationOn({ date: '2026-08-28', from: '10:00', to: '10:30', customerName: '川上 恵' }),
        reservationOn({
          date: '2026-08-28',
          from: '11:00',
          to: '12:00',
          customerName: '佐々木 亮',
        }),
      ],
    })
    expect(items.map((i) => i.label)).toEqual(['佐々木 亮 様　視力測定'])
  })
})

/* --- 所要時間の変更（AC-SET-15） ------------------------------------------ */

describe('所要時間の変更', () => {
  const PURPOSE = '33333333-3333-4333-8333-333333333333'
  const OTHER_PURPOSE = '44444444-4444-4444-8444-444444444444'

  const webSlots: ImpactWebSlot[] = [
    {
      purposeId: PURPOSE,
      startsAt: jst('2026-08-28', '15:00'),
      availableMinutes: 50,
      equipmentName: '視力測定機A',
    },
    {
      purposeId: PURPOSE,
      startsAt: jst('2026-08-28', '16:30'),
      availableMinutes: 50,
      equipmentName: '相談カウンター1',
    },
    {
      purposeId: PURPOSE,
      startsAt: jst('2026-08-28', '17:30'),
      availableMinutes: 90,
      equipmentName: '視力測定機B',
    },
  ]

  it('50分から 60分へ延ばすと、次の予約まで 50分しか空いていない Web 枠が落ちる', () => {
    const items = impactOfPurposeDuration({
      webSlots,
      purposeId: PURPOSE,
      from: '2026-08-28',
      to: '2026-08-28',
      currentDurationMinutes: 50,
      durationMinutes: 60,
    })
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.label)).toEqual([
      '視力測定機Aが空きません',
      '相談カウンター1が空きません',
    ])
    expect(items[0]?.targetType).toBe('web_slot')
    expect(items[0]?.targetId).toBeNull()
  })

  it('短くする変更は 1 件も落とさない（severity は info）', () => {
    const items = impactOfPurposeDuration({
      webSlots,
      purposeId: PURPOSE,
      from: '2026-08-28',
      to: '2026-08-28',
      currentDurationMinutes: 60,
      durationMinutes: 50,
    })
    expect(items).toEqual([])
    expect(severityOf({ affectedReservations: [], affectedWebSlots: items })).toBe('info')
  })

  it('期間は JST の暦日で見る（8月28日 23:30 は含み、8月29日 00:30 は含まない）', () => {
    const items = impactOfPurposeDuration({
      webSlots: [
        {
          purposeId: PURPOSE,
          startsAt: jst('2026-08-28', '23:30'),
          availableMinutes: 50,
          equipmentName: '視力測定機A',
        },
        {
          purposeId: PURPOSE,
          startsAt: jst('2026-08-29', '00:30'),
          availableMinutes: 50,
          equipmentName: '視力測定機B',
        },
      ],
      purposeId: PURPOSE,
      from: '2026-08-28',
      to: '2026-08-28',
      currentDurationMinutes: 50,
      durationMinutes: 60,
    })
    expect(items.map((i) => i.label)).toEqual(['視力測定機Aが空きません'])
  })

  it('別の目的の Web 枠は数えない', () => {
    const items = impactOfPurposeDuration({
      webSlots: [
        {
          purposeId: OTHER_PURPOSE,
          startsAt: jst('2026-08-28', '15:00'),
          availableMinutes: 10,
          equipmentName: '視力測定機A',
        },
      ],
      purposeId: PURPOSE,
      from: '2026-08-28',
      to: '2026-08-28',
      currentDurationMinutes: 50,
      durationMinutes: 60,
    })
    expect(items).toEqual([])
  })
})

/* --- 営業時間・止める帯の変更 --------------------------------------------- */

describe('営業時間と止める帯の変更', () => {
  // 朝の支度 10:00–10:15 と お昼 12:00–13:00 を差し引いたあとの受付できる区間。
  const days: ImpactBusinessDay[] = [
    {
      date: '2026-08-28',
      windows: [
        { startsAt: '10:15', endsAt: '12:00' },
        { startsAt: '13:00', endsAt: '18:40' },
      ],
    },
  ]
  const NOW = jst('2026-08-28', '09:00')

  it('区間にちょうど収まるご予約は影響しない（12:00 ちょうどに終わってよい）', () => {
    const items = impactOfBusinessHours({
      days,
      now: NOW,
      reservations: [reservationOn({ date: '2026-08-28', from: '11:30', to: '12:00' })],
    })
    expect(items).toEqual([])
  })

  it('区間から 1 分はみ出すご予約は影響する', () => {
    const items = impactOfBusinessHours({
      days,
      now: NOW,
      reservations: [reservationOn({ date: '2026-08-28', from: '11:30', to: '12:01' })],
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.label).toBe('山口 真央 様　視力測定')
  })

  it('受付できる区間が 0 本になった日は、その日のご予約が全部外れる', () => {
    const items = impactOfBusinessHours({
      days: [{ date: '2026-08-28', windows: [] }],
      now: NOW,
      reservations: [
        reservationOn({ date: '2026-08-28', from: '10:30', to: '11:00', customerName: '川上 恵' }),
        reservationOn({
          date: '2026-08-28',
          from: '14:00',
          to: '14:30',
          customerName: '佐々木 亮',
        }),
      ],
    })
    expect(items.map((i) => i.label)).toEqual(['川上 恵 様　視力測定', '佐々木 亮 様　視力測定'])
  })

  it('渡していない日のご予約は数えない（試算の範囲の外）', () => {
    const items = impactOfBusinessHours({
      days,
      now: NOW,
      reservations: [reservationOn({ date: '2026-08-29', from: '20:00', to: '20:30' })],
    })
    expect(items).toEqual([])
  })

  it('お名前の無いご予約はウォークインのお客様として数える', () => {
    const items = impactOfBusinessHours({
      days: [{ date: '2026-08-28', windows: [] }],
      now: NOW,
      reservations: [
        reservationOn({ date: '2026-08-28', from: '10:30', to: '11:00', customerName: null }),
      ],
    })
    expect(items.map((i) => i.label)).toEqual(['ウォークインのお客様　視力測定'])
  })
})

/* --- 件数と札（AC-SET-14） ------------------------------------------------ */

describe('件数と札', () => {
  it('影響 0 件なら severity は info、1 件以上なら action', () => {
    expect(severityOf({ affectedReservations: [], affectedWebSlots: [] })).toBe('info')

    const stop = {
      equipmentId: MEASURE_A,
      startsAt: jst('2026-08-28', '10:00'),
      endsAt: jst('2026-08-28', '12:00'),
      now: jst('2026-08-28', '09:00'),
    }
    const none = impactOfEquipmentStop({
      ...stop,
      reservations: [reservationOn({ date: '2026-08-28', from: '13:00', to: '13:30' })],
    })
    expect(severityOf({ affectedReservations: none, affectedWebSlots: [] })).toBe('info')

    const one = impactOfEquipmentStop({
      ...stop,
      reservations: [reservationOn({ date: '2026-08-28', from: '11:00', to: '11:30' })],
    })
    expect(severityOf({ affectedReservations: one, affectedWebSlots: [] })).toBe('action')
  })
})

/* --- JST の日跨ぎ --------------------------------------------------------- */

describe('JST の日跨ぎ', () => {
  it('止める期間が UTC 15:00 をまたいでも、JST の同じ日として数える', () => {
    // JST 2026-08-28 を丸ごと止める = UTC 08-27T15:00Z 〜 08-28T15:00Z。
    const items = impactOfEquipmentStop({
      equipmentId: MEASURE_A,
      startsAt: jst('2026-08-28', '00:00'),
      endsAt: jst('2026-08-29', '00:00'),
      now: jst('2026-08-27', '00:00'),
      reservations: [
        reservationOn({ date: '2026-08-27', from: '23:00', to: '23:30', customerName: '前の日' }),
        reservationOn({ date: '2026-08-28', from: '09:00', to: '09:30', customerName: '当日の朝' }),
        reservationOn({ date: '2026-08-29', from: '00:30', to: '01:00', customerName: '次の日' }),
      ],
    })
    expect(items.map((i) => i.label)).toEqual(['当日の朝 様　視力測定'])
    expect(toJstDateString(items[0]?.at as string)).toBe('2026-08-28')
  })
})

/* --- 予約の読み口（この関数の外で reservations を SELECT しない） ---------- */

describe('予約の読み口', () => {
  const db = drizzle(env.DB)

  /** 1 件のご予約と、その目的・設備の割り当てを書き込む。 */
  async function insertReservation(input: {
    organizationId: string
    storeId: string
    purposeId: string
    startsAt: string
    endsAt: string
    status?: string
    equipmentIds?: (string | null)[]
  }): Promise<string> {
    seq += 1
    const id = crypto.randomUUID()
    const at = '2026-08-01T00:00:00.000Z'
    await db.insert(reservations).values({
      id,
      organizationId: input.organizationId,
      storeId: input.storeId,
      code: `EY-2608-${String(seq).padStart(4, '0')}`,
      customerId: null,
      source: 'phone',
      status: input.status ?? 'confirmed',
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      durationMinutes: 30,
      version: 1,
      createdAt: at,
      updatedAt: at,
    })
    await db.insert(reservationPurposes).values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      reservationId: id,
      purposeId: input.purposeId,
      durationMinutes: 30,
      sortOrder: 0,
      createdAt: at,
    })
    for (const targetId of input.equipmentIds ?? []) {
      await db.insert(reservationAssignments).values({
        id: crypto.randomUUID(),
        organizationId: input.organizationId,
        reservationId: id,
        kind: 'equipment',
        targetId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        createdAt: at,
      })
    }
    return id
  }

  /** その組織だけの目的を 1 件作る（台帳の短い名前の出どころ）。 */
  async function insertPurpose(organizationId: string, storeId: string): Promise<string> {
    const id = crypto.randomUUID()
    const at = '2026-08-01T00:00:00.000Z'
    await db.insert(visitPurposes).values({
      id,
      organizationId,
      storeId,
      nameInternal: 'メガネを新しく作る',
      namePublic: '新しいメガネを作る',
      nameShort: '新調相談',
      durationMinutes: 60,
      isWebPublished: '1',
      isActive: '1',
      sortOrder: 0,
      version: 1,
      createdAt: at,
      updatedAt: at,
    })
    return id
  }

  it('期間の左端ちょうどのご予約を含み、右端ちょうどのご予約は含まない', async () => {
    const organizationId = `org-${crypto.randomUUID()}`
    const storeId = crypto.randomUUID()
    const purposeId = await insertPurpose(organizationId, storeId)
    await insertReservation({
      organizationId,
      storeId,
      purposeId,
      startsAt: jst('2026-08-28', '10:00'),
      endsAt: jst('2026-08-28', '10:30'),
      equipmentIds: [MEASURE_A],
    })
    await insertReservation({
      organizationId,
      storeId,
      purposeId,
      startsAt: jst('2026-08-28', '12:00'),
      endsAt: jst('2026-08-28', '12:30'),
      equipmentIds: [MEASURE_A],
    })

    const rows = await readAffectedReservations(db, {
      organizationId,
      storeId,
      from: jst('2026-08-28', '10:00'),
      to: jst('2026-08-28', '12:00'),
    })
    expect(rows.map((r) => r.startsAt)).toEqual([jst('2026-08-28', '10:00')])
  })

  it('取り消したご予約と無断キャンセルは数えない', async () => {
    const organizationId = `org-${crypto.randomUUID()}`
    const storeId = crypto.randomUUID()
    const purposeId = await insertPurpose(organizationId, storeId)
    await insertReservation({
      organizationId,
      storeId,
      purposeId,
      startsAt: jst('2026-08-28', '10:00'),
      endsAt: jst('2026-08-28', '10:30'),
      status: 'cancelled',
    })
    await insertReservation({
      organizationId,
      storeId,
      purposeId,
      startsAt: jst('2026-08-28', '11:00'),
      endsAt: jst('2026-08-28', '11:30'),
      status: 'no_show',
    })
    await insertReservation({
      organizationId,
      storeId,
      purposeId,
      startsAt: jst('2026-08-28', '13:00'),
      endsAt: jst('2026-08-28', '13:30'),
      status: 'arrived',
    })

    const rows = await readAffectedReservations(db, {
      organizationId,
      storeId,
      from: jst('2026-08-28', '00:00'),
      to: jst('2026-08-29', '00:00'),
    })
    expect(rows.map((r) => r.startsAt)).toEqual([jst('2026-08-28', '13:00')])
  })

  it('期間にご予約が 1 件も無ければ空の配列を返す', async () => {
    const organizationId = `org-${crypto.randomUUID()}`
    const rows = await readAffectedReservations(db, {
      organizationId,
      storeId: crypto.randomUUID(),
      from: jst('2026-08-28', '00:00'),
      to: jst('2026-08-29', '00:00'),
    })
    expect(rows).toEqual([])
  })

  it('設備の割り当てと目的の短い名前を 1 行にまとめて返す', async () => {
    const organizationId = `org-${crypto.randomUUID()}`
    const storeId = crypto.randomUUID()
    const purposeId = await insertPurpose(organizationId, storeId)
    await insertReservation({
      organizationId,
      storeId,
      purposeId,
      startsAt: jst('2026-08-28', '10:00'),
      endsAt: jst('2026-08-28', '10:30'),
      // 2 台の押さえと「あとで決める」（NULL）を混ぜる。NULL は設備を押さえていない。
      equipmentIds: [MEASURE_A, COUNTER_1, null],
    })

    const rows = await readAffectedReservations(db, {
      organizationId,
      storeId,
      from: jst('2026-08-28', '00:00'),
      to: jst('2026-08-29', '00:00'),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      purposeNameShort: '新調相談',
      equipmentIds: [MEASURE_A, COUNTER_1],
      // customers 表は P4 で入る。それまでお名前は読みようがない。
      customerName: null,
    })
  })
})
