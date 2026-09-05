import type { CorpusStatus } from '@app/contracts'
import { useEffect } from 'react'
import { api } from '../api'
import { Mono, Notice, Panel } from '../ui/parts'
import { Frame } from './Frame'
import { useAsync } from './useAsync'

/*
 * コーパスの状態。
 *
 * この画面の役目は 1 つ。**「見ている範囲」を利用者に正直に見せること。**
 * 何件取り込まれていて、そのうち何件に全文があり、どの分類にどれだけあるか。
 * 届かないときは 0 件ではなく「届かなかった」と出す。
 */

export function CorpusScreen({
  onSignOut,
  onFatal,
}: {
  onSignOut: () => void
  onFatal: (message: string | null) => void
}) {
  const state = useAsync<CorpusStatus>(() => api.corpusStatus(), [], onSignOut)

  useEffect(() => {
    if (state.data && !state.data.reachable) {
      onFatal(
        'コーパスに届いていません。検索は実行できず、典拠の照合も進みません（0 件ではなく「まだ見ていない」状態です）。',
      )
      return
    }
    onFatal(null)
  }, [state.data, onFatal])

  return (
    <Frame state={state}>
      {(status) => (
        <div className="flex flex-col gap-4">
          {!status.reachable && (
            <Notice tone="pending">
              コーパスサイドカーに届きませんでした。別のターミナルで起動してください。
              <span className="mt-1 block font-tk-mono text-tk-note">
                cd packages/patent-corpus && INTERNAL_KEY=... node src/cli.ts serve --db ./corpus.db
              </span>
              {status.detail && (
                <span className="mt-1 block text-tk-note opacity-80">{status.detail}</span>
              )}
            </Notice>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="公報" value={status.publications} note="書誌が入っている件数" />
            <Stat
              label="全文あり"
              value={status.withFulltext}
              note="段落まで取り込めた件数。ここに無い公報は照合できない"
            />
            <Stat label="段落" value={status.paragraphs} note="引用の最小単位" />
            <Stat
              label="ベクトル"
              value={status.chunks}
              note="意味検索まで昇格した断片。0 でも全文検索は使える"
            />
          </div>

          <Panel title="IPC サブクラス別の件数">
            {Object.keys(status.byIpcSubclass).length === 0 ? (
              <p className="py-4 text-center text-tk-body text-tk-ink-muted">
                まだ分類コードのある公報がありません。
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {Object.entries(status.byIpcSubclass)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 20)
                  .map(([code, count]) => {
                    const max = Math.max(...Object.values(status.byIpcSubclass))
                    return (
                      <li key={code} className="flex items-center gap-3">
                        <Mono className="w-16 shrink-0 text-tk-ink">{code}</Mono>
                        <span
                          className="h-3 bg-tk-verified"
                          style={{ width: `${Math.max(2, (count / max) * 70)}%` }}
                        />
                        <Mono className="text-tk-ink-muted">{count.toLocaleString('ja-JP')}</Mono>
                      </li>
                    )
                  })}
              </ul>
            )}
          </Panel>

          {status.extractFailures > 0 && (
            <Notice tone="pending">
              取り込みに失敗した公報が {status.extractFailures} 件あります。テキストレイヤの無い PDF
              や、段落番号が重複していた XML です。握りつぶさず記録してあるので、 `corpus stats`
              で中身を確認してください。
            </Notice>
          )}
        </div>
      )}
    </Frame>
  )
}

function Stat({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="rounded-tk-doc border border-tk-line-strong bg-tk-sheet px-4 py-3">
      <p className="text-tk-data text-tk-ink-muted">{label}</p>
      <p className="mt-0.5 font-tk-mono font-medium text-tk-figure text-tk-ink tabular-nums">
        {value.toLocaleString('ja-JP')}
      </p>
      <p className="mt-1 text-tk-fine text-tk-ink-muted leading-relaxed">{note}</p>
    </div>
  )
}
