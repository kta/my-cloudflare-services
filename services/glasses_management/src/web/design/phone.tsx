import { cn } from '@app/ui'
import type { ReactNode } from 'react'

/*
 * 顧客向け Web 予約（スマートフォン）の語彙。
 * 承認済みモック `web-booking-complete-approved.html` の実測。
 *
 *   .phone{height:760px}（外枠 8px を除いた中身は 359×744）
 *   .head{background:var(--g);color:#fff;padding:20px}.head b{font-size:19px}
 *   .progress{display:flex;gap:5px;margin-top:12px}
 *   .progress i{height:4px;flex:1;background:#ffffff55}.progress i.on{background:#fff}
 *   .body{padding:20px}.body h2{font-size:24px}
 *   .search,input{width:100%;min-height:50px;border:1px solid var(--l);
 *                 border-radius:9px;padding:12px}
 *   .card,.option{border:1px solid var(--l);border-radius:9px;padding:14px;
 *                 margin-top:10px;background:#fff}
 *   .option.selected{border:3px solid var(--g);background:var(--gs)}
 *   .primary{width:calc(100% - 40px);position:absolute;left:20px;bottom:20px;
 *            background:var(--g);color:#fff;border:0;font-weight:700;min-height:48px}
 *   .summary{background:#f0f5f2;padding:14px;border-radius:9px}
 *   .complete{text-align:center;padding-top:80px}
 *   .complete strong{font-size:54px;color:var(--g)}
 *   .error{background:#fff3e8;border-color:#c49550}
 *
 * 主操作は必ず下端に貼り付く。本文の直後に置くと、画面下半分が空いたまま
 * 押しに行く手が上がることになり、モックの持ち方と変わってしまう。
 */

/** 端末いっぱいの枠。主操作を下端に置けるよう、ここが位置の基準になる。 */
export function PhoneScreen({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-surface font-sans text-body text-ink">
      {children}
    </div>
  )
}

/** 上端の緑帯。工程がある面だけ、下に 5 本の進捗を敷く。 */
export function PhoneHead({
  store,
  progress,
}: {
  store: string
  /** 何工程目か（1 起算）。工程を持たない面では省く。 */
  progress?: { current: number; total: number }
}) {
  return (
    <header className="shrink-0 bg-pine p-5 text-on-pine">
      <b className="font-bold text-bar">EYEX予約</b>
      {/* モックは `<b>EYEX予約</b><small>銀座店</small>` で、改行せず同じ行に並ぶ。 */}
      <small>{store}</small>
      {progress && (
        <div className="mt-3 flex gap-1.25" aria-hidden="true">
          {Array.from({ length: progress.total }, (_, index) => (
            <i
              // 進捗の目盛りは位置そのものが意味なので添字で並べる。
              key={index}
              className={cn('h-1 flex-1', index < progress.current ? 'bg-on-pine' : 'bg-pine-tick')}
            />
          ))}
        </div>
      )}
    </header>
  )
}

/** 本文。主操作の高さぶんの余白を最初から空けておく。 */
export function PhoneBody({
  children,
  centered = false,
}: {
  children: ReactNode
  /** 完了・確認のように中央に据える面。 */
  centered?: boolean
}) {
  return (
    <main className={cn('min-h-0 flex-1 overflow-auto p-5 pb-22', centered && 'pt-20 text-center')}>
      {children}
    </main>
  )
}

/** 下端に貼り付く主操作。 */
export function PhonePrimary({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <div className="absolute right-5 bottom-5 left-5">
      <button
        type="button"
        onClick={onClick}
        className="min-h-12 w-full rounded-card bg-pine px-3.5 py-0 font-bold font-sans text-body text-on-pine"
      >
        {children}
      </button>
    </div>
  )
}

