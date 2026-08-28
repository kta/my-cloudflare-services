/**
 * 受付条件のドメイン純関数（`src/worker/domain/store-settings.ts`）の境界を固定する。
 *
 * この面の関数は D1 を触らず、**時刻をすべて引数で受ける**。`Date.now()` を
 * 呼ぶと「今日が木曜かどうか」でテストの意味が変わってしまい、閉店間際の
 * 受付という一番壊れてはいけない判定が実行日に依存する。
 *
 * 盤面は銀座店（`design/03-data-model.md` §4.2 / §4.5 の seed）。
 * 月・水・木・土 10:00–19:00 ／ 火 定休 ／ 金 11:00–20:00 ／ 日 10:00–18:00。
 */
import { describe, expect, it } from 'vitest'
import {
  acceptableWindows,
  addJstDays,
  type BlackoutBand,
  businessDateOf,
  type DayException,
  lastAcceptableByWeekday,
  lastAcceptableStart,
  resolveBusinessDay,
  validateBlackouts,
  validateBusinessHours,
  validateHoursInput,
  validateIntroText,
  type WeeklyHours,
  warnBusinessHours,
  warnEquipmentKindsWithoutUnits,
  warnShiftOutsideHours,
  warnSkillsWithoutStaff,
  weekdayOf,
} from '../src/worker/domain/store-settings'

/** 銀座店の曜日 7 行。0=日 … 6=土。 */
const GINZA_WEEK: WeeklyHours[] = [
  { weekday: 0, isClosed: false, opensAt: '10:00', closesAt: '18:00' },
  { weekday: 1, isClosed: false, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 2, isClosed: true, opensAt: null, closesAt: null },
  { weekday: 3, isClosed: false, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 4, isClosed: false, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 5, isClosed: false, opensAt: '11:00', closesAt: '20:00' },
  { weekday: 6, isClosed: false, opensAt: '10:00', closesAt: '19:00' },
]

/** 木曜の止める帯 3 本（朝の支度・お昼・閉店前の片付け）。 */
const THURSDAY_BANDS: BlackoutBand[] = [
  { weekday: 4, startsAt: '12:00', endsAt: '13:00' },
  { weekday: 4, startsAt: '10:00', endsAt: '10:15' },
  { weekday: 4, startsAt: '18:40', endsAt: '19:00' },
]

/** 金曜の止める帯 2 本。開店が 11:00 なので朝の支度がずれ、閉店前の帯は置いていない。 */
const FRIDAY_BANDS: BlackoutBand[] = [
  { weekday: 5, startsAt: '11:00', endsAt: '11:15' },
  { weekday: 5, startsAt: '12:00', endsAt: '13:00' },
]

/** 木曜（2026-08-27）の受付できる区間。 */
const thursdayWindows = () => acceptableWindows('10:00', '19:00', THURSDAY_BANDS)

describe('最後にお受けできる時刻', () => {
  it('木曜 10:00–19:00・帯 18:40–19:00・片付け 10分・刻み 30分・最短の目的 20分 なら 18:20', () => {
    // SETTINGS-HOURS 末尾の「木曜日に最後にお受けできるのは 18:20 です。」そのもの。
    // 18:20 + 20分 + 片付け 10分 = 18:50 で閉店 19:00 に収まる。
    expect(
      lastAcceptableStart({
        windows: thursdayWindows(),
        shortestDurationMinutes: 20,
        cleanupMinutes: 10,
        closesAt: '19:00',
      }),
    ).toBe('18:20')
  })

  it('定休の火曜は null を返す', () => {
    const tuesday = resolveBusinessDay({
      date: '2026-09-01',
      weeklyRows: GINZA_WEEK,
      blackouts: THURSDAY_BANDS,
    })
    expect(tuesday.weekday).toBe(2)
    expect(
      lastAcceptableStart({
        windows: tuesday.windows,
        shortestDurationMinutes: 20,
        cleanupMinutes: 10,
        closesAt: tuesday.closesAt,
      }),
    ).toBeNull()
  })

  it('金曜 11:00–20:00 では 19:40 になる（曜日ごとに違う閉店を読む）', () => {
    // 金曜は閉店前の帯を置いていないので、最後の区間は閉店ちょうどで終わる。
    // 片付けを取らない設定（0分）なので、閉店から最短の所要だけを引く。
    const friday = resolveBusinessDay({
      date: '2026-08-28',
      weeklyRows: GINZA_WEEK,
      blackouts: FRIDAY_BANDS,
    })
    expect(friday.closesAt).toBe('20:00')
    expect(
      lastAcceptableStart({
        windows: friday.windows,
        shortestDurationMinutes: 20,
        cleanupMinutes: 0,
        closesAt: friday.closesAt,
      }),
    ).toBe('19:40')
  })

  it('最短の目的の所要が閉店までに収まらない曜日は null を返す', () => {
    // 開けている時間が 15 分しかない日。20 分のご用件は 1 件も置けない。
    expect(
      lastAcceptableStart({
        windows: [{ startsAt: '10:00', endsAt: '10:15' }],
        shortestDurationMinutes: 20,
        cleanupMinutes: 0,
        closesAt: '10:15',
      }),
    ).toBeNull()
    // 閉店が分からない日は区間の終わりだけで決める。
    expect(
      lastAcceptableStart({
        windows: [{ startsAt: '10:00', endsAt: '12:00' }],
        shortestDurationMinutes: 20,
        cleanupMinutes: 10,
        closesAt: null,
      }),
    ).toBe('11:40')
  })

  it('片付けが帯の長さを超えると、閉店から片付けを引いた時刻まで下がる', () => {
    // 帯は 18:40–19:00 の 20 分ぶんしか無いのに片付けが 30 分なので、
    // 区間の終わり（18:40）ではなく 閉店 19:00 − 片付け 30分 = 18:30 が上限になる。
    expect(
      lastAcceptableStart({
        windows: thursdayWindows(),
        shortestDurationMinutes: 20,
        cleanupMinutes: 30,
        closesAt: '19:00',
      }),
    ).toBe('18:10')
  })
})

