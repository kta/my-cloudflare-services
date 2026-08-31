/**
 * 店頭の受け付けの「ちょうど」を固定する（`src/worker/domain/walkin.ts`）。
 *
 * ここで見るのは 3 つである。
 *
 * 1. **経過分** — 「お待ち 6分」も「お待たせ中 18分」も列に持たず、`now − arrivedAt` から
 *    毎回出す。閾値は **15 分**で、15 分ちょうどはお待たせ中でない（`03-data-model.md` §7.4）。
 * 2. **整理番号** — 店舗 × 来店日（JST）で 1 から採り直す。日付を UTC のまま読むと
 *    15:00Z から翌 15:00Z までが 1 日になり、夕方のお客様が翌日の 001 を受け取る。
 * 3. **待ちきれずお帰り** — `waiting` から接客に入らないまま `left` になった来店。
 *    接客を終えた退店と 1 つに潰すと、お待ち時間の中央値が実態より必ず良い側へ出る。
 *
 * **時刻はすべて引数で受ける。**`Date.now()` を 1 度も呼ばない。基準時刻は世界観データの
 * **2026年8月27日（木）11:08 JST**（`FIXED_NOW`）。
 *
 * `整理番号の衝突` の 3 本だけは `src/worker/domain/booking.ts` の `constraintTable` を見る。
 * 採番の打ち直しはこの関数が `walk_ins` を返せるかどうかにそのまま乗っており、
 * D1 の文言が変わると 409 が 500 に化ける（`booking.test.ts` の 4 本と合わせて 7 本）。
 */
import { describe, expect, it } from 'vitest'
import { constraintTable } from '../src/worker/domain/booking'
import {
  formatTicket,
  isAbandonedWait,
  isWaitingTooLong,
  jstVisitDate,
  nextTicketNo,
  subjectDisplayName,
  WAITING_TOO_LONG_MINUTES,
  type WalkinVisitEvent,
  waitedMinutes,
} from '../src/worker/domain/walkin'
import { FIXED_NOW } from './helpers'

/** JST 2026年8月27日（木）11:08。台帳・顧客台帳と同じ基準時刻。 */
const NOW = new Date(FIXED_NOW)

/** JST の壁時計を UTC の ISO8601 に直す。`11:02` は `2026-08-27T02:02:00.000Z`。 */
function jst(time: string, date = '2026-08-27'): string {
  return new Date(Date.parse(`${date}T${time}:00.000Z`) - 9 * 60 * 60_000).toISOString()
}

/** `NOW` から見て `minutes` 分・`seconds` 秒前に受け付けた時刻。 */
function ago(minutes: number, seconds = 0): string {
  return new Date(NOW.getTime() - (minutes * 60 + seconds) * 1000).toISOString()
}

/** 工程の記録 1 行。ここで見るのは工程と発生時刻だけである。 */
const at = (stage: WalkinVisitEvent['stage'], time: string): WalkinVisitEvent => ({
  stage,
  occurredAt: jst(time),
})

describe('経過分', () => {
  it('受付ちょうどは 0 分', () => {
    expect(waitedMinutes(NOW.toISOString(), NOW)).toBe(0)
    expect(waitedMinutes(ago(0), NOW)).toBe(0)
  })

  it('59 秒は 0 分、60 秒で 1 分（切り捨て）', () => {
    expect(waitedMinutes(ago(0, 59), NOW)).toBe(0)
    expect(waitedMinutes(ago(1), NOW)).toBe(1)
    // 6分 59秒 はまだ「お待ち 6分」。繰り上げると受付が実際より長く待たせたことになる。
    expect(waitedMinutes(ago(6, 59), NOW)).toBe(6)
  })

  it('15 分ちょうどはお待たせ中でない', () => {
    expect(WAITING_TOO_LONG_MINUTES).toBe(15)
    expect(waitedMinutes(ago(15), NOW)).toBe(15)
    expect(isWaitingTooLong(ago(15), NOW)).toBe(false)
    expect(isWaitingTooLong(ago(14, 59), NOW)).toBe(false)
  })

  it('15 分 1 秒でお待たせ中になる', () => {
    expect(isWaitingTooLong(ago(15, 1), NOW)).toBe(true)
    // モックの ウォークイン 003（受付 10:50 / いま 11:08）は「お待たせ中 18分」。
    expect(waitedMinutes(jst('10:50'), NOW)).toBe(18)
    expect(isWaitingTooLong(jst('10:50'), NOW)).toBe(true)
  })

  it('受付時刻が未来でも負の分を返さず 0 に丸める', () => {
    // 端末の時計が進んでいる iPad から `arrivedAt` が来ることがある。
    // 「お待ち −3分」を台帳の帯に出さない。
    expect(waitedMinutes(new Date(NOW.getTime() + 3 * 60_000).toISOString(), NOW)).toBe(0)
    expect(isWaitingTooLong(new Date(NOW.getTime() + 60 * 60_000).toISOString(), NOW)).toBe(false)
  })
})

