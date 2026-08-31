import type { RecordingSummary } from '@app/contracts'
import { auth } from '@app/shared'
import { cn, focusRing } from '@app/ui'
import { useEffect, useRef, useState } from 'react'
import { client } from '../client'

/*
 * 受付の録音を聞く導線（承認済みモック docs/frontend/mockups/eyex/images/LEDGER-DETAIL.png /
 * CHANGE-SEARCH.png / HISTORY-LIST.png）。
 *
 * 題材: 「言った言わない」を確かめるために、1 件の受付だけを聞き直す動作。
 * トークン計画: 赤い輪郭のボタン 1 つ（`--color-danger` の枠と文字 /
 *   `--color-danger-soft` の地）。再生位置のバーだけ `--color-pine`。**新しい色を足さない。**
 * シグネチャ: **一覧から一括で聞ける導線を作らない。**入口は 1 件を選んだあとの
 *   予約詳細・予約検索・受付履歴の 3 か所だけで、録音が無ければボタンそのものを出さない
 *   （無効化ではなく非表示）。
 *
 * 実測:
 *   LEDGER-DETAIL `.listen` = min-height 40px / padding 0 12px / 枠 1px --alert /
 *     角 pill / 地 --alert-tint / 文字 600 13px。**触れるものの下限 44pt（min-h-11）へ上げる。**
 *   CHANGE-SEARCH は白い `.btn`「録音を聞く　03:12」（時間は等幅）。
 *   HISTORY-LIST `.play` = 横並び gap 16px（gap-4）・最大幅 520px（max-w-130）。
 *     「再生する」min-height 44px / padding 0 18px。バーは高さ 8px（h-2）・角 4px（=丸ごと丸い）・
 *     地 --surface-2・進み --brand。右に等幅 600 13px の「03:24 / 06:12」。
 *
 * 決め（`04-api.md` §3.9 と P7 の計画）:
 *   - 手順は 3 段で固定する。**`<audio src="/api/...">` に URL を直接入れない** —
 *     `/api/staff/*` は default-deny の内側で、`<audio>` の要求には `Authorization` が
 *     付かないので必ず 401 になる。
 *     ① `POST .../playback` でチケット（`token` / `expiresAt`）を得る
 *     ② `GET .../stream?token=…` を `Authorization` 付きで読み、blob をその場かぎりの参照にする
 *     ③ 面を離れるときにその参照を手放す
 *   - **ダウンロードの導線を作らない。**`<a download>` も `controls`（保存メニューが出る）も置かない。
 *   - `URL.revokeObjectURL()` は 1 回の再生の終わり（`ended`）ではなく、**面を離れるときと
 *     開き直すとき**に呼ぶ。`ended` で剥がすと聞き直しのたびにチケットを取り直すことになり、
 *     900 秒のチケットの意味が消える。
 *   - 時刻は引数（`now`）で受ける。チケットが切れていたら「もう一度開く」で 1 段目から取り直す。
 */

/** 「03:24」。数えていないときは「--:--」を出し、0 秒と取り違えさせない。 */
export function recordingLength(seconds: number | null): string {
  if (seconds === null) return '--:--'
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

/**
 * 聞ける録音かどうか。**無いときと消したときは導線ごと出さない**（無効化ではなく非表示）ので、
 * 「受付のときの録音」の見出しを置くかどうかも、呼ぶ側はこの 1 つの問いで決める。
 */
export function hasPlayableRecording(
  recording: RecordingSummary | null | undefined,
): recording is RecordingSummary {
  return recording != null && recording.state === 'stored'
}

/** 再生の 2 段。テストと器が差し替えられるよう、依存は引数で受ける。 */
export type PlaybackSource = {
  /** 1 段目。短命チケット（900 秒）を得る。 */
  issue: (
    recordingId: string,
  ) => Promise<{ token: string; expiresAt: string; durationSeconds: number | null }>
  /** 2 段目。チケットで本体を読み、その場かぎりの参照にする。 */
  open: (recordingId: string, token: string) => Promise<{ url: string; release: () => void }>
}

/** 応答の番号を持ったまま投げる。403（権限が無い）と、それ以外を画面で言い分けるため。 */
class PlaybackFailure extends Error {
  readonly status: number
  constructor(status: number) {
    super(`playback failed: ${status}`)
    this.status = status
  }
}

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null
  const status = (error as { status: unknown }).status
  return typeof status === 'number' ? status : null
}