describe('受付できる区間', () => {
  it('帯を差し引くと 10:15–12:00 と 13:00–18:40 の 2 区間になる', () => {
    expect(thursdayWindows()).toEqual([
      { startsAt: '10:15', endsAt: '12:00' },
      { startsAt: '13:00', endsAt: '18:40' },
    ])
  })

  it('10:00 ちょうどに始まる帯は最初の区間を 10:15 から始める', () => {
    // 開店ちょうどに始まる帯で長さ 0 の区間を作らない（押せない枠が出る）。
    const windows = thursdayWindows()
    expect(windows[0]?.startsAt).toBe('10:15')
    expect(windows.some((w) => w.startsAt === w.endsAt)).toBe(false)
  })
})

describe('営業時間の解決', () => {
  it('例外の行がある日は曜日の行を一切見ない', () => {
    const exceptions: DayException[] = [
      // 木曜（通常 10:00–19:00）を特別営業 09:00–15:00 に差し替える。
      { date: '2026-08-27', kind: 'special', opensAt: '09:00', closesAt: '15:00', note: null },
      // 火曜（定休）を特別営業として開ける。
      { date: '2026-09-01', kind: 'special', opensAt: '13:00', closesAt: '17:00', note: null },
    ]
    const thursday = resolveBusinessDay({
      date: '2026-08-27',
      weeklyRows: GINZA_WEEK,
      exceptions,
      blackouts: THURSDAY_BANDS,
    })
    expect([thursday.opensAt, thursday.closesAt]).toEqual(['09:00', '15:00'])

    const tuesday = resolveBusinessDay({ date: '2026-09-01', weeklyRows: GINZA_WEEK, exceptions })
    expect(tuesday.isClosed).toBe(false)
    expect([tuesday.opensAt, tuesday.closesAt]).toEqual(['13:00', '17:00'])
  })

  it("kind='closed' の日は区間が 0 本になる", () => {
    const day = resolveBusinessDay({
      date: '2026-09-30',
      weeklyRows: GINZA_WEEK,
      exceptions: [
        { date: '2026-09-30', kind: 'closed', opensAt: null, closesAt: null, note: '棚卸しのため' },
      ],
      blackouts: THURSDAY_BANDS,
    })
    expect(day.isClosed).toBe(true)
    expect([day.opensAt, day.closesAt]).toEqual([null, null])
    expect(day.windows).toEqual([])

    // 特別営業なのに時刻が欠けている行も、枠を作らず定休として扱う。
    const broken = resolveBusinessDay({
      date: '2026-09-30',
      weeklyRows: GINZA_WEEK,
      exceptions: [{ date: '2026-09-30', kind: 'special', opensAt: null, closesAt: null }],
    })
    expect(broken.isClosed).toBe(true)
    expect(broken.windows).toEqual([])
  })

  it("kind='special' の日は例外の開店・閉店を使い、帯は曜日のものを引き続き差し引く", () => {
    const day = resolveBusinessDay({
      date: '2026-08-27',
      weeklyRows: GINZA_WEEK,
      exceptions: [
        { date: '2026-08-27', kind: 'special', opensAt: '09:00', closesAt: '15:00', note: null },
      ],
      blackouts: THURSDAY_BANDS,
    })
    // 09:00 開店なので朝の支度（10:00–10:15）は日中の帯になり、
    // 閉店 15:00 より後ろの帯（18:40–19:00）は区間に影響しない。
    expect(day.windows).toEqual([
      { startsAt: '09:00', endsAt: '10:00' },
      { startsAt: '10:15', endsAt: '12:00' },
      { startsAt: '13:00', endsAt: '15:00' },
    ])
  })

  it('曜日の行が欠けている日は定休として扱う', () => {
    // 7 行そろっているのが正常。欠けた曜日で枠を作ると、店が開いていない日に
    // お受けしてしまう。
    const day = resolveBusinessDay({
      date: '2026-08-27',
      weeklyRows: GINZA_WEEK.filter((row) => row.weekday !== 4),
      blackouts: THURSDAY_BANDS,
    })
    expect(day.isClosed).toBe(true)
    expect(day.windows).toEqual([])
  })
})

