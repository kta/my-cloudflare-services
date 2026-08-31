import { Terminal } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { client } from '../client'
import type { SaveOutcome, SettingsPanelProps } from './sections'

/*
 * 「設定 › 端末の設定」。モックの無い面なので、ほかの 7 面と同じ型で作る
 * （一覧 → 1 台を直す → 器の保存バーで保存）。
 *
 * 画面の計画（DESIGN_RULE パス 1）
 *   主役は 1 画面に 1 つ ——「この 1 台をどう使うか」。直す欄は選んだ 1 台のぶんだけ出す。
 *   状態を色だけで伝えない —— 使い方は札の文字（「みんなで使う端末」「個人の端末」）で読める。
 *   空いた場所を埋めない —— 欄は 5 つ（名前・置き場所・使い方・伏せるまで・暗証番号）で終わり。
 *
 * **平文の暗証番号を残さない。**保存の本文で 1 回使い、成功しても失敗しても欄を空にする。
 * 共有端末の入力欄なので `autocomplete="off"` を全欄に置く。
 */

const KINDS: readonly { key: Terminal['kind']; label: string; note: string }[] = [
  {
    key: 'shared',
    label: 'みんなで使う端末',
    note: '次に業務を始めると、置き場所を選ぶ画面になります。',
  },
  {
    key: 'personal',
    label: '個人の端末',
    note: '次に業務を始めると、担当を選ぶ画面になります。',
  },
]

const MIN_SECONDS = 30
const MAX_SECONDS = 1800
const SECONDS_ERROR = `${MIN_SECONDS}秒から${MAX_SECONDS}秒までで決めてください。`
const PIN_ERROR = '暗証番号は4〜6桁の数字で入れてください。'
const WEAK_PIN = 'この暗証番号は簡単すぎます。同じ数字の並びと連番は使えません。'

type Form = {
  name: string
  placeNote: string
  kind: Terminal['kind']
  autoLockSeconds: string
  pin: string
}

function formOf(terminal: Terminal): Form {
  return {
    name: terminal.name,
    placeNote: terminal.placeNote,
    kind: terminal.kind,
    autoLockSeconds: String(terminal.autoLockSeconds),
    pin: '',
  }
}

