/**
 * 顧客台帳のドメイン（`src/worker/domain/customers.ts`）の振る舞いを固定する。
 *
 * ここで見るのは**純関数だけ**である。D1 にも R2 にも実時刻にも触れない。
 * 来店回数と「最後のご来店」だけは時刻を引数で受ける関数なので、
 * JST の日跨ぎ・月末・うるう年と一緒に `customers.time.test.ts` に分けてある。
 *
 * 盤面はモック CUSTOMER-LIST / BOOK-04b-CUSTOMER-MATCH / CUSTOMER-MERGE の
 * 田中 花子 様（G-01842 / 090-1234-5678 / ご来店 4回 / 2026年5月12日）と
 * 田中 一郎 様（090-1234-9912。下 4 桁が違い、共通するのは先頭 7 桁だけ）。
 *
 * **電話番号の引き方は 2 本立てである。**台帳は下 4 桁の完全一致（`phone_last4`）、
 * 予約の工程は正規化した番号の前方一致（`phone_normalized`）で、同じ番号でも
 * 拾える相手が違う。後方一致（`LIKE '%' || ?`）は B-tree が効かず顧客表の
 * 全走査になるので、電話番号の列にはそのパターンを 1 つも作らせない。
 */
import { CustomerSummary } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  acceptHandwriting,
  acceptSheet,
  applyMerge,
  type CustomerRow,
  decodeCursor,
  encodeCursor,
  filterCustomers,
  HANDWRITING_MAX_SHEETS,
  last4,
  lookupFilter,
  type MergeCustomer,
  mergePreview,
  normalizePhone,
  pageCustomers,
  type ResolvedMergeField,
  rankCandidates,
  sanitizeSvg,
  searchFilter,
  searchMode,
  toCustomerSummary,
} from '../src/worker/domain/customers'

/* --- 盤面 ---------------------------------------------------------------- */

/** 台帳の 1 行。`customers` の読み出しに要る列だけを持つ。 */
function customer(over: Partial<CustomerRow> & Pick<CustomerRow, 'id' | 'name'>): CustomerRow {
  return {
    customerNumber: 'G-00001',
    kana: '',
    phoneNormalized: null,
    phoneLast4: null,
    address: null,
    memo: '',
    visitCount: 0,
    lastVisitAt: null,
    mergedIntoId: null,
    ...over,
  }
}

/** 田中 花子 様。CUSTOMER-LIST の選択行で、CUSTOMER-MERGE の残す側でもある。 */
const HANAKO = customer({
  id: '11111111-1111-4111-8111-111111111111',
  customerNumber: 'G-01842',
  name: '田中 花子',
  kana: 'たなか はなこ',
  phoneNormalized: '09012345678',
  phoneLast4: '5678',
  address: '東京都中央区銀座 1-2-3',
  memo: 'PC作業用・鼻パッド低め',
  visitCount: 4,
  lastVisitAt: '2026-05-12',
})

/** 田中 一郎 様。下 4 桁は違い、共通するのは先頭 7 桁（`0901234`）だけ。 */
const ICHIRO = customer({
  id: '33333333-3333-4333-8333-333333333333',
  customerNumber: 'G-02044',
  name: '田中 一郎',
  kana: 'たなか いちろう',
  phoneNormalized: '09012349912',
  phoneLast4: '9912',
  visitCount: 1,
  lastVisitAt: '2026-02-14',
})

/** 川上 恵 様。お電話番号のご登録が無く、ご来店も 0 件。 */
const MEGUMI = customer({
  id: '44444444-4444-4444-8444-444444444444',
  customerNumber: 'G-02155',
  name: '川上 恵',
  kana: 'かわかみ めぐみ',
  memo: 'お子様の分もご一緒に',
})

const LEDGER = [HANAKO, ICHIRO, MEGUMI]

/* --- 電話番号の正規化 ----------------------------------------------------- */