describe('JST の日跨ぎ', () => {
  it('UTC 15:00 ちょうどは翌日の JST 0:00 として解ける', () => {
    expect(businessDateOf('2026-08-27T14:59:59.999Z')).toBe('2026-08-27')
    expect(businessDateOf('2026-08-27T15:00:00.000Z')).toBe('2026-08-28')
    // 木曜の 19:00 閉店ではなく、金曜の 20:00 閉店を読む。
    const day = resolveBusinessDay({
      date: businessDateOf('2026-08-27T15:00:00.000Z'),
      weeklyRows: GINZA_WEEK,
      blackouts: FRIDAY_BANDS,
    })
    expect([day.weekday, day.opensAt, day.closesAt]).toEqual([5, '11:00', '20:00'])
  })

  it('2028-02-29 の翌日は 2028-03-01 になる', () => {
    expect(addJstDays('2028-02-29', 1)).toBe('2028-03-01')
    expect(weekdayOf('2028-02-29')).toBe(2)
    expect(weekdayOf('2028-03-01')).toBe(3)
  })

  it('2026-08-31 の翌日は 2026-09-01 になる（月末）', () => {
    expect(addJstDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addJstDays('2026-09-01', -1)).toBe('2026-08-31')
    expect(addJstDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('曜日', () => {
  it('2026-08-27 は木曜（weekday=4）である', () => {
    expect(weekdayOf('2026-08-27')).toBe(4)
    expect(weekdayOf('2026-08-28')).toBe(5)
    expect(weekdayOf('2026-08-30')).toBe(0)
  })
})

describe('曜日ごとの最後にお受けできる時刻', () => {
  it('7 曜日ぶんを返し、定休の火曜だけ null になる', () => {
    const map = lastAcceptableByWeekday({
      rows: GINZA_WEEK,
      blackouts: [...THURSDAY_BANDS, ...FRIDAY_BANDS],
      shortestDurationMinutes: 20,
      cleanupMinutes: 10,
    })
    expect(Object.keys(map)).toEqual(['0', '1', '2', '3', '4', '5', '6'])
    expect(map['2']).toBeNull()
    // 木曜だけ帯を持つので 18:20。帯の無い月曜は 19:00 − 20分 − 片付け 10分。
    expect(map['4']).toBe('18:20')
    expect(map['1']).toBe('18:30')
  })
})

describe('保存を拒む 3 条件', () => {
  it('閉店が開店と同じ時刻の行を拒む', () => {
    const rows = GINZA_WEEK.map((row) => (row.weekday === 4 ? { ...row, closesAt: '10:00' } : row))
    expect(validateBusinessHours(rows)).toEqual([
      {
        code: 'closes_before_opens',
        message: '閉店が開店より前のため保存できません。閉店の時刻を直してください。',
      },
    ])
    // 閉店が開店以前の行は区間も 0 本になる（拒む前から枠を作らない）。
    expect(acceptableWindows('10:00', '10:00', [])).toEqual([])
  })

  it('止める帯が営業時間の外にはみ出す行を拒む', () => {
    // 閉店 19:00 の木曜に 19:00–19:30 の帯を足した。
    expect(validateBlackouts([{ startsAt: '19:00', endsAt: '19:30' }], '10:00', '19:00')).toEqual([
      {
        code: 'blackout_outside_hours',
        message: '受付を止める時間帯が営業時間の外にあるため保存できません。時間を直してください。',
      },
    ])
    expect(validateBlackouts(THURSDAY_BANDS, '10:00', '19:00')).toEqual([])
    // 定休の曜日に帯が残っている保存も同じ理由で拒む（開いていない時間は止められない）。
    expect(validateBlackouts(THURSDAY_BANDS, null, null)).toHaveLength(1)
    expect(validateBlackouts([], null, null)).toEqual([])
  })

  it('紹介文が 201 文字なら拒み、200 文字ちょうどは通す', () => {
    expect(validateIntroText('あ'.repeat(200))).toEqual([])
    expect(validateIntroText(null)).toEqual([])
    expect(validateIntroText('あ'.repeat(201))).toEqual([
      {
        code: 'intro_text_too_long',
        message: '紹介文が 200 文字を超えているため保存できません。文字数を減らしてください。',
      },
    ])
  })

  it('定休の曜日は開店・閉店を見ないので拒まない', () => {
    expect(validateBusinessHours(GINZA_WEEK)).toEqual([])
    expect(validateHoursInput({ rows: GINZA_WEEK, blackouts: THURSDAY_BANDS })).toEqual([])
  })

  it('同じ理由が何曜日に出ても 1 件にまとめる（画面に同じ 2 文を並べない）', () => {
    const rows = GINZA_WEEK.map((row) =>
      row.weekday === 1 || row.weekday === 4 ? { ...row, closesAt: row.opensAt } : row,
    )
    expect(validateHoursInput({ rows, blackouts: [] })).toEqual([
      {
        code: 'closes_before_opens',
        message: '閉店が開店より前のため保存できません。閉店の時刻を直してください。',
      },
    ])
    // 理由が 2 種類あるときは 2 件返す（同じ理由だけをまとめる）。
    expect(
      validateHoursInput({
        rows,
        blackouts: [{ weekday: 3, startsAt: '19:00', endsAt: '19:30' }],
      }).map((r) => r.code),
    ).toEqual(['closes_before_opens', 'blackout_outside_hours'])
  })
})

describe('警告どまりの 4 条件', () => {
  it('刻みが片付けより短いと警告を 1 件返す', () => {
    expect(warnBusinessHours({ slotMinutes: 30, cleanupMinutes: 10 })).toEqual([])
    expect(warnBusinessHours({ slotMinutes: 15, cleanupMinutes: 20 })).toEqual([
      '予約の刻み（15分）が 1件あたりの片付け（20分）より短いため、続けてお受けできない時刻ができます。',
    ])
  })

  it('技能を持つ担当が 0 人になると警告を返す', () => {
    expect(
      warnSkillsWithoutStaff({
        requiredSkills: ['measure', 'fitting'],
        availableSkills: ['measure', 'sales_reception'],
      }),
    ).toEqual([
      'フィッティング ができる担当が 1人もいません。この技能が要るご用件は受けられなくなります。',
    ])
  })

  it('その種別の設備が 0 台になると警告を返す', () => {
    expect(
      warnEquipmentKindsWithoutUnits({
        requiredKinds: ['measure', 'counter'],
        availableKinds: ['counter'],
      }),
    ).toEqual(['視力測定機 が 1台も使えません。この設備が要るご用件は受けられなくなります。'])
  })

  it('日曜の勤務が営業時間の外にはみ出すと警告する', () => {
    // AC-SET-12 の文そのもの。保存は拒まない。
    expect(
      warnShiftOutsideHours(
        { weekday: 0, isOff: false, startsAt: '12:00', endsAt: '19:00' },
        { weekday: 0, isClosed: false, opensAt: '10:00', closesAt: '18:00' },
      ),
    ).toEqual(['日曜日の勤務が営業時間（10:00–18:00）の外にはみ出しています。'])
  })

  it('定休の曜日に勤務が入っていても警告どまりで通す', () => {
    expect(
      warnShiftOutsideHours(
        { weekday: 2, isOff: false, startsAt: '10:00', endsAt: '19:00' },
        { weekday: 2, isClosed: true, opensAt: null, closesAt: null },
      ),
    ).toEqual(['火曜日は定休日ですが勤務が入っています。'])
    expect(
      warnShiftOutsideHours(
        { weekday: 0, isOff: true, startsAt: null, endsAt: null },
        { weekday: 0, isClosed: false, opensAt: '10:00', closesAt: '18:00' },
      ),
    ).toEqual([])
    expect(
      warnShiftOutsideHours(
        { weekday: 0, isOff: false, startsAt: '10:00', endsAt: '18:00' },
        { weekday: 0, isClosed: false, opensAt: '10:00', closesAt: '18:00' },
      ),
    ).toEqual([])
  })

  it('警告の 4 条件はどれも拒否の一覧に現れない', () => {
    // 刻み 15分 < 片付け 20分・日曜の勤務がはみ出す盤面でも、保存は止まらない。
    expect(validateHoursInput({ rows: GINZA_WEEK, blackouts: THURSDAY_BANDS })).toEqual([])
    expect(warnBusinessHours({ slotMinutes: 15, cleanupMinutes: 20 })).toHaveLength(1)
  })
})
