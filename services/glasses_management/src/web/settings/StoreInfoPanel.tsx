import type { StoreDetail } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { client } from '../client'
import { LoadFailed } from '../shell/LoadFailed'
import { formatJstDate, ROLE_LABELS, type SaveOutcome, type SettingsPanelProps } from './sections'

/*
 * 店舗の情報（承認済みモック docs/frontend/mockups/eye/images/SETTINGS-STORE.png）。
 *
 * 実測: .cols = 1fr + 344px / gap 22px。群の見出しは margin 32px 2px 12px。
 * グループ表の行は min-height 56px。「行き方のご案内」は白い箱ではなく罫だけの行
 * （padding 16px 0 / 上に 1px --color-line、先頭行は罫なし）。
 * 紹介文のカードは本文 16px / 行高 1.8、「書き直す」は min-height 44px / padding 0 14px。
 *
 * 白い箱は 2 枚（お店の基本 / 紹介文）。空いた右下を埋めるために要素を足さない。
 * モックの `›` は出さない —— その場で直せる欄に「別の面へ行く」印を付けない。
 */

const INTRO_MAX = 200

const INTRO_TOO_LONG = '紹介文が 200 文字を超えているため保存できません。文字数を減らしてください。'

type FieldKey =
  | 'name'
  | 'namePublic'
  | 'phone'
  | 'address'
  | 'nearestStation'
  | 'accessNote'
  | 'parkingNote'

type Field = {
  key: FieldKey
  label: string
  /** 空欄を null で保存する列（`stores` の NULL 可な 3 列）。 */
  nullable: boolean
  type?: 'tel'
  mono?: boolean
}

/** 白い箱に入る 4 行。 */
const BASIC_FIELDS: readonly Field[] = [
  { key: 'name', label: '店名', nullable: false },
  { key: 'namePublic', label: 'お客様に見せる店名', nullable: true },
  { key: 'phone', label: '電話番号', nullable: false, type: 'tel', mono: true },
  { key: 'address', label: '住所', nullable: false },
]

/** 罫だけの 3 行。 */
const ACCESS_FIELDS: readonly Field[] = [
  { key: 'nearestStation', label: '最寄り駅', nullable: true },
  { key: 'accessNote', label: '出口と所要時間', nullable: false },
  { key: 'parkingNote', label: '駐車場', nullable: true },
]

const ALL_FIELDS = [...BASIC_FIELDS, ...ACCESS_FIELDS]

type Draft = Record<FieldKey, string> & { introText: string }

function toDraft(store: StoreDetail): Draft {
  return {
    name: store.name,
    namePublic: store.namePublic ?? '',
    phone: store.phone,
    address: store.address,
    nearestStation: store.nearestStation ?? '',
    accessNote: store.accessNote,
    parkingNote: store.parkingNote ?? '',
    introText: store.introText ?? '',
  }
}