describe('電話番号の正規化', () => {
  it('ハイフンと半角空白と全角空白を落として数字だけにする', () => {
    expect(normalizePhone('090-1234-5678')).toBe('09012345678')
    expect(normalizePhone('090 1234 5678')).toBe('09012345678')
    expect(normalizePhone('090　1234　5678')).toBe('09012345678')
    expect(normalizePhone(' 03-1234-5678 ')).toBe('0312345678')
  })

  it('全角の数字（０９０）を半角にする', () => {
    expect(normalizePhone('０９０-1234-5678')).toBe('09012345678')
    expect(normalizePhone('０９０－１２３４－５６７８')).toBe('09012345678')
  })

  it('10 桁と 11 桁だけを番号として通し、9 桁と 12 桁は番号にしない', () => {
    expect(normalizePhone('0312345678')).toBe('0312345678')
    expect(normalizePhone('09012345678')).toBe('09012345678')
    expect(normalizePhone('031234567')).toBeNull()
    expect(normalizePhone('090123456789')).toBeNull()
  })

  it('先頭が 0 でない 11 桁は番号にしない', () => {
    expect(normalizePhone('81901234567')).toBeNull()
    expect(normalizePhone('+81-90-1234-5678')).toBeNull()
  })
})

/* --- 台帳の検索（下 4 桁の完全一致） --------------------------------------- */

describe('台帳の検索', () => {
  it('下 4 桁ちょうどの「5678」は phone_last4 の完全一致で引く', () => {
    expect(searchMode('5678')).toEqual({ kind: 'phoneLast4', value: '5678' })
    expect(searchFilter('5678')).toEqual({ column: 'phone_last4', op: 'eq', value: '5678' })
    expect(filterCustomers(LEDGER, searchFilter('5678'))).toEqual([HANAKO])
    expect(last4('09012345678')).toBe('5678')
  })

  it('番号の途中の 4 桁「1234」では 090-1234-5678 が引けない', () => {
    expect(searchMode('1234')).toEqual({ kind: 'phoneLast4', value: '1234' })
    expect(filterCustomers(LEDGER, searchFilter('1234'))).toEqual([])
  })

  it('3 桁の「678」は番号ではなくお名前として扱う', () => {
    expect(searchMode('678')).toEqual({ kind: 'name', value: '678' })
    expect(searchMode('56789')).toEqual({ kind: 'name', value: '56789' })
    expect(searchFilter('678')?.column).toBe('name_kana')
  })

  it("後方一致（LIKE '%' で始まる形）の SQL を組み立てない", () => {
    const phoneColumns = ['phone_last4', 'phone_normalized']
    for (const query of ['5678', '9912', '09012345678', '090-1234-5678']) {
      const filter = searchFilter(query)
      const lookup = lookupFilter(query)
      for (const built of [filter, lookup]) {
        if (built === null) continue
        // 電話番号の列に当てるのは完全一致か前方一致だけ。`%` で始まるパターンを作らない。
        if (phoneColumns.includes(built.column)) {
          expect(built.op).not.toBe('contains')
          if ('pattern' in built) expect(built.pattern.startsWith('%')).toBe(false)
        }
        // お名前の部分一致は index を持たない列にだけ当てる。
        if (built.op === 'contains') expect(phoneColumns).not.toContain(built.column)
      }
    }
  })
})

/* --- 工程の候補（正規化した番号の前方一致） -------------------------------- */

describe('工程の候補', () => {
  it('11 桁を打ち終えると phone_normalized の前方一致で引く', () => {
    expect(lookupFilter('090-1234-5678')).toEqual({
      column: 'phone_normalized',
      op: 'prefix',
      value: '0901234',
      pattern: '0901234%',
    })
    expect(lookupFilter('031234')).toBeNull()
  })

  it('先頭 7 桁だけ一致する 090-1234-9912 も拾う', () => {
    const found = filterCustomers(LEDGER, lookupFilter('090-1234-5678'))
    expect(found.map((row) => row.name)).toEqual(['田中 花子', '田中 一郎'])
  })
})

/* --- お名前とふりがなの検索 ----------------------------------------------- */

describe('名前の検索', () => {
  it('ふりがな「たなか」で「たなか はなこ」が残る', () => {
    const found = filterCustomers(LEDGER, searchFilter('たなか'))
    expect(found.map((row) => row.kana)).toEqual(['たなか はなこ', 'たなか いちろう'])
  })

  it('名前の一部「花子」で「田中 花子」が残る', () => {
    expect(filterCustomers(LEDGER, searchFilter('花子'))).toEqual([HANAKO])
    expect(filterCustomers(LEDGER, searchFilter('田中 花子'))).toEqual([HANAKO])
  })
})

