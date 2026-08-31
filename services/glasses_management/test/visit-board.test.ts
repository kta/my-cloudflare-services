/**
 * 来店受付ボードの組み立て（`src/worker/domain/visit-board.ts`）を固定する。
 *
 * 盤面は承認済みモック **RECEPTION-JOURNEY**（銀座店 2026年8月27日（木）11:08）そのものである。
 * 4 行 6 列で、田中 花子 様・ウォークイン 003・山口 真央 様・伊藤 健 様が並び、
 * 右上が「ご来店中 4名」になる。このファイルの土台（`board()`）はその 4 行を写している。
 *
 * ここで見るのは**純関数だけ**である。D1 にも実時刻にも触れず、読み出した行と `now` を
 * すべて引数で渡す。工程は `visit_events` の**追記だけ**の並びから毎回組み立てるので、
 * 同じ入力からは何度でも同じ盤面が出る。
 *
 * **「済みました」の時刻はその工程が始まった時刻である。**モックの 伊藤 健 様
 * （受付 10:42 / ご相談 10:52 / レンズ・お会計 11:01 / お渡し 対応中 11:04〜）は
 * 終了時刻（＝次の工程の開始時刻）では 1 つも再現できず、開始時刻でちょうど一致する。
 */
import { VisitBoard, VisitStage } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import type { MaintenanceBand, StaffShiftBand } from '../src/worker/domain/availability'
import {
  BOARD_STAGES,
  type BoardSubjectRow,
  type BoardVisitEvent,
  type BuildBoardOptions,
  buildBoard,
  planBoardSteps,
} from '../src/worker/domain/visit-board'
import { FIXED_NOW, LEDGER_DATE } from './helpers'

const id = () => crypto.randomUUID()

/** JST の壁時計を UTC の ISO8601 に直す。`11:02` は `2026-08-27T02:02:00.000Z`。 */
function jst(time: string, date = LEDGER_DATE): string {
  return new Date(Date.parse(`${date}T${time}:00.000Z`) - 9 * 60 * 60_000).toISOString()
}

/** 応答の `serverNow`。JST 11:08。端末の時計は 1 度も読まない。 */
const SERVER_NOW = new Date(FIXED_NOW)

const STAFF = { sato: id(), takahashi: id(), nakamura: id() }
const EQUIPMENT = { measureA: id(), measureB: id() }
const SUBJECT = { hanako: id(), walkin3: id(), mao: id(), ken: id() }

/** 工程の記録 1 行。 */
function event(
  subjectId: string,
  stage: VisitStage,
  time: string,
  subjectType: 'reservation' | 'walkin' = 'reservation',
): BoardVisitEvent {
  return { subjectType, subjectId, stage, occurredAt: jst(time) }
}

/** モックの 4 行。行の並びは読み出した順のままで、盤面が勝手に並べ替えない。 */
const ROWS: BoardSubjectRow[] = [
  {
    subjectType: 'reservation',
    subjectId: SUBJECT.hanako,
    customerName: '田中 花子',
    ticketNo: null,
    visitCount: 4,
    purposeLabel: 'メガネを新しく作る',
    next: {
      stage: 'measuring',
      label: '視力測定機 A',
      staffId: STAFF.sato,
      equipmentId: EQUIPMENT.measureA,
    },
  },
  {
    subjectType: 'walkin',
    subjectId: SUBJECT.walkin3,
    customerName: null,
    ticketNo: 3,
    visitCount: null,
    purposeLabel: 'フレームのご相談',
    next: null,
  },
  {
    subjectType: 'reservation',
    subjectId: SUBJECT.mao,
    customerName: '山口 真央',
    ticketNo: null,
    visitCount: 1,
    purposeLabel: '視力測定だけ',
    next: {
      stage: 'measuring',
      label: '視力測定機 B',
      staffId: STAFF.takahashi,
      equipmentId: EQUIPMENT.measureB,
    },
  },
  {
    subjectType: 'reservation',
    subjectId: SUBJECT.ken,
    customerName: '伊藤 健',
    ticketNo: null,
    visitCount: 2,
    purposeLabel: '今のメガネを調整',
    next: null,
  },
]

