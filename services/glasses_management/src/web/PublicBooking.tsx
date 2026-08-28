import type {
  PublicBookingCreate,
  PublicBookingResult,
  PublicOffersResponse,
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
  PhoneBody,
  PhoneButton,
  PhoneCard,
  PhoneField,
  PhoneHead,
  PhoneInput,
  PhoneOption,
  PhonePrimary,
  PhoneScreen,
  PhoneSummary,
} from './design/phone'
import {
  createPublicBookingDraft,
  type PublicBookingDraft,
  publicBookingReducer,
} from './public-booking'
import { PublicBookingRequestError } from './public-booking-client'

export type PublicBookingApi = {
  listStores: () => Promise<PublicStoreSummary[]>
  readStore: (slug: string) => Promise<PublicStoreDetail>
  /*
   * 候補枠は日付を受け取らない。承認済みモックの第 2 工程は「8月28日（金）
   * 11:00」の既製のショートリストで、顧客に日付を打たせない（打たせると
   * 最初の操作がカレンダー入力になり、候補が 1 日に閉じる）。日付は入力では
   * なく走査の結果である。
   */
  readOffers: (slug: string, purposeIds: string[]) => Promise<PublicOffersResponse>
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

/**
 * 承認済みモックの「8月28日（金）11:00」。閉じ括弧が既に区切りとして働くので、
 * 日と時刻のあいだに空白を挟まない。
 */
function japaneseSlotLabel(date: string, startTime: string): string {
  return `${japaneseMonthDay(date)}${startTime}`
}

/** 保存されているインスタントを、承認済みモックと同じ「8月28日（金）11:00」へ。 */
function formatJstSlot(instant: string): string {
  const at = new Date(instant)
  if (Number.isNaN(at.getTime())) return instant
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${value('month')}月${value('day')}日（${value('weekday')}）${value('hour')}:${value('minute')}`
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

/** 5 工程の帯。実アプリでは工程が動くので、目盛りに読み上げ用の名前を持たせる。 */
function bookingProgress(step: 1 | 2 | 3 | 4 | 5) {
  return { current: step, total: 5, label: `予約工程 ${step} / 5` }
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
  const [offers, setOffers] = useState<PublicOffersResponse['slots']>()
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
  const [changeSlots, setChangeSlots] = useState<PublicOffersResponse['slots']>()
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

  const loadOffers = async (store: { slug: string }, purposeIds: string[]) => {
    setError(undefined)
    try {
      setOffers((await api.readOffers(store.slug, purposeIds)).slots)
    } catch {
      setError('空き時間を読み込めませんでした。通信を確認してもう一度お試しください。')
    }
  }

  /*
   * 日時の工程に入ったら候補を読む。顧客の第 1 操作を日付入力にしないための
   * 読み込みなので、面が開いた時点で走らせる（`readOffers` は日付を取らない）。
   */
  useEffect(() => {
    if (draft.step !== 'datetime' || draft.store === undefined || offers !== undefined) return
    void loadOffers(draft.store, draft.purposeIds)
  }, [draft.step, draft.store, draft.purposeIds, offers])

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
        if (draft.store) void loadOffers(draft.store, draft.purposeIds)
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
  const loadChangeOffers = async (reservation: PublicReservationVerificationResult) => {
    setManagementError(undefined)
    try {
      setChangeSlots((await api.readOffers(reservation.storeSlug, reservation.purposeIds)).slots)
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
      <PhoneScreen>
        <PhoneHead store="店舗を探す" />
        <PhoneBody>
          <p aria-busy="true">店舗を読み込んでいます。</p>
        </PhoneBody>
      </PhoneScreen>
    )
  if (error && draft.step === 'store')
    return (
      <PhoneScreen>
        <PhoneHead store="店舗を探す" />
        <PhoneBody>
          <h1>予約する店舗を探す</h1>
          <PhoneCard tone="error">
            <p role="alert">{error}</p>
          </PhoneCard>
        </PhoneBody>
      </PhoneScreen>
    )

  if (managementMode === 'identity') {
    return (
      <PhoneScreen>
        <PhoneHead store="予約の変更・取消" />
        <PhoneBody>
          <h1>本人確認コードを入力</h1>
          <p>予約完了メールに記載された、会社発行の管理コードを入力してください。</p>
          <PhoneField label="予約番号" value={reservationNumber} onChange={setReservationNumber} />
          <PhoneField
            label="会社発行の管理コード"
            value={managementCode}
            onChange={setManagementCode}
          />
          {managementError && (
            <PhoneCard tone="error">
              <p role="alert">{managementError}</p>
            </PhoneCard>
          )}
        </PhoneBody>
        <PhonePrimary onClick={() => void verifyManagementCode()}>予約を表示する</PhonePrimary>
      </PhoneScreen>
    )
  }

  if (managementMode === 'verified' && verifiedReservation) {
    return (
      <PhoneScreen>
        <PhoneHead store="予約の変更・取消" />
        <PhoneBody>
          <h1>予約内容を確認しました</h1>
          <PhoneSummary>
            予約番号 {reservationNumber}
            <br />
            {/* 保存されているのはインスタント。お客様には JST の日本語で読ませる。 */}
            予約日時 {formatJstSlot(verifiedReservation.startAt)}
          </PhoneSummary>
          <p>
            <small>
              この確認は
              {new Date(verifiedReservation.expiresAt).toLocaleTimeString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit',
              })}
              まで有効です。
            </small>
          </p>
          {managementSuccess && <p role="status">{managementSuccess}</p>}
          {managementError && (
            <PhoneCard tone="error">
              <p role="alert">{managementError}</p>
            </PhoneCard>
          )}
          {/* 取り消しは取り返しがつかないので、下端の主操作には置かない。 */}
          <PhoneButton onClick={() => void cancelVerifiedReservation()}>予約を取り消す</PhoneButton>
        </PhoneBody>
        <PhonePrimary
          onClick={() => {
            setManagementError(undefined)
            setManagementSuccess(undefined)
            setChangeSlots(undefined)
            setManagementMode('change')
            // 変更でも日付は打たせない。候補を先に読んで並べる。
            void loadChangeOffers(verifiedReservation)
          }}
        >
          予約日時を変更する
        </PhonePrimary>
      </PhoneScreen>
    )
  }

  if (managementMode === 'change' && verifiedReservation)
    return (
      <PhoneScreen>
        <PhoneHead store="予約日時の変更" />
        <PhoneBody>
          <h1>変更後の日時を選ぶ</h1>
          {managementError && (
            <PhoneCard tone="error">
              <p role="alert">{managementError}</p>
            </PhoneCard>
          )}
          {changeSlots !== undefined && changeSlots.length === 0 && (
            <PhoneCard>
              <p role="status">
                空いている日時が見つかりませんでした。お手数ですが店舗へお電話ください。
              </p>
            </PhoneCard>
          )}
          {(changeSlots ?? []).map((slot) => (
            <PhoneOption
              key={slot.startAt}
              onClick={() => void changeVerifiedReservation(slot.date, slot.startTime)}
            >
              {japaneseSlotLabel(slot.date, slot.startTime)}
            </PhoneOption>
          ))}
        </PhoneBody>
      </PhoneScreen>
    )

  if (managementMode === 'cancelled')
    return (
      <PhoneScreen>
        <PhoneHead store="予約の変更・取消" />
        <PhoneBody centered>
          <h1>予約を取り消しました</h1>
          <p>取消内容はメールでもお知らせします。</p>
        </PhoneBody>
      </PhoneScreen>
    )

  if (draft.step === 'unknown') {
    return (
      <PhoneScreen>
        <PhoneHead store="予約状況の確認" />
        <PhoneBody>
          <h1>予約結果を確認しています</h1>
          {/* 読み上げでは見出しだけでは「今どうなっているか」が伝わらない。 */}
          <p role="status" aria-live="polite" className="sr-only">
            予約結果を確認しています
          </p>
          <PhoneCard tone="error">
            <b>通信が途中で切れました</b>
            <br />
            もう一度予約ボタンを押さず、この画面で成立状況を確認してください。
          </PhoneCard>
          {/*
           * 照会番号（＝送信に使った冪等キー）はここに出さない。顧客が控える意味が
           * 無いうえ、他人に読み上げられると同じ鍵で成立状況を引かれてしまう。
           */}
          {unknownMessage && <p role="status">{unknownMessage}</p>}
        </PhoneBody>
        <PhonePrimary onClick={() => void resolveUnknownResult()}>
          成立状況を再確認する
        </PhonePrimary>
      </PhoneScreen>
    )
  }

  if (draft.step === 'complete' && detail) {
    const recovered = !booking
    return (
      <PhoneScreen>
        <PhoneHead store={detail.name} progress={bookingProgress(5)} />
        <PhoneBody centered>
          {/* ✓ は和文書体が持たない記号なので、モックと同じ代替書体へ落とす。 */}
          <strong aria-hidden="true" className="font-glyph text-glyph text-pine">
            ✓
          </strong>
          <h1>{recovered ? '予約の成立を確認しました' : '予約を承りました'}</h1>
          <PhoneSummary>
            {booking ? (
              <>
                予約番号 {booking.reservationNumber}
                <br />
              </>
            ) : (
              <>
                予約の詳細はメールをご確認ください。
                <br />
              </>
            )}
            {draft.date && draft.startTime && japaneseSlotLabel(draft.date, draft.startTime)}
            <br />
            {/*
             * 店舗の電話番号はここに出さない。AC-EYEX-94 が連絡先を求めるのは
             * 本人確認に失敗した面であって、完了の面ではない。変更・取消の
             * 手順も、すぐ下のボタンが示している——同じことを文でも言うと
             * 押しどころが埋もれる（承認済みモック `WEB-COMPLETE` も 3 行と
             * 1 つの操作だけである）。
             */}
            {detail.name}
          </PhoneSummary>
          <PhoneButton onClick={openManagement}>予約を変更・取り消す</PhoneButton>
        </PhoneBody>
      </PhoneScreen>
    )
  }

  if (draft.step === 'store') {
    return (
      <PhoneScreen>
        <PhoneHead store="店舗を探す" />
        <PhoneBody>
          <h1>予約する店舗を探す</h1>
          <PhoneInput
            label="店舗を検索"
            placeholder="現在地・駅名・店舗名・地域"
            value={storeQuery}
            onChange={setStoreQuery}
          />
          {stores.length === 0 ? (
            <PhoneCard>
              <p role="status">現在、Web予約を受け付けている店舗はありません。</p>
            </PhoneCard>
          ) : matchingStores.length === 0 ? (
            <PhoneCard>
              <p role="status">
                該当する店舗が見つかりません。駅名・店舗名・地域を変えてお試しください。
              </p>
            </PhoneCard>
          ) : (
            matchingStores.map((store) => (
              <PhoneCard key={store.slug}>
                <b>{store.name}</b>
                <br />
                {store.accessText === ''
                  ? `${store.nearestStation} · ${store.region}`
                  : store.accessText}
                <br />
                {store.todayBusinessHours !== null && (
                  <>
                    本日営業 {store.todayBusinessHours}
                    <br />
                  </>
                )}
                {/* 同じ文言の操作が店の数だけ並ぶので、読み上げ名に店名を含める。 */}
                <PhoneButton
                  label={`${store.name}の店舗情報を見る`}
                  onClick={() => void selectStore(store)}
                >
                  店舗情報を見る
                </PhoneButton>
              </PhoneCard>
            ))
          )}
        </PhoneBody>
      </PhoneScreen>
    )
  }

  if (draft.step === 'store_detail' && detail) {
    const services =
      detail.services.length > 0 ? detail.services : detail.purposes.map((purpose) => purpose.label)
    return (
      <PhoneScreen>
        <PhoneHead store={detail.name} />
        <PhoneBody>
          <h1>{detail.name}</h1>
          <PhoneSummary>
            営業時間 {businessHoursLabel(detail)}
            <br />
            {detail.accessText}
            <br />
            {detail.contactPhone}
            <br />
            {detail.notice}
          </PhoneSummary>
          <h2>対応サービス</h2>
          <p>{services.join('、')}</p>
        </PhoneBody>
        <PhonePrimary
          onClick={() =>
            setDraft((current) => publicBookingReducer(current, { type: 'booking_started' }))
          }
        >
          {detail.name}で予約を始める
        </PhonePrimary>
      </PhoneScreen>
    )
  }

  if (draft.step === 'purpose' && detail) {
    return (
      <PhoneScreen>
        <PhoneHead store={detail.name} progress={bookingProgress(1)} />
        <PhoneBody>
          <small>1 / 5　来店目的</small>
          <h1>今回はどのようなご相談ですか？</h1>
          {detail.purposes.map((purpose) => (
            <PhoneOption
              key={purpose.id}
              selected={pendingPurposeId === purpose.id}
              onClick={() => setPendingPurposeId(purpose.id)}
            >
              <b>{purpose.label}</b>
              <br />約{purpose.durationMinutes}分
            </PhoneOption>
          ))}
        </PhoneBody>
        <PhonePrimary
          disabled={pendingPurposeId === undefined}
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
        </PhonePrimary>
      </PhoneScreen>
    )
  }

  if (draft.step === 'datetime' && detail) {
    return (
      <PhoneScreen>
        <PhoneHead store={detail.name} progress={bookingProgress(2)} />
        <PhoneBody>
          <small>2 / 5　日時</small>
          <h1>ご希望の日時を選んでください</h1>
          {selectedPurpose && (
            <PhoneSummary>
              {selectedPurpose.label} · 約{selectedPurpose.durationMinutes}分
            </PhoneSummary>
          )}
          {draft.error === 'slot_unavailable' && (
            <PhoneCard tone="error">
              <p role="alert">
                選択した時間は他のお客様の予約で埋まりました。別の時間を選んでください。
              </p>
            </PhoneCard>
          )}
          {error && (
            <PhoneCard tone="error">
              <p role="alert">{error}</p>
            </PhoneCard>
          )}
          {offers !== undefined && offers.length === 0 && error === undefined && (
            <PhoneCard>
              <p role="status">
                空いている日時が見つかりませんでした。お手数ですが店舗へお電話ください。
              </p>
            </PhoneCard>
          )}
          {(offers ?? []).map((slot) => (
            <PhoneOption
              key={slot.startAt}
              selected={pendingSlot?.startAt === slot.startAt}
              onClick={() =>
                setPendingSlot({
                  startAt: slot.startAt,
                  date: slot.date,
                  startTime: slot.startTime,
                })
              }
            >
              {japaneseSlotLabel(slot.date, slot.startTime)}
            </PhoneOption>
          ))}
        </PhoneBody>
        <PhonePrimary
          disabled={pendingSlot === undefined}
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
        </PhonePrimary>
      </PhoneScreen>
    )
  }

  if (draft.step === 'customer' && detail) {
    return (
      <PhoneScreen>
        <PhoneHead store={detail.name} progress={bookingProgress(3)} />
        <PhoneBody>
          <small>3 / 5　お客様情報</small>
          <h1>ご連絡先を入力してください</h1>
          <PhoneField
            label="お名前"
            value={customer.name}
            onChange={(name) => setCustomer({ ...customer, name })}
          />
          <PhoneField
            label="お名前（かな）"
            value={customer.kana}
            onChange={(kana) => setCustomer({ ...customer, kana })}
          />
          <PhoneField
            label="電話番号"
            inputMode="tel"
            value={customer.phone}
            onChange={(phone) => setCustomer({ ...customer, phone })}
          />
          <PhoneField
            label="メールアドレス"
            type="email"
            inputMode="email"
            value={customer.email ?? ''}
            onChange={(email) => setCustomer({ ...customer, email })}
          />
        </PhoneBody>
        <PhonePrimary onClick={confirmCustomer}>確認へ進む</PhonePrimary>
      </PhoneScreen>
    )
  }

  if (draft.step === 'confirm' && detail && draft.customer) {
    return (
      <PhoneScreen>
        <PhoneHead store={detail.name} progress={bookingProgress(4)} />
        <PhoneBody>
          <small>4 / 5　確認</small>
          <h1>予約内容をご確認ください</h1>
          <PhoneSummary>
            {detail.name}
            <br />
            {draft.date && draft.startTime && japaneseSlotLabel(draft.date, draft.startTime)}
            <br />
            {selectedPurpose?.label} · 約{selectedPurpose?.durationMinutes}分<br />
            {draft.customer.name}
            <br />
            {draft.customer.phone}
            <br />
            {detail.notice}
          </PhoneSummary>
          <PhoneCard>変更・取消期限と店舗からのご案内を確認しました。</PhoneCard>
          {error && (
            <PhoneCard tone="error">
              <p role="alert">{error}</p>
            </PhoneCard>
          )}
        </PhoneBody>
        <PhonePrimary onClick={() => void submitBooking()}>この内容で予約する</PhonePrimary>
      </PhoneScreen>
    )
  }

  return (
    <PhoneScreen>
      <PhoneHead store="店舗を探す" />
      <PhoneBody>
        <p>予約情報を準備しています。</p>
      </PhoneBody>
    </PhoneScreen>
  )
}