/** 選択肢（`.option`）。選択中は 3px の緑枠。 */
export function PhoneOption({
  children,
  selected = false,
  onClick,
}: {
  children: ReactNode
  selected?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        // block にしないと（button の既定は inline-block）上の見出しと margin が
        // 相殺されず、モックより 10px 下がる。
        'mt-2.5 block w-full rounded-card p-3.5 text-left font-sans text-body text-ink',
        selected ? 'border-3 border-pine bg-pine-soft' : 'border border-line bg-surface',
      )}
    >
      {children}
    </button>
  )
}

/** 要約帯（`.summary`）。白ではなく淡い緑地で、本文と分節する。 */
export function PhoneSummary({ children }: { children: ReactNode }) {
  return <div className="rounded-card bg-summary p-3.5">{children}</div>
}

/** カード（`.card`）。`error` は淡い橙で、通信の失敗を伝える。 */
export function PhoneCard({
  children,
  tone = 'plain',
}: {
  children: ReactNode
  tone?: 'plain' | 'error'
}) {
  return (
    <div
      className={cn(
        'mt-2.5 rounded-card border p-3.5',
        tone === 'error' ? 'border-alert-line bg-alert-soft' : 'border-line bg-surface',
      )}
    >
      {children}
    </div>
  )
}

/**
 * 入力欄。
 *
 * モックは `<label>お名前<input></label>` で、label は inline のまま。
 * 幅 100% の input が行を占めるので結果として縦積みになるが、間隔は margin
 * ではなく行ボックスの取り分で決まる。block + margin に置き換えると、
 * その分だけ縦位置がずれていく。
 */
export function PhoneField({
  label,
  value,
  inputMode,
  onChange,
}: {
  label: string
  value: string
  inputMode?: 'tel' | 'email' | 'numeric'
  onChange?: (next: string) => void
}) {
  return (
    <label>
      {label}
      <input
        value={value}
        inputMode={inputMode}
        onChange={(event) => onChange?.(event.target.value)}
        className={FIELD}
      />
    </label>
  )
}

/** `.search,input` の実測。ラベル付き・ラベル無しの両方から使う。 */
const FIELD =
  'min-h-12.5 w-full rounded-card border border-line bg-surface p-3 font-sans text-body text-ink'

/**
 * 入力欄そのもの（`.search,input` と同じ寸法）。`<label>` で包まない面で使う。
 *
 * 名前は必須にする。包む `<label>` が無いので、渡さなければ「何を入れる欄か」を
 * 持たない無名の入力として読み上げられる（本人確認コードがそうだった）。
 * `aria-label` は視覚に出ないので、モックの画素は変わらない。
 */
export function PhoneInput({
  value,
  label,
  inputMode,
  onChange,
}: {
  value: string
  label: string
  inputMode?: 'tel' | 'email' | 'numeric'
  onChange?: (next: string) => void
}) {
  return (
    <input
      aria-label={label}
      value={value}
      inputMode={inputMode}
      onChange={(event) => onChange?.(event.target.value)}
      className={FIELD}
    />
  )
}

/**
 * 検索の入口（`.search`）。モックでは入力欄と同じ見た目の div で、
 * まだ何も打てない「押すと検索が始まる」段を表している。
 *
 * `<input>` に替えるとブラウザ既定の見た目が出てモックとずれるので、
 * 板のまま `role` と名前だけを与えて、読み上げ上は検索欄として振る舞わせる。
 */
export function PhoneSearch({ children, label }: { children: ReactNode; label: string }) {
  return (
    /*
     * `<input type="search">` にすると、ブラウザ既定の見た目が出てモックと
     * ずれる。板のまま、役割と名前だけを足す。
     */
    // biome-ignore lint/a11y/useSemanticElements: 上記のとおり要素は替えられない。
    <div role="searchbox" tabIndex={0} aria-label={label} className={FIELD}>
      {children}
    </div>
  )
}

/**
 * 副操作（モック素の `button`）。下端に貼り付く主操作と違い、文字幅ぶんだけの
 * 幅で本文の流れの中に置かれる。
 */
