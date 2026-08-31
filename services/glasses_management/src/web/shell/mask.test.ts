import type { LedgerLane } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import { staffView } from '../ledger/fixtures'
import { maskLane, maskName, maskPhone, maskView } from './mask'

/*
 * 伏せ字（HOME-SHARED-LOCKED.png / AC-TERM-12）。
 *
 * 伏せるのは**お客様のお名前と電話番号だけ**。時刻・件数・担当の名前・札の番号は
 * 読めたまま残す（レジ横の iPad でも「次は 11:00」は言えないと業務が止まる）。
 * **桁数も漏らさない**ので ● の数は元の長さに依らず一定にする。
 */

describe('maskName', () => {
  it('長さに依らず同じ ● 4 つにして、桁数を漏らさない', () => {
    expect(maskName('田中 花子')).toBe('●●●●')
    expect(maskName('相川 みどり')).toBe('●●●●')
    expect(maskName('林')).toBe('●●●●')
  })
})

describe('maskPhone', () => {
  it('市外局番だけ残す', () => {
    expect(maskPhone('090-1234-5678')).toBe('090-●●●●-●●●●')
  })

  it('ハイフンが無くても先頭 3 桁だけ残す', () => {
    expect(maskPhone('09012345678')).toBe('090-●●●●-●●●●')
  })
})

const lane: LedgerLane = {
  kind: 'staff',
  id: '11111111-2222-4333-8444-555555555555',
  name: '高橋 健',
  subtitle: '検査担当',
  entries: [
    {
      reservationId: '22222222-2222-4333-8444-555555555555',
      startsAt: '2026-08-27T02:00:00.000Z',
      endsAt: '2026-08-27T02:30:00.000Z',
      customerName: '田中 花子',
      visitCount: 3,
      purposeLabel: 'メガネのご相談',
      source: 'counter',
      status: 'confirmed',
      isUnassigned: false,
    },
  ],
  blocks: [
    {
      kind: 'break',
      startsAt: '2026-08-27T04:00:00.000Z',
      endsAt: '2026-08-27T05:00:00.000Z',
      label: '休憩',
    },
  ],
}

describe('maskLane', () => {
  it('お客様のお名前だけ伏せる', () => {
    expect(maskLane(lane).entries[0]?.customerName).toBe('●●●●')
  })

  it('担当の名前・肩書き・時刻・来店回数・ご用件は伏せない', () => {
    const masked = maskLane(lane)
    expect(masked.name).toBe('高橋 健')
    expect(masked.subtitle).toBe('検査担当')
    expect(masked.entries[0]?.startsAt).toBe('2026-08-27T02:00:00.000Z')
    expect(masked.entries[0]?.endsAt).toBe('2026-08-27T02:30:00.000Z')
    expect(masked.entries[0]?.visitCount).toBe(3)
    expect(masked.entries[0]?.purposeLabel).toBe('メガネのご相談')
  })

  it('休憩・点検の帯はそのまま残す', () => {
    expect(maskLane(lane).blocks).toEqual(lane.blocks)
  })

  it('お名前が null の帯を「●●●●」に変えない（お名前はまだ無い）', () => {
    const anonymous: LedgerLane = {
      ...lane,
      entries: lane.entries.map((entry) => ({ ...entry, customerName: null })),
    }
    expect(maskLane(anonymous).entries[0]?.customerName).toBeNull()
  })

  it('元の行を書き換えない', () => {
    maskLane(lane)
    expect(lane.entries[0]?.customerName).toBe('田中 花子')
  })
})

describe('maskView', () => {
  it('すべての行のお客様のお名前を伏せる', () => {
    const masked = maskView(staffView({ lanes: [lane, { ...lane, id: null, kind: 'unassigned' }] }))
    const names = masked.lanes.flatMap((lane) =>
      lane.entries.map((entry) => entry.customerName).filter((name) => name !== null),
    )
    expect(names.length).toBeGreaterThan(0)
    expect(new Set(names)).toEqual(new Set(['●●●●']))
  })

  it('件数・時刻・札の番号・お待ちの人数は読めたまま', () => {
    const view = staffView()
    const masked = maskView(view)
    expect(masked.counts).toEqual(view.counts)
    expect(masked.serverNow).toBe(view.serverNow)
    expect(masked.opensAt).toBe(view.opensAt)
    expect(masked.closesAt).toBe(view.closesAt)
    expect(masked.nextTicketNo).toBe(view.nextTicketNo)
    expect(masked.walkinWaitingCount).toBe(view.walkinWaitingCount)
    expect(masked.estimatedWaitMinutes).toBe(view.estimatedWaitMinutes)
  })

  it('もう一度伏せても結果が変わらない（二重に伏せても壊れない）', () => {
    const once = maskView(staffView({ lanes: [lane] }))
    expect(maskView(once)).toEqual(once)
  })

  it('元の応答を書き換えない', () => {
    const view = staffView({ lanes: [lane] })
    const before = structuredClone(view)
    maskView(view)
    expect(view).toEqual(before)
  })
})
