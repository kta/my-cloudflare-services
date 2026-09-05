/**
 * ご予約を探すドメイン（`src/worker/domain/reservation-search.ts`）を固定する。
 *
 * ここで見るのは**純関数だけ**である。D1 にも実時刻にも触れず、条件の解決は
 * 「組み立てた SQL の断片」を、当たり判定は「読み出した行」をそのまま見る。
 * どちらも同じ条件を読むので、**緩和候補に出した件数と押したあとの件数が食い違わない**。
 *
 * 盤面はモック CHANGE-SEARCH / EX-EMPTY-SEARCH の 8月27日（木）銀座店。
 * 田中 花子 様（たなか はなこ / 090-1234-5678 / 11:00 メガネを新しく作る）と
 * 田中 一郎 様（下 4 桁だけが違い、共通するのは先頭 7 桁）。
 *
 * **電話番号の引き方は 2 本立てである。**下 4 桁ちょうどは `phone_last4` の完全一致、
 * 5 桁以上は `phone_normalized` の前方一致で、後方一致（前にワイルドカードを置く形）は
 * B-tree が効かず顧客表の全走査になるので 1 つも作らせない。
 *
 * JST の日跨ぎ・月末・うるう年と、期間を広げる案の幅は
 * `reservation-change.time.test.ts` に分けてある。
 */
import { describe, expect, it } from 'vitest'
import {
  filterReservations,
  type ReservationSearchInput,
  type ReservationSearchRow,
  relaxationsFor,
  resolveSearch,
} from '../src/worker/domain/reservation-search'

const ORG = 'org-eye'
const GINZA = 'store-ginza'

/** 選択中店舗だけを見る、いちばん素の条件。 */
function base(over: Partial<ReservationSearchInput> = {}): ReservationSearchInput {
  return { organizationId: ORG, storeId: GINZA, ...over }
}

function row(over: Partial<ReservationSearchRow> = {}): ReservationSearchRow {
  return {
    id: 'r-hanako',
    code: 'EY-2608-0142',
    storeId: GINZA,
    source: 'phone',
    status: 'confirmed',
    startsAt: '2026-08-27T02:00:00.000Z',
    durationMinutes: 60,
    customerName: '田中 花子',
    customerKana: 'たなか はなこ',
    phoneNormalized: '09012345678',
    phoneLast4: '5678',
    visitCount: 4,
    purposeLabel: 'メガネを新しく作る',
    staffName: '佐藤 美咲',
    staffIds: ['staff-sato'],
    webBookingCode: null,
    ...over,
  }
}

const HANAKO = row()
const ICHIRO = row({
  id: 'r-ichiro',
  code: 'EY-2608-0143',
  startsAt: '2026-08-27T03:00:00.000Z',
  customerName: '田中 一郎',
  customerKana: 'たなか いちろう',
  phoneNormalized: '09012349912',
  phoneLast4: '9912',
  visitCount: 1,
  staffName: null,
  staffIds: [],
})
const SUZUKI = row({
  id: 'r-suzuki',
  code: 'EY-2608-0144',
  customerName: '鈴木 太郎',
  customerKana: 'すずき たろう',
  phoneNormalized: '08055556666',
  phoneLast4: '6666',
  startsAt: '2026-08-27T04:00:00.000Z',
})

/** 断片をつないだ 1 本の文字列。SQL の形を見るときはこれを読む。 */
function sqlOf(input: ReservationSearchInput): string {
  return resolveSearch(input)
    .where.map((condition) => condition.sql)
    .join(' AND ')
}

