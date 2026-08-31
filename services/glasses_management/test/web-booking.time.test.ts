/**
 * お客様向け Web 予約（`011-web-booking`）の時刻の境目を、両側から 1 か所に閉じる。
 *
 * ここで固定するのは 4 つである。
 *
 * 1. **受付の窓** — 受け付ける時間（`opens_at`〜`closes_at`）・何時間先から
 *    （`accept_from_hours`）・何日先まで（`accept_until_days`）。
 * 2. **変更・取消の締切** — 来店日の `change_deadline_days` 日前の 23:59:59.999 JST。
 * 3. **確認待ちの自動取消** — **受信日**（`created_at` の JST 暦日）の 24:00 JST。
 *    来店日ではない（3 週間先のご予約でも、届いた日のうちに確かめないと落ちる）。
 * 4. **短命の確認番号** — 900 秒。
 *
 * 時刻はすべて純関数の引数（`now: Date`）で注入する。`Date.now()` に依存したテストを
 * 書かないのは、閉店間際・月末・年末に静かに壊れる判定を、テストを回した日と時刻から
 * 切り離すためである。JST の日境界は UTC 15:00 で、基準日時は承認済みモックと同じ
 * `2026-08-27T02:08:00.000Z`（＝ JST 8月27日 11:08）を使う。
 */
import { describe, expect, it } from 'vitest'
import {
  type AvailabilityInput,
  evaluateSlot,
  type SlotRules,
  type StaffMember,
} from '../src/worker/domain/availability'
import { isShortLivedFresh, shortLivedExpiresAt } from '../src/worker/domain/management-code'
import type { WeeklyHours } from '../src/worker/domain/store-settings'
import {
  canOpenWeek,
  changeDeadlineAt,
  isChangeDeadlinePassed,
  shouldAutoCancel,
  type WebWindow,
} from '../src/worker/domain/web-booking'

/* --- 盤面 ---------------------------------------------------------------- */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** JST 8月27日（木）11:08。モックの statusbar と同じ時刻。 */
const NOW = new Date('2026-08-27T02:08:00.000Z')

/** JST の壁時計（`HH:MM` / `HH:MM:SS` / `HH:MM:SS.mmm`）を UTC の ISO へ。 */
function jst(date: string, clock: string): string {
  const padded = `${clock}${':00.000'.slice(clock.length - 5)}`
  return new Date(Date.parse(`${date}T${padded}Z`) - JST_OFFSET_MS).toISOString()
}

/** 曜日の当たり外れを消す。7 曜日とも 10:00–19:00。 */
const OPEN_EVERY_DAY: WeeklyHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isClosed: false,
  opensAt: '10:00',
  closesAt: '19:00',
}))

const SLOT_RULES: SlotRules = { slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3 }

/** 技能も設備も要らない担当 1 名。Web の絞り込みだけを見たいので条件を足さない。 */
const MISAKI: StaffMember = {
  id: 'staff-misaki',
  displayName: '佐藤 美咲',
  skills: [],
  maxParallelReservations: 1,
}

/** 銀座店の受付の窓（SETTINGS-WEB「10:30–18:00 ／ 2時間先から ／ 30日先まで」）。 */
const GINZA_WINDOW: WebWindow = {
  opensAt: '10:30',
  closesAt: '18:00',
  acceptFromHours: 2,
  acceptUntilDays: 30,
}

/** その日 1 日ぶんの盤面。担当は 10:00–19:00 で勤務している。 */
function board(date: string, patch: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    date,
    now: NOW,
    slotRules: SLOT_RULES,
    weeklyHours: OPEN_EVERY_DAY,
    purposes: [{ id: 'purpose-plain', durationMinutes: 30 }],
    staff: [MISAKI],
    shifts: [{ staffId: MISAKI.id, date, startsAt: '10:00', endsAt: '19:00', kind: 'work' }],
    webWindow: GINZA_WINDOW,
    ...patch,
  }
}

/* --- 受付の窓 ------------------------------------------------------------- */

describe('受付開始', () => {
  // JST 11:08 の 2 時間先は 13:08。刻みの格子には載らない時刻だが、境目は
  // 「格子に載るか」ではなく「いま から 2 時間経ったか」で決まる。
  it('2時間先ちょうどの枠は受け付ける', () => {
    const slot = evaluateSlot(board('2026-08-27'), jst('2026-08-27', '13:08'))
    expect(slot.isAvailable).toBe(true)
  })

  it('2時間先の1秒手前の枠は受け付けない', () => {
    const slot = evaluateSlot(board('2026-08-27'), jst('2026-08-27', '13:07:59'))
    expect(slot.isAvailable).toBe(false)
    expect(slot.reason).toBe('lead_time')
  })
})

describe('受付終了', () => {
  // 2026-08-27 の 30 日先は 2026-09-26、31 日先は 2026-09-27。
  it('30日先ちょうどの日は受け付ける', () => {
    const slot = evaluateSlot(board('2026-09-26'), jst('2026-09-26', '11:00'))
    expect(slot.isAvailable).toBe(true)
  })

  it('31日先の日は受け付けない', () => {
    const slot = evaluateSlot(board('2026-09-27'), jst('2026-09-27', '11:00'))
    expect(slot.isAvailable).toBe(false)
    expect(slot.reason).toBe('lead_time')
  })

  // 週は「今日」から 7 日ずつ送る。30 日先ちょうど（9月26日）を含む週は開き、
  // その先の週（10月1日始まり）へは送れない。開いた週の中の 31 日先の日は
  // 上の 1 本のとおり押せないままである。
  it('31日先を含む週へは送れない', () => {
    expect(canOpenWeek('2026-09-24', GINZA_WINDOW.acceptUntilDays, NOW)).toBe(true)
    expect(canOpenWeek('2026-10-01', GINZA_WINDOW.acceptUntilDays, NOW)).toBe(false)
  })
})

