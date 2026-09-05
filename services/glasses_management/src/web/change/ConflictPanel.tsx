import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { useState } from 'react'
import { jstClock } from '../ledger/metrics'

/*
 * 同じご予約を 2 台が直した（承認済みモック docs/frontend/mockups/eye/images/EX-CONFLICT.png）。
 *
 * この面の仕事は「選ぶまで、どちらの内容も書き換わりません」を**形で**示すこと。
 * だからこの面は書き込みを持たない。4 つの出口はどれも親へ選択を報せるだけで、
 * 送る前の空き枠の当て直しと `PATCH` は親（変更の面）の仕事である（AC-CHANGE-20 / 23）。
 *
 * 実測（screens/EX-CONFLICT.html の <style> と assets/eye.css）:
 *   .wrap = padding 32px 36px 28px
 *   .lead = --alert-tint のカード・左に 6px の --alert。h2 22px（--alert）＋ 本文 16px/1.6（上に 10px）
 *   .two  = 2 列・gap 24px（上に 28px）。.side = 1px --line-strong・角 12px、自分の面だけ 2px --brand
 *   .sh   = padding 14px 18px（自分の面は --brand-tint 地）。h3 16px ＋ 13px の出どころ
 *   .cr   = 116px 1fr・gap 12px・padding 15px 0。k 13px / v 16px/600/1.45
 *           .was は 13px の取り消し線（上に 3px）、変わらない行は 400 の --ink-2
 *   .sf   = padding 16px 18px・上に 1px の罫。ボタンは幅いっぱい（.btn は 48px）
 *   .foot = 上に 24px・右寄せ
 *
 * 行の描き分けは**旧値がある行＝変わった行**の 1 つの規則にした。モックは相手側の「担当」を
 * 旧値なしで太字にしていて規則が二重になっており、そのままでは「何が変わったのか」を
 * 太さだけで読み取れない（色だけ・太さだけで状態を伝えないという決めに寄せる）。
 *
 * サイドバーの選択は**ルートで決める**ので、この面では触らない（モックは「予約台帳」に
 * なっているが `design/05-screen-flow.md` §8 の既知差分 #8）。
 */

/** 読み込み中 / 見つからない（空）/ エラー / 権限なし。 */
type ConflictPhase = 'loading' | 'ready' | 'notFound' | 'error' | 'forbidden'

const PHASE_MESSAGE: Record<Exclude<ConflictPhase, 'ready'>, string> = {
  loading: 'ご予約を読み込んでいます…',
  notFound: 'このご予約は見つかりませんでした。もう一度お探しください。',
  error: 'ほかの端末の内容を読み込めませんでした。画面を開き直してください。',
  forbidden: 'ご予約を変更する権限がありません。お店の管理者にご確認ください。',
}

/** どちらの内容か。1 項目ずつ選ぶときの行の答えでもある。 */
type ConflictSide = 'theirs' | 'mine'

/** 片側の 1 項目。`previous` があれば「変わった項目」で、旧値に取り消し線を引く。 */
type ConflictValue = { value: string; previous: string | null }

export type ConflictFieldRow = {
  key: string
  term: string
  theirs: ConflictValue
  mine: ConflictValue
}

export type ConflictChoice =
  | { kind: 'theirs' }
  | { kind: 'mine' }
  | { kind: 'perField'; picks: Record<string, ConflictSide> }

type ConflictPanelProps = {
  /**
   * 先に保存した側。`terminalName` は分かるときだけ入れる —— 端末の登録簿が無い
   * 経路（409 の応答は保存した人の名前しか載せない）では空にして、無い名前を
   * でっち上げない。空のときは「中村 彩 が 11:06 に保存しました。」と読ませる。
   */
  theirs: { actorName: string; terminalName: string; savedAt: string }
  mine: { terminalName: string }
  rows: readonly ConflictFieldRow[]
  /** 選んだ結果を親へ渡すだけ。**この面は保存しない。** */
  onResolve: (choice: ConflictChoice) => void
  onAbort: () => void
  phase?: ConflictPhase
}

