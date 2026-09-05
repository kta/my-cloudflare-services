import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsScreen } from '../analytics/AnalyticsScreen'
import { ReceptionHistory } from '../reception/ReceptionHistory'
import { CalendarPanel } from '../settings/CalendarPanel'
import { EquipmentPanel } from '../settings/EquipmentPanel'
import { HoursPanel } from '../settings/HoursPanel'
import { PurposePanel } from '../settings/PurposePanel'
import { StaffPanel } from '../settings/StaffPanel'
import { StoreInfoPanel } from '../settings/StoreInfoPanel'
import { WebPublishPanel } from '../settings/WebPublishPanel'

/*
 * **読み込みに失敗したと言う面には、必ずその場でやり直す手立てを置く。**
 *
 * この製品は画面ごとの URL を持たず、再読み込みすると置き場所選択と暗証番号から
 * やり直しになる。だから「画面を開き直してください」「もう一度読み込んでください」は
 * **実行できない指示**である。以前は 7 つの設定パネルと分析・受付履歴がそう書いていた。
 *
 * この面は、各画面を 1 つずつ壊して同じ約束を守らせる。新しい画面を足したら、
 * 下の表に 1 行足すこと。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
let failing = true

beforeEach(() => {
  failing = true
  sessionStorage.setItem(
    'app.auth.token',
    `header.${btoa(JSON.stringify({ sub: 'dev:eye', org: 'eye' }))}.signature`,
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      failing
        ? new Response('{"error":"boom"}', {
            status: 500,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

const panelProps = { storeId: STORE_ID, now: '2026-08-27T02:08:00.000Z', onDraftChange: () => {} }

/** 画面ごとの「壊れたときの見え方」を 1 行で書く。 */
const SCREENS: Array<[string, () => ReactElement]> = [
  ['設定 › 店舗の情報', () => <StoreInfoPanel {...panelProps} />],
  ['設定 › 営業日', () => <CalendarPanel {...panelProps} />],
  ['設定 › 営業時間', () => <HoursPanel {...panelProps} />],
  ['設定 › ご来店の目的', () => <PurposePanel {...panelProps} />],
  ['設定 › スタッフと技能', () => <StaffPanel {...panelProps} />],
  ['設定 › 設備と点検', () => <EquipmentPanel {...panelProps} />],
  ['設定 › Web予約の公開', () => <WebPublishPanel {...panelProps} />],
  [
    '受付履歴',
    () => (
      <ReceptionHistory
        storeId={STORE_ID}
        today="2026-08-27"
        staff={[]}
        onOpenReservation={() => {}}
        onStartBooking={() => {}}
      />
    ),
  ],
]

describe.each(SCREENS)('%s が読み込みに失敗したとき', (_name, mount) => {
  it('何が読めなかったかを名指しする', async () => {
    render(mount())
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert.textContent).toMatch(/読み込めませんでした/)
  })

  it('その場でやり直す手立てを出す', async () => {
    render(mount())
    await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeInTheDocument()
  })

  it('実行できない指示（画面を開き直す）を出さない', async () => {
    render(mount())
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert.textContent).not.toMatch(/開き直/)
  })

  it('やり直すと、もう一度読みにいく', async () => {
    render(mount())
    await screen.findByRole('alert', {}, { timeout: 3000 })
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    await waitFor(() =>
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        before,
      ),
    )
  })
})

describe('分析が読み込みに失敗したとき', () => {
  const mount = () => (
    <AnalyticsScreen
      storeId={STORE_ID}
      reports={{}}
      loadReport={() => Promise.reject(new Error('boom'))}
    />
  )

  it('その場でやり直す手立てを出す', async () => {
    render(mount())
    await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeInTheDocument()
  })

  it('「もう一度読み込んでください」とだけ言って放り出さない', async () => {
    render(mount())
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert.textContent).not.toMatch(/もう一度読み込んでください/)
  })
})
