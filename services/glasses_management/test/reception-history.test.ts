/**
 * 受付履歴の絞り込みと 0 件の緩和候補（`src/worker/domain/reception-history.ts`）を固定する。
 *
 * 一覧の元は「その日にご来店予定の予約 ＋ その日のウォークイン」であって、
 * `reception_sessions` だけではない。スタッフが受け付けない Web のご予約
 * （相川 みどり 様・山口 真央 様）は受付セッションを持たないので、
 * セッションだけを読むとその行が一覧から丸ごと落ちる。
 *
 * 絞り込みの軸は 3 つとも「取り違えやすい方」がある。
 * 期間は**ご来店日**（受け付けた日ではない）、担当は**接客する担当**
 * （受け付けた人ではない。共有端末では NULL になる）、結果は画面の 3 語
 * （成立／取消／ご来店なし）を `ReservationStatus` へ落としたものである。
 *
 * 0 件の緩和候補は**実際にその条件で引いた件数**でなければならない。推定した件数を出すと、
 * 「12件」と書かれた操作を押して 0 件の画面に戻る（行き止まりを 1 つ増やす）。
 *
 * **時刻はすべて引数で受ける。**「今月」は `now` を JST に直して出す。基準時刻は
 * 世界観データの **2026年8月27日（木）11:08 JST**。
 */
import type { ReservationStatus } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  buildHistoryList,
  filterHistory,
  type ReceptionHistoryFilter,
  type ReceptionHistoryRow,
} from '../src/worker/domain/reception-history'
import { FIXED_NOW } from './helpers'

const id = () => crypto.randomUUID()

/** JST 2026年8月27日（木）11:08。 */
const NOW = new Date(FIXED_NOW)

/** JST の壁時計を UTC の ISO8601 に直す。 */
function jst(date: string, time: string): string {
  return new Date(Date.parse(`${date}T${time}:00.000Z`) - 9 * 60 * 60_000).toISOString()
}

const STAFF = { sato: id(), takahashi: id(), nakamura: id() }

/** 受付履歴の 1 行。読み出した 3 表（予約・ウォークイン・受付セッション）の突き合わせ結果。 */
function row(overrides: Partial<ReceptionHistoryRow> & { visitDate: string }): ReceptionHistoryRow {
  return {
    entryId: id(),
    sessionId: null,
    startedAt: jst(overrides.visitDate, '10:00'),
    receivedAt: jst(overrides.visitDate, '10:00'),
    customerName: null,
    customerKana: null,
    ticketNo: null,
    visitCount: null,
    staffIds: [],
    receivedByStaffId: null,
    outcome: null,
    reservationStatus: 'confirmed',
    ...overrides,
  }
}

/** 銀座店の 7 件。8月21日〜8月27日 に散らし、破棄した受付を 1 件混ぜてある。 */
const HANAKO = row({
  visitDate: '2026-08-27',
  // 8月20日（木）14:32 に 中村 彩 が電話で受け付けたご予約。ご来店は 8月27日である。
  startedAt: jst('2026-08-20', '14:32'),
  receivedAt: jst('2026-08-20', '14:32'),
  sessionId: id(),
  customerName: '田中 花子',
  customerKana: 'たなか はなこ',
  visitCount: 4,
  staffIds: [STAFF.sato],
  receivedByStaffId: STAFF.nakamura,
  outcome: 'booked',
  reservationStatus: 'confirmed',
})
const MAO = row({
  visitDate: '2026-08-27',
  startedAt: jst('2026-08-27', '10:58'),
  receivedAt: jst('2026-08-25', '21:14'),
  // Web のご予約なので受付セッションも受け付けた人も無い。
  sessionId: null,
  customerName: '山口 真央',
  customerKana: 'やまぐち まお',
  visitCount: 1,
  staffIds: [STAFF.takahashi],
  receivedByStaffId: null,
  reservationStatus: 'arrived',
})
const WALKIN = row({
  visitDate: '2026-08-27',
  startedAt: jst('2026-08-27', '10:50'),
  receivedAt: jst('2026-08-27', '10:50'),
  sessionId: id(),
  ticketNo: 3,
  staffIds: [STAFF.takahashi],
  receivedByStaffId: STAFF.takahashi,
  outcome: 'booked',
  reservationStatus: 'done',
})
const KEN = row({
  visitDate: '2026-08-26',
  startedAt: jst('2026-08-26', '13:00'),
  customerName: '伊藤 健',
  customerKana: 'いとう けん',
  visitCount: 2,
  staffIds: [STAFF.sato],
  reservationStatus: 'cancelled',
})
const MIDORI = row({
  visitDate: '2026-08-25',
  startedAt: jst('2026-08-25', '15:30'),
  customerName: '相川 みどり',
  customerKana: 'あいかわ みどり',
  staffIds: [STAFF.nakamura],
  reservationStatus: 'no_show',
})
const YUKI = row({
  visitDate: '2026-08-21',
  startedAt: jst('2026-08-21', '11:30'),
  customerName: '渡辺 由紀',
  customerKana: 'わたなべ ゆき',
  staffIds: [STAFF.sato],
  reservationStatus: 'serving',
})
/** 途中でやめた受付。予約を持たないので、開始した日の暦日で一覧に混ざる。 */
const DISCARDED = row({
  visitDate: '2026-08-24',
  startedAt: jst('2026-08-24', '16:05'),
  sessionId: id(),
  customerName: '小林 直樹',
  customerKana: 'こばやし なおき',
  receivedByStaffId: STAFF.sato,
  outcome: 'discarded',
  reservationStatus: null,
})