/** モックの工程。伊藤 健 様は フレーム選び と 視力測定 を飛ばしている。 */
const EVENTS: BoardVisitEvent[] = [
  event(SUBJECT.hanako, 'received', '10:55'),
  event(SUBJECT.hanako, 'consulting', '11:02'),
  event(SUBJECT.hanako, 'fitting', '11:02'),
  event(SUBJECT.walkin3, 'received', '10:50', 'walkin'),
  event(SUBJECT.mao, 'received', '10:58'),
  event(SUBJECT.mao, 'consulting', '11:02'),
  event(SUBJECT.ken, 'received', '10:42'),
  event(SUBJECT.ken, 'consulting', '10:52'),
  event(SUBJECT.ken, 'checkout', '11:01'),
  event(SUBJECT.ken, 'handover', '11:04'),
]

describe('目的の要件から次工程を組み立てる', () => {
  it('要件が未設定の既存目的でも、割当済み設備を設備種別の工程へ残す', () => {
    expect(
      planBoardSteps({
        requiredSkills: [],
        requiredEquipmentKinds: [],
        staffId: STAFF.sato,
        equipment: [
          { id: EQUIPMENT.measureA, name: '視力測定機 A', kind: 'measure', sortOrder: 0 },
        ],
      }),
    ).toEqual([
      {
        stage: 'measuring',
        label: '視力測定機 A',
        staffId: STAFF.sato,
        equipmentId: EQUIPMENT.measureA,
      },
    ])
  })

  it('同じ視力測定工程の技能と設備を1件へまとめ、設備名を表示する', () => {
    expect(
      planBoardSteps({
        requiredSkills: ['measure'],
        requiredEquipmentKinds: ['measure'],
        staffId: STAFF.sato,
        equipment: [
          { id: EQUIPMENT.measureA, name: '視力測定機 A', kind: 'measure', sortOrder: 0 },
        ],
      }),
    ).toEqual([
      {
        stage: 'measuring',
        label: '視力測定機 A',
        staffId: STAFF.sato,
        equipmentId: EQUIPMENT.measureA,
      },
    ])
  })

  it('複数工程は盤面順に並べ、設備のない技能工程も残す', () => {
    expect(
      planBoardSteps({
        requiredSkills: ['processing', 'fitting'],
        requiredEquipmentKinds: ['counter'],
        staffId: STAFF.sato,
        equipment: [{ id: id(), name: '相談カウンター 2', kind: 'counter', sortOrder: 0 }],
      }).map((step) => ({ stage: step.stage, label: step.label })),
    ).toEqual([
      { stage: 'consulting', label: '相談カウンター 2' },
      { stage: 'fitting', label: '' },
      { stage: 'checkout', label: '' },
    ])
  })
})

/** 銀座店 1 日分の盤面。`now` は必ず引数で渡す。 */
function board(
  overrides: {
    rows?: BoardSubjectRow[]
    events?: BoardVisitEvent[]
    options?: Partial<BuildBoardOptions>
  } = {},
): VisitBoard {
  return buildBoard(overrides.rows ?? ROWS, overrides.events ?? EVENTS, {
    date: LEDGER_DATE,
    now: SERVER_NOW,
    ...overrides.options,
  })
}

/** 1 行を subjectId で引く。 */
function rowOf(view: VisitBoard, subjectId: string) {
  const found = view.rows.find((row) => row.subjectId === subjectId)
  if (found === undefined) throw new Error(`行が無い: ${subjectId}`)
  return found
}

/** 1 欄を工程で引く。 */
function cellOf(view: VisitBoard, subjectId: string, stage: VisitStage) {
  const found = rowOf(view, subjectId).cells.find((cell) => cell.stage === stage)
  if (found === undefined) throw new Error(`欄が無い: ${stage}`)
  return found
}

