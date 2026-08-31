/*
 * glasses_management の D1 に、開発用の世界観データを入れる。
 * 何度実行しても同じ（INSERT OR IGNORE なので、手で直した行は上書きしない）。
 *
 *   local : pnpm --filter @app/glasses_management db:seed:local   （make init から呼ばれる）
 *   本番   : node services/glasses_management/seed.mjs --remote
 *
 * 入れるもの: EYEX（組織）と 3 店舗（銀座・丸の内・新宿）、および銀座店の受付条件 6 面
 * （営業時間 / 止める帯 / 予約の間隔 / スタッフと技能と勤務 / 設備と点検 / ご来店の目的）。
 * 組織 id は admin 側の seed（`org-admin-seed` など）とは別に、EYEX 用の 1 件を置く。
 * 実運用では組織は admin から service binding で届くので、これは開発の足場である。
 *
 * 値の正本: specs/glasses_management/design/03-data-model.md §4〜§6 と、
 * docs/frontend/mockups/eyex/screens/SETTINGS-*.html。
 * マスタープラン §5 と食い違う 2 件（店長は 山田 大輔／目的にフィッティングは無い）は §5 が誤り。
 *
 * id は毎回同じ固定値にする。`INSERT OR IGNORE` が「2 回走らせても行が増えない」のは
 * id が同じときだけなので、ここで crypto.randomUUID() を呼んではならない。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REMOTE = process.argv.includes('--remote')
// e2e は使い捨ての D1（playwright.config.ts の `withDisposableState`）で走るので、
// そちらへ入れる。開発者の .wrangler/state は E2E_STATE_PATH が無いときだけ使う。
const PERSIST_TO = process.env.E2E_STATE_PATH
const NOW = '2026-08-01T00:00:00.000Z'
const ORG = 'org-eyex-seed'

const q = (s) => `'${String(s).replace(/'/g, "''")}'`

const stores = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'EYEX 銀座店',
    slug: 'ginza',
    phone: '03-3571-0001',
    address: '東京都中央区銀座4-5-6 EYEXビル 2階',
    accessNote: 'A1出口から徒歩3分',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'EYEX 丸の内店',
    slug: 'marunouchi',
    phone: '03-2345-6789',
    address: '東京都千代田区丸の内1-1-1',
    accessNote: '東京駅 丸の内南口から徒歩5分',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'EYEX 新宿店',
    slug: 'shinjuku',
    phone: '03-3456-7890',
    address: '東京都新宿区新宿3-1-1',
    accessNote: '新宿駅 東口から徒歩4分',
  },
]

/*
 * ここから下が銀座店の受付条件 6 面。id はすべて固定で、区分ごとに頭 8 桁を変える。
 * 丸の内店・新宿店は版（store_settings_revision）だけ置き、6 面は未設定のままにする
 * （行が無い店舗は「設定未完」として空き枠を 0 件にする、という決めの実データになる）。
 */
