/**
 * 来店回数と「最後のご来店」の「ちょうど」を固定する（`src/worker/domain/customers.ts`）。
 *
 * この 2 つは**別の条件から出る**。来店回数は接客が終わった件数（`status='done'`）で、
 * 最後のご来店は足を運ばれた日（`arrived` / `serving` / `done` の最終 `starts_at`）である。
 * いま接客中の方は「まだ done ではないが、今日いらしている」ので、回数は増えないのに
 * 最後のご来店は今日になる。ここを 1 つの条件にまとめると、接客中のお客様が
 * 「前回のご来店 2026年5月12日」と表示されたまま目の前に立つことになる。
 *
 * **時刻はすべて引数で受ける。**`countVisits` も `lastVisitDate` も `Date.now()` を呼ばない。
 * 暦日は JST で決まるので、UTC のまま日付を読むと 15:00Z 以降のご来店が前日に落ちる。
 * 基準時刻は世界観データの **2026年8月27日（木）11:08 JST**。
 */
import { describe, expect, it } from 'vitest'
import {
  countVisits,
  firstVisitDate,
  lastVisitDate,
  lastVisitLabel,
  type VisitReservation,
  visitLabel,
} from '../src/worker/domain/customers'
import { FIXED_NOW, jstAt } from './helpers'

/** JST 2026年8月27日（木）11:08。台帳と同じ基準時刻。 */
const NOW = new Date(FIXED_NOW)

/** ご予約 1 件。台帳が読むのは状態と開始時刻だけである。 */
const at = (status: VisitReservation['status'], date: string, time: string): VisitReservation => ({
  status,
  startsAt: jstAt(date, time),
})

/** 田中 花子 様。ご来店 4 回と、取り消し 1 件と、これからのご予約 1 件。 */
const HANAKO: VisitReservation[] = [
  at('done', '2025-04-20', '14:00'),
  at('done', '2025-11-08', '11:00'),
  at('done', '2026-03-12', '15:30'),
  at('done', '2026-05-12', '10:30'),
  at('cancelled', '2026-06-02', '13:00'),
  at('confirmed', '2026-09-04', '11:00'),
]

describe('来店回数', () => {
  it("来店回数は status='done' の件数だけを数える", () => {
    expect(countVisits(HANAKO)).toBe(4)
    expect(countVisits([at('done', '2026-08-27', '10:00')])).toBe(1)
  })

  it('取り消し・不来店・受付前は来店回数に入らない', () => {
    const none: VisitReservation[] = [
      at('cancelled', '2026-05-12', '10:30'),
      at('no_show', '2026-06-02', '13:00'),
      at('confirmed', '2026-08-27', '16:00'),
      at('arrived', '2026-08-27', '11:00'),
      at('serving', '2026-08-27', '11:00'),
    ]
    expect(countVisits(none)).toBe(0)
    // いま接客中でも「接客が終わった回数」は増えない。
    expect(countVisits([...HANAKO, at('serving', '2026-08-27', '11:00')])).toBe(4)
  })
})

