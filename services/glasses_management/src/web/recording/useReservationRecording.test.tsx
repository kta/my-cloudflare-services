import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReservationRecording } from './useReservationRecording'

/*
 * ご予約 1 件にぶら下がる録音を引く。引く手段が無かったころ、保存済みの録音があっても
 * 予約台帳の詳細・予約を探す・受付履歴のどこにも「● 録音を聞く」が出ず、店長は
 * 録音を一切聞けなかった（実装不足の洗い出し recording-02 / recording-03）。
 */

const STORED = { id: 'r1', state: 'stored', durationSeconds: 192 }

function Probe({ reservationId }: { reservationId: string | null }) {
  const recording = useReservationRecording(reservationId)
  return <p data-testid="out">{recording === null ? 'なし' : recording.id}</p>
}

let asked: URL[] = []

beforeEach(() => {
  asked = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      asked.push(url)
      return new Response(JSON.stringify({ items: [STORED], nextCursor: null, total: 1 }), {
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ご予約の録音を引く', () => {
  it('ご予約 id で `stored` の 1 本だけを聞きに行く', async () => {
    render(<Probe reservationId="res-1" />)
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('r1'))
    const asking = asked.find((url) => url.pathname === '/api/staff/recordings')
    expect(asking?.searchParams.get('reservationId')).toBe('res-1')
    // 送信の途中や失敗した録音に「聞く」を出さない（AC-REC-07）。
    expect(asking?.searchParams.get('state')).toBe('stored')
    expect(asking?.searchParams.get('limit')).toBe('1')
  })

  it('ご予約を選んでいなければ、聞きに行かない', () => {
    render(<Probe reservationId={null} />)
    expect(screen.getByTestId('out')).toHaveTextContent('なし')
    expect(asked.filter((url) => url.pathname === '/api/staff/recordings')).toHaveLength(0)
  })

  it('引けなかったら黙って null（録音のせいで詳細そのものを止めない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    )
    render(<Probe reservationId="res-1" />)
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('なし'))
  })
})
