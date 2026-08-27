import { cn } from '@app/ui'
import type { ReactNode } from 'react'

/*
 * 電話・店頭の予約入力に固有の語彙。承認済みモック `approved.html` の実測。
 *
 *   .script h2{font-size:29px;margin:6px 0}
 *   .options{grid-template-columns:repeat(3,1fr);gap:12px;margin-top:24px}
 *   .options button,.candidate,.field{min-height:64px;border:1px solid var(--l);
 *       border-radius:9px;background:#fff;padding:14px;text-align:left}
 *   .options .selected,.candidate.selected{border:3px solid var(--g);
 *       background:var(--brand-soft)}
 *   .summary{border:1px solid var(--l);background:#fff;padding:18px;
 *       border-radius:9px;margin-bottom:14px}
 *   .readout{font-size:25px;line-height:1.8;background:#fff;
 *       border:1px solid var(--l);border-radius:12px;padding:28px}
 *   .progress{height:88px;background:#fff;border-top:1px solid var(--l);
 *       grid-template-columns:100px 1fr 120px;align-items:center;padding:0 26px}
 *   .steps{grid-template-columns:repeat(5,1fr);gap:8px}
 *   .step{min-height:44px;border-bottom:3px solid var(--l);text-align:center;
 *       padding:10px;font-size:13px}
 *   .step.done{border-color:var(--g);font-weight:700}
 *   .step.current{border-color:var(--accent);font-weight:700}
 *   .record{font:700 16px ui-monospace;color:var(--danger);text-align:right}
 *
 * 選択枠は 3px。2px にすると「選ばれている」ことが読み取れなくなる。
 */

/** 工程ラベルと、そのまま読み上げる問いかけ。 */
export function Script({
  step,
  question,
  children,
}: {
  /** モックの `2 / 5　時間`。全角スペースまで含めて渡す。 */
  step: string
  question: string
  children?: ReactNode
}) {
  return (
    <div className="font-sans">
      {/* 工程ラベルはモックでは素の `<small>`。色も寸法も本文から継ぐ。 */}
      <small>{step}</small>
      <h1 className="my-1.5 font-bold text-script">{question}</h1>
      {children}
    </div>
  )
}

/** 選択肢の並び。3 列固定で、狭い画面だけ 1 列へ落ちる。 */
export function OptionGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    /* 選択肢の集まりは fieldset。読み上げが「ここから何を選ぶのか」を先に言える。 */
    <fieldset aria-label={label} className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
      {children}
    </fieldset>
  )
}

/** 選択肢ひとつ。選択中は 3px の緑枠と淡い緑地になる。 */
export function Option({
  children,
  selected = false,
  onClick,
  className,
}: {
  children: ReactNode
  selected?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'min-h-16 rounded-card p-3.5 text-left font-sans text-body text-ink',
        selected ? 'border-3 border-pine bg-pine-soft' : 'border border-line bg-surface',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** 顧客候補の行。左に名乗り、右に状態を置く。 */
export function Candidate({
  children,
  state,
  selected = false,
  onClick,
}: {
  children: ReactNode
  /** モックの `選択中` / `候補`。 */
  state?: string
  selected?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        // 状態語は行の中央ではなく 1 行目の高さに揃う（モックは align-items を
        // 指定していない）。名乗りが 2 行になっても目線が動かない。
        'mt-2 flex min-h-16 w-full justify-between rounded-card p-3.5 text-left font-sans text-body text-ink',
        selected ? 'border-3 border-pine bg-pine-soft' : 'border border-line bg-surface',
      )}
    >
      <span>{children}</span>
      {state !== undefined && <b>{state}</b>}
    </button>
  )
}

/**
 * レールの要約カード（`.summary`）。カードより内側が広い。
 *
 * `label` を渡すと region として名乗る。モックは静止画なので名前を持たないが、
 * 実アプリのレールは中身が工程ごとに入れ替わるので、読み上げが「今どの要約を
 * 読んでいるか」を言えなければならない。名前は画素を持たない。
 */
export function RailSummary({
  children,
  label,
  live = false,
}: {
  children: ReactNode
  label?: string
  /*
   * 中身が操作ではなく「今どうなっているか」で入れ替わる要約に渡す（録音の面）。
   * 読み上げが状態の変化に追随できないと、画面を見ていないスタッフが録音の
   * 開始・失敗を取り逃す。役割は画素を持たないので、モックの絵は動かない。
   */
  live?: boolean
}) {
  const classes = 'mb-3.5 rounded-card border border-line bg-surface p-4.5 font-sans'
  if (label === undefined) return <div className={classes}>{children}</div>
  return (
    <section aria-label={label} role={live ? 'status' : undefined} className={classes}>
      {children}
    </section>
  )
}

/** 顧客の「対応時に確認」。淡い赤地で、他の要約と見分けがつく。 */
export function AttentionCard({ children, label }: { children: ReactNode; label?: string }) {
  const classes = 'rounded-ctl border border-attention-line bg-danger-panel p-3.5 font-sans'
  if (label === undefined) return <div className={classes}>{children}</div>
  return (
    <section aria-label={label} className={classes}>
      {children}
    </section>
  )
}

