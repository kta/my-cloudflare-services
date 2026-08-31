/**
 * 録音の「ちょうど」を固定する（`src/worker/domain/retention.ts`）。
 *
 * 録音は要配慮情報なので、**消しすぎと消し忘れの両方が事故**である。ここで見るのは 3 つ。
 *
 * 1. **最低保持期限** — `state='stored'` になった時刻から、成立予約（`reservation_id` 非 NULL）は
 *    **30 日 = 2,592,000 秒**、破棄受付は **24 時間 = 86,400 秒**（`03-data-model.md` §15）。
 * 2. **削除の可否** — 期限**ちょうどは消せない**。消せるのは +1 秒からである（AC-REC-11 / AC-REC-12）。
 *    保全（`legal_hold`）は期限より強く、外した瞬間から期限だけで決まる（AC-REC-13）。
 * 3. **動かない録音** — `recording` / `uploading` / `failed` のまま 24 時間が過ぎたら `failed` に
 *    落としてお知らせに上げる（`07-nfr.md` §11.2）。こちらも**ちょうどは落とさない**。
 *
 * **時刻はすべて引数で受ける。**`Date.now()` も `vi.useFakeTimers()` も 1 度も使わない。
 * 基準時刻は世界観データの **2026年8月27日（木）11:08 JST**（`FIXED_NOW`）。
 * 30 日を足すと月をまたぎ、うるう年の 2月28日 に録ったものは 3月29日 を指す — 暦の数え方が
 * ずれると、この 1 日ぶんだけ「消せるはずが消せない」録音が毎年 1 回できる。
 */
import { describe, expect, it } from 'vitest'
import {
  canDelete,
  isStaleUpload,
  retainUntilFor,
  staleUploadBefore,
} from '../src/worker/domain/retention'
import { FIXED_NOW } from './helpers'

/** 30 日。成立予約の最低保持期限（秒）。 */
const THIRTY_DAYS = 2_592_000
/** 24 時間。破棄受付の最低保持期限であり、動かない録音を落とす閾値でもある（秒）。 */
const ONE_DAY = 86_400

/** JST 2026年8月27日（木）11:08。台帳・顧客台帳と同じ基準時刻。 */
const STORED_AT = new Date(FIXED_NOW)

/** `iso` から `seconds` 秒あとの時刻。境界を「ちょうど」と「+1 秒」で書き分けるための道具。 */
function after(iso: string, seconds: number): Date {
  return new Date(Date.parse(iso) + seconds * 1000)
}

describe('retainUntilFor', () => {
  it('成立予約は stored になった時刻から 30 日後を返す', () => {
    const retainUntil = retainUntilFor({ hasReservation: true, storedAt: STORED_AT })
    expect(retainUntil.getTime() - STORED_AT.getTime()).toBe(THIRTY_DAYS * 1000)
    // 8月27日 + 30 日は 9月26日。月をまたいでも日数で数える（暦月で数えない）。
    expect(retainUntil.toISOString()).toBe('2026-09-26T02:08:00.000Z')
  })

  it('破棄受付は stored になった時刻から 24 時間後を返す', () => {
    const retainUntil = retainUntilFor({ hasReservation: false, storedAt: STORED_AT })
    expect(retainUntil.getTime() - STORED_AT.getTime()).toBe(ONE_DAY * 1000)
    expect(retainUntil.toISOString()).toBe('2026-08-28T02:08:00.000Z')

    // 月末の JST 深夜（UTC 8月31日 15:30 ＝ JST 9月1日 00:30）に保管したものも
    // 暦ではなく経過時間で決まる。
    const monthEnd = retainUntilFor({
      hasReservation: false,
      storedAt: new Date('2026-08-31T15:30:00.000Z'),
    })
    expect(monthEnd.toISOString()).toBe('2026-09-01T15:30:00.000Z')
  })

  it('うるう年の 2月28日 に録った成立予約は 3月29日 を指す', () => {
    // 2028年は うるう年。2月29日 がある ぶん、期限は 1 日手前に来る。
    const leap = retainUntilFor({
      hasReservation: true,
      storedAt: new Date('2028-02-28T02:08:00.000Z'),
    })
    expect(leap.toISOString()).toBe('2028-03-29T02:08:00.000Z')

    // うるう年でない 2027年は 3月30日。ここがずれると毎年 1 日ぶん取り違える。
    const common = retainUntilFor({
      hasReservation: true,
      storedAt: new Date('2027-02-28T02:08:00.000Z'),
    })
    expect(common.toISOString()).toBe('2027-03-30T02:08:00.000Z')
  })
})