const API_SOURCE: PlaybackSource = {
  async issue(recordingId) {
    const res = await client.api.staff.recordings[':recordingId'].playback.$post({
      param: { recordingId },
    })
    if (!res.ok) throw new PlaybackFailure(res.status)
    return await res.json()
  },
  async open(recordingId, token) {
    // チケットは `zValidator` を通していない素のクエリなので、RPC の型には現れない。
    // ReceptionHistory と同じ作法で、`fetch` を差し替えて 1 語だけ足す。
    const res = await client.api.staff.recordings[':recordingId'].stream.$get(
      { param: { recordingId } },
      {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          auth.authFetch(`${String(input)}?token=${encodeURIComponent(token)}`, init),
      },
    )
    if (!res.ok) throw new PlaybackFailure(res.status)
    // blob: の参照は同じタブの中でしか開けない。保管庫の URL は画面へ出ない。
    const url = URL.createObjectURL(await res.blob())
    return { url, release: () => URL.revokeObjectURL(url) }
  },
}

/** 台帳の詳細（丸い赤）・予約検索（白）・受付履歴（バー付き）の 3 形。 */
type RecordingPlayerPlacement = 'pill' | 'row' | 'inline'

export type RecordingPlayerProps = {
  /**
   * 聞く録音。`null` / `undefined` と `stored` 以外は**ボタンごと出さない**
   * （保存に失敗した予約の詳細に「録音を聞く」が出ない — AC-REC-07）。
   */
  recording: RecordingSummary | null | undefined
  placement?: RecordingPlayerPlacement
  source?: PlaybackSource
  /** いまの時刻。チケットの寿命を測るためだけに使う。**実時刻を読まない。** */
  now?: () => Date
}

type Phase = 'idle' | 'opening' | 'ready' | 'expired' | 'error' | 'forbidden'

const FAILURE_MESSAGE: Partial<Record<Phase, string>> = {
  forbidden: '録音を聞く権限がありません。お店の管理者にご確認ください。',
  error: '録音を開けませんでした。もう一度お試しください。',
}

