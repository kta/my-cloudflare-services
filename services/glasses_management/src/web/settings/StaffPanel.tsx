import { BusinessHoursView, SkillCode, StaffMember, StaffShift } from '@app/contracts'
import { auth } from '@app/shared'
import { cn, focusRing } from '@app/ui'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { addJstDays, warnShiftOutsideHours, weekdayOf } from '../../worker/domain/store-settings'
import { client } from '../client'
import { LoadFailed } from '../shell/LoadFailed'
import {
  type SaveOutcome,
  type SettingsPanelProps,
  toJstDay,
  WEEKDAY_NAMES,
  WEEKDAYS_FROM_MONDAY,
} from './sections'

/*
 * スタッフと技能（承認済みモック docs/frontend/mockups/eyex/images/SETTINGS-STAFF.png）。
 *
 * 実測: .staff = 250px + 1fr / gap 30px。一覧の行は名前 16px 600 ＋ 技能 13px
 * （margin-top 2px）、選択中は左端に 4px の緑（inset 4px 0 0）＋ padding-left 14px。
 * グループ表の行は min-height 52px / 15px。技能の札は min-height 44px /
 * padding 0 16px / pill / 1px --color-line-strong、選んだ札だけ 2px --color-pine ＋
 * 地 --color-pine-soft ＋ 文字 --color-pine-deep、gap 10px。勤務の 7 列は
 * repeat(7, 1fr) / gap 6px、セル min-height 62px / padding 6px 2px / 中央寄せ。
 *
 * 技能は ✓ の有無だけで受け持てる目的が決まるので、札は入切を持つ操作として作り、
 * ✓ を色ではなく字で出す。勤務はモックの読み取り表示ではなく直せる欄にする
 * （AC-SET-12 が曜日を直して保存し直すことを求める）。
 *
 * PIN の「作り直す」は出さない —— 再設定は P10（013-terminals-and-audit）で、
 * 押せて何も起きないボタンをこの面に置かない（P1 の決め #11 と同じ理由）。
 */

const SECTION_NAME = 'スタッフと技能'
const ADD_FAILED = 'スタッフを足せませんでした。入力はそのまま残っています。'
const ADD_FORBIDDEN = 'スタッフを足せるのは 店長 だけです。入力はそのまま残っています。'

const WEEKDAY_LONG = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日']

/** SETTINGS-STAFF の「できること（技能）」6 枚。綴りは SkillCode が正本。 */
const SKILL_LABELS: Record<SkillCode, string> = {
  measure: '視力測定',
  processing: '加工',
  sales_reception: '販売・受付',
  fitting: 'フィッティング',
  contact_lens: 'コンタクトの相談',
  repair: '修理・部品交換',
}

const ROLE_LABELS = { staff: 'スタッフ（設定は見るだけ）', manager: '店長' } as const

/** 曜日 1 行の下書き。breaks は画面に出さないが、保存でそのまま送り返す。 */
type WeeklyDraft = {
  weekday: number
  isOff: boolean
  startsAt: string | null
  endsAt: string | null
  breaks: { startsAt: string; endsAt: string }[]
}

type MemberDraft = {
  role: 'staff' | 'manager'
  maxParallelReservations: number
  isActive: boolean
  skills: SkillCode[]
}

type Draft = { member: MemberDraft; weekly: WeeklyDraft[] }

type Loaded = { staff: StaffMember[]; shifts: StaffShift[]; hours: BusinessHoursView }

