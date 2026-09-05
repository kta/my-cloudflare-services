import type { RecordingContentType } from '@app/contracts'
import { auth } from '@app/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { client } from '../client'
import type { RecordingBadgeState } from './RecordingBadge'

/*
 * 端末側の録音（`specs/glasses_management/features/010-recording`）。
 *
 * 1 受付 = 1 本 = 1 R2 キー。工程を進めても戻しても切らず、分割も再開もしない。
 * 画面には現れず、出るのは `RecordingBadge` の印だけである。
 *
 * 決め:
 *   - 許可は**「受付を始める」を押したその処理の中から**求める。ルート遷移の副作用として
 *     求めない（Safari はユーザー操作を起点にしない要求をそのまま断る）。だから
 *     `useRecorder()` は呼ばれただけでは何もせず、`start()` を押した人が呼ぶ。
 *   - 形式は `audio/mp4`（AAC 32kbps モノラル）。取れない端末では `audio/webm` を試し、
 *     それも駄目なら録らない。60 分でも約 14MB で、1 ファイル上限 100MB に届かない。
 *   - 送れなかった音声は端末（IndexedDB）に控え、**5 分の固定間隔**で送り直す。
 *     控えを消すのは①送信に成功した②サーバが受け付けなくなった（`failed` / 削除済み）
 *     ③録り始めから 24 時間が過ぎた、の 3 つだけ。**端末セッションの失効では消さない**
 *     （自動ロックのたびに捨てると「11:20 に自動でもう一度送ります」が守れない）。
 *   - 失効しているあいだは送信も再生も行わない。控えを**読み出しもしない**
 *     （共有 iPad で次の利用者に聞かせる経路を作らない）。
 *   - 時刻は注入した `now()` だけを読む。`Date.now()` をこのファイルの本体に書かない
 *     （既定の依存の中だけに置く）。
 */

/** 自動の再送は 5 分の固定間隔（EX-UPLOAD-FAILED の「11:15 → 11:20」）。 */
const RETRY_MS = 300_000
/*
 * 経過時間を数え直す間隔。
 *
 * **表示の粒度と揃える。** 画面は `mm:ss` と秒まで出す（`RecordingBadge` の `elapsedLabel`）
 * ので、ここを 30 秒にすると 30 秒のうち 29 秒は秒の桁が凍り、
 * 見ている人には「録音が止まっている」としか読めない（実測: 実時間 88 秒で表示は 4 通りだけ）。
 * 秒を出すなら 1 秒ごとに数える。粒度を落としたいなら、先に表示のほうを「約1分」に変える。
 */
const RECOMPUTE_MS = 1_000
/** 24 時間送れないままの控えは捨てる（サーバも保守の経路で `failed` に落とす）。 */
const ABANDON_MS = 86_400_000
/** 音の重さ。60 分でも約 14MB に収まる（モノラル・AAC 32kbps）。 */
const AUDIO_BITS_PER_SECOND = 32_000

/** 端末に控える 1 件。**置くのはこれだけ**（氏名・電話番号・メール・度数を書かない）。 */
export type RecorderOutboxEntry = {
  recordingId: string
  blob: Blob
  contentType: RecordingContentType
  durationSeconds: number
  startedAt: string
  attempts: number
  nextAttemptAt: string
}

/** 端末の控え。既定は IndexedDB で、テストは差し替えたものを渡す。 */
export type RecorderOutbox = {
  put(entry: RecorderOutboxEntry): Promise<void>
  remove(recordingId: string): Promise<void>
  /** 送り直す時刻が来ている控え。 */
  due(nowMs: number): Promise<RecorderOutboxEntry[]>
}

/** 録音機。`MediaRecorder` の細かい形はここへ閉じ込め、外からは 4 つだけ見える。 */
export type RecorderHandle = {
  start(): void
  stop(): void
  /** 途中で止まった（`onerror` / track の `ended`）。 */
  onlost: (() => void) | null
  /** 録り終えた音声。`stop()` のあとに 1 度だけ呼ばれる。 */
  ondone: ((blob: Blob) => void) | null
}

