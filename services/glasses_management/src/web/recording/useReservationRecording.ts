import type { RecordingSummary } from '@app/contracts'
import { useEffect, useState } from 'react'
import { client } from '../client'

/*
 * ご予約 1 件にぶら下がる録音を引く。
 *
 * 引けなかったころ、保存済みの録音があっても予約台帳の詳細・予約を探す・受付履歴の
 * どこにも「● 録音を聞く」が出ず、店長は録音を一切聞けなかった。API と再生の部品は
 * 動いているのに、**画面がその 1 本を特定する手段を持っていなかった**
 * （実装不足の洗い出し recording-02 / recording-03）。
 *
 * 聞けるのは `stored` の 1 本だけである（`hasPlayableRecording`）。送信の途中や
 * 失敗した録音に「聞く」を出すと、押しても鳴らないボタンになる（AC-REC-07）。
 * 引けなかったときは黙って null を返す —— 録音は詳細の付け足しなので、
 * 引けないことで詳細そのものを止めない。
 */
export function useReservationRecording(reservationId: string | null): RecordingSummary | null {
  const [recording, setRecording] = useState<RecordingSummary | null>(null)

  useEffect(() => {
    if (reservationId === null) {
      setRecording(null)
      return
    }
    let live = true
    setRecording(null)
    client.api.staff.recordings
      .$get({ query: { reservationId, state: 'stored', limit: '1' } })
      .then(async (res) => {
        if (!live || !res.ok) return
        const list = (await res.json()) as { items?: RecordingSummary[] }
        if (live) setRecording(list.items?.[0] ?? null)
      })
      .catch(() => {
        if (live) setRecording(null)
      })
    return () => {
      live = false
    }
  }, [reservationId])

  return recording
}
