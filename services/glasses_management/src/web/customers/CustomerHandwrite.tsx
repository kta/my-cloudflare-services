import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { useState } from 'react'
import { acceptSheet, HANDWRITING_MAX_SHEETS, sanitizeSvg } from '../../worker/domain/customers'
import { Handwriting } from '../booking/Handwriting'

/*
 * 手書きメモ（承認済みモック docs/frontend/mockups/eyex/images/CUSTOMER-HANDWRITE.png）。
 *
 * 題材: 測定中に書いた紙のメモを、言い換えずにそのまま台帳へ置く面。
 * トークン計画: 左はサムネの柱（`--color-surface-2` の地）、右は白い用紙 1 枚。
 *   読み取った文字の欄は用紙の**下**に置き、2px の緑枠で「ここは直せる」と示す。
 * シグネチャ: 筆跡がいちばん大きく、読み取った文字がその下に従うこと（逆にしない）。
 *
 * 実測（screens/CUSTOMER-HANDWRITE.html の <style> と assets/eyex.css）:
 *   本文 2 列 260px / 1fr。左は padding 28px 20px。
 *   サムネは 1px の line-strong・角 8px・SVG の高さ 118px、下の帯は surface-2・padding 10px 12px
 *   （日付 14px/600 ＋ 店舗と記入者 13px）。サムネ間は margin-top 18px。選択中は 3px の緑枠。
 *   右は padding 28px 32px・gap 22px。見出しは日付＋用件 18px、店舗と記入者 13px、
 *   右端に札「1枚目 / 3枚」。用紙は 1px の line-strong・角 12px・44px 間隔の横罫。
 *   読み取り欄は 2px の緑枠・角 12px・padding 14px 16px・min-height 92px・16px・行間 1.6。
 * 14px / 15px / 18px はトークンに無いので `text-grid`(13) / `text-body`(16) / `text-lead`(17) に寄せる。
 *
 * **「大きく」「小さく」「赤ペンも見る」「紙を撮り直す」は出さない。**表示倍率も赤ペンの
 * 出し分けもカメラも、データモデルにも API にも無い（feature spec のスコープ外）ので、
 * 押して何も起きないボタンを画面に置かない。
 *
 * 筆跡を書く用紙そのものは P3 の `booking/Handwriting.tsx` をそのまま使う。
 * touch-action・手のひらの棄却・筆圧を使わないという `07-nfr.md` §2.9 の実装がそこにある。
 */

/** 台帳に置かれた手書きの 1 枚。筆跡は R2、この形は Worker が組んで渡す。 */
export type HandwrittenSheet = {
  id: string
  /** サーバが R2 から取り、許可リストで組み直した SVG。文字だけの 1 件は null。 */
  svg: string | null
  /** 読み取った文字（直せます）。 */
  body: string
  /** 「視力測定のご相談」。無ければ空。 */
  subject: string
  /** JST の暦日 `YYYY-MM-DD`。 */
  writtenOn: string
  storeName: string
  authorName: string
  revision: number
  /**
   * 注意ごとの状態。**数えるのは `published` だけ**で、申し込み（`requested`）は
   * `kind='attention'` / `status='draft'` のまま置かれ、承認の面（P10）が上げる。
   */
  attention: 'none' | 'requested' | 'published'
  /** 読み取りに自信のない語。本文の中の文字列そのまま。 */
  uncertain: readonly string[]
}

export type CustomerHandwriteProps = {
  sheets: readonly HandwrittenSheet[]
  /** いま書いている人。「佐藤 美咲」。 */
  writer: string
  /** 記入の時刻。端末の時計を読まない（引数で受ける）。 */
  now: string
  loading?: boolean
  error?: string | null
  onSaveSheet: (sheet: { svg: string; replacesId: string | null }) => void
  onSaveText: (input: { noteId: string; revision: number; body: string }) => void
  onRequestAttention: (input: { noteId: string; revision: number; body: string }) => void
  onBack: () => void
  onReload?: () => void
}

/**
 * 詳細の「注意ごと　N件」。**申し込んだだけでは増えない** —— 数えるのは
 * `published` の 1 件だけで、`requested` は承認待ちの下書きである。
 */
export function publishedAttentionCount(sheets: readonly HandwrittenSheet[]): number {
  return sheets.filter((sheet) => sheet.attention === 'published').length
}

