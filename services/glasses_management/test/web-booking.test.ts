/**
 * お客様向け Web 予約（`011-web-booking`）のドメイン。時刻の境目は
 * `web-booking.time.test.ts` に置き、ここには**時刻に依らない決め**だけを置く。
 *
 * 1. **公開設定の解決** — 行が無い店舗は「公開していません」。公開する目的が 0 件なら
 *    公開しない。外へ出るのは対客名（`visit_purposes.name_public`）だけである。
 * 2. **ご予約番号の採番** — `EY-W-YYMM-NNNN`。`reservations.code` の `EY-YYMM-NNNN` と
 *    混ぜない。
 * 3. **確認番号** — 発行・ハッシュ・照合。**平文を保存しない**ので、照合は入力を
 *    同じ塩でハッシュしてから一定時間で比べる。
 * 4. **空き枠エンジンへの足し算** — `webWindow` を渡さなければ店内の挙動が 1 ミリも
 *    変わらないこと。
 */
import { describe, expect, it } from 'vitest'
import {
  type AvailabilityInput,
  computeAvailability,
  evaluateSlot,
  type HoldOccupancy,
  type SlotRules,
  type StaffMember,
} from '../src/worker/domain/availability'
import {
  failureKey,
  hashConfirmationKey,
  hashManagementCode,
  isManagementCodeLocked,
  issueConfirmationKey,
  issueManagementCode,
  MANAGEMENT_CODE_FAILURE_TTL_SECONDS,
  MANAGEMENT_CODE_LENGTH,
  MANAGEMENT_CODE_RETRY_AFTER_SECONDS,
  shortLivedExpiresAt,
  shortLivedKey,
  verifyManagementCode,
} from '../src/worker/domain/management-code'
import type { WeeklyHours } from '../src/worker/domain/store-settings'
import {
  autoCancelledAlert,
  bumpPublicCode,
  nextPublicCode,
  type PublishablePurpose,
  requiresApproval,
  resolvePublication,
  shouldAutoCancel,
  WEB_CODE_ATTEMPTS,
  type WebBookingSettingsRow,
  webBookingCodeMonth,
} from '../src/worker/domain/web-booking'

/* --- 盤面 ---------------------------------------------------------------- */

/** 公開ドメイン（`wrangler.jsonc` の `vars`）。表には持たない。 */
const PUBLIC_ORIGIN = 'eye.jp'

/** 銀座店の公開設定 1 行（SETTINGS-WEB の「受け付ける内容」5 行そのまま）。 */
const GINZA: WebBookingSettingsRow = {
  isPublished: '1',
  opensAt: '10:30',
  closesAt: '18:00',
  acceptFromHours: 2,
  acceptUntilDays: 30,
  changeDeadlineDays: 1,
  requiresApproval: '1',
  message: '9月30日（水）は棚卸しのためお休みをいただきます。',
  version: 3,
  updatedAt: '2026-08-20T01:00:00.000Z',
}

/** 銀座店の来店目的 6 件（`05-screen-flow.md` §3.11 の 6 行表）。 */
const PURPOSES: PublishablePurpose[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    namePublic: '新しいメガネを作る',
    durationMinutes: 60,
    isWebPublished: '1',
    isActive: '1',
    sortOrder: 0,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    namePublic: 'レンズだけを替える',
    durationMinutes: 45,
    isWebPublished: '1',
    isActive: '1',
    sortOrder: 1,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    namePublic: '見え方の相談',
    durationMinutes: 30,
    isWebPublished: '1',
    isActive: '1',
    sortOrder: 2,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    namePublic: 'できあがりの受け取り',
    durationMinutes: 20,
    isWebPublished: '1',
    isActive: '1',
    sortOrder: 3,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    namePublic: 'かけ具合の調整',
    durationMinutes: 20,
    isWebPublished: '1',
    isActive: '1',
    sortOrder: 4,
  },
  // 修理・部品の交換は店頭でだけ受ける（`is_web_published='0'`）。
  {
    id: '66666666-6666-4666-8666-666666666666',
    namePublic: '修理・部品の交換',
    durationMinutes: 30,
    isWebPublished: '0',
    isActive: '1',
    sortOrder: 5,
  },
]