describe('列の並び', () => {
  it('受付・ご相談・フレーム選び・視力測定・レンズ・お会計・お渡しの 6 列をこの順で返す', () => {
    expect(BOARD_STAGES).toEqual([
      'received',
      'consulting',
      'fitting',
      'measuring',
      'checkout',
      'handover',
    ])
    const view = board()
    // 契約を通す。1 欄の綻びで盤面がまるごと 500 になる形を先に潰す。
    expect(() => VisitBoard.parse(view)).not.toThrow()
    for (const row of view.rows) {
      expect(row.cells.map((cell) => cell.stage)).toEqual([...BOARD_STAGES])
    }
  })

  it('stage の宣言順ではなく画面の並びで返す', () => {
    // 宣言順は received / waiting / measuring / consulting / fitting / checkout / handover / left。
    // 列を宣言順から作ると 視力測定 が ご相談 の左に来る。
    const declared = VisitStage.options.filter((stage) => stage !== 'waiting' && stage !== 'left')
    expect(declared).not.toEqual([...BOARD_STAGES])
    expect(board().rows[0]?.cells.map((cell) => cell.stage)).toEqual([...BOARD_STAGES])
  })

  it('waiting と left は列を持たない', () => {
    expect(BOARD_STAGES).not.toContain('waiting')
    expect(BOARD_STAGES).not.toContain('left')
    const view = board()
    for (const row of view.rows) {
      expect(row.cells).toHaveLength(6)
      expect(row.cells.some((cell) => cell.stage === 'waiting')).toBe(false)
      expect(row.cells.some((cell) => cell.stage === 'left')).toBe(false)
    }
  })
})