/* --- おまとめで残さない側 ------------------------------------------------- */

describe('まとめられた行', () => {
  it('merged_into_id が入った行は検索からも一覧からも外れる', () => {
    const merged = customer({
      ...ICHIRO,
      id: '55555555-5555-4555-8555-555555555555',
      customerNumber: 'G-02310',
      name: '田中 花子',
      kana: 'たなか はなこ',
      phoneNormalized: '09012345678',
      phoneLast4: '5678',
      mergedIntoId: HANAKO.id,
    })
    const rows = [...LEDGER, merged]
    // 検索（下 4 桁・前方一致・お名前）のどれでも出てこない。
    expect(filterCustomers(rows, searchFilter('5678'))).toEqual([HANAKO])
    expect(filterCustomers(rows, lookupFilter('090-1234-5678'))).toEqual([HANAKO, ICHIRO])
    expect(filterCustomers(rows, searchFilter('花子'))).toEqual([HANAKO])
    // 検索語を持たない一覧からも外れる。
    expect(filterCustomers(rows, null)).toEqual(LEDGER)
  })
})

/* --- 並べ方とカーソル ----------------------------------------------------- */

describe('並べ方', () => {
  /** 同じふりがなが 3 人。カーソルが `kana` だけなら 2 ページ目で必ず取りこぼす。 */
  const SAME_KANA = [
    customer({ id: 'aaaaaaaa-0000-4000-8000-000000000001', name: '佐藤 一', kana: 'さとう' }),
    customer({ id: 'aaaaaaaa-0000-4000-8000-000000000002', name: '佐藤 二', kana: 'さとう' }),
    customer({ id: 'aaaaaaaa-0000-4000-8000-000000000003', name: '佐藤 三', kana: 'さとう' }),
  ]

  it('お名前順のカーソルは (kana, id) で、同じふりがなでも重複せずに進む', () => {
    const first = pageCustomers(SAME_KANA, { sort: 'kana', limit: 2 })
    expect(first.items.map((row) => row.name)).toEqual(['佐藤 一', '佐藤 二'])
    expect(first.total).toBe(3)
    expect(first.nextCursor).not.toBeNull()
    // 不透明な base64url。ふりがなも id もそのままの姿では出さない。
    expect(first.nextCursor ?? '').toMatch(/^[A-Za-z0-9_-]+$/)
    expect(first.nextCursor ?? '').not.toContain('さとう')

    const cursor = first.nextCursor ?? ''
    expect(decodeCursor('kana', cursor)).toEqual({
      sort: 'kana',
      kana: 'さとう',
      id: SAME_KANA[1]?.id,
    })
    // 並べ方に結び付いた値なので、別の並べ方では読めない。壊れたカーソルも読めない。
    expect(decodeCursor('visits', cursor)).toBeNull()
    expect(decodeCursor('kana', 'こわれたカーソル')).toBeNull()

    const second = pageCustomers(SAME_KANA, { sort: 'kana', limit: 2, cursor })
    expect(second.items.map((row) => row.name)).toEqual(['佐藤 三'])
    expect(second.nextCursor).toBeNull()
    expect(second.total).toBe(3)
  })

  it('ご来店の回数順のカーソルは (visit_count, id) で、多い順に進む', () => {
    const first = pageCustomers(LEDGER, { sort: 'visits', limit: 2 })
    expect(first.items.map((row) => row.visitCount)).toEqual([4, 1])
    expect(first.nextCursor).toBe(encodeCursor('visits', ICHIRO))
    expect(decodeCursor('visits', first.nextCursor ?? '')).toEqual({
      sort: 'visits',
      visitCount: 1,
      id: ICHIRO.id,
    })

    const second = pageCustomers(LEDGER, {
      sort: 'visits',
      limit: 2,
      cursor: first.nextCursor ?? '',
    })
    expect(second.items.map((row) => row.name)).toEqual(['川上 恵'])
    expect(second.nextCursor).toBeNull()
  })
})