function publication(patch: Partial<Parameters<typeof resolvePublication>[0]> = {}) {
  return resolvePublication({
    slug: 'ginza',
    settings: GINZA,
    purposes: PURPOSES,
    publicOrigin: PUBLIC_ORIGIN,
    now: new Date('2026-08-27T02:08:00.000Z'),
    ...patch,
  })
}

/* --- 公開設定の解決 -------------------------------------------------------- */

describe('公開設定の解決', () => {
  it('行が無い店舗は公開していないものとして読み、既定値を返す', () => {
    const resolved = publication({ settings: null })
    expect(resolved.isPublished).toBe(false)
    expect(resolved.window).toEqual({
      opensAt: '10:30',
      closesAt: '18:00',
      acceptFromHours: 2,
      acceptUntilDays: 30,
    })
    expect(resolved.changeDeadlineDays).toBe(1)
    expect(resolved.message).toBe('')
    expect(resolved.version).toBe(0)
  })

  it('公開する目的が 0 件なら is_published が 1 でも公開しない', () => {
    const resolved = publication({ purposes: [] })
    expect(resolved.isPublished).toBe(false)
    expect(resolved.purposes).toEqual([])
  })

  it('ご案内のページは公開ドメインと stores.slug から組み立てる', () => {
    expect(publication().landingPath).toBe('eye.jp/ginza')
    expect(publication({ publicOrigin: 'https://eye.jp/' }).landingPath).toBe('eye.jp/ginza')
  })

  it('公開する目的は is_web_published と is_active の両方が立つ行だけ', () => {
    const stopped = PURPOSES.map((purpose) =>
      purpose.sortOrder === 4 ? { ...purpose, isActive: '0' } : purpose,
    )
    const names = publication({ purposes: stopped }).purposes.map((purpose) => purpose.name)
    expect(names).toEqual([
      '新しいメガネを作る',
      'レンズだけを替える',
      '見え方の相談',
      'できあがりの受け取り',
    ])
  })

  it('返るご用件は対客名と目安の分数だけで、店内名も技能も持たない', () => {
    const [first] = publication().purposes
    expect(first).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      name: '新しいメガネを作る',
      durationMinutes: 60,
    })
  })

  it('ご用件の並びは登録順（sort_order）', () => {
    const shuffled = [...PURPOSES].reverse()
    const ids = publication({ purposes: shuffled }).purposes.map((purpose) => purpose.id)
    expect(ids).toEqual(PURPOSES.filter((p) => p.isWebPublished === '1').map((p) => p.id))
  })
})

describe('承認要否', () => {
  it('お店が確かめてから確定する設定は承認が要る', () => {
    expect(requiresApproval(GINZA)).toBe(true)
  })

  it('行が無い店舗も承認が要るものとして読む（自動確定の既定を作らない）', () => {
    expect(requiresApproval(null)).toBe(true)
  })

  it('requires_approval が 0 の店舗だけ、作った時点で確定になる', () => {
    expect(requiresApproval({ ...GINZA, requiresApproval: '0' })).toBe(false)
  })
})

describe('確認待ちの自動取消', () => {
  it('確定した予約と取り消した予約は自動で取り消さない', () => {
    const now = new Date('2026-09-30T02:08:00.000Z')
    const createdAt = '2026-08-27T02:08:00.000Z'
    expect(shouldAutoCancel({ status: 'confirmed', createdAt }, now)).toBe(false)
    expect(shouldAutoCancel({ status: 'cancelled', createdAt }, now)).toBe(false)
  })

  it('お知らせは web_booking.auto_cancelled を info でお店に出し、本文にお名前を入れない', () => {
    const alert = autoCancelledAlert({ publicCode: 'EY-W-2608-0031' })
    expect(alert.code).toBe('web_booking.auto_cancelled')
    expect(alert.severity).toBe('info')
    expect(alert.audience).toBe('store')
    expect(alert.body).toContain('EY-W-2608-0031')
    expect([...alert.title].length).toBeLessThanOrEqual(60)
    expect([...alert.body].length).toBeLessThanOrEqual(120)
  })
})

/* --- ご予約番号の採番 ------------------------------------------------------ */