describe('canDelete', () => {
  /** 成立予約の録音（30 日）。 */
  const RETAIN_BOOKED = retainUntilFor({ hasReservation: true, storedAt: STORED_AT }).toISOString()
  /** 破棄受付の録音（24 時間）。 */
  const RETAIN_DISCARDED = retainUntilFor({
    hasReservation: false,
    storedAt: STORED_AT,
  }).toISOString()

  it('成立予約の 30 日ちょうどは消せない', () => {
    expect(
      canDelete({
        state: 'stored',
        retainUntil: RETAIN_BOOKED,
        legalHold: false,
        now: new Date(RETAIN_BOOKED),
      }),
    ).toEqual({ ok: false, retainUntil: RETAIN_BOOKED, legalHold: false })

    // 1 秒手前も当然消せない。
    expect(
      canDelete({
        state: 'stored',
        retainUntil: RETAIN_BOOKED,
        legalHold: false,
        now: after(RETAIN_BOOKED, -1),
      }).ok,
    ).toBe(false)
  })

  it('成立予約の 30 日と 1 秒で消せる', () => {
    expect(
      canDelete({
        state: 'stored',
        retainUntil: RETAIN_BOOKED,
        legalHold: false,
        now: after(RETAIN_BOOKED, 1),
      }),
    ).toEqual({ ok: true })
  })

  it('破棄受付の 24 時間ちょうどは消せない', () => {
    expect(
      canDelete({
        state: 'stored',
        retainUntil: RETAIN_DISCARDED,
        legalHold: false,
        now: new Date(RETAIN_DISCARDED),
      }),
    ).toEqual({ ok: false, retainUntil: RETAIN_DISCARDED, legalHold: false })
  })

  it('破棄受付の 24 時間と 1 秒で消せる', () => {
    expect(
      canDelete({
        state: 'stored',
        retainUntil: RETAIN_DISCARDED,
        legalHold: false,
        now: after(RETAIN_DISCARDED, 1),
      }),
    ).toEqual({ ok: true })
  })

  it('保全が立っていれば期限を 1 年過ぎても消せない', () => {
    const wayPast = after(RETAIN_BOOKED, 365 * ONE_DAY)
    expect(
      canDelete({ state: 'stored', retainUntil: RETAIN_BOOKED, legalHold: true, now: wayPast }),
    ).toEqual({ ok: false, retainUntil: RETAIN_BOOKED, legalHold: true })

    // 期限の内側でも保全は保全である（`legalHold` を立てたまま返す）。
    expect(
      canDelete({
        state: 'stored',
        retainUntil: RETAIN_BOOKED,
        legalHold: true,
        now: STORED_AT,
      }),
    ).toEqual({ ok: false, retainUntil: RETAIN_BOOKED, legalHold: true })
  })

  it('保全を外した瞬間に、期限を過ぎているものは消せる', () => {
    const wayPast = after(RETAIN_BOOKED, 365 * ONE_DAY)
    expect(
      canDelete({ state: 'stored', retainUntil: RETAIN_BOOKED, legalHold: false, now: wayPast }),
    ).toEqual({ ok: true })
  })

  it("state='deleted' の録音は二度目の削除を受け付けない", () => {
    // 実体はもう無い。行だけが残っている状態で、R2 の delete を二度投げない。
    expect(
      canDelete({
        state: 'deleted',
        retainUntil: RETAIN_BOOKED,
        legalHold: false,
        now: after(RETAIN_BOOKED, 1),
      }),
    ).toEqual({ ok: false, retainUntil: RETAIN_BOOKED, legalHold: false })

    // まだ保管庫に入っていない録音（`retain_until` が NULL）も受け付けない。
    // 期限が決まっていないものを消せるようにすると、最低保持期限を素通りできてしまう。
    expect(
      canDelete({ state: 'uploading', retainUntil: null, legalHold: false, now: STORED_AT }),
    ).toEqual({ ok: false, retainUntil: null, legalHold: false })
  })
})

describe('isStaleUpload', () => {
  const CREATED_AT = FIXED_NOW

  it('recording のまま 24 時間ちょうどは落とさない', () => {
    expect(
      isStaleUpload({ state: 'recording', createdAt: CREATED_AT, now: after(CREATED_AT, ONE_DAY) }),
    ).toBe(false)
    expect(
      isStaleUpload({
        state: 'recording',
        createdAt: CREATED_AT,
        now: after(CREATED_AT, ONE_DAY - 1),
      }),
    ).toBe(false)
  })

  it('recording のまま 24 時間と 1 秒で failed に落とす', () => {
    expect(
      isStaleUpload({
        state: 'recording',
        createdAt: CREATED_AT,
        now: after(CREATED_AT, ONE_DAY + 1),
      }),
    ).toBe(true)
    // 送っている途中で止まった行も、端末で失敗し続けている行も同じ扱いである
    // （`07-nfr.md` §11.2 の `state IN ('recording','uploading','failed')`）。
    expect(
      isStaleUpload({
        state: 'uploading',
        createdAt: CREATED_AT,
        now: after(CREATED_AT, ONE_DAY + 1),
      }),
    ).toBe(true)
    expect(
      isStaleUpload({
        state: 'failed',
        createdAt: CREATED_AT,
        now: after(CREATED_AT, ONE_DAY + 1),
      }),
    ).toBe(true)
  })

  it('stored の行は何時間経っても落とさない', () => {
    expect(
      isStaleUpload({
        state: 'stored',
        createdAt: CREATED_AT,
        now: after(CREATED_AT, 365 * ONE_DAY),
      }),
    ).toBe(false)
    // 消したあとの行を掘り返してお知らせに上げ直さない。
    expect(
      isStaleUpload({
        state: 'deleted',
        createdAt: CREATED_AT,
        now: after(CREATED_AT, 365 * ONE_DAY),
      }),
    ).toBe(false)
  })
})

describe('staleUploadBefore', () => {
  it('D1 の絞り込みと isStaleUpload が同じ境界を指す（ちょうどは入らない）', () => {
    // 掃除は `created_at < staleUploadBefore(now)` で候補を引き、そのあと
    // `isStaleUpload()` でもう一度見る。2 つの境界がずれると、SQL が拾ったのに
    // 関数が落とさない行（毎晩 `limit` を食うだけの行）が静かに増える。
    const now = after(FIXED_NOW, 0)
    const boundary = staleUploadBefore(now)
    expect(Date.parse(now.toISOString()) - Date.parse(boundary)).toBe(ONE_DAY * 1000)

    const justOld = new Date(Date.parse(boundary) - 1000).toISOString()
    expect(justOld < boundary).toBe(true)
    expect(isStaleUpload({ state: 'recording', createdAt: justOld, now })).toBe(true)
    // 境目そのものは SQL の `<` に入らず、関数も落とさない（ちょうどは落とさない）。
    expect(isStaleUpload({ state: 'recording', createdAt: boundary, now })).toBe(false)
  })
})
