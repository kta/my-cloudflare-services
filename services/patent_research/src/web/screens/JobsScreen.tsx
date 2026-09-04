import type { Job } from '@app/contracts'
import { api } from '../api'
import { Mono, Panel } from '../ui/parts'
import { Frame } from './Frame'
import { useAsync } from './useAsync'

/*
 * ジョブの待ち行列。
 *
 * ここに積まれた仕事を拾うのは Claude Code のスキルであり、画面ではない。
 * 画面がやるのは「何を頼んだか」「どこまで進んだか」を見せることだけである。
 * 起動を画面から自動でやらないのは、**分析の実行を人間が意識的に始める**ようにするため
 * （未出願の発明が動くので、いつ何が走ったかが曖昧になってはいけない）。
 */

const KIND_LABEL: Record<string, string> = {
  search: '先行技術を探す',
  assess: '特許性を論じる',
  draft: '明細書を起こす',
  refine_disclosure: '発明の聞き取りを深める',
}

const STATUS_LABEL: Record<string, string> = {
  queued: '待ち',
  running: '実行中',
  done: '完了',
  failed: '失敗',
}

export function JobsScreen({
  onOpen,
  onSignOut,
}: {
  onOpen: (id: string) => void
  onSignOut: () => void
}) {
  const state = useAsync<Job[]>(() => api.jobs(), [], onSignOut)
  return (
    <div className="flex flex-col gap-4">
      <Panel title="スキルの起こし方">
        <div className="flex flex-col gap-2 text-tk-body text-tk-ink leading-relaxed">
          <p>
            ここに積まれた仕事は、別のターミナルで Claude Code のスキルを起こして拾います。
            画面が勝手に走らせないのは、未出願の発明が動くからです。
          </p>
          <pre className="overflow-x-auto rounded-tk-doc border border-tk-line-strong bg-tk-board px-3 py-2 font-tk-mono text-tk-data text-tk-ink">
            {`# 待っている仕事を 1 つ拾って進める
claude "/patent-search"

# 間隔をあけて拾い続ける
claude "/loop 30m /patent-search"`}
          </pre>
        </div>
      </Panel>

      <Frame state={state} empty="まだ仕事を積んでいません。案件の画面から積んでください。">
        {(jobs) => (
          <Panel title={`仕事 ${jobs.length} 件`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-left">
                <thead>
                  <tr className="border-tk-line-strong border-b text-tk-note text-tk-ink-muted">
                    <th className="w-16 py-1.5 pr-3 font-bold">状態</th>
                    <th className="w-40 py-1.5 pr-3 font-bold">内容</th>
                    <th className="py-1.5 pr-3 font-bold">指示</th>
                    <th className="w-36 py-1.5 font-bold">積んだ時刻</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-tk-line border-b align-baseline">
                      <td className="py-2 pr-3">
                        <span
                          className={`font-bold text-tk-data ${
                            j.status === 'done'
                              ? 'text-tk-verified'
                              : j.status === 'failed'
                                ? 'text-tk-rejected'
                                : 'text-tk-pending'
                          }`}
                        >
                          {STATUS_LABEL[j.status] ?? j.status}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          onClick={() => onOpen(j.matterId)}
                          className="text-left text-tk-body text-tk-verified underline underline-offset-2"
                        >
                          {KIND_LABEL[j.kind] ?? j.kind}
                        </button>
                      </td>
                      <td className="py-2 pr-3 text-tk-body text-tk-ink leading-relaxed">
                        {j.instruction || <span className="text-tk-ink-muted">（指示なし）</span>}
                        {j.error && <span className="mt-1 block text-tk-rejected">{j.error}</span>}
                      </td>
                      <td className="py-2">
                        <Mono className="text-tk-ink-muted">
                          {j.requestedAt.slice(0, 16).replace('T', ' ')}
                        </Mono>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </Frame>
    </div>
  )
}