describe('最後のご来店', () => {
  it('最後のご来店は arrived / serving / done の最終 starts_at の日付（いま接客中でも今日になる）', () => {
    expect(lastVisitDate(HANAKO, NOW)).toBe('2026-05-12')
    expect(lastVisitLabel(lastVisitDate(HANAKO, NOW))).toBe('2026年5月12日')

    // 11:00 から接客中。まだ done ではないが、今日いらしている。
    const serving = [...HANAKO, at('serving', '2026-08-27', '11:00')]
    expect(lastVisitDate(serving, NOW)).toBe('2026-08-27')
    expect(lastVisitLabel(lastVisitDate(serving, NOW))).toBe('2026年8月27日')

    // 受付を済ませただけの方も「足を運ばれた」ので数える。
    expect(lastVisitDate([...HANAKO, at('arrived', '2026-08-27', '10:45')], NOW)).toBe('2026-08-27')
    // これからのご予約（9月4日）は最後のご来店にしない。状態が進んでいても同じ。
    expect(lastVisitDate([at('confirmed', '2026-09-04', '11:00')], NOW)).toBeNull()
    expect(lastVisitDate([...HANAKO, at('arrived', '2026-09-04', '11:00')], NOW)).toBe('2026-05-12')
  })

  it('来店済みが 0 件なら、一覧は「初」・帯とバッジは「初めて」・最後のご来店は「—」', () => {
    const first: VisitReservation[] = [at('confirmed', '2026-08-27', '16:00')]
    expect(countVisits(first)).toBe(0)
    expect(visitLabel(0, 'list')).toBe('初')
    expect(visitLabel(0, 'badge')).toBe('初めて')
    expect(lastVisitDate(first, NOW)).toBeNull()
    expect(lastVisitLabel(null)).toBe('—')
  })

  it('来店済みが 4 件なら、一覧は「4回」・帯とバッジは「4回目」', () => {
    expect(countVisits(HANAKO)).toBe(4)
    expect(visitLabel(4, 'list')).toBe('4回')
    expect(visitLabel(4, 'badge')).toBe('4回目')
    expect(visitLabel(1, 'list')).toBe('1回')
    expect(visitLabel(1, 'badge')).toBe('1回目')
  })

  it('初回来店は来店済みの最初の starts_at の日付で、あとから来る予約で書き換わらない', () => {
    expect(firstVisitDate(HANAKO, NOW)).toBe('2025-04-20')
    // 順番を入れ替えても、あとから 1 件足しても、初回は動かない。
    expect(firstVisitDate([...HANAKO].reverse(), NOW)).toBe('2025-04-20')
    expect(firstVisitDate([...HANAKO, at('done', '2026-08-27', '10:00')], NOW)).toBe('2025-04-20')
    expect(firstVisitDate([at('confirmed', '2026-09-04', '11:00')], NOW)).toBeNull()
  })
})

describe('JST の暦日', () => {
  it('UTC 15:00 をまたぐ予約は JST の暦日で数える', () => {
    // UTC 2026-08-27 15:00 は JST 2026年8月28日 00:00。
    const across: VisitReservation[] = [{ status: 'done', startsAt: '2026-08-27T15:00:00.000Z' }]
    const later = new Date('2026-08-28T02:00:00.000Z')
    expect(lastVisitDate(across, later)).toBe('2026-08-28')
    expect(lastVisitDate([{ status: 'done', startsAt: '2026-08-27T14:59:59.999Z' }], later)).toBe(
      '2026-08-27',
    )
    expect(lastVisitLabel(lastVisitDate(across, later))).toBe('2026年8月28日')
  })

  it('月末（8/31 15:00Z）・年末（12/31 15:00Z）・うるう年（2028-02-29）でも日付がずれない', () => {
    const onlyVisit = (startsAt: string, now: string): string | null =>
      lastVisitDate([{ status: 'done', startsAt }], new Date(now))

    // 月末の 15:00Z はもう翌月 1 日。
    expect(onlyVisit('2026-08-31T15:00:00.000Z', '2026-09-01T02:00:00.000Z')).toBe('2026-09-01')
    expect(onlyVisit('2026-08-31T14:59:00.000Z', '2026-09-01T02:00:00.000Z')).toBe('2026-08-31')
    // 年末の 15:00Z はもう翌年 1 月 1 日。
    expect(onlyVisit('2026-12-31T15:00:00.000Z', '2027-01-01T02:00:00.000Z')).toBe('2027-01-01')
    expect(onlyVisit('2026-12-31T14:59:00.000Z', '2027-01-01T02:00:00.000Z')).toBe('2026-12-31')
    // うるう年の 2月28日 15:00Z は 2月29日。29日 15:00Z は 3月1日。
    expect(onlyVisit('2028-02-28T15:00:00.000Z', '2028-03-02T02:00:00.000Z')).toBe('2028-02-29')
    expect(onlyVisit('2028-02-29T15:00:00.000Z', '2028-03-02T02:00:00.000Z')).toBe('2028-03-01')
    expect(lastVisitLabel('2028-02-29')).toBe('2028年2月29日')
  })
})