export function StoreInfoPanel({ storeId, staff, onDraftChange }: SettingsPanelProps) {
  const fieldId = useId()
  const [store, setStore] = useState<StoreDetail | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [failed, setFailed] = useState(false)
  // 読み直しの合図。読み込みの useEffect の依存に入れる。
  const [reloadCount, setReloadCount] = useState(0)
  const [editingIntro, setEditingIntro] = useState(false)

  useEffect(() => {
    let alive = true
    client.api.staff.stores[':storeId']
      .$get({ param: { storeId } })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        return (await res.json()) as StoreDetail
      })
      .then((loaded) => {
        if (!alive) return
        setStore(loaded)
        setDraft(toDraft(loaded))
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [storeId, reloadCount])

  const changes = useMemo(() => {
    if (!store || !draft) return []
    const base = toDraft(store)
    const lines: string[] = []
    for (const field of ALL_FIELDS) {
      if (draft[field.key] !== base[field.key])
        lines.push(changeLine(field.label, base[field.key], draft[field.key]))
    }
    if (draft.introText !== base.introText)
      lines.push(changeLine('紹介文', base.introText, draft.introText))
    return lines
  }, [store, draft])

  const introLength = draft ? [...draft.introText].length : 0
  const blocked = introLength > INTRO_MAX ? INTRO_TOO_LONG : null

  const save = useCallback(async (): Promise<SaveOutcome> => {
    if (!store || !draft) return 'failed'
    const base = toDraft(store)
    const patch: Record<string, string | null> = {}
    for (const field of ALL_FIELDS) {
      if (draft[field.key] === base[field.key]) continue
      patch[field.key] = field.nullable && draft[field.key] === '' ? null : draft[field.key]
    }
    if (draft.introText !== base.introText)
      patch.introText = draft.introText === '' ? null : draft.introText

    const res = await client.api.staff.stores[':storeId'].$patch({
      param: { storeId },
      // biome-ignore lint/suspicious/noExplicitAny: 送るのは StorePatch の部分集合で、鍵は ALL_FIELDS に閉じている
      json: { ...patch, version: store.settingsVersion } as any,
    })
    const status: number = res.status
    if (status === 403) return 'forbidden'
    if (status === 409) return 'conflict'
    if (!res.ok) return 'failed'
    const saved = (await res.json()) as StoreDetail
    setStore(saved)
    setDraft(toDraft(saved))
    setEditingIntro(false)
    return 'saved'
  }, [draft, store, storeId])

  const discard = useCallback(() => {
    if (store) setDraft(toDraft(store))
    setEditingIntro(false)
  }, [store])

  useEffect(() => {
    onDraftChange({ changes, blocked, danger: false, dangerNote: null, save, discard })
  }, [onDraftChange, changes, blocked, save, discard])

  if (failed)
    return (
      <LoadFailed
        what="店舗の情報"
        onRetry={() => {
          setFailed(false)
          setReloadCount((n) => n + 1)
        }}
      />
    )
  if (!store || !draft)
    return (
      <p role="status" className="text-body text-ink-muted">
        店舗の情報を読み込んでいます…
      </p>
    )

  const set = (key: keyof Draft, value: string) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))

  const editedBy = staff?.find((member) => member.id === store.updatedBy)

  return (
    <div>
      <div className="flex flex-wrap gap-5.5">
        <div className="min-w-0 flex-1">
          <fieldset className="min-w-0">
            <Legend>お店の基本</Legend>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {BASIC_FIELDS.map((field) => (
                <div
                  key={field.key}
                  className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 last:border-b-0"
                >
                  <Row field={field} id={`${fieldId}-${field.key}`} />
                  <input
                    id={`${fieldId}-${field.key}`}
                    value={draft[field.key]}
                    onChange={(e) => set(field.key, e.target.value)}
                    type={field.type ?? 'text'}
                    inputMode={field.type === 'tel' ? 'numeric' : undefined}
                    autoComplete="off"
                    enterKeyHint="next"
                    className={cn(
                      'min-h-11 w-full min-w-0 rounded-ctl bg-surface px-2 text-right text-body text-ink',
                      field.mono && 'font-mono',
                      focusRing,
                    )}
                  />
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-8 min-w-0">
            <Legend>行き方のご案内</Legend>
            {ACCESS_FIELDS.map((field, index) => (
              <div
                key={field.key}
                className="flex min-h-14 items-center gap-3 border-t border-line py-4 first:border-t-0"
              >
                <Row field={field} id={`${fieldId}-${field.key}`} />
                <input
                  id={`${fieldId}-${field.key}`}
                  value={draft[field.key]}
                  onChange={(e) => set(field.key, e.target.value)}
                  autoComplete="off"
                  enterKeyHint={index === ACCESS_FIELDS.length - 1 ? 'done' : 'next'}
                  className={cn(
                    'min-h-11 w-full min-w-0 rounded-ctl bg-transparent px-2 text-right text-body text-ink',
                    focusRing,
                  )}
                />
              </div>
            ))}
          </fieldset>
        </div>

        <div className="w-86 shrink-0">
          <p className="mt-0 mb-3 px-0.5 text-grid font-semibold text-ink-muted">
            お客様に見せる紹介文
          </p>
          <div className="rounded-panel border border-line bg-surface px-5.5 py-5">
            {editingIntro ? (
              <textarea
                id={`${fieldId}-introText`}
                aria-label="お客様に見せる紹介文"
                value={draft.introText}
                onChange={(e) => set('introText', e.target.value)}
                autoComplete="off"
                rows={6}
                className={cn(
                  'w-full rounded-ctl border border-line bg-surface px-3 py-2 text-body leading-loose text-ink',
                  focusRing,
                )}
              />
            ) : (
              <p className="text-body leading-loose text-ink">{draft.introText}</p>
            )}
            <div className="mt-5 flex items-center gap-2.5">
              <span
                className={cn(
                  'text-grid',
                  introLength > INTRO_MAX ? 'font-semibold text-danger' : 'text-ink-muted',
                )}
              >
                {introLength}文字／{INTRO_MAX}文字まで
              </span>
              <button
                type="button"
                onClick={() => setEditingIntro(true)}
                className={cn(
                  'ml-auto min-h-11 rounded-ctl border border-line-strong bg-surface px-3.5 text-body font-semibold text-ink',
                  focusRing,
                )}
              >
                書き直す
              </button>
            </div>
          </div>

          {blocked && (
            <p role="status" className="mt-3 text-grid font-semibold text-danger">
              {blocked}
            </p>
          )}

          {store.updatedAt && (
            <p className="mt-7 px-0.5 text-grid text-ink-muted">
              最後に直したのは {formatJstDate(store.updatedAt)}
              {editedBy &&
                `　${editedBy.displayName}（${editedBy.jobLabel ?? ROLE_LABELS[editedBy.role]}）`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ field, id }: { field: Field; id: string }) {
  return (
    <label htmlFor={id} className="shrink-0 whitespace-nowrap text-body text-ink">
      {field.label}
    </label>
  )
}

/** 群の見出し（モックの `.groupname` = margin 32px 2px 12px / 13px 600）。 */
/*
 * グループの見出し。**上の余白は `<legend>` に置かない。**
 * `<legend>` は fieldset の枠の中に据わる要素で、`margin-top` が前の fieldset を
 * 押しのけない。そのため「行き方のご案内」の見出しは、上のカードの下辺と
 * **余白ゼロで接していた**（実測 428.5px で一致。UX 監査 J-04）。
 * 上の余白はグループの器（fieldset）のほうに置く。
 */
function Legend({ className, children }: { className?: string; children: string }) {
  return (
    <legend className={cn('mb-3 px-0.5 text-grid font-semibold text-ink-muted', className)}>
      {children}
    </legend>
  )
}

/** EX-PERMISSION の「下書きは残っています」に並べる 1 行。 */
function changeLine(label: string, before: string, after: string): string {
  const shown = (value: string) => (value === '' ? '（未入力）' : value)
  return `${label}を ${shown(before)} から ${shown(after)} に変える`
}