export function PhoneButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-12 rounded-card border border-line bg-surface px-3.5 py-0 font-sans text-body text-ink"
    >
      {children}
    </button>
  )
}

/*
 * ここから下は「設定ガイドのスマートフォン版」の語彙。
 * 承認済みモック `settings-responsive-approved.html` の実測で、上の顧客向け
 * Web 予約とは別の寸法体系・別の緑を持つ。
 *
 *   .phone{width:375px;height:790px;background:#fff}
 *   .status{height:25px;padding:6px 16px;justify-content:space-between;
 *           font:600 9px 'IBM Plex Mono'}
 *   .head{height:68px;background:var(--g);color:#fff;padding:11px 16px}
 *   .head b{font-size:17px}.head small{display:block}
 *   .progress{height:82px;padding:8px 11px;background:#f4f6f4;
 *             border-bottom:1px solid var(--l)}
 *   .progresshead{justify-content:space-between;font-size:9px;margin-bottom:7px}
 *   .rail{grid-template-columns:repeat(6,1fr);position:relative}
 *   .rail:before{position:absolute;top:12px;left:8.33%;right:8.33%;height:2px;
 *                background:#c7d1cc}
 *   .step{text-align:center;font-size:7px;color:var(--m)}
 *   .circle{width:25px;height:25px;margin:0 auto 4px;border:2px solid #aab9b1;
 *           border-radius:50%;background:#f4f6f4;place-items:center;
 *           font:600 9px 'IBM Plex Mono'}
 *   .done .circle{background:var(--gs);border-color:var(--g);color:var(--g)}
 *   .on{color:var(--g);font-weight:700}
 *   .on .circle{background:var(--g);border-color:var(--g);color:#fff;
 *               box-shadow:0 0 0 3px #cfe4da}
 *   .body{padding:16px}.body h2{font-size:20px}
 *   .field{border:1px solid var(--l);border-radius:9px;padding:12px;
 *          margin-top:9px;font-size:10px}
 *   .field.changed{border:2px solid var(--g);background:#f2f8f4}
 *   .row{justify-content:space-between;…（.field と同じ寸法）}
 *   .bottom{position:absolute;left:0;right:0;bottom:0;padding:10px 15px 17px;
 *           border-top:1px solid var(--l)}
 *   .next{width:100%;height:48px;border:0;border-radius:9px;background:var(--g);
 *         color:#fff;font-weight:700}
 *
 * 6 工程を丸と線で常時出す。iPad 版のように縦のレールを畳んで「今の工程」だけ
 * にすると、狭い画面では残りが何工程あるか分からなくなる。
 */

/** 端末のステータスバー。モックが端末の絵として描いている段。 */
export function PhoneStatusBar({ time, right }: { time: string; right: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 justify-between px-4 py-1.5 font-semibold font-sp-mono text-sp-fine"
      /*
       * 中身（13.5px + 上下 12px）は 25px を僅かに超える。縦並びの flex の中では
       * min-height:auto がその溢れを高さに繰り込んでしまい、以降が 1px 下がる。
       * モックは素の block で 25px に切っているので、min-height も固定する。
       */
      style={{ height: '25px', minHeight: '25px' }}
    >
      <span>{time}</span>
      <span>{right}</span>
    </div>
  )
}

/** 設定ガイド SP の緑帯。iPad 版の 76px より低く、操作を持たない。 */
export function GuidePhoneHead({ subtitle }: { subtitle: string }) {
  return (
    <header className="shrink-0 bg-sp-pine px-4 py-2.75 text-on-pine" style={{ height: '68px' }}>
      <b className="font-bold text-sp-head">EYEX予約</b>
      <small className="block">{subtitle}</small>
    </header>
  )
}

/** 工程 1 つぶんの丸と名前。 */
export type GuidePhoneStep = { label: string; state: 'todo' | 'done' | 'current' }

