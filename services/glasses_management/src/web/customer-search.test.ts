import type { CustomerCandidate } from '@app/contracts'
import { describe, expect, test } from 'vitest'
import {
  buildCustomerSearchQuery,
  chooseNewCustomer,
  clearSelection,
  customerSearchPath,
  customerSearchTermFor,
  emptyCustomerSelection,
  normalisePhone,
  parseCustomerCandidates,
  possibleDuplicates,
  selectCandidate,
  selectedCandidate,
  withCandidates,
} from './customer-search'

const hanako: CustomerCandidate = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: '田中 花子',
  kana: 'タナカ ハナコ',
  phone: '090-1234-5678',
  email: 'hanako@example.com',
  primaryStoreId: '00000000-0000-4000-8000-0000000000a1',
  visitCount: 4,
}
const ichiro: CustomerCandidate = {
  id: '00000000-0000-4000-8000-0000000000c2',
  name: '田中 一郎',
  kana: 'タナカ イチロウ',
  phone: '090-1234-9912',
  email: null,
  primaryStoreId: '00000000-0000-4000-8000-0000000000a1',
  visitCount: 1,
}

describe('normalisePhone (AC-EYEX-20)', () => {
  test('hyphens, spaces and full-width digits all resolve to the same number', () => {
    const expected = '09012345678'
    expect(normalisePhone('090-1234-5678')).toBe(expected)
    expect(normalisePhone('090 1234 5678')).toBe(expected)
    expect(normalisePhone('09012345678')).toBe(expected)
    expect(normalisePhone('０９０－１２３４－５６７８')).toBe(expected)
    expect(normalisePhone('０９０ー１２３４‐５６７８')).toBe(expected)
    expect(normalisePhone('　０９０　１２３４　５６７８　')).toBe(expected)
  })

  test('keeps a partial number partial so a prefix search still works (UC-EYEX-021)', () => {
    expect(normalisePhone('090-1234')).toBe('0901234')
    expect(normalisePhone('０９０－１２３４')).toBe('0901234')
  })

  test('drops characters that are not digits rather than guessing', () => {
    expect(normalisePhone('tel: 090.1234.5678')).toBe('09012345678')
    expect(normalisePhone('')).toBe('')
    expect(normalisePhone('---')).toBe('')
  })
})

describe('buildCustomerSearchQuery', () => {
  test('sends exactly one term — a normalised phone (UC-EYEX-021)', () => {
    expect(buildCustomerSearchQuery({ field: 'phone', value: '０９０－１２３４' })).toEqual({
      phone: '0901234',
    })
  })

  test('sends a trimmed name or kana term (UC-EYEX-022)', () => {
    expect(buildCustomerSearchQuery({ field: 'name', value: '  田中  ' })).toEqual({ name: '田中' })
    expect(buildCustomerSearchQuery({ field: 'kana', value: 'タナカ' })).toEqual({
      kana: 'タナカ',
    })
  })

  test('returns undefined for a blank or unusable term instead of querying', () => {
    expect(buildCustomerSearchQuery({ field: 'phone', value: '--' })).toBeUndefined()
    expect(buildCustomerSearchQuery({ field: 'name', value: '   ' })).toBeUndefined()
    expect(buildCustomerSearchQuery({ field: 'kana', value: '' })).toBeUndefined()
  })
})

describe('customerSearchPath', () => {
  test('scopes the search to the selected store and encodes the single term', () => {
    expect(customerSearchPath('00000000-0000-4000-8000-0000000000a1', { phone: '0901234' })).toBe(
      '/api/staff/stores/00000000-0000-4000-8000-0000000000a1/customers?phone=0901234',
    )
    expect(customerSearchPath('00000000-0000-4000-8000-0000000000a1', { name: '田中 花' })).toBe(
      '/api/staff/stores/00000000-0000-4000-8000-0000000000a1/customers?name=%E7%94%B0%E4%B8%AD+%E8%8A%B1',
    )
  })
})

describe('parseCustomerCandidates', () => {
  test('parses the response through the shared Zod contract', () => {
    expect(parseCustomerCandidates([hanako, ichiro])).toEqual([hanako, ichiro])
  })

  test('rejects a payload that does not match the contract', () => {
    expect(() => parseCustomerCandidates([{ id: 'not-a-uuid' }])).toThrow()
  })
})

