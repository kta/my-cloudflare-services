import type {
  CustomerCandidate,
  CustomerCreate,
  CustomerDetail as CustomerDetailShape,
  CustomerNote,
  CustomerSummary,
  StaffMember,
  Store,
} from '@app/contracts'
import { auth, toJstDateString } from '@app/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MergeCustomer } from '../../worker/domain/customers'
import { client, subjectFromToken } from '../client'
import { CustomerDetail, type CustomerDetailPhase } from './CustomerDetail'
import { CustomerHandwrite, type HandwrittenSheet } from './CustomerHandwrite'
import {
  CustomerList,
  type CustomerListConditions,
  type CustomerListPhase,
  visitRangeBounds,
} from './CustomerList'
import {
  CustomerMerge,
  type CustomerMergeProps,
  type MergeRejection,
  type MergeRequest,
  type MergeSide,
} from './CustomerMerge'
import { CustomerNew } from './CustomerNew'

/*
 * 顧客台帳の器（承認済みモック docs/frontend/mockups/eye/images/CUSTOMER-LIST.png ／
 * CUSTOMER-DETAIL.png ／ CUSTOMER-NEW.png ／ CUSTOMER-MERGE.png ／ CUSTOMER-HANDWRITE.png）。
 *
 * **URL による画面の切り替えを持ち込まない**（この製品に router は無い）。行き先は
 * `App` の `current === 'customers'` が決め、この面の中の切り替えは `pane` が持つ。
 *
 * 器の仕事:
 *   1. 台帳の 1 ページを取り、一覧が上げてきた条件（検索語・並べ方・ご来店の回数）で取り直す。
 *   2. 行が選ばれたら、その 1 名の中身（度数・メガネ・メモ・次のご予約）を取る。
 *   3. 新しいお客様の登録（電話照会・登録・重複の解決）を配線する。
 *   4. 手書きメモの取得・保存・文字の修正・注意ごとへの申し込みを配線する。
 *   5. おまとめ —— **入口そのものの表示可否をサーバへ確かめる**。
 *      この製品には「いま自分が店長かどうか」を返す経路が無いので（`03-data-model.md` に
 *      staff の役割は載るが、選択中店舗の `StorePermission` を単体で返す API は無い）、
 *      詳細を開いた時点で「同じお電話番号の重複があるか」を照会し、見つかったら
 *      `POST .../merge/preview`（`settings.manage` を要求する経路）を**先読みで**叩く。
 *      200 なら店長なのでボタンを出し、その下見の結果をそのまま使う。403 ならボタンごと
 *      出さない（AC-CUST-16 の「入口が画面のどこにも出ず」）。決定の記録は
 *      `decisions-p4-frontend-review.md` を参照。
 */

/** 1 回に受け取る名簿の上限（`CustomerSearchQuery.limit` の最大は 200）。 */
const PAGE_LIMIT = 200
const DEFAULT_WRITER = 'ご担当者（スタッフ）'

export type CustomerScreenProps = {
  /** いま選択中の店舗（手書きメモの記入店舗に使う）。 */
  storeId: string
  /** 店舗名の解決（手書きメモの「記入した店舗」）。 */
  stores: readonly Store[] | null
  /**
   * 一覧の検索欄の初めの中身。予約を探す面の「顧客台帳で調べる」から来たとき、
   * 伺ったお名前をそのまま引き継ぐ（AC-CHANGE-24）。台帳をふつうに開いたときは空。
   */
  initialQuery?: string
  /** 予約の 5 工程へ移る（AC-CUST-26 の入口）。工程 4 のお名前・ふりがな・お電話番号を
   *  これで埋める（AC-CUST-12・AC-CUST-26）。 */
  onStartBooking: (customer: {
    id: string
    name: string
    kana: string
    phone: string | null
  }) => void
  /** 業務の期限が切れた（401）。開いたままにすると行き止まりになるので外へ知らせる。 */
  onSessionExpired?: () => void
}

/** 一覧の条件を、そのままサーバへの問い合わせに写す。 */
function searchParams(conditions: CustomerListConditions): URLSearchParams {
  const params = new URLSearchParams({ sort: conditions.sort, limit: String(PAGE_LIMIT) })
  const query = conditions.query.trim()
  if (query !== '') params.set('query', query)
  const bounds = visitRangeBounds(conditions.visitRange)
  if (bounds !== null) {
    params.set('visitCountMin', String(bounds.min))
    if (bounds.max !== null) params.set('visitCountMax', String(bounds.max))
  }
  return params
}

