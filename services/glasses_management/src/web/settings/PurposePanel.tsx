import {
  type EquipmentKind,
  type PurposeRequirement,
  type SettingsImpactItem,
  SettingsImpactReport,
  type SkillCode,
  VisitPurpose,
} from '@app/contracts'
import { auth } from '@app/shared'
import { Button, focusRing, Notice, TextInput } from '@app/ui'
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { client } from '../client'
import { addJstDays, ImpactCard } from './ImpactCard'
import type { PanelDraft, SaveOutcome, SettingsPanelProps } from './sections'
import { toJstDay } from './sections'

/*
 * 設定 — ご来店の目的（承認済みモック docs/frontend/mockups/eyex/images/SETTINGS-PURPOSE.png）。
 *
 * この面の仕事は「所要時間を延ばした瞬間に、受けられなくなる Web 枠を数字で見せる」こと。
 * 試算（POST /api/staff/settings/impact）は何も保存しない。所要時間を変えても、
 * 既に入っているご予約の所要時間は変わらない。
 *
 * 実測値: 表 = 角 16px / 1px の縁、見出しセル padding 10px 13px・12px、本文セル padding 9px 13px、
 * グループ表の行 min-height 48px（44pt 以上）、左右 = 1.15fr / 0.85fr・gap 22px。
 * 1.15fr / 0.85fr は任意値でしか書けないので均等割りにした。
 *
 * モックに無い欄を 1 つだけ足している —「台帳に出す短い名前」。台帳の帯が 30 分幅・
 * 最小 54px しか無く、`nameInternal` では入りきらないため（`04-api.md` §4.3）。
 */

const SKILLS: readonly SkillCode[] = [
  'measure',
  'processing',
  'sales_reception',
  'fitting',
  'contact_lens',
  'repair',
]

const SKILL_LABEL: Record<SkillCode, string> = {
  measure: '視力測定',
  processing: '加工',
  sales_reception: '販売・受付',
  fitting: 'フィッティング',
  contact_lens: 'コンタクトの相談',
  repair: '修理・部品交換',
}

const KINDS: readonly EquipmentKind[] = ['measure', 'counter', 'workbench']

const KIND_LABEL: Record<EquipmentKind, string> = {
  measure: '視力測定機',
  counter: '相談カウンター',
  workbench: '加工台',
}

/** 契約の上限（`PurposeRequirementsInput`）。画面の側で越えられない形にする。 */
const MAX_KINDS = 2
/** 所要時間を延ばしたとき、何日ぶんの Web 枠を数えるか。 */
const IMPACT_DAYS = 13

type Purpose = VisitPurpose
type PurposeDraft = {
  nameShort: string
  /** 入力欄の生の値。空にできるので数値では持たない。 */
  minutes: string
  isWebPublished: boolean
  skill: SkillCode | ''
  kinds: EquipmentKind[]
}

function draftOf(purpose: Purpose): PurposeDraft {
  return {
    nameShort: purpose.nameShort,
    minutes: String(purpose.durationMinutes),
    isWebPublished: purpose.isWebPublished,
    skill:
      purpose.requirements.find((requirement) => requirement.kind === 'skill')?.value ??
      ('' as const),
    kinds: KINDS.filter((kind) =>
      purpose.requirements.some(
        (requirement) => requirement.kind === 'equipment_kind' && requirement.value === kind,
      ),
    ),
  }
}

function requirementsOf(draft: PurposeDraft): PurposeRequirement[] {
  const skill: PurposeRequirement[] =
    draft.skill === '' ? [] : [{ kind: 'skill', value: draft.skill }]
  return [
    ...skill,
    ...KINDS.filter((kind) => draft.kinds.includes(kind)).map(
      (kind): PurposeRequirement => ({ kind: 'equipment_kind', value: kind }),
    ),
  ]
}

/** 5 分の格子に載る 5〜480 分だけを通す（契約の `DurationMinutes` と同じ）。 */
function minutesOf(raw: string): number | null {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 5 || value > 480 || value % 5 !== 0) return null
  return value
}

function webLabel(isWebPublished: boolean): string {
  return isWebPublished ? '公開しています' : 'お店で受けるだけ'
}

function joinLabels(labels: readonly string[]): string {
  return labels.length === 0 ? '未指定' : labels.join('・')
}

