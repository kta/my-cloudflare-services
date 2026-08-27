import type {
  PublicAvailabilityResponse,
  PublicBookingCreate,
  PublicBookingResult,
  PublicReservationCancel,
  PublicReservationChange,
  PublicReservationChangeResult,
  PublicReservationMutationResult,
  PublicReservationStatus,
  PublicReservationVerification,
  PublicReservationVerificationResult,
  PublicStoreDetail,
  PublicStoreSummary,
} from '@app/contracts'
import { useEffect, useState } from 'react'
import {
  createPublicBookingDraft,
  type PublicBookingDraft,
  publicBookingReducer,
} from './public-booking'
import { PublicBookingRequestError } from './public-booking-client'

export type PublicBookingApi = {
  listStores: () => Promise<PublicStoreSummary[]>
  readStore: (slug: string) => Promise<PublicStoreDetail>
  readSlots: (
    slug: string,
    date: string,
    purposeIds: string[],
  ) => Promise<PublicAvailabilityResponse>
  createReservation: (
    slug: string,
    input: PublicBookingCreate,
    idempotencyKey: string,
  ) => Promise<PublicBookingResult>
  readReservationStatus: (confirmationKey: string) => Promise<PublicReservationStatus>
  verifyReservation: (
    input: PublicReservationVerification,
  ) => Promise<PublicReservationVerificationResult>
  cancelReservation: (
    reservationId: string,
    input: PublicReservationCancel,
    verificationToken: string,
    idempotencyKey: string,
  ) => Promise<PublicReservationMutationResult>
  changeReservation: (
    reservationId: string,
    input: PublicReservationChange,
    verificationToken: string,
    idempotencyKey: string,
  ) => Promise<PublicReservationChangeResult>
}

type PublicBookingProps = {
  api: PublicBookingApi
  createConfirmationKey?: () => string
  initialStoreSlug?: string
}

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 店舗ページの「営業時間 10:00–19:00」。定休日しか無ければそう言う。 */
function businessHoursLabel(detail: PublicStoreDetail): string {
  const ranges = new Set(
    detail.businessHours.flatMap((day) =>
      day.periods.map((period) => `${period.startTime}–${period.endTime}`),
    ),
  )
  return ranges.size === 0 ? '設定なし' : [...ranges].join(' / ')
}

/**
 * 承認済みモックの「8月28日（金）」。曜日は日付文字列から決まるので時計は読まない。
 */
function japaneseMonthDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = WEEKDAY[new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay()]
  return `${Number(month)}月${Number(day)}日（${weekday}）`
}

function managementCodeErrorMessage(cause: unknown): string {
  if (
    !(cause instanceof PublicBookingRequestError) ||
    cause.status !== 401 ||
    typeof cause.payload !== 'object' ||
    cause.payload === null
  ) {
    return '管理コードを確認できませんでした。メールに記載されたコードをご確認ください。'
  }
  const payload = cause.payload
  const contactPhone =
    'contactPhone' in payload && typeof payload.contactPhone === 'string'
      ? payload.contactPhone
      : undefined
  const reissueRequired = 'reissueRequired' in payload && payload.reissueRequired === true
  if (contactPhone && reissueRequired)
    return `管理コードの有効期限切れ、または試行上限に達しました。${contactPhone}へご連絡ください。再発行は会社側で本人確認後に行います。`
  return '管理コードを確認できませんでした。メールに記載されたコードをご確認ください。'
}

/** 顧客フローの緑のヘッダー。工程 1〜5 は同じ帯の中に 5 本の線で出す。 */
function Head({ title, step }: { title: string; step?: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <header className="-mx-5 -mt-5 bg-pine px-5 py-5 text-on-pine">
      <h1 className="font-display font-semibold text-xl">EYEX予約</h1>
      <p className="text-sm">{title}</p>
      {step !== undefined && (
        <div
          aria-label={`予約工程 ${step} / 5`}
          aria-valuemax={5}
          aria-valuemin={1}
          aria-valuenow={step}
          className="mt-3 flex gap-1"
          role="progressbar"
        >
          {[1, 2, 3, 4, 5].map((index) => (
            <span
              key={index}
              className={`h-1 flex-1 ${index <= step ? 'bg-on-pine' : 'bg-on-pine/30'}`}
            />
          ))}
        </div>
      )}
    </header>
  )
}