/** `CustomerDetail`（API 応答）を、おまとめの純関数が読む `MergeCustomer` の形へ写す。 */
function toMergeCustomer(detail: CustomerDetailShape): MergeCustomer {
  return {
    id: detail.id,
    customerNumber: detail.customerNumber,
    name: detail.name,
    kana: detail.kana,
    phoneNormalized: detail.phone,
    phoneLast4: detail.phone === null ? null : detail.phone.slice(-4),
    address: detail.address,
    memo: detail.memo,
    visitCount: detail.visitCount,
    lastVisitAt: detail.lastVisitAt,
    mergedIntoId: detail.mergedIntoId,
    noteCount: detail.notes.length,
  }
}

/** 見比べ表の「接客のメモ」の下 1 行。公開済みの注意ごとがあれば、その本文を添える。 */
function noteSummaryOf(detail: CustomerDetailShape): string {
  const attention = detail.notes.find(
    (note) => note.kind === 'attention' && note.status === 'published',
  )
  if (attention !== undefined) return `注意ごと 1件（${attention.body.split('\n')[0]}）`
  return detail.notes.length === 0 ? '' : `接客のメモ ${detail.notes.length}件`
}

/**
 * `MergeSide` へ写す。**`registeredLabel` と `addressNote` は実在しない**
 * （`CustomerDetail` 契約に登録日・登録店舗の列が無い）ので空のまま渡す —— 無い日付を
 * でっち上げるより、モックの装飾 1 行を欠くほうを選ぶ。
 */
function toMergeSide(detail: CustomerDetailShape): MergeSide {
  return {
    ...toMergeCustomer(detail),
    version: detail.version,
    registeredLabel: '',
    addressNote: '',
    noteSummary: noteSummaryOf(detail),
  }
}

/** 手書きの申し込み状態。`published` だけを数え、`draft` は「申し込み済み」に見せる。 */
function attentionStateOf(note: CustomerNote): HandwrittenSheet['attention'] {
  if (note.kind !== 'attention') return 'none'
  return note.status === 'published' ? 'published' : 'requested'
}

function toSheet(note: CustomerNote, storeName: string): HandwrittenSheet {
  return {
    id: note.id,
    svg: note.handwritingSvg,
    body: note.body,
    subject: '',
    writtenOn: toJstDateString(note.createdAt),
    storeName,
    authorName: note.authorName,
    revision: note.revision,
    attention: attentionStateOf(note),
    uncertain: [],
  }
}

type MergeEntry = { secondaryId: string; secondary: CustomerDetailShape }

type MergePaneState =
  | {
      phase: 'ready'
      primary: CustomerDetailShape
      secondary: CustomerDetailShape
      rejection: MergeRejection | null
    }
  | { phase: 'submitting'; primary: CustomerDetailShape; secondary: CustomerDetailShape }
  | { phase: 'error'; message: string }

/**
 * 下見のときの姿と、いまの姿の違いを 1 行ずつにする。
 * 「もう一度下見してください」とだけ言われても、どちらの登録の何が変わったのかを
 * 利用者が自分で探すことになる（実装不足の洗い出し customers-06）。
 * 読み比べるのは画面に出ている欄だけにする —— 内部の版だけが動いた（内容は同じ）
 * ときに「何かが変わりました」とだけ言うと、探しても見つからない。
 */
export function movedLines(
  before: CustomerDetailShape,
  after: CustomerDetailShape | null,
): readonly string[] {
  if (after === null) return []
  const fields: readonly { label: string; read: (row: CustomerDetailShape) => string }[] = [
    { label: 'お名前', read: (row) => row.name },
    { label: 'ふりがな', read: (row) => row.kana ?? '' },
    { label: 'お電話番号', read: (row) => row.phone ?? '' },
    { label: '覚えておくこと', read: (row) => row.memo ?? '' },
  ]
  const shown = (value: string) => (value === '' ? '（未入力）' : value)
  return fields
    .filter((field) => field.read(before) !== field.read(after))
    .map(
      (field) =>
        `${before.name} 様の${field.label}が ${shown(field.read(before))} から ${shown(field.read(after))} に変わりました`,
    )
}