/* --- 候補の確からしさ ----------------------------------------------------- */

describe('候補の確からしさ', () => {
  it('全桁が一致した 1 件は「よく一致しています」（strong）', () => {
    const ranked = rankCandidates([HANAKO], { phone: '09012345678' })
    expect(ranked).toEqual([{ customer: HANAKO, match: 'strong' }])
  })

  it('前方だけ一致した 1 件は「確かめが必要です」（weak）', () => {
    const ranked = rankCandidates([ICHIRO], { phone: '09012345678' })
    expect(ranked).toEqual([{ customer: ICHIRO, match: 'weak' }])
  })

  it('下 4 桁だけ一致した 1 件は weak', () => {
    const other = customer({
      id: '66666666-6666-4666-8666-666666666666',
      name: '大森 千夏',
      kana: 'おおもり ちなつ',
      phoneNormalized: '0399995678',
      phoneLast4: '5678',
    })
    expect(rankCandidates([other], { phoneLast4: '5678' })).toEqual([
      { customer: other, match: 'weak' },
    ])
  })

  it('当てはまりが 0 件のときは空配列を返す（例外にしない）', () => {
    expect(rankCandidates([], { phone: '09012345678' })).toEqual([])
    // 番号を持たない方・まったく違う番号の方は候補に混ぜない。
    expect(rankCandidates([MEGUMI], { phone: '09012345678' })).toEqual([])
    expect(rankCandidates([HANAKO], { phone: '0399990000' })).toEqual([])
  })

  it('同姓同名が 2 件並んでも自動で確定しない', () => {
    const twin = customer({
      ...HANAKO,
      id: '77777777-7777-4777-8777-777777777777',
      customerNumber: 'G-02310',
      lastVisitAt: '2026-01-05',
    })
    const ranked = rankCandidates([HANAKO, twin], { phone: '09012345678' })
    expect(ranked).toHaveLength(2)
    expect(ranked.map((row) => row.match)).toEqual(['strong', 'strong'])
    // 選ばれた 1 件を指す印はどこにも無い。決めるのは人である。
    for (const row of ranked) expect(Object.keys(row).sort()).toEqual(['customer', 'match'])
  })

  it('全桁一致が 1 件だけでも自動で確定しない', () => {
    const ranked = rankCandidates([HANAKO, ICHIRO], { phone: '09012345678' })
    expect(Array.isArray(ranked)).toBe(true)
    expect(ranked).toHaveLength(2)
    expect(ranked[0]?.match).toBe('strong')
  })

  it('並びは strong が先、その中では最後のご来店が新しい順', () => {
    const older = customer({
      ...HANAKO,
      id: '88888888-8888-4888-8888-888888888888',
      customerNumber: 'G-02310',
      lastVisitAt: '2024-03-15',
    })
    const newerWeak = customer({
      ...ICHIRO,
      id: '99999999-9999-4999-8999-999999999999',
      customerNumber: 'G-02411',
      lastVisitAt: '2026-08-20',
    })
    const ranked = rankCandidates([older, newerWeak, HANAKO, ICHIRO], { phone: '09012345678' })
    expect(ranked.map((row) => row.customer.customerNumber)).toEqual([
      'G-01842', // strong / 2026-05-12
      'G-02310', // strong / 2024-03-15
      'G-02411', // weak   / 2026-08-20
      'G-02044', // weak   / 2026-02-14
    ])
  })
})

/* --- おまとめの下見 ------------------------------------------------------- */