describe('来店日', () => {
  it('UTC の 2026-08-27T14:59:59.999Z は JST の 2026-08-27', () => {
    expect(jstVisitDate('2026-08-27T14:59:59.999Z')).toBe('2026-08-27')
    expect(jstVisitDate(FIXED_NOW)).toBe('2026-08-27')
  })

  it('UTC の 2026-08-27T15:00:00.000Z は JST の 2026-08-28', () => {
    expect(jstVisitDate('2026-08-27T15:00:00.000Z')).toBe('2026-08-28')
  })
})

describe('整理番号', () => {
  /** その店舗のその日の最大の整理番号。無ければ null。 */
  const maxOn = (rows: { arrivedAt: string; ticketNo: number }[], date: string): number | null => {
    const mine = rows.filter((row) => jstVisitDate(row.arrivedAt) === date)
    return mine.length === 0 ? null : Math.max(...mine.map((row) => row.ticketNo))
  }

  it('その日がまだ 0 件なら 1 から始まる', () => {
    expect(nextTicketNo(null)).toBe(1)
    expect(nextTicketNo(maxOn([], '2026-08-27'))).toBe(1)
  })

  it('その日の最大が 4 なら次は 5', () => {
    // モックの LEDGER-WALKIN は「004 まで済んでいる」ので次の札が「ウォークイン 005」。
    expect(nextTicketNo(4)).toBe(5)
  })

  it('JST の日が変わると 1 に戻る', () => {
    const rows = [
      { arrivedAt: jst('10:50'), ticketNo: 3 },
      { arrivedAt: jst('11:02'), ticketNo: 4 },
      // JST 8月28日 00:30（＝ UTC 8月27日 15:30）。UTC の日付で読むと 27日の 5 番になる。
      { arrivedAt: '2026-08-27T15:30:00.000Z', ticketNo: 1 },
    ]
    expect(nextTicketNo(maxOn(rows, '2026-08-27'))).toBe(5)
    expect(nextTicketNo(maxOn(rows, '2026-08-28'))).toBe(2)
    expect(nextTicketNo(maxOn(rows, '2026-08-29'))).toBe(1)
  })

  it('月をまたいでも日でリセットする（8月31日 → 9月1日）', () => {
    const rows = [
      { arrivedAt: jst('18:40', '2026-08-31'), ticketNo: 12 },
      { arrivedAt: jst('10:05', '2026-09-01'), ticketNo: 1 },
    ]
    expect(nextTicketNo(maxOn(rows, '2026-08-31'))).toBe(13)
    expect(nextTicketNo(maxOn(rows, '2026-09-01'))).toBe(2)
  })

  it('年とうるう年をまたいでも日でリセットする（2028-02-28 → 2028-02-29）', () => {
    const rows = [
      { arrivedAt: jst('16:00', '2027-12-31'), ticketNo: 7 },
      { arrivedAt: jst('10:00', '2028-01-01'), ticketNo: 1 },
      { arrivedAt: jst('19:30', '2028-02-28'), ticketNo: 9 },
      { arrivedAt: jst('10:00', '2028-02-29'), ticketNo: 1 },
    ]
    expect(nextTicketNo(maxOn(rows, '2027-12-31'))).toBe(8)
    expect(nextTicketNo(maxOn(rows, '2028-01-01'))).toBe(2)
    expect(nextTicketNo(maxOn(rows, '2028-02-28'))).toBe(10)
    expect(nextTicketNo(maxOn(rows, '2028-02-29'))).toBe(2)
  })

  it('999 の次は採番しない（1..999 の外へ出さない）', () => {
    expect(nextTicketNo(998)).toBe(999)
    // 打ち止めは 500 ではなく人を呼ぶ事象なので、throw ではなく null で返す。
    expect(nextTicketNo(999)).toBeNull()
    expect(nextTicketNo(1000)).toBeNull()
  })
})

