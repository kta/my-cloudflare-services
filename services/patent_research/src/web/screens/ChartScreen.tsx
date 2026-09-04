import type { ClaimElementSummary, Evidence } from '@app/contracts'
import { isRejectedQuote, isSupporting } from '@app/contracts'
import { useCallback, useState } from 'react'
import { ApiError, api } from '../api'
import { Button, Empty, Mono, Notice, Panel, ParaNo, Seal, sealOf } from '../ui/parts'
import { errorMessage, Frame } from './Frame'
import { useAsync } from './useAsync'

/*
 * クレームチャート — この製品の心臓。
 *
 * 1 行 = 1 つの典拠。行頭に必ず検印（済・未・却）が押され、**支持の根拠になるのは
 * 「済」の行だけ**である。棄却された行は台帳から降ろし、別の「棄却欄」で
 * **AI が引用したとする文と、実際の段落の原文を左右に並べて**残す。
 * 削除しないのは、利用者が AI の信頼性を自分の目で評価できるようにするためである。
 */

const RELATION_LABEL: Record<string, string> = {
  discloses: '開示する',
  suggests: '示唆する',
  teaches_away: '阻害する',
  background: '背景技術',
  unrelated: '無関係',
}

const CHECK_LABEL: Record<string, string> = {
  verified: '照合済み',
  pending: '未照合',
  not_in_corpus_tier2: '照合不能（全文が未取り込み）',
  quote_mismatch: '棄却（原文と食い違う）',
  quote_too_short: '棄却（引用が短すぎる）',
  paragraph_missing: '棄却（その段落が無い）',
  publication_missing: '棄却（その公報が無い）',
  quote_empty: '棄却（引用が空）',
}

