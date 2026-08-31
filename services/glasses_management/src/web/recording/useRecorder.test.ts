import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { createElement, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type RecorderApi,
  type RecorderDeps,
  type RecorderHandle,
  type RecorderOutbox,
  type RecorderOutboxEntry,
  useRecorder,
} from './useRecorder'

/*
 * 端末側の録音（`010-recording` の T-016）。
 *
 * `MediaRecorder` / `navigator.mediaDevices` / IndexedDB は jsdom に無い。だから
 * **依存（`askForMicrophone` / `createRecorder` / `outbox` / `now` / `api`）は引数で受ける**。
 * グローバルを直接 monkey patch しない。
 *
 * 時刻は注入した `now()` だけを読む（`Date.now()` に依存したテストを書かない）。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const SESSION_ID = 'd0000000-0000-4000-8000-000000000001'
const RECORDING_ID = 'a0000000-0000-4000-8000-000000000009'
/** 注入する時計の起点。2026-08-27T11:08+09:00。 */
const T0 = Date.parse('2026-08-27T02:08:00.000Z')
/** 自動の再送は 5 分の固定間隔。 */
const RETRY_MS = 300_000

/** 呼ばれた回数と引数を見るためだけの、いちばん薄い録音機。 */
function fakeRecorder() {
  const handle: RecorderHandle = { start: vi.fn(), stop: vi.fn(), onlost: null, ondone: null }
  return handle
}

function deferred<T>() {
  let settle: (value: T) => void = () => undefined
  let fail: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  return { promise, settle, fail }
}

type Harness = {
  deps: RecorderDeps
  recorder: RecorderHandle
  stored: Map<string, RecorderOutboxEntry>
  clock: { ms: number }
  ask: ReturnType<typeof vi.fn>
  send: RecorderApi['send']
  outbox: RecorderOutbox
}

function harness(overrides: Partial<RecorderDeps> = {}): Harness {
  const recorder = fakeRecorder()
  const stored = new Map<string, RecorderOutboxEntry>()
  const clock = { ms: T0 }
  const stream = { getTracks: () => [{ stop: vi.fn() }] }
  const ask = vi.fn(async () => stream)
  const outbox: RecorderOutbox = {
    put: vi.fn(async (entry: RecorderOutboxEntry) => {
      stored.set(entry.recordingId, entry)
    }),
    remove: vi.fn(async (recordingId: string) => {
      stored.delete(recordingId)
    }),
    due: vi.fn(async (nowMs: number) =>
      [...stored.values()].filter((entry) => Date.parse(entry.nextAttemptAt) <= nowMs),
    ),
  }
  const api: RecorderApi = {
    create: vi.fn(async () => RECORDING_ID),
    send: vi.fn(async () => 'stored' as const),
  }
  const deps: RecorderDeps = {
    askForMicrophone: ask,
    createRecorder: vi.fn(() => ({ recorder, contentType: 'audio/mp4' as const })),
    outbox,
    now: () => clock.ms,
    api,
    ...overrides,
  }
  return { deps, recorder, stored, clock, ask, send: api.send, outbox }
}

function mount(h: Harness, sessionValid = true) {
  return renderHook(
    (props: { sessionValid: boolean }) =>
      useRecorder({
        storeId: STORE_ID,
        receptionSessionId: SESSION_ID,
        sessionValid: props.sessionValid,
        deps: h.deps,
      }),
    { initialProps: { sessionValid } },
  )
}