describe('整理番号の衝突', () => {
  it('D1_ERROR: UNIQUE constraint failed: walk_ins.ticket_no から walk_ins を取り出す', () => {
    expect(
      constraintTable(new Error('D1_ERROR: UNIQUE constraint failed: walk_ins.ticket_no')),
    ).toBe('walk_ins')
    expect(
      constraintTable(
        new Error(
          'D1_ERROR: UNIQUE constraint failed: walk_ins.ticket_no: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
        ),
      ),
    ).toBe('walk_ins')
  })

  it('複合一意（walk_ins.organization_id, walk_ins.store_id, ...）でも walk_ins を取り出す', () => {
    // 整理番号の一意 index は 4 列。メッセージには `<表>.<列>` が 4 つ並ぶ。
    expect(
      constraintTable(
        new Error(
          'D1_ERROR: UNIQUE constraint failed: walk_ins.organization_id, walk_ins.store_id, walk_ins.visit_date, walk_ins.ticket_no: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
        ),
      ),
    ).toBe('walk_ins')
  })

  it('メッセージの前後に別の文字があっても取り出せる', () => {
    expect(
      constraintTable(
        new Error(
          'Error in batch statement 5: D1_ERROR: UNIQUE constraint failed: walk_ins.ticket_no at rpc.mjs:1:2',
        ),
      ),
    ).toBe('walk_ins')
    // 一意違反でない制約は今までどおり見ない（409 と 500 を取り違えない）。
    expect(
      constraintTable(
        new Error(
          'D1_ERROR: NOT NULL constraint failed: walk_ins.reservation_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)',
        ),
      ),
    ).toBeNull()
  })
})

describe('表示', () => {
  it('4 は「ウォークイン 004」、005 の次は「ウォークイン 006」', () => {
    expect(formatTicket(4)).toBe('ウォークイン 004')
    expect(formatTicket(1)).toBe('ウォークイン 001')
    expect(formatTicket(999)).toBe('ウォークイン 999')
    const next = nextTicketNo(5)
    expect(next).toBe(6)
    expect(formatTicket(next ?? 0)).toBe('ウォークイン 006')

    // お客様が分かるまでは整理番号、分かったらお名前。盤面も受付履歴も同じ規則で描く。
    expect(subjectDisplayName(null, 3)).toBe('ウォークイン 003')
    expect(subjectDisplayName('田中 花子', 3)).toBe('田中 花子 様')
    expect(subjectDisplayName('山口 真央', null)).toBe('山口 真央 様')
  })
})

describe('待ちきれずお帰り', () => {
  it('ご相談が始まる前に left になった来店だけを数える', () => {
    // 受付 10:50 → お待ち → 11:08 にお帰り。ご相談は 1 度も始まっていない。
    expect(
      isAbandonedWait([at('received', '10:50'), at('waiting', '10:50'), at('left', '11:08')]),
    ).toBe(true)
    // 受付だけ済ませてお帰りになった方も同じ。
    expect(isAbandonedWait([at('received', '10:50'), at('left', '11:08')])).toBe(true)
    // まだお帰りでない行は数えない（お待たせ中であって、待ちきれずではない）。
    expect(isAbandonedWait([at('received', '10:50'), at('waiting', '10:50')])).toBe(false)
    expect(isAbandonedWait([])).toBe(false)
  })

  it('接客を終えて退店した来店は母数に入れるが、待ちきれずには数えない', () => {
    const served: WalkinVisitEvent[] = [
      at('received', '10:42'),
      at('consulting', '10:52'),
      at('checkout', '11:01'),
      at('handover', '11:04'),
      at('left', '11:20'),
    ]
    // 退店した来店であることは変わらない（お待ち時間の母数から落とさない）。
    expect(served.some((event) => event.stage === 'left')).toBe(true)
    // それでも「待ちきれずお帰り」ではない。
    expect(isAbandonedWait(served)).toBe(false)
    // 視力測定だけで帰られた方も接客を受けている。
    expect(
      isAbandonedWait([at('received', '10:58'), at('measuring', '11:02'), at('left', '11:20')]),
    ).toBe(false)
  })
})
