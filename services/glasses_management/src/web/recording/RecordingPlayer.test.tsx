import type {
  ReceptionHistoryDetail,
  ReceptionHistoryEntry,
  RecordingSummary,
  ReservationDetail as ReservationDetailShape,
} from '@app/contracts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReservationDetail } from '../ledger/ReservationDetail'
import { ReceptionHistory } from '../reception/ReceptionHistory'
import { type PlaybackSource, RecordingPlayer } from './RecordingPlayer'

/*
 * 受付の録音を聞く導線（承認済みモック docs/frontend/mockups/eyex/images/LEDGER-DETAIL.png /
 * CHANGE-SEARCH.png / HISTORY-LIST.png）。
 *
 * この部品の仕事は「持ち出せる形を一切作らずに、その場で 1 件だけ聞かせる」こと。
 *
 * 実測:
 *   LEDGER-DETAIL `.listen` = min-height 40px / padding 0 12px / 枠 1px --alert /
 *     角 pill / 地 --alert-tint / 文字 600 13px（触れるものの下限 44pt へ上げる）。
 *   CHANGE-SEARCH は白い `.btn`「録音を聞く　03:12」（時間は mono）。
 *   HISTORY-LIST `.play` = 横並び gap 16px・最大幅 520px。「再生する」min-height 44px /
 *     padding 0 18px。バーは高さ 8px・角 4px・地 --surface-2・進み --brand。
 *     右に mono 600 13px の「03:24 / 06:12」。
 */

const RECORDING_ID = '11111111-1111-4111-8111-111111111111'

function stored(overrides: Partial<RecordingSummary> = {}): RecordingSummary {
  return { id: RECORDING_ID, state: 'stored', durationSeconds: 372, ...overrides }
}

function sourceOf(overrides: Partial<PlaybackSource> = {}): PlaybackSource {
  return {
    issue: vi.fn(async () => ({
      token: 'a'.repeat(64),
      expiresAt: '2026-08-27T02:23:00.000Z',
      durationSeconds: 372,
    })),
    open: vi.fn(async () => ({ url: 'blob:eyex/one', release: vi.fn() })),
    ...overrides,
  }
}

/** jsdom は再生そのものを実装していない。`<audio>` は製品側の正しい手段なので、鳴らす所だけ塞ぐ。 */
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
})

/** 900 秒のチケットがまだ生きている時刻。実時刻を読まない。 */
function nowInside(): Date {
  return new Date('2026-08-27T02:10:00.000Z')
}

