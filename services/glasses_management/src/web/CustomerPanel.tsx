import { type CustomerCandidate, CustomerDetail } from '@app/contracts'
import {
  createContext,
  type FormEvent,
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
  customerSearchTermFor,
  emptyCustomerSelection,
  parseCustomerCandidates,
  possibleDuplicates,
  selectCandidate,
  selectedCandidate,
  withCandidates,
} from './customer-search'
import { AttentionCard, Candidate, RailSummary } from './design/booking'
import { Action, Actions, SearchField } from './design/controls'
import { BookingLayout, Workspace } from './design/layouts'
import { FailureNotice } from './design/notices'
import { Card, CardColumns, ListRow, Notice } from './design/surfaces'
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

/*
 * 顧客台帳の詳細に並ぶ面は、承認済みモック `staff-approved.html#customer-ledger`
 * では見出しつきのカードではなく `.card` の中の太字 1 行である。見出し要素に
 * すると字寸法が上がって面の高さが変わるので、`<b>` のままにする。名前は
 * 読み上げのために面自身が持つ。
 */
function Region({
  label,
  tone = 'plain',
  children,
}: {
  label: string
  /** 対応時に確認だけは淡赤の注意面（`.attention`）。役割と色を食い違わせない。 */
  tone?: 'plain' | 'attention'
  children: ReactNode
}) {
  return (
    <Card tone={tone} label={label} className="mt-2.5">
      <b>{label}</b>
      <br />
      {children}
    </Card>
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
  /* 顧客台帳の左レールはモックどおり検索欄が 1 本。どの検索語かは入力から決める。 */
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<CustomerSelection>(emptyCustomerSelection)
  const [searched, setSearched] = useState(false)
  const [hint, setHint] = useState<string>()
  const [error, setError] = useState<string>()

  const selected = selectedCandidate(selection)
  const bound = selected !== undefined || selection.newCustomer

  const bookingStep = useContext(BookingCustomerStepContext)
  const bookingMode = mode === 'booking' && bookingStep !== null

  const currentTerm = (): CustomerSearchTerm | undefined => {
    if (bookingMode) {
      const term: CustomerSearchTerm = { field: 'phone', value: phone }
      return buildCustomerSearchQuery(term) ? term : undefined
    }
    return customerSearchTermFor(query)
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

  /*
   * モックには「候補を探す」ボタンが無い（予約フローの主列も顧客台帳の左レール
   * も検索欄だけ）。入力が止まったら静かに探し、Enter でも探せるようにする
   * （キーボード操作だけで完結させるため）。
   */
  const searchRef = useRef(search)
  searchRef.current = search
  useEffect(() => {
    const term: CustomerSearchTerm | undefined = bookingMode
      ? { field: 'phone', value: phone }
      : customerSearchTermFor(query)
    if (term === undefined || buildCustomerSearchQuery(term) === undefined) return undefined
    const timer = setTimeout(() => {
      void searchRef.current()
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [bookingMode, phone, query])

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

  /*
   * 顧客台帳（承認済みモック `staff-approved.html#customer-ledger`）。
   *
   *   .workspace{grid-template-columns:390px 1fr}
   *   .list{padding:16px;background:#e7ede9}   ← 白いカードを載せない地色の列
   *   .customer-top{grid-template-columns:repeat(3,1fr)}
   *
   * 左は「探す列」で、検索欄が 1 本と候補の行だけ。ラベル付きの欄を 3 つ並べた
   * フォームにすると、電話を受けながら片手で辿る列ではなくなる。
   */
  return (
    <Workspace
      listLabel="お客様を探す"
      detailLabel="選択中のお客様"
      list={
        <>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              void search()
            }}
          >
            <SearchField
              id="customer-search"
              label="顧客を検索"
              placeholder="氏名・電話番号"
              value={query}
              onChange={setQuery}
            />
          </form>
          {hint !== undefined && (
            <p aria-live="polite" className="font-sans text-danger text-note">
              {hint}
            </p>
          )}
          {error !== undefined && <FailureNotice>{error}</FailureNotice>}
          {duplicated && <Notice>同じ電話番号の候補があります。統合はされません。</Notice>}
          {selection.candidates.map((candidate) => (
            <ListRow
              key={candidate.id}
              label={candidate.name}
              selected={selected?.id === candidate.id}
              onSelect={() => pick(candidate)}
            >
              <b>{candidate.name}</b>
              <br />
              {candidate.phone}
            </ListRow>
          ))}
          {searched && selection.candidates.length === 0 && error === undefined && (
            <p className="font-sans text-note">該当するお客様は見つかりませんでした</p>
          )}
        </>
      }
      detail={
        <>
          {!bound && <Card>お客様は未確定です</Card>}
          {selection.newCustomer && <Card>新規のお客様として進みます</Card>}
          {selected !== undefined && (
            <>
              <h1>{selected.name} 様</h1>
              {detail === undefined ? (
                <Card className="mt-2.5">顧客情報は未取得です</Card>
              ) : (
                <>
                  <CardColumns>
                    {detail.currentPrescription !== null && (
                      <Region label="現在の度数">
                        <PrescriptionLines prescription={detail.currentPrescription} />
                      </Region>
                    )}
                    {detail.latestNote !== null && (
                      <Region label="最新メモ">
                        {detail.latestNote.body}
                        <br />
                        <small className="text-ink-muted">
                          {detail.latestNote.recordedOn}・{detail.latestNote.storeName}・
                          {detail.latestNote.recordedBy}
                        </small>
                      </Region>
                    )}
                    {ownedGlasses.length > 0 && (
                      <Region label="現在のメガネ">
                        <ul className="list-none">
                          {ownedGlasses.map((glasses) => (
                            <li key={`${glasses.label}-${glasses.purchasedOn}`}>
                              {glasses.label}（{glasses.lensType}）
                              <small className="text-ink-muted">
                                {' '}
                                {glasses.purchasedOn}・{glasses.storeName}
                              </small>
                            </li>
                          ))}
                        </ul>
                      </Region>
                    )}
                  </CardColumns>
                  {attentionNotes.length > 0 && (
                    /*
                     * 接客の直前に読むものなので、時系列（履歴）の後ろへ回さず
                     * 淡赤の注意面で先に置く（モックの `.attention`）。
                     */
                    <Region label="対応時に確認" tone="attention">
                      <ul className="list-none">
                        {attentionNotes.map((note) => (
                          <li key={`${note.recordedOn}-${note.body}`}>
                            {note.body}
                            <br />
                            <small>
                              根拠 {note.basis}・記録者 {note.recordedBy}・記録日 {note.recordedOn}
                            </small>
                          </li>
                        ))}
                      </ul>
                    </Region>
                  )}
                  {mode === 'ledger' && pastPrescriptions.length > 0 && (
                    <Region label="過去の度数">
                      <ul className="list-none">
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
                      <ul className="list-none">
                        {visitHistory.map((visit) => (
                          <li key={`${visit.visitedOn}-${visit.summary}`}>
                            {visit.visitedOn}・{visit.storeName}・{visit.summary}
                          </li>
                        ))}
                      </ul>
                    </Region>
                  )}
                  {mode === 'ledger' && permissions.attentionNotes && (
                    /*
                     * 注意事項は顧客に紐づくので、入口は「すでに選んだ顧客」からだけ。
                     * 権限が無いときはボタン自体を出さない（存在を示唆しない, AC-EYEX-91）。
                     */
                    <Actions>
                      <Action
                        onClick={() =>
                          navigate({
                            screen: 'attention-review',
                            customerId: selected.id,
                            customerName: selected.name,
                          })
                        }
                      >
                        注意事項を確認・登録する
                      </Action>
                    </Actions>
                  )}
                </>
              )}
            </>
          )}
        </>
      }
    />
  )
}