const uid = (group, n) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`

const GINZA = stores[0].id

/** 'HH:MM' に分を足す（同じ日の中でしか使わない）。 */
const shift = (hhmm, minutes) => {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/* --- 店舗の情報（SETTINGS-STORE） ------------------------------------------ *
 * P1 で足した 7 列だけを、まだ空のときに限って埋める。P0 が入れた
 * phone / address / access_note は触らない（手で直した行を上書きしない）。 */
const YAMADA = uid('c0010000', 5)
const storeInfo = [
  {
    id: GINZA,
    sort_order: 0,
    name_public: 'EYEX 銀座店（銀座4丁目）',
    nearest_station: '東京メトロ 銀座駅',
    parking_note: '提携駐車場はありません',
    intro_text:
      '銀座4丁目の交差点からすぐ。視力の測定からフレーム選び、仕上げのかけ具合の調整まで、担当者がひととおりお手伝いします。',
    updated_at: '2026-08-20T01:00:00.000Z', // JST 2026年8月20日（木）10:00
    updated_by: YAMADA,
  },
  { id: stores[1].id, sort_order: 1 },
  { id: stores[2].id, sort_order: 2 },
]

/* --- 営業時間（SETTINGS-HOURS） -------------------------------------------- *
 * weekday は 0=日 / 1=月 / … / 6=土。火曜が定休。break_start / break_end は
 * 常に NULL にする（受付を止める帯の正本は store_blackout_windows）。 */
const businessHours = [
  { weekday: 0, opens: '10:00', closes: '18:00' },
  { weekday: 1, opens: '10:00', closes: '19:00' },
  { weekday: 2, opens: null, closes: null }, // 定休
  { weekday: 3, opens: '10:00', closes: '19:00' },
  { weekday: 4, opens: '10:00', closes: '19:00' },
  { weekday: 5, opens: '11:00', closes: '20:00' },
  { weekday: 6, opens: '10:00', closes: '19:00' },
]

/* --- 受付を止める帯（SETTINGS-HOURS 右） ----------------------------------- *
 * 営業する 6 曜日それぞれに 3 本。帯は営業時間の内側でなければ保存できないので、
 * 開店直後の 15 分と閉店前の 20 分はその曜日の時刻から組み立てる
 * （金は 11:00–11:15 と 19:40–20:00、日は 17:40–18:00 になる）。
 * お昼は 12:00–13:00 で固定する。SETTINGS-HOURS の「13:00–14:00」はモックの誤記。 */
const blackoutWindows = businessHours
  .filter((h) => h.opens !== null)
  .flatMap((h) => [
    { weekday: h.weekday, label: '朝の支度', starts: h.opens, ends: shift(h.opens, 15) },
    { weekday: h.weekday, label: 'お昼', starts: '12:00', ends: '13:00' },
    { weekday: h.weekday, label: '閉店前の片付け', starts: shift(h.closes, -20), ends: h.closes },
  ])

/* --- スタッフと技能と勤務（SETTINGS-STAFF） -------------------------------- *
 * 6 名。店長は 山田 大輔（マスタープラン §5 の「高橋 慎輔」は誤り）。
 * week は 0=日 … 6=土 の勤務帯で、null がお休み。火は店舗の定休なので全員 null。
 * 木に出るのは 佐藤・高橋・中村 の 3 名（LEDGER-STAFF の行）、
 * 金に山田がいない（SETTINGS-STAFF「本日はお休み」／当日は 2026-08-28 金）。
 * 休憩 13:00–14:00 は佐藤 美咲だけが持つ（台帳の灰帯は佐藤の行にだけある）。
 * PIN は P10 で扱うので pin_hash は NULL のままにする。 */
const staffMembers = [
  {
    name: '佐藤 美咲',
    kana: 'さとう みさき',
    job: null,
    role: 'staff',
    adminUserId: null,
    skills: ['measure', 'processing', 'sales_reception'],
    week: ['12:00-19:00', '10:00-19:00', null, '10:00-19:00', '10:00-19:00', null, '10:00-19:00'],
    rest: '13:00-14:00',
  },
  {
    name: '高橋 健',
    kana: 'たかはし けん',
    job: null,
    role: 'staff',
    adminUserId: null,
    skills: ['fitting', 'sales_reception'],
    week: [null, '10:00-19:00', null, null, '10:00-19:00', '11:00-20:00', '10:00-19:00'],
    rest: null,
  },
  {
    name: '中村 彩',
    kana: 'なかむら あや',
    job: null,
    role: 'staff',
    adminUserId: 'user-eyex-nakamura',
    skills: ['sales_reception'],
    week: ['10:00-18:00', null, null, '10:00-19:00', '10:00-19:00', '11:00-20:00', '10:00-19:00'],
    rest: null,
  },
  {
    name: '小林 学',
    kana: 'こばやし まなぶ',
    job: null,
    role: 'staff',
    adminUserId: null,
    skills: ['measure'],
    week: [null, '10:00-19:00', null, '10:00-19:00', null, '11:00-20:00', '10:00-19:00'],
    rest: null,
  },
  {
    name: '渡辺 由紀',
    kana: 'わたなべ ゆき',
    job: null,
    role: 'staff',
    adminUserId: null,
    skills: ['sales_reception'],
    week: ['10:00-18:00', null, null, '10:00-19:00', null, '11:00-20:00', '10:00-19:00'],
    rest: null,
  },
  {
    name: '山田 大輔',
    kana: 'やまだ だいすけ',
    job: '店長',
    role: 'manager',
    adminUserId: 'user-eyex-yamada',
    skills: ['sales_reception'],
    week: [null, '10:00-19:00', null, '10:00-19:00', null, null, '10:00-19:00'],
    rest: null,
  },
]

/* --- 設備と点検（SETTINGS-EQUIPMENT） -------------------------------------- *
 * DB は 1 台 1 行の 7 行。設定画面が「相談カウンター 1・2」を 1 行に見せるのは
 * 表示側のまとめで、まとめた結果が「設備と場所　6件」になる。
 * 加工室だけ「部品待ちで止めています」。視力測定機 B の「止めています」は
 * 未保存の下書きなので、保存済みの状態は「使えます」＋点検予定にする。 */
const equipments = [
  { name: '視力測定機 A', kind: 'measure', role: '視力測定', active: true, reason: null },
  { name: '視力測定機 B', kind: 'measure', role: '視力測定', active: true, reason: null },
  { name: '検査室 1', kind: 'measure', role: '精密検査', active: true, reason: null },
  { name: '相談カウンター 1', kind: 'counter', role: '接客・ご相談', active: true, reason: null },
  { name: '相談カウンター 2', kind: 'counter', role: '接客・ご相談', active: true, reason: null },
  { name: 'フィッティング台', kind: 'counter', role: 'フィッティング', active: true, reason: null },
  { name: '加工室', kind: 'workbench', role: '加工', active: false, reason: '部品待ち' },
]

/* --- ご来店の目的（SETTINGS-PURPOSE） -------------------------------------- *
 * 6 件。フィッティングは目的ではなく技能なので入らない。
 * 「メガネを新しく作る」は 60 分（50 分にしない）。修理・部品交換だけ Web 非公開。 */
const purposes = [
  {
    internal: 'メガネを新しく作る',
    pub: '新しいメガネを作る',
    short: '新調相談',
    minutes: 60,
    web: '1',
  },
  {
    internal: '今のメガネを調整したい',
    pub: 'かけ具合の調整',
    short: '調整',
    minutes: 20,
    web: '1',
  },
  {
    internal: 'できあがりを受け取る',
    pub: 'できあがりの受け取り',
    short: '受け取り',
    minutes: 20,
    web: '1',
  },
  { internal: '修理・部品交換', pub: '修理・部品の交換', short: '修理', minutes: 30, web: '0' },
  {
    internal: 'コンタクトの相談',
    pub: 'コンタクトのご相談',
    short: 'コンタクト',
    minutes: 40,
    web: '1',
  },
  { internal: '視力測定だけ', pub: '視力測定', short: '視力測定', minutes: 30, web: '1' },
]

/** 「メガネを新しく作る」が要る技能と設備種別（同じ kind の複数行は AND）。 */
const purposeRequirements = [
  { kind: 'skill', value: 'measure' },
  { kind: 'equipment_kind', value: 'measure' },
  { kind: 'equipment_kind', value: 'counter' },
]

/* --- 当日の勤務（staff_shifts） -------------------------------------------- *
 * 曜日テンプレート（staff_weekly_shifts）を日付へ展開するのは保存の経路と日次 Cron で、
 * seed は API を通らないので展開結果が 1 行も無い。台帳と空き枠は staff_shifts しか
 * 読まないため、これを置かないと 8月27日の台帳から休憩の帯が消え、空き枠は
 * 「担当がお休み」で全滅する。台帳と E2E が触る 5 週間ぶんだけを展開する。 */
const SHIFT_FROM = '2026-08-27'
const SHIFT_DAYS = 35
const MS_PER_DAY = 86_400_000

/** JST の暦日を n 日ぶん並べる（JST に夏時間は無いので UTC の日付計算でずれない）。 */
const jstDays = (from, days) => {
  const base = Date.parse(`${from}T00:00:00.000Z`)
  return Array.from({ length: days }, (_, i) =>
    new Date(base + i * MS_PER_DAY).toISOString().slice(0, 10),
  )
}
const weekdayOf = (date) => new Date(`${date}T00:00:00.000Z`).getUTCDay()

const shiftRows = jstDays(SHIFT_FROM, SHIFT_DAYS).flatMap((date, dayIndex) =>
  staffMembers.flatMap((m, i) => {
    const band = m.week[weekdayOf(date)]
    if (band === null) return []
    const [startsAt, endsAt] = band.split('-')
    const rows = [{ n: i * 100 + dayIndex, staffIndex: i, date, startsAt, endsAt, kind: 'work' }]
    if (m.rest !== null) {
      const [restStart, restEnd] = m.rest.split('-')
      // 休憩は担当ひとりのもので、台帳では担当の行にだけ灰色の帯として出る。
      rows.push({
        n: 100_000 + i * 100 + dayIndex,
        staffIndex: i,
        date,
        startsAt: restStart,
        endsAt: restEnd,
        kind: 'break',
      })
    }
    return rows
  }),
)

/* --- 2026年8月27日（木）の銀座店のご予約 12 件（LEDGER-STAFF が正本） ------ *
 * お客様のお名前は入れない（`customers` は 007-customer-records。`customer_id` は全件 NULL）。
 * 台帳に出るのはご用件と担当だけである。モック同士が食い違う値は LEDGER-STAFF を正とする
 * （HOME-PERSONAL は 13:00 と 15:30 を佐藤 美咲に置いているが、LEDGER-STAFF は
 * それぞれ 高橋 健 と 中村 彩 に置いている。佐藤 美咲の本日の担当は
 * 11:00 / 14:00 / 17:00 / 17:30 の 4 件になる）。
 *
 * 11 と 12 は表示窓 10:00–16:30 の外に置く。台帳の横スクロールの証拠になり、
 * 「すべて 12件 ／ これから 7件（11:08 以降に始まる #6〜#12）／ 確認待ち 1件（#6）」が
 * 数え上げの結果として成り立つ。 */
const LEDGER_DATE = '2026-08-27'
const SLOT_MINUTES = 30
const CLEANUP_MINUTES = 10

/** JST の壁時計 → UTC の ISO8601。 */
const at = (hhmm) => new Date(Date.parse(`${LEDGER_DATE}T${hhmm}:00.000+09:00`)).toISOString()
const after = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60_000).toISOString()

/** staffMembers / equipments / purposes の並び順（= id の連番）に付けた名前。 */
const SATO = 0
const TAKAHASHI = 1
const NAKAMURA = 2
const WATANABE = 4
const MEASURE_A = 0
const MEASURE_B = 1
const COUNTER_1 = 3
const COUNTER_2 = 4
const NEW_GLASSES = 0
const ADJUST = 1
const PICKUP = 2
const EYESIGHT = 5

/* 予約 12 件（LEDGER-STAFF / LEDGER-LIST の帯とそのままの並び）。
 *
 * **10:00 の 1 件は「朝の支度」の受付停止帯（開店直後の 15 分）の中にある。**
 * 台帳には帯が置いてあるのに、同じ時刻を新規で取ろうとすると空き枠エンジンは
 * `reason='break'` で断る。これは食い違いではなく決めである —— 受付を止める帯は
 * 「これから受ける予約を止める」ものであって、すでに入っている予約を消しはしない
 * （帯を後から足した日に台帳から帯が消えたら、来店されたお客様を見失う）。
 * モック LEDGER-STAFF が 10:00 の帯を描いているのが正本である。 */
const reservationSeeds = [
  {
    start: '10:00',
    minutes: 30,
    use: [ADJUST],
    staff: TAKAHASHI,
    source: 'phone',
    status: 'arrived',
    // 伊藤 健 様の「覚えておくこと」が言う「本日 10:00 に調整」がこの帯である。
    customer: 3,
  },
  {
    start: '10:30',
    minutes: 60,
    use: [EYESIGHT],
    staff: NAKAMURA,
    source: 'web',
    status: 'arrived',
    places: [{ unit: MEASURE_B }],
  },
  {
    start: '11:00',
    minutes: 60,
    use: [NEW_GLASSES, EYESIGHT],
    staff: SATO,
    source: 'phone',
    status: 'confirmed',
    places: [{ unit: MEASURE_A }, { unit: COUNTER_2 }],
    // LEDGER-DETAIL の 2 行。この 60 分の帯が AC-CUST-24 / AC-CUST-25 の
    // 「11:00 の 田中 花子 様（4回目）」で、CUSTOMER-DETAIL の「次のご予約」でもある。
    noteCustomer: '「遠近は初めてです」',
    noteInternal: '度数変更の理由は、段階的に説明してください。',
    customer: 7,
  },
  {
    start: '11:00',
    minutes: 30,
    use: [EYESIGHT],
    staff: WATANABE,
    source: 'walkin',
    status: 'arrived',
  },
  {
    start: '11:02',
    minutes: 60,
    use: [NEW_GLASSES],
    staff: null,
    source: 'walkin',
    status: 'confirmed',
  },
  {
    start: '13:00',
    minutes: 20,
    use: [ADJUST],
    staff: null,
    source: 'web',
    status: 'confirmed',
    places: [{ unit: COUNTER_1 }],
  },
  {
    start: '13:00',
    minutes: 60,
    use: [ADJUST],
    staff: TAKAHASHI,
    source: 'phone',
    status: 'confirmed',
  },
  {
    start: '14:00',
    minutes: 20,
    use: [PICKUP],
    staff: SATO,
    source: 'phone',
    status: 'confirmed',
    places: [{ unit: COUNTER_1 }],
    // AC-CUST-24 の狭い帯（お名前を姓だけに落とす側）。モックは 30 分だが、
    // 台帳の e2e が 20 分の帯として固定しているので所要時間は動かさない。
    customer: 9,
  },
  {
    start: '15:00',
    minutes: 60,
    use: [NEW_GLASSES],
    staff: NAKAMURA,
    source: 'counter',
    status: 'confirmed',
  },
  {
    start: '15:30',
    minutes: 60,
    use: [EYESIGHT],
    staff: null,
    source: 'phone',
    status: 'confirmed',
    // 1 予約が場所を持ち替える（測定 → ご相談）。設備別の台帳では 2 行に出る。
    places: [
      { unit: MEASURE_A, from: '15:30', to: '16:00' },
      { unit: COUNTER_2, from: '16:00', to: '16:30' },
    ],
  },
  { start: '17:00', minutes: 30, use: [ADJUST], staff: SATO, source: 'phone', status: 'confirmed' },
  { start: '17:30', minutes: 30, use: [PICKUP], staff: SATO, source: 'phone', status: 'confirmed' },
]

/** 押さえ 1 本を刻みの格子へ展開する（`reservation_slot_locks.slot_start`）。
 * 片付けは予約の後ろにだけ付き、`ends_at` には含めない。 */
const slotStartsOf = (startsAt, endsAt) => {
  const step = SLOT_MINUTES * 60_000
  const anchor = Date.parse(`${LEDGER_DATE}T00:00:00.000+09:00`)
  const endMs = Date.parse(endsAt) + CLEANUP_MINUTES * 60_000
  const first = anchor + Math.floor((Date.parse(startsAt) - anchor) / step) * step
  const starts = []
  for (let ms = first; ms < endMs; ms += step) starts.push(new Date(ms).toISOString())
  return starts
}

/** 1 予約ぶんの行（本体・ご用件・押さえ・枠の一次排他）を組み立てる。 */
const reservationRows = reservationSeeds.map((seed, i) => {
  const startsAt = at(seed.start)
  const endsAt = after(startsAt, seed.minutes)
  // 担当の押さえは 1 予約にちょうど 1 行（未定でも作る。無いと枠の数え方が台帳とずれる）。
  const bands = [
    {
      kind: 'staff',
      targetId: seed.staff === null ? null : uid('c0010000', seed.staff),
      startsAt,
      endsAt,
    },
    ...(seed.places ?? []).map((place) => ({
      kind: 'equipment',
      targetId: uid('d0010000', place.unit),
      startsAt: place.from === undefined ? startsAt : at(place.from),
      endsAt: place.to === undefined ? endsAt : at(place.to),
    })),
  ]
  return {
    id: uid('a0010000', i),
    code: `EY-2608-${String(i + 1).padStart(4, '0')}`,
    startsAt,
    endsAt,
    seed,
    bands,
    locks: bands.flatMap((band) =>
      slotStartsOf(band.startsAt, band.endsAt).map((slotStart) => ({
        kind: band.kind,
        // 担当が未定のレーンの鍵は固定の語にする（NULL 同士は `=` で結べない）。
        targetKey: band.targetId ?? 'unassigned',
        slotStart,
      })),
    ),
  }
})

/* --- 顧客台帳（CUSTOMER-LIST / CUSTOMER-DETAIL） --------------------------- *
 * 承認済みモック CUSTOMER-LIST.png の 8 行と、CUSTOMER-DETAIL.png の 田中 花子 様
 * （度数 3 件・いまお使いのメガネ 2 本・接客のメモ 7 件）をそのまま置く。
 * マスタープラン §5 と重なる方（田中 花子・伊藤 健・川上 恵・相川 みどり）は §5 が正である。
 *
 * `visit_count` / `first_visit_at` / `last_visit_at` は**列に入れた値が正本**である
 * （読むたびに数え直さず、来店済みになった時点で書き戻す決め。既存店の名簿を移してきた
 * 初日の姿でもある）。田中 花子 様だけは過去のご予約 5 件（来店済み 4 件・取り消し 1 件）も
 * 置いてあり、列と数え上げと「よくご担当した者」が一致する。
 *
 * おまとめ（CUSTOMER-MERGE）の 2 件目 G-02310 は**ここに置かない**。同じお電話番号の行を
 * seed に残すと BOOK-04b の候補が 3 件になり「同じ番号のご来店が2件見つかりました。」が
 * 崩れるので、おまとめを確かめる e2e が自分で作って自分でまとめる。
 */
const CUSTOMER_STORE = GINZA
const MARUNOUCHI = stores[1].id

/** 来店の「瞬間」。列は ISO8601 で持ち、画面は JST の暦日へ落として読む。 */
const visitAt = (date) => (date === null ? null : `${date}T02:00:00.000Z`)

const customerSeeds = [
  {
    number: 'G-01455',
    name: '相川 みどり',
    kana: 'あいかわ みどり',
    phone: '090-2233-4455',
    visits: 2,
    first: '2025-05-06',
    last: '2026-07-03',
    memo: '調整の途中です',
  },
  {
    number: 'G-01488',
    name: '青木 律子',
    kana: 'あおき りつこ',
    phone: '080-3344-5566',
    visits: 4,
    first: '2023-09-12',
    last: '2026-06-21',
    memo: '遠近両用を長くお使い',
  },
  {
    number: 'G-01521',
    name: '石井 孝',
    kana: 'いしい たかし',
    phone: '090-4455-6677',
    visits: 2,
    first: '2026-03-02',
    last: '2026-08-11',
    memo: '2回目のご来店です',
  },
  {
    number: 'G-01596',
    name: '伊藤 健',
    kana: 'いとう けん',
    phone: '080-5566-7788',
    visits: 2,
    first: '2025-10-19',
    last: '2026-08-27',
    memo: '本日 10:00 に調整',
  },
  {
    number: 'G-01634',
    name: '大森 千夏',
    kana: 'おおもり ちなつ',
    phone: '090-6677-8899',
    visits: 2,
    first: '2025-02-11',
    last: '2025-12-08',
    memo: 'まぶしさに弱い',
  },
  // ご来店が 0 件の 1 名。一覧は「初」、最後のご来店は「—」になる（AC-CUST-10）。
  {
    number: 'G-01702',
    name: '川上 恵',
    kana: 'かわかみ めぐみ',
    phone: '080-7788-9900',
    visits: 0,
    first: null,
    last: null,
    memo: 'お子様の分もご一緒に',
  },
  // お電話番号を伺えていない 1 名。3 列とも NULL にする（片方だけ入る形を作らない）。
  {
    number: 'G-01777',
    name: '木下 亮太',
    kana: 'きのした りょうた',
    phone: null,
    visits: 2,
    first: '2025-06-30',
    last: '2026-02-14',
    memo: 'ご連絡先が未登録',
  },
  {
    number: 'G-01842',
    name: '田中 花子',
    kana: 'たなか はなこ',
    phone: '090-1234-5678',
    visits: 4,
    first: '2024-03-15',
    last: '2026-05-12',
    memo: 'PC作業用・鼻パッド低め',
    address: '東京都中央区銀座 4-◯-◯',
  },
  // BOOK-04b の 2 件目。下 4 桁は違い、共通するのは先頭 7 桁（0901234）だけである。
  {
    number: 'G-02180',
    name: '田中 一郎',
    kana: 'たなか いちろう',
    phone: '090-1234-9912',
    visits: 1,
    first: '2026-08-13',
    last: '2026-08-13',
    memo: 'ご家族で同じお電話番号',
  },
  {
    number: 'G-02402',
    name: '松本 一郎',
    kana: 'まつもと いちろう',
    phone: '090-8899-0011',
    visits: 3,
    first: '2025-01-20',
    last: '2026-08-20',
    memo: '掛け具合の調整が続いています',
  },
  /*
   * おまとめ（CUSTOMER-MERGE）の見本になる 2 件。**ご来店は 1回 に留める** ——
   * 「ご来店 2〜4回」の札で絞ったときの 42名 を動かさないためで、ふりがなも
   * 「まつもと いちろう」より後ろに置いて一覧の 8 行を押し出さない。
   * 同じお電話番号だが 0905555 で始まるので、BOOK-04b の候補（0901234）にも混ざらない。
   */
  {
    number: 'G-02510',
    name: '渡会 昭',
    kana: 'わたらい あきら',
    phone: '090-5555-0001',
    visits: 1,
    first: '2026-08-13',
    last: '2026-08-13',
    memo: '同じお電話番号でふたつに分かれています',
    address: '東京都中央区銀座 5-◯-◯',
  },
  {
    number: 'G-02511',
    name: '渡会 章',
    kana: 'わたらい あきら',
    phone: '090-5555-0001',
    visits: 1,
    first: '2026-08-20',
    last: '2026-08-20',
    memo: '受付でもう一度お伺いしてしまった行',
  },
]

/*
 * CUSTOMER-LIST の「当てはまるお客様 42名」と「ほか 34名 ／ 続きを見る ›」を成り立たせる
 * 控えの 34 名。ふりがなは**「まつもと いちろう」より後ろに並ぶ姓だけ**を使い、
 * モックが描いている 8 行を押し出さない。ご来店は 2〜4回 の帯に収める（同じ札で絞ったとき
 * 42 名になる）。お電話番号は 070 で始め、候補の前方一致（0901234）に混ざらないようにする。
 */
const fillerFamilies = [
  ['三浦', 'みうら'],
  ['村上', 'むらかみ'],
  ['森田', 'もりた'],
  ['山口', 'やまぐち'],
  ['山本', 'やまもと'],
  ['湯浅', 'ゆあさ'],
  ['横山', 'よこやま'],
  ['吉田', 'よしだ'],
  ['和田', 'わだ'],
  ['渡辺', 'わたなべ'],
  ['若林', 'わかばやし'],
  ['鷲尾', 'わしお'],
]
const fillerGiven = [
  ['明', 'あきら'],
  ['香織', 'かおり'],
  ['聡', 'さとし'],
]
const fillerSeeds = Array.from({ length: 34 }, (_, i) => {
  const [family, familyKana] = fillerFamilies[i % fillerFamilies.length]
  const [given, givenKana] = fillerGiven[Math.floor(i / fillerFamilies.length)]
  return {
    number: `G-0${3000 + i}`,
    name: `${family} ${given}`,
    kana: `${familyKana} ${givenKana}`,
    phone: `070-1000-${String(3000 + i)}`,
    visits: 2 + (i % 3),
    first: '2024-04-01',
    last: `2026-0${1 + (i % 6)}-1${i % 10}`,
    memo: '',
  }
})

const allCustomers = [...customerSeeds, ...fillerSeeds].map((c, i) => ({
  ...c,
  id: i < customerSeeds.length ? uid('0a010000', i) : uid('0a020000', i - customerSeeds.length),
  normalized: c.phone === null ? null : c.phone.replace(/[^0-9]/g, ''),
}))

const HANAKO = uid('0a010000', 7)

/* 田中 花子 様の度数 3 件（CUSTOMER-DETAIL「度数の移り変わり」）。
 * いま有効な行はちょうど 1 つで、その値が一覧の要約の「いまの度数」と同じになる。 */
const prescriptionSeeds = [
  { at: '2026-05-12', r: [-2.25, -0.5, 180], l: [-2.0, -0.75, 175], pd: 62.0, current: true },
  { at: '2025-04-18', r: [-2.25, -0.5, 180], l: [-2.0, -0.75, 175], pd: 62.0, current: false },
  { at: '2024-03-15', r: [-2.0, -0.5, 180], l: [-1.75, -0.5, 175], pd: 61.5, current: false },
]

/* いまお使いのメガネ 2 本。見出しの「2本」は `is_current` の本数と必ず一致させる。 */
const glassesSeeds = [
  {
    at: '2025-04-20',
    usage: '遠近両用（お出かけ用）',
    frame: 'クラシック TR-88 マットブラウン 52□17',
    lens: '遠近両用 1.60',
  },
  {
    at: '2024-03-15',
    usage: '近用（PC作業用）',
    frame: 'ライト AL-12 ガンメタル 50□18',
    lens: '単焦点 1.60',
  },
]

/* 接客のメモ 7 件。**注意ごとに数えるのは `attention` かつ `published` の 1 件だけ**で、
 * 残る 6 件は下書きのままである（おまとめの下見が「接客のメモ 7件」と読む数でもある）。
 * 筆跡は R2 の本体を伴うのでここには置かない（seed は D1 だけを書く）。手書きは
 * `POST /api/staff/customers/:id/notes` が本体ごと足す。 */
const noteSeeds = [
  {
    kind: 'attention',
    status: 'published',
    store: CUSTOMER_STORE,
    author: 0,
    at: '2024-03-15T02:10:00.000Z',
    body: '金属アレルギーのお申し出があります。\nフレームはチタン・樹脂からご案内します。',
  },
  {
    kind: 'memo',
    status: 'draft',
    store: CUSTOMER_STORE,
    author: 0,
    at: '2026-05-12T02:20:00.000Z',
    body: 'PC作業用のレンズ交換のご相談。鼻パッドは低めに調整ずみ。',
  },
  {
    kind: 'memo',
    status: 'draft',
    store: CUSTOMER_STORE,
    author: 1,
    at: '2025-11-02T02:20:00.000Z',
    body: '右の見え方が落ちたとのこと。次回は遠近両用も一緒に考える。',
  },
  {
    kind: 'memo',
    status: 'draft',
    store: MARUNOUCHI,
    author: 2,
    at: '2025-04-20T02:20:00.000Z',
    body: '丸の内店でお渡し。フレームは 52□17。',
  },
  {
    kind: 'memo',
    status: 'draft',
    store: CUSTOMER_STORE,
    author: 0,
    at: '2025-04-18T02:20:00.000Z',
    body: '遠近は初めてとのこと。段階的にご説明する。',
  },
  {
    kind: 'memo',
    status: 'draft',
    store: CUSTOMER_STORE,
    author: 0,
    at: '2024-09-08T02:20:00.000Z',
    body: 'お仕事はPC作業が中心。手元の距離は 45cm ほど。',
  },
  {
    kind: 'memo',
    status: 'draft',
    store: CUSTOMER_STORE,
    author: 1,
    at: '2024-03-15T02:30:00.000Z',
    body: '初回のご来店。ご紹介でお越しになった。',
  },
]

/* 田中 花子 様の過去のご予約 5 件。来店済み（done）4 件と取り消し 1 件で、
 * 一覧の「4回」・候補の「4回目」・詳細の「よくご担当した者 佐藤 美咲」が同時に成り立つ
 * （AC-CUST-10）。台帳の e2e が見る 8月27日・28日 とは重ならない日だけを使う。 */
const pastVisitSeeds = [
  { customer: 7, date: '2024-03-15', staff: SATO, status: 'done', use: NEW_GLASSES },
  { customer: 7, date: '2025-04-18', staff: SATO, status: 'done', use: EYESIGHT },
  { customer: 7, date: '2025-11-02', staff: TAKAHASHI, status: 'done', use: ADJUST },
  { customer: 7, date: '2026-05-12', staff: SATO, status: 'done', use: EYESIGHT },
  { customer: 7, date: '2026-06-30', staff: SATO, status: 'cancelled', use: ADJUST },
  // おまとめの見本の 2 件。**残さない側にもご予約が 1 件ある**ので、
  // まとめたときに「予約が残す側へ付け替わる」ことをそのまま確かめられる。
  { customer: 10, date: '2026-08-13', staff: SATO, status: 'done', use: ADJUST },
  { customer: 11, date: '2026-08-20', staff: SATO, status: 'done', use: ADJUST },
]

const pastVisitRows = pastVisitSeeds.map((v, i) => {
  const startsAt = new Date(Date.parse(`${v.date}T11:00:00.000+09:00`)).toISOString()
  return {
    ...v,
    customerId: uid('0a010000', v.customer),
    id: uid('0a060000', i),
    code: `EY-${v.date.slice(2, 4)}${v.date.slice(5, 7)}-9${String(i + 1).padStart(3, '0')}`,
    startsAt,
    endsAt: after(startsAt, purposes[v.use].minutes),
  }
})

/** 改行を含む本文。SQL の 1 文を 1 行に保つため、実際の改行は `char(10)` で組み立てる。 */
const qBody = (text) => text.split('\n').map(q).join(' || char(10) || ')

/* --- 担当店舗（E2E の権限まわりが使う） ------------------------------------ *
 * 実運用では admin が service binding で配るが、dev と E2E の足場としてここに置く。 */
const memberships = [
  {
    userId: 'user-eyex-yamada',
    permissions:
      'store.read store.manage reservation.read reservation.write customer.read customer.write settings.read settings.manage',
  },
  {
    userId: 'user-eyex-nakamura',
    permissions: 'store.read reservation.read reservation.write customer.read settings.read',
  },
]

/** まだ空の列だけを埋める（手で直した行は上書きしない）。数は引用符で包まない。 */
const fillStore = (id, column, value) =>
  `UPDATE stores SET ${column} = ${typeof value === 'number' ? value : q(value)} WHERE id = ${q(id)} AND ${column} IS NULL;`

const lines = [
  `INSERT OR IGNORE INTO organizations (id, name, plan, is_disabled, created_at, revision) VALUES (${q(ORG)}, 'EYEX', 'contracted', '0', ${q(NOW)}, '1');`,
  ...stores.map(
    (s) =>
      `INSERT OR IGNORE INTO stores (id, organization_id, name, slug, phone, address, access_note, is_active, created_at) VALUES (${q(s.id)}, ${q(ORG)}, ${q(s.name)}, ${q(s.slug)}, ${q(s.phone)}, ${q(s.address)}, ${q(s.accessNote)}, '1', ${q(NOW)});`,
  ),
  ...storeInfo.flatMap((info) =>
    Object.entries(info)
      .filter(([column]) => column !== 'id')
      .map(([column, value]) => fillStore(info.id, column, value)),
  ),

  // 版（設定 6 面の楽観ロック）。3 店舗ぶん version=1 で置く。
  ...stores.map(
    (s, i) =>
      `INSERT OR IGNORE INTO store_settings_revision (id, organization_id, store_id, version, updated_at, updated_by, created_at) VALUES (${q(uid('b0050000', i))}, ${q(ORG)}, ${q(s.id)}, 1, ${q(NOW)}, NULL, ${q(NOW)});`,
  ),

  // 営業時間 7 行（銀座店）。
  ...businessHours.map(
    (h) =>
      `INSERT OR IGNORE INTO store_business_hours (id, organization_id, store_id, weekday, is_closed, opens_at, closes_at, break_start, break_end, created_at) VALUES (${q(uid('b0010000', h.weekday))}, ${q(ORG)}, ${q(GINZA)}, ${h.weekday}, ${h.opens === null ? "'1'" : "'0'"}, ${h.opens === null ? 'NULL' : q(h.opens)}, ${h.closes === null ? 'NULL' : q(h.closes)}, NULL, NULL, ${q(NOW)});`,
  ),

  // 受付を止める帯 18 行（営業する 6 曜日 × 3 本）。
  ...blackoutWindows.map((w, i) => {
    const sortOrder = i % 3
    return `INSERT OR IGNORE INTO store_blackout_windows (id, organization_id, store_id, weekday, starts_at, ends_at, label, sort_order, created_at) VALUES (${q(uid('b0020000', w.weekday * 10 + sortOrder))}, ${q(ORG)}, ${q(GINZA)}, ${w.weekday}, ${q(w.starts)}, ${q(w.ends)}, ${q(w.label)}, ${sortOrder}, ${q(NOW)});`
  }),

  // 予約の間隔 1 行（刻み 30 / 片付け 10 / 同時 3）。
  `INSERT OR IGNORE INTO store_slot_rules (id, organization_id, store_id, slot_minutes, cleanup_minutes, max_parallel, version, updated_at, updated_by, created_at) VALUES (${q(uid('b0030000', 0))}, ${q(ORG)}, ${q(GINZA)}, 30, 10, 3, 1, ${q(NOW)}, NULL, ${q(NOW)});`,

  // 臨時のお休み 1 行。
  `INSERT OR IGNORE INTO store_calendar_exceptions (id, organization_id, store_id, date, kind, opens_at, closes_at, note, created_at, created_by) VALUES (${q(uid('b0040000', 0))}, ${q(ORG)}, ${q(GINZA)}, '2026-09-30', 'closed', NULL, NULL, '棚卸しのため', ${q(NOW)}, NULL);`,

  // スタッフ 6 名。
  ...staffMembers.map(
    (m, i) =>
      `INSERT OR IGNORE INTO staff (id, organization_id, store_id, admin_user_id, display_name, kana, job_label, role, max_parallel_reservations, pin_hash, pin_updated_at, is_active, sort_order, created_at, updated_at) VALUES (${q(uid('c0010000', i))}, ${q(ORG)}, ${q(GINZA)}, ${m.adminUserId === null ? 'NULL' : q(m.adminUserId)}, ${q(m.name)}, ${q(m.kana)}, ${m.job === null ? 'NULL' : q(m.job)}, ${q(m.role)}, 1, NULL, NULL, '1', ${i}, ${q(NOW)}, ${q(NOW)});`,
  ),

  // 技能 9 行。store_id は staff.store_id の写し。
  ...staffMembers.flatMap((m, i) =>
    m.skills.map(
      (code, j) =>
        `INSERT OR IGNORE INTO staff_skills (id, organization_id, store_id, staff_id, skill_code, created_at) VALUES (${q(uid('c0020000', i * 10 + j))}, ${q(ORG)}, ${q(GINZA)}, ${q(uid('c0010000', i))}, ${q(code)}, ${q(NOW)});`,
    ),
  ),

  // 勤務の曜日テンプレート 42 行（6 名 × 7 曜日）。展開した staff_shifts は
  // 保存時と日次 Cron が作るので、ここでは正本の 42 行だけを置く。
  ...staffMembers.flatMap((m, i) =>
    m.week.map((band, weekday) => {
      const [startsAt, endsAt] = band === null ? [null, null] : band.split('-')
      const [restStart, restEnd] =
        band === null || m.rest === null ? [null, null] : m.rest.split('-')
      return `INSERT OR IGNORE INTO staff_weekly_shifts (id, organization_id, store_id, staff_id, weekday, is_off, starts_at, ends_at, break_start, break_end, effective_from, created_at) VALUES (${q(uid('c0030000', i * 10 + weekday))}, ${q(ORG)}, ${q(GINZA)}, ${q(uid('c0010000', i))}, ${weekday}, ${band === null ? "'1'" : "'0'"}, ${startsAt === null ? 'NULL' : q(startsAt)}, ${endsAt === null ? 'NULL' : q(endsAt)}, ${restStart === null ? 'NULL' : q(restStart)}, ${restEnd === null ? 'NULL' : q(restEnd)}, '2026-08-01', ${q(NOW)});`
    }),
  ),

  // 設備 7 行（1 台 1 行）。
  ...equipments.map(
    (e, i) =>
      `INSERT OR IGNORE INTO equipment (id, organization_id, store_id, name, kind, role_label, capacity, is_active, inactive_reason, ledger_display, sort_order, created_at, updated_at) VALUES (${q(uid('d0010000', i))}, ${q(ORG)}, ${q(GINZA)}, ${q(e.name)}, ${q(e.kind)}, ${q(e.role)}, 1, ${e.active ? "'1'" : "'0'"}, ${e.reason === null ? 'NULL' : q(e.reason)}, 'grey', ${i}, ${q(NOW)}, ${q(NOW)});`,
  ),

  // 点検 1 行（視力測定機 B。JST 2026年8月28日（金）10:00–12:00）。
  `INSERT OR IGNORE INTO equipment_maintenance (id, organization_id, store_id, equipment_id, starts_at, ends_at, note, created_at, created_by) VALUES (${q(uid('d0020000', 0))}, ${q(ORG)}, ${q(GINZA)}, ${q(uid('d0010000', 1))}, '2026-08-28T01:00:00.000Z', '2026-08-28T03:00:00.000Z', '定期点検（メーカー来店）', ${q(NOW)}, NULL);`,

  // ご来店の目的 6 行。
  ...purposes.map(
    (p, i) =>
      `INSERT OR IGNORE INTO visit_purposes (id, organization_id, store_id, name_internal, name_public, name_short, duration_minutes, is_web_published, is_active, sort_order, version, created_at, updated_at) VALUES (${q(uid('e0010000', i))}, ${q(ORG)}, ${q(GINZA)}, ${q(p.internal)}, ${q(p.pub)}, ${q(p.short)}, ${p.minutes}, ${q(p.web)}, '1', ${i}, 1, ${q(NOW)}, ${q(NOW)});`,
  ),

  // 「メガネを新しく作る」の必要資源 3 行。
  ...purposeRequirements.map(
    (r, i) =>
      `INSERT OR IGNORE INTO purpose_requirements (id, organization_id, purpose_id, kind, value, created_at) VALUES (${q(uid('e0020000', i))}, ${q(ORG)}, ${q(uid('e0010000', 0))}, ${q(r.kind)}, ${q(r.value)}, ${q(NOW)});`,
  ),

  // 担当店舗 2 件（店長と、設定を見るだけのスタッフ）。
  ...memberships.map(
    (m, i) =>
      `INSERT OR IGNORE INTO store_memberships (id, organization_id, store_id, user_id, permissions, created_at) VALUES (${q(uid('f0010000', i))}, ${q(ORG)}, ${q(GINZA)}, ${q(m.userId)}, ${q(m.permissions)}, ${q(NOW)});`,
  ),

  // お客様 44 名（モックの 8 行 ＋ 候補の 田中 一郎 様 ＋ 松本 一郎 様 ＋ 控え 34 名）。
  ...allCustomers.map(
    (c) =>
      `INSERT OR IGNORE INTO customers (id, organization_id, customer_number, name, kana, phone, phone_normalized, phone_last4, email, birth_date, address, memo, first_visit_at, last_visit_at, visit_count, merged_into_id, version, created_store_id, created_terminal_id, created_at, updated_at) VALUES (${q(c.id)}, ${q(ORG)}, ${q(c.number)}, ${q(c.name)}, ${q(c.kana)}, ${c.phone === null ? 'NULL' : q(c.phone)}, ${c.normalized === null ? 'NULL' : q(c.normalized)}, ${c.normalized === null ? 'NULL' : q(c.normalized.slice(-4))}, NULL, NULL, ${c.address === undefined ? 'NULL' : q(c.address)}, ${q(c.memo)}, ${c.first === null ? 'NULL' : q(visitAt(c.first))}, ${c.last === null ? 'NULL' : q(visitAt(c.last))}, ${c.visits}, NULL, 1, ${q(CUSTOMER_STORE)}, NULL, ${q(NOW)}, ${q(NOW)});`,
  ),

  // 田中 花子 様の度数 3 行。いま有効（is_current='1'）はちょうど 1 行。
  ...prescriptionSeeds.map(
    (m, i) =>
      `INSERT OR IGNORE INTO customer_prescriptions (id, organization_id, customer_id, store_id, measured_at, r_sph, r_cyl, r_axis, r_add, l_sph, l_cyl, l_axis, l_add, pd, note, is_current, created_at) VALUES (${q(uid('0a030000', i))}, ${q(ORG)}, ${q(HANAKO)}, ${q(CUSTOMER_STORE)}, ${q(m.at)}, ${m.r[0]}, ${m.r[1]}, ${m.r[2]}, NULL, ${m.l[0]}, ${m.l[1]}, ${m.l[2]}, NULL, ${m.pd}, '', ${m.current ? "'1'" : "'0'"}, ${q(NOW)});`,
  ),

  // 田中 花子 様のいまお使いのメガネ 2 本。
  ...glassesSeeds.map(
    (g, i) =>
      `INSERT OR IGNORE INTO customer_glasses (id, organization_id, customer_id, store_id, purchased_at, frame_name, lens_name, usage_label, note, is_current, created_at) VALUES (${q(uid('0a040000', i))}, ${q(ORG)}, ${q(HANAKO)}, ${q(CUSTOMER_STORE)}, ${q(g.at)}, ${q(g.frame)}, ${q(g.lens)}, ${q(g.usage)}, '', '1', ${q(NOW)});`,
  ),

  // 田中 花子 様の接客のメモ 7 件（注意ごとに数えるのは published の 1 件だけ）。
  ...noteSeeds.map(
    (n, i) =>
      `INSERT OR IGNORE INTO customer_notes (id, organization_id, customer_id, store_id, kind, body, handwriting_key, author_id, revision, status, created_at, updated_at) VALUES (${q(uid('0a050000', i))}, ${q(ORG)}, ${q(HANAKO)}, ${q(n.store)}, ${q(n.kind)}, ${qBody(n.body)}, NULL, ${q(uid('c0010000', n.author))}, 1, ${q(n.status)}, ${q(n.at)}, ${q(n.at)});`,
  ),

  // おまとめの見本の残さない側（渡会 章 様）の接客のメモ 1 件。
  `INSERT OR IGNORE INTO customer_notes (id, organization_id, customer_id, store_id, kind, body, handwriting_key, author_id, revision, status, created_at, updated_at) VALUES (${q(uid('0a050000', 90))}, ${q(ORG)}, ${q(uid('0a010000', 11))}, ${q(CUSTOMER_STORE)}, 'memo', 'フレームのご相談を承った。', NULL, ${q(uid('c0010000', 0))}, 1, 'draft', '2026-08-20T02:30:00.000Z', '2026-08-20T02:30:00.000Z');`,

  // 田中 花子 様と おまとめの見本の過去のご予約 7 件（来店済み 6 件・取り消し 1 件）と、その担当。
  ...pastVisitRows.map(
    (r) =>
      `INSERT OR IGNORE INTO reservations (id, organization_id, store_id, code, customer_id, source, status, starts_at, ends_at, duration_minutes, note_customer, note_internal, version, created_at, updated_at, created_by, cancelled_at, cancel_reason) VALUES (${q(r.id)}, ${q(ORG)}, ${q(GINZA)}, ${q(r.code)}, ${q(r.customerId)}, 'phone', ${q(r.status)}, ${q(r.startsAt)}, ${q(r.endsAt)}, ${purposes[r.use].minutes}, '', '', 1, ${q(NOW)}, ${q(NOW)}, NULL, ${r.status === 'cancelled' ? q(NOW) : 'NULL'}, ${r.status === 'cancelled' ? q('ご都合により') : 'NULL'});`,
  ),
  ...pastVisitRows.map(
    (r, i) =>
      `INSERT OR IGNORE INTO reservation_purposes (id, organization_id, reservation_id, purpose_id, duration_minutes, sort_order, created_at) VALUES (${q(uid('0a070000', i))}, ${q(ORG)}, ${q(r.id)}, ${q(uid('e0010000', r.use))}, ${purposes[r.use].minutes}, 0, ${q(NOW)});`,
  ),
  ...pastVisitRows.map(
    (r, i) =>
      `INSERT OR IGNORE INTO reservation_assignments (id, organization_id, reservation_id, kind, target_id, starts_at, ends_at, created_at) VALUES (${q(uid('0a080000', i))}, ${q(ORG)}, ${q(r.id)}, 'staff', ${q(uid('c0010000', r.staff))}, ${q(r.startsAt)}, ${q(r.endsAt)}, ${q(NOW)});`,
  ),

  // 当日の勤務（曜日テンプレートを 2026-08-27 から 5 週間ぶん日付へ展開したもの）。
  ...shiftRows.map(
    (r) =>
      `INSERT OR IGNORE INTO staff_shifts (id, organization_id, store_id, staff_id, date, starts_at, ends_at, kind, created_at) VALUES (${q(uid('c0040000', r.n))}, ${q(ORG)}, ${q(GINZA)}, ${q(uid('c0010000', r.staffIndex))}, ${q(r.date)}, ${q(r.startsAt)}, ${q(r.endsAt)}, ${q(r.kind)}, ${q(NOW)});`,
  ),

  // 2026年8月27日（木）のご予約 12 行。3 件だけ `customer_id` が入る
  // （10:00 伊藤 健 様／11:00 田中 花子 様／14:00 松本 一郎 様）。
  // created_by は全件 NULL（共有端末で個人未確認）にする。
  ...reservationRows.map(
    (r) =>
      `INSERT OR IGNORE INTO reservations (id, organization_id, store_id, code, customer_id, source, status, starts_at, ends_at, duration_minutes, note_customer, note_internal, version, created_at, updated_at, created_by, cancelled_at, cancel_reason) VALUES (${q(r.id)}, ${q(ORG)}, ${q(GINZA)}, ${q(r.code)}, ${r.seed.customer === undefined ? 'NULL' : q(uid('0a010000', r.seed.customer))}, ${q(r.seed.source)}, ${q(r.seed.status)}, ${q(r.startsAt)}, ${q(r.endsAt)}, ${r.seed.minutes}, ${q(r.seed.noteCustomer ?? '')}, ${q(r.seed.noteInternal ?? '')}, 1, ${q(NOW)}, ${q(NOW)}, NULL, NULL, NULL);`,
  ),

  // ご用件。所要時間は予約した時点の写しなので、目的を直しても既存のご予約は動かない。
  ...reservationRows.flatMap((r, i) =>
    r.seed.use.map(
      (purposeIndex, j) =>
        `INSERT OR IGNORE INTO reservation_purposes (id, organization_id, reservation_id, purpose_id, duration_minutes, sort_order, created_at) VALUES (${q(uid('a0020000', i * 10 + j))}, ${q(ORG)}, ${q(r.id)}, ${q(uid('e0010000', purposeIndex))}, ${purposes[purposeIndex].minutes}, ${j}, ${q(NOW)});`,
    ),
  ),

  // 担当・設備の押さえ。`kind='staff'` の行は担当が未定でも必ず 1 行ある（I-05）。
  ...reservationRows.flatMap((r, i) =>
    r.bands.map(
      (band, j) =>
        `INSERT OR IGNORE INTO reservation_assignments (id, organization_id, reservation_id, kind, target_id, starts_at, ends_at, created_at) VALUES (${q(uid('a0030000', i * 10 + j))}, ${q(ORG)}, ${q(r.id)}, ${q(band.kind)}, ${band.targetId === null ? 'NULL' : q(band.targetId)}, ${q(band.startsAt)}, ${q(band.endsAt)}, ${q(NOW)});`,
    ),
  ),

  /*
   * 銀座店の Web 予約の受付条件 1 行（P8）。丸の内・新宿は行を置かない —— 行が無い店舗は
   * 「公開していない」として `/api/public/stores` に最初から出ない、という決めの実データである。
   * 値は `P8-web-booking.md` T-020 の指定どおり: 10:30–18:00 ／ 2 時間先から ／ 30 日先まで ／
   * 変更・取消は前日まで ／ ご予約の確定は「お店が確かめてから確定する」。
   */
  `INSERT OR IGNORE INTO web_booking_settings (id, organization_id, store_id, is_published, opens_at, closes_at, accept_from_hours, accept_until_days, change_deadline_days, requires_approval, message, version, updated_at, created_at) VALUES (${q(uid('e0030000', 0))}, ${q(ORG)}, ${q(GINZA)}, '1', '10:30', '18:00', 2, 30, 1, '1', ${q('ご来店のご予約を承ります。当日のご来店も歓迎しております。')}, 1, ${q(NOW)}, ${q(NOW)});`,

  // 枠の一次排他。確定の経路（006-booking-flow）と同じ内容を刻みへ展開して置く。
  ...reservationRows.flatMap((r, i) =>
    r.locks.map(
      (lock, j) =>
        `INSERT OR IGNORE INTO reservation_slot_locks (id, organization_id, store_id, reservation_id, kind, target_key, slot_start, created_at) VALUES (${q(uid('a0040000', i * 100 + j))}, ${q(ORG)}, ${q(GINZA)}, ${q(r.id)}, ${q(lock.kind)}, ${q(lock.targetKey)}, ${q(lock.slotStart)}, ${q(NOW)});`,
    ),
  ),
]

const sqlPath = join(mkdtempSync(join(tmpdir(), 'glasses-seed-')), 'seed.sql')
writeFileSync(sqlPath, lines.join('\n'))

execFileSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'glasses_management',
    REMOTE ? '--remote' : '--local',
    ...(REMOTE || PERSIST_TO === undefined ? [] : ['--persist-to', PERSIST_TO]),
    '--file',
    sqlPath,
    '--yes',
  ],
  { cwd: import.meta.dirname, stdio: 'inherit' },
)

console.log(`\n✅ seeded glasses_management D1 [${REMOTE ? 'REMOTE(本番)' : 'local'}]`)
console.log(`   組織: ${ORG}（EYEX）／ 店舗: ${stores.map((s) => s.name).join('・')}`)
console.log(
  `   銀座店の受付条件: 営業時間 ${businessHours.length} 行 ／ 止める帯 ${blackoutWindows.length} 行 ／ ` +
    `スタッフ ${staffMembers.length} 名（技能 ${staffMembers.reduce((n, m) => n + m.skills.length, 0)} 行・` +
    `勤務 ${staffMembers.length * 7} 行）／ 設備 ${equipments.length} 行 ／ 目的 ${purposes.length} 件`,
)
console.log(
  `   ${LEDGER_DATE} の台帳: ご予約 ${reservationRows.length} 件（担当が未定 ` +
    `${reservationRows.filter((r) => r.seed.staff === null).length} 件・Web ` +
    `${reservationRows.filter((r) => r.seed.source === 'web').length} 件）／ 押さえ ` +
    `${reservationRows.reduce((n, r) => n + r.bands.length, 0)} 行 ／ 枠 ` +
    `${reservationRows.reduce((n, r) => n + r.locks.length, 0)} 行 ／ 勤務 ${shiftRows.length} 行`,
)
console.log(
  `   顧客台帳: お客様 ${allCustomers.length} 名（ご来店 2〜4回 ` +
    `${allCustomers.filter((c) => c.visits >= 2 && c.visits <= 4).length} 名）／ ` +
    `田中 花子 様の度数 ${prescriptionSeeds.length} 件・メガネ ${glassesSeeds.length} 本・` +
    `接客のメモ ${noteSeeds.length} 件・過去のご予約 ${pastVisitRows.length} 件`,
)
console.log('   業務開始の画面では、お店のコードに org-eyex-seed を入れる。')