/** 6 工程の帯。何工程目かと残りを、丸の列の上に文章でも置く。 */
export function GuidePhoneProgress({
  heading,
  remaining,
  steps,
}: {
  /** モックの `5 / 6　Web予約の公開`。全角スペースまで含めて渡す。 */
  heading: string
  remaining: string
  steps: GuidePhoneStep[]
}) {
  return (
    <nav
      aria-label="設定の工程"
      className="shrink-0 border-sp-line border-b bg-sp-rail px-2.75 py-2"
      style={{ height: '82px' }}
    >
      <div className="mb-1.75 flex justify-between text-sp-fine">
        <b className="font-bold text-sp-pine">{heading}</b>
        <span>{remaining}</span>
      </div>
      <div className="relative grid grid-cols-6">
        {/* 工程をつなぐ線。両端の丸の中心までで止める（8.33% = 1/12 列）。 */}
        <div
          aria-hidden="true"
          className="absolute bg-sp-rail-line"
          style={{ top: '12px', left: '8.33%', right: '8.33%', height: '2px' }}
        />
        {steps.map((step, offset) => (
          <div
            key={step.label}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className={cn(
              'relative z-1 text-center text-sp-step',
              step.state === 'current' ? 'font-bold text-sp-pine' : 'text-sp-ink-muted',
            )}
          >
            <div
              className={cn(
                'mx-auto mb-1 grid place-items-center rounded-circle border-2 font-semibold font-sp-mono text-sp-fine',
                step.state === 'todo' && 'border-sp-circle-line bg-sp-rail',
                step.state === 'done' && 'border-sp-pine bg-sp-pine-soft text-sp-pine',
                step.state === 'current' &&
                  'border-sp-pine bg-sp-pine text-on-pine ring-3 ring-sp-ring',
              )}
              style={{ width: '25px', height: '25px' }}
            >
              {step.state === 'done' ? '✓' : offset + 1}
            </div>
            {step.label}
          </div>
        ))}
      </div>
    </nav>
  )
}

/** 本文。下端の主操作は絶対配置なので、ここは高さを譲らない。 */
export function GuidePhoneBody({ children }: { children: ReactNode }) {
  return <main className="min-h-0 flex-1 overflow-auto p-4">{children}</main>
}

/** 読み取り欄。`changed` はこの工程で実際に変えた欄で、緑の 2px 罫で立つ。 */
export function GuidePhoneField({
  title,
  children,
  changed = false,
}: {
  title: string
  children: ReactNode
  changed?: boolean
}) {
  return (
    <div
      className={cn(
        'mt-2.25 rounded-card text-sp-body',
        changed ? 'border-2 border-sp-pine bg-sp-changed' : 'border border-sp-line',
      )}
      // 罫が 2px になっても内側は 12px のまま（モックが padding を変えていない）。
      style={{ padding: '12px' }}
    >
      <b className="font-bold">{title}</b>
      <br />
      {children}
    </div>
  )
}

/** 左に中身・右に状態を置く行。欄と同じ寸法で、公開/非公開だけが右へ寄る。 */
export function GuidePhoneRow({ children, state }: { children: ReactNode; state: string }) {
  return (
    <div className="mt-2.25 flex justify-between rounded-card border border-sp-line p-3 text-sp-body">
      <span>{children}</span>
      <span>{state}</span>
    </div>
  )
}

/** 下端に貼り付く主操作。工程を 1 つ進める操作はここにしか無い。 */
export function GuidePhoneBottom({
  children,
  onClick,
}: {
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <footer className="absolute right-0 bottom-0 left-0 border-sp-line border-t px-3.75 pt-2.5 pb-4.25">
      <button
        type="button"
        onClick={onClick}
        className="h-12 w-full rounded-card border-0 bg-sp-pine px-0 py-0 font-bold font-sans text-body text-on-pine"
      >
        {children}
      </button>
    </footer>
  )
}
