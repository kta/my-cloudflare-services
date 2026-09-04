import type { Assessment, ClaimElementSummary, Evidence } from '@app/contracts'
import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../api'
import { Button, Field, Mono, Notice, Panel, Select, TextArea, TextInput } from '../ui/parts'
import { errorMessage, Frame } from './Frame'
import { useAsync } from './useAsync'

/*
 * 特許性の判断。
 *
 * 自由記述の作文にせず、審査基準の型に沿った欄を持たせる。
 * - 新規性（29条1項）は**単一文献主義**。副引用も動機付けも欄が出ない
 * - 進歩性（29条2項）は 主引用 → 副引用 → **組合せの動機付けの 4 類型** → 有利な効果 → 阻害要因
 * 阻害要因の欄を空のまま結論だけ出せてしまうと、審査官と同じ土俵に立てない。
 */

const MOTIVATION: { value: string; label: string }[] = [
  { value: '', label: '（選ばない）' },
  { value: 'technical_field', label: '技術分野の関連性' },
  { value: 'problem', label: '課題の共通性' },
  { value: 'function', label: '作用・機能の共通性' },
  { value: 'suggestion', label: '引用発明の内容中の示唆' },
]

const NEGATIVE: { value: string; label: string }[] = [
  { value: '', label: '（該当しない）' },
  { value: 'design_change', label: '設計変更にすぎない' },
  { value: 'mere_aggregation', label: '単なる寄せ集めにすぎない' },
]

const CONCLUSION: { value: string; label: string }[] = [
  { value: 'undetermined', label: 'まだ言えない' },
  { value: 'likely_patentable', label: '通りそう' },
  { value: 'risky', label: '危うい' },
  { value: 'blocked', label: '塞がれている' },
]

const KIND_LABEL: Record<string, string> = {
  novelty: '新規性（29条1項）',
  inventive_step: '進歩性（29条2項）',
}