export function ChartScreen({ matterId, onSignOut }: { matterId: string; onSignOut: () => void }) {
  const elements = useAsync<ClaimElementSummary[]>(
    () => api.elements(matterId),
    [matterId],
    onSignOut,
  )
  const evidence = useAsync<Evidence[]>(() => api.evidence(matterId), [matterId], onSignOut)
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reloadBoth = useCallback(() => {
    elements.reload()
    evidence.reload()
  }, [elements, evidence])

  async function recheck() {
    setBusy(true)
    setMessage(null)
    try {
      const { rechecked } = await api.recheckEvidence(matterId)
      setMessage(
        rechecked === 0
          ? '再照合しました。状態が変わった典拠はありません。'
          : `再照合しました。${rechecked} 件の状態が変わりました。`,
      )
      reloadBoth()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSignOut()
      setMessage(
        err instanceof ApiError ? errorMessage(err.code, err.detail) : '再照合できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  async function review(id: string, review: 'confirmed' | 'disputed') {
    setBusy(true)
    setMessage(null)
    try {
      await api.reviewEvidence(id, { review })
      reloadBoth()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSignOut()
      setMessage(
        err instanceof ApiError ? errorMessage(err.code, err.detail) : '記録できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame
      state={elements}
      empty="まだ構成要件がありません。「構成要件」の画面で請求項を分解してください。"
    >
      {(els) => {
        const current = els.find((e) => e.id === selected) ?? els[0]
        const all = evidence.data ?? []
        const mine = current ? all.filter((e) => e.elementId === current.id) : []
        const kept = mine.filter((e) => !isRejectedQuote(e.quoteCheck))
        const dropped = mine.filter((e) => isRejectedQuote(e.quoteCheck))

        return (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[14rem_minmax(0,1fr)_18rem]">
            <ElementIndex elements={els} currentId={current?.id ?? null} onSelect={setSelected} />

            <div className="flex min-w-0 flex-col gap-4">
              {message && <Notice tone="verified">{message}</Notice>}
              <Panel
                title={
                  current ? `【${current.elementKey}】${current.text}` : '構成要件を選んでください'
                }
                aside={
                  <span className="flex items-center gap-2">
                    <Button onClick={recheck} disabled={busy}>
                      {busy ? '照合中…' : '再照合する'}
                    </Button>
                  </span>
                }
              >
                {kept.length === 0 ? (
                  <Empty>
                    この構成要件を開示する公報は、まだ 1 件も見つかっていません。
                    <br />
                    <span className="text-tk-ink-muted">
                      まだ探していないだけかもしれません。「先行技術検索」で調べてください。
                    </span>
                  </Empty>
                ) : (
                  <LedgerTable rows={kept} busy={busy} onReview={review} />
                )}
              </Panel>

              {dropped.length > 0 && <RejectedPanel rows={dropped} />}
            </div>

            <CitationGutter element={current ?? null} evidence={mine} />
          </div>
        )
      }}
    </Frame>
  )
}

function ElementIndex({
  elements,
  currentId,
  onSelect,
}: {
  elements: ClaimElementSummary[]
  currentId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <Panel title="構成要件">
      <ol className="flex flex-col">
        {elements.map((e) => {
          const isCurrent = e.id === currentId
          // 典拠が 1 件も無い要件は、新規性の勝ち筋かもしれない。太い罫で立てる
          // （色を足さない。索引の中で唯一の太罫であることが目印になる）。
          const isOpen = e.evidenceCount === 0
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onSelect(e.id)}
                className={`w-full border-tk-line border-b py-2 pr-1 pl-2 text-left ${
                  isCurrent ? 'bg-tk-verified-soft' : ''
                } ${isOpen ? 'border-l-4 border-l-tk-ink' : 'border-l-4 border-l-transparent'}`}
              >
                <span className="flex items-baseline gap-2">
                  <Mono className="font-bold text-tk-ink">{e.elementKey}</Mono>
                  <span className="text-tk-body text-tk-ink leading-snug">{e.text}</span>
                </span>
                <span className="mt-1 flex items-center gap-1.5">
                  {e.evidenceCount === 0 ? (
                    <span className="font-bold text-tk-note text-tk-ink">
                      典拠 0 件 — 新規性の勝ち筋
                    </span>
                  ) : (
                    <>
                      <Seal kind="verified" size="sm" />
                      <Mono>{e.verifiedCount}</Mono>
                      {e.confirmedCount > 0 && (
                        <span className="text-tk-note text-tk-verified">
                          （人 {e.confirmedCount}）
                        </span>
                      )}
                      {e.pendingCount > 0 && (
                        <>
                          <Seal kind="pending" size="sm" />
                          <Mono>{e.pendingCount}</Mono>
                        </>
                      )}
                      {e.rejectedCount > 0 && (
                        <>
                          <Seal kind="rejected" size="sm" />
                          <Mono>{e.rejectedCount}</Mono>
                        </>
                      )}
                    </>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

function LedgerTable({
  rows,
  busy,
  onReview,
}: {
  rows: Evidence[]
  busy: boolean
  onReview: (id: string, review: 'confirmed' | 'disputed') => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-left">
        <thead>
          <tr className="border-tk-line-strong border-b text-tk-note text-tk-ink-muted">
            <th className="w-8 py-1.5 font-bold">検</th>
            <th className="w-36 py-1.5 pr-3 font-bold">公報番号</th>
            <th className="w-14 py-1.5 pr-3 font-bold">段落</th>
            <th className="py-1.5 pr-3 font-bold">引用の原文</th>
            <th className="w-16 py-1.5 pr-3 font-bold">関係</th>
            <th className="w-24 py-1.5 font-bold">人の確認</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="border-tk-line border-b align-top">
              <td className="py-2">
                <Seal kind={sealOf(e.quoteCheck)} />
              </td>
              <td className="py-2 pr-3">
                <Mono className="text-tk-verified">{e.pubNumber}</Mono>
                <span className="mt-0.5 block text-tk-fine text-tk-ink-muted leading-snug">
                  {e.applicants.join('、') || '出願人不明'}
                </span>
                {e.pubDate && <Mono className="text-tk-ink-muted">{e.pubDate}</Mono>}
              </td>
              <td className="py-2 pr-3">
                <ParaNo value={e.paraNo} />
              </td>
              <td className="py-2 pr-3 text-tk-body text-tk-ink">
                {e.quotedText}
                {e.quoteCheck !== 'verified' && (
                  <span className="mt-1 block text-tk-note text-tk-pending">
                    {CHECK_LABEL[e.quoteCheck] ?? e.quoteCheck}
                    {e.quoteCheckDetail ? ` — ${e.quoteCheckDetail}` : ''}
                  </span>
                )}
              </td>
              <td className="py-2 pr-3 text-tk-data text-tk-ink">
                {RELATION_LABEL[e.relation] ?? e.relation}
              </td>
              <td className="py-2">
                {e.quoteCheck !== 'verified' ? (
                  <span className="text-tk-note text-tk-ink-muted leading-snug">
                    照合を通るまで確認できません
                  </span>
                ) : e.review === 'unreviewed' ? (
                  <span className="flex flex-col gap-1">
                    <Button onClick={() => onReview(e.id, 'confirmed')} disabled={busy}>
                      開示を認める
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => onReview(e.id, 'disputed')}
                      disabled={busy}
                    >
                      認めない
                    </Button>
                  </span>
                ) : (
                  <span className="text-tk-data text-tk-ink">
                    {e.review === 'confirmed' ? '確認済み' : '否認'}
                    <Mono className="mt-0.5 block text-tk-ink-muted">
                      {e.reviewedAt?.slice(0, 10) ?? ''}
                    </Mono>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * 棄却欄。台帳から降ろした行を、**AI の主張と実際の原文の対比**として残す。
 * これがこの製品の主張を最も文字通りに実装している場所である。
 */
function RejectedPanel({ rows }: { rows: Evidence[] }) {
  return (
    <Panel
      title="棄却された典拠"
      aside={
        <span className="text-tk-note text-tk-ink-muted">
          支持の根拠にはならないが、記録として残す
        </span>
      }
      className="border-tk-rejected"
    >
      <ul className="flex flex-col gap-3">
        {rows.map((e) => (
          <li key={e.id} className="border-tk-line border-b pb-3 last:border-b-0 last:pb-0">
            <div className="flex items-baseline gap-2">
              <Seal kind="rejected" size="sm" />
              <Mono className="text-tk-ink">{e.pubNumber}</Mono>
              <ParaNo value={e.paraNo} />
              <span className="text-tk-note text-tk-rejected">
                {CHECK_LABEL[e.quoteCheck] ?? e.quoteCheck}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <p className="font-bold text-tk-note text-tk-ink-muted">AI が引用したとする文</p>
                <p className="mt-1 text-tk-body text-tk-ink line-through decoration-tk-rejected">
                  {e.quotedText}
                </p>
              </div>
              <div>
                <p className="font-bold text-tk-note text-tk-ink-muted">照合の結果</p>
                <p className="mt-1 text-tk-body text-tk-ink">
                  {e.quoteCheckDetail ?? '当該段落の原文にこの文は存在しない。'}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * 典拠の余白（citation gutter）— この画面が記憶される 1 点。
 *
 * 所見の各文の右に、それを裏付ける典拠の札が並ぶ。**札を持たない文は琥珀の下線を引かれ、
 * 空の検印（点線の四角）が押される。** 機械が確かめられなかった主張が、
 * 確かめられた主張と同じ見え方にならないようにする。
 */
function CitationGutter({
  element,
  evidence,
}: {
  element: ClaimElementSummary | null
  evidence: Evidence[]
}) {
  // 支持として並べるのは、機械照合を通り、かつ人が開示を認めたものだけ。
  // relation は送り手の自己申告なので、機械照合だけでは支持と呼べない。
  const supported = evidence.filter((e) => isSupporting(e))
  const findings: { text: string; support: Evidence[] }[] = element
    ? [
        {
          text: `構成要件 ${element.elementKey} を開示する公報が ${supported.length} 件確認されている（機械照合を通り、人が開示を認めたもの）。`,
          support: supported,
        },
        {
          text:
            supported.length > 0
              ? `最も古い開示は ${
                  supported
                    .map((e) => e.pubDate)
                    .filter((d): d is string => d !== null)
                    .sort()[0] ?? '不明'
                } の公報である。`
              : 'この構成要件を開示する公報は、いまのところ照合を通っていない。',
          support: supported.slice(0, 2),
        },
        {
          // 典拠を持てない主張をあえて 1 つ置く。「不存在」は原文で示せないので、
          // この製品では常に「典拠なし」になる。思想が正しく働いていることの目印。
          text: 'この構成要件を開示する公報は世界に存在しない。',
          support: [],
        },
      ]
    : []

  return (
    <Panel
      title="典拠の余白"
      aside={<span className="text-tk-fine text-tk-ink-muted">所見と裏付け</span>}
    >
      {element === null ? (
        <Empty>構成要件を選ぶと、所見と裏付けが並びます。</Empty>
      ) : (
        <ul className="flex flex-col gap-4">
          {findings.map((f) => (
            <li key={f.text}>
              <p
                className={`text-tk-body ${
                  f.support.length === 0
                    ? 'text-tk-ink underline decoration-tk-pending decoration-2 underline-offset-4'
                    : 'text-tk-ink'
                }`}
              >
                {f.text}
              </p>
              <div className="mt-1.5 flex flex-col gap-1">
                {f.support.length === 0 ? (
                  <span className="flex items-center gap-1.5">
                    <Seal kind="none" size="sm" />
                    <span className="text-tk-note text-tk-pending">典拠なし — 表示しない</span>
                  </span>
                ) : (
                  f.support.map((e) => (
                    <span key={e.id} className="flex items-center gap-1.5">
                      <Seal kind="verified" size="sm" />
                      <Mono className="text-tk-verified">{e.pubNumber}</Mono>
                      <ParaNo value={e.paraNo} />
                    </span>
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 border-tk-line border-t pt-3 text-tk-fine text-tk-ink-muted leading-relaxed">
        典拠の札がある文だけが、公報の原文に実在することを機械が確かめた文です。札のない文は、
        本システムでは支持されていません。
      </p>
    </Panel>
  )
}
