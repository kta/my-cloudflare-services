import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen } from './SettingsScreen'

/*
 * 店舗の情報（承認済みモック docs/frontend/mockups/eyex/images/SETTINGS-STORE.png）。
 * お客様に見せる名前・道順・紹介文を 1 か所で直す面。200 文字の境界を画面で見せる。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'

const storeDetail = {
  id: STORE_ID,
  organizationId: 'eyex',
  name: 'EYEX 銀座店',
  slug: 'ginza',
  phone: '03-3571-0001',
  address: '東京都中央区銀座4-5-6　EYEXビル 2階',
  accessNote: 'A1出口から徒歩3分',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  namePublic: 'EYEX 銀座店（銀座4丁目）',
  nearestStation: '東京メトロ 銀座駅',
  parkingNote: '提携駐車場はありません',
  introText: '銀座4丁目の交差点からすぐ。',
  sortOrder: 0,
  updatedAt: '2026-08-20T01:00:00.000Z',
  updatedBy: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  settingsVersion: 3,
}

const staff = [
  {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    displayName: '山田 大輔',
    kana: 'やまだ だいすけ',
    jobLabel: '店長',
    role: 'manager',
    isActive: true,
    sortOrder: 5,
    skills: [],
    adminUserId: 'dev:eyex-manager',
    hasPin: true,
    maxParallelReservations: 1,
    pinUpdatedAt: null,
  },
]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      if ((init.method ?? 'GET').toUpperCase() === 'PATCH')
        return json({ ...storeDetail, settingsVersion: 4 })
      if (url.endsWith('/staff')) return json(staff)
      if (url.includes(`/api/staff/stores/${STORE_ID}`)) return json(storeDetail)
      return json({ error: 'not_found' }, 404)
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

async function openStoreInfo() {
  render(<SettingsScreen storeId={STORE_ID} />)
  await screen.findByLabelText('店名')
}

/** 紹介文の欄を開く（モックは本文と「書き直す」の 2 段になっている）。 */
async function openIntro() {
  await userEvent.click(screen.getByRole('button', { name: '書き直す' }))
  return screen.getByLabelText('お客様に見せる紹介文')
}

describe('店舗の情報', () => {
  it('見出しが「店舗の情報」になり、「お店の基本」と「行き方のご案内」の 2 群が並ぶ', async () => {
    await openStoreInfo()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('店舗の情報')
    expect(screen.getByRole('group', { name: 'お店の基本' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '行き方のご案内' })).toBeInTheDocument()
  })

  it('お店の基本は 店名・お客様に見せる店名・電話番号・住所 の 4 行を持つ', async () => {
    await openStoreInfo()
    expect(screen.getByLabelText('店名')).toHaveValue('EYEX 銀座店')
    expect(screen.getByLabelText('お客様に見せる店名')).toHaveValue('EYEX 銀座店（銀座4丁目）')
    expect(screen.getByLabelText('電話番号')).toHaveValue('03-3571-0001')
    expect(screen.getByLabelText('住所')).toHaveValue('東京都中央区銀座4-5-6　EYEXビル 2階')
  })

  it('行き方のご案内は 最寄り駅・出口と所要時間・駐車場 の 3 行を持つ', async () => {
    await openStoreInfo()
    expect(screen.getByLabelText('最寄り駅')).toHaveValue('東京メトロ 銀座駅')
    expect(screen.getByLabelText('出口と所要時間')).toHaveValue('A1出口から徒歩3分')
    expect(screen.getByLabelText('駐車場')).toHaveValue('提携駐車場はありません')
  })

  it('店名と住所を直すと札が「未保存の変更 2件」になる', async () => {
    await openStoreInfo()
    await userEvent.clear(screen.getByLabelText('店名'))
    await userEvent.type(screen.getByLabelText('店名'), 'EYEX 銀座本店')
    expect(screen.getByText('未保存の変更 1件')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('住所'))
    await userEvent.type(screen.getByLabelText('住所'), '東京都中央区銀座4-5-7')
    expect(screen.getByText('未保存の変更 2件')).toBeInTheDocument()
  })

  it('紹介文が 200 文字ちょうどなら「200文字／200文字まで」と出て保存できる', async () => {
    await openStoreInfo()
    const intro = await openIntro()
    fireEvent.change(intro, { target: { value: 'あ'.repeat(200) } })
    expect(screen.getByText('200文字／200文字まで')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('紹介文が 201 文字なら「紹介文が 200 文字を超えているため保存できません。文字数を減らしてください。」と出て保存できない', async () => {
    await openStoreInfo()
    const intro = await openIntro()
    fireEvent.change(intro, { target: { value: 'あ'.repeat(201) } })
    expect(screen.getByText('201文字／200文字まで')).toBeInTheDocument()
    expect(
      screen.getByText(
        '紹介文が 200 文字を超えているため保存できません。文字数を減らしてください。',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('電話番号の欄は type="tel" と inputmode="numeric" を持つ', async () => {
    await openStoreInfo()
    const phone = screen.getByLabelText('電話番号')
    expect(phone).toHaveAttribute('type', 'tel')
    expect(phone).toHaveAttribute('inputmode', 'numeric')
  })

  it('どの入力欄も autocomplete="off" を持つ（共有 iPad で前の利用者の入力を候補に出さない）', async () => {
    await openStoreInfo()
    for (const label of [
      '店名',
      'お客様に見せる店名',
      '電話番号',
      '住所',
      '最寄り駅',
      '出口と所要時間',
      '駐車場',
    ]) {
      expect(screen.getByLabelText(label)).toHaveAttribute('autocomplete', 'off')
    }
    expect(await openIntro()).toHaveAttribute('autocomplete', 'off')
  })

  it('続きのある欄は enterkeyhint="next"、最後の欄は "done" を持つ', async () => {
    await openStoreInfo()
    expect(screen.getByLabelText('店名')).toHaveAttribute('enterkeyhint', 'next')
    expect(screen.getByLabelText('出口と所要時間')).toHaveAttribute('enterkeyhint', 'next')
    expect(screen.getByLabelText('駐車場')).toHaveAttribute('enterkeyhint', 'done')
  })

  it('最後に直した日時と操作者を 1 行で出す', async () => {
    await openStoreInfo()
    expect(
      await screen.findByText('最後に直したのは 2026年8月20日（木） 山田 大輔（店長）'),
    ).toBeInTheDocument()
  })
})