/** 「2026年5月12日」。`lastVisitLabel` と同じ形だが、あちらは 0 件の「—」を持つ別用途。 */
function sheetDate(day: string): string {
  return `${Number(day.slice(0, 4))}年${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`
}

/** 用紙の横罫。44px ごと（モックの `background-size: 100% 44px`）。 */
const RULES = [0, 1, 2, 3, 4, 5, 6, 7]

type Mode = 'view' | 'compose' | 'replace'

export function CustomerHandwrite({
  sheets,
  writer,
  now,
  loading = false,
  error = null,
  onSaveSheet,
  onSaveText,
  onRequestAttention,
  onBack,
  onReload,
}: CustomerHandwriteProps) {
  const [mode, setMode] = useState<Mode>('view')
  const [drawn, setDrawn] = useState<string | null>(null)
  const [replacesId, setReplacesId] = useState<string | null>(null)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [requested, setRequested] = useState<readonly string[]>([])
  const [draft, setDraft] = useState('')
  const [draftFor, setDraftFor] = useState<string | null>(null)

  // 新しい順。日付が同じときは並びが揺れないように id で決める。
  const sorted = [...sheets].sort((a, b) =>
    a.writtenOn === b.writtenOn ? a.id.localeCompare(b.id) : b.writtenOn.localeCompare(a.writtenOn),
  )
  const selected = sorted.find((sheet) => sheet.id === chosenId) ?? sorted[0] ?? null
  if (selected !== null && draftFor !== selected.id) {
    setDraftFor(selected.id)
    setDraft(selected.body)
  }

  const attentionOf = (sheet: HandwrittenSheet): HandwrittenSheet['attention'] =>
    sheet.attention === 'none' && requested.includes(sheet.id) ? 'requested' : sheet.attention

  function keep(svg: string) {
    const decision = acceptSheet(
      sorted.map((sheet) => ({ id: sheet.id, createdAt: sheet.writtenOn })),
    )
    if (!decision.ok) {
      // 黙って古い 1 枚を消さない。書いた線は預かったまま、どれと置き換えるかを尋ねる。
      setDrawn(svg)
      setReplacesId(null)
      setMode('replace')
      return
    }
    onSaveSheet({ svg, replacesId: null })
    setMode('view')
  }

  return (
    <section className="flex h-full w-full min-h-0 flex-col bg-paper">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-line border-b bg-surface px-4">
        <h2 className="text-lead font-semibold text-ink">{`手書きメモ　${sheets.length}枚`}</h2>
        <button
          type="button"
          onClick={onBack}
          className={cn(
            'ml-auto min-h-11 rounded-card border border-line-strong bg-surface px-3.5 text-body font-semibold text-ink',
            focusRing,
          )}
        >
          ‹ お客様の詳細へ戻る
        </button>
        <button
          type="button"
          onClick={() => setMode('compose')}
          className={cn(
            'min-h-11 rounded-card border border-line-strong bg-surface px-3.5 text-body font-semibold text-ink',
            focusRing,
          )}
        >
          新しく書く
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-65 shrink-0 overflow-auto border-line border-r bg-surface-2 px-5 py-7">
          {loading ? (
            <div aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  data-testid="handwrite-skeleton"
                  className="mt-4.5 h-40 rounded-ctl bg-surface first:mt-0"
                />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <p className="text-grid text-ink-muted">まだ 1 枚もありません。</p>
          ) : (
            <div role="radiogroup" aria-label="手書きメモの一覧">
              {sorted.map((sheet) => (
                // biome-ignore lint/a11y/useSemanticElements: サムネイルは筆跡の絵と日付の帯を持つ面で、input 要素は子に持てない。
                <button
                  key={sheet.id}
                  type="button"
                  role="radio"
                  aria-checked={sheet.id === selected?.id}
                  onClick={() => {
                    setChosenId(sheet.id)
                    setMode('view')
                  }}
                  className={cn(
                    // 選択は「枠の太さ」で伝える（色だけに意味を持たせない）。
                    // いま何枚目を開いているかは、右の「N枚目 / M枚」が文字で言う。
                    'mt-4.5 block w-full overflow-hidden rounded-ctl bg-surface text-left first:mt-0',
                    sheet.id === selected?.id
                      ? 'border-3 border-pine'
                      : 'border border-line-strong',
                    focusRing,
                  )}
                >
                  <Ink svg={sheet.svg} className="h-29.5 w-full bg-surface" />
                  <span
                    className={cn(
                      'block border-line border-t px-3 py-2.5',
                      sheet.id === selected?.id ? 'bg-pine-soft' : 'bg-surface-2',
                    )}
                  >
                    <span className="block text-body font-semibold leading-tight text-ink">
                      {sheetDate(sheet.writtenOn)}
                    </span>
                    <span className="block text-grid text-ink-muted">
                      {`${sheet.storeName}　記入 ${sheet.authorName}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <section
          aria-label="選んだ手書きメモ"
          className="flex min-w-0 flex-1 flex-col gap-5.5 overflow-auto px-8 py-7"
        >
          {error !== null ? (
            <div
              role="alert"
              className="rounded-panel border border-danger bg-danger-soft px-7 py-5"
            >
              <p className="text-lead font-bold text-danger">手書きメモをお出しできませんでした</p>
              <p className="mt-1.5 text-body text-ink">{error}</p>
              <button
                type="button"
                onClick={onReload}
                className={cn(
                  'mt-4 min-h-12 rounded-card bg-pine px-6 text-body font-bold text-on-pine',
                  focusRingOnPine,
                )}
              >
                もう一度読み込む
              </button>
            </div>
          ) : mode === 'compose' ? (
            <Handwriting
              writer={writer}
              now={now}
              onSave={(note) => keep(note.svg)}
              onCancel={() => setMode('view')}
            />
          ) : mode === 'replace' ? (
            <div>
              <p className="text-lead font-bold text-ink">
                {`手書きメモは ${HANDWRITING_MAX_SHEETS}枚までです。どの 1 枚と置き換えますか。`}
              </p>
              <p className="mt-1.5 text-body text-ink-muted">
                いま書いた 1 枚はお預かりしています。選ぶまでは、どの 1 枚も消えません。
              </p>
              <div role="radiogroup" aria-label="置き換える 1 枚" className="mt-4">
                {sorted.map((sheet) => (
                  // biome-ignore lint/a11y/useSemanticElements: 同上（置き換える 1 枚も日付と記入者を並べた押せる面である）。
                  <button
                    key={sheet.id}
                    type="button"
                    role="radio"
                    aria-checked={sheet.id === replacesId}
                    onClick={() => setReplacesId(sheet.id)}
                    className={cn(
                      'mt-2.5 flex min-h-12 w-full items-center gap-3 rounded-ctl px-3.5 text-left first:mt-0',
                      sheet.id === replacesId
                        ? 'border-2 border-pine bg-pine-soft'
                        : 'border border-line-strong bg-surface',
                      focusRing,
                    )}
                  >
                    <span className="text-body font-semibold text-ink">
                      {sheetDate(sheet.writtenOn)}
                    </span>
                    <span className="text-grid text-ink-muted">
                      {`${sheet.storeName}　記入 ${sheet.authorName}`}
                    </span>
                    {sheet.id === replacesId && (
                      <span className="ml-auto text-grid font-semibold text-pine-deep">
                        この 1 枚を置き換えます
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="mt-6 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setMode('compose')}
                  className={cn(
                    'min-h-12 rounded-card border border-line-strong bg-surface px-4.5 text-body font-semibold text-ink',
                    focusRing,
                  )}
                >
                  やめて書き直す
                </button>
                <button
                  type="button"
                  disabled={replacesId === null || drawn === null}
                  aria-label={
                    replacesId === null
                      ? 'この 1 枚と置き換える　置き換える 1 枚を選ぶと押せます'
                      : undefined
                  }
                  onClick={() => {
                    if (replacesId === null || drawn === null) return
                    onSaveSheet({ svg: drawn, replacesId })
                    setDrawn(null)
                    setMode('view')
                  }}
                  className={cn(
                    'min-h-12 rounded-card border border-pine bg-pine px-6 text-body font-bold text-on-pine',
                    'disabled:border-line disabled:bg-surface-2 disabled:text-ink-faint',
                    focusRingOnPine,
                  )}
                >
                  この 1 枚と置き換える
                </button>
              </div>
            </div>
          ) : selected === null ? (
            <div
              role="status"
              className="rounded-panel border border-line-strong bg-surface px-7 py-6"
            >
              <p className="text-lead font-bold text-ink">手書きのメモはまだありません</p>
              <p className="mt-2 text-body text-ink-muted">
                「新しく書く」から、紙に書くのと同じように書き残せます。
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-3.5">
                <b className="text-lead font-bold text-ink">
                  {selected.subject === ''
                    ? sheetDate(selected.writtenOn)
                    : `${sheetDate(selected.writtenOn)}　${selected.subject}`}
                </b>
                <span className="text-grid text-ink-muted">
                  {`${selected.storeName}　記入 ${selected.authorName}`}
                </span>
                {attentionOf(selected) !== 'none' && (
                  <span className="inline-flex min-h-5.5 items-center rounded-ctl border border-pine-line bg-pine-soft px-2 text-note font-semibold text-pine-deep">
                    {attentionOf(selected) === 'published'
                      ? '注意ごとに登録済み'
                      : '注意ごとに申し込み済み'}
                  </span>
                )}
                <span className="ml-auto inline-flex min-h-5.5 items-center rounded-ctl border border-line-strong bg-surface px-2 text-note font-semibold text-ink-muted">
                  {`${sorted.indexOf(selected) + 1}枚目 / ${sorted.length}枚`}
                </span>
              </div>

              {selected.svg === null ? (
                <div className="rounded-card border border-line-strong bg-surface px-7 py-6">
                  <p className="text-body font-semibold text-ink">筆跡はありません</p>
                  <p className="mt-1.5 text-grid text-ink-muted">
                    下の「読み取った文字（直せます）」から、同じ内容を文字で残せます。
                  </p>
                </div>
              ) : (
                <div
                  role="img"
                  aria-label={`${sheetDate(selected.writtenOn)}の手書きメモ　${
                    selected.body === '' ? '読み取った文字はまだありません' : selected.body
                  }`}
                  className="relative min-h-0 flex-1 overflow-hidden rounded-card border border-line-strong bg-surface text-ink"
                >
                  <span aria-hidden="true" className="absolute inset-0 flex flex-col">
                    {RULES.map((index) => (
                      <span key={index} className="h-11 shrink-0 border-line border-b" />
                    ))}
                  </span>
                  <Ink svg={selected.svg} className="relative h-full w-full" />
                </div>
              )}

              <div>
                <label
                  htmlFor="handwrite-body"
                  className="mb-1.5 block text-grid font-semibold text-ink-muted"
                >
                  読み取った文字（直せます）
                </label>
                <textarea
                  id="handwrite-body"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className={cn(
                    'min-h-23 w-full rounded-card border-2 border-pine bg-surface px-4 py-3.5 text-body leading-relaxed text-ink',
                    focusRing,
                  )}
                />
                {selected.uncertain.length > 0 && (
                  <p className="mt-2 text-grid text-ink-muted">
                    {`点線の ${selected.uncertain.length}か所は読み取りに自信がありません。`}
                    {selected.uncertain.map((word) => (
                      <span
                        key={word}
                        data-testid="uncertain"
                        className="ml-2 text-ink underline decoration-danger decoration-dotted underline-offset-4"
                      >
                        {word}
                      </span>
                    ))}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                {attentionOf(selected) === 'none' && (
                  <button
                    type="button"
                    onClick={() => {
                      setRequested((kept) => [...kept, selected.id])
                      onRequestAttention({
                        noteId: selected.id,
                        revision: selected.revision,
                        body: draft,
                      })
                    }}
                    className={cn(
                      'min-h-14 rounded-card border border-pine bg-pine px-6 text-lead font-bold text-on-pine',
                      focusRingOnPine,
                    )}
                  >
                    注意ごととして登録を申し込む
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    onSaveText({
                      noteId: selected.id,
                      revision: selected.revision,
                      body: draft,
                    })
                  }
                  className={cn(
                    'min-h-14 rounded-card border border-line-strong bg-surface px-6 text-body font-semibold text-ink',
                    focusRing,
                  )}
                >
                  文字を保存する
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  )
}

/**
 * 他店のスタッフが書いた 1 枚を描く。サーバが再直列化したものを**もう一度**
 * 許可リストに通してから置く（守りを 2 枚重ねる）。読み上げは器の `role="img"` が
 * 引き受けるので、筆跡そのものは読み上げから外す。
 */
function Ink({ svg, className }: { svg: string | null; className: string }) {
  if (svg === null) return <span aria-hidden="true" className={className} />
  return (
    <span
      aria-hidden="true"
      className={cn('block', className)}
      dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }}
    />
  )
}