type RecorderStreamLike = { getTracks(): { stop(): void }[] }

/** 送信の結果。`abandoned` はサーバがもう受け付けない（控えごと捨てる）。 */
type RecorderSendResult = 'stored' | 'retry' | 'abandoned'

export type RecorderApi = {
  create(input: {
    storeId: string
    receptionSessionId: string
    startedAt: string
    contentType: RecordingContentType
  }): Promise<string | null>
  send(input: {
    recordingId: string
    blob: Blob
    contentType: RecordingContentType
    durationSeconds: number
  }): Promise<RecorderSendResult>
}

export type RecorderDeps = {
  askForMicrophone(): Promise<RecorderStreamLike>
  createRecorder(
    stream: RecorderStreamLike,
  ): { recorder: RecorderHandle; contentType: RecordingContentType } | null
  outbox: RecorderOutbox
  now(): number
  api: RecorderApi
}

export type UseRecorderInput = {
  storeId: string
  /** 受付セッション。届くまで録音の行は作れない（許可は先に求めてよい）。 */
  receptionSessionId: string | null
  /** 業務セッションが有効か。失効しているあいだは送信も再生も行わない。 */
  sessionValid?: boolean
  deps?: Partial<RecorderDeps>
}

/** 「もう一度送る」の途中経過。色ではなく文でも読めるように面へ渡す。 */
type RecorderRetryState = 'idle' | 'sending' | 'failed'

export type Recorder = {
  state: RecordingBadgeState
  /** 経過秒。数えていない間は null（`--:--`）。 */
  elapsedSeconds: number | null
  /** 次に自動で送る時刻（ISO）。控えが無ければ null。 */
  nextAttemptAt: string | null
  /**
   * マイクを**断られた**。理由と直し方の面（EX-MIC-DENIED）へ差し替える合図である。
   * 途中で止まった・端末にマイクの口が無いは含めない（どちらも直し方が違う）。
   */
  micDenied: boolean
  /** 「もう一度送る」の途中経過。 */
  retrying: RecorderRetryState
  /** **押した処理の中から**呼ぶ。二度目以降は何もしない（1 受付 1 本）。 */
  start(): void
  /** 受付が終わった。録り終えて送る。 */
  stop(): void
  /** 「録音せずに続ける」。断られたことを受け入れ、同じ受付の続きへ戻す。 */
  continueWithoutRecording(): void
  /** 「もう一度送る」。5 分の周期を待たずに、いま端末にある控えを送る。 */
  retryNow(): void
}

/* --- 既定の依存（実機だけが通る道） --------------------------------------- */

/**
 * **断られた**ときだけ、理由と直し方の面（EX-MIC-DENIED）へ差し替える。
 * `NotAllowedError` は利用者か OS が「使わせない」と答えた印で、そのときだけ
 * 「設定 →「EYE予約」→「マイク」をオンにする」の 3 手順が効く。
 *
 * ほかの断り方（`NotFoundError` = マイクが刺さっていない、`NotReadableError` =
 * ほかが掴んでいる、`navigator.mediaDevices` そのものが無い古いブラウザ）は、
 * 設定を開いても直らない。**印を灰にするだけで受付を続ける** —— 直らない手順を
 * 3 つ読ませてお客様を待たせない。
 */
function refusedByPerson(error: unknown): boolean {
  return error instanceof Error && error.name === 'NotAllowedError'
}

function defaultAsk(): Promise<RecorderStreamLike> {
  const media = navigator.mediaDevices as MediaDevices | undefined
  if (media === undefined) return Promise.reject(new Error('no_media_devices'))
  return media.getUserMedia({ audio: true })
}