export function TerminalSettings({ storeId, onDraftChange }: SettingsPanelProps) {
  const [rows, setRows] = useState<readonly Terminal[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await client.api.staff.terminals.$get({ query: { storeId } })
      if (!res.ok) {
        setError('端末を読み込めませんでした。画面を開き直してください。')
        return
      }
      const body = (await res.json()) as { items: unknown }
      setRows(Terminal.array().parse(body.items))
    } catch {
      setError('通信できませんでした。画面を開き直してください。')
    }
  }, [storeId])

  useEffect(() => {
    void load()
  }, [load])

  const editing = rows.find((row) => row.id === editingId) ?? null

  const changes = useMemo(() => {
    if (editing === null || form === null) return [] as string[]
    const list: string[] = []
    if (form.name.trim() !== editing.name) list.push(`名前を「${form.name.trim()}」にする`)
    if (form.placeNote !== editing.placeNote) list.push(`置き場所を「${form.placeNote}」にする`)
    if (form.kind !== editing.kind) {
      const label = KINDS.find((item) => item.key === form.kind)?.label ?? ''
      list.push(`使い方を「${label}」にする`)
    }
    if (form.autoLockSeconds !== String(editing.autoLockSeconds)) {
      list.push(`自動で伏せるまでを${form.autoLockSeconds}秒にする`)
    }
    if (form.pin !== '') list.push('暗証番号を作り直す')
    return list
  }, [editing, form])

  const seconds = Number(form?.autoLockSeconds ?? '')
  const secondsInvalid =
    form !== null && (!Number.isInteger(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS)
  const pinInvalid = form !== null && form.pin !== '' && !/^\d{4,6}$/.test(form.pin)
  const blocked = secondsInvalid ? SECONDS_ERROR : pinInvalid ? PIN_ERROR : null

  const save = useCallback(async (): Promise<SaveOutcome> => {
    if (editing === null || form === null) return 'failed'
    setNotice(null)
    const body = {
      version: editing.version,
      ...(form.name.trim() === editing.name ? {} : { name: form.name.trim() }),
      ...(form.placeNote === editing.placeNote ? {} : { placeNote: form.placeNote }),
      ...(form.kind === editing.kind ? {} : { kind: form.kind }),
      ...(Number(form.autoLockSeconds) === editing.autoLockSeconds
        ? {}
        : { autoLockSeconds: Number(form.autoLockSeconds) }),
      ...(form.pin === '' ? {} : { pin: form.pin }),
    }
    try {
      const res = await client.api.staff.terminals[':terminalId'].$patch({
        param: { terminalId: editing.id },
        json: body,
      })
      const status: number = res.status
      if (status === 403) return 'forbidden'
      if (status === 409) return 'conflict'
      if (status === 400) {
        const failure = (await res.json()) as { error?: string }
        setNotice(failure.error === 'weak_pin' ? WEAK_PIN : PIN_ERROR)
        return 'failed'
      }
      if (!res.ok) return 'failed'
      await load()
      setForm((prev) => (prev === null ? prev : { ...prev, pin: '' }))
      return 'saved'
    } catch {
      return 'failed'
    }
  }, [editing, form, load])

  const discard = useCallback(() => {
    setNotice(null)
    setForm(editing === null ? null : formOf(editing))
  }, [editing])

  useEffect(() => {
    onDraftChange({ changes, blocked, danger: false, dangerNote: null, save, discard })
  }, [onDraftChange, changes, blocked, save, discard])

  function startEdit(terminal: Terminal) {
    setEditingId(terminal.id)
    setForm(formOf(terminal))
    setNotice(null)
  }

  function change(patch: Partial<Form>) {
    setForm((prev) => (prev === null ? prev : { ...prev, ...patch }))
  }

  return (
    <div className="max-w-240">
      <h2 className="text-title font-bold text-ink">端末の設定</h2>
      <p className="mt-1 text-body text-ink-muted">
        この店舗の iPad の使い方・暗証番号・自動で伏せるまでの時間を決めます。
      </p>

      {error !== null && (
        <p role="status" className="mt-4 text-body text-danger">
          {error}
        </p>
      )}

      <ul aria-label="端末" className="mt-6 flex flex-col gap-3">
        {rows.map((terminal) => (
          <li
            key={terminal.id}
            className="flex items-center gap-4 rounded-panel border border-line bg-surface p-5"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-lead font-bold text-ink">{terminal.name}</span>
              <span className="mt-1 block text-note text-ink-muted">{terminal.placeNote}</span>
              <span className="mt-1.5 flex flex-wrap items-center gap-2.5 text-note">
                <span className="rounded-full border border-line-strong px-2 py-px font-semibold text-ink">
                  {KINDS.find((item) => item.key === terminal.kind)?.label}
                </span>
                <span className="text-ink-muted">{terminal.autoLockSeconds}秒でふせる</span>
                <span className="text-ink-muted">
                  {terminal.hasPin ? '暗証番号あり' : '暗証番号はまだありません'}
                </span>
              </span>
            </span>
            <button
              type="button"
              onClick={() => startEdit(terminal)}
              aria-label={`${terminal.name} を直す`}
              className={cn(
                'min-h-12 shrink-0 rounded-ctl border border-line-strong bg-surface px-4 text-body font-semibold text-ink',
                focusRing,
              )}
            >
              直す
            </button>
          </li>
        ))}
      </ul>

      {editing !== null && form !== null && (
        <section
          aria-label={`${editing.name} を直す`}
          className="mt-8 rounded-panel border border-line bg-surface p-6"
        >
          <h3 className="text-lead font-bold text-ink">{editing.name} を直す</h3>

          <label className="mt-5 block text-grid text-ink-muted" htmlFor="terminal-name">
            名前
          </label>
          <input
            id="terminal-name"
            type="text"
            autoComplete="off"
            value={form.name}
            onChange={(event) => change({ name: event.target.value })}
            className={cn(
              'mt-1 min-h-12 w-full rounded-ctl border border-line-strong bg-surface px-3 text-body',
              focusRing,
            )}
          />

          <label className="mt-4 block text-grid text-ink-muted" htmlFor="terminal-place">
            置き場所
          </label>
          <input
            id="terminal-place"
            type="text"
            autoComplete="off"
            value={form.placeNote}
            onChange={(event) => change({ placeNote: event.target.value })}
            className={cn(
              'mt-1 min-h-12 w-full rounded-ctl border border-line-strong bg-surface px-3 text-body',
              focusRing,
            )}
          />

          <fieldset className="mt-5">
            <legend className="text-grid text-ink-muted">使い方</legend>
            <div className="mt-1 flex flex-col gap-2">
              {KINDS.map((item) => (
                <label
                  key={item.key}
                  className="flex min-h-12 items-center gap-3 text-body text-ink"
                >
                  <input
                    type="radio"
                    name="terminal-kind"
                    checked={form.kind === item.key}
                    onChange={() => change({ kind: item.key })}
                    className="size-5"
                  />
                  {item.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-note text-ink-muted">
              {KINDS.find((item) => item.key === form.kind)?.note}
            </p>
          </fieldset>

          <label className="mt-5 block text-grid text-ink-muted" htmlFor="terminal-seconds">
            自動で伏せるまで（秒）
          </label>
          <input
            id="terminal-seconds"
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={MIN_SECONDS}
            max={MAX_SECONDS}
            value={form.autoLockSeconds}
            onChange={(event) => change({ autoLockSeconds: event.target.value })}
            aria-invalid={secondsInvalid}
            className={cn(
              'mt-1 min-h-12 w-40 rounded-ctl border border-line-strong bg-surface px-3 text-body',
              focusRing,
            )}
          />
          {secondsInvalid && <p className="mt-1 text-note text-danger">{SECONDS_ERROR}</p>}

          <label className="mt-5 block text-grid text-ink-muted" htmlFor="terminal-pin">
            新しい暗証番号（4〜6桁）
          </label>
          <input
            id="terminal-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={form.pin}
            onChange={(event) => change({ pin: event.target.value })}
            aria-invalid={pinInvalid}
            className={cn(
              'mt-1 min-h-12 w-40 rounded-ctl border border-line-strong bg-surface px-3 text-body',
              focusRing,
            )}
          />
          <p className="mt-1 text-note text-ink-muted">
            空のままにすると、いまの暗証番号がそのまま残ります。
          </p>
          {pinInvalid && <p className="mt-1 text-note text-danger">{PIN_ERROR}</p>}
          <p role="status" className="mt-2 text-note text-danger">
            {notice}
          </p>
        </section>
      )}
    </div>
  )
}