describe('条件の解決', () => {
  it('お名前は部分一致で当たる（「田中」で 田中 花子 が出る）', () => {
    const found = filterReservations([HANAKO, SUZUKI], base({ name: '田中' }))
    expect(found.map((item) => item.customerName)).toEqual(['田中 花子'])
  })

  it('かなで入れても漢字で登録されたお客様が出る（「たなか はなこ」→ 田中 花子）', () => {
    const found = filterReservations([HANAKO, SUZUKI], base({ name: 'たなか はなこ' }))
    expect(found.map((item) => item.customerName)).toEqual(['田中 花子'])
    // 名前の欄はお名前とふりがなの両方に当てる（画面に かな 専用の欄は無い）。
    expect(sqlOf(base({ name: 'たなか はなこ' }))).toContain('c.kana LIKE ?')
  })

  it('お電話番号は下 4 桁なら phone_last4 の完全一致になる', () => {
    const resolved = resolveSearch(base({ phone: '5678' }))
    const phone = resolved.where.find((condition) => condition.sql.includes('phone_last4'))
    expect(phone?.sql).toBe('c.phone_last4 = ?')
    expect(phone?.params).toEqual(['5678'])
    expect(filterReservations([HANAKO, ICHIRO], base({ phone: '5678' }))).toEqual([HANAKO])
  })

  it('お電話番号が 5 桁以上なら phone_normalized の前方一致になる', () => {
    const resolved = resolveSearch(base({ phone: '090-1234' }))
    const phone = resolved.where.find((condition) => condition.sql.includes('phone_normalized'))
    expect(phone?.sql).toContain('c.phone_normalized LIKE ?')
    expect(phone?.params).toEqual(['0901234%'])
    expect(filterReservations([HANAKO, ICHIRO, SUZUKI], base({ phone: '090-1234' }))).toEqual([
      HANAKO,
      ICHIRO,
    ])
  })

  it("後方一致（LIKE '%' || ?）を組み立てない", () => {
    const resolved = resolveSearch(base({ name: '田中', phone: '090-1234', kana: 'たなか' }))
    for (const condition of resolved.where) {
      // 値の側で組み立てるので、SQL に連結そのものが現れない。
      expect(condition.sql).not.toMatch(/'%'\s*\|\|/)
      if (!condition.sql.includes('phone')) continue
      for (const param of condition.params) {
        expect(String(param).startsWith('%')).toBe(false)
      }
    }
  })

  it('予約番号は 1 件に絞り、ほかの条件を無視しない', () => {
    const resolved = resolveSearch(base({ code: 'EY-2608-0142', name: '田中' }))
    expect(resolved.codeTarget).toBe('reservations')
    expect(sqlOf(base({ code: 'EY-2608-0142', name: '田中' }))).toContain('r.code = ?')
    expect(sqlOf(base({ code: 'EY-2608-0142', name: '田中' }))).toContain('c.name LIKE ?')
    expect(filterReservations([HANAKO, ICHIRO], base({ code: 'EY-2608-0142' }))).toEqual([HANAKO])
  })

  it('EY-W- で始まる番号は web_bookings の公開番号として引く', () => {
    const resolved = resolveSearch(base({ code: 'EY-W-2608-0031' }))
    expect(resolved.codeTarget).toBe('web_bookings')
    const code = resolved.where.find((condition) => condition.sql.includes('code'))
    expect(code?.sql).toBe('w.public_code = ?')
    expect(code?.params).toEqual(['EY-W-2608-0031'])
  })
})

describe('店舗の境界', () => {
  it('選択中店舗の条件を必ず付ける（storeId を外した問い合わせを作れない）', () => {
    const resolved = resolveSearch(base({ name: '田中' }))
    expect(resolved.where[0]).toEqual({ sql: 'r.organization_id = ?', params: [ORG] })
    expect(resolved.where[1]).toEqual({ sql: 'r.store_id = ?', params: [GINZA] })
    expect(resolved.params.slice(0, 2)).toEqual([ORG, GINZA])
    // 別店舗の同じお名前は当たらない（AC-CHANGE-05）。
    const marunouchi = row({ id: 'r-maru', storeId: 'store-marunouchi' })
    expect(filterReservations([HANAKO, marunouchi], base({ name: '田中' }))).toEqual([HANAKO])
  })
})

describe('期間', () => {
  it('from / to は JST の暦日を UTC の半開区間 [from 00:00, to+1 日 00:00) に直す', () => {
    const resolved = resolveSearch(base({ from: '2026-08-27', to: '2026-08-27' }))
    expect(resolved.range).toEqual({
      fromIso: '2026-08-26T15:00:00.000Z',
      toIso: '2026-08-27T15:00:00.000Z',
    })
    const span = resolved.where.find((condition) => condition.sql.includes('starts_at'))
    expect(span?.sql).toBe('r.starts_at >= ? AND r.starts_at < ?')
    expect(span?.params).toEqual(['2026-08-26T15:00:00.000Z', '2026-08-27T15:00:00.000Z'])
  })
})

describe('出どころ', () => {
  it('source を渡すとその出どころのご予約だけが並ぶ', () => {
    const web = row({ id: 'r-web', source: 'web', webBookingCode: 'EY-W-2608-0031' })
    const query = base({ source: ['web'] })
    expect(filterReservations([HANAKO, web], query)).toEqual([web])
    expect(sqlOf(query)).toContain('r.source IN (?)')
  })

  it('出どころの並びが空なら、どの行にも当たらない', () => {
    // `EY-W-` の番号（Web にしか無い）に「お電話でのご予約だけ」が重なるとここへ来る。
    // 空を「絞らない」と読むと、その番号を持たないお電話のご予約が当たってしまう。
    const query = base({ source: [] })
    expect(sqlOf(query)).toContain('1 = 0')
    expect(filterReservations([HANAKO, ICHIRO], query)).toEqual([])
  })

  it('欄そのものが無ければ出どころで絞らない', () => {
    expect(sqlOf(base())).not.toContain('r.source')
    expect(filterReservations([HANAKO], base())).toEqual([HANAKO])
  })
})