const ROWS: ReceptionHistoryRow[] = [HANAKO, MAO, WALKIN, KEN, MIDORI, YUKI, DISCARDED]

/** 画面の「結果」3 語を `ReservationStatus` へ落としたもの。契約に新しい語を足さない。 */
const OUTCOME_STATUS = {
  成立: ['confirmed', 'arrived', 'serving', 'done'],
  取消: ['cancelled'],
  ご来店なし: ['no_show'],
} satisfies Record<string, ReservationStatus[]>

/** 8月1日〜8月27日（今月）。 */
const THIS_MONTH: ReceptionHistoryFilter = { from: '2026-08-01', to: '2026-08-27' }

/** 一覧を 1 ページだけ引く。 */
const list = (filter: ReceptionHistoryFilter & { limit?: number; cursor?: string }, rows = ROWS) =>
  buildHistoryList(rows, { limit: 50, ...filter }, NOW)

/** 行の名前だけを取り出す。 */
const names = (rows: ReceptionHistoryRow[]) =>
  rows.map((entry) => entry.customerName ?? `ウォークイン ${entry.ticketNo}`)

describe('絞り込み', () => {
  it('期間はご来店日で絞る（受け付けた日ではない）', () => {
    // 田中 花子 様は 8月20日 に受け付けたが、ご来店は 8月27日 である。
    expect(names(filterHistory(ROWS, { from: '2026-08-20', to: '2026-08-21' }))).toEqual([
      '渡辺 由紀',
    ])
    expect(names(filterHistory(ROWS, { from: '2026-08-27', to: '2026-08-27' }))).toContain(
      '田中 花子',
    )
  })

  it('担当は接客する担当で絞る（受け付けた人ではない）', () => {
    // 田中 花子 様を受け付けたのは 中村 彩、接客するのは 佐藤 美咲。
    expect(names(filterHistory(ROWS, { ...THIS_MONTH, staffId: STAFF.nakamura }))).not.toContain(
      '田中 花子',
    )
    expect(names(filterHistory(ROWS, { ...THIS_MONTH, staffId: STAFF.sato }))).toContain(
      '田中 花子',
    )
  })

  it('受け付けた人が空の受付も担当の絞り込みで落ちない', () => {
    // 山口 真央 様は Web のご予約なので受け付けた人がいない（共有端末の受付も同じ）。
    expect(MAO.receivedByStaffId).toBeNull()
    expect(names(filterHistory(ROWS, { ...THIS_MONTH, staffId: STAFF.takahashi }))).toEqual([
      '山口 真央',
      'ウォークイン 3',
    ])
  })

  it('結果「ご来店なし」は no_show の予約だけを返す', () => {
    const found = filterHistory(ROWS, { ...THIS_MONTH, status: OUTCOME_STATUS.ご来店なし })
    expect(names(found)).toEqual(['相川 みどり'])
  })

  it('結果「取消」は cancelled の予約だけを返す', () => {
    const found = filterHistory(ROWS, { ...THIS_MONTH, status: OUTCOME_STATUS.取消 })
    expect(names(found)).toEqual(['伊藤 健'])
  })

  it('結果「成立」は confirmed / arrived / serving / done を返す', () => {
    const found = filterHistory(ROWS, { ...THIS_MONTH, status: OUTCOME_STATUS.成立 })
    expect(names(found).sort()).toEqual(
      ['田中 花子', '山口 真央', 'ウォークイン 3', '渡辺 由紀'].sort(),
    )
    // 予約を持たない破棄した受付は「成立」に混ざらない。
    expect(found).not.toContain(DISCARDED)
  })

  it('お客様名は姓・名・ふりがなの部分一致で絞る', () => {
    expect(names(filterHistory(ROWS, { ...THIS_MONTH, name: '田中' }))).toEqual(['田中 花子'])
    expect(names(filterHistory(ROWS, { ...THIS_MONTH, name: '花子' }))).toEqual(['田中 花子'])
    expect(names(filterHistory(ROWS, { ...THIS_MONTH, name: 'たなか' }))).toEqual(['田中 花子'])
    // 空白を打たずに探した操作も 0 件にしない。
    expect(names(filterHistory(ROWS, { ...THIS_MONTH, name: '田中花子' }))).toEqual(['田中 花子'])
    expect(filterHistory(ROWS, { ...THIS_MONTH, name: '存在しない' })).toEqual([])
  })

  it('お客様名の絞り込みは期間・担当・結果を保ったまま効く', () => {
    const kept = {
      ...THIS_MONTH,
      staffId: STAFF.sato,
      status: OUTCOME_STATUS.成立,
    } satisfies ReceptionHistoryFilter
    expect(names(filterHistory(ROWS, kept)).sort()).toEqual(['渡辺 由紀', '田中 花子'].sort())
    expect(names(filterHistory(ROWS, { ...kept, name: '田中' }))).toEqual(['田中 花子'])
    // 担当も結果も外れていない（伊藤 健 様は 佐藤 美咲 の取消なので出てこない）。
    expect(names(filterHistory(ROWS, { ...kept, name: '伊藤' }))).toEqual([])
  })

  it('破棄した受付は予約を持たないまま、開始日の暦日で一覧に混ざる', () => {
    const found = filterHistory(ROWS, { from: '2026-08-24', to: '2026-08-24' })
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      outcome: 'discarded',
      reservationStatus: null,
      visitDate: '2026-08-24',
    })
    // 結果で絞ると予約を持たない行は落ちる（状態を持たないものに札を付けない）。
    expect(
      filterHistory(ROWS, { from: '2026-08-24', to: '2026-08-24', status: OUTCOME_STATUS.成立 }),
    ).toEqual([])
  })
})

