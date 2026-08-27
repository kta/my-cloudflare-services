import { type CustomerCandidate, CustomerDetail } from '@app/contracts'
import { Button, Card, Chip, Field, TextInput } from '@app/ui'
import {
  createContext,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  buildCustomerSearchQuery,
  type CustomerSearchTerm,
  type CustomerSelection,
  chooseNewCustomer,
  customerSearchPath,
  emptyCustomerSelection,
  parseCustomerCandidates,
  possibleDuplicates,
  selectCandidate,
  selectedCandidate,
  withCandidates,
} from './customer-search'
import { AttentionCard, Candidate, RailSummary } from './design/booking'
import { SearchField } from './design/controls'
import { BookingLayout } from './design/layouts'
import { FailureNotice } from './design/notices'
import { Notice } from './design/surfaces'
import type { StaffScreenProps } from './staff-screen'

/*
 * 電話・店頭予約の 4 工程目は「フォーム」ではなく「お客様の特定」である
 * （承認済みモック BOOK-CUSTOMER）。主列は 1 本の大きな電話番号欄と候補カード
 * だけ、脇の列は選ばれたお客様の記録（現在の度数 / 対応時に確認 / 最新メモ）。
 *
 * その 2 列は 1 つの `CustomerPanel` が描く。工程見出しと「次へ」の意味は
 * 予約フローのものなので、context で降ろす。`BookingFlow` がこれを提供し、
 * `StaffWorkspace` から渡される props の形は変わらない。
 */
export type BookingCustomerStep = {
  /** 工程ラベルと読み上げる問いかけ（`4 / 5 お客様情報` + `お電話番号を伺えますか？`）。 */
  header: ReactNode
  /**
   * お客様が定まった。予約フローは入力の続き（氏名・メモ）へ進む。新規登録は
   * 候補を持たないので、伺った電話番号だけを渡す。
   */
  onConfirm: (candidate: CustomerCandidate | undefined, typedPhone: string) => void
}

export const BookingCustomerStepContext = createContext<BookingCustomerStep | null>(null)

/** 候補が出そろうまでの静かな待ち時間。押すボタンはモックに無い。 */
const SEARCH_DEBOUNCE_MS = 400

/*
 * 顧客記録の形は `packages/contracts` の Zod（`CustomerDetail`）が単一の正本で、
 * この画面はそれを parse して描画するだけである。以前ここに置いていた手書きの
 * ビュー型は、API 実装後は二重定義になるため削除した。
 */
type CustomerPanelPermissions = {
  /** 店舗横断の来店履歴を見てよいか（UC-EYEX-026 / AC-EYEX-10）。 */
  crossStoreHistory: boolean
  /** 注意事項を見てよいか（UC-EYEX-030）。false なら存在自体を出さない（AC-EYEX-91）。 */
  attentionNotes: boolean
}

type CustomerPanelProps = StaffScreenProps & {
  mode: 'booking' | 'ledger'
  onSelect: (candidate: CustomerCandidate | undefined) => void
  permissions: CustomerPanelPermissions
  /** 取得済みの記録を差し込むための上書き。既定ではこの画面自身が取りに行く。 */
  detail?: CustomerDetail
  /** 主利用店舗 ID → 店舗名。未知の ID は選択中店舗名にフォールバックしない。 */
  storeNames?: Record<string, string>
}

function Region({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="rounded-ctl border border-line bg-surface p-4 text-ink">
      <h3 className="font-display text-base font-semibold">{label}</h3>
      <div className="mt-2 text-sm">{children}</div>
    </section>
  )
}

function PrescriptionLines({
  prescription,
}: {
  prescription: CustomerDetail['pastPrescriptions'][number]
}) {
  return (
    <p>
      R {prescription.rightSphere} / L {prescription.leftSphere} / PD{' '}
      {prescription.pupillaryDistance}
      {prescription.addPower !== null && ` / ADD ${prescription.addPower}`}
      <br />
      <span className="text-ink-muted">
        測定日 {prescription.measuredOn}・店舗 {prescription.storeName}・記録者{' '}
        {prescription.recordedBy}
      </span>
    </p>
  )
}