export function CustomerScreen({
  storeId,
  stores,
  onStartBooking,
  initialQuery = '',
  onSessionExpired,
}: CustomerScreenProps) {
  const [pane, setPane] = useState<'list' | 'detail' | 'new' | 'merge' | 'handwrite'>('list')
  const [conditions, setConditions] = useState<CustomerListConditions>({
    query: initialQuery,
    sort: 'kana',
    visitRange: null,
  })
  const [items, setItems] = useState<CustomerSummary[] | null>(null)
  const [listPhase, setListPhase] = useState<CustomerListPhase>('loading')
  /** 「もう一度読み込む」を押すたびに 1 増える。一覧の読み込みをやり直す合図。 */
  const [listReload, setListReload] = useState(0)
  const [detail, setDetail] = useState<CustomerDetailShape | null>(null)
  const [detailPhase, setDetailPhase] = useState<CustomerDetailPhase>('loading')
  // まだ画面に居場所の無い遷移を押されたときの答え（押して何も起きないボタンにしない）。
  const [notice, setNotice] = useState<string | null>(null)

  // おまとめの入口（店長かつ重複ありのときだけ埋まる。AC-CUST-16）。
  const [mergeEntry, setMergeEntry] = useState<MergeEntry | null>(null)
  const mergeDetectTicket = useRef(0)
  const [mergeState, setMergeState] = useState<MergePaneState | null>(null)
  const mergeIdempotencyKey = useRef(crypto.randomUUID())

  const [sheets, setSheets] = useState<HandwrittenSheet[] | null>(null)
  const [sheetsError, setSheetsError] = useState<string | null>(null)
  const [sheetsLoading, setSheetsLoading] = useState(false)
  const [staffRows, setStaffRows] = useState<readonly StaffMember[]>([])

  // 手書きの記入者の名乗りにしか使わない（`booking/BookingScreen.tsx` と同じ道）。
  useEffect(() => {
    let live = true
    client.api.staff.stores[':storeId'].staff
      .$get({ param: { storeId } })
      .then(async (res) => (res.ok ? await res.json() : []))
      .then((rows) => {
        if (live) setStaffRows(rows)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [storeId])

  const writer = useMemo(() => {
    const subject = subjectFromToken()
    const found = subject === null ? undefined : staffRows.find((m) => m.adminUserId === subject)
    if (found === undefined) return DEFAULT_WRITER
    return found.jobLabel === null ? found.displayName : `${found.displayName}（${found.jobLabel}）`
  }, [staffRows])

  function storeName(id: string): string {
    return stores?.find((s) => s.id === id)?.name ?? ''
  }

  /** 同じ条件で呼ばれても状態を作り直さない（作り直すと台帳を 2 度取りに行く）。 */
  const handleConditions = useCallback((next: CustomerListConditions) => {
    setConditions((current) =>
      current.query === next.query &&
      current.sort === next.sort &&
      current.visitRange === next.visitRange
        ? current
        : next,
    )
  }, [])

  useEffect(() => {
    let live = true
    const params = searchParams(conditions)
    async function read() {
      // `GET /api/staff/customers` の query には zValidator が無く hc の型が
      // query を受け取らないので、経路だけ型のついたクライアントに引かせ、
      // 条件は fetch の側で足す（`settings/StaffPanel.tsx` と同じ道）。
      const res = await client.api.staff.customers.$get(undefined, {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          auth.authFetch(`${String(input)}?${params.toString()}`, init),
      })
      const status: number = res.status
      if (!live) return
      if (status === 401) {
        setListPhase('error')
        onSessionExpired?.()
        return
      }
      if (!res.ok) {
        setListPhase(status === 403 ? 'forbidden' : 'error')
        return
      }
      const list = await res.json()
      if (!live) return
      setItems(list.items)
      setListPhase('ready')
    }
    read().catch(() => {
      if (live) setListPhase('error')
    })
    return () => {
      live = false
    }
  }, [conditions, listReload, onSessionExpired])

  const openCustomer = useCallback(
    async (customerId: string | null) => {
      setDetail(null)
      setMergeEntry(null)
      if (customerId === null) {
        setDetailPhase('loading')
        return
      }
      setDetailPhase('loading')
      const res = await client.api.staff.customers[':customerId'].$get({
        param: { customerId },
      })
      const status: number = res.status
      if (status === 401) {
        setDetailPhase('error')
        onSessionExpired?.()
        return
      }
      if (!res.ok) {
        setDetailPhase(status === 404 ? 'notFound' : status === 403 ? 'forbidden' : 'error')
        return
      }
      const found: CustomerDetailShape = await res.json()
      setDetail(found)
      setDetailPhase('ready')
    },
    [onSessionExpired],
  )

  /*
   * おまとめの入口の先読み（AC-CUST-14 / AC-CUST-16）。同じお電話番号の重複を照会し、
   * 見つかった 1 件との下見をだめもとで叩く。200 が返るのは `settings.manage` を
   * 持つ人だけなので、そのままボタンの表示可否として使う。
   */
  useEffect(() => {
    let live = true
    const mine = mergeDetectTicket.current + 1
    mergeDetectTicket.current = mine
    setMergeEntry(null)
    const current = detail
    if (current === null || current.phone === null) return
    const primaryId = current.id
    const phone = current.phone
    async function detect() {
      const res = await client.api.staff.customers.lookup.$get(undefined, {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          auth.authFetch(`${String(input)}?phone=${encodeURIComponent(phone)}`, init),
      })
      if (!live || mergeDetectTicket.current !== mine || !res.ok) return
      const hits: CustomerCandidate[] = await res.json()
      const other = hits.find((hit) => hit.customer.id !== primaryId)
      if (other === undefined) return
      const preview = await client.api.staff.customers.merge.preview.$post({
        json: { primaryId, secondaryId: other.customer.id },
      })
      if (!live || mergeDetectTicket.current !== mine || preview.status !== 200) return
      const secondaryRes = await client.api.staff.customers[':customerId'].$get({
        param: { customerId: other.customer.id },
      })
      if (!live || mergeDetectTicket.current !== mine || !secondaryRes.ok) return
      const secondary: CustomerDetailShape = await secondaryRes.json()
      setMergeEntry({ secondaryId: other.customer.id, secondary })
    }
    detect().catch(() => undefined)
    return () => {
      live = false
    }
  }, [detail])

  async function runMergePreview(primaryId: string, secondaryId: string): Promise<boolean> {
    mergeIdempotencyKey.current = crypto.randomUUID()
    const res = await client.api.staff.customers.merge.preview.$post({
      json: { primaryId, secondaryId },
    })
    if (!res.ok) return false
    const [primaryRes, secondaryRes] = await Promise.all([
      client.api.staff.customers[':customerId'].$get({ param: { customerId: primaryId } }),
      client.api.staff.customers[':customerId'].$get({ param: { customerId: secondaryId } }),
    ])
    if (!primaryRes.ok || !secondaryRes.ok) return false
    const primary: CustomerDetailShape = await primaryRes.json()
    const secondary: CustomerDetailShape = await secondaryRes.json()
    setMergeState({ phase: 'ready', primary, secondary, rejection: null })
    return true
  }

  function openMerge() {
    if (mergeEntry === null || detail === null) return
    setPane('merge')
    setMergeState(null)
    runMergePreview(detail.id, mergeEntry.secondaryId).catch(() =>
      setMergeState({ phase: 'error', message: '下見を読み込めませんでした。' }),
    )
  }

  async function submitMerge(request: MergeRequest) {
    if (mergeState?.phase !== 'ready') return
    const { primary, secondary } = mergeState
    setMergeState({ phase: 'submitting', primary, secondary })
    const res = await client.api.staff.customers.merge.$post(
      // `MergeRequest.fields[].field` is `string`（純関数側は項目名を検査しない）だが、
      // `CustomerMerge` は自分が渡した 4 項目（`FIELD_LABELS` のキー）しか作らないので、
      // 契約の列挙に必ず収まる。
      { json: request as Parameters<typeof client.api.staff.customers.merge.$post>[0]['json'] },
      { headers: { 'Idempotency-Key': mergeIdempotencyKey.current } },
    )
    if (res.status === 409) {
      /*
       * 下見のあとに登録が動いた。**何が動いたのかを言う。**
       * 固定の 1 文だけを出していたころ、利用者は「もう一度下見してください」と
       * 言われても、どちらの登録の何が変わったのかを自分で探すしかなかった
       * （実装不足の洗い出し customers-06）。いまの姿を取り直して読み比べる。
       */
      const [freshPrimary, freshSecondary] = await Promise.all([
        client.api.staff.customers[':customerId']
          .$get({ param: { customerId: primary.id } })
          .then(async (found) => (found.ok ? ((await found.json()) as CustomerDetailShape) : null))
          .catch(() => null),
        client.api.staff.customers[':customerId']
          .$get({ param: { customerId: secondary.id } })
          .then(async (found) => (found.ok ? ((await found.json()) as CustomerDetailShape) : null))
          .catch(() => null),
      ])
      const moved = [...movedLines(primary, freshPrimary), ...movedLines(secondary, freshSecondary)]
      setMergeState({
        phase: 'ready',
        primary: freshPrimary ?? primary,
        secondary: freshSecondary ?? secondary,
        rejection: {
          changes:
            moved.length === 0
              ? ['下見のあとに、いずれかの登録が動きました。もう一度下見してください。']
              : [...moved, 'もう一度下見してから、まとめてください。'],
        },
      })
      return
    }
    if (!res.ok) {
      setMergeState({ phase: 'error', message: 'まとめられませんでした。もう一度お試しください。' })
      return
    }
    setNotice(null)
    setMergeEntry(null)
    setPane('detail')
    openCustomer(primary.id).catch(() => setDetailPhase('error'))
  }

  async function loadSheets(customerId: string) {
    setSheetsLoading(true)
    setSheetsError(null)
    const res = await client.api.staff.customers[':customerId'].notes.$get(
      { param: { customerId } },
      {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          auth.authFetch(`${String(input)}?includeOtherStores=true`, init),
      },
    )
    setSheetsLoading(false)
    if (!res.ok) {
      setSheetsError('手書きメモを読み込めませんでした。')
      return
    }
    const notes: CustomerNote[] = await res.json()
    setSheets(
      notes
        .filter((note) => note.handwritingSvg !== null)
        .map((note) => toSheet(note, storeName(note.storeId))),
    )
  }

  function openHandwriting() {
    if (detail === null) return
    setPane('handwrite')
    setSheets(null)
    loadSheets(detail.id).catch(() => setSheetsError('手書きメモを読み込めませんでした。'))
  }

  async function lookupByPhone(phoneDigits: string): Promise<readonly CustomerCandidate[]> {
    const res = await client.api.staff.customers.lookup.$get(undefined, {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        auth.authFetch(`${String(input)}?phone=${encodeURIComponent(phoneDigits)}`, init),
    })
    if (!res.ok) throw new Error('customer_lookup_failed')
    return (await res.json()) as CustomerCandidate[]
  }

  async function createCustomer(input: CustomerCreate) {
    const res = await client.api.staff.customers.$post({ json: input })
    if (!res.ok) {
      // `CustomerNew` は `phase="error"` のときだけ文言を出す。詳細は問わず、打った内容は残す。
      setNotice(null)
      return
    }
    const created: CustomerDetailShape = await res.json()
    onStartBooking({ id: created.id, name: created.name, kana: created.kana, phone: created.phone })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {notice !== null && (
        <p
          role="status"
          className="flex-none border-line border-b bg-surface px-4 py-2 text-grid text-ink-muted"
        >
          {notice}
        </p>
      )}
      <div className="min-h-0 flex-1">
        {pane === 'list' ? (
          <CustomerList
            items={items}
            phase={listPhase}
            initialQuery={initialQuery}
            summary={detail}
            summaryPhase={
              detailPhase === 'ready' ? 'ready' : detailPhase === 'loading' ? 'loading' : 'error'
            }
            onSelect={(customerId) => {
              setNotice(null)
              openCustomer(customerId).catch(() => setDetailPhase('error'))
            }}
            onOpenDetail={() => setPane('detail')}
            onStartBooking={(customerId) => {
              const summary = items?.find((row) => row.id === customerId) ?? null
              onStartBooking({
                id: customerId,
                name: summary?.name ?? '',
                kana: summary?.kana ?? '',
                phone: summary?.phone ?? null,
              })
            }}
            onCreate={() => {
              setNotice(null)
              setPane('new')
            }}
            onConditions={handleConditions}
            onRetry={() => {
              setListPhase('loading')
              setListReload((count) => count + 1)
            }}
          />
        ) : pane === 'detail' ? (
          <CustomerDetail
            detail={detail}
            phase={detailPhase}
            onBack={() => {
              setNotice(null)
              setPane('list')
            }}
            onEdit={() => setNotice('お客様の情報を直す画面はこれから作ります。')}
            onStartBooking={(customerId) =>
              onStartBooking({
                id: customerId,
                name: detail?.name ?? '',
                kana: detail?.kana ?? '',
                phone: detail?.phone ?? null,
              })
            }
            onOpenHandwriting={() => openHandwriting()}
            onOpenMerge={mergeEntry === null ? undefined : () => openMerge()}
          />
        ) : pane === 'new' ? (
          <CustomerNew
            onLookup={lookupByPhone}
            onCreate={(input) => {
              createCustomer(input).catch(() => undefined)
            }}
            onUseExisting={(customer) => {
              setPane('detail')
              openCustomer(customer.id).catch(() => setDetailPhase('error'))
            }}
            onSkip={() => setPane('list')}
            onCancel={() => setPane('list')}
          />
        ) : pane === 'merge' ? (
          mergeState === null || mergeState.phase === 'error' ? (
            <div className="flex h-full w-full min-h-0 items-start px-9 py-8">
              <p
                role="alert"
                className="max-w-138 rounded-card border border-line bg-surface px-5 py-4 text-body text-ink"
              >
                {mergeState?.phase === 'error' ? mergeState.message : '下見を読み込んでいます…'}
              </p>
            </div>
          ) : (
            <CustomerMergePane
              state={mergeState}
              onMerge={(request) => {
                submitMerge(request).catch(() =>
                  setMergeState({
                    phase: 'error',
                    message: 'まとめられませんでした。もう一度お試しください。',
                  }),
                )
              }}
              onPreviewAgain={() => {
                runMergePreview(mergeState.primary.id, mergeState.secondary.id).catch(() =>
                  setMergeState({ phase: 'error', message: '下見を読み込めませんでした。' }),
                )
              }}
              onCancel={() => {
                setPane('detail')
              }}
              onSwap={() => {
                // まとめる相手を選び直す入口はまだ無い（自動で見つけた 1 組だけを扱う）。
                // 同じ組み合わせで下見を取り直す以上のことはできないので、詳細へ戻す。
                setPane('detail')
              }}
            />
          )
        ) : (
          <CustomerHandwrite
            sheets={sheets ?? []}
            loading={sheetsLoading}
            error={sheetsError}
            writer={writer}
            now={new Date().toISOString()}
            onBack={() => setPane('detail')}
            onReload={
              detail === null ? undefined : () => loadSheets(detail.id).catch(() => undefined)
            }
            onSaveSheet={(sheet) => {
              if (detail === null) return
              client.api.staff.customers[':customerId'].notes
                .$post({
                  param: { customerId: detail.id },
                  json: {
                    kind: 'memo',
                    body: '',
                    handwritingSvg: sheet.svg,
                    // 6 枚目のときに人が選んだ「置き換える 1 枚」。渡していなかった
                    // ころ、選ばせておいて押しても何も起きなかった（customers-02）。
                    replacesId: sheet.replacesId,
                    storeId,
                  },
                })
                .then((res) => (res.ok ? loadSheets(detail.id) : undefined))
                .catch(() => setSheetsError('保存できませんでした。もう一度お試しください。'))
            }}
            onSaveText={({ noteId, revision, body }) => {
              if (detail === null) return
              client.api.staff.customers[':customerId'].notes[':noteId']
                .$patch({ param: { customerId: detail.id, noteId }, json: { revision, body } })
                .then((res) => (res.ok ? loadSheets(detail.id) : undefined))
                .catch(() => setSheetsError('保存できませんでした。もう一度お試しください。'))
            }}
            onRequestAttention={({ noteId, revision, body }) => {
              if (detail === null) return
              client.api.staff.customers[':customerId'].notes[':noteId'].publish
                .$post({ param: { customerId: detail.id, noteId }, json: { revision, body } })
                .then((res) => (res.ok ? loadSheets(detail.id) : undefined))
                .catch(() => setSheetsError('申し込めませんでした。もう一度お試しください。'))
            }}
          />
        )}
      </div>
    </div>
  )
}

/** `MergePaneState` から `CustomerMerge` の props を組み立てるだけの薄い橋渡し。 */
function CustomerMergePane({
  state,
  onMerge,
  onPreviewAgain,
  onCancel,
  onSwap,
}: {
  state: Extract<MergePaneState, { phase: 'ready' | 'submitting' }>
  onMerge: CustomerMergeProps['onMerge']
  onPreviewAgain: () => void
  onCancel: () => void
  onSwap: () => void
}) {
  const canManage = true // ここへ来られた時点で `merge/preview` が 200 を返している。
  return (
    <CustomerMerge
      primary={toMergeSide(state.primary)}
      secondary={toMergeSide(state.secondary)}
      canManage={canManage}
      loading={state.phase === 'submitting'}
      rejection={state.phase === 'ready' ? state.rejection : null}
      onMerge={onMerge}
      onPreviewAgain={onPreviewAgain}
      onCancel={onCancel}
      onSwap={onSwap}
    />
  )
}