export function StaffPanel({ storeId, now, today, onDraftChange }: SettingsPanelProps) {
  const day = today ?? toJstDay(now ?? new Date().toISOString())
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  // 読み直しの合図。読み込みの useEffect の依存に入れる。
  const [reloadCount, setReloadCount] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 担当ごとの下書き。描画のたびに引き直すので、一覧だけ出て右側がまだ無い瞬間ができない。
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<Loaded | null> => {
    const [staffRes, shiftRes, hoursRes] = await Promise.all([
      // 「いま使える」を切った行も出す（UC-SET-12）。GET .../staff の query には
      // zValidator が無く hc の型が query を受け取らないので、経路だけ型のついた
      // クライアントに引かせ、query は fetch の側で足す。
      client.api.staff.stores[':storeId'].staff.$get(
        { param: { storeId } },
        { fetch: withInactive },
      ),
      client.api.staff.stores[':storeId']['staff-shifts'].$get({
        param: { storeId },
        query: { from: day, to: addJstDays(day, 6) },
      }),
      client.api.staff.stores[':storeId']['business-hours'].$get({ param: { storeId } }),
    ])
    if (!staffRes.ok || !shiftRes.ok || !hoursRes.ok) return null
    // 3 本の本文を読み切ってから 1 度に置く。順に置くと、担当は新しいのに勤務は
    // 古いという半端な組み合わせで下書きを引いてしまう。
    const [staffJson, shiftJson, hoursJson] = await Promise.all([
      staffRes.json(),
      shiftRes.json(),
      hoursRes.json(),
    ])
    return {
      staff: StaffMember.array().parse(staffJson),
      shifts: StaffShift.array().parse(shiftJson),
      hours: BusinessHoursView.parse(hoursJson),
    }
  }, [storeId, day])

  useEffect(() => {
    let alive = true
    load()
      .then((next) => {
        if (!alive) return
        if (next === null) setFailed(true)
        else setLoaded(next)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [load, reloadCount])

  const selected = loaded?.staff.find((row) => row.id === selectedId) ?? loaded?.staff[0] ?? null
  const base = useMemo(
    () => (selected && loaded ? baseDraft(selected, loaded.shifts, day) : null),
    [selected, loaded, day],
  )
  // 打ち込んだ値があればそれを、無ければ保存されている姿を出す。保存が落ちても
  // 読み直さないので、打ち込んだ値はそのまま画面に残る。
  const draft = selected ? (drafts[selected.id] ?? base) : null

  const changes = useMemo(
    () => (selected && base && draft ? describeChanges(selected.displayName, base, draft) : []),
    [selected, base, draft],
  )

  const save = useCallback(async (): Promise<SaveOutcome> => {
    if (!selected || !base || !draft || !loaded) return 'failed'
    const outcome = await writeAll(storeId, selected.id, base, draft, day, loaded.hours.version)
    if (outcome !== 'saved') return outcome
    const next = await load()
    if (next === null) return 'failed'
    setLoaded(next)
    forget(selected.id)
    return 'saved'
  }, [selected, base, draft, loaded, storeId, day, load])

  const discard = useCallback(() => {
    if (selected) forget(selected.id)
  }, [selected])

  useEffect(() => {
    onDraftChange({ changes, blocked: null, danger: false, dangerNote: null, save, discard })
  }, [onDraftChange, changes, save, discard])

  /** 打ち込んだ値を捨てて、保存されている姿へ戻す。 */
  function forget(staffId: string) {
    setDrafts((current) => {
      const next = { ...current }
      delete next[staffId]
      return next
    })
  }

  function put(next: Draft) {
    if (!selected) return
    setDrafts((current) => ({ ...current, [selected.id]: next }))
  }

  function edit(next: Partial<MemberDraft>) {
    if (!draft) return
    put({ ...draft, member: { ...draft.member, ...next } })
  }

  function editWeekday(weekday: number, next: Partial<WeeklyDraft>) {
    if (!draft) return
    put({
      ...draft,
      weekly: draft.weekly.map((row) => (row.weekday === weekday ? { ...row, ...next } : row)),
    })
  }

  async function addMember(input: NewMember) {
    setAddError(null)
    try {
      const res = await client.api.staff.stores[':storeId'].staff.$post({
        param: { storeId },
        json: {
          displayName: input.displayName,
          kana: input.kana === '' ? null : input.kana,
          jobLabel: input.role === 'manager' ? '店長' : null,
          role: input.role,
          isActive: true,
          sortOrder: loaded?.staff.length ?? 0,
          adminUserId: null,
          maxParallelReservations: 1,
        },
      })
      if (!res.ok) {
        setAddError(res.status === 403 ? ADD_FORBIDDEN : ADD_FAILED)
        return
      }
      const made = StaffMember.parse(await res.json())
      if (input.skills.length > 0) {
        const skillRes = await client.api.staff.stores[':storeId'].staff[':staffId'].skills.$put({
          param: { storeId, staffId: made.id },
          json: { skills: input.skills },
        })
        if (!skillRes.ok) {
          setAddError(skillRes.status === 403 ? ADD_FORBIDDEN : ADD_FAILED)
          return
        }
      }
      const next = await load()
      if (next === null) {
        setAddError(ADD_FAILED)
        return
      }
      setLoaded(next)
      setAdding(false)
    } catch {
      setAddError(ADD_FAILED)
    }
  }

  if (failed)
    return (
      <LoadFailed
        what="スタッフと技能"
        onRetry={() => {
          setFailed(false)
          setReloadCount((n) => n + 1)
        }}
      />
    )
  if (!loaded)
    return (
      <p role="status" className="text-body text-ink-muted">
        {SECTION_NAME}を読み込んでいます…
      </p>
    )
  if (loaded.staff.length === 0)
    return <p className="text-body text-ink-muted">スタッフがまだ登録されていません。</p>

  // 幅は任意値で書かない。--spacing の刻みで 250px（w-62.5）を作る。
  return (
    <div className="flex flex-wrap items-start gap-7.5">
      <div className="w-62.5 shrink-0">
        <p className="mb-3 text-grid font-semibold text-ink-muted">
          スタッフ　{loaded.staff.length}名
        </p>
        <ul aria-label="スタッフ">
          {loaded.staff.map((member) => (
            <li
              key={member.id}
              className="flex items-center gap-3.5 border-t border-line first:border-t-0"
            >
              <button
                type="button"
                onClick={() => setSelectedId(member.id)}
                aria-current={selected?.id === member.id ? 'true' : undefined}
                className={cn(
                  // 選択中は左端に 4px の緑（モック）。選んでいない行にも同じ幅の
                  // 透明な縁を置いて、選び直すたびに文字が横へ跳ねないようにする。
                  'min-h-13 flex-1 border-l-4 py-3 pl-2.5 text-left',
                  selected?.id === member.id ? 'border-pine' : 'border-transparent',
                  focusRing,
                )}
              >
                <span className="block text-body font-semibold">{member.displayName}</span>
                <span className="mt-0.5 block text-grid text-ink-muted">{sublineOf(member)}</span>
              </button>
              {!worksOn(loaded.shifts, member.id, day) && (
                <span className="text-grid text-ink-muted">本日はお休み</span>
              )}
            </li>
          ))}
        </ul>
        {adding ? (
          <AddMemberForm
            error={addError}
            onCancel={() => setAdding(false)}
            onSubmit={(input) => void addMember(input)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={cn(
              'mt-1 min-h-11 w-full border-t border-line text-left text-body font-semibold text-pine',
              focusRing,
            )}
          >
            ＋ スタッフを足す
          </button>
        )}
      </div>

      {selected && draft && (
        <div className="min-w-0 flex-1">
          <h3 className="mb-3 text-grid font-semibold text-ink-muted">
            {selected.displayName} の設定
          </h3>
          <div className="overflow-hidden rounded-panel border border-line bg-surface">
            <Row label="できる役割" htmlFor="staff-role">
              <select
                id="staff-role"
                value={draft.member.role}
                onChange={(event) =>
                  edit({ role: event.target.value === 'manager' ? 'manager' : 'staff' })
                }
                className={cn('min-h-11 rounded-ctl border border-line px-3', focusRing)}
              >
                <option value="staff">{ROLE_LABELS.staff}</option>
                <option value="manager">{ROLE_LABELS.manager}</option>
              </select>
            </Row>
            <Row label="同時に受け持てるご予約" htmlFor="staff-parallel">
              <select
                id="staff-parallel"
                value={String(draft.member.maxParallelReservations)}
                onChange={(event) => edit({ maxParallelReservations: Number(event.target.value) })}
                className={cn('min-h-11 rounded-ctl border border-line px-3', focusRing)}
              >
                {[1, 2, 3, 4, 5].map((count) => (
                  <option key={count} value={String(count)}>
                    {count}件まで
                  </option>
                ))}
              </select>
            </Row>
            {/* 「いま使える」はモックに無い行。退職した人の行を消さずに残すには
                切り替えが要る（UC-SET-12）。行全体を押せる入切にする。 */}
            <button
              type="button"
              role="switch"
              aria-checked={draft.member.isActive}
              aria-labelledby="staff-active-label"
              onClick={() => edit({ isActive: !draft.member.isActive })}
              className={cn(
                'flex min-h-13 w-full items-center gap-3 border-b border-line px-4 text-left text-body',
                focusRing,
              )}
            >
              <span id="staff-active-label">いま使える</span>
              <span className="ml-auto text-ink-muted">
                {draft.member.isActive ? '使えます' : '止めています'}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'block h-8 w-13 shrink-0 rounded-full',
                  draft.member.isActive ? 'bg-pine' : 'bg-busy',
                )}
              />
            </button>
            <Row label="PIN">
              <span className="text-ink-muted">
                {selected.hasPin ? '設定してあります' : 'まだ設定していません'}
              </span>
            </Row>
          </div>

          <fieldset className="mt-6">
            <legend className="mb-3 text-grid font-semibold text-ink-muted">
              できること（技能）
            </legend>
            <div className="flex flex-wrap gap-2.5">
              {SkillCode.options.map((skill) => (
                <SkillChip
                  key={skill}
                  skill={skill}
                  on={draft.member.skills.includes(skill)}
                  onToggle={() => edit({ skills: toggleSkill(draft.member.skills, skill) })}
                />
              ))}
            </div>
          </fieldset>
          <p className="mt-3.5 text-grid text-ink-muted">✓ の技能が要る目的だけご案内します。</p>

          <p className="mt-6 mb-3 text-grid font-semibold text-ink-muted">勤務時間</p>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAYS_FROM_MONDAY.map((weekday) => draft.weekly[weekday]).map((row) =>
              row === undefined ? null : (
                <ShiftCell
                  key={row.weekday}
                  row={row}
                  storeClosed={
                    loaded.hours.rows.find((hour) => hour.weekday === row.weekday)?.isClosed ?? true
                  }
                  onEdit={(next) => editWeekday(row.weekday, next)}
                />
              ),
            )}
          </div>
          {/* 営業時間の外へはみ出す勤務は拒まない。何が起きるかだけを知らせる（AC-SET-12）。 */}
          <ul aria-label="気をつけること" className="mt-3">
            {warningsOf(draft.weekly, loaded.hours).map((warning) => (
              <li key={warning} className="text-grid text-amber">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** グループ表の 1 行（実測 52px / 15px / 値は右寄せ）。 */
function Row({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-13 items-center gap-3 border-b border-line px-4 py-2 text-body last:border-b-0">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      <span className="ml-auto text-right">{children}</span>
    </div>
  )
}

/** 技能の札。✓ は色ではなく字で出し、押せる高さは 44pt 以上にする。 */
function SkillChip({
  skill,
  on,
  onToggle,
}: {
  skill: SkillCode
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-grid font-semibold',
        on
          ? 'border-2 border-pine bg-pine-soft text-pine-deep'
          : 'border border-line-strong bg-surface text-ink-muted',
        focusRing,
      )}
    >
      {on && <span aria-hidden="true">✓</span>}
      {SKILL_LABELS[skill]}
    </button>
  )
}

/** 勤務の 1 曜日（実測 62px / 中央寄せ）。定休日と人のお休みを書き分ける。 */
function ShiftCell({
  row,
  storeClosed,
  onEdit,
}: {
  row: WeeklyDraft
  storeClosed: boolean
  onEdit: (next: Partial<WeeklyDraft>) => void
}) {
  const long = WEEKDAY_LONG[row.weekday]
  const restLabel = storeClosed ? '定休日' : 'お休み'
  return (
    <div
      data-testid="shift-day"
      data-weekday={row.weekday}
      className="flex min-h-15.5 flex-col items-center justify-center gap-1 px-0.5 py-1.5 text-center"
    >
      <b className="text-grid">{WEEKDAY_NAMES[row.weekday]}</b>
      {/* 印は 20px しかないので、字ごと label で包んで押せる高さを 44pt 以上にする。 */}
      <label className="flex min-h-11 w-full items-center justify-center gap-1 text-note text-ink-muted">
        <input
          type="checkbox"
          aria-label={`${long}はお休み`}
          checked={row.isOff}
          onChange={(event) =>
            onEdit(
              event.target.checked
                ? { isOff: true, startsAt: null, endsAt: null }
                : { isOff: false, startsAt: '10:00', endsAt: '19:00' },
            )
          }
          className={cn('size-5', focusRing)}
        />
        お休み
      </label>
      {row.isOff ? (
        <span className="text-note text-ink-muted">{restLabel}</span>
      ) : (
        <>
          <input
            type="time"
            aria-label={`${long}の勤務の開始`}
            value={row.startsAt ?? ''}
            onChange={(event) => onEdit({ startsAt: event.target.value })}
            className={cn(
              'min-h-11 w-full rounded-ctl border border-line px-1 text-note',
              focusRing,
            )}
          />
          <input
            type="time"
            aria-label={`${long}の勤務の終了`}
            value={row.endsAt ?? ''}
            onChange={(event) => onEdit({ endsAt: event.target.value })}
            className={cn(
              'min-h-11 w-full rounded-ctl border border-line px-1 text-note',
              focusRing,
            )}
          />
        </>
      )}
    </div>
  )
}

type NewMember = {
  displayName: string
  kana: string
  role: 'staff' | 'manager'
  skills: SkillCode[]
}

/** 「＋ スタッフを足す」。技能はここでも札で選ぶ（一覧の並びと同じ 6 枚）。 */
function AddMemberForm({
  error,
  onCancel,
  onSubmit,
}: {
  error: string | null
  onCancel: () => void
  onSubmit: (input: NewMember) => void
}) {
  const [displayName, setDisplayName] = useState('')
  const [kana, setKana] = useState('')
  const [role, setRole] = useState<'staff' | 'manager'>('staff')
  const [skills, setSkills] = useState<SkillCode[]>([])
  const [missing, setMissing] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (displayName.trim() === '') {
      setMissing(true)
      return
    }
    setMissing(false)
    onSubmit({ displayName: displayName.trim(), kana: kana.trim(), role, skills })
  }

  return (
    <form
      aria-label="スタッフを足す"
      onSubmit={submit}
      className="mt-3 flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <label htmlFor="new-staff-name" className="text-grid font-semibold">
        お名前
      </label>
      <input
        id="new-staff-name"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        autoComplete="off"
        enterKeyHint="next"
        className={cn('min-h-11 rounded-ctl border border-line px-3 text-body', focusRing)}
      />
      <label htmlFor="new-staff-kana" className="text-grid font-semibold">
        ふりがな
      </label>
      <input
        id="new-staff-kana"
        value={kana}
        onChange={(event) => setKana(event.target.value)}
        autoComplete="off"
        enterKeyHint="next"
        className={cn('min-h-11 rounded-ctl border border-line px-3 text-body', focusRing)}
      />
      <label htmlFor="new-staff-role" className="text-grid font-semibold">
        できる役割
      </label>
      <select
        id="new-staff-role"
        value={role}
        onChange={(event) => setRole(event.target.value === 'manager' ? 'manager' : 'staff')}
        className={cn('min-h-11 rounded-ctl border border-line px-3 text-body', focusRing)}
      >
        <option value="staff">{ROLE_LABELS.staff}</option>
        <option value="manager">{ROLE_LABELS.manager}</option>
      </select>
      <fieldset>
        <legend className="mb-3 text-grid font-semibold">できること（技能）</legend>
        <div className="flex flex-wrap gap-2.5">
          {SkillCode.options.map((skill) => (
            <SkillChip
              key={skill}
              skill={skill}
              on={skills.includes(skill)}
              onToggle={() => setSkills((current) => toggleSkill(current, skill))}
            />
          ))}
        </div>
      </fieldset>
      {missing && (
        <p role="alert" className="text-grid text-danger">
          お名前を入れてください。
        </p>
      )}
      {error && (
        <p role="alert" className="text-grid text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2.5">
        <button
          type="submit"
          className={cn(
            'min-h-11 rounded-ctl bg-pine px-4 text-body font-semibold text-on-pine',
            focusRing,
          )}
        >
          このスタッフを足す
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={cn('min-h-11 rounded-ctl px-4 text-body font-semibold text-pine', focusRing)}
        >
          やめる
        </button>
      </div>
    </form>
  )
}

/* --- 下書きの組み立てと差分 ---------------------------------------------- */

/** 一覧の 2 行目（店長・販売・受付）。列を持たず、肩書きと技能を ・ でつなぐ。 */
function sublineOf(member: StaffMember): string {
  return [member.jobLabel, ...member.skills.map((skill) => SKILL_LABELS[skill])]
    .filter((part): part is string => part !== null && part !== '')
    .join('・')
}

/** その日に勤務（work）の行があるか。無ければ一覧に「本日はお休み」を出す。 */
function worksOn(shifts: StaffShift[], staffId: string, date: string): boolean {
  return shifts.some((row) => row.staffId === staffId && row.date === date && row.kind === 'work')
}

/** 保存されている姿。曜日は today から 7 日ぶんの展開結果から引き直す。 */
function baseDraft(member: StaffMember, shifts: StaffShift[], today: string): Draft {
  const weekly: WeeklyDraft[] = []
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const date = addJstDays(today, (weekday - weekdayOf(today) + 7) % 7)
    const ofDay = shifts.filter((row) => row.staffId === member.id && row.date === date)
    const work = ofDay.find((row) => row.kind === 'work')
    const breaks = ofDay
      .filter((row) => row.kind === 'break')
      .slice(0, 1)
      .map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt }))
    weekly.push(
      work
        ? { weekday, isOff: false, startsAt: work.startsAt, endsAt: work.endsAt, breaks }
        : { weekday, isOff: true, startsAt: null, endsAt: null, breaks: [] },
    )
  }
  return {
    member: {
      role: member.role,
      maxParallelReservations: member.maxParallelReservations,
      isActive: member.isActive,
      skills: SkillCode.options.filter((skill) => member.skills.includes(skill)),
    },
    weekly,
  }
}

function toggleSkill(skills: SkillCode[], skill: SkillCode): SkillCode[] {
  const next = skills.includes(skill) ? skills.filter((held) => held !== skill) : [...skills, skill]
  // 並びは札の並び（SkillCode の順）に揃える。保存の差分を並びで出さない。
  return SkillCode.options.filter((code) => next.includes(code))
}

function skillsChanged(base: Draft, draft: Draft): boolean {
  return JSON.stringify(base.member.skills) !== JSON.stringify(draft.member.skills)
}

function memberChanged(base: Draft, draft: Draft): boolean {
  return JSON.stringify(base.member) !== JSON.stringify(draft.member)
}

function weeklyChanged(base: Draft, draft: Draft): boolean {
  return JSON.stringify(base.weekly) !== JSON.stringify(draft.weekly)
}

/**
 * 何を直したか。器の札の件数になり、403 で断られたときは「下書きは残っています」の
 * 下にこの行がそのまま並ぶ（AC-SET-17）。
 */
function describeChanges(name: string, base: Draft, draft: Draft): string[] {
  const changes: string[] = []
  if (skillsChanged(base, draft)) changes.push(`${name} のできること（技能）`)
  if (base.member.role !== draft.member.role) changes.push(`${name} のできる役割`)
  if (base.member.maxParallelReservations !== draft.member.maxParallelReservations) {
    changes.push(`${name} の同時に受け持てるご予約`)
  }
  if (base.member.isActive !== draft.member.isActive) changes.push(`${name} の「いま使える」`)
  for (const [index, row] of draft.weekly.entries()) {
    if (JSON.stringify(base.weekly[index]) !== JSON.stringify(row)) {
      changes.push(`${name} の${WEEKDAY_LONG[row.weekday]}の勤務`)
    }
  }
  return changes
}

/** 営業時間の外にはみ出す勤務の知らせ。式は worker の domain と 1 本にする。 */
function warningsOf(weekly: WeeklyDraft[], hours: BusinessHoursView): string[] {
  return weekly.flatMap((row) => {
    const day = hours.rows.find((candidate) => candidate.weekday === row.weekday)
    if (!day) return []
    return warnShiftOutsideHours(row, {
      weekday: day.weekday,
      isClosed: day.isClosed,
      opensAt: day.opensAt,
      closesAt: day.closesAt,
    })
  })
}

/* --- 保存 ---------------------------------------------------------------- */

/** 一覧は「いま使える」を切った行も出す。query は fetch の側で足す。 */
function withInactive(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return auth.authFetch(`${String(input)}?includeInactive=true`, init)
}

function outcomeOf(status: number): SaveOutcome {
  if (status === 403) return 'forbidden'
  if (status === 409) return 'conflict'
  return 'failed'
}

/*
 * 技能 → 担当 → 勤務の順に書く。1 本でも落ちたらそこで止める。
 *
 * 版は**この面が読み込んだときのもの**を土台にする。以前は書く直前に版を
 * 取り直していたので、ほかの端末が先に保存していてもその版をそのまま拾い、
 * 楽観ロックが一度も効かなかった。2 台の iPad で同時に設定を直すと、
 * 後から押した側が相手の変更を黙って上書きし、店長は取り消されたことに
 * 気づけない（実装不足の洗い出し settings-05。`004` の HOW）。
 *
 * 1 回の保存で 2 本以上書くときは、**前の書き込みが上げた版を自分で数える** ——
 * どの書き込みも `store_settings_revision` を +1 するので、読み直さなくても分かる。
 * 読み直すと、その隙に入った他端末の変更まで飲み込んでしまう。
 */
async function writeAll(
  storeId: string,
  staffId: string,
  base: Draft,
  draft: Draft,
  today: string,
  loadedVersion: number,
): Promise<SaveOutcome> {
  let version = loadedVersion
  if (skillsChanged(base, draft)) {
    const res = await client.api.staff.stores[':storeId'].staff[':staffId'].skills.$put({
      param: { storeId, staffId },
      json: { skills: draft.member.skills },
    })
    if (!res.ok) return outcomeOf(res.status)
    version += 1
  }

  if (memberChanged(base, draft)) {
    const res = await client.api.staff.stores[':storeId'].staff[':staffId'].$patch({
      param: { storeId, staffId },
      json: {
        role: draft.member.role,
        maxParallelReservations: draft.member.maxParallelReservations,
        isActive: draft.member.isActive,
        version,
      },
    })
    if (!res.ok) return outcomeOf(res.status)
    version += 1
  }

  if (weeklyChanged(base, draft)) {
    const res = await client.api.staff.stores[':storeId']['staff-shifts'].$put({
      param: { storeId },
      json: { staffId, weekly: draft.weekly, effectiveFrom: today, version },
    })
    if (!res.ok) return outcomeOf(res.status)
  }
  return 'saved'
}