describe('セルの状態', () => {
  it('済んだ工程は done とその工程が始まった時刻を持つ', () => {
    const view = board()
    expect(cellOf(view, SUBJECT.hanako, 'received')).toMatchObject({
      state: 'done',
      at: jst('10:55'),
    })
    expect(cellOf(view, SUBJECT.hanako, 'consulting')).toMatchObject({
      state: 'done',
      at: jst('11:02'),
    })
    // 伊藤 健 様は 受付 10:42 → ご相談 10:52 → レンズ・お会計 11:01。
    expect(cellOf(view, SUBJECT.ken, 'received').at).toBe(jst('10:42'))
    expect(cellOf(view, SUBJECT.ken, 'consulting').at).toBe(jst('10:52'))
    expect(cellOf(view, SUBJECT.ken, 'checkout').at).toBe(jst('11:01'))
  })

  it('いま進んでいる工程は doing と開始時刻を持つ', () => {
    const view = board()
    expect(cellOf(view, SUBJECT.hanako, 'fitting')).toMatchObject({
      state: 'doing',
      at: jst('11:02'),
    })
    expect(cellOf(view, SUBJECT.mao, 'consulting')).toMatchObject({
      state: 'doing',
      at: jst('11:02'),
    })
    expect(cellOf(view, SUBJECT.ken, 'handover')).toMatchObject({
      state: 'doing',
      at: jst('11:04'),
    })
  })

  it('対応中は 1 人 1 工程だけ', () => {
    for (const row of board({ options: { scope: 'all' } }).rows) {
      expect(row.cells.filter((cell) => cell.state === 'doing').length).toBeLessThanOrEqual(1)
    }
    // 受付は点の記録なので「対応中」にしない（ウォークイン 003 は受付が最後の記録）。
    expect(cellOf(board(), SUBJECT.walkin3, 'received').state).toBe('done')
  })

  it('次にやることは next と設備名を label に持つ', () => {
    const view = board()
    expect(cellOf(view, SUBJECT.hanako, 'measuring')).toMatchObject({
      state: 'next',
      label: '視力測定機 A',
      at: null,
    })
    expect(cellOf(view, SUBJECT.mao, 'measuring')).toMatchObject({
      state: 'next',
      label: '視力測定機 B',
    })
  })

  it('次にやることは 1 人 0 個か 1 個', () => {
    for (const row of board().rows) {
      expect(row.cells.filter((cell) => cell.state === 'next').length).toBeLessThanOrEqual(1)
    }
    // 伊藤 健 様は次にやることが決まっていない。0 個のまま置く。
    expect(rowOf(board(), SUBJECT.ken).cells.filter((cell) => cell.state === 'next')).toHaveLength(
      0,
    )
  })

  it('何も起きていない工程は empty で、at も label も持たない', () => {
    const view = board()
    for (const stage of ['checkout', 'handover'] as const) {
      expect(cellOf(view, SUBJECT.hanako, stage)).toMatchObject({
        state: 'empty',
        at: null,
        label: '',
        note: null,
        needsAttention: false,
      })
    }
  })

  it('工程を飛ばした行は飛ばした列を empty のまま返す', () => {
    const view = board()
    // 伊藤 健 様は ご相談 のあと フレーム選び・視力測定 を飛ばして レンズ・お会計 へ進んだ。
    expect(cellOf(view, SUBJECT.ken, 'fitting')).toMatchObject({ state: 'empty', at: null })
    expect(cellOf(view, SUBJECT.ken, 'measuring')).toMatchObject({ state: 'empty', at: null })
    expect(cellOf(view, SUBJECT.ken, 'checkout').state).toBe('done')
  })

  it('打ち消しの行を足すと状態が戻り、元の行は消えない', () => {
    // 視力測定を誤って始めてしまい、ご相談へ戻す。UPDATE も DELETE も発行せず 1 行足す。
    const events = [...EVENTS, event(SUBJECT.mao, 'measuring', '11:05')]
    const undone = [...events, event(SUBJECT.mao, 'consulting', '11:06')]

    expect(cellOf(board({ events }), SUBJECT.mao, 'measuring').state).toBe('doing')

    const view = board({ events: undone })
    expect(cellOf(view, SUBJECT.mao, 'consulting')).toMatchObject({
      state: 'doing',
      at: jst('11:06'),
    })
    // 戻したので 視力測定 は「次にやること」に戻る（済みましたのまま残さない）。
    expect(cellOf(view, SUBJECT.mao, 'measuring')).toMatchObject({ state: 'next', at: null })
    // 元の行は消えない。追記だけの記録なので 11:05 の行はそのまま残っている。
    expect(undone.filter((row) => row.subjectId === SUBJECT.mao)).toHaveLength(4)
    expect(undone.some((row) => row.stage === 'measuring' && row.occurredAt === jst('11:05'))).toBe(
      true,
    )
  })
})

describe('お待たせ中', () => {
  /** 受付 10:50 のウォークイン 1 行だけの盤面を、`now` を変えて描く。 */
  const waitingBoard = (now: string) =>
    board({
      rows: [ROWS[1] as BoardSubjectRow],
      events: [event(SUBJECT.walkin3, 'received', '10:50', 'walkin')],
      options: { now: new Date(jst(now)) },
    })

  it('最後の記録から 15 分ちょうどは waiting にしない', () => {
    const view = waitingBoard('11:05')
    expect(cellOf(view, SUBJECT.walkin3, 'consulting').state).not.toBe('waiting')
    expect(rowOf(view, SUBJECT.walkin3).isWaitingTooLong).toBe(false)
  })

  it('最後の記録から 15 分 1 秒で waiting にし、経過分を label に入れる', () => {
    const view = board({
      rows: [ROWS[1] as BoardSubjectRow],
      events: [event(SUBJECT.walkin3, 'received', '10:50', 'walkin')],
      options: { now: new Date(Date.parse(jst('11:05')) + 1000) },
    })
    expect(cellOf(view, SUBJECT.walkin3, 'consulting')).toMatchObject({
      state: 'waiting',
      label: '15分',
      at: null,
    })
    // モックの 11:08 は「お待たせ中 18分」。
    expect(cellOf(waitingBoard('11:08'), SUBJECT.walkin3, 'consulting')).toMatchObject({
      state: 'waiting',
      label: '18分',
    })
  })

  it('お待たせ中の行は isWaitingTooLong が true になる', () => {
    expect(rowOf(waitingBoard('11:08'), SUBJECT.walkin3).isWaitingTooLong).toBe(true)
    // 接客が始まっている行はお待たせ中にしない（40 分の視力測定はお待たせではない）。
    const serving = board({
      rows: [ROWS[2] as BoardSubjectRow],
      events: [event(SUBJECT.mao, 'received', '10:20'), event(SUBJECT.mao, 'consulting', '10:25')],
      options: { now: new Date(jst('11:08')) },
    })
    expect(rowOf(serving, SUBJECT.mao).isWaitingTooLong).toBe(false)
    expect(cellOf(serving, SUBJECT.mao, 'consulting').state).toBe('doing')
  })
})