/** 端末が出せる形式を選ぶ。`audio/mp4` → `audio/webm` の順で、どちらも駄目なら録らない。 */
function pickContentType(): RecordingContentType | null {
  const recorder = globalThis.MediaRecorder as typeof MediaRecorder | undefined
  if (recorder === undefined) return null
  if (recorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  if (recorder.isTypeSupported('audio/webm')) return 'audio/webm'
  return null
}

function defaultCreateRecorder(
  stream: RecorderStreamLike,
): { recorder: RecorderHandle; contentType: RecordingContentType } | null {
  const contentType = pickContentType()
  if (contentType === null) return null
  const media = new MediaRecorder(stream as unknown as MediaStream, {
    mimeType: contentType,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
  })
  const chunks: Blob[] = []
  const handle: RecorderHandle = {
    start: () => media.start(),
    stop: () => media.stop(),
    onlost: null,
    ondone: null,
  }
  media.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  media.onstop = () => handle.ondone?.(new Blob(chunks, { type: contentType }))
  media.onerror = () => handle.onlost?.()
  for (const track of stream.getTracks() as MediaStreamTrack[]) {
    track.onended = () => handle.onlost?.()
  }
  return { recorder: handle, contentType }
}

const OUTBOX_DB = 'eye-recording-outbox'
const OUTBOX_STORE = 'blobs'

/** IndexedDB を 1 回だけ開く。使えない端末では控えを持たない（送れたら送るだけ）。 */
function openOutbox(): Promise<IDBDatabase | null> {
  const factory = globalThis.indexedDB as IDBFactory | undefined
  if (factory === undefined) return Promise.resolve(null)
  return new Promise((resolve) => {
    const request = factory.open(OUTBOX_DB, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(OUTBOX_STORE, { keyPath: 'recordingId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

function indexedDbOutbox(): RecorderOutbox {
  async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | null> {
    const db = await openOutbox()
    if (db === null) return null
    return await new Promise<T | null>((resolve) => {
      const request = run(db.transaction(OUTBOX_STORE, mode).objectStore(OUTBOX_STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    })
  }
  return {
    put: async (entry) => {
      await withStore('readwrite', (store) => store.put(entry))
    },
    remove: async (recordingId) => {
      await withStore('readwrite', (store) => store.delete(recordingId))
    },
    due: async (nowMs) => {
      const all = await withStore<RecorderOutboxEntry[]>('readonly', (store) => store.getAll())
      return (all ?? []).filter((entry) => Date.parse(entry.nextAttemptAt) <= nowMs)
    },
  }
}

function defaultApi(): RecorderApi {
  return {
    create: async (input) => {
      const res = await client.api.staff.recordings.$post({ json: input })
      if (!res.ok) return null
      return (await res.json()).id
    },
    send: async ({ recordingId, blob, contentType, durationSeconds }) => {
      const res = await auth.authFetch(
        `/api/staff/recordings/${encodeURIComponent(recordingId)}/content?durationSeconds=${durationSeconds}`,
        { method: 'PUT', headers: { 'content-type': contentType }, body: blob },
      )
      if (res.ok) return 'stored'
      // 404（消された）と 409（`deleted` からは動かせない）は、送り直しても直らない。
      if (res.status === 404 || res.status === 409) return 'abandoned'
      return 'retry'
    },
  }
}

/* --- 本体 ----------------------------------------------------------------- */

export function useRecorder({
  storeId,
  receptionSessionId,
  sessionValid = true,
  deps,
}: UseRecorderInput): Recorder {
  const [state, setState] = useState<RecordingBadgeState>('off')
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null)
  const [nextAttemptAt, setNextAttemptAt] = useState<string | null>(null)
  const [micDenied, setMicDenied] = useState(false)
  const [retrying, setRetrying] = useState<RecorderRetryState>('idle')

  /** 依存は毎回の描き直しで作り直さない（録音機を二度作らないため）。 */
  const wired = useRef<RecorderDeps | null>(null)
  if (wired.current === null) {
    wired.current = {
      askForMicrophone: deps?.askForMicrophone ?? defaultAsk,
      createRecorder: deps?.createRecorder ?? defaultCreateRecorder,
      outbox: deps?.outbox ?? indexedDbOutbox(),
      now: deps?.now ?? (() => Date.now()),
      api: deps?.api ?? defaultApi(),
    }
  }
  const use = wired.current

  /** 一度でも尋ねたか。工程を移って呼び直されても、二度目は何もしない。 */
  const asked = useRef(false)
  const recorder = useRef<RecorderHandle | null>(null)
  const stream = useRef<RecorderStreamLike | null>(null)
  const contentType = useRef<RecordingContentType>('audio/mp4')
  const startedAtMs = useRef<number | null>(null)
  const recordingId = useRef<string | null>(null)
  const creating = useRef(false)
  /** 送信の中身。`stop()` のあと `ondone` が渡してくる。 */
  const sending = useRef(false)

  const target = useRef({ storeId, receptionSessionId, sessionValid })
  target.current = { storeId, receptionSessionId, sessionValid }

  /** 控えを 1 件送る。結果で控えを消すか、5 分後へ置き直すかが決まる。 */
  const push = useCallback(
    async (entry: RecorderOutboxEntry): Promise<RecorderSendResult> => {
      const result = await use.api.send({
        recordingId: entry.recordingId,
        blob: entry.blob,
        contentType: entry.contentType,
        durationSeconds: entry.durationSeconds,
      })
      if (result === 'stored' || result === 'abandoned') {
        await use.outbox.remove(entry.recordingId)
        return result
      }
      const at = new Date(use.now() + RETRY_MS).toISOString()
      await use.outbox.put({ ...entry, attempts: entry.attempts + 1, nextAttemptAt: at })
      return result
    },
    [use],
  )

  /** 控えが 1 本も残っていない状態へ戻す。印は灰にも赤にもせず、ただ数えるのをやめる。 */
  const settle = useCallback(() => {
    setState('off')
    setElapsedSeconds(null)
    setNextAttemptAt(null)
  }, [])

  /**
   * 溜まっている控えを送り直す。失効しているあいだは**読み出しもしない**。
   * `force` は「もう一度送る」を押したとき —— 5 分の周期を待たずに、いま端末にある
   * 控えをその場で送る。**24 時間の見切りは force でも本物の時刻で測る**
   * （押した回数で控えの寿命が延びたり縮んだりしてはいけない）。
   */
  const flush = useCallback(
    async (force = false): Promise<RecorderSendResult | null> => {
      if (!target.current.sessionValid) return null
      const nowMs = use.now()
      let last: RecorderSendResult | null = null
      for (const entry of await use.outbox.due(force ? Number.MAX_SAFE_INTEGER : nowMs)) {
        // 24 時間送れないままの控えは捨てる（サーバも保守の経路で `failed` に落とす）。
        if (nowMs - Date.parse(entry.startedAt) > ABANDON_MS) {
          await use.outbox.remove(entry.recordingId)
          // 端末から消えたのに「録音は端末に保管中」を出し続けない（AC-REC-20）。
          last = 'abandoned'
          settle()
          continue
        }
        const result = await push(entry)
        last = result
        if (result === 'retry') setNextAttemptAt(new Date(nowMs + RETRY_MS).toISOString())
        else settle()
      }
      return last
    },
    [use, push, settle],
  )

  /** 「もう一度送る」。送れたら印ごと消え、駄目なら端末に残っていることを言い直す。 */
  const retryNow = useCallback(() => {
    setRetrying('sending')
    void flush(true).then(
      (result) => setRetrying(result === 'retry' ? 'failed' : 'idle'),
      () => setRetrying('failed'),
    )
  }, [flush])

  /** 「録音せずに続ける」。断られたことを受け入れ、同じ受付の続きへ戻す。 */
  const continueWithoutRecording = useCallback(() => setMicDenied(false), [])

  /** 録り終えた音声を送る。送れなければ端末に控え、5 分後の時刻を返す。 */
  const handleDone = useCallback(
    async (blob: Blob) => {
      if (sending.current) return
      sending.current = true
      const began = startedAtMs.current
      const nowMs = use.now()
      const durationSeconds = began === null ? 0 : Math.max(0, Math.floor((nowMs - began) / 1000))
      startedAtMs.current = null
      const id = recordingId.current
      if (id === null) {
        // 置き場所（`recordings` の行）が無い。控えても送り先が無いので持ち越さない。
        setState('off')
        setElapsedSeconds(null)
        sending.current = false
        return
      }
      const entry: RecorderOutboxEntry = {
        recordingId: id,
        blob,
        contentType: contentType.current,
        durationSeconds,
        startedAt: new Date(began ?? nowMs).toISOString(),
        attempts: 0,
        nextAttemptAt: new Date(nowMs).toISOString(),
      }
      if (!target.current.sessionValid) {
        // 失効しているあいだは送らない。控えだけ置いて、次のセッションで送り直す。
        await use.outbox.put({ ...entry, nextAttemptAt: new Date(nowMs).toISOString() })
        setState('buffered')
        setElapsedSeconds(durationSeconds)
        sending.current = false
        return
      }
      const result = await push(entry)
      if (result === 'retry') {
        setState('buffered')
        setElapsedSeconds(durationSeconds)
        setNextAttemptAt(new Date(nowMs + RETRY_MS).toISOString())
      } else {
        settle()
      }
      sending.current = false
    },
    [use, push, settle],
  )

  const start = useCallback(() => {
    if (asked.current) return
    asked.current = true
    setState('asking')
    // **この呼び出しが押した処理の中にある**ことが、Safari で許可を出せる条件である。
    use
      .askForMicrophone()
      .then((got) => {
        const made = use.createRecorder(got)
        if (made === null) {
          for (const track of got.getTracks()) track.stop()
          setState('off')
          return
        }
        stream.current = got
        recorder.current = made.recorder
        contentType.current = made.contentType
        made.recorder.onlost = () => {
          // 途中で止まった。**受付の操作は止めない**（読み上げには印が届く）。
          startedAtMs.current = null
          setState('off')
          setElapsedSeconds(null)
        }
        made.recorder.ondone = (blob) => {
          void handleDone(blob)
        }
        made.recorder.start()
        startedAtMs.current = use.now()
        setElapsedSeconds(0)
        setState('recording')
      })
      .catch((error: unknown) => {
        // 断られた。録音の行も作らない（残しても中身の来ない行になる）。
        setState('off')
        if (refusedByPerson(error)) setMicDenied(true)
      })
  }, [use, handleDone])

  const stop = useCallback(() => {
    recorder.current?.stop()
  }, [])

  // 録音の行は受付セッションが届いてから作る（許可はそれより先に求めてよい）。
  useEffect(() => {
    if (state !== 'recording') return
    if (receptionSessionId === null) return
    if (recordingId.current !== null || creating.current) return
    creating.current = true
    const began = startedAtMs.current
    use.api
      .create({
        storeId,
        receptionSessionId,
        startedAt: new Date(began ?? use.now()).toISOString(),
        contentType: contentType.current,
      })
      .then((id) => {
        recordingId.current = id
      })
      .catch(() => undefined)
      .finally(() => {
        creating.current = false
      })
  }, [state, receptionSessionId, storeId, use])

  // 経過時間。秒まで表示するので 1 秒ごとに数え直す（RECOMPUTE_MS）。
  useEffect(() => {
    if (state !== 'recording') return
    const timer = setInterval(() => {
      const began = startedAtMs.current
      if (began === null) return
      setElapsedSeconds(Math.max(0, Math.floor((use.now() - began) / 1000)))
    }, RECOMPUTE_MS)
    return () => clearInterval(timer)
  }, [state, use])

  // 自動の再送。立ち上がった時点と、次のセッションが立った時点でも 1 度流す。
  useEffect(() => {
    if (!sessionValid) return
    void flush()
    const timer = setInterval(() => {
      void flush()
    }, RETRY_MS)
    return () => clearInterval(timer)
  }, [sessionValid, flush])

  // 面を離れたら要らなくなる。マイクの明かりを点けたままにしない。
  useEffect(() => {
    return () => {
      for (const track of stream.current?.getTracks() ?? []) track.stop()
    }
  }, [])

  return {
    state,
    elapsedSeconds,
    nextAttemptAt,
    micDenied,
    retrying,
    start,
    stop,
    continueWithoutRecording,
    retryNow,
  }
}