describe('受け付ける時間', () => {
  // 受付開始の 2 時間が効かない日で見る（9月10日は 30 日先の内側にある）。
  const DAY = '2026-09-10'

  it('10:30 ちょうどの枠は出す。10:29 に終わる枠は出さない', () => {
    expect(evaluateSlot(board(DAY), jst(DAY, '10:30')).isAvailable).toBe(true)

    const early = evaluateSlot(board(DAY, { durationMinutes: 29 }), jst(DAY, '10:00'))
    expect(early.isAvailable).toBe(false)
    expect(early.reason).toBe('web_window')
  })

  it('18:00 に始まる枠は出さない', () => {
    const slot = evaluateSlot(board(DAY), jst(DAY, '18:00'))
    expect(slot.isAvailable).toBe(false)
    expect(slot.reason).toBe('web_window')
  })
})

/* --- 変更・取消の締切 ------------------------------------------------------ */

describe('変更・取消の締切', () => {
  /** ご来店は 9月17日（木）。既定の締切は前日 23:59:59.999 JST。 */
  const VISIT = '2026-09-17'

  it('前日 23:59:59.999 JST ちょうどは変更できる', () => {
    expect(changeDeadlineAt(VISIT, 1)).toBe(jst('2026-09-16', '23:59:59.999'))
    const now = new Date(jst('2026-09-16', '23:59:59.999'))
    expect(isChangeDeadlinePassed({ visitDate: VISIT, changeDeadlineDays: 1 }, now)).toBe(false)
  })

  it('当日 00:00:00.000 JST から change_deadline_passed になる', () => {
    const now = new Date(jst(VISIT, '00:00:00.000'))
    expect(isChangeDeadlinePassed({ visitDate: VISIT, changeDeadlineDays: 1 }, now)).toBe(true)
  })

  it('change_deadline_days が 0 なら来店日の 23:59:59.999 JST まで変更できる', () => {
    const deadline = new Date(jst(VISIT, '23:59:59.999'))
    expect(changeDeadlineAt(VISIT, 0)).toBe(deadline.toISOString())
    expect(isChangeDeadlinePassed({ visitDate: VISIT, changeDeadlineDays: 0 }, deadline)).toBe(
      false,
    )
    const after = new Date(deadline.getTime() + 1)
    expect(isChangeDeadlinePassed({ visitDate: VISIT, changeDeadlineDays: 0 }, after)).toBe(true)
  })
})

/* --- 確認待ちの自動取消 ---------------------------------------------------- */

describe('確認待ちの自動取消', () => {
  /** 確認待ちの 1 件。**来店日を持たない** — 判定に使わないので受け取らない。 */
  function pending(createdAt: string) {
    return { status: 'pending' as const, createdAt }
  }

  it('受信日の 23:59:59.999 JST では取り消さない', () => {
    const booking = pending(NOW.toISOString())
    expect(shouldAutoCancel(booking, new Date(jst('2026-08-27', '23:59:59.999')))).toBe(false)
  })

  it('受信日の翌 00:00:00.000 JST で取り消す', () => {
    const booking = pending(NOW.toISOString())
    expect(shouldAutoCancel(booking, new Date(jst('2026-08-28', '00:00:00.000')))).toBe(true)
  })

  it('来店日が3週間先でも、受信日を過ぎたら取り消す', () => {
    // 8月27日に届いた 9月17日のご予約。ALERTS の「本日中に確認しないと自動で
    // 取り消されます。」の「本日」は届いた日である。
    const booking = pending(NOW.toISOString())
    expect(shouldAutoCancel(booking, new Date(jst('2026-08-28', '00:00:00.000')))).toBe(true)
    expect(shouldAutoCancel(booking, new Date(jst('2026-09-17', '10:00')))).toBe(true)
  })

  it('月をまたぐ受信日（8月31日受信）でも受信日で切れる', () => {
    const booking = pending(jst('2026-08-31', '11:08'))
    expect(shouldAutoCancel(booking, new Date(jst('2026-08-31', '23:59:59.999')))).toBe(false)
    expect(shouldAutoCancel(booking, new Date(jst('2026-09-01', '00:00:00.000')))).toBe(true)
  })

  it('年をまたぐ受信日（12月31日受信）でも受信日で切れる', () => {
    const booking = pending(jst('2026-12-31', '23:00'))
    expect(shouldAutoCancel(booking, new Date(jst('2026-12-31', '23:59:59.999')))).toBe(false)
    expect(shouldAutoCancel(booking, new Date(jst('2027-01-01', '00:00:00.000')))).toBe(true)
  })

  it('うるう年の2月29日に受け取った予約も同じ規則で切れる', () => {
    const booking = pending(jst('2028-02-29', '11:08'))
    expect(shouldAutoCancel(booking, new Date(jst('2028-02-29', '23:59:59.999')))).toBe(false)
    expect(shouldAutoCancel(booking, new Date(jst('2028-03-01', '00:00:00.000')))).toBe(true)
  })
})

/* --- 短命の確認番号 -------------------------------------------------------- */

describe('短命の確認番号', () => {
  it('900秒ちょうどは本人確認が通る', () => {
    const expiresAt = shortLivedExpiresAt(NOW)
    expect(isShortLivedFresh({ expiresAt }, new Date(NOW.getTime() + 900_000))).toBe(true)
  })

  it('901秒で invalid_management_code になる', () => {
    const expiresAt = shortLivedExpiresAt(NOW)
    expect(isShortLivedFresh({ expiresAt }, new Date(NOW.getTime() + 901_000))).toBe(false)
  })
})
