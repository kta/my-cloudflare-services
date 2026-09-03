import {
  Equipment,
  type EquipmentKind,
  EquipmentMaintenance,
  type SettingsImpactItem,
  SettingsImpactReport,
  StoreDetail,
} from '@app/contracts'
import { auth } from '@app/shared'
import { Button, focusRing, Notice, Select, TextInput } from '@app/ui'
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { client } from '../client'
import { LoadFailed } from '../shell/LoadFailed'
import { addJstDays, formatJstRange, ImpactCard, jstInstant, jstTimeOf } from './ImpactCard'
import type { PanelDraft, SaveOutcome, SettingsPanelProps } from './sections'
import { toJstDay } from './sections'

/*
 * 設定 — 設備と点検（承認済みモック docs/frontend/mockups/eyex/images/SETTINGS-EQUIPMENT.png）。
 *
 * この面の仕事は「1 台を止める前に、止めると困るご予約を数えて見せる」こと。
 * 試算（POST /api/staff/settings/impact）は何も保存しない。保存しても担当・設備の
 * 割り当ては自動で付け替えない（お客様に伝えた担当が黙って変わるため）。
 *
 * 実測値: 表 = 角 16px / 1px の縁、見出しセル padding 10px 13px・12px、
 * 本文セル padding 9px 13px、グループ表の行 min-height 48px（44pt 以上）、
 * 左右 = 1.1fr / 0.9fr・gap 24px。1.1fr / 0.9fr は任意値でしか書けないので均等割りにした。
 */

const KIND_LABEL: Record<EquipmentKind, string> = {
  measure: '視力測定機',
  counter: '相談カウンター',
  workbench: '加工台',
}

/** 種別ごとの既定の役目。契約は `roleLabel` を必須にするが、足す画面は名前と種別しか聞かない。 */
const KIND_ROLE: Record<EquipmentKind, string> = {
  measure: '視力測定',
  counter: '接客・ご相談',
  workbench: '加工',
}

const LEDGER_LABEL: Record<Equipment['ledgerDisplay'], string> = {
  grey: '灰色にして残す',
  hide: '出さない',
}

/** 「いま使える」を切ったとき、止める期間が無ければこの先何日ぶんを数えるか。 */
const STOP_HORIZON_DAYS = 14
/** 「次の点検」を引く範囲。契約の上限が 92 日。 */
const MAINTENANCE_DAYS = 92

type Unit = Equipment
type Window = EquipmentMaintenance
type UnitDraft = { isActive: boolean; inactiveReason: string; ledgerDisplay: Unit['ledgerDisplay'] }
/** 「止める期間」。日付 1 つ + 開始・終了の時刻（点検が日をまたぐ前提は置かない）。 */
type WindowDraft = { date: string; from: string; to: string }

const EMPTY_WINDOW: WindowDraft = { date: '', from: '', to: '' }

function unitDraftOf(unit: Unit): UnitDraft {
  return {
    isActive: unit.isActive,
    inactiveReason: unit.inactiveReason ?? '',
    ledgerDisplay: unit.ledgerDisplay,
  }
}

/** その設備のこれからの点検のうち、いちばん近いもの。いま進行中のものも含む。 */
function nextWindow(windows: readonly Window[], now: string): Window | null {
  return (
    [...windows]
      .filter((row) => row.endsAt > now)
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))[0] ?? null
  )
}

function windowDraftOf(window: Window | null): WindowDraft {
  if (!window) return EMPTY_WINDOW
  return {
    date: toJstDay(window.startsAt),
    from: jstTimeOf(window.startsAt),
    to: jstTimeOf(window.endsAt),
  }
}

function isComplete(draft: WindowDraft): boolean {
  return draft.date !== '' && draft.from !== '' && draft.to !== ''
}

/** 途中まで入っている状態。保存できないので、何を足せばよいかを画面で言う。 */
function isPartial(draft: WindowDraft): boolean {
  const filled = [draft.date, draft.from, draft.to].filter((value) => value !== '').length
  return filled > 0 && filled < 3
}