describe('おまとめ', () => {
  /** 残す側。CUSTOMER-MERGE の A。接客のメモ 7 件。 */
  const PRIMARY: MergeCustomer = { ...HANAKO, noteCount: 7 }

  /** 残さない側。CUSTOMER-MERGE の B。ご住所のご登録が無く、メモ 1 件。 */
  const SECONDARY: MergeCustomer = {
    ...customer({
      id: '22222222-2222-4222-8222-222222222222',
      customerNumber: 'G-02310',
      name: '田中 花子',
      kana: 'たなか はなこ',
      phoneNormalized: '08098765432',
      phoneLast4: '5432',
      memo: '2回目のご来店です',
      visitCount: 1,
      lastVisitAt: '2026-08-11',
    }),
    noteCount: 1,
  }

  /** 下見が返した 1 項目。テストの読みやすさのために引き当てる。 */
  const fieldOf = (fields: ResolvedMergeField[], name: string) =>
    fields.find((row) => row.field === name)

  describe('項目ごとの解決', () => {
    it("choice='primary' は A の値を残す", () => {
      const preview = mergePreview(PRIMARY, SECONDARY, [{ field: 'phone', choice: 'primary' }])
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      expect(fieldOf(preview.fields, 'phone')?.value).toBe('09012345678')
      expect(preview.result.phone).toBe('09012345678')
    })

    it("choice='secondary' は B の値を残す", () => {
      const preview = mergePreview(PRIMARY, SECONDARY, [{ field: 'phone', choice: 'secondary' }])
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      expect(fieldOf(preview.fields, 'phone')?.value).toBe('08098765432')
      expect(preview.result.phone).toBe('08098765432')
    })

    it("接客のメモの 'both' は 7 + 1 = 8 になる", () => {
      const both = mergePreview(PRIMARY, SECONDARY, [{ field: 'notes', choice: 'both' }])
      expect(both.ok).toBe(true)
      if (both.ok) expect(both.noteCount).toBe(8)
      const onlyPrimary = mergePreview(PRIMARY, SECONDARY, [{ field: 'notes', choice: 'primary' }])
      expect(onlyPrimary.ok).toBe(true)
      if (onlyPrimary.ok) expect(onlyPrimary.noteCount).toBe(7)
    })

    it("接客のメモ以外に 'both' を渡すと拒む", () => {
      expect(mergePreview(PRIMARY, SECONDARY, [{ field: 'name', choice: 'both' }])).toEqual({
        ok: false,
        error: 'choice_not_allowed',
      })
      expect(mergePreview(PRIMARY, SECONDARY, [{ field: 'address', choice: 'both' }])).toEqual({
        ok: false,
        error: 'choice_not_allowed',
      })
    })

    it('値の無い側を残す選択は結果に「ご登録がありません」を置く', () => {
      const preview = mergePreview(PRIMARY, SECONDARY, [{ field: 'address', choice: 'secondary' }])
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      const address = fieldOf(preview.fields, 'address')
      expect(address?.value).toBeNull()
      expect(address?.display).toBe('ご登録がありません')
      expect(address?.secondaryValue).toBeNull()
    })
  })

  describe('下見の中身', () => {
    it('結果のお客様番号は残す側のもの（G-01842）', () => {
      const preview = mergePreview(PRIMARY, SECONDARY)
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      expect(preview.result.customerNumber).toBe('G-01842')
      expect(preview.result.id).toBe(PRIMARY.id)
    })

    it('失う番号（G-02310）を losingCustomerNumber に載せる', () => {
      const preview = mergePreview(PRIMARY, SECONDARY)
      expect(preview.ok).toBe(true)
      if (preview.ok) expect(preview.losingCustomerNumber).toBe('G-02310')
    })

    it('モックの 4 項目（お名前・お電話番号・ご住所・接客のメモ）がこの順で並ぶ', () => {
      const preview = mergePreview(PRIMARY, SECONDARY)
      expect(preview.ok).toBe(true)
      if (!preview.ok) return
      expect(preview.fields.map((row) => row.field)).toEqual(['name', 'phone', 'address', 'notes'])
      // 既定は残す側。接客のメモだけ「両方を残します」で 8 件から始まる。
      expect(preview.fields.map((row) => row.choice)).toEqual([
        'primary',
        'primary',
        'primary',
        'both',
      ])
      expect(preview.noteCount).toBe(8)
    })
  })

  describe('拒む', () => {
    it('同じ ID を primary と secondary に渡すと拒む', () => {
      expect(mergePreview(PRIMARY, PRIMARY)).toEqual({ ok: false, error: 'same_customer' })
      expect(applyMerge(PRIMARY, PRIMARY)).toBeNull()
    })

    it('下見に無い項目を実行の fields に混ぜると拒む', () => {
      for (const field of ['kana', 'email', 'birthDate', 'memo', 'visitCount']) {
        expect(mergePreview(PRIMARY, SECONDARY, [{ field, choice: 'secondary' }])).toEqual({
          ok: false,
          error: 'unknown_field',
        })
      }
    })
  })

  it('下見の result と、実行後の CustomerSummary が 1 文字も違わない', () => {
    const choices = [
      { field: 'name', choice: 'secondary' as const },
      { field: 'phone', choice: 'secondary' as const },
      { field: 'address', choice: 'primary' as const },
      { field: 'notes', choice: 'both' as const },
    ]
    const preview = mergePreview(PRIMARY, SECONDARY, choices)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return

    const stored = applyMerge(PRIMARY, SECONDARY, choices)
    expect(stored).not.toBeNull()
    if (stored === null) return

    expect(toCustomerSummary(stored)).toEqual(preview.result)
    // 契約に載る形そのもの（手書きの型を作らない）。
    expect(CustomerSummary.parse(preview.result)).toEqual(preview.result)
    // 残さない側の予約とご来店は残す側へ寄る。
    expect(stored.visitCount).toBe(5)
    expect(stored.lastVisitAt).toBe('2026-08-11')
  })
})