export function PurposePanel({ storeId, now, onDraftChange }: SettingsPanelProps) {
  const at = now ?? new Date().toISOString()
  const today = toJstDay(at)

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saved, setSaved] = useState<Purpose[]>([])
  const [drafts, setDrafts] = useState<Record<string, PurposeDraft>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [webSlots, setWebSlots] = useState<SettingsImpactItem[]>([])
  const [adding, setAdding] = useState(false)
  const [newPurpose, setNewPurpose] = useState({
    nameInternal: '',
    namePublic: '',
    nameShort: '',
    minutes: '30',
    skill: '' as SkillCode | '',
    kinds: [] as EquipmentKind[],
  })

  const load = useCallback(async () => {
    const path = client.api.staff.purposes.$path()
    // 使わなくなった目的も行を消さずに出す（UC-SET-14）。`includeInactive` は Worker が
    // 生で読む query で RPC の型に現れないため、URL だけ作って投げる。
    const res = await auth.authFetch(`${path}?includeInactive=true`)
    if (!res.ok) throw new Error('purposes')
    const list = VisitPurpose.array().parse(await res.json())
    setSaved(list)
    setDrafts(Object.fromEntries(list.map((purpose) => [purpose.id, draftOf(purpose)])))
    setWebSlots([])
    setPhase('ready')
  }, [])

  useEffect(() => {
    load().catch(() => setPhase('error'))
  }, [load])

  const selected = saved.find((purpose) => purpose.id === selectedId) ?? null
  const selectedDraft = selectedId ? drafts[selectedId] : undefined

  const changes = useMemo(() => {
    const lines: string[] = []
    for (const purpose of saved) {
      const draft = drafts[purpose.id]
      if (!draft) continue
      const before = draftOf(purpose)
      if (draft.nameShort.trim() !== before.nameShort.trim()) {
        lines.push(
          `${purpose.nameInternal} の「台帳に出す短い名前」を ${before.nameShort} から ${draft.nameShort.trim() === '' ? '未入力' : draft.nameShort.trim()} に変える`,
        )
      }
      if (draft.minutes !== before.minutes) {
        lines.push(
          `${purpose.nameInternal} の「所要時間」を ${before.minutes}分 から ${draft.minutes === '' ? '未入力' : `${draft.minutes}分`} に変える`,
        )
      }
      if (draft.skill !== before.skill) {
        lines.push(
          `${purpose.nameInternal} の「必要な技能」を ${before.skill === '' ? '未指定' : SKILL_LABEL[before.skill]} から ${draft.skill === '' ? '未指定' : SKILL_LABEL[draft.skill]} に変える`,
        )
      }
      if (draft.kinds.join(',') !== before.kinds.join(',')) {
        lines.push(
          `${purpose.nameInternal} の「必要な設備・場所」を ${joinLabels(before.kinds.map((kind) => KIND_LABEL[kind]))} から ${joinLabels(draft.kinds.map((kind) => KIND_LABEL[kind]))} に変える`,
        )
      }
      if (draft.isWebPublished !== before.isWebPublished) {
        lines.push(
          `${purpose.nameInternal} の「Web予約に出す」を ${webLabel(before.isWebPublished)} から ${webLabel(draft.isWebPublished)} に変える`,
        )
      }
    }
    return lines
  }, [saved, drafts])

  /**
   * 入れた値が保存できる形かどうか。5 分の格子から外れた入力だけを止める。
   * 文は保存を拒む 2 文の型に揃える（P1 の決め #3）。
   */
  const blocked = useMemo(() => {
    for (const purpose of saved) {
      const draft = drafts[purpose.id]
      if (draft && minutesOf(draft.minutes) === null) {
        return '所要時間が 5 分の倍数ではないため保存できません。5 分から 480 分の間で、5 分きざみに直してください。'
      }
    }
    return null
  }, [saved, drafts])

  // 延ばしたときだけ数える。短くする変更は 1 枠も落とさないので投げない。
  const stretched =
    selected && selectedDraft
      ? (() => {
          const minutes = minutesOf(selectedDraft.minutes)
          return minutes !== null && minutes > selected.durationMinutes
            ? { purposeId: selected.id, minutes }
            : null
        })()
      : null

  useEffect(() => {
    if (stretched === null) {
      setWebSlots([])
      return
    }
    let alive = true
    client.api.staff.settings.impact
      .$post({
        json: {
          storeId,
          kind: 'purpose_duration',
          draft: {
            purposeId: stretched.purposeId,
            durationMinutes: stretched.minutes,
            from: today,
            to: addJstDays(today, IMPACT_DAYS),
          },
        },
      })
      .then(async (res) => {
        if (!res.ok) throw new Error('impact')
        return SettingsImpactReport.parse(await res.json())
      })
      .then((report) => {
        if (alive) setWebSlots(report.affectedWebSlots)
      })
      .catch(() => {
        if (alive) setWebSlots([])
      })
    return () => {
      alive = false
    }
  }, [storeId, today, stretched?.purposeId, stretched?.minutes, stretched === null])

  const latest = useRef({ saved, drafts, load })
  latest.current = { saved, drafts, load }

  const save = useCallback(async (): Promise<SaveOutcome> => {
    const state = latest.current
    try {
      for (const purpose of state.saved) {
        const draft = state.drafts[purpose.id]
        if (!draft) continue
        const before = draftOf(purpose)
        const minutes = minutesOf(draft.minutes)
        const fieldsChanged =
          draft.nameShort.trim() !== before.nameShort.trim() ||
          draft.minutes !== before.minutes ||
          draft.isWebPublished !== before.isWebPublished
        if (fieldsChanged) {
          if (minutes === null || draft.nameShort.trim() === '') return 'failed'
          const res = await client.api.staff.purposes[':purposeId'].$patch({
            param: { purposeId: purpose.id },
            json: {
              nameShort: draft.nameShort.trim(),
              durationMinutes: minutes,
              isWebPublished: draft.isWebPublished,
              version: purpose.version,
            },
          })
          if (res.status === 403) return 'forbidden'
          if (res.status === 409) return 'conflict'
          if (!res.ok) return 'failed'
        }
        const requirementsChanged =
          draft.skill !== before.skill || draft.kinds.join(',') !== before.kinds.join(',')
        if (requirementsChanged) {
          const res = await client.api.staff.purposes[':purposeId'].requirements.$put({
            param: { purposeId: purpose.id },
            json: { requirements: requirementsOf(draft) },
          })
          if (res.status === 403) return 'forbidden'
          if (!res.ok) return 'failed'
        }
      }
      await state.load()
      return 'saved'
    } catch {
      return 'failed'
    }
  }, [])

  const discard = useCallback(() => {
    const state = latest.current
    setDrafts(Object.fromEntries(state.saved.map((purpose) => [purpose.id, draftOf(purpose)])))
    setWebSlots([])
  }, [])

  const dangerNote =
    webSlots.length > 0 ? `受けられなくなるWeb枠が ${webSlots.length}件 あります` : null
  const changesKey = changes.join('\n')

  useEffect(() => {
    const draft: PanelDraft = {
      changes: changesKey === '' ? [] : changesKey.split('\n'),
      blocked,
      danger: webSlots.length > 0,
      dangerNote,
      save,
      discard,
    }
    onDraftChange(draft)
  }, [onDraftChange, changesKey, blocked, webSlots.length, dangerNote, save, discard])

  async function move(index: number, delta: number) {
    const next = [...saved]
    const moved = next[index]
    if (!moved) return
    next.splice(index, 1)
    next.splice(index + delta, 0, moved)
    const res = await client.api.staff.purposes.order.$put({
      json: { purposeIds: next.map((purpose) => purpose.id) },
    })
    if (!res.ok) return
    setSaved(VisitPurpose.array().parse(await res.json()))
  }

  async function addPurpose() {
    const minutes = minutesOf(newPurpose.minutes)
    if (minutes === null) return
    if (newPurpose.nameInternal.trim() === '') return
    const created = await client.api.staff.purposes.$post({
      json: {
        storeId: null,
        nameInternal: newPurpose.nameInternal.trim(),
        namePublic: newPurpose.namePublic.trim(),
        nameShort: newPurpose.nameShort.trim(),
        durationMinutes: minutes,
        sortOrder: saved.length,
      },
    })
    if (!created.ok) return
    const purpose = VisitPurpose.parse(await created.json())
    const requirements = requirementsOf({
      nameShort: newPurpose.nameShort,
      minutes: newPurpose.minutes,
      isWebPublished: true,
      skill: newPurpose.skill,
      kinds: newPurpose.kinds,
    })
    if (requirements.length > 0) {
      await client.api.staff.purposes[':purposeId'].requirements.$put({
        param: { purposeId: purpose.id },
        json: { requirements },
      })
    }
    setAdding(false)
    setNewPurpose({
      nameInternal: '',
      namePublic: '',
      nameShort: '',
      minutes: '30',
      skill: '',
      kinds: [],
    })
    await load()
  }

  const editorId = useId()
  const addId = useId()
  const shortId = useId()
  const minutesId = useId()
  const skillsId = useId()
  const kindsId = useId()
  const newInternalId = useId()
  const newPublicId = useId()
  const newShortId = useId()
  const newMinutesId = useId()
  const newSkillsId = useId()
  const newKindsId = useId()

  if (phase === 'loading')
    return (
      <p role="status" className="text-body text-ink-muted">
        ご来店の目的を読み込んでいます…
      </p>
    )
  if (phase === 'error') {
    return <Notice>ご来店の目的を読み込めませんでした。画面を開き直してください。</Notice>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-3.5">
        <h2 className="text-grid font-semibold text-ink-muted">{`ご来店の目的　${saved.length}件`}</h2>
        <p className="text-grid text-ink-muted">この順でお客様にお見せします。</p>
        <Button
          variant="ghost"
          className="ml-auto min-h-11 border border-line-strong px-4 text-body"
          onClick={() => setAdding((open) => !open)}
        >
          ＋ 目的を足す
        </Button>
      </div>

      {/* 保存を拒む 2 文は札を消すだけで終えず、必ず画面にも出す（AC-SET-05 と同じ型）。 */}
      {blocked && (
        <p role="status" className="text-grid font-semibold text-danger">
          {blocked}
        </p>
      )}

      {saved.length === 0 ? (
        <p className="text-body text-ink-muted">
          ご来店の目的がまだ登録されていません。「＋ 目的を足す」から登録します。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table aria-label="ご来店の目的" className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surface-2">
                {['目的の名前（店内）', 'お客様に見せる名前', '所要時間', 'Web予約'].map((head) => (
                  <th
                    key={head}
                    scope="col"
                    className="border-line border-b px-3 py-2.5 text-left text-note font-normal text-ink-muted"
                  >
                    {head}
                  </th>
                ))}
                <th scope="col" className="border-line border-b px-3 py-2.5">
                  <span className="sr-only">並べ替え</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {saved.map((purpose, index) => {
                const draft = drafts[purpose.id] ?? draftOf(purpose)
                const chosen = purpose.id === selectedId
                return (
                  <tr key={purpose.id} className={chosen ? 'bg-pine-soft' : ''}>
                    <th
                      scope="row"
                      className={`border-line border-b border-l-4 p-0 text-left font-normal ${
                        chosen ? 'border-l-pine' : 'border-l-transparent'
                      }`}
                    >
                      <button
                        type="button"
                        aria-pressed={chosen}
                        onClick={() => setSelectedId(purpose.id)}
                        className={`min-h-12 w-full px-3 py-2 text-left text-body font-bold text-ink ${focusRing}`}
                      >
                        {purpose.nameInternal}
                      </button>
                    </th>
                    <td className="border-line border-b px-3 py-2 text-body text-ink">
                      {purpose.namePublic}
                    </td>
                    <td className="border-line border-b px-3 py-2 font-mono text-body text-ink">
                      {`${draft.minutes}分`}
                    </td>
                    <td className="border-line border-b px-3 py-2 text-body text-ink-muted">
                      {webLabel(draft.isWebPublished)}
                    </td>
                    <td className="border-line border-b px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <MoveButton
                          label={`「${purpose.nameInternal}」を上へ`}
                          glyph="↑"
                          disabled={index === 0}
                          onClick={() => void move(index, -1)}
                        />
                        <MoveButton
                          label={`「${purpose.nameInternal}」を下へ`}
                          glyph="↓"
                          disabled={index === saved.length - 1}
                          onClick={() => void move(index, 1)}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <div>
          <p id={addId} className="mb-2.5 text-grid font-semibold text-ink-muted">
            目的を足す
          </p>
          <fieldset
            aria-labelledby={addId}
            className="grid min-w-0 max-w-2xl gap-4 rounded-card border border-line bg-surface p-4"
          >
            <StackedField htmlFor={newInternalId} label="目的の名前（店内）">
              <TextInput
                id={newInternalId}
                value={newPurpose.nameInternal}
                autoComplete="off"
                enterKeyHint="next"
                onChange={(event) =>
                  setNewPurpose((value) => ({ ...value, nameInternal: event.target.value }))
                }
              />
            </StackedField>
            <StackedField htmlFor={newPublicId} label="お客様に見せる名前">
              <TextInput
                id={newPublicId}
                value={newPurpose.namePublic}
                autoComplete="off"
                enterKeyHint="next"
                onChange={(event) =>
                  setNewPurpose((value) => ({ ...value, namePublic: event.target.value }))
                }
              />
            </StackedField>
            <StackedField htmlFor={newShortId} label="台帳に出す短い名前">
              <TextInput
                id={newShortId}
                value={newPurpose.nameShort}
                maxLength={5}
                autoComplete="off"
                enterKeyHint="next"
                onChange={(event) =>
                  setNewPurpose((value) => ({ ...value, nameShort: event.target.value }))
                }
              />
            </StackedField>
            <StackedField htmlFor={newMinutesId} label="所要時間（分）">
              <TextInput
                id={newMinutesId}
                type="number"
                inputMode="numeric"
                step={5}
                min={5}
                max={480}
                value={newPurpose.minutes}
                autoComplete="off"
                enterKeyHint="next"
                onChange={(event) =>
                  setNewPurpose((value) => ({ ...value, minutes: event.target.value }))
                }
              />
            </StackedField>
            <SkillChoice
              groupId={newSkillsId}
              name={newSkillsId}
              value={newPurpose.skill}
              onChange={(skill) => setNewPurpose((value) => ({ ...value, skill }))}
            />
            <KindChoice
              groupId={newKindsId}
              value={newPurpose.kinds}
              onChange={(kinds) => setNewPurpose((value) => ({ ...value, kinds }))}
            />
            <Button className="min-h-11" onClick={() => void addPurpose()}>
              この目的を足す
            </Button>
          </fieldset>
        </div>
      ) : (
        selected &&
        selectedDraft && (
          <div>
            <p id={editorId} className="mb-2.5 text-grid font-semibold text-ink-muted">
              編集中：{selected.nameInternal}
            </p>
            <div className="grid gap-6 md:grid-cols-2">
              <fieldset
                aria-labelledby={editorId}
                className="min-w-0 overflow-hidden rounded-card border border-line bg-surface p-0"
              >
                <FieldRow htmlFor={shortId} label="台帳に出す短い名前">
                  <TextInput
                    id={shortId}
                    value={selectedDraft.nameShort}
                    maxLength={5}
                    autoComplete="off"
                    enterKeyHint="next"
                    className="max-w-40 text-right"
                    onChange={(event) =>
                      setDrafts((all) => ({
                        ...all,
                        [selected.id]: { ...selectedDraft, nameShort: event.target.value },
                      }))
                    }
                  />
                </FieldRow>

                <FieldRow htmlFor={minutesId} label="所要時間（分）">
                  <div className="flex items-center gap-2.5">
                    {selectedDraft.minutes !== String(selected.durationMinutes) && (
                      <span className="inline-block min-h-5.5 whitespace-nowrap rounded-ctl border border-danger/40 bg-danger-soft px-2 py-px text-note font-semibold text-danger">
                        {`${selected.durationMinutes}分から変更`}
                      </span>
                    )}
                    <TextInput
                      id={minutesId}
                      type="number"
                      inputMode="numeric"
                      step={5}
                      min={5}
                      max={480}
                      value={selectedDraft.minutes}
                      autoComplete="off"
                      enterKeyHint="next"
                      className="max-w-28 text-right"
                      onChange={(event) =>
                        setDrafts((all) => ({
                          ...all,
                          [selected.id]: { ...selectedDraft, minutes: event.target.value },
                        }))
                      }
                    />
                  </div>
                </FieldRow>

                <div className="flex min-h-12 items-center gap-3 border-line border-b px-4 py-2">
                  <SkillChoice
                    groupId={skillsId}
                    name={skillsId}
                    value={selectedDraft.skill}
                    onChange={(skill) =>
                      setDrafts((all) => ({ ...all, [selected.id]: { ...selectedDraft, skill } }))
                    }
                  />
                </div>

                <div className="flex min-h-12 items-center gap-3 border-line border-b px-4 py-2">
                  <KindChoice
                    groupId={kindsId}
                    value={selectedDraft.kinds}
                    onChange={(kinds) =>
                      setDrafts((all) => ({ ...all, [selected.id]: { ...selectedDraft, kinds } }))
                    }
                  />
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={selectedDraft.isWebPublished}
                  onClick={() =>
                    setDrafts((all) => ({
                      ...all,
                      [selected.id]: {
                        ...selectedDraft,
                        isWebPublished: !selectedDraft.isWebPublished,
                      },
                    }))
                  }
                  className={`flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-body text-ink ${focusRing}`}
                >
                  <span>Web予約に出す</span>
                  <span className="ml-auto text-ink-muted">
                    {selectedDraft.isWebPublished ? '出します' : 'お店で受けるだけ'}
                  </span>
                  <SwitchGlyph on={selectedDraft.isWebPublished} />
                </button>
              </fieldset>

              <ImpactCard
                title={`${selectedDraft.minutes}分に延ばすと受けられなくなるWeb枠`}
                items={webSlots}
                tone="note"
              />
            </div>
          </div>
        )
      )}
    </div>
  )
}

/** 「必要な技能」。契約が 1 つまでなので、そもそも 2 つ選べない形にする。 */
function SkillChoice({
  groupId,
  name,
  value,
  onChange,
}: {
  groupId: string
  name: string
  value: SkillCode | ''
  onChange: (skill: SkillCode | '') => void
}) {
  return (
    <>
      <span id={groupId} className="whitespace-nowrap text-body text-ink">
        必要な技能
      </span>
      <div
        role="radiogroup"
        aria-labelledby={groupId}
        className="ml-auto flex flex-wrap justify-end gap-2.5"
      >
        {(['', ...SKILLS] as const).map((code) => (
          <Choice
            key={code === '' ? 'none' : code}
            type="radio"
            name={name}
            value={code}
            label={code === '' ? '要りません' : SKILL_LABEL[code]}
            checked={value === code}
            onChange={() => onChange(code)}
          />
        ))}
      </div>
    </>
  )
}

/** 「必要な設備・場所」。2 つ選んだら残りを押せなくして、越えられないことを文字でも言う。 */
function KindChoice({
  groupId,
  value,
  onChange,
}: {
  groupId: string
  value: readonly EquipmentKind[]
  onChange: (kinds: EquipmentKind[]) => void
}) {
  const full = value.length >= MAX_KINDS
  return (
    <>
      <span id={groupId} className="whitespace-nowrap text-body text-ink">
        必要な設備・場所
      </span>
      <fieldset
        aria-labelledby={groupId}
        className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2.5 p-0"
      >
        {KINDS.map((kind) => {
          const chosen = value.includes(kind)
          return (
            <Choice
              key={kind}
              type="checkbox"
              value={kind}
              label={KIND_LABEL[kind]}
              checked={chosen}
              disabled={!chosen && full}
              onChange={() =>
                onChange(
                  chosen
                    ? value.filter((current) => current !== kind)
                    : KINDS.filter((current) => value.includes(current) || current === kind),
                )
              }
            />
          )
        })}
        {full && (
          <p className="w-full text-right text-grid text-ink-muted">
            必要な設備・場所は 2 つまでです。
          </p>
        )}
      </fieldset>
    </>
  )
}

/** 選べる札。押せる高さは 44pt 以上。選んだかどうかは ✓ と縁の両方で分かる。 */
function Choice({
  type,
  name,
  value,
  label,
  checked,
  disabled = false,
  onChange,
}: {
  type: 'radio' | 'checkbox'
  name?: string
  value: string
  label: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <label
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-body ${
        disabled
          ? 'border-line text-ink-faint'
          : checked
            ? 'border-2 border-pine bg-pine-soft font-semibold text-pine-deep'
            : 'border-line-strong text-ink'
      }`}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="size-4"
      />
      {label}
    </label>
  )
}

function MoveButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string
  glyph: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-11 min-w-11 rounded-ctl border border-line-strong text-body text-ink disabled:border-line disabled:text-ink-faint ${focusRing}`}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  )
}

/** グループ表の 1 行。行の高さは 48px（44pt 以上）。 */
function FieldRow({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-line border-b px-4 py-2">
      <label htmlFor={htmlFor} className="whitespace-nowrap text-body text-ink">
        {label}
      </label>
      <div className="ml-auto flex justify-end">{children}</div>
    </div>
  )
}

/** 足す画面の入力。1 行に 1 つ、上に名前を置く。 */
function StackedField({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-body text-ink">
        {label}
      </label>
      {children}
    </div>
  )
}

function SwitchGlyph({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block h-8 w-13 shrink-0 rounded-full ${on ? 'bg-pine' : 'bg-busy'}`}
    >
      <span
        className={`absolute top-0.5 block size-7 rounded-circle bg-surface ${
          on ? 'left-5.5' : 'left-0.5'
        }`}
      />
    </span>
  )
}