describe('ご予約番号の採番', () => {
  it('EY-W-YYMM-NNNN を 4 桁ゼロ埋めで作る', () => {
    expect(nextPublicCode('2608', 30)).toBe('EY-W-2608-0031')
    expect(nextPublicCode('2608', null)).toBe('EY-W-2608-0001')
  })

  it('9999 の次は 5 桁になる（頭を切らない）', () => {
    expect(nextPublicCode('2608', 9999)).toBe('EY-W-2608-10000')
  })

  it('衝突したら月はそのままに連番だけ +1 して打ち直す', () => {
    expect(bumpPublicCode('EY-W-2608-0031')).toBe('EY-W-2608-0032')
    expect(bumpPublicCode('EY-W-2608-9999')).toBe('EY-W-2608-10000')
  })

  it('打ち直しは 5 本まで（尽きたら 409 code_exhausted にする）', () => {
    let code = nextPublicCode('2608', 30)
    for (let attempt = 1; attempt < WEB_CODE_ATTEMPTS; attempt += 1) code = bumpPublicCode(code)
    expect(WEB_CODE_ATTEMPTS).toBe(5)
    expect(code).toBe('EY-W-2608-0035')
  })

  it('YYMM は JST の暦月で決まる（UTC 15:00 で翌月に変わる）', () => {
    expect(webBookingCodeMonth(new Date('2026-08-31T14:59:59.999Z'))).toBe('2608')
    expect(webBookingCodeMonth(new Date('2026-08-31T15:00:00.000Z'))).toBe('2609')
  })

  it('店内の予約番号（EY-YYMM-NNNN）とは書式が違う', () => {
    expect(nextPublicCode('2608', 141)).toBe('EY-W-2608-0142')
    expect(nextPublicCode('2608', 141)).not.toMatch(/^EY-\d{4}-/)
  })
})

/* --- 確認番号 -------------------------------------------------------------- */

describe('確認番号', () => {
  /** 塩は組織とご予約番号から作る（1 件が漏れても他の 1 件を開けない）。 */
  const SALT = 'org-ginza:EY-W-2608-0031'

  it('8 文字で、読み違えやすい 0 O 1 I l を 1 文字も含まない', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = issueManagementCode()
      expect(code).toHaveLength(MANAGEMENT_CODE_LENGTH)
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/)
    }
  })

  it('呼ぶたびに違う番号になる', () => {
    const codes = new Set(Array.from({ length: 200 }, () => issueManagementCode()))
    expect(codes.size).toBeGreaterThan(190)
  })

  it('保存するのはハッシュだけで、平文を 1 文字も含まない', async () => {
    const code = issueManagementCode()
    const hash = await hashManagementCode(code, SALT)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(code)
  })

  it('同じ塩と同じ番号なら同じハッシュになる', async () => {
    expect(await hashManagementCode('ABCD2345', SALT)).toBe(
      await hashManagementCode('ABCD2345', SALT),
    )
  })

  it('塩が違えば同じ番号でも別のハッシュになる', async () => {
    expect(await hashManagementCode('ABCD2345', SALT)).not.toBe(
      await hashManagementCode('ABCD2345', 'org-ginza:EY-W-2608-0032'),
    )
  })

  it('小文字・空白・ハイフンで入力しても照合できる', async () => {
    const hash = await hashManagementCode('ABCD2345', SALT)
    expect(await verifyManagementCode(hash, ' abcd-2345 ', SALT)).toBe(true)
  })

  it('1 文字違う番号では照合できない', async () => {
    const hash = await hashManagementCode('ABCD2345', SALT)
    expect(await verifyManagementCode(hash, 'ABCD2346', SALT)).toBe(false)
  })

  it('長さの違う入力でも false を返す（長さで早く返らない）', async () => {
    const hash = await hashManagementCode('ABCD2345', SALT)
    expect(await verifyManagementCode(hash, 'ABCD', SALT)).toBe(false)
    expect(await verifyManagementCode(hash, 'ABCD2345ABCD2345', SALT)).toBe(false)
    expect(await verifyManagementCode(hash, '', SALT)).toBe(false)
  })

  it('確認メールの鍵は別に発行し、ハッシュだけを保存する', async () => {
    const key = issueConfirmationKey()
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    const hash = await hashConfirmationKey(key, SALT)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(key)
  })
})

