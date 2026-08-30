import type { LedgerEntry, LedgerLane } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import { at, LEDGER_DATE, RESERVATION_IDS, SERVER_NOW, staffView } from './fixtures'
import {
  bandName,
  bandToneOf,
  clockLabel,
  closedNotice,
  columnCount,
  columnLabels,
  dateLabel,
  emptyCellName,
  gridMinWidth,
  gridTemplateColumns,
  gridTemplateRows,
  laneSegments,
  nowChipLabel,
  nowLineLeft,
  shiftDate,
} from './metrics'

/*
 * 台帳の位置と幅の計算。ここは純関数だけで、`Date.now()` を 1 度も呼ばない。
 * 時刻は必ず引数で渡す（端末の時計を読むと、iPad の時計がずれた日に台帳が嘘をつく）。
 */

describe('表示窓', () => {
  it('10:00 から 16:30 までの 30分刻みで 14 列の見出しを作る', () => {
    const labels = columnLabels(columnCount('17:00'))
    expect(labels).toHaveLength(14)
    expect(labels[0]).toBe('10:00')
    expect(labels[13]).toBe('16:30')
  })

  it('営業時間が 19:00 まである日は 18 列に伸ばす（表示窓の外は横に流す）', () => {
    expect(columnCount('19:00')).toBe(18)
    expect(columnLabels(18)[17]).toBe('18:30')
  })

  it('定休日（閉店時刻が無い日）でも列数は表示窓の 14 のままにする', () => {
    expect(columnCount(null)).toBe(14)
  })

  it('列の指定は名前列 170px（10.625rem）＋残りを等分にする', () => {
    expect(gridTemplateColumns(14)).toBe('10.625rem repeat(14, minmax(0, 1fr))')
  })

  it('行の指定は見出し 34px・「ご来店お待ち」88px・ほかは等分にする', () => {
    expect(gridTemplateRows(staffView().lanes)).toBe(
      '2.125rem minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 5.5rem',
    )
  })

  it('行が増えても「ご来店お待ち」の 5.5rem は最後に据え置く（画面の下端から隠れない）', () => {
    // 担当の行だけが等分に縮み、最下段の高さは変わらない。格子そのものは `h-full` なので
    // 縦にあふれず、行が何本になっても最下段が画面の下端に居続ける（AC-LEDGER-08）。
    const many = [
      ...Array.from({ length: 11 }, () => staffView().lanes[0] as LedgerLane),
      staffView().lanes[5] as LedgerLane,
    ]
    const tracks = gridTemplateRows(many).split(' 5.5rem')
    expect(tracks).toHaveLength(2)
    expect(tracks[1]).toBe('')
    expect(tracks[0]?.split('minmax(0, 1fr)')).toHaveLength(12)
  })

  it('表示窓と同じ 14 列の日は画面の幅ちょうどにし、伸ばすのは越えたぶんだけにする', () => {
    // 14 列を 68px に丸めるとモックの 1fr（67.7px）と 1 列 0.3px ずれ、右端で 4px の差になる。
    expect(gridMinWidth(14)).toBe('100%')
    expect(gridMinWidth(18)).toBe('calc(100% + 17rem)')
  })
})

describe('日付', () => {
  it('2026-08-27 は「2026年8月27日（木）」と読む', () => {
    expect(dateLabel('2026-08-27')).toBe('2026年8月27日（木）')
  })

  it('日付を 1 日進めると翌日になり、月をまたいでも壊れない', () => {
    expect(shiftDate('2026-08-27', 1)).toBe('2026-08-28')
    expect(shiftDate('2026-08-31', 1)).toBe('2026-09-01')
    expect(shiftDate('2026-09-01', -1)).toBe('2026-08-31')
  })

  it('定休日の知らせは「9月1日（火）は定休日です。」になる', () => {
    expect(closedNotice('2026-09-01')).toBe('9月1日（火）は定休日です。')
  })
})

describe('現在時刻', () => {
  it('serverNow が 11:08 のとき札は「現在 11:08」になる', () => {
    expect(nowChipLabel(LEDGER_DATE, SERVER_NOW)).toBe('現在 11:08')
  })

  it('表示中の日付が本日でないときは札を出さない', () => {
    expect(nowChipLabel('2026-08-28', SERVER_NOW)).toBeNull()
  })

  it('表示窓より前の 9:42 は先頭の 0 を落として「現在 9:42（営業時間の外）」と出す', () => {
    expect(nowChipLabel(LEDGER_DATE, at('09:42'))).toBe('現在 9:42（営業時間の外）')
    expect(clockLabel('09:42')).toBe('9:42')
  })

  it('表示窓より後の 17:30 も同じ型で札だけを出す', () => {
    expect(nowChipLabel(LEDGER_DATE, at('17:30'))).toBe('現在 17:30（営業時間の外）')
  })

  it('線は表示窓の左から 16.19%（10:00 から 68分 ÷ 420分）に来る', () => {
    expect(nowLineLeft(LEDGER_DATE, SERVER_NOW, 14)).toBe('16.19%')
  })

  it('列が 18 に伸びた日は同じ時刻でも比が変わる（68分 ÷ 540分）', () => {
    expect(nowLineLeft(LEDGER_DATE, SERVER_NOW, 18)).toBe('12.59%')
  })

  it('本日でない日と表示窓の外では線を引かない', () => {
    expect(nowLineLeft('2026-08-28', SERVER_NOW, 14)).toBeNull()
    expect(nowLineLeft(LEDGER_DATE, at('09:42'), 14)).toBeNull()
    expect(nowLineLeft(LEDGER_DATE, at('17:30'), 14)).toBeNull()
  })
})

