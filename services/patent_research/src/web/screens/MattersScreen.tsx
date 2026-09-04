import type { MatterSummary } from '@app/contracts'
import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../api'
import { Button, Field, Mono, Notice, Panel, Seal, TextInput } from '../ui/parts'
import { errorMessage, Frame } from './Frame'
import { useAsync } from './useAsync'

const STATUS_LABEL: Record<string, string> = {
  intake: '聞き取り',
  searching: '調査中',
  analyzed: '見立て',
  drafting: '起案中',
  drafted: '下書き完了',
}

export function MattersScreen({
  onOpen,
  onSignOut,
}: {
  onOpen: (id: string) => void
  onSignOut: () => void
}) {
  const state = useAsync<MatterSummary[]>(() => api.matters(), [], onSignOut)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const value = title.trim()
    if (!value) {
      setError('案件の名前を入れてください。')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await api.createMatter(value)
      setTitle('')
      onOpen(created.id)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSignOut()
      setError(
        err instanceof ApiError
          ? errorMessage(err.code, err.detail)
          : '保存できませんでした。入力はそのまま残っています。もう一度試してください。',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="新しい案件">
        <form onSubmit={onSubmit} className="flex items-end gap-3">
          <div className="flex-1">
            <Field
              label="発明の名前（仮でよい）"
              htmlFor="matter-title"
              error={error}
              hint="あとから変えられます。まず箱を作って、発明を書くところから始めます。"
            >
              <TextInput
                id="matter-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: 視線追跡による眼鏡フィッティング支援"
              />
            </Field>
          </div>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? '作っています…' : '案件を作る'}
          </Button>
        </form>
      </Panel>

      <Frame state={state} empty="まだ案件がありません。上の欄から最初の案件を作ってください。">
        {(matters) => (
          <Panel title={`案件 ${matters.length} 件`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-left">
                <thead>
                  <tr className="border-tk-line-strong border-b text-tk-note text-tk-ink-muted">
                    <th className="py-1.5 pr-3 font-bold">発明の名前</th>
                    <th className="w-24 py-1.5 pr-3 font-bold">状態</th>
                    <th className="w-24 py-1.5 pr-3 font-bold">構成要件</th>
                    <th className="w-40 py-1.5 pr-3 font-bold">典拠の照合</th>
                    <th className="w-36 py-1.5 font-bold">最終更新</th>
                  </tr>
                </thead>
                <tbody>
                  {matters.map((m) => (
                    <tr key={m.id} className="border-tk-line border-b align-baseline">
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          onClick={() => onOpen(m.id)}
                          className="text-left font-bold text-tk-heading text-tk-verified underline underline-offset-2"
                        >
                          {m.title}
                        </button>
                      </td>
                      <td className="py-2 pr-3 text-tk-data text-tk-ink-muted">
                        {STATUS_LABEL[m.status] ?? m.status}
                      </td>
                      <td className="py-2 pr-3">
                        <Mono>{m.elementCount}</Mono>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-1.5">
                          <Seal kind="verified" size="sm" />
                          <Mono>{m.verifiedCount}</Mono>
                          <Seal kind="rejected" size="sm" />
                          <Mono>{m.rejectedCount}</Mono>
                          <span className="text-tk-note text-tk-ink-muted">
                            / 全 {m.evidenceCount}
                          </span>
                        </span>
                      </td>
                      <td className="py-2">
                        <Mono className="text-tk-ink-muted">
                          {m.updatedAt.slice(0, 16).replace('T', ' ')}
                        </Mono>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {matters.some((m) => m.rejectedCount > 0) && (
              <div className="mt-3">
                <Notice tone="rejected">
                  棄却された典拠がある案件があります。AI
                  が引用したとする文が、公報の原文と食い違っていました。クレームチャートの棄却欄で中身を確かめてください。
                </Notice>
              </div>
            )}
          </Panel>
        )}
      </Frame>
    </div>
  )
}