describe('candidate selection (UC-EYEX-023, AC-EYEX-21)', () => {
  test('starts with nothing selected and nothing bound', () => {
    expect(emptyCustomerSelection.candidates).toEqual([])
    expect(emptyCustomerSelection.selectedId).toBeUndefined()
    expect(emptyCustomerSelection.newCustomer).toBe(false)
    expect(selectedCandidate(emptyCustomerSelection)).toBeUndefined()
  })

  test('receiving candidates never auto-selects one, even when only one matches', () => {
    const state = withCandidates(emptyCustomerSelection, [hanako])
    expect(state.candidates).toEqual([hanako])
    expect(state.selectedId).toBeUndefined()
    expect(selectedCandidate(state)).toBeUndefined()
  })

  test('a new result set drops the previous selection so no stale customer stays bound', () => {
    const selected = selectCandidate(
      withCandidates(emptyCustomerSelection, [hanako, ichiro]),
      hanako.id,
    )
    expect(selectedCandidate(selected)).toEqual(hanako)
    const refreshed = withCandidates(selected, [ichiro])
    expect(refreshed.selectedId).toBeUndefined()
    expect(selectedCandidate(refreshed)).toBeUndefined()
  })

  test('selecting an unknown id binds nobody', () => {
    const state = selectCandidate(withCandidates(emptyCustomerSelection, [hanako]), ichiro.id)
    expect(selectedCandidate(state)).toBeUndefined()
  })

  test('choosing "new customer" clears any selected candidate (UC-EYEX-024)', () => {
    const state = chooseNewCustomer(
      selectCandidate(withCandidates(emptyCustomerSelection, [hanako]), hanako.id),
    )
    expect(state.newCustomer).toBe(true)
    expect(selectedCandidate(state)).toBeUndefined()
  })

  test('selecting a candidate cancels the "new customer" choice', () => {
    const state = selectCandidate(
      chooseNewCustomer(withCandidates(emptyCustomerSelection, [hanako])),
      hanako.id,
    )
    expect(state.newCustomer).toBe(false)
    expect(selectedCandidate(state)).toEqual(hanako)
  })

  test('clearing the selection unbinds the customer without dropping the candidates', () => {
    const state = clearSelection(
      selectCandidate(withCandidates(emptyCustomerSelection, [hanako, ichiro]), hanako.id),
    )
    expect(state.candidates).toHaveLength(2)
    expect(selectedCandidate(state)).toBeUndefined()
  })
})

describe('possibleDuplicates (UC-EYEX-028)', () => {
  test('groups candidates that share a normalised phone number without merging them', () => {
    const sameNumber: CustomerCandidate = {
      ...ichiro,
      id: hanako.id.replace(/1$/, '3'),
      phone: '09012345678',
    }
    const groups = possibleDuplicates([hanako, ichiro, sameNumber])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.map((candidate) => candidate.id)).toEqual([hanako.id, sameNumber.id])
  })

  test('reports no duplicates when every candidate has a distinct number', () => {
    expect(possibleDuplicates([hanako, ichiro])).toEqual([])
  })

  test('ignores candidates with no phone number at all', () => {
    const noPhone = { ...hanako, id: ichiro.id, phone: '' }
    expect(possibleDuplicates([{ ...hanako, phone: '' }, noPhone])).toEqual([])
  })
})

/*
 * 顧客台帳の左レールはモックどおり検索欄が 1 本しかない（`staff-approved.html`
 * の `.search{placeholder:氏名・電話番号}`）。打たれた 1 本の文字列がどちらの
 * 検索語なのかは、欄ではなくここで決める。
 */
describe('1 本の検索欄から検索語を決める', () => {
  test('数字・ハイフン・空白だけなら電話番号として扱う', () => {
    expect(customerSearchTermFor('090-1234-5678')).toEqual({
      field: 'phone',
      value: '090-1234-5678',
    })
    expect(customerSearchTermFor('０９０ １２３４')).toEqual({
      field: 'phone',
      value: '０９０ １２３４',
    })
  })

  test('文字が混じれば氏名として扱う', () => {
    expect(customerSearchTermFor('田中 花子')).toEqual({ field: 'name', value: '田中 花子' })
    // 数字を含む氏名でも、数字以外があれば氏名。電話番号に落とさない。
    expect(customerSearchTermFor('田中090')).toEqual({ field: 'name', value: '田中090' })
  })

  test('空・空白だけなら検索語にならない', () => {
    expect(customerSearchTermFor('')).toBeUndefined()
    expect(customerSearchTermFor('　 ')).toBeUndefined()
    // ハイフンだけでは電話番号にならない（正規化すると桁が残らない）。
    expect(customerSearchTermFor('--')).toBeUndefined()
  })
})