describe('本人確認の失敗回数', () => {
  it('KV の鍵は短命の鍵が mgmt:<orgId>:<code>、失敗回数が mgmtfail:<code>:<ip>', () => {
    expect(shortLivedKey('org-ginza', 'EY-W-2608-0031')).toBe('mgmt:org-ginza:EY-W-2608-0031')
    expect(failureKey('EY-W-2608-0031', '203.0.113.7')).toBe('mgmtfail:EY-W-2608-0031:203.0.113.7')
  })

  it('9 回までは試せて、10 回で締める', () => {
    expect(isManagementCodeLocked(9)).toBe(false)
    expect(isManagementCodeLocked(10)).toBe(true)
  })

  it('短命の鍵は 900 秒、失敗回数は 3600 秒で消え、締めたあとは 900 秒待つ', () => {
    const now = new Date('2026-08-27T02:08:00.000Z')
    expect(shortLivedExpiresAt(now)).toBe('2026-08-27T02:23:00.000Z')
    expect(MANAGEMENT_CODE_FAILURE_TTL_SECONDS).toBe(3600)
    expect(MANAGEMENT_CODE_RETRY_AFTER_SECONDS).toBe(900)
  })
})

/* --- 空き枠エンジンへの足し算 ---------------------------------------------- */

describe('空き枠エンジンへの足し算', () => {
  const DAY = '2026-08-27'
  const NOW = new Date('2026-08-27T02:08:00.000Z')
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000

  function jst(clock: string): string {
    return new Date(Date.parse(`${DAY}T${clock}:00.000Z`) - JST_OFFSET_MS).toISOString()
  }

  const RULES: SlotRules = { slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3 }
  const STAFF: StaffMember = {
    id: 'staff-misaki',
    displayName: '佐藤 美咲',
    skills: [],
    maxParallelReservations: 1,
  }
  const WEEK: WeeklyHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isClosed: false,
    opensAt: '10:00',
    closesAt: '19:00',
  }))

  function board(patch: Partial<AvailabilityInput> = {}): AvailabilityInput {
    return {
      date: DAY,
      now: NOW,
      slotRules: RULES,
      weeklyHours: WEEK,
      purposes: [{ id: 'purpose-plain', durationMinutes: 30 }],
      staff: [STAFF],
      shifts: [{ staffId: STAFF.id, date: DAY, startsAt: '10:00', endsAt: '19:00', kind: 'work' }],
      ...patch,
    }
  }

  it('webWindow を渡さなければ Web の絞り込みを 1 つも掛けない', () => {
    const { slots } = computeAvailability(board())
    // JST 11:08 の 2 時間先より手前でも、店内の予約としては置ける。
    expect(evaluateSlot(board(), jst('10:00')).isAvailable).toBe(true)
    expect(slots.some((slot) => slot.reason === 'web_window' || slot.reason === 'lead_time')).toBe(
      false,
    )
  })

  it('webWindow を渡すと、同じ盤面から受付の窓の外が落ちる', () => {
    const web = board({
      webWindow: {
        opensAt: '10:30',
        closesAt: '18:00',
        acceptFromHours: 0,
        acceptUntilDays: 30,
      },
    })
    expect(evaluateSlot(web, jst('10:00')).reason).toBe('web_window')
    // 11:30 は受け付ける時間（10:30–18:00）の中で、いま（JST 11:08）より先にある。
    expect(evaluateSlot(web, jst('11:30')).isAvailable).toBe(true)
  })

  const HOLD: HoldOccupancy[] = [
    {
      holdId: 'hold-1',
      receptionSessionId: 'session-1',
      kind: 'staff',
      targetId: 'staff-misaki',
      startsAt: jst('14:00'),
      endsAt: jst('14:30'),
    },
  ]

  it('仮の押さえは既定では塞がりに数える（店内の挙動を変えない）', () => {
    expect(evaluateSlot(board({ holds: HOLD }), jst('14:00')).isAvailable).toBe(false)
  })

  it('readHolds が false なら仮の押さえを数えない（公開面は KV を読まない）', () => {
    expect(evaluateSlot(board({ holds: HOLD, readHolds: false }), jst('14:00')).isAvailable).toBe(
      true,
    )
  })
})