function Rows({
  rows,
  side,
  radioLabelSuffix,
  picks,
  onPick,
}: {
  rows: readonly ConflictFieldRow[]
  side: ConflictSide
  /** 「中村 彩 の内容」／「あなたの内容」。1 項目ずつ選ぶときのラジオの名前になる。 */
  radioLabelSuffix: string
  picks: Record<string, ConflictSide> | null
  onPick: (key: string, side: ConflictSide) => void
}) {
  return (
    <div className="flex-1 px-4.5">
      {rows.map((row) => {
        const cell = side === 'theirs' ? row.theirs : row.mine
        const changed = cell.previous !== null
        return (
          <div
            key={row.key}
            className="grid items-baseline gap-3 border-line border-t py-3.75 first:border-t-0"
            style={{ gridTemplateColumns: 'calc(var(--spacing) * 29) 1fr' }}
          >
            <span className="text-grid text-ink-muted">{row.term}</span>
            <span>
              <span
                className={cn(
                  'block text-body leading-snug',
                  changed ? 'font-semibold text-ink' : 'text-ink-muted',
                )}
              >
                {cell.value}
              </span>
              {cell.previous !== null && (
                <span className="mt-0.75 block text-grid text-ink-muted line-through">
                  {cell.previous}
                </span>
              )}
              {picks !== null && (
                <label
                  className={cn(
                    'mt-2 flex min-h-11 cursor-pointer items-center gap-2 rounded-ctl px-2 text-grid',
                    picks[row.key] === side
                      ? 'border-2 border-pine bg-pine-soft text-pine-deep'
                      : 'border border-line-strong text-ink',
                    'focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus',
                  )}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={row.key}
                    aria-label={`${row.term}は ${radioLabelSuffix}`}
                    checked={picks[row.key] === side}
                    onChange={() => onPick(row.key, side)}
                  />
                  <span>
                    {picks[row.key] === side ? 'この内容にする（選択中）' : 'この内容にする'}
                  </span>
                </label>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function ConflictPanel({
  theirs,
  mine,
  rows,
  onResolve,
  onAbort,
  phase = 'ready',
}: ConflictPanelProps) {
  const [picks, setPicks] = useState<Record<string, ConflictSide> | null>(null)

  if (phase !== 'ready') {
    return (
      <p
        role={phase === 'loading' ? 'status' : 'alert'}
        className="px-9 py-8 text-body text-ink-muted"
      >
        {PHASE_MESSAGE[phase]}
      </p>
    )
  }

  const chosenCount = picks === null ? 0 : rows.filter((row) => picks[row.key] !== undefined).length
  const remaining = rows.length - chosenCount

  function pick(key: string, side: ConflictSide) {
    setPicks((current) => ({ ...(current ?? {}), [key]: side }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-9 pt-8 pb-7">
      <div
        role="alert"
        className="rounded-panel border border-danger/40 border-l-6 border-l-danger bg-danger-soft px-7 py-6.5"
      >
        <h2 className="m-0 text-title font-bold text-danger">
          同じご予約を、ほかの端末でも直していました
        </h2>
        <p className="m-0 mt-2.5 text-body text-ink leading-relaxed">
          {`${theirs.terminalName === '' ? '' : `${theirs.terminalName} の `}${theirs.actorName} が ${jstClock(theirs.savedAt)} に保存しました。選ぶまで、どちらの内容も書き換わりません。`}
        </p>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-6">
        <section
          aria-label={`${theirs.actorName} が保存した内容`}
          className="flex flex-col overflow-hidden rounded-card border border-line-strong bg-surface"
        >
          <div className="border-line-strong border-b bg-surface-2 px-4.5 py-3.5">
            <h3 className="m-0 text-body font-semibold text-ink">
              {`${theirs.actorName} が保存した内容`}
            </h3>
            <p className="m-0 mt-0.5 text-grid text-ink-muted">
              {theirs.terminalName === ''
                ? `${jstClock(theirs.savedAt)} 保存済み`
                : `${theirs.terminalName}／${jstClock(theirs.savedAt)} 保存済み`}
            </p>
          </div>
          <Rows
            rows={rows}
            side="theirs"
            radioLabelSuffix={`${theirs.actorName} の内容`}
            picks={picks}
            onPick={pick}
          />
          <div className="border-line border-t px-4.5 py-4">
            <button
              type="button"
              onClick={() => onResolve({ kind: 'theirs' })}
              className={cn(
                'min-h-12 w-full rounded-card border border-line-strong bg-surface px-4 text-body font-semibold text-ink',
                focusRing,
              )}
            >
              {`${theirs.actorName} の内容を残す`}
            </button>
          </div>
        </section>

        <section
          aria-label="あなたが直した内容"
          className="flex flex-col overflow-hidden rounded-card border-2 border-pine bg-surface"
        >
          <div className="border-line-strong border-b bg-pine-soft px-4.5 py-3.5">
            <h3 className="m-0 text-body font-semibold text-ink">あなたが直した内容</h3>
            <p className="m-0 mt-0.5 text-grid text-ink-muted">
              {mine.terminalName === ''
                ? 'まだ保存していません'
                : `${mine.terminalName}／まだ保存していません`}
            </p>
          </div>
          <Rows
            rows={rows}
            side="mine"
            radioLabelSuffix="あなたの内容"
            picks={picks}
            onPick={pick}
          />
          <div className="border-line border-t px-4.5 py-4">
            <button
              type="button"
              onClick={() => onResolve({ kind: 'mine' })}
              className={cn(
                'min-h-12 w-full rounded-card border border-pine bg-pine px-4 text-body font-semibold text-on-pine',
                focusRingOnPine,
              )}
            >
              あなたの内容で上書きする
            </button>
          </div>
        </section>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2.5">
        {picks === null ? (
          <button
            type="button"
            onClick={() => setPicks({})}
            className={cn(
              'min-h-12 rounded-card border border-line-strong bg-surface px-4.5 text-body font-semibold text-ink',
              focusRing,
            )}
          >
            1項目ずつ選ぶ
          </button>
        ) : (
          <button
            type="button"
            disabled={remaining > 0}
            aria-label={
              remaining > 0
                ? `選んだ内容で保存する（残り ${remaining} 項目を選ぶと押せます）`
                : '選んだ内容で保存する'
            }
            onClick={() => {
              if (remaining === 0) onResolve({ kind: 'perField', picks })
            }}
            className={cn(
              'min-h-12 rounded-card border px-4.5 text-body font-semibold',
              remaining > 0
                ? 'border-line bg-surface-2 text-ink-faint'
                : 'border-pine bg-pine text-on-pine',
              remaining > 0 ? focusRing : focusRingOnPine,
            )}
          >
            選んだ内容で保存する
          </button>
        )}
        <button
          type="button"
          onClick={onAbort}
          className={cn(
            'min-h-12 rounded-card border border-transparent px-4.5 text-body font-semibold text-pine',
            focusRing,
          )}
        >
          やめて台帳に戻る
        </button>
      </div>
    </div>
  )
}
