import type { ClaimElementSummary } from '@app/contracts'
import { type FormEvent, useState } from 'react'
import { ApiError, api, type ElementInput } from '../api'
import { Button, Field, Mono, Notice, Panel, Seal, TextArea, TextInput } from '../ui/parts'
import { errorMessage, Frame } from './Frame'
import { useAsync } from './useAsync'

/*
 * 構成要件の分解。
 *
 * 先行技術調査の単位は文献ではなく**構成要件**である。請求項を A・B・C… に割り、
 * 要件ごとに「それを開示する公報のどの段落か」を突き合わせていく。ここを飛ばすと、
 * 調査が「似た文献を眺める」作業に退化する。
 */

const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function ElementsScreen({
  matterId,
  onSignOut,
}: {
  matterId: string
  onSignOut: () => void
}) {
  const state = useAsync<ClaimElementSummary[]>(() => api.elements(matterId), [matterId], onSignOut)
  return (
    <Frame state={state}>
      {(elements) => (
        <Editor
          matterId={matterId}
          initial={elements}
          onSaved={state.reload}
          onSignOut={onSignOut}
        />
      )}
    </Frame>
  )
}

interface Row {
  claimNo: number
  elementKey: string
  text: string
  isEssential: boolean
  evidenceCount: number
  verifiedCount: number
  rejectedCount: number
}

function Editor({
  matterId,
  initial,
  onSaved,
  onSignOut,
}: {
  matterId: string
  initial: ClaimElementSummary[]
  onSaved: () => void
  onSignOut: () => void
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((e) => ({
      claimNo: e.claimNo,
      elementKey: e.elementKey,
      text: e.text,
      isEssential: e.isEssential,
      evidenceCount: e.evidenceCount,
      verifiedCount: e.verifiedCount,
      rejectedCount: e.rejectedCount,
    })),
  )
  const [claimText, setClaimText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function addRow() {
    const used = new Set(rows.map((r) => r.elementKey))
    const key = Array.from(KEYS).find((k) => !used.has(k)) ?? `X${rows.length}`
    setRows([
      ...rows,
      {
        claimNo: 1,
        elementKey: key,
        text: '',
        isEssential: true,
        evidenceCount: 0,
        verifiedCount: 0,
        rejectedCount: 0,
      },
    ])
  }

  /** 請求項の文を「、」「と、」で割って要件の下書きにする。あくまで下書きで、人が直す。 */
  function splitClaim() {
    const parts = claimText
      .split(/[、。]\s*/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
    if (parts.length === 0) {
      setError('請求項の文を入れてください。')
      return
    }
    setError(null)
    setRows(
      parts.slice(0, KEYS.length).map((text, i) => ({
        claimNo: 1,
        elementKey: KEYS[i] as string,
        text,
        isEssential: true,
        evidenceCount: 0,
        verifiedCount: 0,
        rejectedCount: 0,
      })),
    )
    setMessage(
      `${parts.length} 個の下書きに割りました。文の切れ目で機械的に割っただけなので、必ず人の目で直してください。`,
    )
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const cleaned = rows.filter((r) => r.text.trim().length > 0)
    if (cleaned.length === 0) {
      setError('構成要件を 1 つ以上書いてください。')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const input: ElementInput[] = cleaned.map((r, i) => ({
        claimNo: r.claimNo,
        elementKey: r.elementKey,
        text: r.text.trim(),
        isEssential: r.isEssential,
        sortOrder: i,
      }))
      await api.saveElements(matterId, input)
      const removed = initial.filter((e) => !cleaned.some((r) => r.elementKey === e.elementKey))
      const lostEvidence = removed.reduce((n, e) => n + e.evidenceCount, 0)
      setMessage(
        lostEvidence > 0
          ? `保存しました。消した構成要件に付いていた典拠 ${lostEvidence} 件も一緒に消えました。`
          : '保存しました。',
      )
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSignOut()
      setError(
        err instanceof ApiError
          ? errorMessage(err.code, err.detail)
          : '保存できませんでした。入力はそのまま残っています。',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="請求項から割る">
        <div className="flex flex-col gap-2">
          <Field
            label="請求項 1 の文"
            htmlFor="claim-text"
            hint="「、」で区切って構成要件の下書きを作ります。機械的に割るだけなので、必ず人の目で直してください。"
          >
            <TextArea
              id="claim-text"
              rows={3}
              value={claimText}
              onChange={(e) => setClaimText(e.target.value)}
              placeholder="撮像部が利用者の眼部を撮像し、前記画像から瞳孔中心を検出し、…"
            />
          </Field>
          <div>
            <Button onClick={splitClaim}>構成要件に割る</Button>
          </div>
        </div>
      </Panel>

      <Panel
        title="構成要件"
        aside={
          <span className="flex items-center gap-2">
            <Button onClick={addRow}>1 つ足す</Button>
          </span>
        }
      >
        <form onSubmit={save} className="flex flex-col gap-3">
          {rows.length === 0 && (
            <p className="border border-tk-line border-dashed px-4 py-6 text-center text-tk-body text-tk-ink-muted">
              まだ構成要件がありません。上の欄から割るか、「1 つ足す」で書いてください。
            </p>
          )}
          {rows.map((row, i) => (
            <div
              key={row.elementKey}
              className="flex items-start gap-3 border-tk-line border-b pb-3"
            >
              <Mono className="w-6 shrink-0 pt-2 font-bold text-tk-ink">{row.elementKey}</Mono>
              <div className="flex-1">
                <TextInput
                  aria-label={`構成要件 ${row.elementKey}`}
                  value={row.text}
                  onChange={(e) => {
                    const next = [...rows]
                    next[i] = { ...row, text: e.target.value }
                    setRows(next)
                  }}
                  placeholder="撮像部が利用者の眼部を撮像する"
                />
                {row.evidenceCount > 0 && (
                  <span className="mt-1 flex items-center gap-1.5">
                    <Seal kind="verified" size="sm" />
                    <Mono>{row.verifiedCount}</Mono>
                    {row.rejectedCount > 0 && (
                      <>
                        <Seal kind="rejected" size="sm" />
                        <Mono>{row.rejectedCount}</Mono>
                      </>
                    )}
                    <span className="text-tk-fine text-tk-ink-muted">
                      典拠 {row.evidenceCount} 件が付いています
                    </span>
                  </span>
                )}
              </div>
              <Button variant="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                消す
              </Button>
            </div>
          ))}
          {error && <Notice tone="rejected">{error}</Notice>}
          {message && <Notice tone="verified">{message}</Notice>}
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? '保存しています…' : '構成要件を保存する'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  )
}