/** 添字で取り出した行・帯を、undefined を通さずに使うための道具。 */
function laneAt(index: number): LedgerLane {
  const lane = staffView().lanes[index]
  if (lane === undefined) throw new Error(`${index} 行目が無い`)
  return lane
}

function entryAt(lane: LedgerLane, index: number): LedgerEntry {
  const entry = lane.entries[index]
  if (entry === undefined) throw new Error(`${index} 本目の帯が無い`)
  return entry
}

describe('帯', () => {
  const sato = laneAt(0)
  const nakamura = laneAt(2)
  const watanabe = laneAt(3)
  const unassigned = laneAt(4)

  it('帯の名前は「11:00から12:00　新調相談・視力測定　佐藤 美咲」のひと続きになる', () => {
    expect(bandName(entryAt(sato, 0), sato.name)).toBe(
      '11:00から12:00　新調相談・視力測定　佐藤 美咲',
    )
  })

  it('帯の中に見えている語（出どころ・担当が未定）は名前の末尾に続く', () => {
    // `aria-label` は中身の読み上げを覆い隠すので、ここに無い語は誰にも読まれない。
    expect(bandName(entryAt(nakamura, 0), nakamura.name)).toBe(
      '10:30から11:30　視力測定　中村 彩　Web予約',
    )
    expect(bandName(entryAt(watanabe, 0), watanabe.name)).toBe(
      '11:00から11:30　視力測定　渡辺 由紀　ウォークイン',
    )
    // 緑（お電話・店頭）は帯に語を持たないので名前も伸びない。
    expect(bandName(entryAt(nakamura, 1), nakamura.name)).toBe('15:00から16:00　新調相談　中村 彩')
  })

  it('「担当が未定」の行では行の名前と同じ語を重ねない', () => {
    expect(bandName(entryAt(unassigned, 0), unassigned.name, 'unassigned')).toBe(
      '11:02から12:02　新調相談　担当が未定　ウォークイン',
    )
    // 設備・場所の行では行の名前が設備名なので、その語を足す。
    expect(bandName(entryAt(unassigned, 1), '相談カウンター 1', 'equipment')).toBe(
      '13:00から13:20　調整　相談カウンター 1　Web予約　担当が未定',
    )
  })

  it('空の枠の名前は「10:30　佐藤 美咲　空いています」になる', () => {
    expect(emptyCellName('10:30', '佐藤 美咲')).toBe('10:30　佐藤 美咲　空いています')
  })

  it('色はお電話・店頭が緑、Web が青、ウォークインが茶になる', () => {
    expect(bandToneOf(entryAt(sato, 0))).toBe('pine')
    expect(bandToneOf(entryAt(nakamura, 0))).toBe('web')
    expect(bandToneOf(entryAt(nakamura, 1))).toBe('pine')
    expect(bandToneOf(entryAt(watanabe, 0))).toBe('walkin')
  })

  it('担当が未定の帯は出どころより先に赤になる', () => {
    expect(entryAt(unassigned, 0).source).toBe('walkin')
    expect(bandToneOf(entryAt(unassigned, 0))).toBe('alert')
  })
})

describe('行の割り付け', () => {
  it('帯の無い列は 1 枠ずつの空の枠になり、帯は先頭の列にだけ置く', () => {
    const segments = laneSegments(laneAt(0), LEDGER_DATE, 14)
    // 10:00 と 10:30 は空、11:00 から 2 列が帯、12:00 から 2 列が空…と続く。
    expect(segments.slice(0, 2).every((s) => s.kind === 'empty')).toBe(true)
    const band = segments.find((s) => s.kind === 'entry')
    expect(band).toMatchObject({ columnIndex: 2, columnSpan: 2 })
    expect(segments.reduce((sum, s) => sum + s.columnSpan, 0)).toBe(14)
  })

  it('同じ帯を 2 度置かない（またぐ列は先頭の 1 つにまとめる）', () => {
    const ids = laneSegments(laneAt(0), LEDGER_DATE, 14)
      .filter((s) => s.kind === 'entry')
      .flatMap((s) => (s.kind === 'entry' ? s.entries.map((e) => e.reservationId) : []))
    expect(ids).toEqual([RESERVATION_IDS.sato1100, RESERVATION_IDS.sato1400])
  })

  it('休憩は「休憩」の塞がりとして 13:00 から 2 列に載る', () => {
    const block = laneSegments(laneAt(0), LEDGER_DATE, 14).find((s) => s.kind === 'block')
    expect(block).toMatchObject({ columnIndex: 6, columnSpan: 2, block: { label: '休憩' } })
  })

  it('表示窓の外へ出る 30分の帯（11:02 始まり）も列に載る', () => {
    const segments = laneSegments(laneAt(4), LEDGER_DATE, 14)
    const bands = segments.filter((s) => s.kind === 'entry')
    expect(bands).toHaveLength(3)
    expect(bands[0]).toMatchObject({ columnIndex: 2, columnSpan: 3 })
  })

  it('「ご来店お待ち」の行は時間軸に載せず、列いっぱいの 1 枠にする', () => {
    expect(laneSegments(laneAt(5), LEDGER_DATE, 14)).toEqual([
      { key: 'walkin', columnIndex: 0, columnSpan: 14, kind: 'empty' },
    ])
  })
})
