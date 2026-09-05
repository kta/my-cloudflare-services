import type { Draft, DraftCheck, DraftSection } from '@app/contracts'
import { ABSTRACT_MAX_CHARS, DRAFT_SECTION_HEADINGS } from '@app/contracts'
import { useState } from 'react'
import { ApiError, api } from '../api'
import { Button, Mono, Notice, Panel, TextArea } from '../ui/parts'
import { errorMessage, Frame } from './Frame'
import { useAsync } from './useAsync'

/*
 * 明細書ドラフト。
 *
 * 節は施行規則の見出しに 1:1 で対応させてある（後フェーズの様式変換器が
 * そのまま【 】見出しに写せる形）。要約は 400 字を超えると電子出願でエラーになるので、
 * 書いている最中に字数が見える。
 *
 * ここに出るのは**下書き**であり、法的助言ではない。判断は人間が行う。
 */

const ORDER: DraftSection[] = [
  'title',
  'technical_field',
  'background_art',
  'prior_art_documents',
  'problem',
  'solution',
  'advantageous_effects',
  'brief_description_of_drawings',
  'description_of_embodiments',
  'examples',
  'industrial_applicability',
  'reference_signs',
  'claims',
  'abstract',
]

const CHECK_LABEL: Record<string, string> = {
  enablement: '実施可能要件（36条4項1号）',
  support: 'サポート要件（36条6項1号）',
  clarity: '明確性要件（36条6項2号）',
  hardware_cooperation: '発明該当性（29条1項柱書・ハードウェア資源との協働）',
  abstract_length: '要約の字数（400字）',
  multi_multi: 'マルチマルチクレーム（施行規則24条の3第5号）',
  element_evidence: '全構成要件の典拠の検討',
}

export function DraftScreen({ matterId, onSignOut }: { matterId: string; onSignOut: () => void }) {
  const drafts = useAsync<Draft[]>(() => api.drafts(matterId), [matterId], onSignOut)
  const checks = useAsync<DraftCheck[]>(() => api.checks(matterId), [matterId], onSignOut)
  const [section, setSection] = useState<DraftSection>('technical_field')

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[14rem_minmax(0,1fr)_20rem]">
      <Panel title="明細書の節">
        <ol className="flex flex-col">
          {ORDER.map((s) => {
            const written = (drafts.data ?? []).find((d) => d.section === s)
            return (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => setSection(s)}
                  className={`w-full border-tk-line border-b px-2 py-1.5 text-left text-tk-body ${
                    section === s ? 'bg-tk-verified-soft font-bold text-tk-ink' : 'text-tk-ink'
                  }`}
                >
                  【{DRAFT_SECTION_HEADINGS[s]}】
                  {written ? (
                    <Mono className="ml-1 text-tk-ink-muted">第{written.revision}版</Mono>
                  ) : (
                    <span className="ml-1 text-tk-fine text-tk-ink-muted">未</span>
                  )}
                </button>
              </li>
            )
          })}
        </ol>
      </Panel>

      <Frame state={drafts}>
        {(list) => (
          <Editor
            key={section}
            matterId={matterId}
            section={section}
            initial={list.find((d) => d.section === section)?.markdown ?? ''}
            onSaved={drafts.reload}
            onSignOut={onSignOut}
          />
        )}
      </Frame>

      <Frame
        state={checks}
        empty="まだ検査していません。請求項を保存すると、マルチマルチクレームの検査が走ります。"
      >
        {(list) => (
          <Panel title="記載要件の検査">
            <ul className="flex flex-col gap-2">
              {list.map((c) => (
                <li key={c.id} className="border-tk-line border-b pb-2 last:border-b-0">
                  <p className="flex items-baseline gap-2">
                    <span
                      className={`font-bold text-tk-data ${
                        c.result === 'pass'
                          ? 'text-tk-verified'
                          : c.result === 'fail'
                            ? 'text-tk-rejected'
                            : 'text-tk-pending'
                      }`}
                    >
                      {c.result === 'pass' ? '適' : c.result === 'fail' ? '否' : '未'}
                    </span>
                    <span className="text-tk-data text-tk-ink">
                      {CHECK_LABEL[c.checkKey] ?? c.checkKey}
                    </span>
                  </p>
                  <p className="mt-0.5 text-tk-note text-tk-ink-muted leading-relaxed">
                    {c.detail}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </Frame>
    </div>
  )
}

function Editor({
  matterId,
  section,
  initial,
  onSaved,
  onSignOut,
}: {
  matterId: string
  section: DraftSection
  initial: string
  onSaved: () => void
  onSignOut: () => void
}) {
  const [markdown, setMarkdown] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const length = Array.from(markdown).length
  const overAbstract = section === 'abstract' && length > ABSTRACT_MAX_CHARS
  const shortAbstract = section === 'abstract' && length > 0 && length < 200

  async function save() {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await api.saveDraft(matterId, section, markdown)
      setSaved(true)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSignOut()
      setError(
        err instanceof ApiError
          ? err.code === 'request_failed' && section === 'abstract'
            ? `要約は ${ABSTRACT_MAX_CHARS} 字以内にしてください（いま ${length} 字）。電子出願ではこれを超えるとエラーになります。`
            : errorMessage(err.code, err.detail)
          : '保存できませんでした。入力はそのまま残っています。',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={`【${DRAFT_SECTION_HEADINGS[section]}】`}
      aside={
        <Mono className={overAbstract ? 'text-tk-rejected' : 'text-tk-ink-muted'}>
          {length} 字{section === 'abstract' ? ` / ${ABSTRACT_MAX_CHARS}` : ''}
        </Mono>
      }
    >
      <div className="flex flex-col gap-3">
        <TextArea
          aria-label={`${DRAFT_SECTION_HEADINGS[section]}の本文`}
          rows={20}
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          placeholder="Markdown で書けます。図は Mermaid のコードブロックで置けます。"
        />
        {overAbstract && (
          <Notice tone="rejected">
            要約が {ABSTRACT_MAX_CHARS} 字を超えています（{length}{' '}
            字）。電子出願ではエラーになります。
          </Notice>
        )}
        {shortAbstract && !overAbstract && (
          <Notice tone="pending">
            要約は 200〜400 字が望ましいとされています（いま {length} 字）。電子出願では 200
            字未満で警告が出ます。
          </Notice>
        )}
        {error && <Notice tone="rejected">{error}</Notice>}
        {saved && !error && (
          <Notice tone="verified">保存しました。前の版も記録に残っています。</Notice>
        )}
        <div>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? '保存しています…' : 'この節を保存する'}
          </Button>
        </div>
      </div>
    </Panel>
  )
}
