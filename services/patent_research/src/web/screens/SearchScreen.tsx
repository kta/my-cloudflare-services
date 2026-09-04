import type { ClaimElementSummary, SearchHit, SearchRecord } from '@app/contracts'
import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../api'
import { Button, Field, Mono, Notice, Panel, ParaNo, Select, TextInput } from '../ui/parts'
import { errorMessage, Frame } from './Frame'
import { useAsync } from './useAsync'

/*
 * 先行技術検索。
 *
 * **実行した検索式をそのまま記録に残す**のがこの画面の要件である。調査報告書に必要であり、
 * かつ「何を見て、何を見ていないか」を後から検証できるようにするためでもある。
 * コーパスに届かなかったときは 0 件ではなく「届かなかった」と表示する。
 */

export function SearchScreen({ matterId, onSignOut }: { matterId: string; onSignOut: () => void }) {
  const elements = useAsync<ClaimElementSummary[]>(
    () => api.elements(matterId),
    [matterId],
    onSignOut,
  )
  const history = useAsync<SearchRecord[]>(() => api.searches(matterId), [matterId], onSignOut)

  const [terms, setTerms] = useState('')
  const [elementId, setElementId] = useState('')
  const [ipcPrefix, setIpcPrefix] = useState('')
  const [pubDateTo, setPubDateTo] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [record, setRecord] = useState<SearchRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState<string | null>(null)

  async function run(e: FormEvent) {
    e.preventDefault()
    const list = terms
      .split(/[\s、,]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    if (list.length === 0) {
      setError('検索語を 1 つ以上入れてください。')
      return
    }
    setBusy(true)
    setError(null)
    setAdded(null)
    try {
      const res = await api.runSearch(matterId, {
        elementId: elementId || null,
        terms: list,
        op: 'AND',
        ipcPrefix: ipcPrefix.trim() || null,
        pubDateFrom: null,
        pubDateTo: pubDateTo || null,
        sections: [],
        limit: 50,
      })
      setHits(res.hits)
      setRecord(res.record)
      history.reload()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSignOut()
      setHits(null)
      setRecord(null)
      setError(
        err instanceof ApiError
          ? errorMessage(err.code, err.detail)
          : '検索できませんでした。もう一度試してください。',
      )
    } finally {
      setBusy(false)
    }
  }

  async function addEvidence(hit: SearchHit) {
    if (!elementId) {
      setError('典拠として積むには、先に構成要件を選んでください。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const ev = await api.proposeEvidence(matterId, {
        elementId,
        pubNumber: hit.pubNumber,
        paraNo: hit.paraNo,
        // 検索でヒットした段落の**原文をそのまま**引く。人が切り詰めると照合を落とすので、
        // まず全文を典拠にし、あとでクレームチャートで絞る。
        quotedText: hit.text,
        relation: 'discloses',
        note: '',
        producedBy: 'search',
      })
      setAdded(
        ev.quoteCheck === 'verified'
          ? `${hit.pubNumber}【${hit.paraNo}】を典拠に積みました（照合済み）。`
          : `${hit.pubNumber}【${hit.paraNo}】を積みましたが、照合は通りませんでした（${ev.quoteCheck}）。`,
      )
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSignOut()
      setError(err instanceof ApiError ? errorMessage(err.code, err.detail) : '積めませんでした。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="検索">
        <form
          onSubmit={run}
          className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <Field label="検索語" htmlFor="terms" hint="空白か読点で区切ると AND で結びます。">
            <TextInput
              id="terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="瞳孔 中心 検出"
            />
          </Field>
          <Field
            label="構成要件"
            htmlFor="element"
            hint="選ぶと、この検索がどの要件のためかを記録します。"
          >
            <Select id="element" value={elementId} onChange={(e) => setElementId(e.target.value)}>
              <option value="">（要件に紐づけない）</option>
              {(elements.data ?? []).map((el) => (
                <option key={el.id} value={el.id}>
                  {el.elementKey}: {el.text.slice(0, 18)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="IPC の前方一致" htmlFor="ipc" hint="例: G06F3">
            <TextInput id="ipc" value={ipcPrefix} onChange={(e) => setIpcPrefix(e.target.value)} />
          </Field>
          <Field
            label="公開日がこの日まで"
            htmlFor="to"
            hint="出願日より前の公開だけを見るときに使います。"
          >
            <TextInput
              id="to"
              type="date"
              value={pubDateTo}
              onChange={(e) => setPubDateTo(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? '探しています…' : '検索する'}
          </Button>
        </form>
      </Panel>

      {error && <Notice tone="rejected">{error}</Notice>}
      {added && <Notice tone="verified">{added}</Notice>}

      {record && (
        <Panel
          title="実行した検索式"
          aside={<Mono className="text-tk-ink-muted">記録に残ります</Mono>}
        >
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-1 text-tk-data">
            <dt className="text-tk-ink-muted">MATCH 式</dt>
            <dd>
              <Mono className="text-tk-ink">{record.matchExpression ?? '（空）'}</Mono>
            </dd>
            <dt className="text-tk-ink-muted">ヒット</dt>
            <dd>
              <Mono>{record.hitCount}</Mono>
              <span className="ml-2 text-tk-ink-muted">
                件（うち公開日不明 <Mono>{record.undatedCount}</Mono> 件）
              </span>
            </dd>
            <dt className="text-tk-ink-muted">実行</dt>
            <dd>
              <Mono>{record.executedAt.slice(0, 19).replace('T', ' ')}</Mono>
              <span className="ml-2 text-tk-ink-muted">
                コーパス batch <Mono>{record.corpusBatchCount}</Mono>
              </span>
            </dd>
            {record.splitTerms.length > 0 && (
              <>
                <dt className="text-tk-pending">分割した語</dt>
                <dd className="text-tk-pending">
                  {record.splitTerms.join('、')} — 区切りを含むので連続性を保証していません
                </dd>
              </>
            )}
            {record.droppedTerms.length > 0 && (
              <>
                <dt className="text-tk-pending">落とした語</dt>
                <dd className="text-tk-pending">{record.droppedTerms.join('、')}</dd>
              </>
            )}
          </dl>
        </Panel>
      )}

      {hits !== null && (
        <Panel title={`ヒット ${hits.length} 件`}>
          {hits.length === 0 ? (
            <p className="border border-tk-line border-dashed px-4 py-6 text-center text-tk-body text-tk-ink-muted leading-relaxed">
              この検索式では 1 件も当たりませんでした。
              <br />
              コーパスに取り込まれている範囲での結果です。検索語を変えるか、IPC
              の絞りを外して試してください。
            </p>
          ) : (
            <ul className="flex flex-col">
              {hits.map((h) => (
                <li
                  key={`${h.pubNumber}/${h.paraNo}`}
                  className="flex items-start gap-3 border-tk-line border-b py-2.5"
                >
                  <div className="w-44 shrink-0">
                    <Mono className="text-tk-verified">{h.pubNumber}</Mono>
                    <span className="mt-0.5 block text-tk-fine text-tk-ink-muted leading-snug">
                      {h.applicants.join('、') || '出願人不明'}
                    </span>
                    <Mono className="text-tk-ink-muted">{h.pubDate ?? '公開日不明'}</Mono>
                  </div>
                  <div className="w-14 shrink-0">
                    <ParaNo value={h.paraNo} />
                  </div>
                  <p className="min-w-0 flex-1 text-tk-body text-tk-ink">{h.snippet}</p>
                  <Button onClick={() => addEvidence(h)} disabled={busy}>
                    典拠に積む
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Frame state={history} empty="まだ検索していません。">
        {(records) => (
          <Panel title={`検索の記録 ${records.length} 件`}>
            <ul className="flex flex-col">
              {records.map((r) => (
                <li key={r.id} className="flex items-baseline gap-3 border-tk-line border-b py-1.5">
                  <Mono className="w-36 shrink-0 text-tk-ink-muted">
                    {r.executedAt.slice(0, 16).replace('T', ' ')}
                  </Mono>
                  <Mono className="min-w-0 flex-1 text-tk-ink">
                    {r.matchExpression ?? '（空）'}
                  </Mono>
                  <Mono className="w-16 shrink-0 text-right">{r.hitCount} 件</Mono>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </Frame>
    </div>
  )
}
