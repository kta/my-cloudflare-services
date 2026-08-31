import type {
  PublicAvailabilityResponse,
  PublicBookingResult,
  PublicReservationStatus,
  PublicStoreDetail,
  PublicStorePurpose,
} from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { useCallback, useRef, useState } from 'react'
import { shiftDate } from '../ledger/metrics'
import {
  CancelPage,
  type ManagedReservation,
  type ManageFailure,
  type ManageOutcome,
} from './CancelPage'
import { ConfirmStep, type ConfirmTarget, type PublicSlotConflict } from './ConfirmStep'
import { DateTimeStep } from './DateTimeStep'
import { DoneStep, type PublicBookingReceipt } from './DoneStep'
import { FormStep, type PublicContact } from './FormStep'
import { PublicBookingApp, type PublicFlow, type PublicSeam } from './PublicBookingApp'

/*
 * お客様向け 7 面の配線。
 *
 * `PublicBookingApp` が持つのは工程 1〜3（店舗・ご用件・日時）と上のバー・進捗だけで、
 * 工程 4 以降と WEB-CANCEL は `laterSteps` という 1 つの差し込み口に開けてある。
 * ここがその口を埋める —— **画面そのものは 1 つも描かない**。持つのは
 *
 *   1. 工程をまたいで残す下書き（伺った 4 欄と、受け取った控え）
 *   2. 公開面の HTTP（未認証。bearer を 1 度も付けない）
 *   3. ご確認の「変更」がどの工程まで戻るか
 *
 * の 3 つだけで、文言・寸法・読み上げは各面（FormStep / ConfirmStep / DoneStep /
 * CancelPage）が持っている。
 *
 * 下書きを器の外側に置くのは、器が工程 4 未満のときに `laterSteps` を呼ばない
 * （＝中の面が外れる）ためである。ご確認から「変更」で工程 1〜3 へ戻っても、
 * 伺ったお名前とお電話番号は消えない。
 *
 * 置き場所はメモリだけにする。お客様の連絡先を localStorage にも sessionStorage にも
 * 書かない（`07-nfr.md` §5.3 / §6.6）。
 */

const EMPTY_CONTACT: PublicContact = { name: '', kana: '', phone: '', email: '' }

/** 確認番号は `X-Management-Code` で渡す。本人確認の短命の鍵と同じ入口である。 */
const MANAGEMENT_HEADER = 'X-Management-Code'

/** ご予約の変更で週を送れる先。器（`ACCEPT_UNTIL_DAYS`）と同じ目安を使う。 */
const ACCEPT_UNTIL_DAYS = 30

/** 通らなかった理由。**どちらの番号が違うかを分けない**ので status だけで決める。 */
function failureOf(status: number): ManageFailure {
  if (status === 401) return 'mismatch'
  if (status === 429) return 'locked'
  if (status === 409) return 'deadline'
  return 'failed'
}

/** 照会が通ったご予約と、その先の呼び出しに要る鍵。画面には 1 度も出さない。 */
type OpenedReservation = {
  code: string
  managementCode: string
  purposeId: string | null
  durationMinutes: number
}

export type PublicBookingRootProps = {
  slug: string | null
  flow: PublicFlow
}