/* --- 手書きの再直列化 ----------------------------------------------------- */

describe('手書きの再直列化', () => {
  /** 筆跡 2 本の用紙。BOOK-04d-HANDWRITE / CUSTOMER-HANDWRITE が保存する形。 */
  const STROKES =
    '<path d="M20 40 C60 20 120 60 180 30" stroke="#1f3b2f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none" transform="translate(0,4)"/>' +
    '<path d="M20 90 L200 88" stroke="#1f3b2f" stroke-width="3" fill="none"/>'

  const paper = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" width="240" height="140" role="img" aria-label="手書きのメモ">${inner}</svg>`

  it('<script> を落とす', () => {
    const svg = sanitizeSvg(paper(`<script>fetch('https://evil.example')</script>${STROKES}`))
    expect(svg).not.toContain('script')
    expect(svg).not.toContain('evil.example')
    expect(svg).toContain('<path')
  })

  it('on* 属性（onload / onclick）を落とす', () => {
    const svg = sanitizeSvg(
      `<svg viewBox="0 0 240 140" onload="alert(1)"><g onclick="alert(2)">${STROKES}</g></svg>`,
    )
    expect(svg).not.toContain('onload')
    expect(svg).not.toContain('onclick')
    expect(svg).not.toContain('alert')
    expect(svg).toContain('viewBox="0 0 240 140"')
    expect(svg).toContain('<g>')
  })

  it('<foreignObject> を落とす', () => {
    const svg = sanitizeSvg(
      paper(`<foreignObject width="100" height="100"><div>本文</div></foreignObject>${STROKES}`),
    )
    expect(svg).not.toContain('foreignObject')
    expect(svg).not.toContain('<div')
    expect(svg).not.toContain('本文')
  })

  it('javascript: で始まる href と xlink:href を落とす', () => {
    const svg = sanitizeSvg(
      paper(
        `<a href="javascript:alert(1)"><path d="M1 1 L2 2"/></a>` +
          `<text xlink:href="javascript:alert(2)" x="10" y="10">読み取り</text>`,
      ),
    )
    expect(svg).not.toContain('javascript:')
    expect(svg).not.toContain('href')
  })

  it('<use> の外部参照を落とす', () => {
    const svg = sanitizeSvg(
      paper(`<use href="https://evil.example/x.svg#a"/><use xlink:href="#local"/>${STROKES}`),
    )
    expect(svg).not.toContain('<use')
    expect(svg).not.toContain('evil.example')
  })

  it('path の d / stroke-width / transform は残す', () => {
    const svg = sanitizeSvg(paper(STROKES))
    expect(svg).toContain('d="M20 40 C60 20 120 60 180 30"')
    expect(svg).toContain('stroke-width="3"')
    expect(svg).toContain('transform="translate(0,4)"')
  })

  it('viewBox / width / height / fill / stroke / stroke-linecap / stroke-linejoin / role / aria-label は残す', () => {
    const svg = sanitizeSvg(paper(STROKES))
    for (const kept of [
      'viewBox="0 0 240 140"',
      'width="240"',
      'height="140"',
      'role="img"',
      'aria-label="手書きのメモ"',
      'fill="none"',
      'stroke="#1f3b2f"',
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
    ]) {
      expect(svg).toContain(kept)
    }
    // 許可リストなので、名前空間の宣言のような未知の属性は残さない。
    expect(svg).not.toContain('xmlns')
  })

  it('落としたあとも筆跡の線（path）の本数が変わらない', () => {
    const raw = paper(
      `<script>alert(1)</script><foreignObject><div/></foreignObject>${STROKES}<use href="#a"/>`,
    )
    const before = (raw.match(/<path/g) ?? []).length
    const after = (sanitizeSvg(raw).match(/<path/g) ?? []).length
    expect(before).toBe(2)
    expect(after).toBe(before)
  })

  it('512KB を超える SVG は受け取らない', () => {
    const fits = paper(`<path d="M0 0 L${'1'.repeat(512 * 1024 - 400)} 1"/>`)
    const over = paper(`<path d="M0 0 L${'1'.repeat(512 * 1024)} 1"/>`)
    const accepted = acceptHandwriting(fits)
    expect(accepted.ok).toBe(true)
    expect(acceptHandwriting(over)).toEqual({ ok: false, error: 'too_large' })
  })

  it('6 枚目の保存は拒み、置き換える 1 枚を尋ねる（黙って古い 1 枚を消さない）', () => {
    const sheets = Array.from({ length: HANDWRITING_MAX_SHEETS }, (_, index) => ({
      id: `note-${index + 1}`,
      createdAt: `2026-08-2${index + 1}T02:00:00.000Z`,
    }))
    expect(acceptSheet(sheets.slice(0, 4))).toEqual({ ok: true })

    const refused = acceptSheet(sheets)
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.error).toBe('too_many_sheets')
    // 置き換える 1 枚を選んでもらうために、いまある 5 枚をそのまま返す。
    expect(refused.sheets).toEqual(sheets)
    expect(sheets).toHaveLength(HANDWRITING_MAX_SHEETS)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 2 巡目に足した敵対的な打鍵と、再直列化の往復
 * ─────────────────────────────────────────────────────────────────────────── */

describe('お電話番号の打ち間違い', () => {
  it('括弧・ドット・全角の記号が混ざっても数字だけを残す', () => {
    expect(normalizePhone('(090)1234-5678')).toBe('09012345678')
    expect(normalizePhone('090．1234．5678')).toBe('09012345678')
    expect(normalizePhone('TEL:090-1234-5678')).toBe('09012345678')
  })

  it('国番号を付けた打鍵は番号にしない（+81 を 0 に読み替えて別人を拾わせない）', () => {
    // 「+81 90-1234-5678」は 090-1234-5678 と同じ方だが、**当てずっぽうに 0 を補わない**。
    // 補うと 81 で始まる 11 桁の別の番号まで 0 付きに読み替えることになる。
    expect(normalizePhone('+81 90-1234-5678')).toBeNull()
    expect(normalizePhone('0081-90-1234-5678')).toBeNull()
    expect(lookupFilter('+81 90-1234-5678')).toBeNull()
  })

  it('先頭の 0 が抜けた 10 桁は番号にしない', () => {
    expect(normalizePhone('9012345678')).toBeNull()
    expect(normalizePhone('3-1234-5678')).toBeNull()
  })

  it('短すぎる打鍵も長すぎる打鍵も、当てに行く条件を 1 つも作らない', () => {
    for (const typed of ['0', '090', '090-1234', '090123456', '0901234567890']) {
      expect(normalizePhone(typed)).toBeNull()
      expect(lookupFilter(typed)).toBeNull()
    }
  })

  it('下 4 桁は全角で打っても半角の 4 桁として引く', () => {
    expect(searchFilter('５６７８')).toEqual({ column: 'phone_last4', op: 'eq', value: '5678' })
    expect(filterCustomers(LEDGER, searchFilter('５６７８'))).toEqual([HANAKO])
  })

  it('下 4 桁の完全一致は、その 4 桁を途中に持つ別の方を 1 人も拾わない', () => {
    // 田中 一郎 様の 09012349912 は「1234」を途中に持つが、下 4 桁は 9912 である。
    expect(filterCustomers(LEDGER, searchFilter('1234'))).toEqual([])
    expect(filterCustomers(LEDGER, searchFilter('9912'))).toEqual([ICHIRO])
    // `%` を打っても全件に化けない（LIKE のパターンとして解釈させない）。
    expect(filterCustomers(LEDGER, searchFilter('%'))).toEqual([])
  })
})

describe('再直列化の往復', () => {
  /**
   * 1 枚は**保存のときと読み出しのときの 2 回**再直列化を通る（`acceptHandwriting` と
   * `readHandwriting`）。ここが冪等でないと、お客様の書いた「田中 & 花子」が
   * 読むたびに `&amp;` ぶんだけ伸び、他店舗の端末には別の文字列が出る。
   */
  it('2 度通しても 1 度通したときと 1 文字も変わらない', () => {
    const raw =
      '<svg viewBox="0 0 600 400" aria-label="花子 & 一郎"><text>&lt;script&gt; 田中 &amp; 花子</text>' +
      '<path d="M10 10 L100 90" stroke-width="3"/></svg>'
    const once = sanitizeSvg(raw)
    expect(sanitizeSvg(once)).toBe(once)
    expect(sanitizeSvg(sanitizeSvg(once))).toBe(once)
  })

  it('すでに実体参照になっている & を二重に逃がさない', () => {
    const once = sanitizeSvg('<svg><text>A &amp; B &#38; C</text></svg>')
    expect(once).toContain('A &amp; B &#38; C')
    expect(once).not.toContain('&amp;amp;')
  })

  it('実体参照でない裸の & は逃がす（逃がさないと XML として壊れる）', () => {
    expect(sanitizeSvg('<svg><text>A & B</text></svg>')).toContain('A &amp; B')
    expect(sanitizeSvg('<svg><text>Q&A</text></svg>')).toContain('Q&amp;A')
  })

  it('逃がしたあとに上限を越える 1 枚は保存させない（詳細がまるごと 500 になるため）', () => {
    // `<` 1 文字が `&lt;` の 4 文字になるので、上限ちょうどの 1 枚が上限を越える。
    const raw = `<svg><text>${'<'.repeat(300 * 1024)}</text></svg>`
    expect(new TextEncoder().encode(raw).length).toBeLessThan(512 * 1024)
    expect(acceptHandwriting(raw)).toEqual({ ok: false, error: 'too_large' })
  })
})

describe('接客のメモの残し方（下見と保存を食い違わせない）', () => {
  const PRIMARY_NOTES: MergeCustomer = { ...HANAKO, noteCount: 7 }
  const SECONDARY_NOTES: MergeCustomer = {
    ...customer({
      id: '22222222-2222-4222-8222-222222222222',
      customerNumber: 'G-02310',
      name: '田中 花子',
      kana: 'たなか はなこ',
    }),
    noteCount: 1,
  }

  /**
   * 実行は「残す側だけを選んだときは寄せない、それ以外は寄せる」の 2 通りしかない
   * （残す側の 7 件を消す道が無いので、`'secondary'` に「B だけ残す」意味は作れない）。
   * 下見の件数もその 2 通りに揃える。揃えないと「1件」と読んで押した直後に 8 件が寄る。
   */
  it("'secondary' を選んでも、下見は寄せたあとの 8 件を出す", () => {
    const preview = mergePreview(PRIMARY_NOTES, SECONDARY_NOTES, [
      { field: 'notes', choice: 'secondary' },
    ])
    expect(preview.ok).toBe(true)
    if (preview.ok) expect(preview.noteCount).toBe(8)
  })

  it("'primary' だけが「寄せない」で、下見は 7 件を出す", () => {
    const preview = mergePreview(PRIMARY_NOTES, SECONDARY_NOTES, [
      { field: 'notes', choice: 'primary' },
    ])
    expect(preview.ok).toBe(true)
    if (preview.ok) expect(preview.noteCount).toBe(7)
  })
})