describe('ご来店中の数', () => {
  /** 伊藤 健 様が 11:20 にお帰りになった盤面。 */
  const withLeft = [...EVENTS, event(SUBJECT.ken, 'left', '11:20')]

  it('最新が left でない subject だけを数える', () => {
    expect(board().activeCount).toBe(4)
    const view = board({ events: withLeft, options: { now: new Date(jst('11:25')) } })
    expect(view.activeCount).toBe(3)
    expect(view.rows.some((row) => row.subjectId === SUBJECT.ken)).toBe(false)
  })

  it('お渡しが対応中の人もご来店中に数える', () => {
    // 伊藤 健 様は「お渡し 対応中 11:04〜」でご来店中 4名 に数えられている。
    expect(cellOf(board(), SUBJECT.ken, 'handover').state).toBe('doing')
    expect(board().activeCount).toBe(4)
    expect(board().rows).toHaveLength(4)
  })

  it('scope=all は退店した行も返すが activeCount は変わらない', () => {
    const options = { now: new Date(jst('11:25')), scope: 'all' as const }
    const view = board({ events: withLeft, options })
    expect(view.rows).toHaveLength(4)
    expect(view.activeCount).toBe(3)
    // 退店した行は最後に進んだ工程が「済みました」のまま残る。
    expect(cellOf(view, SUBJECT.ken, 'handover')).toMatchObject({ state: 'done', at: jst('11:04') })
    expect(rowOf(view, SUBJECT.ken).isWaitingTooLong).toBe(false)
  })
})

describe('行の名前', () => {
  it('ウォークインは整理番号を 3 桁ゼロ埋めで出し、visitCount を null にする', () => {
    const row = rowOf(board(), SUBJECT.walkin3)
    expect(row.displayName).toBe('ウォークイン 003')
    expect(row.visitCount).toBeNull()
    expect(row.purposeLabel).toBe('フレームのご相談')
  })

  it('ご予約のお客様は「田中 花子 様」と来店回数を持つ', () => {
    expect(rowOf(board(), SUBJECT.hanako)).toMatchObject({
      displayName: '田中 花子 様',
      visitCount: 4,
      purposeLabel: 'メガネを新しく作る',
    })
    expect(rowOf(board(), SUBJECT.mao).displayName).toBe('山口 真央 様')
  })
})