export function RecordingPlayer({
  recording,
  placement = 'pill',
  source = API_SOURCE,
  now = () => new Date(),
}: RecordingPlayerProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [ticket, setTicket] = useState<{ token: string; expiresAt: string } | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [length, setLength] = useState<number | null>(recording?.durationSeconds ?? null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const heldRef = useRef<(() => void) | null>(null)

  /** 面を離れるときに、その場かぎりの参照を手放す。 */
  useEffect(
    () => () => {
      heldRef.current?.()
      heldRef.current = null
    },
    [],
  )

  /** 本体が入った瞬間に鳴らす。端末が断ったら止まったままにして、受付の操作は止めない。 */
  useEffect(() => {
    if (url === null) return
    const el = audioRef.current
    if (el === null) return
    el.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    )
  }, [url])

  if (!hasPlayableRecording(recording)) return null
  // 型の絞り込みは下の関数の中まで届かないので、確かめたものをここで束ねておく。
  const playable = recording

  /**
   * チケットが切れたら、その場かぎりの参照も手放す。**900 秒はこの部品が音声を
   * 手元に置いてよい長さそのもの**で、切れたあとも持ち続けるなら短命にした意味が無い。
   * 押した瞬間の `now()` を読む（描いた時刻ではなく、押した時刻で測る）。
   */
  function ticketExpired(): boolean {
    return ticket !== null && Date.parse(ticket.expiresAt) <= now().getTime()
  }

  function drop() {
    heldRef.current?.()
    heldRef.current = null
    setUrl(null)
    setPlaying(false)
    setPosition(0)
  }

  async function openIt(recordingId: string) {
    setPhase('opening')
    try {
      const issued = await source.issue(recordingId)
      const media = await source.open(recordingId, issued.token)
      drop()
      heldRef.current = media.release
      setTicket({ token: issued.token, expiresAt: issued.expiresAt })
      setLength(issued.durationSeconds ?? playable.durationSeconds ?? null)
      setUrl(media.url)
      setPhase('ready')
    } catch (error) {
      setPhase(statusOf(error) === 403 ? 'forbidden' : 'error')
    }
  }

  async function act() {
    const el = audioRef.current
    if (phase === 'ready' && el !== null) {
      // チケットが切れたら、鳴らさずに 1 段目から取り直せる形へ戻す。
      if (ticketExpired()) {
        el.pause()
        drop()
        setPhase('expired')
        return
      }
      if (playing) {
        el.pause()
        setPlaying(false)
        return
      }
      await el.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      )
      return
    }
    await openIt(playable.id)
  }

  const base = placement === 'inline' ? '再生する' : '録音を聞く'
  const label =
    phase === 'opening'
      ? '開いています…'
      : phase === 'expired'
        ? 'もう一度開く'
        : phase === 'ready' && playing
          ? '一時停止'
          : base
  // 長さは「まだ開いていない」ボタンにだけ添える。受付履歴（inline）は右の
  // 「03:24 / 06:12」が同じことを言うので、ボタンには重ねない。
  const showLength =
    placement !== 'inline' && (phase === 'idle' || phase === 'error' || phase === 'forbidden')
  const timeLabel = `${recordingLength(position)} / ${recordingLength(length)}`
  const progress = length === null || length === 0 ? 0 : Math.min(100, (position / length) * 100)
  const failure = FAILURE_MESSAGE[phase]

  const button = (
    <button
      type="button"
      onClick={() => {
        // 開いている間の 2 度目の押下は届かせない。`disabled` にしないのは、立てた
        // 瞬間にフォーカスが body へ落ちて押した指の居場所が消えるからである
        // （`booking/ConfirmStep.tsx` と同じ作法）。
        if (phase === 'opening') return
        void act()
      }}
      aria-busy={phase === 'opening' ? true : undefined}
      aria-disabled={phase === 'opening' ? true : undefined}
      // 見える文字は全角空きで組むが、読み上げの名前は半角空き 1 つに固定する
      // （全角空きの正規化は読み上げソフトごとに違う）。
      aria-label={showLength ? `${label} ${recordingLength(length)}` : undefined}
      className={cn(
        'inline-flex min-h-11 flex-none items-center gap-2 font-semibold',
        'aria-disabled:bg-surface-2 aria-disabled:text-ink-muted',
        placement === 'pill'
          ? 'rounded-full border border-danger bg-danger-soft px-3 text-grid text-danger'
          : 'rounded-ctl border border-line-strong bg-surface px-4.5 text-body text-ink',
        focusRing,
      )}
    >
      {placement === 'pill' && (
        <span aria-hidden="true" className="size-2 shrink-0 rounded-circle bg-danger" />
      )}
      {label}
      {showLength && (
        <>
          {'　'}
          <span className="font-mono">{recordingLength(length)}</span>
        </>
      )}
    </button>
  )

  return (
    <div
      className={cn(
        placement === 'inline'
          ? 'flex max-w-130 flex-wrap items-center gap-4'
          : 'inline-flex flex-col gap-1',
      )}
    >
      {button}
      {placement === 'inline' && (
        <>
          {/* 進みは幅の百分率。色は付けない（`--color-pine` のトークンだけ）。 */}
          <span
            role="progressbar"
            aria-label="再生位置"
            aria-valuemin={0}
            aria-valuemax={length ?? 0}
            aria-valuenow={position}
            aria-valuetext={timeLabel}
            className="relative h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-surface-2"
          >
            <span
              aria-hidden="true"
              style={{ width: `${progress}%` }}
              className="absolute inset-y-0 left-0 rounded-full bg-pine"
            />
          </span>
          <span className="font-mono text-grid font-semibold text-ink-muted">{timeLabel}</span>
        </>
      )}
      {failure !== undefined && (
        <p role="alert" className="basis-full text-grid text-danger">
          {failure}
        </p>
      )}
      {url !== null && (
        // 保存の導線を作らないので `controls` を付けない。操作は上のボタン 1 つだけ。
        <audio
          ref={audioRef}
          src={url}
          className="hidden"
          onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
          onEnded={() => {
            setPlaying(false)
            // 聞き終えたところでチケットが切れていたら、手元の音声を残さない。
            if (ticketExpired()) {
              drop()
              setPhase('expired')
            }
          }}
        >
          <track kind="captions" />
        </audio>
      )}
    </div>
  )
}
