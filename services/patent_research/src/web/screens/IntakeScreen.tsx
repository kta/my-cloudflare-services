import { type FormEvent, useState } from 'react'
import { ApiError, api, type DisclosureView, type Message } from '../api'
import { Button, Field, Mono, Notice, Panel, TextArea, TextInput } from '../ui/parts'
import { errorMessage, Frame } from './Frame'
import { useAsync } from './useAsync'

/*
 * 発明を書く画面。**未出願の発明が入る、この製品で最も秘密の場所**である。
 *
 * 対話（「こんなのが欲しい」→「こういう形でしょうか？」→ OK）はここに残り、
 * 確定した内容が発明開示になる。外部 LLM へ本文を送る経路は既定で閉じてあり、
 * 開けるのは利用者が明示的に許可したときだけ。
 */

const PROVIDER_LABEL: Record<string, string> = {
  human: '人',
  'claude-code': 'Claude Code',
  gemini: 'Gemini',
  local: 'ローカル',
}

export function IntakeScreen({ matterId, onSignOut }: { matterId: string; onSignOut: () => void }) {
  const disclosure = useAsync<DisclosureView | null>(
    () => api.disclosure(matterId),
    [matterId],
    onSignOut,
  )
  const messages = useAsync<Message[]>(() => api.messages(matterId), [matterId], onSignOut)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Frame state={disclosure}>
        {(current) => (
          <DisclosureForm
            matterId={matterId}
            current={current}
            onSaved={disclosure.reload}
            onSignOut={onSignOut}
          />
        )}
      </Frame>
      {/* `empty` を渡さない。0 件のときに欄ごと消すと、最初の一言が書けなくなる。 */}
      <Frame state={messages}>
        {(list) => (
          <Panel
            title="聞き取りの記録"
            aside={<Mono className="text-tk-ink-muted">{list.length} 件</Mono>}
          >
            <MessageLog
              matterId={matterId}
              messages={list}
              onPosted={messages.reload}
              onSignOut={onSignOut}
            />
          </Panel>
        )}
      </Frame>
    </div>
  )
}

const EMPTY: DisclosureView = {
  id: '',
  matterId: '',
  revision: 0,
  problem: '',
  solution: '',
  effects: '',
  embodiments: '',
  keywords: [],
  externalLlmAllowed: false,
  createdAt: '',
}