function windowText(draft: WindowDraft): string {
  return isComplete(draft) ? `${draft.date} ${draft.from}–${draft.to}` : '未定'
}

/**
 * 表示のまとめ（決め #9）。`kind` と `roleLabel` が同じで、名前が「同じ前置き +
 * 末尾の連番」だけ違う 2 行以上を 1 行にする。1 台しか無い行はまとめない。
 */
type Row = { key: string; label: string; members: Unit[] }

const SERIAL = /^(.*?)[\s　]*(\d+)$/

function groupUnits(units: readonly Unit[]): Row[] {
  const buckets = new Map<string, Unit[]>()
  const order: string[] = []
  for (const unit of units) {
    const serial = SERIAL.exec(unit.name)
    const key = serial ? `${unit.kind}|${unit.roleLabel}|${serial[1]}` : `solo:${unit.id}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(unit)
    else {
      buckets.set(key, [unit])
      order.push(key)
    }
  }
  return order.flatMap((key) => {
    const members = buckets.get(key) ?? []
    const head = members[0]
    if (!head) return []
    if (members.length === 1) return [{ key, label: head.name, members }]
    const prefix = SERIAL.exec(head.name)?.[1] ?? head.name
    const numbers = members.map((member) => SERIAL.exec(member.name)?.[2] ?? member.name)
    return [{ key, label: `${prefix} ${numbers.join('・')}`, members }]
  })
}

export function EquipmentPanel({ storeId, now, onDraftChange }: SettingsPanelProps) {
  const at = now ?? new Date().toISOString()
  const today = toJstDay(at)

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  // 読み直しの合図。読み込みの useEffect の依存に入れる。
  const [reloadCount, setReloadCount] = useState(0)
  const [saved, setSaved] = useState<Unit[]>([])
  const [windows, setWindows] = useState<Record<string, Window[]>>({})
  const [version, setVersion] = useState(0)
  const [unitDrafts, setUnitDrafts] = useState<Record<string, UnitDraft>>({})
  const [windowDrafts, setWindowDrafts] = useState<Record<string, WindowDraft>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [impact, setImpact] = useState<SettingsImpactItem[]>([])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<EquipmentKind>('measure')

  const load = useCallback(async () => {
    const [detail, list] = await Promise.all([
      client.api.staff.stores[':storeId'].$get({ param: { storeId } }).then(async (res) => {
        if (!res.ok) throw new Error('store')
        return StoreDetail.parse(await res.json())
      }),
      (async () => {
        const path = client.api.staff.stores[':storeId'].equipment.$path({ param: { storeId } })
        // 止めた設備の行を消さないので、`includeInactive` を必ず付ける（AC-SET-13）。
        // この query は Worker が生で読んでいて RPC の型に現れないため、URL だけ作る。
        const res = await auth.authFetch(`${path}?includeInactive=true`)
        if (!res.ok) throw new Error('equipment')
        return Equipment.array().parse(await res.json())
      })(),
    ])
    const perUnit = await Promise.all(
      list.map(async (unit) => {
        const res = await client.api.staff.stores[':storeId'].equipment[
          ':equipmentId'
        ].maintenance.$get({
          param: { storeId, equipmentId: unit.id },
          query: { from: today, to: addJstDays(today, MAINTENANCE_DAYS) },
        })
        if (!res.ok) throw new Error('maintenance')
        return [unit.id, EquipmentMaintenance.array().parse(await res.json())] as const
      }),
    )
    const byUnit = Object.fromEntries(perUnit)
    setSaved(list)
    setWindows(byUnit)
    setVersion(detail.settingsVersion)
    setUnitDrafts(Object.fromEntries(list.map((unit) => [unit.id, unitDraftOf(unit)])))
    setWindowDrafts(
      Object.fromEntries(
        list.map((unit) => [unit.id, windowDraftOf(nextWindow(byUnit[unit.id] ?? [], at))]),
      ),
    )
    setImpact([])
    setPhase('ready')
  }, [storeId, today, at])

  useEffect(() => {
    load().catch(() => setPhase('error'))
  }, [load, reloadCount])

  const rows = useMemo(() => groupUnits(saved), [saved])
  const selected = saved.find((unit) => unit.id === selectedId) ?? null
  const selectedRow = rows.find((row) => row.members.some((member) => member.id === selectedId))
  const selectedDraft = selectedId ? unitDrafts[selectedId] : undefined
  const selectedWindow = selectedId ? (windowDrafts[selectedId] ?? EMPTY_WINDOW) : EMPTY_WINDOW

  /** 「いまの状態」。止めていること・点検で止まることを必ず文字で言う。 */
  const stateOf = useCallback(
    (row: Row): string => {
      const stopped = row.members.filter((member) => unitDrafts[member.id]?.isActive === false)
      const underMaintenance = row.members.some((member) => {
        const window = nextWindow(windows[member.id] ?? [], at)
        if (window === null) return false
        return toJstDay(window.startsAt) <= today && today <= toJstDay(window.endsAt)
      })
      const head = row.members[0]
      if (row.members.length === 1 && head) {
        const draft = unitDrafts[head.id]
        if (draft && !draft.isActive) {
          const reason = draft.inactiveReason.trim()
          return reason === '' ? '止めています' : `${reason}で止めています`
        }
        return underMaintenance ? '点検のため止めます' : '使えます'
      }
      if (stopped.length === 0) return underMaintenance ? '点検のため止めます' : '使えます'
      return `${row.members.length}台のうち${stopped.length}台を止めています`
    },
    [unitDrafts, windows, at, today],
  )

  /** 「次の点検」。予定は日付と時刻まで出す。 */
  const maintenanceOf = useCallback(
    (row: Row): string => {
      const upcoming = row.members
        .flatMap((member) => windows[member.id] ?? [])
        .filter((window) => window.endsAt > at)
        .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))[0]
      return upcoming ? formatJstRange(upcoming.startsAt, upcoming.endsAt) : '予定はありません'
    },
    [windows, at],
  )

  const changes = useMemo(() => {
    const lines: string[] = []
    for (const unit of saved) {
      const draft = unitDrafts[unit.id]
      if (!draft) continue
      const before = unitDraftOf(unit)
      if (draft.isActive !== before.isActive) {
        lines.push(
          `${unit.name} の「いま使える」を ${label(before.isActive)} から ${label(draft.isActive)} に変える`,
        )
      }
      if (draft.inactiveReason.trim() !== before.inactiveReason.trim()) {
        lines.push(
          `${unit.name} の「止める理由」を ${text(before.inactiveReason)} から ${text(draft.inactiveReason)} に変える`,
        )
      }
      if (draft.ledgerDisplay !== before.ledgerDisplay) {
        lines.push(
          `${unit.name} の「台帳に出す」を ${LEDGER_LABEL[before.ledgerDisplay]} から ${LEDGER_LABEL[draft.ledgerDisplay]} に変える`,
        )
      }
      const window = windowDrafts[unit.id] ?? EMPTY_WINDOW
      const savedWindow = windowDraftOf(nextWindow(windows[unit.id] ?? [], at))
      if (isComplete(window) && windowText(window) !== windowText(savedWindow)) {
        lines.push(
          `${unit.name} の「止める期間」を ${windowText(savedWindow)} から ${windowText(window)} に変える`,
        )
      }
    }
    return lines
  }, [saved, unitDrafts, windowDrafts, windows, at])

  /** 「いま使える」を切ったときに数える期間。止める期間があればその帯を使う。 */
  const stopRange = useCallback(
    (unitId: string) => {
      const window = windowDrafts[unitId] ?? EMPTY_WINDOW
      if (isComplete(window)) {
        return {
          startsAt: jstInstant(window.date, window.from),
          endsAt: jstInstant(window.date, window.to),
        }
      }
      return { startsAt: at, endsAt: jstInstant(addJstDays(today, STOP_HORIZON_DAYS), '00:00') }
    },
    [windowDrafts, at, today],
  )

  // 「使えていたものを切った」ときだけ数える。もともと止まっているものは数えない。
  const stopping =
    selected?.isActive === true && selectedDraft?.isActive === false ? selected.id : null
  const range = stopping ? stopRange(stopping) : null
  const rangeKey = range ? `${range.startsAt}/${range.endsAt}` : ''

  useEffect(() => {
    if (stopping === null || range === null) {
      setImpact([])
      return
    }
    let alive = true
    client.api.staff.settings.impact
      .$post({
        json: {
          storeId,
          kind: 'equipment_stop',
          draft: { equipmentId: stopping, startsAt: range.startsAt, endsAt: range.endsAt },
        },
      })
      .then(async (res) => {
        if (!res.ok) throw new Error('impact')
        return SettingsImpactReport.parse(await res.json())
      })
      .then((report) => {
        if (alive) setImpact(report.affectedReservations)
      })
      .catch(() => {
        if (alive) setImpact([])
      })
    return () => {
      alive = false
    }
    // range は rangeKey から一意に決まる（毎描画で作り直しても投げ直さない）。
  }, [storeId, stopping, rangeKey, range?.startsAt, range?.endsAt])

  const latest = useRef({ saved, unitDrafts, windowDrafts, windows, version, at, load })
  latest.current = { saved, unitDrafts, windowDrafts, windows, version, at, load }

  const save = useCallback(async (): Promise<SaveOutcome> => {
    const state = latest.current
    let nextVersion = state.version
    try {
      for (const unit of state.saved) {
        const draft = state.unitDrafts[unit.id]
        if (!draft) continue
        const before = unitDraftOf(unit)
        const same =
          draft.isActive === before.isActive &&
          draft.inactiveReason.trim() === before.inactiveReason.trim() &&
          draft.ledgerDisplay === before.ledgerDisplay
        if (same) continue
        const res = await client.api.staff.stores[':storeId'].equipment[':equipmentId'].$patch({
          param: { storeId, equipmentId: unit.id },
          json: {
            isActive: draft.isActive,
            inactiveReason: draft.inactiveReason.trim() === '' ? null : draft.inactiveReason.trim(),
            ledgerDisplay: draft.ledgerDisplay,
            version: nextVersion,
          },
        })
        if (res.status === 403) return 'forbidden'
        if (res.status === 409) return 'conflict'
        if (!res.ok) return 'failed'
        // 1 文ごとに店舗の版が 1 上がる。次の文はその版で守る。
        nextVersion += 1
      }
      for (const unit of state.saved) {
        const window = state.windowDrafts[unit.id] ?? EMPTY_WINDOW
        const savedWindow = windowDraftOf(nextWindow(state.windows[unit.id] ?? [], state.at))
        if (!isComplete(window) || windowText(window) === windowText(savedWindow)) continue
        const res = await client.api.staff.stores[':storeId'].equipment[
          ':equipmentId'
        ].maintenance.$post({
          param: { storeId, equipmentId: unit.id },
          json: {
            startsAt: jstInstant(window.date, window.from),
            endsAt: jstInstant(window.date, window.to),
            note: null,
          },
        })
        if (res.status === 403) return 'forbidden'
        if (!res.ok) return 'failed'
      }
      await state.load()
      return 'saved'
    } catch {
      return 'failed'
    }
  }, [storeId])

  const discard = useCallback(() => {
    const state = latest.current
    setUnitDrafts(Object.fromEntries(state.saved.map((unit) => [unit.id, unitDraftOf(unit)])))
    setWindowDrafts(
      Object.fromEntries(
        state.saved.map((unit) => [
          unit.id,
          windowDraftOf(nextWindow(state.windows[unit.id] ?? [], state.at)),
        ]),
      ),
    )
    setImpact([])
  }, [])

  const dangerNote =
    impact.length > 0 ? `止めると影響するご予約が ${impact.length}件 あります` : null
  const changesKey = changes.join('\n')

  useEffect(() => {
    const draft: PanelDraft = {
      changes: changesKey === '' ? [] : changesKey.split('\n'),
      blocked: null,
      danger: impact.length > 0,
      dangerNote,
      save,
      discard,
    }
    onDraftChange(draft)
  }, [onDraftChange, changesKey, impact.length, dangerNote, save, discard])

  async function addUnit() {
    const name = newName.trim()
    if (name === '') return
    const res = await client.api.staff.stores[':storeId'].equipment.$post({
      param: { storeId },
      json: { name, kind: newKind, roleLabel: KIND_ROLE[newKind], sortOrder: saved.length },
    })
    if (!res.ok) return
    setAdding(false)
    setNewName('')
    setNewKind('measure')
    await load()
  }

  const editorId = useId()
  const addId = useId()
  const reasonId = useId()
  const ledgerId = useId()
  const dateId = useId()
  const fromId = useId()
  const toId = useId()
  const nameId = useId()
  const kindId = useId()

  if (phase === 'loading')
    return (
      <p role="status" className="text-body text-ink-muted">
        設備と点検を読み込んでいます…
      </p>
    )
  if (phase === 'error') {
    return (
      <LoadFailed
        what="設備と点検"
        onRetry={() => {
          setPhase('loading')
          setReloadCount((n) => n + 1)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-3.5">
        <h2 className="text-grid font-semibold text-ink-muted">{`設備と場所　${rows.length}件`}</h2>
        <p className="text-grid text-ink-muted">
          止めている間は、その設備を使う目的をご案内しません。
        </p>
        <Button
          variant="ghost"
          className="ml-auto min-h-11 border border-line-strong px-4 text-body"
          onClick={() => setAdding((open) => !open)}
        >
          ＋ 設備を足す
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-body text-ink-muted">
          設備・場所がまだ登録されていません。「＋ 設備を足す」から登録します。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table aria-label="設備と場所" className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-surface-2">
                {['設備・場所', 'いまの状態', '次の点検'].map((head) => (
                  <th
                    key={head}
                    scope="col"
                    className="border-line border-b px-3 py-2.5 text-left text-note font-normal text-ink-muted"
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const chosen = row.key === selectedRow?.key
                return (
                  <tr key={row.key} className={chosen ? 'bg-pine-soft' : ''}>
                    <th
                      scope="row"
                      className={`border-line border-b border-l-4 p-0 text-left font-normal ${
                        chosen ? 'border-l-pine' : 'border-l-transparent'
                      }`}
                    >
                      <button
                        type="button"
                        aria-pressed={chosen}
                        onClick={() => setSelectedId(row.members[0]?.id ?? null)}
                        className={`min-h-12 w-full px-3 py-2 text-left text-body font-bold text-ink ${focusRing}`}
                      >
                        {row.label}
                      </button>
                    </th>
                    <td className="border-line border-b px-3 py-2 text-body text-ink">
                      {stateOf(row)}
                    </td>
                    <td className="border-line border-b px-3 py-2 text-body text-ink-muted">
                      {maintenanceOf(row)}
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
            設備を足す
          </p>
          <fieldset
            aria-labelledby={addId}
            className="grid min-w-0 max-w-md gap-4 rounded-card border border-line bg-surface p-4"
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor={nameId} className="text-body text-ink">
                設備・場所の名前
              </label>
              <TextInput
                id={nameId}
                value={newName}
                autoComplete="off"
                enterKeyHint="next"
                onChange={(event) => setNewName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={kindId} className="text-body text-ink">
                種別
              </label>
              <Select
                id={kindId}
                value={newKind}
                onChange={(event) => setNewKind(event.target.value as EquipmentKind)}
              >
                {(['measure', 'counter', 'workbench'] as const).map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </Select>
            </div>
            <Button className="min-h-11" onClick={() => void addUnit()}>
              この設備を足す
            </Button>
          </fieldset>
        </div>
      ) : (
        selected &&
        selectedDraft && (
          <div>
            <p id={editorId} className="mb-2.5 text-grid font-semibold text-ink-muted">
              編集中：{selected.name}
            </p>
            <div className="grid gap-6 md:grid-cols-2">
              <fieldset
                aria-labelledby={editorId}
                className="min-w-0 overflow-hidden rounded-card border border-line bg-surface p-0"
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={selectedDraft.isActive}
                  onClick={() =>
                    setUnitDrafts((drafts) => ({
                      ...drafts,
                      [selected.id]: { ...selectedDraft, isActive: !selectedDraft.isActive },
                    }))
                  }
                  className={`flex min-h-12 w-full items-center gap-3 border-line border-b px-4 py-2 text-left text-body text-ink ${focusRing}`}
                >
                  <span>いま使える</span>
                  <span className="ml-auto text-ink-muted">
                    {selectedDraft.isActive ? '使えます' : '止めています'}
                  </span>
                  <SwitchGlyph on={selectedDraft.isActive} />
                </button>

                <FieldRow htmlFor={reasonId} label="止める理由">
                  <TextInput
                    id={reasonId}
                    value={selectedDraft.inactiveReason}
                    autoComplete="off"
                    enterKeyHint="next"
                    className="max-w-56 text-right"
                    onChange={(event) =>
                      setUnitDrafts((drafts) => ({
                        ...drafts,
                        [selected.id]: { ...selectedDraft, inactiveReason: event.target.value },
                      }))
                    }
                  />
                </FieldRow>

                <FieldRow htmlFor={dateId} label="止める日">
                  <TextInput
                    id={dateId}
                    type="date"
                    value={selectedWindow.date}
                    className="max-w-44"
                    onChange={(event) =>
                      setWindowDrafts((drafts) => ({
                        ...drafts,
                        [selected.id]: { ...selectedWindow, date: event.target.value },
                      }))
                    }
                  />
                </FieldRow>
                <FieldRow htmlFor={fromId} label="止め始める時刻">
                  <TextInput
                    id={fromId}
                    type="time"
                    value={selectedWindow.from}
                    className="max-w-32"
                    onChange={(event) =>
                      setWindowDrafts((drafts) => ({
                        ...drafts,
                        [selected.id]: { ...selectedWindow, from: event.target.value },
                      }))
                    }
                  />
                </FieldRow>
                <FieldRow htmlFor={toId} label="止め終える時刻">
                  <TextInput
                    id={toId}
                    type="time"
                    value={selectedWindow.to}
                    className="max-w-32"
                    onChange={(event) =>
                      setWindowDrafts((drafts) => ({
                        ...drafts,
                        [selected.id]: { ...selectedWindow, to: event.target.value },
                      }))
                    }
                  />
                </FieldRow>

                <FieldRow htmlFor={ledgerId} label="台帳に出す">
                  <Select
                    id={ledgerId}
                    value={selectedDraft.ledgerDisplay}
                    className="max-w-56"
                    onChange={(event) =>
                      setUnitDrafts((drafts) => ({
                        ...drafts,
                        [selected.id]: {
                          ...selectedDraft,
                          ledgerDisplay: event.target.value as Unit['ledgerDisplay'],
                        },
                      }))
                    }
                  >
                    <option value="grey">灰色にして残す</option>
                    <option value="hide">出さない</option>
                  </Select>
                </FieldRow>

                {isPartial(selectedWindow) && (
                  <p className="border-line border-t px-4 py-2 text-grid text-ink-muted">
                    日付と開始・終了の時刻をそろえると保存できます。
                  </p>
                )}
                {(selectedRow?.members.length ?? 1) > 1 && (
                  <p className="border-line border-t px-4 py-2 text-grid text-ink-muted">
                    {`この行は ${selectedRow?.members.length} 台をまとめて出しています。`}
                  </p>
                )}
              </fieldset>

              <ImpactCard title="止めると影響するご予約" items={impact} tone="danger" />
            </div>
          </div>
        )
      )}
    </div>
  )
}

function label(isActive: boolean): string {
  return isActive ? '使えます' : '止めています'
}

function text(value: string): string {
  return value.trim() === '' ? '未入力' : value.trim()
}

/** グループ表の 1 行。行の高さは 48px（44pt 以上）。 */
function FieldRow({
  htmlFor,
  label: title,
  children,
}: {
  htmlFor: string
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-line border-b px-4 py-2 last:border-b-0">
      <label htmlFor={htmlFor} className="whitespace-nowrap text-body text-ink">
        {title}
      </label>
      <div className="ml-auto flex justify-end">{children}</div>
    </div>
  )
}

/** つまみの見た目。状態は行の文字（使えます／止めています）が伝えるので飾りに徹する。 */
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