describe('注意', () => {
  /** 佐藤 美咲の勤務 09:30–18:30（休憩 12:30–13:30）。 */
  const SHIFTS: StaffShiftBand[] = [
    { staffId: STAFF.sato, date: LEDGER_DATE, startsAt: '09:30', endsAt: '18:30', kind: 'work' },
    { staffId: STAFF.sato, date: LEDGER_DATE, startsAt: '12:30', endsAt: '13:30', kind: 'break' },
    {
      staffId: STAFF.takahashi,
      date: LEDGER_DATE,
      startsAt: '09:30',
      endsAt: '18:30',
      kind: 'work',
    },
  ]
  /** 視力測定機 A の点検 11:00–12:00。 */
  const MAINTENANCES: MaintenanceBand[] = [
    { equipmentId: EQUIPMENT.measureA, startsAt: jst('11:00'), endsAt: jst('12:00') },
  ]
  const OFF_DUTY = '本日はお休みです。担当を決め直してください。'
  const UNDER_MAINTENANCE = '視力測定機 A は点検で止まっています。'

  it('次にやることの担当がその時間帯の勤務に入っていないとき、欄が注意を持つ', () => {
    // 中村 彩は今日の勤務表に 1 行も無い。
    const rows = ROWS.map((row) =>
      row.subjectId === SUBJECT.hanako && row.next !== null
        ? { ...row, next: { ...row.next, staffId: STAFF.nakamura } }
        : row,
    )
    const cell = cellOf(board({ rows, options: { shifts: SHIFTS } }), SUBJECT.hanako, 'measuring')
    expect(cell.needsAttention).toBe(true)
    expect(cell.note).not.toBeNull()
  })

  it('不在の注意の文は「本日はお休みです。担当を決め直してください。」', () => {
    const rows = ROWS.map((row) =>
      row.subjectId === SUBJECT.hanako && row.next !== null
        ? { ...row, next: { ...row.next, staffId: STAFF.nakamura } }
        : row,
    )
    expect(
      cellOf(board({ rows, options: { shifts: SHIFTS } }), SUBJECT.hanako, 'measuring').note,
    ).toBe(OFF_DUTY)
    // 休憩に掛かっている時間帯も勤務外として扱う（12:50 の盤面）。
    const onBreak = board({
      options: { shifts: SHIFTS, now: new Date(jst('12:50')) },
    })
    expect(cellOf(onBreak, SUBJECT.hanako, 'measuring').note).toBe(OFF_DUTY)
  })

  it('次にやることの設備が点検で止まっているとき、欄が注意を持つ', () => {
    const view = board({ options: { shifts: SHIFTS, maintenances: MAINTENANCES } })
    expect(cellOf(view, SUBJECT.hanako, 'measuring').needsAttention).toBe(true)
    // 視力測定機 B は止まっていないので山口 真央 様の欄は静かなまま。
    expect(cellOf(view, SUBJECT.mao, 'measuring').needsAttention).toBe(false)
  })

  it('点検の注意の文は「視力測定機 A は点検で止まっています。」で、設備名を差し込む', () => {
    const view = board({ options: { shifts: SHIFTS, maintenances: MAINTENANCES } })
    expect(cellOf(view, SUBJECT.hanako, 'measuring').note).toBe(UNDER_MAINTENANCE)
    // 点検が終わった 12:10 の盤面では注意が消える。
    const after = board({
      options: { shifts: SHIFTS, maintenances: MAINTENANCES, now: new Date(jst('12:10')) },
    })
    expect(cellOf(after, SUBJECT.hanako, 'measuring').note).toBeNull()
  })

  it('注意を持つ欄は needsAttention が true で、label（設備名）はそのまま残る', () => {
    const cell = cellOf(
      board({ options: { shifts: SHIFTS, maintenances: MAINTENANCES } }),
      SUBJECT.hanako,
      'measuring',
    )
    expect(cell).toMatchObject({
      state: 'next',
      label: '視力測定機 A',
      note: UNDER_MAINTENANCE,
      needsAttention: true,
    })
  })

  it('勤務にも点検にも当たらない欄は注意を持たず needsAttention が false', () => {
    const view = board({ options: { shifts: SHIFTS } })
    for (const row of view.rows) {
      for (const cell of row.cells) {
        expect(cell.note).toBeNull()
        expect(cell.needsAttention).toBe(false)
      }
    }
  })

  it('注意は「次にやること」の欄にだけ出す（済みました・対応中には出さない）', () => {
    const view = board({ options: { shifts: SHIFTS, maintenances: MAINTENANCES } })
    for (const row of view.rows) {
      for (const cell of row.cells) {
        if (cell.state !== 'next') expect(cell.note).toBeNull()
      }
    }
    // 注意が出ているのは「次にやること」の 1 欄だけである。
    expect(
      view.rows.flatMap((row) => row.cells).filter((cell) => cell.needsAttention),
    ).toHaveLength(1)
  })
})

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * まだお着きでない行と、記録を 1 行も持たないウォークイン
 *
 * `POST /api/staff/walkins` は `visit_events` を 1 行も書かない。受付パネルから
 * 受け付けたお客様の盤面は「記録が 0 行のウォークイン」から始まるので、そこを
 * 手で `received` を足して繕った盤面だけで確かめると、AC-RECEP-13 の赤地も
 * AC-RECEP-02 の「済みました 10:55」も**実際の経路では 1 度も出ない**。
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** 受付 10:50 のウォークイン。**工程の記録をまだ 1 行も持たない。** */
const ARRIVED_ONLY: BoardSubjectRow = {
  ...(ROWS[1] as BoardSubjectRow),
  arrivedAt: jst('10:50'),
}