export function PublicBooking({
  api,
  createConfirmationKey = () => crypto.randomUUID(),
  initialStoreSlug,
}: PublicBookingProps) {
  const [stores, setStores] = useState<PublicStoreSummary[]>([])
  const [storeQuery, setStoreQuery] = useState('')
  const [draft, setDraft] = useState<PublicBookingDraft>(createPublicBookingDraft)
  const [detail, setDetail] = useState<PublicStoreDetail>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [slotDate, setSlotDate] = useState('')
  const [slots, setSlots] = useState<PublicAvailabilityResponse['slots']>([])
  const [customer, setCustomer] = useState<PublicBookingCreate['customer']>({
    name: '',
    kana: '',
    phone: '',
    email: '',
  })
  const [booking, setBooking] = useState<PublicBookingResult>()
  const [unknownMessage, setUnknownMessage] = useState<string>()
  const [managementMode, setManagementMode] = useState<
    'identity' | 'verified' | 'change' | 'cancelled'
  >()
  const [reservationNumber, setReservationNumber] = useState('')
  const [managementCode, setManagementCode] = useState('')
  const [verifiedReservation, setVerifiedReservation] =
    useState<PublicReservationVerificationResult>()
  const [managementError, setManagementError] = useState<string>()
  const [cancellationKey, setCancellationKey] = useState<string>()
  const [changeDate, setChangeDate] = useState('')
  const [changeSlots, setChangeSlots] = useState<PublicAvailabilityResponse['slots']>([])
  const [changeKey, setChangeKey] = useState<string>()
  const [managementSuccess, setManagementSuccess] = useState<string>()
  /** 選ぶことと進むことを分ける（承認済みモックの「日時へ進む」「お客様情報へ進む」）。 */
  const [pendingPurposeId, setPendingPurposeId] = useState<string>()
  const [pendingSlot, setPendingSlot] = useState<{
    startAt: string
    date: string
    startTime: string
  }>()
  const selectedPurpose = detail?.purposes.find((purpose) => purpose.id === draft.purposeIds[0])
  const matchingStores = stores.filter((store) => {
    const query = storeQuery.trim().toLocaleLowerCase('ja-JP')
    return (
      query === '' ||
      [store.name, store.region, store.nearestStation].some((value) =>
        value.toLocaleLowerCase('ja-JP').includes(query),
      )
    )
  })

  useEffect(() => {
    void api
      .listStores()
      .then((result) => setStores(result))
      .catch(() => setError('店舗を読み込めませんでした。通信を確認してもう一度お試しください。'))
      .finally(() => setLoading(false))
  }, [api])

  const selectStore = async (store: PublicStoreSummary) => {
    setError(undefined)
    try {
      const nextDetail = await api.readStore(store.slug)
      setDetail(nextDetail)
      setDraft((current) => publicBookingReducer(current, { type: 'store_selected', store }))
    } catch {
      setError('店舗情報を読み込めませんでした。通信を確認してもう一度お試しください。')
    }
  }

  useEffect(() => {
    if (!initialStoreSlug || draft.store !== undefined || stores.length === 0) return
    const store = stores.find((candidate) => candidate.slug === initialStoreSlug)
    if (store) void selectStore(store)
  }, [initialStoreSlug, stores, draft.store])

  const loadSlots = async (date: string) => {
    if (!draft.store || draft.purposeIds.length === 0) return
    setSlotDate(date)
    setError(undefined)
    try {
      setSlots((await api.readSlots(draft.store.slug, date, draft.purposeIds)).slots)
    } catch {
      setError('空き時間を読み込めませんでした。通信を確認してもう一度お試しください。')
    }
  }

  const confirmCustomer = () => {
    const confirmationKey = draft.confirmationKey ?? createConfirmationKey()
    setDraft((current) =>
      publicBookingReducer(publicBookingReducer(current, { type: 'customer_entered', customer }), {
        type: 'confirmation_opened',
        confirmationKey,
      }),
    )
  }
  const submitBooking = async () => {
    if (!draft.store || !draft.date || !draft.startTime || !draft.confirmationKey) return
    setError(undefined)
    try {
      const result = await api.createReservation(
        draft.store.slug,
        {
          date: draft.date,
          startTime: draft.startTime,
          purposeIds: draft.purposeIds,
          customer: draft.customer ?? customer,
          consentVersion: 'web-booking-v1',
        },
        draft.confirmationKey,
      )
      setBooking(result)
      setDraft((current) => publicBookingReducer(current, { type: 'booking_succeeded' }))
    } catch (cause) {
      if (cause instanceof PublicBookingRequestError && cause.status === 409) {
        setDraft((current) => publicBookingReducer(current, { type: 'booking_conflicted' }))
        // 埋まった枠は選び直す。選択済みのまま戻すと同じ枠を再送させてしまう。
        setPendingSlot(undefined)
        void loadSlots(draft.date)
        return
      }
      setDraft((current) => publicBookingReducer(current, { type: 'booking_result_unknown' }))
    }
  }
  const resolveUnknownResult = async () => {
    if (!draft.confirmationKey) return
    setUnknownMessage(undefined)
    try {
      const result = await api.readReservationStatus(draft.confirmationKey)
      if (result.status === 'confirmed') {
        setDraft((current) =>
          publicBookingReducer(current, { type: 'booking_status_resolved', status: result.status }),
        )
        return
      }
      setUnknownMessage(
        result.status === 'pending'
          ? 'まだ確定処理中です。少し時間をおいて、もう一度ご確認ください。'
          : '予約の成立を確認できませんでした。同じ内容で再度予約できます。',
      )
    } catch {
      setUnknownMessage('成立状況を確認できませんでした。通信を確認して、もう一度お試しください。')
    }
  }
  const openManagement = () => {
    setReservationNumber(booking?.reservationNumber ?? '')
    setManagementCode('')
    setManagementError(undefined)
    setManagementMode('identity')
  }
  const verifyManagementCode = async () => {
    setManagementError(undefined)
    try {
      const result = await api.verifyReservation({ reservationNumber, managementCode })
      setVerifiedReservation(result)
      setManagementMode('verified')
    } catch (cause) {
      setManagementError(managementCodeErrorMessage(cause))
    }
  }
  const cancelVerifiedReservation = async () => {
    if (!verifiedReservation) return
    const idempotencyKey = cancellationKey ?? createConfirmationKey()
    setCancellationKey(idempotencyKey)
    setManagementError(undefined)
    try {
      await api.cancelReservation(
        verifiedReservation.reservationId,
        { version: verifiedReservation.version },
        verifiedReservation.verificationToken,
        idempotencyKey,
      )
      setManagementMode('cancelled')
    } catch {
      setManagementError('予約を取り消せませんでした。期限または通信状態をご確認ください。')
    }
  }
  const loadChangeSlots = async (date: string) => {
    if (!verifiedReservation) return
    setChangeDate(date)
    setManagementError(undefined)
    try {
      setChangeSlots(
        (await api.readSlots(verifiedReservation.storeSlug, date, verifiedReservation.purposeIds))
          .slots,
      )
    } catch {
      setManagementError('空き時間を読み込めませんでした。通信を確認してもう一度お試しください。')
    }
  }
  const changeVerifiedReservation = async (date: string, startTime: string) => {
    if (!verifiedReservation) return
    const idempotencyKey = changeKey ?? createConfirmationKey()
    setChangeKey(idempotencyKey)
    setManagementError(undefined)
    try {
      const result = await api.changeReservation(
        verifiedReservation.reservationId,
        {
          version: verifiedReservation.version,
          date,
          startTime,
          purposeIds: verifiedReservation.purposeIds,
        },
        verifiedReservation.verificationToken,
        idempotencyKey,
      )
      setVerifiedReservation({
        ...verifiedReservation,
        version: result.version,
        startAt: result.startAt,
        purposeIds: result.purposeIds,
      })
      setManagementSuccess('予約を変更しました。')
      setManagementMode('verified')
    } catch {
      setManagementError('予約を変更できませんでした。別の時間を選ぶか、確認し直してください。')
    }
  }

  if (loading)
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink" aria-busy="true">
        店舗を読み込んでいます。
      </main>
    )
  if (error && draft.step === 'store')
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink" role="alert">
        {error}
      </main>
    )

  if (managementMode === 'identity') {
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink">
        <Head title={'予約の変更・取消'} />
        <section className="mx-auto max-w-md py-7">
          <h2 className="font-display text-3xl font-semibold">本人確認コードを入力</h2>
          <p className="mt-3 text-sm text-ink-muted">
            予約完了メールに記載された、会社発行の管理コードを入力してください。
          </p>
          <label
            className="mt-5 block font-semibold"
            htmlFor="public-management-reservation-number"
          >
            予約番号
            <input
              id="public-management-reservation-number"
              value={reservationNumber}
              className="mt-2 min-h-12 w-full rounded-ctl border border-line bg-surface px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
              onChange={(event) => setReservationNumber(event.target.value)}
            />
          </label>
          <label className="mt-4 block font-semibold" htmlFor="public-management-code">
            会社発行の管理コード
            <input
              id="public-management-code"
              value={managementCode}
              className="mt-2 min-h-12 w-full rounded-ctl border border-line bg-surface px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
              onChange={(event) => setManagementCode(event.target.value)}
            />
          </label>
          {managementError && (
            <p className="mt-4 text-danger" role="alert">
              {managementError}
            </p>
          )}
          <button
            type="button"
            className="mt-6 min-h-12 w-full rounded-ctl bg-pine px-4 font-semibold text-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
            onClick={() => void verifyManagementCode()}
          >
            予約を表示する
          </button>
        </section>
      </main>
    )
  }

  if (managementMode === 'verified' && verifiedReservation) {
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink">
        <Head title={'予約の変更・取消'} />
        <section className="mx-auto max-w-md py-7">
          <h2 className="font-display text-3xl font-semibold">予約内容を確認しました</h2>
          <p className="mt-5 rounded-ctl bg-surface p-4">
            予約番号 {reservationNumber}
            <br />
            予約日時 {verifiedReservation.startAt}
          </p>
          <p className="mt-4 text-sm text-ink-muted">
            この確認は
            {new Date(verifiedReservation.expiresAt).toLocaleTimeString('ja-JP', {
              hour: '2-digit',
              minute: '2-digit',
            })}
            まで有効です。
          </p>
          {managementSuccess && (
            <p className="mt-4 text-ink-muted" role="status">
              {managementSuccess}
            </p>
          )}
          {managementError && (
            <p className="mt-4 text-danger" role="alert">
              {managementError}
            </p>
          )}
          <button
            type="button"
            className="mt-6 min-h-12 w-full rounded-ctl border border-line bg-surface px-4 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
            onClick={() => {
              setManagementError(undefined)
              setManagementSuccess(undefined)
              setChangeSlots([])
              setManagementMode('change')
            }}
          >
            予約日時を変更する
          </button>
          <button
            type="button"
            className="mt-4 min-h-12 w-full rounded-ctl border border-danger bg-surface px-4 font-semibold text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
            onClick={() => void cancelVerifiedReservation()}
          >
            予約を取り消す
          </button>
        </section>
      </main>
    )
  }

  if (managementMode === 'change' && verifiedReservation)
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink">
        <Head title={'予約日時の変更'} />
        <section className="mx-auto max-w-md py-7">
          <h2 className="font-display text-3xl font-semibold">変更後の日時を選ぶ</h2>
          <label className="mt-5 block font-semibold" htmlFor="public-change-date">
            変更後の日
            <input
              id="public-change-date"
              type="date"
              value={changeDate}
              className="mt-2 min-h-12 w-full rounded-ctl border border-line bg-surface px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
              onChange={(event) => void loadChangeSlots(event.target.value)}
            />
          </label>
          {managementError && (
            <p className="mt-4 text-danger" role="alert">
              {managementError}
            </p>
          )}
          <ul className="mt-5 space-y-3">
            {changeSlots.map((slot) => (
              <li key={slot.startAt}>
                <button
                  type="button"
                  className="min-h-12 w-full rounded-ctl border border-line bg-surface p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
                  onClick={() => void changeVerifiedReservation(slot.date, slot.startTime)}
                >
                  {japaneseMonthDay(slot.date)} {slot.startTime}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </main>
    )

  if (managementMode === 'cancelled')
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink">
        <section className="mx-auto max-w-md py-20 text-center">
          <h2 className="font-display text-3xl font-semibold">予約を取り消しました</h2>
          <p className="mt-5 text-ink-muted">取消内容はメールでもお知らせします。</p>
        </section>
      </main>
    )

  if (draft.step === 'unknown') {
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink">
        <Head title={'予約状況の確認'} />
        <section className="mx-auto max-w-md py-7">
          <h2 className="font-display text-3xl font-semibold">予約結果を確認しています</h2>
          <div className="mt-5 rounded-ctl border border-amber bg-amber-soft p-4">
            <p className="font-semibold">通信が途中で切れました</p>
            <p>もう一度予約ボタンを押さず、この画面で成立状況を確認してください。</p>
          </div>
          {draft.confirmationKey && (
            <p className="mt-4 rounded-ctl bg-surface p-4 text-sm">
              照会番号 {draft.confirmationKey}
            </p>
          )}
          {unknownMessage && (
            <p className="mt-4 text-ink-muted" role="status">
              {unknownMessage}
            </p>
          )}
          <button
            type="button"
            className="mt-6 min-h-12 w-full rounded-ctl bg-pine px-4 font-semibold text-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
            onClick={() => void resolveUnknownResult()}
          >
            成立状況を再確認する
          </button>
        </section>
      </main>
    )
  }

  if (draft.step === 'complete' && detail) {
    const recovered = !booking
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink">
        <Head title={detail.name} step={5} />
        <section className="mx-auto max-w-md py-20 text-center">
          <p aria-hidden="true" className="font-display text-6xl text-pine">
            ✓
          </p>
          <h2 className="mt-4 font-display text-3xl font-semibold">
            {recovered ? '予約の成立を確認しました' : '予約を承りました'}
          </h2>
          <p className="mt-5 rounded-ctl bg-surface p-4">
            {booking ? (
              <>
                予約番号 {booking.reservationNumber}
                <br />
              </>
            ) : (
              '予約の詳細はメールをご確認ください。'
            )}
            {draft.date && japaneseMonthDay(draft.date)} {draft.startTime}
            <br />
            {detail.name}
            <br />
            お問い合わせ {detail.contactPhone}
          </p>
          <button
            type="button"
            className="mt-6 min-h-12 rounded-ctl border border-line bg-surface px-4 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
            onClick={openManagement}
          >
            予約を変更・取り消す
          </button>
          <p className="mt-4 text-sm text-ink-muted">
            変更・取消は、会社発行の管理コードで行えます。
          </p>
        </section>
      </main>
    )
  }

  if (draft.step === 'store') {
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink">
        <Head title={'店舗を探す'} />
        <section className="mx-auto max-w-md py-7">
          <h2 className="font-display text-3xl font-semibold">予約する店舗を探す</h2>
          <p className="mt-2 text-sm text-ink-muted">
            地域、駅名、店舗名から予約店舗を選択してください。
          </p>
          <label className="mt-5 block font-semibold" htmlFor="public-store-query">
            店舗を検索
            <input
              id="public-store-query"
              value={storeQuery}
              className="mt-2 min-h-12 w-full rounded-ctl border border-line bg-surface px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
              placeholder="現在地・駅名・店舗名・地域"
              onChange={(event) => setStoreQuery(event.target.value)}
            />
          </label>
          {stores.length === 0 ? (
            <p className="mt-5 rounded-ctl bg-surface p-4" role="status">
              現在、Web予約を受け付けている店舗はありません。
            </p>
          ) : matchingStores.length === 0 ? (
            <p className="mt-5 rounded-ctl bg-surface p-4" role="status">
              該当する店舗が見つかりません。駅名・店舗名・地域を変えてお試しください。
            </p>
          ) : (
            <ul className="mt-5 space-y-3">
              {matchingStores.map((store) => (
                <li key={store.slug}>
                  <button
                    type="button"
                    className="min-h-12 w-full rounded-ctl border border-line bg-surface p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
                    onClick={() => void selectStore(store)}
                  >
                    <span className="block font-semibold">{store.name}</span>
                    <span className="mt-1 block text-sm text-ink-muted">
                      {store.nearestStation} · {store.region}
                    </span>
                    <span className="mt-3 block font-semibold text-pine text-sm">
                      店舗情報を見る
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    )
  }

  if (draft.step === 'store_detail' && detail) {
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink">
        <Head title={detail.name} />
        <section className="mx-auto max-w-md py-7">
          <h2 className="font-display text-3xl font-semibold">{detail.name}</h2>
          <p className="mt-4 rounded-ctl bg-surface p-4 text-sm">
            営業時間 {businessHoursLabel(detail)}
            <br />
            {detail.accessText}
            <br />
            {detail.contactPhone}
            <br />
            {detail.notice}
          </p>
          <h3 className="mt-5 font-display font-semibold text-lg">対応サービス</h3>
          <p className="mt-2 text-sm">
            {detail.purposes.map((purpose) => purpose.label).join('、')}
          </p>
          <button
            type="button"
            className="mt-6 min-h-12 w-full rounded-ctl bg-pine px-4 font-semibold text-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
            onClick={() =>
              setDraft((current) => publicBookingReducer(current, { type: 'booking_started' }))
            }
          >
            {detail.name}で予約を始める
          </button>
        </section>
      </main>
    )
  }

  if (draft.step === 'purpose' && detail) {
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink">
        <Head title={detail.name} step={1} />
        <section className="mx-auto max-w-md py-7">
          <p className="text-sm text-ink-muted">1 / 5　来店目的</p>
          <h2 className="mt-2 font-display text-3xl font-semibold">
            今回はどのようなご相談ですか？
          </h2>
          <ul className="mt-5 space-y-3">
            {detail.purposes.map((purpose) => (
              <li key={purpose.id}>
                <button
                  type="button"
                  aria-pressed={pendingPurposeId === purpose.id}
                  className={`min-h-12 w-full rounded-ctl p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
                    pendingPurposeId === purpose.id
                      ? 'border-2 border-pine bg-pine-soft'
                      : 'border border-line bg-surface'
                  }`}
                  onClick={() => setPendingPurposeId(purpose.id)}
                >
                  <span className="block font-semibold">{purpose.label}</span>
                  <span className="mt-1 block text-ink-muted text-sm">
                    約{purpose.durationMinutes}分
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={pendingPurposeId === undefined}
            className="mt-6 min-h-12 w-full rounded-ctl bg-pine px-4 font-semibold text-on-pine focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
            onClick={() => {
              if (pendingPurposeId === undefined) return
              setDraft((current) =>
                publicBookingReducer(current, {
                  type: 'purposes_selected',
                  purposeIds: [pendingPurposeId],
                }),
              )
            }}
          >
            日時へ進む
          </button>
        </section>
      </main>
    )
  }

  if (draft.step === 'datetime' && detail) {
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink">
        <Head title={detail.name} step={2} />
        <section className="mx-auto max-w-md py-7">
          <p className="text-sm text-ink-muted">2 / 5　日時</p>
          <h2 className="mt-2 font-display text-3xl font-semibold">ご希望の日時を選んでください</h2>
          {selectedPurpose && (
            <p className="mt-4 rounded-ctl bg-surface p-4 text-sm">
              {selectedPurpose.label} · 約{selectedPurpose.durationMinutes}分
            </p>
          )}
          <label className="mt-5 block font-semibold" htmlFor="public-booking-date">
            ご希望の日
            <input
              id="public-booking-date"
              type="date"
              value={slotDate}
              className="mt-2 min-h-12 w-full rounded-ctl border border-line bg-surface px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
              onChange={(event) => void loadSlots(event.target.value)}
            />
          </label>
          {draft.error === 'slot_unavailable' && (
            <p role="alert" className="mt-4 text-danger">
              選択した時間は他のお客様の予約で埋まりました。別の時間を選んでください。
            </p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-danger">
              {error}
            </p>
          )}
          <ul className="mt-5 space-y-3">
            {slots.map((slot) => (
              <li key={slot.startAt}>
                <button
                  type="button"
                  aria-pressed={pendingSlot?.startAt === slot.startAt}
                  className={`min-h-12 w-full rounded-ctl p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
                    pendingSlot?.startAt === slot.startAt
                      ? 'border-2 border-pine bg-pine-soft'
                      : 'border border-line bg-surface'
                  }`}
                  onClick={() =>
                    setPendingSlot({
                      startAt: slot.startAt,
                      date: slot.date,
                      startTime: slot.startTime,
                    })
                  }
                >
                  {japaneseMonthDay(slot.date)} {slot.startTime}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={pendingSlot === undefined}
            className="mt-6 min-h-12 w-full rounded-ctl bg-pine px-4 font-semibold text-on-pine focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
            onClick={() => {
              if (pendingSlot === undefined) return
              setDraft((current) =>
                publicBookingReducer(current, {
                  type: 'slot_selected',
                  date: pendingSlot.date,
                  startTime: pendingSlot.startTime,
                }),
              )
            }}
          >
            お客様情報へ進む
          </button>
        </section>
      </main>
    )
  }

  if (draft.step === 'customer' && detail) {
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink">
        <Head title={detail.name} step={3} />
        <section className="mx-auto max-w-md py-7">
          <p className="text-sm text-ink-muted">3 / 5　お客様情報</p>
          <h2 className="mt-2 font-display text-3xl font-semibold">ご連絡先を入力してください</h2>
          <div className="mt-5 space-y-4">
            <label className="block font-semibold" htmlFor="public-customer-name">
              お名前
              <input
                id="public-customer-name"
                value={customer.name}
                className="mt-2 min-h-12 w-full rounded-ctl border border-line bg-surface px-3"
                onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
              />
            </label>
            <label className="block font-semibold" htmlFor="public-customer-kana">
              お名前（かな）
              <input
                id="public-customer-kana"
                value={customer.kana}
                className="mt-2 min-h-12 w-full rounded-ctl border border-line bg-surface px-3"
                onChange={(event) => setCustomer({ ...customer, kana: event.target.value })}
              />
            </label>
            <label className="block font-semibold" htmlFor="public-customer-phone">
              電話番号
              <input
                id="public-customer-phone"
                inputMode="tel"
                value={customer.phone}
                className="mt-2 min-h-12 w-full rounded-ctl border border-line bg-surface px-3"
                onChange={(event) => setCustomer({ ...customer, phone: event.target.value })}
              />
            </label>
            <label className="block font-semibold" htmlFor="public-customer-email">
              メールアドレス
              <input
                id="public-customer-email"
                type="email"
                value={customer.email ?? ''}
                className="mt-2 min-h-12 w-full rounded-ctl border border-line bg-surface px-3"
                onChange={(event) => setCustomer({ ...customer, email: event.target.value })}
              />
            </label>
          </div>
          <button
            type="button"
            className="mt-6 min-h-12 w-full rounded-ctl bg-pine px-4 font-semibold text-on-pine"
            onClick={confirmCustomer}
          >
            確認へ進む
          </button>
        </section>
      </main>
    )
  }

  if (draft.step === 'confirm' && detail && draft.customer) {
    return (
      <main className="min-h-dvh bg-paper p-5 text-ink">
        <Head title={detail.name} step={4} />
        <section className="mx-auto max-w-md py-7">
          <p className="text-sm text-ink-muted">4 / 5　確認</p>
          <h2 className="mt-2 font-display text-3xl font-semibold">予約内容をご確認ください</h2>
          <p className="mt-5 rounded-ctl bg-surface p-4">
            {detail.name}
            <br />
            {draft.date && japaneseMonthDay(draft.date)} {draft.startTime}
            <br />
            {selectedPurpose?.label} · 約{selectedPurpose?.durationMinutes}分<br />
            {draft.customer.name}
            <br />
            {draft.customer.phone}
            <br />
            {detail.notice}
          </p>
          <p className="mt-4 rounded-ctl border border-line bg-surface p-4 text-sm">
            変更・取消期限と店舗からのご案内を確認しました。
          </p>
          {error && (
            <p role="alert" className="mt-4 text-danger">
              {error}
            </p>
          )}
          <button
            type="button"
            className="mt-6 min-h-12 w-full rounded-ctl bg-pine px-4 font-semibold text-surface"
            onClick={() => void submitBooking()}
          >
            この内容で予約する
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-paper p-5 text-ink">
      <p>予約情報を準備しています。</p>
    </main>
  )
}
