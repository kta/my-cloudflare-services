import { type Terminal, Terminal as TerminalSchema } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { domainFetch } from '../client'
import type { SaveOutcome, SettingsPanelProps } from './sections'

type Draft = {
  name: string
  placeNote: string
  kind: 'personal' | 'shared'
  autoLockSeconds: number
  pin: string
}

const toDraft = (terminal: Terminal): Draft => ({
  name: terminal.name,
  placeNote: terminal.placeNote ?? '',
  kind: terminal.kind,
  autoLockSeconds: terminal.autoLockSeconds,
  pin: '',
})

const newDraft = (): Draft => ({
  name: '',
  placeNote: '',
  kind: 'shared',
  autoLockSeconds: 120,
  pin: '',
})

export function TerminalPanel({ storeId, onDraftChange }: SettingsPanelProps) {
  const [terminals, setTerminals] = useState<Terminal[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [creating, setCreating] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const selected = terminals.find((terminal) => terminal.id === selectedId) ?? null

  useEffect(() => {
    let live = true
    domainFetch(`/api/staff/terminals?storeId=${encodeURIComponent(storeId)}&includeInactive=true`)
      .then(async (response) => {
        if (!response.ok) throw new Error('terminals')
        return TerminalSchema.array().parse(await response.json())
      })
      .then((rows) => {
        if (!live) return
        setTerminals(rows)
        setSelectedId(rows[0]?.id ?? null)
        setDraft(rows[0] ? toDraft(rows[0]) : newDraft())
        setCreating(rows.length === 0)
        setLoaded(true)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [storeId])

  const changes = useMemo(() => {
    if (!draft) return []
    if (creating) return draft.name.trim() === '' ? [] : [`新しい端末：${draft.name.trim()}`]
    if (!selected) return []
    const lines: string[] = []
    if (draft.name !== selected.name) lines.push(`端末名：${selected.name} → ${draft.name}`)
    if (draft.placeNote !== (selected.placeNote ?? ''))
      lines.push(`置き場所：${selected.placeNote ?? '未設定'} → ${draft.placeNote || '未設定'}`)
    if (draft.kind !== selected.kind)
      lines.push(
        `使い方：${selected.kind === 'shared' ? '共有' : '個人'} → ${draft.kind === 'shared' ? '共有' : '個人'}`,
      )
    if (draft.autoLockSeconds !== selected.autoLockSeconds)
      lines.push(`自動で伏せるまで：${selected.autoLockSeconds}秒 → ${draft.autoLockSeconds}秒`)
    if (draft.pin !== '') lines.push('暗証番号：新しい番号へ作り直す')
    return lines
  }, [creating, draft, selected])

  const blocked =
    draft === null
      ? null
      : draft.name.trim() === ''
        ? '端末名を入力してください。'
        : draft.pin !== '' && !/^\d{4,6}$/.test(draft.pin)
          ? '暗証番号は4〜6桁の数字にしてください。'
          : creating && draft.kind === 'shared' && draft.pin === ''
            ? '共有端末の最初の暗証番号を入力してください。'
            : null

  const save = useCallback(async (): Promise<SaveOutcome> => {
    if (!draft || (!creating && !selected)) return 'failed'
    const response = await domainFetch(
      creating
        ? `/api/staff/terminals?storeId=${encodeURIComponent(storeId)}`
        : `/api/staff/terminals/${selected?.id ?? ''}`,
      {
        method: creating ? 'POST' : 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: draft.name.trim(),
          placeNote: draft.placeNote.trim(),
          kind: draft.kind,
          autoLockSeconds: draft.autoLockSeconds,
          ...(draft.pin === '' ? {} : { pin: draft.pin }),
          ...(creating ? {} : { version: selected?.version }),
        }),
      },
    )
    if (response.status === 403) return 'forbidden'
    if (response.status === 409) return 'conflict'
    if (!response.ok) return 'failed'
    const saved = TerminalSchema.parse(await response.json())
    window.dispatchEvent(new CustomEvent('eye:terminal-updated', { detail: saved }))
    setTerminals((rows) =>
      creating ? [...rows, saved] : rows.map((row) => (row.id === saved.id ? saved : row)),
    )
    setSelectedId(saved.id)
    setCreating(false)
    setDraft(toDraft(saved))
    return 'saved'
  }, [creating, draft, selected, storeId])

  const discard = useCallback(() => {
    if (creating) {
      const first = terminals[0]
      setCreating(first === undefined)
      setSelectedId(first?.id ?? null)
      setDraft(first ? toDraft(first) : newDraft())
    } else if (selected) {
      setDraft(toDraft(selected))
    }
  }, [creating, selected, terminals])

  useEffect(() => {
    onDraftChange({ changes, blocked, danger: false, dangerNote: null, save, discard })
  }, [blocked, changes, discard, onDraftChange, save])

  if (failed)
    return (
      <p role="alert" className="text-body text-danger">
        端末を読み込めませんでした。
      </p>
    )
  if (!loaded || !draft)
    return (
      <p role="status" className="text-body text-ink-muted">
        端末を読み込んでいます…
      </p>
    )

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <aside className="w-full shrink-0 xl:w-72">
        <h3 className="mb-3 text-grid font-semibold text-ink-muted">この店舗の端末</h3>
        <div className="grid gap-2">
          {terminals.map((terminal) => (
            <button
              key={terminal.id}
              type="button"
              onClick={() => {
                setCreating(false)
                setSelectedId(terminal.id)
                setDraft(toDraft(terminal))
              }}
              className={cn(
                'min-h-16 rounded-card border px-4 text-left',
                terminal.id === selected?.id
                  ? 'border-pine bg-pine-soft'
                  : 'border-line bg-surface',
                focusRing,
              )}
            >
              <span className="block text-body font-bold">{terminal.name}</span>
              <span className="mt-1 block text-grid text-ink-muted">
                {terminal.kind === 'shared' ? '共有' : '個人'}　
                {terminal.isOnline ? '接続中' : '未接続'}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCreating(true)
              setSelectedId(null)
              setDraft(newDraft())
            }}
            className={cn(
              'min-h-12 rounded-card border border-line-strong bg-surface px-4 text-left text-body font-semibold text-pine',
              focusRing,
            )}
          >
            端末を追加
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 rounded-panel border border-line bg-surface p-6">
        <h3 className="text-lead font-bold">{creating ? '新しい端末' : '端末の設定'}</h3>
        <div className="mt-5 grid gap-5">
          <label className="grid gap-2 text-body font-semibold">
            端末名
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              autoComplete="off"
              className={`min-h-12 rounded-ctl border border-line px-3 font-normal ${focusRing}`}
            />
          </label>
          <label className="grid gap-2 text-body font-semibold">
            置き場所
            <input
              value={draft.placeNote}
              onChange={(event) => setDraft({ ...draft, placeNote: event.target.value })}
              autoComplete="off"
              maxLength={40}
              className={`min-h-12 rounded-ctl border border-line px-3 font-normal ${focusRing}`}
            />
          </label>
          <label className="grid gap-2 text-body font-semibold">
            使い方
            <select
              value={draft.kind}
              onChange={(event) =>
                setDraft({ ...draft, kind: event.target.value as Draft['kind'] })
              }
              className={`min-h-12 rounded-ctl border border-line bg-surface px-3 font-normal ${focusRing}`}
            >
              <option value="shared">みんなで使う端末</option>
              <option value="personal">個人の端末</option>
            </select>
          </label>
          <label className="grid gap-2 text-body font-semibold">
            自動で伏せるまで
            <select
              value={String(draft.autoLockSeconds)}
              onChange={(event) =>
                setDraft({ ...draft, autoLockSeconds: Number(event.target.value) })
              }
              className={`min-h-12 rounded-ctl border border-line bg-surface px-3 font-normal ${focusRing}`}
            >
              <option value="30">30秒</option>
              <option value="60">1分</option>
              <option value="120">2分</option>
              <option value="300">5分</option>
              <option value="600">10分</option>
              <option value="1800">30分</option>
            </select>
          </label>
          <label className="grid gap-2 text-body font-semibold">
            新しい暗証番号
            <input
              type="password"
              value={draft.pin}
              onChange={(event) => setDraft({ ...draft, pin: event.target.value })}
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              placeholder={creating ? '最初の暗証番号' : '変えないときは空欄'}
              className={`min-h-12 rounded-ctl border border-line px-3 font-normal ${focusRing}`}
            />
          </label>
          {blocked && (
            <p role="status" className="text-body text-danger">
              {blocked}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