describe('お着きになった時刻', () => {
  it('記録が 1 行も無いウォークインは、受付の欄が受付時刻で済みましたになる', () => {
    const view = board({ rows: [ARRIVED_ONLY], events: [] })
    expect(cellOf(view, SUBJECT.walkin3, 'received')).toMatchObject({
      state: 'done',
      at: jst('10:50'),
    })
  })

  it('記録が 1 行も無いウォークインも 15 分を越えるとお待たせ中になる', () => {
    // 11:08 は受付 10:50 の 18 分後。モックの ウォークイン 003 と同じ姿である。
    const view = board({ rows: [ARRIVED_ONLY], events: [] })
    expect(rowOf(view, SUBJECT.walkin3).isWaitingTooLong).toBe(true)
    expect(cellOf(view, SUBJECT.walkin3, 'consulting')).toMatchObject({
      state: 'waiting',
      label: '18分',
    })
  })

  it('受付の記録があるときは補わない（2 つの受付時刻を作らない）', () => {
    const view = board({
      rows: [ARRIVED_ONLY],
      events: [event(SUBJECT.walkin3, 'received', '10:55', 'walkin')],
    })
    expect(cellOf(view, SUBJECT.walkin3, 'received').at).toBe(jst('10:55'))
  })

  it('記録が 1 行も無いウォークインもご来店中に数える', () => {
    expect(board({ rows: [ARRIVED_ONLY], events: [] }).activeCount).toBe(1)
  })

  it('お帰りになったあとは受付時刻で呼び戻さない', () => {
    const view = board({
      rows: [ARRIVED_ONLY],
      events: [event(SUBJECT.walkin3, 'left', '11:00', 'walkin')],
    })
    expect(view.activeCount).toBe(0)
    expect(view.rows).toHaveLength(0)
  })
})

describe('まだお着きでない行', () => {
  it('工程の記録も受付時刻も無い行は盤面に出さない', () => {
    const view = board({ rows: [ROWS[0] as BoardSubjectRow], events: [] })
    expect(view.rows).toHaveLength(0)
  })

  it('まだお着きでない当日のご予約をご来店中に数えない', () => {
    // 16:00 のご予約が 4 件あっても、11:08 の「ご来店中」は 0 名である。
    const view = board({ rows: ROWS, events: [] })
    expect(view.activeCount).toBe(0)
  })

  it('scope=all でもまだお着きでない行は出さない（本日すべては来店の記録である）', () => {
    const view = board({ rows: ROWS, events: [], options: { scope: 'all' } })
    expect(view.rows).toHaveLength(0)
  })

  it('お待ちいただくと記録した行は盤面に出る（受け付けはまだ済んでいない）', () => {
    const view = board({
      rows: [ROWS[0] as BoardSubjectRow],
      events: [event(SUBJECT.hanako, 'waiting', '11:00')],
    })
    expect(view.activeCount).toBe(1)
    expect(cellOf(view, SUBJECT.hanako, 'received').state).not.toBe('done')
  })
})
