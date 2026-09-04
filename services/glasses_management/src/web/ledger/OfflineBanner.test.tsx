import type { LedgerEntry, LedgerLane, LedgerView } from '@app/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OfflineBanner } from './OfflineBanner'
import { ReservationList } from './ReservationList'

/*
 * 通信断の帯（承認済みモック docs/frontend/mockups/eye/images/EX-OFFLINE.png）。
 *
 * この面の仕事は「書けないことを伝えたうえで、読むことだけは続けられる状態を保つ」こと。
 * 成立したのか／していないのか／再試行できるのか の 3 つが文字で読めることを固定する。
 *
 * 実測値（screens/EX-OFFLINE.html）: 帯 = padding 20px 32px・地 --alert-tint・
 * 下に 2px の --alert。見出し 21px、本文 16px/1.6。「再接続を試す」min-height 52px。
 * 表は「受け付け」の列を落とした 4 列（112px / 250px / 1fr / 140px）。
 *
 * 帯は `role="status"`。接客中の読み上げを断ち切らないよう `role="alert"` にしない
 * （AC-LEDGER-18）。いつ時点かの時刻は**最後に成功した応答の `serverNow`** で、
 * 端末の時計を読まない。
 */

function jst(hhmm: string): string {
  return new Date(Date.parse(`2026-08-27T${hhmm}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

function entryOf(
  id: string,
  from: string,
  to: string,
  purposeLabel: string,
  source: LedgerEntry['source'],
  status: LedgerEntry['status'],
): LedgerEntry {
  return {
    reservationId: id,
    startsAt: jst(from),
    endsAt: jst(to),
    customerName: null,
    visitCount: null,
    purposeLabel,
    source,
    status,
    isUnassigned: false,
  }
}

const LANES: LedgerLane[] = [
  {
    kind: 'staff',
    id: 'st-nakamura',
    name: '中村 彩',
    subtitle: '',
    entries: [
      entryOf('r02', '10:30', '11:00', '視力測定', 'web', 'confirmed'),
      entryOf('r09', '15:00', '16:00', '新調相談', 'counter', 'confirmed'),
    ],
    blocks: [],
  },
  {
    kind: 'staff',
    id: 'st-sato',
    name: '佐藤 美咲',
    subtitle: '',
    entries: [entryOf('r03', '11:00', '12:00', '新調相談・視力測定', 'phone', 'confirmed')],
    blocks: [],
  },
]

const DAY: LedgerView = {
  date: '2026-08-27',
  axis: 'staff',
  view: 'list',
  opensAt: '10:00',
  closesAt: '19:00',
  slotMinutes: 30,
  lanes: LANES,
  counts: { all: 3, upcoming: 2, pendingReview: 0 },
  // 受付パネルの 3 欄（P5）。この面は読まないので器だけ置く。
  walkinWaitingCount: 0,
  estimatedWaitMinutes: null,
  nextTicketNo: 1,
  serverNow: jst('11:02'),
}

describe('通信断の帯', () => {
  it('「通信が切れています」と、いつ時点かの時刻と「再接続を試す」が並ぶ', () => {
    render(
      <OfflineBanner lastServerNow={jst('11:02')} nextRetryAt={jst('11:09')} onRetry={() => {}} />,
    )
    const band = screen.getByRole('status')
    expect(within(band).getByRole('heading', { name: '通信が切れています' })).toBeVisible()
    // 「いつ時点か」は強調のために <b> で割れるので、帯の読み上げ全体で見る。
    expect(band.textContent).toContain(
      'いまご覧の内容は 11:02 現在 のものです。予約の確定・変更・ご来店の受付は、つながってからになります。',
    )
    // 触れる大きさ 44pt 以上（実測 52px）。
    expect(within(band).getByRole('button', { name: '再接続を試す' }).className).toContain(
      'min-h-13',
    )
  })

  it('読み上げに割り込まない知らせにする（role=alert にしない）', () => {
    render(<OfflineBanner lastServerNow={jst('11:02')} onRetry={() => {}} />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('次に自動で試す時刻を 1 行添える。分からないときは作らない', () => {
    const { rerender } = render(
      <OfflineBanner lastServerNow={jst('11:02')} nextRetryAt={jst('11:09')} onRetry={() => {}} />,
    )
    expect(screen.getByText('11:09 に自動でも試します')).toBeVisible()

    rerender(<OfflineBanner lastServerNow={jst('11:02')} onRetry={() => {}} />)
    expect(screen.queryByText('に自動でも試します', { exact: false })).not.toBeInTheDocument()
  })

  it('「再接続を試す」は 1 度だけ外へ伝え、試している間は二度押しできない', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<OfflineBanner lastServerNow={jst('11:02')} onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: '再接続を試す' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<OfflineBanner lastServerNow={jst('11:02')} onRetry={onRetry} isRetrying />)
    const button = screen.getByRole('button', { name: 'つなぎ直しています…' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('一度も読めていないときは、いつ時点かの時刻を作らない', () => {
    render(<OfflineBanner lastServerNow={null} onRetry={() => {}} />)
    expect(
      screen.getByText(
        '台帳をまだ一度も読めていません。予約の確定・変更・ご来店の受付は、つながってからになります。',
      ),
    ).toBeVisible()
    expect(screen.queryByText('現在', { exact: false })).not.toBeInTheDocument()
  })

  it('帯が出ている間は「受け付け」の列ごと出さず、書き込みの操作を残さない', () => {
    render(
      <div>
        <OfflineBanner lastServerNow={jst('11:02')} onRetry={() => {}} />
        <ReservationList view={DAY} filter="all" onFilterChange={() => {}} isOffline />
      </div>,
    )
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '時間',
      'お客様',
      'ご用件',
      '担当',
    ])
    expect(screen.queryByRole('button', { name: /ご来店/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ご案内/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /内容を確認/ })).not.toBeInTheDocument()
  })

  it('台帳は時間順のリストとして読める状態を保つ', () => {
    render(
      <div>
        <OfflineBanner lastServerNow={jst('11:02')} onRetry={() => {}} />
        <ReservationList view={DAY} filter="all" onFilterChange={() => {}} isOffline />
      </div>,
    )
    const rows = within(screen.getByRole('table', { name: '本日のご予約' }))
      .getAllByRole('row')
      .slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      '10:3030分',
      '11:0060分',
      '15:0060分',
    ])
    // 出どころの 4 語は列を落としても読める（時間の下に残す）。
    expect(rows[0]?.textContent).toContain('Web予約')
    expect(rows[1]?.textContent).toContain('お電話')
    expect(rows[2]?.textContent).toContain('店頭')
  })

  it('絞り込みの札は残る（読むことは続けられる）', () => {
    render(<ReservationList view={DAY} filter="all" onFilterChange={() => {}} isOffline />)
    expect(
      within(screen.getByRole('group', { name: '表示する予約の絞り込み' })).getAllByRole('button'),
    ).toHaveLength(3)
  })
})