describe('状態', () => {
  it('includeCancelled が false なら cancelled と no_show を外す', () => {
    const cancelled = row({ id: 'r-cancelled', status: 'cancelled' })
    const noShow = row({ id: 'r-noshow', status: 'no_show' })
    const query = base({ name: '田中', includeCancelled: false })
    expect(filterReservations([HANAKO, cancelled, noShow], query)).toEqual([HANAKO])
    expect(sqlOf(query)).toContain("r.status NOT IN ('cancelled', 'no_show')")
  })

  it('status を名指しすると、その状態のご予約だけが並ぶ', () => {
    // 名指しは `includeCancelled` より強い（「取消済み」だけを見たい絞り込みがある）。
    const cancelled = row({ id: 'r-cancelled', status: 'cancelled' })
    const done = row({ id: 'r-done', status: 'done', startsAt: '2026-08-27T05:00:00.000Z' })
    const query = base({ status: ['cancelled'] })
    expect(filterReservations([HANAKO, cancelled, done], query)).toEqual([cancelled])
    expect(sqlOf(query)).toContain('r.status IN (?)')
    expect(sqlOf(query)).not.toContain('r.status NOT IN')
  })

  it('includeCancelled が true なら取り消されたご予約も並ぶ', () => {
    const cancelled = row({
      id: 'r-cancelled',
      status: 'cancelled',
      startsAt: '2026-08-27T06:00:00.000Z',
    })
    const query = base({ name: '田中', includeCancelled: true })
    expect(filterReservations([HANAKO, cancelled], query)).toEqual([HANAKO, cancelled])
    expect(sqlOf(query)).not.toContain('r.status NOT IN')
  })
})

describe('並び順', () => {
  it('開始時刻の昇順で、同時刻はお客様名の昇順で安定する', () => {
    const later = row({ id: 'r-later', startsAt: '2026-08-27T05:00:00.000Z' })
    const sameTimeA = row({ id: 'r-a', customerName: '佐藤 実' })
    const sameTimeZ = row({ id: 'r-z', customerName: '田中 花子' })
    const sorted = filterReservations([later, sameTimeZ, sameTimeA], base())
    expect(sorted.map((item) => item.id)).toEqual(['r-a', 'r-z', 'r-later'])
    expect(resolveSearch(base()).orderBy).toBe('r.starts_at ASC, c.name ASC, r.id ASC')
  })

  it('同じ時刻・同じお名前でも id で 1 通りに決まる（読み込むたびに並びが変わらない）', () => {
    const first = row({ id: 'r-aaa' })
    const second = row({ id: 'r-bbb' })
    expect(filterReservations([second, first], base()).map((item) => item.id)).toEqual([
      'r-aaa',
      'r-bbb',
    ])
    // お名前の無いご予約（ウォークインの前身）が混ざっても落ちない。
    const nameless = row({ id: 'r-000', customerName: null })
    expect(filterReservations([first, nameless], base()).map((item) => item.id)).toEqual([
      'r-000',
      'r-aaa',
    ])
  })
})

describe('緩和候補', () => {
  /** EX-EMPTY-SEARCH の条件（かなのお名前 ＋ 8/27〜8/31 ＋ Web予約だけ）。 */
  const empty = {
    name: 'たなか はなこ',
    from: '2026-08-27',
    to: '2026-08-31',
    source: ['web'] as const,
    includeCancelled: false,
  }

  it('結果が 1 件以上あるときは候補を作らない', () => {
    expect(relaxationsFor(empty, { total: 4, period: 3, source: 5, cancelled: 1 })).toEqual([])
  })

  it('期間を外す案は「期間を 8月1日 〜 9月30日 に広げる」になる（from の月初〜to の翌月末）', () => {
    const found = relaxationsFor(empty, { total: 0, period: 3 })
    expect(found[0]?.label).toBe('期間を 8月1日 〜 9月30日 に広げる')
    expect(found[0]?.count).toBe(3)
    expect(found[0]?.query).toMatchObject({ from: '2026-08-01', to: '2026-09-30' })
  })

  it('出どころを外す案は「「Web予約だけ」を外す」になる', () => {
    const found = relaxationsFor(empty, { total: 0, source: 5 })
    expect(found[0]?.label).toBe('「Web予約だけ」を外す')
    expect(found[0]?.count).toBe(5)
    expect(found[0]?.query).not.toHaveProperty('source')
  })

  it('取消を含める案は「取り消されたご予約も含める」になる', () => {
    const found = relaxationsFor(empty, { total: 0, cancelled: 1 })
    expect(found[0]?.label).toBe('取り消されたご予約も含める')
    expect(found[0]?.query).toMatchObject({ includeCancelled: true })
  })

  it('件数が 0 の案は候補に載せない', () => {
    const found = relaxationsFor(empty, { total: 0, period: 0, source: 5, cancelled: 0 })
    expect(found.map((item) => item.label)).toEqual(['「Web予約だけ」を外す'])
  })

  it('候補は最大 3 件で、件数の多い順に並ぶ', () => {
    const found = relaxationsFor(empty, { total: 0, period: 3, source: 5, cancelled: 1 })
    expect(found.map((item) => item.count)).toEqual([5, 3, 1])
    expect(found).toHaveLength(3)
  })

  it('外した条件以外は元のクエリのまま残る', () => {
    const found = relaxationsFor(empty, { total: 0, source: 5 })
    expect(found[0]?.query).toEqual({
      name: 'たなか はなこ',
      from: '2026-08-27',
      to: '2026-08-31',
      includeCancelled: false,
    })
  })
})