export function AssessmentScreen({
  matterId,
  onSignOut,
}: {
  matterId: string
  onSignOut: () => void
}) {
  const history = useAsync<Assessment[]>(() => api.assessments(matterId), [matterId], onSignOut)
  const elements = useAsync<ClaimElementSummary[]>(
    () => api.elements(matterId),
    [matterId],
    onSignOut,
  )
  const evidence = useAsync<Evidence[]>(() => api.evidence(matterId), [matterId], onSignOut)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-4">
        <Form matterId={matterId} onSaved={history.reload} onSignOut={onSignOut} />
        <Frame state={history} empty="まだ判断を書いていません。">
          {(list) => (
            <Panel title={`判断の記録 ${list.length} 件`}>
              <ul className="flex flex-col gap-3">
                {list.map((a) => (
                  <li key={a.id} className="border-tk-line border-b pb-3 last:border-b-0">
                    <p className="flex items-baseline gap-3">
                      <span className="font-bold text-tk-body text-tk-ink">
                        {KIND_LABEL[a.kind] ?? a.kind}
                      </span>
                      <span className="text-tk-data text-tk-ink">
                        {CONCLUSION.find((c) => c.value === a.conclusion)?.label ?? a.conclusion}
                      </span>
                      <Mono className="text-tk-ink-muted">
                        {a.createdAt.slice(0, 16).replace('T', ' ')}
                      </Mono>
                    </p>
                    <dl className="mt-1 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-tk-data">
                      <dt className="text-tk-ink-muted">主引用</dt>
                      <dd>
                        <Mono>{a.primaryRef ?? '—'}</Mono>
                      </dd>
                      {a.secondaryRefs.length > 0 && (
                        <>
                          <dt className="text-tk-ink-muted">副引用</dt>
                          <dd>
                            <Mono>{a.secondaryRefs.join('、')}</Mono>
                          </dd>
                        </>
                      )}
                      {a.motivationType && (
                        <>
                          <dt className="text-tk-ink-muted">動機付け</dt>
                          <dd>{MOTIVATION.find((m) => m.value === a.motivationType)?.label}</dd>
                        </>
                      )}
                      {a.hindrance && (
                        <>
                          <dt className="text-tk-ink-muted">阻害要因</dt>
                          <dd className="leading-relaxed">{a.hindrance}</dd>
                        </>
                      )}
                    </dl>
                    {a.reasoning && (
                      <p className="mt-1 whitespace-pre-wrap text-tk-body text-tk-ink">
                        {a.reasoning}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </Frame>
      </div>

      <Panel title="いま分かっていること">
        <Frame state={elements}>
          {(els) => {
            const ev = evidence.data ?? []
            // 「塞がれた」は人間が開示を認めた件数で判断する。機械照合だけでは足りない
            // — 引用が実在することと、それが構成要件の開示にあたることは別の話である。
            const open = els.filter((e) => e.confirmedCount === 0)
            const awaitingReview = els.filter((e) => e.confirmedCount === 0 && e.verifiedCount > 0)
            return (
              <div className="flex flex-col gap-3 text-tk-body leading-relaxed">
                <p>
                  構成要件 <Mono>{els.length}</Mono> のうち、開示が確認できたのは{' '}
                  <Mono>{els.filter((e) => e.confirmedCount > 0).length}</Mono> 件です。
                </p>
                {awaitingReview.length > 0 && (
                  <p className="text-tk-pending">
                    照合は通ったが人がまだ確認していない要件が <Mono>{awaitingReview.length}</Mono>{' '}
                    件あります。クレームチャートで「開示を認める」か「認めない」を決めるまで、
                    塞がれたとは数えません。
                  </p>
                )}
                {open.length > 0 ? (
                  <div>
                    <p className="font-bold text-tk-ink">まだ開示が見つかっていない要件</p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {open.map((e) => (
                        <li key={e.id} className="text-tk-ink">
                          <Mono className="font-bold">{e.elementKey}</Mono> {e.text}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-tk-note text-tk-ink-muted">
                      ここが新規性の勝ち筋になり得ます。ただし「まだ探していない」「まだ人が確認していない」
                      だけかもしれません。
                    </p>
                  </div>
                ) : (
                  <p className="text-tk-pending">
                    すべての構成要件に開示が見つかっています。組合せの動機付けと阻害要因で争うことになります。
                  </p>
                )}
                <p className="text-tk-note text-tk-ink-muted">
                  阻害要因の候補（関係を「阻害する」と記録した典拠）:{' '}
                  <Mono>{ev.filter((e) => e.relation === 'teaches_away').length}</Mono> 件
                </p>
              </div>
            )
          }}
        </Frame>
      </Panel>
    </div>
  )
}

function Form({
  matterId,
  onSaved,
  onSignOut,
}: {
  matterId: string
  onSaved: () => void
  onSignOut: () => void
}) {
  const [kind, setKind] = useState<'novelty' | 'inventive_step'>('novelty')
  const [primaryRef, setPrimaryRef] = useState('')
  const [secondary, setSecondary] = useState('')
  const [motivationType, setMotivationType] = useState('')
  const [advantageousEffects, setAdvantageousEffects] = useState('')
  const [hindrance, setHindrance] = useState('')
  const [negativeType, setNegativeType] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [conclusion, setConclusion] = useState('undetermined')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isStep = kind === 'inventive_step'

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.saveAssessment(matterId, {
        kind,
        primaryRef: primaryRef.trim() || null,
        secondaryRefs: isStep
          ? secondary
              .split(/[\s、,]+/)
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : [],
        motivationType: isStep && motivationType ? motivationType : null,
        advantageousEffects,
        hindrance,
        negativeType: negativeType || null,
        reasoning,
        conclusion,
      })
      setReasoning('')
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSignOut()
      setError(
        err instanceof ApiError
          ? err.code === 'request_failed'
            ? '入力が審査基準の型に合っていません。新規性では副引用と動機付けを使いません。進歩性で結論を出すには主引用が要ります。'
            : errorMessage(err.code, err.detail)
          : '保存できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="判断を書く">
      <form onSubmit={save} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="どちらの要件か" htmlFor="kind">
            <Select
              id="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'novelty' | 'inventive_step')}
            >
              <option value="novelty">新規性（29条1項）</option>
              <option value="inventive_step">進歩性（29条2項）</option>
            </Select>
          </Field>
          <Field label="結論" htmlFor="conclusion">
            <Select
              id="conclusion"
              value={conclusion}
              onChange={(e) => setConclusion(e.target.value)}
            >
              {CONCLUSION.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="主引用発明の公報番号"
          htmlFor="primary"
          hint={
            isStep
              ? '進歩性で結論を出すには必ず特定します。'
              : '新規性は 1 つの文献だけで判断します（単一文献主義）。'
          }
        >
          <TextInput
            id="primary"
            value={primaryRef}
            onChange={(e) => setPrimaryRef(e.target.value)}
            placeholder="特開2018-134274"
          />
        </Field>

        {isStep && (
          <>
            <Field label="副引用発明" htmlFor="secondary" hint="空白か読点で区切ります。">
              <TextInput
                id="secondary"
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
                placeholder="特開2019-000001"
              />
            </Field>
            <Field
              label="組合せの動機付け"
              htmlFor="motivation"
              hint="審査基準が挙げる 4 類型です。ここが立たなければ、組合せは容易ではありません。"
            >
              <Select
                id="motivation"
                value={motivationType}
                onChange={(e) => setMotivationType(e.target.value)}
              >
                {MOTIVATION.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="阻害要因"
              htmlFor="hindrance"
              hint="組合せを妨げる事情。ここを空のまま結論を出すと、審査官と同じ土俵に立てません。"
            >
              <TextArea
                id="hindrance"
                rows={2}
                value={hindrance}
                onChange={(e) => setHindrance(e.target.value)}
              />
            </Field>
            <Field label="設計変更・寄せ集めの疑い" htmlFor="negative">
              <Select
                id="negative"
                value={negativeType}
                onChange={(e) => setNegativeType(e.target.value)}
              >
                {NEGATIVE.map((n) => (
                  <option key={n.value} value={n.value}>
                    {n.label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        <Field label="有利な効果" htmlFor="effects" hint="進歩性を肯定する方向に働く事情です。">
          <TextArea
            id="effects"
            rows={2}
            value={advantageousEffects}
            onChange={(e) => setAdvantageousEffects(e.target.value)}
          />
        </Field>

        <Field label="論証" htmlFor="reasoning">
          <TextArea
            id="reasoning"
            rows={4}
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            placeholder="主引用発明との相違点は…"
          />
        </Field>

        {error && <Notice tone="rejected">{error}</Notice>}
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? '保存しています…' : '判断を記録する'}
          </Button>
        </div>
      </form>
    </Panel>
  )
}