describe('RecordingPlayer', () => {
  it('録音が無い予約では再生の導線を出さない', () => {
    const { container } = render(<RecordingPlayer recording={null} now={nowInside} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('削除済みの録音でも再生の導線を出さない', () => {
    const { container } = render(
      <RecordingPlayer recording={stored({ state: 'deleted' })} now={nowInside} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('端末に残ったままの録音（failed）でも再生の導線を出さない', () => {
    const { container } = render(
      <RecordingPlayer recording={stored({ state: 'failed' })} now={nowInside} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('台帳の詳細では「録音を聞く」と長さが 1 つのボタンに出る', () => {
    render(
      <RecordingPlayer
        recording={stored({ durationSeconds: 192 })}
        placement="pill"
        now={nowInside}
      />,
    )

    const button = screen.getByRole('button', { name: '録音を聞く 03:12' })
    expect(button.className).toMatch(/rounded-full/)
    expect(button.className).toMatch(/min-h-11\b/)
  })

  it('押すとチケットを取ってから本体を取りに行く（2 段）', async () => {
    const source = sourceOf()
    render(<RecordingPlayer recording={stored()} source={source} now={nowInside} />)

    await userEvent.click(screen.getByRole('button', { name: /録音を聞く/ }))

    await waitFor(() => expect(source.open).toHaveBeenCalledTimes(1))
    expect(source.issue).toHaveBeenCalledWith(RECORDING_ID)
    expect(source.open).toHaveBeenCalledWith(RECORDING_ID, 'a'.repeat(64))
  })

  it('再生位置のバーと「03:24 / 06:12」が進む', async () => {
    const { container } = render(
      <RecordingPlayer
        recording={stored()}
        placement="inline"
        source={sourceOf()}
        now={nowInside}
      />,
    )

    expect(screen.getByText('00:00 / 06:12')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '再生する' }))
    const audio = await waitFor(() => {
      const found = container.querySelector('audio')
      expect(found).not.toBeNull()
      return found as HTMLAudioElement
    })

    Object.defineProperty(audio, 'currentTime', { value: 204, configurable: true })
    fireEvent.timeUpdate(audio)

    expect(screen.getByText('03:24 / 06:12')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: '再生位置' })
    expect(bar).toHaveAttribute('aria-valuenow', '204')
    expect(bar).toHaveAttribute('aria-valuemax', '372')
    expect(bar).toHaveAttribute('aria-valuetext', '03:24 / 06:12')
  })

  it('画面にも DOM にも保管庫の URL とダウンロードの導線が出ない', async () => {
    const { container } = render(
      <RecordingPlayer
        recording={stored()}
        placement="inline"
        source={sourceOf()}
        now={nowInside}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '再生する' }))
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull())

    const html = container.innerHTML
    expect(html).not.toContain('/api/staff/recordings')
    expect(html).not.toContain('r2')
    expect(html).not.toContain('http')
    expect(container.querySelector('[download]')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('audio')).not.toHaveAttribute('controls')
  })

  it('チケットが切れたら手元の音声を手放し、「もう一度開く」で取り直す', async () => {
    const release = vi.fn()
    const source = sourceOf({
      open: vi.fn(async () => ({ url: 'blob:eyex/one', release })),
    })
    const clock = { at: new Date('2026-08-27T02:10:00.000Z') }
    const { container } = render(
      <RecordingPlayer
        recording={stored()}
        placement="inline"
        source={source}
        now={() => clock.at}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '再生する' }))
    const audio = await waitFor(() => {
      const found = container.querySelector('audio')
      expect(found).not.toBeNull()
      return found as HTMLAudioElement
    })

    // 900 秒のチケットが切れたあとに聞き終えた。手元に音声を残さない。
    clock.at = new Date('2026-08-27T02:30:00.000Z')
    fireEvent.ended(audio)

    expect(release).toHaveBeenCalledTimes(1)
    expect(container.querySelector('audio')).toBeNull()

    await userEvent.click(await screen.findByRole('button', { name: 'もう一度開く' }))

    await waitFor(() => expect(source.issue).toHaveBeenCalledTimes(2))
    expect(source.open).toHaveBeenCalledTimes(2)
  })

  it('切れたチケットのまま押しても、鳴らさずに取り直しへ戻す', async () => {
    const source = sourceOf()
    const clock = { at: new Date('2026-08-27T02:10:00.000Z') }
    render(
      <RecordingPlayer
        recording={stored()}
        placement="inline"
        source={source}
        now={() => clock.at}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '再生する' }))
    await screen.findByRole('button', { name: '一時停止' })

    clock.at = new Date('2026-08-27T02:30:00.000Z')
    await userEvent.click(screen.getByRole('button', { name: '一時停止' }))

    expect(await screen.findByRole('button', { name: 'もう一度開く' })).toBeInTheDocument()
    expect(source.open).toHaveBeenCalledTimes(1)
  })

  it('もう一度押すと止まり、そのまま同じ位置から続けられる', async () => {
    render(
      <RecordingPlayer
        recording={stored()}
        placement="inline"
        source={sourceOf()}
        now={nowInside}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '再生する' }))
    const pause = await screen.findByRole('button', { name: '一時停止' })
    await userEvent.click(pause)

    expect(await screen.findByRole('button', { name: '再生する' })).toBeInTheDocument()
  })

  it('権限が無いときは理由が読める（403）', async () => {
    const source = sourceOf({
      issue: vi.fn(async () => {
        throw Object.assign(new Error('forbidden'), { status: 403 })
      }),
    })
    render(<RecordingPlayer recording={stored()} source={source} now={nowInside} />)

    await userEvent.click(screen.getByRole('button', { name: /録音を聞く/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '録音を聞く権限がありません。お店の管理者にご確認ください。',
    )
  })

  it('開けなかったときは、もう一度押せる形で理由を出す', async () => {
    const source = sourceOf({
      open: vi.fn(async () => {
        throw new Error('offline')
      }),
    })
    render(<RecordingPlayer recording={stored()} source={source} now={nowInside} />)

    await userEvent.click(screen.getByRole('button', { name: /録音を聞く/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '録音を開けませんでした。もう一度お試しください。',
    )
    expect(screen.getByRole('button', { name: /録音を聞く/ })).toBeEnabled()
  })

  it('開いている間は二度押しをさせない', async () => {
    let release = (): void => undefined
    const source = sourceOf({
      issue: vi.fn(
        () =>
          new Promise<{ token: string; expiresAt: string; durationSeconds: number | null }>(
            (resolve) => {
              release = () =>
                resolve({
                  token: 'b'.repeat(64),
                  expiresAt: '2026-08-27T02:23:00.000Z',
                  durationSeconds: 372,
                })
            },
          ),
      ),
    })
    render(<RecordingPlayer recording={stored()} source={source} now={nowInside} />)

    await userEvent.click(screen.getByRole('button', { name: /録音を聞く/ }))
    // `disabled` にせず `aria-busy` にする（押した指の居場所を消さない）。
    const opening = await screen.findByRole('button', { name: '開いています…' })
    expect(opening).toBeEnabled()
    expect(opening).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(opening)
    expect(source.issue).toHaveBeenCalledTimes(1)

    release()
    await waitFor(() => expect(source.open).toHaveBeenCalledTimes(1))
  })

  it('画面を離れるときに、その場かぎりの参照を手放す', async () => {
    const releaseSpy = vi.fn()
    const source = sourceOf({
      open: vi.fn(async () => ({ url: 'blob:eyex/one', release: releaseSpy })),
    })
    const { unmount } = render(
      <RecordingPlayer recording={stored()} source={source} now={nowInside} />,
    )

    await userEvent.click(screen.getByRole('button', { name: /録音を聞く/ }))
    await waitFor(() => expect(source.open).toHaveBeenCalledTimes(1))
    unmount()

    expect(releaseSpy).toHaveBeenCalledTimes(1)
  })

  it('長さが分からない録音では「--:--」を出し、導線は残す', () => {
    render(<RecordingPlayer recording={stored({ durationSeconds: null })} now={nowInside} />)

    expect(screen.getByRole('button', { name: '録音を聞く --:--' })).toBeInTheDocument()
  })
})

/* --- 導線を差し込む 2 か所 ------------------------------------------------- */

const JST = 9 * 60 * 60 * 1000

function jst(hhmm: string): string {
  return new Date(Date.parse(`2026-08-27T${hhmm}:00.000Z`) - JST).toISOString()
}

const RESERVATION: ReservationDetailShape = {
  id: 'a0000000-0000-4000-8000-000000000001',
  code: 'EY-2608-0003',
  storeId: '11111111-2222-4333-8444-555555555555',
  source: 'phone',
  status: 'confirmed',
  startsAt: jst('11:00'),
  endsAt: jst('12:00'),
  durationMinutes: 60,
  purposes: [
    { purposeId: 'p-new', nameInternal: 'メガネを新しく作る', durationMinutes: 60, sortOrder: 0 },
  ],
  assignments: [
    { kind: 'staff', targetId: 'st-sato', startsAt: jst('11:00'), endsAt: jst('12:00') },
  ],
  webBookingCode: null,
  purposeLabel: '新調相談',
  purposeLabelInternal: 'メガネを新しく作る',
  noteCustomer: '',
  noteInternal: '',
  version: 1,
  createdAt: jst('09:10'),
  updatedAt: jst('09:10'),
  createdBy: null,
  cancelledAt: null,
  cancelReason: null,
}

describe('予約詳細（LEDGER-DETAIL）の「録音を聞く」', () => {
  function open(recording: RecordingSummary | null) {
    return render(
      <div className="relative">
        <ReservationDetail
          detail={RESERVATION}
          staffName="佐藤 美咲"
          equipmentNames={['視力測定機 A']}
          recording={recording}
          onClose={() => undefined}
        />
      </div>,
    )
  }

  it('録音があるときだけ、頭の右に「録音を聞く」が出る', () => {
    open(stored({ durationSeconds: 192 }))

    expect(screen.getByRole('button', { name: '録音を聞く 03:12' })).toBeInTheDocument()
  })

  it('保存に失敗した予約は台帳に載るが、「録音を聞く」は出ない', () => {
    open(stored({ state: 'failed' }))

    expect(screen.getByRole('heading', { name: '11:00–12:00' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /録音を聞く/ })).not.toBeInTheDocument()
  })

  it('録音を渡さない器では、閉じるための ✕ が右端に残る', () => {
    open(null)

    expect(screen.queryByRole('button', { name: /録音を聞く/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '詳細を閉じる' })).toBeInTheDocument()
  })
})

describe('受付履歴（HISTORY-LIST）の「受付のときの録音」', () => {
  const STORE_ID = '11111111-2222-4333-8444-555555555555'
  const ENTRY_ID = 'f0000000-0000-4000-8000-000000000001'

  const ENTRY: ReceptionHistoryEntry = {
    entryId: ENTRY_ID,
    sessionId: ENTRY_ID,
    startedAt: jst('11:08'),
    displayName: '田中 花子 様',
    visitCount: 4,
    outcome: 'discarded',
    reservationStatus: null,
  }

  const DETAIL: ReceptionHistoryDetail = {
    entryId: ENTRY_ID,
    sessionId: ENTRY_ID,
    reservation: null,
    receivedBy: '中村 彩',
    receivedAt: jst('11:08'),
    changes: [],
    recording: null,
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost')
        const body = url.pathname.endsWith('/reception-sessions')
          ? { items: [ENTRY], nextCursor: null, total: 1, relaxations: [] }
          : DETAIL
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function pick(recording: RecordingSummary | null) {
    render(
      <ReceptionHistory
        storeId={STORE_ID}
        today="2026-08-27"
        staff={[]}
        recording={recording}
        onOpenReservation={() => undefined}
        onStartBooking={() => undefined}
      />,
    )
    await userEvent.click(await screen.findByRole('button', { name: /田中 花子 様/ }))
    await screen.findByText('破棄した受付')
  }

  it('録音があるときだけ「受付のときの録音」の節が出る', async () => {
    await pick(stored())

    expect(screen.getByRole('heading', { name: '受付のときの録音' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再生する' })).toBeInTheDocument()
    expect(screen.getByText('00:00 / 06:12')).toBeInTheDocument()
  })

  it('録音が無い受付では、見出しごと出さない', async () => {
    await pick(null)

    expect(screen.queryByRole('heading', { name: '受付のときの録音' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '再生する' })).not.toBeInTheDocument()
  })
})