/** 復唱文。読み上げるための大きさと行間を持つ。 */
export function Readout({ children }: { children: ReactNode }) {
  return (
    // 段落の既定の上下余白は持たない。復唱文は見出しの直後に置かれる 1 枚の面で、
    // 行間（1.8）は `text-readout` が寸法と一緒に運ぶ。
    <p className="my-0 rounded-panel border border-line bg-surface p-7 font-sans text-readout">
      {children}
    </p>
  )
}

export type FlowStep = { label: string; state: 'todo' | 'done' | 'current' }

/**
 * 下端の進捗バー。左に戻る、中央に 5 工程、右に録音状態。
 * 高さ 88px は固定で、主列の下余白 112px はこの帯に隠れないための余白。
 */
const STEP_STATE_WORD: Record<FlowStep['state'], string> = {
  todo: '未完了',
  done: '完了',
  current: '現在',
}

export function ProgressFooter({
  steps,
  back,
  record,
  announceState = false,
}: {
  steps: FlowStep[]
  back?: ReactNode
  record?: ReactNode
  /**
   * 工程の状態を読み上げ用の語でも添える（AC-EYEX-02: 色だけに頼らない）。
   * 突き合わせ台は静止画なので既定では添えない。実アプリだけが渡す。
   */
  announceState?: boolean
}) {
  return (
    <footer
      className="grid shrink-0 items-center border-line border-t bg-surface px-6.5"
      style={{ height: '88px', gridTemplateColumns: '100px 1fr 120px' }}
    >
      <div>{back}</div>
      <ol className="grid grid-cols-5 gap-2" aria-label="予約入力の工程">
        {steps.map((step) => (
          <li
            key={step.label}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className={cn(
              'min-h-11 border-b-3 p-2.5 text-center font-sans text-note',
              step.state === 'todo' && 'border-line',
              step.state === 'done' && 'border-pine font-bold',
              step.state === 'current' && 'border-accent font-bold',
            )}
          >
            {step.label}
            {announceState && <span className="sr-only">（{STEP_STATE_WORD[step.state]}）</span>}
          </li>
        ))}
      </ol>
      <div>{record}</div>
    </footer>
  )
}

/*
 * 録音状態（`.record{font:700 16px ui-monospace}`）。数字だけを等幅で、状態語は
 * 読み上げに残す。書体はモックが書いたとおりの `--font-timer`（予備を持たない系統の等幅）で、
 * IBM Plex Mono には寄せない。桁幅と ● の大きさが変わってしまうため。
 */
export function RecordIndicator({
  elapsed,
  label,
  name = 'iPad録音',
}: {
  elapsed?: string
  label: string
  /*
   * 読み上げ上の名前。録音の説明・回復・保存失敗を脇の列が受け持つ面では、
   * そちらが `iPad録音` を名乗る。同じ名前を 2 つ置くと、どちらを読んでいるのか
   * 分からなくなる。
   */
  name?: string
}) {
  return (
    <p
      role="status"
      aria-label={name}
      data-testid="recording-state"
      className="text-right font-bold font-timer text-body text-record"
    >
      <span aria-hidden="true">● </span>
      <span className="sr-only">{label}</span>
      <span aria-hidden={elapsed === undefined ? true : undefined}>{elapsed ?? label}</span>
    </p>
  )
}

/*
 * 予約フローの中で使う操作（モックの `.btn`）。
 *
 *   .btn{min-width:44px;min-height:44px;border:1px solid #ffffff70;
 *        border-radius:8px;background:transparent;color:inherit;
 *        padding:0 16px;font:inherit;font-weight:700}
 *
 * 罫線が半透明の白なのは、緑バーの上でも白い進捗バーの上でも同じ 1 本で済ませる
 * ため。白地では溶けて消え、緑地では輪郭として残る。列（100px / レール幅）が
 * 操作の幅を決めるので、自分では幅を持たずに与えられた幅いっぱいに広がる。
 */
export function FlowButton({
  children,
  primary = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode
  /** モック `#repeat` の確定操作。緑地に白文字になる。 */
  primary?: boolean
  /**
   * 押せない状態。`Action` と同じ理由でネイティブの `disabled` は使わない
   * （タブ順から外れると、押せないことにも理由にも辿り着けなくなる）。
   * 淡さでも示さない — モックは無効な操作も同じ濃さで描く。
   */
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={cn(
        'block min-h-11 w-full min-w-11 rounded-ctl border px-4 py-0 text-center font-bold font-sans text-body',
        /*
         * モックの `.btn` は枠が `#ffffff70` で、地色に半分溶ける。白い面の上
         * （進捗バーの「戻る」）では枠ごと消え、緑地の上（確定操作）でだけ
         * 細い枠として見える。同じ 1 つの見た目なので、地で分ける。
         */
        primary
          ? 'border-pine-hairline bg-pine text-on-pine'
          : 'border-transparent bg-transparent text-ink',
      )}
    >
      {children}
    </button>
  )
}

/**
 * レールに並ぶ代替候補（モックの `.field`）。
 *
 * 選択肢の格子と違って、幅は中身が決める。文字数の違う候補が並んだときに
 * 空白の広いボタンを作らないための形で、レール幅に入るだけ横へ並び、
 * 入らなくなったところで折り返す。
 */
export function FieldButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-block min-h-16 rounded-card border border-line bg-surface p-3.5 text-left font-sans text-body text-ink"
    >
      {children}
    </button>
  )
}