/** 録り終える。`stop()` → 録音機が音声を返す、までを 1 手にまとめる。 */
async function finish(h: Harness, view: ReturnType<typeof mount>, blob = new Blob(['..'])) {
  await act(async () => {
    view.result.current.stop()
    h.recorder.ondone?.(blob)
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useRecorder', () => {
  it('受付を始める操作を押したそのイベントの中でマイクの許可を求める', async () => {
    const h = harness()
    let askedInsideTheHandler = false
    function Probe() {
      const recorder = useRecorder({
        storeId: STORE_ID,
        receptionSessionId: SESSION_ID,
        deps: h.deps,
      })
      return createElement(
        'button',
        {
          type: 'button',
          onClick: () => {
            recorder.start()
            // 押した処理を抜ける前にもう求めている（あとの副作用に回していない）。
            askedInsideTheHandler = h.ask.mock.calls.length === 1
          },
        },
        '新しい予約を取る',
      )
    }
    render(createElement(Probe))
    expect(h.ask).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '新しい予約を取る' }))
    expect(askedInsideTheHandler).toBe(true)
  })

  it('画面が切り替わっただけでは許可を求めない', () => {
    const h = harness()
    const view = mount(h)
    view.rerender({ sessionValid: true })
    expect(h.ask).not.toHaveBeenCalled()
    expect(h.deps.api.create).not.toHaveBeenCalled()
    expect(view.result.current.state).toBe('off')
  })

  it('尋ねている間の状態は asking で、答えが来るまで受付の操作は止まらない', async () => {
    const pending = deferred<{ getTracks: () => { stop: () => void }[] }>()
    const h = harness({ askForMicrophone: vi.fn(() => pending.promise) })
    function Probe() {
      const [count, setCount] = useState(0)
      const recorder = useRecorder({
        storeId: STORE_ID,
        receptionSessionId: SESSION_ID,
        deps: h.deps,
      })
      return createElement('div', null, [
        createElement(
          'button',
          { key: 'a', type: 'button', onClick: () => recorder.start() },
          '受付を始める',
        ),
        createElement(
          'button',
          { key: 'b', type: 'button', onClick: () => setCount((n) => n + 1) },
          `日にちを選ぶ ${count}`,
        ),
        createElement('output', { key: 'c' }, recorder.state),
      ])
    }
    render(createElement(Probe))
    fireEvent.click(screen.getByRole('button', { name: '受付を始める' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('asking'))
    // 答えが来ていなくても、工程の操作はそのまま効く。
    fireEvent.click(screen.getByRole('button', { name: '日にちを選ぶ 0' }))
    expect(screen.getByRole('button', { name: '日にちを選ぶ 1' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('asking')
  })

  it('断られたら off になり、録音の行を作りに行かない', async () => {
    const h = harness({
      askForMicrophone: vi.fn(() => Promise.reject(new Error('NotAllowedError'))),
    })
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    await waitFor(() => expect(view.result.current.state).toBe('off'))
    expect(h.deps.api.create).not.toHaveBeenCalled()
    expect(view.result.current.elapsedSeconds).toBeNull()
  })

  it('断られたら、理由と直し方の面へ差し替える合図（micDenied）が立つ', async () => {
    const denied = new Error('Permission denied')
    denied.name = 'NotAllowedError'
    const h = harness({ askForMicrophone: vi.fn(() => Promise.reject(denied)) })
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    await waitFor(() => expect(view.result.current.micDenied).toBe(true))
    expect(view.result.current.state).toBe('off')
  })

  it('マイクが刺さっていないだけのときは、直し方の面を出さない', async () => {
    // `NotFoundError` は「使わせない」ではなく「口が無い」。設定を開いても直らない。
    const missing = new Error('Requested device not found')
    missing.name = 'NotFoundError'
    const h = harness({ askForMicrophone: vi.fn(() => Promise.reject(missing)) })
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    await waitFor(() => expect(view.result.current.state).toBe('off'))
    expect(view.result.current.micDenied).toBe(false)
  })

  it('マイクの口そのものが無い端末では、直し方の面を出さない', async () => {
    // 「設定で「マイク」をオンにする」は断られたときにだけ効く助言で、口が無い端末では直らない。
    const h = harness({
      askForMicrophone: vi.fn(() => Promise.reject(new Error('no_media_devices'))),
    })
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    await waitFor(() => expect(view.result.current.state).toBe('off'))
    expect(view.result.current.micDenied).toBe(false)
  })

  it('「録音せずに続ける」で合図が下り、許可を二度は尋ねない', async () => {
    const denied = new Error('Permission denied')
    denied.name = 'NotAllowedError'
    const ask = vi.fn(() => Promise.reject(denied))
    const h = harness({ askForMicrophone: ask })
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    await waitFor(() => expect(view.result.current.micDenied).toBe(true))

    await act(async () => {
      view.result.current.continueWithoutRecording()
      await Promise.resolve()
    })
    expect(view.result.current.micDenied).toBe(false)
    // 同じ受付で尋ね直さない（許可を説明するだけの面を挟まない、と同じ決め）。
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('「もう一度送る」は 5 分を待たずに、いま端末にある控えを送る', async () => {
    const send = vi
      .fn<RecorderApi['send']>()
      .mockResolvedValueOnce('retry')
      .mockResolvedValueOnce('stored')
    const h = harness()
    h.deps.api = { create: vi.fn(async () => RECORDING_ID), send }
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    await waitFor(() => expect(view.result.current.state).toBe('recording'))
    await finish(h, view)
    await waitFor(() => expect(view.result.current.state).toBe('buffered'))
    // 次の自動送信は 5 分後。**押した人はそれを待たない。**
    expect(view.result.current.nextAttemptAt).toBe(new Date(h.clock.ms + RETRY_MS).toISOString())

    await act(async () => {
      view.result.current.retryNow()
      await Promise.resolve()
    })
    await waitFor(() => expect(view.result.current.state).toBe('off'))
    expect(send).toHaveBeenCalledTimes(2)
    expect(view.result.current.retrying).toBe('idle')
    expect(h.stored.size).toBe(0)
  })

  it('「もう一度送る」でも駄目なら、端末に残っていることを言い直す', async () => {
    const h = harness()
    h.deps.api = {
      create: vi.fn(async () => RECORDING_ID),
      send: vi.fn(async () => 'retry' as const),
    }
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    await waitFor(() => expect(view.result.current.state).toBe('recording'))
    await finish(h, view)
    await waitFor(() => expect(view.result.current.state).toBe('buffered'))

    await act(async () => {
      view.result.current.retryNow()
      await Promise.resolve()
    })
    await waitFor(() => expect(view.result.current.retrying).toBe('failed'))
    expect(view.result.current.state).toBe('buffered')
    expect(h.stored.size).toBe(1)
  })

  it('工程を進めても止めても、録音は 1 本のまま続く', async () => {
    const h = harness()
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    await waitFor(() => expect(view.result.current.state).toBe('recording'))
    // 工程が変わって呼び直されても、二度目は何もしない。
    await act(async () => {
      view.result.current.start()
      view.rerender({ sessionValid: true })
      view.result.current.start()
      await Promise.resolve()
    })
    expect(h.ask).toHaveBeenCalledTimes(1)
    expect(h.recorder.start).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(h.deps.api.create).toHaveBeenCalledTimes(1))
  })

  it('経過時間は注入した now の差から出す（実時刻を読まない）', async () => {
    vi.useFakeTimers()
    const h = harness()
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    expect(view.result.current.elapsedSeconds).toBe(0)
    // 端末の時計ではなく、注いだ時刻だけが経過時間を決める。
    h.clock.ms = T0 + 68_000
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(view.result.current.elapsedSeconds).toBe(68)
    h.clock.ms = T0 + 192_000
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(view.result.current.elapsedSeconds).toBe(192)
  })

  it('録音が途中で止まったら off に落ち、受付の操作は続けられる', async () => {
    const h = harness()
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    await waitFor(() => expect(view.result.current.state).toBe('recording'))
    await act(async () => {
      h.recorder.onlost?.()
      await Promise.resolve()
    })
    expect(view.result.current.state).toBe('off')
    expect(view.result.current.elapsedSeconds).toBeNull()
    // 止まったことは知らせるが、受付は続けられる（もう一度始め直させない）。
    expect(view.result.current.nextAttemptAt).toBeNull()
  })

  it('送信に成功したら端末の控えを消す', async () => {
    const h = harness()
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    await waitFor(() => expect(h.deps.api.create).toHaveBeenCalledTimes(1))
    h.clock.ms = T0 + 204_000
    await finish(h, view)
    await waitFor(() => expect(h.deps.api.send).toHaveBeenCalledTimes(1))
    expect(h.outbox.remove).toHaveBeenCalledWith(RECORDING_ID)
    expect(h.stored.size).toBe(0)
    expect(view.result.current.state).toBe('off')
  })

  it('送信に失敗したら端末に控えを置き、5 分後の時刻を返す', async () => {
    const h = harness()
    ;(h.deps.api.send as ReturnType<typeof vi.fn>).mockResolvedValue('retry')
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    await waitFor(() => expect(h.deps.api.create).toHaveBeenCalledTimes(1))
    h.clock.ms = T0 + 204_000
    await finish(h, view)
    await waitFor(() => expect(view.result.current.state).toBe('buffered'))
    expect(h.outbox.put).toHaveBeenCalledTimes(1)
    expect(h.stored.get(RECORDING_ID)?.nextAttemptAt).toBe(
      new Date(T0 + 204_000 + RETRY_MS).toISOString(),
    )
    expect(view.result.current.nextAttemptAt).toBe(new Date(T0 + 204_000 + RETRY_MS).toISOString())
    // 「録音は端末に保管中　03:24」（承認済みモック EX-UPLOAD-FAILED）。
    expect(view.result.current.elapsedSeconds).toBe(204)
  })

  it('端末の控えに氏名・電話番号・メール・度数を書かない', async () => {
    const h = harness()
    ;(h.deps.api.send as ReturnType<typeof vi.fn>).mockResolvedValue('retry')
    const view = mount(h)
    await act(async () => {
      view.result.current.start()
      await Promise.resolve()
    })
    await waitFor(() => expect(h.deps.api.create).toHaveBeenCalledTimes(1))
    h.clock.ms = T0 + 204_000
    await finish(h, view)
    await waitFor(() => expect(h.outbox.put).toHaveBeenCalledTimes(1))
    const entry = h.stored.get(RECORDING_ID)
    expect(entry).toBeDefined()
    expect(Object.keys(entry as RecorderOutboxEntry).sort()).toEqual([
      'attempts',
      'blob',
      'contentType',
      'durationSeconds',
      'nextAttemptAt',
      'recordingId',
      'startedAt',
    ])
  })

  it('セッションが失効しているあいだは送信も再生も行わない', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.stored.set(RECORDING_ID, {
      recordingId: RECORDING_ID,
      blob: new Blob(['..']),
      contentType: 'audio/mp4',
      durationSeconds: 204,
      startedAt: new Date(T0).toISOString(),
      attempts: 1,
      nextAttemptAt: new Date(T0).toISOString(),
    })
    mount(h, false)
    h.clock.ms = T0 + RETRY_MS * 2
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETRY_MS * 2)
    })
    // 送らないだけでなく、控えを読み出しもしない（聞かせる経路を作らない）。
    expect(h.outbox.due).not.toHaveBeenCalled()
    expect(h.deps.api.send).not.toHaveBeenCalled()
    // 控えは消さない（失効では捨てない）。
    expect(h.stored.size).toBe(1)
  })

  it('同じ端末で次のセッションが立つと自動の再送が再開する', async () => {
    vi.useFakeTimers()
    const h = harness()
    h.stored.set(RECORDING_ID, {
      recordingId: RECORDING_ID,
      blob: new Blob(['..']),
      contentType: 'audio/mp4',
      durationSeconds: 204,
      startedAt: new Date(T0).toISOString(),
      attempts: 1,
      nextAttemptAt: new Date(T0).toISOString(),
    })
    const view = mount(h, false)
    expect(h.deps.api.send).not.toHaveBeenCalled()
    await act(async () => {
      view.rerender({ sessionValid: true })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(h.deps.api.send).toHaveBeenCalledTimes(1)
    expect(h.outbox.remove).toHaveBeenCalledWith(RECORDING_ID)
    expect(h.stored.size).toBe(0)
  })

  it('failed に落ちた録音は端末の控えからも消える', async () => {
    vi.useFakeTimers()
    const h = harness()
    ;(h.deps.api.send as ReturnType<typeof vi.fn>).mockResolvedValue('abandoned')
    h.stored.set(RECORDING_ID, {
      recordingId: RECORDING_ID,
      blob: new Blob(['..']),
      contentType: 'audio/mp4',
      durationSeconds: 204,
      startedAt: new Date(T0).toISOString(),
      attempts: 3,
      nextAttemptAt: new Date(T0).toISOString(),
    })
    const view = mount(h, true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(h.deps.api.send).toHaveBeenCalledTimes(1)
    expect(h.outbox.remove).toHaveBeenCalledWith(RECORDING_ID)
    expect(h.stored.size).toBe(0)
    expect(view.result.current.state).toBe('off')
  })
})