export function CustomerPanel({
  storeId,
  storeName,
  api,
  navigate,
  mode,
  onSelect,
  permissions,
  detail: detailOverride,
  storeNames,
}: CustomerPanelProps) {
  const [fetchedDetail, setFetchedDetail] = useState<CustomerDetail>()
  const detail = detailOverride ?? fetchedDetail
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [kana, setKana] = useState('')
  const [selection, setSelection] = useState<CustomerSelection>(emptyCustomerSelection)
  const [searched, setSearched] = useState(false)
  const [hint, setHint] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const selected = selectedCandidate(selection)
  const bound = selected !== undefined || selection.newCustomer

  const currentTerm = (): CustomerSearchTerm | undefined => {
    for (const term of [
      { field: 'phone', value: phone },
      { field: 'name', value: name },
      { field: 'kana', value: kana },
    ] as CustomerSearchTerm[]) {
      if (buildCustomerSearchQuery(term)) return term
    }
    return undefined
  }

  const search = async () => {
    const term = currentTerm()
    const query = term && buildCustomerSearchQuery(term)
    if (!query) {
      setHint('検索する電話番号・氏名・氏名かなを入力してください')
      return
    }
    setHint(undefined)
    setError(undefined)
    setBusy(true)
    const wasBound = bound
    try {
      const response = await api(customerSearchPath(storeId, query))
      if (!response.ok) throw new Error(`status ${response.status}`)
      const candidates = parseCustomerCandidates(await response.json())
      setSelection((state) => withCandidates(state, candidates))
    } catch {
      setSelection((state) => withCandidates(state, []))
      setError('顧客候補を取得できませんでした。通信状況を確認して、もう一度お試しください。')
    } finally {
      setSearched(true)
      setBusy(false)
      // 検索し直したら以前のお客様は必ず外れる（古い顧客が紐づいたままにしない）。
      if (wasBound) onSelect(undefined)
    }
  }

  const pick = (candidate: CustomerCandidate) => {
    setSelection((state) => selectCandidate(state, candidate.id))
    onSelect(candidate)
    if (detailOverride) return
    setFetchedDetail(undefined)
    void (async () => {
      try {
        const response = await api(
          `/api/staff/stores/${encodeURIComponent(storeId)}/customers/${encodeURIComponent(candidate.id)}`,
        )
        if (!response.ok) throw new Error(`status ${response.status}`)
        setFetchedDetail(CustomerDetail.parse(await response.json()))
      } catch {
        // 取得できないことは「記録が無い」ことではない。未取得のまま表示する。
        setFetchedDetail(undefined)
      }
    })()
  }

  const pickNewCustomer = () => {
    setSelection((state) => chooseNewCustomer(state))
    setFetchedDetail(undefined)
    onSelect(undefined)
  }

  const onOptionKeyDown = (event: KeyboardEvent<HTMLDivElement>, candidate: CustomerCandidate) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    pick(candidate)
  }

  const duplicated = possibleDuplicates(selection.candidates).length > 0
  const attentionNotes = permissions.attentionNotes ? (detail?.attentionNotes ?? []) : []
  // 権限が無ければ他店舗で記録された行は「無かったこと」として落とす。件数も
  // プレースホルダも出さないので、存在自体が漏れない（AC-EYEX-91）。
  const ownStoreOnly = <T extends { storeId: string }>(rows: T[]) =>
    rows.filter((row) => permissions.crossStoreHistory || row.storeId === storeId)
  const visitHistory = ownStoreOnly(detail?.visitHistory ?? [])
  const pastPrescriptions = ownStoreOnly(detail?.pastPrescriptions ?? [])
  const ownedGlasses = ownStoreOnly(detail?.ownedGlasses ?? [])

  const primaryStoreLabel = (candidate: CustomerCandidate) =>
    storeNames?.[candidate.primaryStoreId] ??
    (candidate.primaryStoreId === storeId ? storeName : '他店舗')

  const bookingStep = useContext(BookingCustomerStepContext)
  const bookingMode = mode === 'booking' && bookingStep !== null

  /*
   * モックの主列には「候補を探す」ボタンが無い。入力が止まったら静かに探し、
   * Enter でも探せるようにする（キーボード操作だけで完結させるため）。
   */
  const searchRef = useRef(search)
  searchRef.current = search
  useEffect(() => {
    if (!bookingMode) return undefined
    if (!buildCustomerSearchQuery({ field: 'phone', value: phone })) return undefined
    const timer = setTimeout(() => {
      void searchRef.current()
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [bookingMode, phone])

  const confirm = (candidate: CustomerCandidate | undefined) => {
    if (candidate) pick(candidate)
    else pickNewCustomer()
    bookingStep?.onConfirm(candidate, phone)
  }

  if (bookingMode && bookingStep) {
    const attention = attentionNotes[0]
    const prescription = detail?.currentPrescription
    return (
      <BookingLayout
        railLabel="選択中のお客様"
        main={
          <>
            {bookingStep.header}
            {/*
             * モックの主列には「候補を探す」ボタンが無い。入力が止まったら静かに
             * 探し、Enter（form submit）でも探せるようにする。
             */}
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault()
                void search()
              }}
            >
              <SearchField
                size="roomy"
                id="booking-customer-phone"
                label="お電話番号"
                inputMode="tel"
                value={phone}
                onChange={setPhone}
              />
            </form>

            {hint !== undefined && (
              <p aria-live="polite" className="font-sans text-danger text-note">
                {hint}
              </p>
            )}
            {error !== undefined && <FailureNotice>{error}</FailureNotice>}
            {duplicated && <Notice>同じ電話番号の候補があります。統合はされません。</Notice>}

            <ul aria-label="顧客候補" className="mt-3.5">
              {selection.candidates.map((candidate) => {
                const isSelected = selected?.id === candidate.id
                return (
                  <li key={candidate.id}>
                    <Candidate
                      selected={isSelected}
                      state={isSelected ? '選択中' : '候補'}
                      onClick={() => confirm(candidate)}
                    >
                      <b>{candidate.name} 様</b>
                      <br />
                      {candidate.phone} · {primaryStoreLabel(candidate)}
                      {candidate.visitCount}回
                    </Candidate>
                  </li>
                )
              })}
            </ul>

            {/* 候補ではないので候補の一覧には入れない。 */}
            <Candidate onClick={() => confirm(undefined)}>新しいお客様として登録する</Candidate>

            {searched && selection.candidates.length === 0 && error === undefined && (
              <p className="font-sans text-note">該当するお客様は見つかりませんでした</p>
            )}
          </>
        }
        rail={
          <>
            <h2>選択中のお客様</h2>
            {/*
             * モックは「お客様が決まった後」しか描いていない。決まる前と、記録を
             * 取れなかったときの言葉は、同じ要約カードの語彙でそのまま残す。
             */}
            {!bound && <RailSummary>お客様は未確定です</RailSummary>}
            {selection.newCustomer && <RailSummary>新規のお客様として進みます</RailSummary>}
            {selected !== undefined && detail === undefined && (
              <RailSummary>顧客情報は未取得です</RailSummary>
            )}
            {selected !== undefined && prescription != null && (
              <RailSummary label="現在の度数">
                <b>現在の度数</b>
                <br />R {prescription.rightSphere} / L {prescription.leftSphere} / PD{' '}
                {prescription.pupillaryDistance}
              </RailSummary>
            )}
            {selected !== undefined && attention && (
              <AttentionCard label="対応時に確認">
                <b>対応時に確認</b>
                <br />
                {attention.body}
                <br />
                <small>
                  根拠: {attention.recordedOn.replaceAll('-', '.')}の{attention.basis}
                </small>
              </AttentionCard>
            )}
            {selected !== undefined && detail?.latestNote != null && (
              <RailSummary label="最新メモ">
                <b>最新メモ</b>
                <br />
                {detail.latestNote.body}
              </RailSummary>
            )}
          </>
        }
      />
    )
  }

  return (
    <div className="grid gap-5 bg-paper p-5 text-ink lg:grid-cols-3">
      <div className="flex flex-col gap-4">
        <Card>
          <h2 className="font-display text-xl font-semibold">お客様を探す</h2>
          <div className="mt-4 flex flex-col gap-3">
            <Field label="電話番号" htmlFor="customer-search-phone">
              <TextInput
                id="customer-search-phone"
                inputMode="tel"
                autoComplete="off"
                className="min-h-12"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
            <Field label="氏名" htmlFor="customer-search-name">
              <TextInput
                id="customer-search-name"
                autoComplete="off"
                className="min-h-12"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="氏名かな" htmlFor="customer-search-kana">
              <TextInput
                id="customer-search-kana"
                autoComplete="off"
                className="min-h-12"
                value={kana}
                onChange={(event) => setKana(event.target.value)}
              />
            </Field>
            <Button className="min-h-12" onClick={search} disabled={busy}>
              候補を探す
            </Button>
            {hint !== undefined && (
              <p aria-live="polite" className="text-sm text-danger">
                {hint}
              </p>
            )}
            {error !== undefined && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </div>
        </Card>

        {duplicated && (
          <p className="rounded-ctl border border-line bg-amber-soft p-3 text-sm text-amber">
            同じ電話番号の候補があります。統合はされません。
          </p>
        )}

        {selection.candidates.length > 0 && (
          <div role="listbox" aria-label="顧客候補" className="flex flex-col gap-2">
            {selection.candidates.map((candidate) => {
              const isSelected = selected?.id === candidate.id
              return (
                <div
                  key={candidate.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => pick(candidate)}
                  onKeyDown={(event) => onOptionKeyDown(event, candidate)}
                  className={`min-h-12 cursor-pointer rounded-ctl border bg-surface p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber ${
                    isSelected ? 'border-pine bg-pine/10' : 'border-line'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <b className="font-semibold">{candidate.name}</b>
                    {isSelected && <Chip tone="success">選択中</Chip>}
                  </span>
                  <span className="mt-1 block text-ink-muted">
                    {candidate.kana}
                    <br />
                    {candidate.phone}
                    <br />
                    主利用店舗 {primaryStoreLabel(candidate)}・来店{candidate.visitCount}回
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {searched && selection.candidates.length === 0 && error === undefined && (
          <p className="text-sm text-ink-muted">該当するお客様は見つかりませんでした</p>
        )}

        <Button variant="ghost" className="min-h-12" onClick={pickNewCustomer}>
          新しいお客様として進む
        </Button>
      </div>

      <section aria-label="選択中のお客様" className="flex flex-col gap-4 lg:col-span-2">
        {!bound && (
          <p className="rounded-ctl border border-line bg-surface p-4 text-sm text-ink-muted">
            お客様は未確定です
          </p>
        )}
        {selection.newCustomer && (
          <p className="rounded-ctl border border-line bg-surface p-4 text-sm">
            新規のお客様として進みます
          </p>
        )}
        {selected !== undefined && (
          <>
            <h2 className="font-display text-2xl font-semibold">{selected.name} 様</h2>
            {detail === undefined ? (
              <p className="rounded-ctl border border-line bg-surface p-4 text-sm text-ink-muted">
                顧客情報は未取得です
              </p>
            ) : (
              <>
                {detail.currentPrescription !== null && (
                  <Region label="現在の度数">
                    <PrescriptionLines prescription={detail.currentPrescription} />
                  </Region>
                )}
                {detail.latestNote !== null && (
                  <Region label="最新メモ">
                    <p>
                      {detail.latestNote.body}
                      <br />
                      <span className="text-ink-muted">
                        {detail.latestNote.recordedOn}・{detail.latestNote.storeName}・
                        {detail.latestNote.recordedBy}
                      </span>
                    </p>
                  </Region>
                )}
                {ownedGlasses.length > 0 && (
                  <Region label="保有メガネ">
                    <ul className="flex list-none flex-col gap-1">
                      {ownedGlasses.map((glasses) => (
                        <li key={`${glasses.label}-${glasses.purchasedOn}`}>
                          {glasses.label}（{glasses.lensType}）
                          <span className="text-ink-muted">
                            {' '}
                            {glasses.purchasedOn}・{glasses.storeName}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Region>
                )}
                {attentionNotes.length > 0 && (
                  <Region label="注意事項">
                    <ul className="flex flex-col gap-2">
                      {attentionNotes.map((note) => (
                        <li key={`${note.recordedOn}-${note.body}`}>
                          {note.body}
                          <br />
                          <span className="text-ink-muted">
                            根拠 {note.basis}・記録者 {note.recordedBy}・記録日 {note.recordedOn}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Region>
                )}
                {mode === 'ledger' && permissions.attentionNotes && selected && (
                  /*
                   * 注意事項は顧客に紐づくので、入口は「すでに選んだ顧客」からだけにする。
                   * 権限が無いときはボタン自体を出さない（存在を示唆しない, AC-EYEX-91）。
                   */
                  <Button
                    variant="ghost"
                    className="min-h-12 self-start"
                    onClick={() =>
                      navigate({
                        screen: 'attention-review',
                        customerId: selected.id,
                        customerName: selected.name,
                      })
                    }
                  >
                    注意事項を確認・登録する
                  </Button>
                )}
                {mode === 'ledger' && pastPrescriptions.length > 0 && (
                  <Region label="過去の度数">
                    <ul className="flex flex-col gap-2">
                      {pastPrescriptions.map((prescription) => (
                        <li key={prescription.measuredOn}>
                          <PrescriptionLines prescription={prescription} />
                        </li>
                      ))}
                    </ul>
                  </Region>
                )}
                {mode === 'ledger' && visitHistory.length > 0 && (
                  <Region label="来店履歴">
                    <ul className="flex list-none flex-col gap-1">
                      {visitHistory.map((visit) => (
                        <li key={`${visit.visitedOn}-${visit.summary}`}>
                          {visit.visitedOn}・{visit.storeName}・{visit.summary}
                        </li>
                      ))}
                    </ul>
                  </Region>
                )}
              </>
            )}
          </>
        )}
      </section>
    </div>
  )
}
