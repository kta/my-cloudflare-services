import { AvailabilityReason } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import { type BoardGeometry, blockedText, columnSpan, snapToCell } from './slot-drag'

/*
 * 指の座標を「担当の行」と「30分の刻み」へ吸着させる計算と、置けない理由の文。
 *
 * ここは純関数だけで、DOM も `Date.now()` も触らない。盤の実寸は呼ぶ側が
 * `getBoundingClientRect()` で測って渡す（実機でもテストでも同じ式を通すため）。
 *
 * 実測（docs/frontend/mockups/eye/screens/BOOK-03c-DRAG.html の <style> と
 * assets/eye.css）: 名前列 170px、見出し行 34px、時間は 30分刻みで 8 列 1fr。
 */

/** 名前列 170px・見出し 34px・10 列・5 行の盤。1 列 83px / 1 行 93.2px になる。 */
const BOARD: BoardGeometry = {
  left: 0,
  top: 0,
  width: 1000,
  height: 500,
  labelWidth: 170,
  headHeight: 34,
  columns: 10,
  rows: 5,
}

describe('吸着', () => {
  it('セルの中のどこを指しても、その行と 30 分の刻みへ吸着する', () => {
    // 13:00 の列（10:00 から 6 本目）の左端＋3px と、右端の手前。どちらも同じ枠。
    expect(snapToCell({ x: 170 + 6 * 83 + 3, y: 34 + 3 }, BOARD)).toEqual({ row: 0, column: 6 })
    expect(snapToCell({ x: 170 + 7 * 83 - 3, y: 34 + 93 }, BOARD)).toEqual({ row: 0, column: 6 })
  })

  it('行の下のほうを指しても、その行のままで隣へこぼれない', () => {
    expect(snapToCell({ x: 500, y: 34 + 93.2 * 2 + 90 }, BOARD)).toEqual({ row: 2, column: 3 })
  })

  it('盤がずれた位置にあっても、その分だけ引いて数える', () => {
    const moved = { ...BOARD, left: 40, top: 120 }
    expect(snapToCell({ x: 40 + 170 + 6 * 83 + 3, y: 120 + 34 + 3 }, moved)).toEqual({
      row: 0,
      column: 6,
    })
  })

  it('名前列と見出し行の上は枠ではないので null を返す', () => {
    expect(snapToCell({ x: 80, y: 200 }, BOARD)).toBeNull()
    expect(snapToCell({ x: 500, y: 10 }, BOARD)).toBeNull()
  })

  it('盤の外へはみ出したら null を返す（端の枠へ丸めない）', () => {
    expect(snapToCell({ x: 1400, y: 200 }, BOARD)).toBeNull()
    expect(snapToCell({ x: 500, y: 900 }, BOARD)).toBeNull()
  })

  it('列も行も 0 本の盤では、どこを指しても null を返す', () => {
    expect(snapToCell({ x: 500, y: 200 }, { ...BOARD, columns: 0 })).toBeNull()
    expect(snapToCell({ x: 500, y: 200 }, { ...BOARD, rows: 0 })).toBeNull()
  })
})

describe('占める列数', () => {
  it('所要 60 分は 30 分の刻みで 2 列を占める', () => {
    expect(columnSpan(60, 30)).toBe(2)
  })

  it('45 分は切り上げて 2 列、75 分は 3 列を占める', () => {
    expect(columnSpan(45, 30)).toBe(2)
    expect(columnSpan(75, 30)).toBe(3)
  })

  it('刻みが 0 でも 1 列は返す（0 幅の帯を描かない）', () => {
    expect(columnSpan(60, 0)).toBe(1)
  })
})

describe('置けない理由', () => {
  it('点検中の設備は「視力測定機 B は点検中です」と理由を添える', () => {
    expect(blockedText('視力測定機 B', 'maintenance')).toBe(
      'ここには置けません（視力測定機 B は点検中です）',
    )
  })

  it('営業時間の外と勤務の外を言い分ける', () => {
    expect(blockedText('佐藤 美咲', 'outside_hours')).toBe('ここには置けません（営業時間の外です）')
    expect(blockedText('佐藤 美咲', 'staff_off')).toBe(
      'ここには置けません（佐藤 美咲 の勤務の外です）',
    )
  })

  it('先約は担当と設備で言い方を変える', () => {
    expect(blockedText('佐藤 美咲', 'staff_busy')).toBe(
      'ここには置けません（佐藤 美咲 に先約があります）',
    )
    expect(blockedText('視力測定機 A', 'equipment_busy')).toBe(
      'ここには置けません（視力測定機 A は先約で埋まっています）',
    )
  })

  it('休憩・点検・技能・上限を言い分ける', () => {
    expect(blockedText('小林 学', 'break')).toBe('ここには置けません（小林 学 は休憩の時間です）')
    expect(blockedText('高橋 健', 'no_skill')).toBe(
      'ここには置けません（高橋 健 はこの用件を承れません）',
    )
    expect(blockedText('担当が未定', 'max_parallel')).toBe(
      'ここには置けません（同時にお受けできる数を超えます）',
    )
  })

  it('お店が閉まっている・設備が無い・Web の受付時間の外・直前すぎるも言い分ける', () => {
    expect(blockedText('佐藤 美咲', 'closed')).toBe(
      'ここには置けません（この日はお店を開けていません）',
    )
    expect(blockedText('視力測定機 A', 'no_equipment')).toBe(
      'ここには置けません（使える設備・場所がありません）',
    )
    expect(blockedText('佐藤 美咲', 'web_window')).toBe(
      'ここには置けません（Web予約でお受けする時間の外です）',
    )
    expect(blockedText('佐藤 美咲', 'lead_time')).toBe(
      'ここには置けません（直前すぎてお受けできません）',
    )
  })

  it('契約が持つ理由 12 種すべてに、別々の言い方がある', () => {
    // 契約に理由が増えたら、言い方を足し忘れたことがここで分かる。
    const texts = AvailabilityReason.options.map((reason) => blockedText('視力測定機 B', reason))
    expect(texts).toHaveLength(12)
    expect(new Set(texts).size).toBe(12)
    expect(texts.every((text) => text.startsWith('ここには置けません（'))).toBe(true)
  })

  it('理由が分からなくても「置けません」だけは必ず言う', () => {
    expect(blockedText('佐藤 美咲', null)).toBe('ここには置けません（この枠は空いていません）')
  })
})
