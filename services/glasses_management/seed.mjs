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
console.log('   業務開始の画面では、お店のコードに org-eyex-seed を入れる。')