export function PublicBookingRoot({ slug, flow }: PublicBookingRootProps) {
  const [contact, setContact] = useState<PublicContact>(EMPTY_CONTACT)
  const [receipt, setReceipt] = useState<PublicBookingReceipt | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [conflict, setConflict] = useState<PublicSlotConflict | null>(null)
  const [failed, setFailed] = useState(false)
  const opened = useRef<OpenedReservation | null>(null)
  /** 締切を過ぎているかどうかの判定に使う時刻。開いた瞬間に 1 度だけ読む。 */
  const [now] = useState(() => new Date().toISOString())

  /* --- 予約を送る（WEB-05 → WEB-06） ---------------------------------- */

  const send = useCallback(
    async (seam: PublicSeam, idempotencyKey: string): Promise<void> => {
      const store = seam.store
      const purpose = seam.purpose
      const startsAt = seam.startsAt
      if (store === null || purpose === null || startsAt === null) return
      setSubmitting(true)
      setConflict(null)
      setFailed(false)
      try {
        const res = await fetch(`/api/public/stores/${encodeURIComponent(store.slug)}/bookings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({
            purposeId: purpose.id,
            startsAt,
            contactName: contact.name,
            contactKana: contact.kana,
            contactPhone: contact.phone,
            contactEmail: contact.email,
          }),
        })
        if (res.status === 409) {
          const body = (await res.json()) as {
            error: string
            alternatives?: { startsAt: string }[]
          }
          if (body.error === 'slot_taken') {
            setConflict({
              takenAt: startsAt,
              alternatives: (body.alternatives ?? []).map((slot) => slot.startsAt),
            })
            return
          }
          setFailed(true)
          return
        }
        if (!res.ok) {
          setFailed(true)
          return
        }
        const answer = (await res.json()) as PublicBookingResult
        setReceipt({
          code: answer.code,
          managementCode: answer.managementCode,
          status: answer.status,
          startsAt: answer.startsAt,
          endsAt: answer.endsAt,
          storeName: answer.storeName,
          purposeName: answer.purposeName,
          contactName: answer.contactName,
          emailed: answer.emailed,
        })
        opened.current = {
          code: answer.code,
          managementCode: answer.managementCode,
          purposeId: purpose.id,
          durationMinutes: purpose.durationMinutes,
        }
        seam.next()
      } catch {
        setFailed(true)
      } finally {
        setSubmitting(false)
      }
    },
    [contact],
  )

  /** ご確認の「変更」。工程 5 から目当ての工程まで、控え（history）をまとめて戻る。 */
  const editFrom = useCallback((step: number, target: ConfirmTarget): void => {
    const destination = { store: 1, purpose: 2, datetime: 3, contact: 4 }[target]
    window.history.go(destination - step)
  }, [])

  /* --- 自分の予約を確かめ・変え・取り消す（WEB-CANCEL） ------------------- */

  /** 明細に足りない 2 つ（お店のお電話番号・ご用件の id）を公開面から補う。 */
  const dress = useCallback(
    async (status: PublicReservationStatus): Promise<ManagedReservation> => {
      let storePhone = ''
      if (slug !== null) {
        const path = `/api/public/stores/${encodeURIComponent(slug)}`
        const detail = await fetch(path)
        if (detail.ok) storePhone = ((await detail.json()) as PublicStoreDetail).phone
        const keys = opened.current
        if (keys !== null && keys.purposeId === null) {
          const list = await fetch(`${path}/purposes`)
          if (list.ok) {
            const purposes = (await list.json()) as PublicStorePurpose[]
            const match = purposes.find((row) => row.name === status.purposeName)
            if (match !== undefined) keys.purposeId = match.id
          }
        }
      }
      const keys = opened.current
      if (keys !== null) keys.durationMinutes = status.durationMinutes
      return {
        code: status.code,
        status: status.status,
        startsAt: status.startsAt,
        endsAt: status.endsAt,
        storeName: status.storeName,
        storePhone,
        purposeName: status.purposeName,
        durationMinutes: status.durationMinutes,
        contactName: status.contactName,
        changeDeadlineAt: status.changeDeadlineAt,
      }
    },
    [slug],
  )

  const lookUp = useCallback(
    async (input: {
      code: string
      managementCode: string
    }): Promise<ManageOutcome<ManagedReservation>> => {
      opened.current = {
        code: input.code,
        managementCode: input.managementCode,
        purposeId: null,
        durationMinutes: 0,
      }
      const res = await fetch(`/api/public/reservations/${encodeURIComponent(input.code)}`, {
        headers: { [MANAGEMENT_HEADER]: input.managementCode },
      })
      if (!res.ok) return { ok: false, reason: failureOf(res.status) }
      return { ok: true, value: await dress((await res.json()) as PublicReservationStatus) }
    },
    [dress],
  )

  const moveTo = useCallback(
    async (startsAt: string): Promise<ManageOutcome<ManagedReservation>> => {
      const keys = opened.current
      if (keys === null) return { ok: false, reason: 'expired' }
      const res = await fetch(`/api/public/reservations/${encodeURIComponent(keys.code)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', [MANAGEMENT_HEADER]: keys.managementCode },
        body: JSON.stringify({ startsAt }),
      })
      if (!res.ok) return { ok: false, reason: failureOf(res.status) }
      return { ok: true, value: await dress((await res.json()) as PublicReservationStatus) }
    },
    [dress],
  )

  const drop = useCallback(async (): Promise<ManageOutcome<{ cancelledAt: string }>> => {
    const keys = opened.current
    if (keys === null) return { ok: false, reason: 'expired' }
    const res = await fetch(`/api/public/reservations/${encodeURIComponent(keys.code)}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [MANAGEMENT_HEADER]: keys.managementCode },
      body: JSON.stringify({ reason: '' }),
    })
    if (!res.ok) return { ok: false, reason: failureOf(res.status) }
    return { ok: true, value: (await res.json()) as { cancelledAt: string } }
  }, [])

  /* --- 差し込み口 ---------------------------------------------------------- */

  const laterSteps = useCallback(
    (seam: PublicSeam) => {
      if (seam.flow === 'manage') {
        return (
          <CancelPage
            now={now}
            onLookup={lookUp}
            onChangeDateTime={moveTo}
            onCancelReservation={drop}
            renderChangeDateTime={({ heading, onPick }) => (
              <ManageDateTime heading={heading} opened={opened} onPick={onPick} />
            )}
          />
        )
      }
      if (seam.step === 4) {
        return (
          <FormStep
            initialValue={contact}
            phase={failed ? 'error' : 'ready'}
            onProceed={(value) => {
              setContact(value)
              setFailed(false)
              seam.next()
            }}
          />
        )
      }
      if (seam.step === 5) {
        const store = seam.storeDetail ?? seam.store
        const purpose = seam.purpose
        const startsAt = seam.startsAt
        if (store === null || purpose === null || startsAt === null) return null
        return (
          <ConfirmStep
            draft={{
              storeName: store.name,
              purposeName: purpose.name,
              durationMinutes: purpose.durationMinutes,
              startsAt,
              contact,
            }}
            submitting={submitting}
            conflict={conflict}
            phase={failed ? 'error' : 'ready'}
            onEdit={(target) => editFrom(seam.step, target)}
            onSubmit={(key) => void send(seam, key)}
            onReselect={() => editFrom(seam.step, 'datetime')}
            onPickAlternative={() => editFrom(seam.step, 'datetime')}
          />
        )
      }
      if (receipt === null) return null
      return (
        <DoneStep
          receipt={receipt}
          storeAddress={seam.storeDetail?.address ?? ''}
          onManage={seam.toManage}
        />
      )
    },
    [contact, conflict, drop, editFrom, failed, lookUp, moveTo, now, receipt, send, submitting],
  )

  return <PublicBookingApp slug={slug} flow={flow} laterSteps={laterSteps} />
}

/**
 * ご予約の変更の候補。WEB-03-DATETIME をそのまま使い、読む先だけを
 * 「自分の予約を除いた空き」（`/api/public/reservations/:code/availability`）へ差し替える。
 */
function ManageDateTime({
  heading,
  opened,
  onPick,
}: {
  heading: string
  opened: { current: OpenedReservation | null }
  onPick: (startsAt: string) => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [today] = useState(() => toJstDateString(new Date()))
  const keys = opened.current

  const loadWeek = useCallback(
    async (from: string, to: string): Promise<PublicAvailabilityResponse> => {
      const current = opened.current
      if (current === null || current.purposeId === null) return { days: [] }
      const query = new URLSearchParams({ purposeId: current.purposeId, from, to })
      const res = await fetch(
        `/api/public/reservations/${encodeURIComponent(current.code)}/availability?${query}`,
        { headers: { [MANAGEMENT_HEADER]: current.managementCode } },
      )
      if (!res.ok) throw new Error(`availability: ${res.status}`)
      return (await res.json()) as PublicAvailabilityResponse
    },
    [opened],
  )

  if (keys === null || keys.purposeId === null) return null
  return (
    <DateTimeStep
      heading={heading}
      purpose={{ id: keys.purposeId, name: '', durationMinutes: keys.durationMinutes }}
      today={today}
      lastAcceptedDate={shiftDate(today, ACCEPT_UNTIL_DAYS)}
      loadWeek={loadWeek}
      startsAt={picked}
      onSelect={setPicked}
      onNext={() => {
        if (picked !== null) onPick(picked)
      }}
    />
  )
}
