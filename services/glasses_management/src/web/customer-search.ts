import { CustomerCandidate, CustomerSearchQuery } from '@app/contracts'

/**
 * 顧客の同定に必要な純粋ロジック（React 非依存）。
 *
 * ここに置くのは「正規化」と「候補の選択状態」だけで、どちらも UI から切り離して
 * 境界値を直接テストできるようにしてある。とくに選択状態は **自動確定しない**
 * ことが仕様（UC-EYEX-023 / AC-EYEX-21）なので、候補が 1 件でも自動選択しない。
 */

type CustomerSearchField = 'phone' | 'name' | 'kana'
export type CustomerSearchTerm = { field: CustomerSearchField; value: string }

/**
 * 電話番号の正規化（AC-EYEX-20）。全角数字・ハイフン（半角/全角/長音/ハイフン類）・
 * 空白（半角/全角）の差を吸収し、数字だけを残す。部分入力は部分のまま返す
 * （前方一致検索を壊さないため）。
 */
export function normalisePhone(raw: string): string {
  let digits = ''
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0
    if (code >= 0x30 && code <= 0x39) digits += character
    // 全角数字 ０-９
    else if (code >= 0xff10 && code <= 0xff19) digits += String.fromCharCode(code - 0xff10 + 0x30)
  }
  return digits
}

/** 契約が要求する「ちょうど 1 つの検索語」を組み立てる。空なら検索しない。 */
export function buildCustomerSearchQuery(
  term: CustomerSearchTerm,
): CustomerSearchQuery | undefined {
  const value = term.field === 'phone' ? normalisePhone(term.value) : term.value.trim()
  if (value === '') return undefined
  const parsed = CustomerSearchQuery.safeParse({ [term.field]: value })
  return parsed.success ? parsed.data : undefined
}

/*
 * 数字・ハイフン類・空白だけでできているか。全角数字と全角ハイフン・波ダッシュ
 * まで含めるのは、電話で伺った番号をそのまま打つ人がいるため。
 */
const PHONE_SHAPED =
  /^[0-9\uff10-\uff19\s\u3000\-\u2010\u2011\u2012\u2013\u2014\u2015\u30fc\uff0d]+$/

/**
 * 顧客台帳の左レールは検索欄が 1 本しかない（承認済みモックの
 * `placeholder:氏名・電話番号`）。打たれた文字列がどちらなのかを、欄ではなく
 * ここで決める。数字だけなら電話番号、1 文字でも他が混じれば氏名。
 */
export function customerSearchTermFor(raw: string): CustomerSearchTerm | undefined {
  const value = raw.trim()
  if (value === '') return undefined
  if (PHONE_SHAPED.test(value))
    // ハイフンだけを打った状態は「まだ番号ではない」。桁が残らないなら検索しない。
    return normalisePhone(value) === '' ? undefined : { field: 'phone', value: raw }
  return { field: 'name', value: raw }
}

/** 選択中店舗にスコープした検索 URL。検索語は 1 つだけ付く。 */
export function customerSearchPath(storeId: string, query: CustomerSearchQuery): string {
  const params = new URLSearchParams()
  if (query.phone !== undefined) params.set('phone', query.phone)
  if (query.name !== undefined) params.set('name', query.name)
  if (query.kana !== undefined) params.set('kana', query.kana)
  return `/api/staff/stores/${storeId}/customers?${params.toString()}`
}

/** API レスポンスは必ず共有 Zod 契約で検証してから使う。 */
const CustomerCandidateList = CustomerCandidate.array()

export function parseCustomerCandidates(payload: unknown): CustomerCandidate[] {
  return CustomerCandidateList.parse(payload)
}

export type CustomerSelection = {
  candidates: CustomerCandidate[]
  selectedId?: string
  /** 「新規のお客様として進む」を選んだか（UC-EYEX-024）。 */
  newCustomer: boolean
}

export const emptyCustomerSelection: CustomerSelection = { candidates: [], newCustomer: false }

/** 新しい検索結果を受け取る。前の選択は必ず外れる（古い顧客が残らない）。 */
export function withCandidates(
  _state: CustomerSelection,
  candidates: CustomerCandidate[],
): CustomerSelection {
  return { candidates, newCustomer: false }
}

export function selectCandidate(state: CustomerSelection, id: string): CustomerSelection {
  const found = state.candidates.some((candidate) => candidate.id === id)
  return { candidates: state.candidates, selectedId: found ? id : undefined, newCustomer: false }
}

export function clearSelection(state: CustomerSelection): CustomerSelection {
  return { candidates: state.candidates, newCustomer: false }
}

export function chooseNewCustomer(state: CustomerSelection): CustomerSelection {
  return { candidates: state.candidates, newCustomer: true }
}

export function selectedCandidate(state: CustomerSelection): CustomerCandidate | undefined {
  if (state.selectedId === undefined) return undefined
  return state.candidates.find((candidate) => candidate.id === state.selectedId)
}

/**
 * 重複の「可能性」だけを示す（UC-EYEX-028）。正規化後の電話番号が同じ候補を
 * まとめて返すだけで、統合は一切しない。
 */
export function possibleDuplicates(candidates: CustomerCandidate[]): CustomerCandidate[][] {
  const groups = new Map<string, CustomerCandidate[]>()
  for (const candidate of candidates) {
    const key = normalisePhone(candidate.phone)
    if (key === '') continue
    const group = groups.get(key)
    if (group) group.push(candidate)
    else groups.set(key, [candidate])
  }
  return [...groups.values()].filter((group) => group.length > 1)
}