function DisclosureForm({
  matterId,
  current,
  onSaved,
  onSignOut,
}: {
  matterId: string
  current: DisclosureView | null
  onSaved: () => void
  onSignOut: () => void
}) {
  const base = current ?? EMPTY
  const [form, setForm] = useState({
    problem: base.problem,
    solution: base.solution,
    effects: base.effects,
    embodiments: base.embodiments,
    keywords: base.keywords.join('、'),
    externalLlmAllowed: base.externalLlmAllowed,
  })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const next = await api.saveDisclosure(matterId, {
        problem: form.problem,
        solution: form.solution,
        effects: form.effects,
        embodiments: form.embodiments,
        keywords: form.keywords
          .split(/[、,\s]+/)
          .map((k) => k.trim())
          .filter((k) => k.length > 0),
        externalLlmAllowed: form.externalLlmAllowed,
      })
      setSaved(next.revision)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSignOut()
      setError(
        err instanceof ApiError
          ? errorMessage(err.code, err.detail)
          : '保存できませんでした。入力はそのまま残っています。もう一度試してください。',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="発明の中身"
      aside={
        base.revision > 0 ? (
          <Mono className="text-tk-ink-muted">第 {base.revision} 版</Mono>
        ) : (
          <span className="text-tk-note text-tk-ink-muted">まだ書かれていません</span>
        )
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field
          label="解決しようとする課題"
          htmlFor="problem"
          hint="従来のやり方で何が困るのか。ここが弱いと進歩性の議論が組み立てられません。"
        >
          <TextArea
            id="problem"
            rows={3}
            value={form.problem}
            onChange={(e) => setForm({ ...form, problem: e.target.value })}
          />
        </Field>
        <Field
          label="課題を解決するための手段"
          htmlFor="solution"
          hint="発明の中核。あとで請求項に写します。"
        >
          <TextArea
            id="solution"
            rows={4}
            value={form.solution}
            onChange={(e) => setForm({ ...form, solution: e.target.value })}
          />
        </Field>
        <Field
          label="発明の効果"
          htmlFor="effects"
          hint="有利な効果は、進歩性を肯定する方向に働きます。"
        >
          <TextArea
            id="effects"
            rows={2}
            value={form.effects}
            onChange={(e) => setForm({ ...form, effects: e.target.value })}
          />
        </Field>
        <Field
          label="実施の形態"
          htmlFor="embodiments"
          hint="実施可能要件（36条4項1号）を満たすだけの具体性を書きます。"
        >
          <TextArea
            id="embodiments"
            rows={5}
            value={form.embodiments}
            onChange={(e) => setForm({ ...form, embodiments: e.target.value })}
          />
        </Field>
        <Field
          label="検索に使う語"
          htmlFor="keywords"
          hint="読点か空白で区切ります。先行技術検索の出発点になります。"
        >
          <TextInput
            id="keywords"
            value={form.keywords}
            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
            placeholder="瞳孔、視線ベクトル、累進屈折力レンズ"
          />
        </Field>

        <div className="rounded-tk-doc border border-tk-pending bg-tk-pending-soft px-3 py-2">
          <label htmlFor="external" className="flex items-start gap-2 text-tk-body text-tk-ink">
            <input
              id="external"
              type="checkbox"
              checked={form.externalLlmAllowed}
              onChange={(e) => setForm({ ...form, externalLlmAllowed: e.target.checked })}
              className="mt-0.5"
            />
            <span className="leading-relaxed">
              この案件の本文を、外部の LLM（Gemini 等）へ送ることを許可する
              <span className="mt-0.5 block text-tk-note text-tk-pending">
                既定は禁止です。ここに書いた発明はまだ出願されていません。Claude Code
                での対話は手元で完結しますが、外部の無料枠は提供者がデータを利用しうるので、
                依頼者の秘密を扱う場合は開けないでください。
              </span>
            </span>
          </label>
        </div>

        {error && <Notice tone="rejected">{error}</Notice>}
        {saved !== null && !error && (
          <Notice tone="verified">
            第 {saved} 版として保存しました。前の版も記録に残っています。
          </Notice>
        )}
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? '保存しています…' : '発明を保存する'}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function MessageLog({
  matterId,
  messages,
  onPosted,
  onSignOut,
}: {
  matterId: string
  messages: Message[]
  onPosted: () => void
  onSignOut: () => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function post(e: FormEvent) {
    e.preventDefault()
    const content = text.trim()
    if (!content) return
    setBusy(true)
    setError(null)
    try {
      await api.postMessage(matterId, { role: 'user', content, provider: 'human' })
      setText('')
      onPosted()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSignOut()
      setError(
        err instanceof ApiError ? errorMessage(err.code, err.detail) : '記録できませんでした。',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex max-h-[26rem] flex-col gap-3 overflow-y-auto">
        {messages.map((m) => (
          <li key={m.id} className="border-tk-line border-b pb-2 last:border-b-0">
            <p className="flex items-baseline gap-2 text-tk-fine text-tk-ink-muted">
              <span className="font-bold">{m.role === 'user' ? 'こちら' : '相手'}</span>
              <span>{PROVIDER_LABEL[m.provider] ?? m.provider}</span>
              <Mono>{m.createdAt.slice(0, 16).replace('T', ' ')}</Mono>
            </p>
            <p className="mt-1 whitespace-pre-wrap text-tk-body text-tk-ink">{m.content}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={post} className="flex flex-col gap-2">
        <Field label="書き足す" htmlFor="message" error={error}>
          <TextArea
            id="message"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="こんな特許が欲しい、を書く"
          />
        </Field>
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? '記録しています…' : '記録する'}
          </Button>
        </div>
      </form>
    </div>
  )
}
