import type { AlertList } from '@app/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlertScreen } from './AlertScreen'

const response: AlertList = {
  items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      code: 'recording.upload_failed',
      severity: 'action',
      audience: 'store',
      title: '録音の保存に3回失敗しました',
      body: 'EY-R-1482　ご予約は成立しています。',
      targetType: 'recording',
      targetId: '22222222-2222-4222-8222-222222222222',
      occurredAt: '2026-08-27T02:04:00.000Z',
      readAt: null,
      resolvedAt: null,
      resolvedBy: null,
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      code: 'web_booking.pending',
      severity: 'info',
      audience: 'store',
      title: 'Web予約が2件、確認待ちです',
      body: '本日中に確認してください。',
      targetType: 'reservation',
      targetId: '44444444-4444-4444-8444-444444444444',
      occurredAt: '2026-08-27T01:41:00.000Z',
      readAt: null,
      resolvedAt: null,
      resolvedBy: null,
    },
  ],
  nextCursor: null,
  total: 2,
  counts: { all: 2, action: 1, info: 1, resolved: 12 },
}

afterEach(() => vi.unstubAllGlobals())

describe('お知らせ画面', () => {
  it('表示する本日は注入したJST時計を使う', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })),
    )
    render(
      <AlertScreen
        storeId="55555555-5555-4555-8555-555555555555"
        now={() => new Date('2026-12-31T15:00:00.000Z')}
      />,
    )
    expect(await screen.findByText('本日 1/1(金)')).toBeInTheDocument()
  })

  it('モックの4分類と未読の文字札を出し、件数を外へ渡す', async () => {
    const onCountChange = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    render(
      <AlertScreen storeId="55555555-5555-4555-8555-555555555555" onCountChange={onCountChange} />,
    )
    expect(await screen.findByText('録音の保存に3回失敗しました')).toBeInTheDocument()
    for (const label of [
      'すべて 2件',
      'アラート（対応が必要） 1件',
      'お知らせ 1件',
      '対応済み 12件',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getAllByText('未読')).toHaveLength(2)
    expect(screen.getByText('録音')).toBeInTheDocument()
    expect(screen.getByText('Web予約')).toBeInTheDocument()
    expect(onCountChange).toHaveBeenCalledWith(2)
  })

  it('すべて既読にすると再読込し、未読札が消える', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ updated: 2 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...response,
            items: response.items.map((item) => ({ ...item, readAt: '2026-08-27T02:08:00.000Z' })),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(<AlertScreen storeId="55555555-5555-4555-8555-555555555555" />)
    await userEvent.click(await screen.findByRole('button', { name: 'すべて既読にする' }))
    await waitFor(() => expect(screen.queryByText('未読')).not.toBeInTheDocument())
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/staff/alerts/read-all')
  })

  it('録音のretry受付後は再読込するが、public PATCHで解決済みにしない', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(<AlertScreen storeId="55555555-5555-4555-8555-555555555555" />)

    await userEvent.click(await screen.findByRole('button', { name: 'もう一度送る' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      '/recordings/22222222-2222-4222-8222-222222222222/retry',
    )
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/api/staff/alerts?')
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/alerts/11111111-'))).toBe(
      false,
    )
  })

  it('付属操作が失敗したら対応済みにせず、未対応のまま残す', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AlertScreen storeId="55555555-5555-4555-8555-555555555555" />)

    await userEvent.click(await screen.findByRole('button', { name: 'もう一度送る' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('操作を完了できませんでした')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'もう一度送る' })).toBeInTheDocument()
  })

  it('台帳を開くだけでは対応済みにせず、手動の汎用解決操作も出さない', async () => {
    const noManual = {
      ...response,
      items: [
        response.items[1],
        {
          ...response.items[1],
          id: '66666666-6666-4666-8666-666666666666',
          code: 'store.no_shift' as const,
          title: '本日の勤務が未登録です',
        },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(noManual), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onOpenLedger = vi.fn()
    render(
      <AlertScreen storeId="55555555-5555-4555-8555-555555555555" onOpenLedger={onOpenLedger} />,
    )

    await userEvent.click(await screen.findByRole('button', { name: '台帳で確認する' }))

    expect(onOpenLedger).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '対応済みにする' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '確認する' })).not.toBeInTheDocument()
  })
})