describe('並びと読み足し', () => {
  /** 同じ時刻の 2 件を挟んだ 5 件。複合カーソルでないと 2 ページ目で取りこぼす。 */
  const SAME = jst('2026-08-26', '13:00')
  const PAGED: ReceptionHistoryRow[] = [
    row({ visitDate: '2026-08-27', entryId: 'e1', startedAt: jst('2026-08-27', '11:00') }),
    row({ visitDate: '2026-08-27', entryId: 'e2', startedAt: jst('2026-08-27', '10:00') }),
    row({ visitDate: '2026-08-26', entryId: 'e3', startedAt: SAME }),
    row({ visitDate: '2026-08-26', entryId: 'e4', startedAt: SAME }),
    row({ visitDate: '2026-08-25', entryId: 'e5', startedAt: jst('2026-08-25', '09:00') }),
  ]
  const ids = (view: { items: { entryId: string }[] }) => view.items.map((item) => item.entryId)

  it('新しい順に limit 件まで返し、nextCursor で続きを返す', () => {
    const first = list({ ...THIS_MONTH, limit: 2 }, PAGED)
    expect(ids(first)).toEqual(['e1', 'e2'])
    expect(first.nextCursor).not.toBeNull()

    const second = list({ ...THIS_MONTH, limit: 2, cursor: first.nextCursor ?? '' }, PAGED)
    expect(ids(second)).toEqual(['e4', 'e3'])
  })

  it('同じ時刻の行が二重にも欠けにもならない（複合カーソル）', () => {
    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 5; page += 1) {
      const view: ReturnType<typeof list> = list(
        { ...THIS_MONTH, limit: 2, ...(cursor === null ? {} : { cursor }) },
        PAGED,
      )
      seen.push(...ids(view))
      cursor = view.nextCursor
      if (cursor === null) break
    }
    expect(seen).toEqual(['e1', 'e2', 'e4', 'e3', 'e5'])
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('total は絞り込んだ総件数で、読み足しても変わらない', () => {
    const first = list({ ...THIS_MONTH, limit: 2 }, PAGED)
    expect(first.total).toBe(5)
    const second = list({ ...THIS_MONTH, limit: 2, cursor: first.nextCursor ?? '' }, PAGED)
    expect(second.total).toBe(5)
    // 絞り込むと総件数も一緒に減る（一覧の見出しの数と一致させる）。
    expect(list({ from: '2026-08-26', to: '2026-08-27', limit: 2 }, PAGED).total).toBe(4)
  })

  it('最後のページの nextCursor は null', () => {
    expect(list({ ...THIS_MONTH, limit: 50 }, PAGED).nextCursor).toBeNull()
    const last = list({ ...THIS_MONTH, limit: 4 }, PAGED)
    expect(last.items).toHaveLength(4)
    expect(last.nextCursor).not.toBeNull()
    const tail = list({ ...THIS_MONTH, limit: 4, cursor: last.nextCursor ?? '' }, PAGED)
    expect(ids(tail)).toEqual(['e5'])
    expect(tail.nextCursor).toBeNull()
  })
})

describe('0 件の緩和候補', () => {
  /** 8月25日〜8月26日 に 高橋 拓也 の接客は 1 件も無い。 */
  const EMPTY: ReceptionHistoryFilter = {
    from: '2026-08-25',
    to: '2026-08-26',
    staffId: STAFF.takahashi,
  }

  it('0 件のときだけ relaxations を返す', () => {
    expect(list(THIS_MONTH).total).toBe(7)
    expect(list(THIS_MONTH).relaxations).toEqual([])
    const empty = list(EMPTY)
    expect(empty.total).toBe(0)
    expect(empty.relaxations.length).toBeGreaterThan(0)
  })

  it('期間を今月まで広げた件数が、実際にその条件で引いた件数と一致する', () => {
    const found = list(EMPTY).relaxations.find((item) => item.label.includes('期間'))
    expect(found?.label).toBe('期間を「今月（8月1日 〜 8月27日）」まで広げる')
    expect(found?.count).toBe(
      filterHistory(ROWS, { ...THIS_MONTH, staffId: STAFF.takahashi }).length,
    )
    expect(found?.count).toBe(2)
  })

  it('担当を外した件数が、実際にその条件で引いた件数と一致する', () => {
    const found = list(EMPTY).relaxations.find((item) => item.label.includes('担当'))
    expect(found?.label).toBe('担当の絞り込みを外す')
    expect(found?.count).toBe(filterHistory(ROWS, { from: EMPTY.from, to: EMPTY.to }).length)
    expect(found?.count).toBe(2)
  })

  it('全解除の件数が絞り込みなしの総件数と一致する', () => {
    const found = list(EMPTY).relaxations.find((item) => item.label === '絞り込みをすべて外す')
    expect(found?.count).toBe(filterHistory(ROWS, THIS_MONTH).length)
    expect(found?.count).toBe(7)
  })

  it('件数 0 の候補を出さない', () => {
    // 「存在しない」を名前に入れると、期間を広げても 0 件のままである。
    const view = list({ from: '2026-08-25', to: '2026-08-26', name: '存在しない' })
    expect(view.total).toBe(0)
    expect(view.relaxations.map((item) => item.label)).toEqual([
      'お客様名の絞り込みを外す',
      '絞り込みをすべて外す',
    ])
    for (const item of view.relaxations) expect(item.count).toBeGreaterThan(0)
  })

  it('候補は多くても 3 件', () => {
    // 4 つの条件それぞれを 1 つだけ外すと 1 件ずつ見つかる形を作る。
    const four: ReceptionHistoryRow[] = [
      row({ visitDate: '2026-08-26', customerName: '田中 花子', staffIds: [STAFF.sato] }),
      row({
        visitDate: '2026-08-26',
        customerName: '伊藤 健',
        staffIds: [STAFF.sato],
        reservationStatus: 'cancelled',
      }),
      row({ visitDate: '2026-08-26', customerName: '伊藤 健', staffIds: [STAFF.nakamura] }),
      row({ visitDate: '2026-08-20', customerName: '伊藤 健', staffIds: [STAFF.sato] }),
    ]
    const view = list(
      {
        from: '2026-08-26',
        to: '2026-08-26',
        staffId: STAFF.sato,
        status: OUTCOME_STATUS.成立,
        name: '伊藤',
      },
      four,
    )
    expect(view.total).toBe(0)
    expect(view.relaxations).toHaveLength(3)
    // 溢れても「絞り込みをすべて外す」は必ず残す（AC-RECEP-18 の主操作である）。
    expect(view.relaxations.map((item) => item.label)).toEqual([
      '期間を「今月（8月1日 〜 8月27日）」まで広げる',
      '担当の絞り込みを外す',
      '絞り込みをすべて外す',
    ])
  })

  it('緩められる条件が 1 つも無いときは候補を返さない', () => {
    // 期間は既に今月そのもので、担当も結果も名前も付いていない。
    const july: ReceptionHistoryRow[] = [row({ visitDate: '2026-07-15' })]
    const view = list(THIS_MONTH, july)
    expect(view.total).toBe(0)
    expect(view.relaxations).toEqual([])
  })

  it('全解除しても 0 件のときは候補を返さない', () => {
    const view = list({ ...EMPTY, staffId: STAFF.sato }, [])
    expect(view.total).toBe(0)
    expect(view.relaxations).toEqual([])
  })

  it('候補の query はそのまま再送できる形になっている', () => {
    const allowed = new Set(['from', 'to', 'staffId', 'status', 'name'])
    for (const item of list(EMPTY).relaxations) {
      expect(Object.keys(item.query).every((key) => allowed.has(key))).toBe(true)
      expect(item.query.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(item.query.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // 押す前に見えている件数と、押したあとに出る件数が一致する。
      expect(filterHistory(ROWS, item.query as unknown as ReceptionHistoryFilter)).toHaveLength(
        item.count,
      )
    }
  })
})
