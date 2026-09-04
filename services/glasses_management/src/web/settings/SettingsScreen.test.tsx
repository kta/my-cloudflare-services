import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen } from './SettingsScreen'
import type { SettingsPanelProps } from './sections'

/*
 * 設定の器（承認済みモック docs/frontend/mockups/eye/images/SETTINGS-STORE.png）。
 * 6 面が同じ第2サイドバーと同じ 56px の保存バーの上で切り替わることを固定する。
 * 見た目の寸法は e2e の突き合わせで見るので、ここでは「何が読めて、何が押せるか」を見る。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'

const storeDetail = {
  id: STORE_ID,
  organizationId: 'eye',
  name: 'EYE 銀座店',
  slug: 'ginza',
  phone: '03-3571-0001',
  address: '東京都中央区銀座4-5-6　EYEビル 2階',
  accessNote: 'A1出口から徒歩3分',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  namePublic: 'EYE 銀座店（銀座4丁目）',
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
    adminUserId: 'dev:eye-manager',
    hasPin: true,
    maxParallelReservations: 1,
    pinUpdatedAt: null,
  },
  {
    id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    displayName: '中村 彩',
    kana: 'なかむら あや',
    jobLabel: null,
    role: 'staff',
    isActive: true,
    sortOrder: 2,
    skills: [],
    adminUserId: 'dev:eye',
    hasPin: true,
    maxParallelReservations: 1,
    pinUpdatedAt: null,
  },
]

/** 営業時間の面が読む 2 本。器の試験なので、中身は形が合っていればよい。 */
const businessHours = {
  rows: Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    isClosed: false,
    opensAt: '10:00',
    closesAt: '19:00',
    breakStart: null,
    breakEnd: null,
  })),
  blackouts: [],
  version: 3,
  warnings: [],
}

const slotRules = {
  slotMinutes: 30,
  cleanupMinutes: 10,
  maxParallel: 3,
  version: 3,
  updatedAt: '2026-08-20T01:00:00.000Z',
  lastAcceptableAt: Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [String(weekday), '18:20']),
  ),
  warnings: [],
}

type Reply = { status: number; body: unknown }

/** 直近の PATCH の顛末を差し替えられる、素朴な API の代役。 */
let patchReply: Reply = { status: 200, body: storeDetail }
let sent: { url: string; method: string }[] = []

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  sent = []
  patchReply = { status: 200, body: { ...storeDetail, settingsVersion: 4 } }
  sessionStorage.setItem('app.auth.token', devToken('dev:eye'))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const method = (init.method ?? 'GET').toUpperCase()
      sent.push({ url, method })
      if (method === 'PATCH') return json(patchReply.body, patchReply.status)
      if (url.endsWith('/staff')) return json(staff)
      // 面ごとの読み口は形が違う。店舗の姿を全部に返すと、受け取った面が壊れる。
      if (url.includes('/business-hours')) return json(businessHours)
      if (url.includes('/slot-rules')) return json(slotRules)
      if (url.includes(`/api/staff/stores/${STORE_ID}`)) return json(storeDetail)
      return json({ error: 'not_found' }, 404)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

/** dev グラントが載せる `sub` だけを持つ、署名を確かめない見せかけの JWT。 */
function devToken(sub: string): string {
  const payload = btoa(JSON.stringify({ sub, org: 'eye' }))
  return `header.${payload}.signature`
}

async function openSettings() {
  render(<SettingsScreen storeId={STORE_ID} />)
  await screen.findByRole('button', { name: '保存' })
}

async function typeInto(label: string, value: string) {
  const input = screen.getByLabelText(label)
  await userEvent.clear(input)
  await userEvent.type(input, value)
}

describe('第2サイドバー', () => {
  it('端末を含む8項目を実装済みの順に持つ', async () => {
    await openSettings()
    const nav = screen.getByRole('navigation', { name: '設定の項目' })
    const names = Array.from(nav.querySelectorAll('button')).map((b) => b.textContent)
    expect(names).toEqual([
      '店舗の情報',
      '営業日',
      '営業時間',
      'ご来店の目的',
      'スタッフと技能',
      '設備と点検',
      'Web予約の公開',
      '端末',
    ])
  })

  it('モックが描いている「予約のきまり」「公開」などの 8 項目は出さない', async () => {
    await openSettings()
    for (const gone of [
      '予約のきまり',
      '公開',
      '受付できる時間',
      'お知らせ文',
      '項目',
      '注意ごと',
      '端末の登録',
      'PINと自動ロック',
    ]) {
      expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument()
    }
  })

  it('いま開いている項目に aria-current="page" が付く', async () => {
    await openSettings()
    expect(screen.getByRole('button', { name: '店舗の情報' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('button', { name: '営業時間' })).not.toHaveAttribute('aria-current')
  })

  it('項目を選ぶと見出しがその名前に変わる', async () => {
    await openSettings()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('店舗の情報')
    await userEvent.click(screen.getByRole('button', { name: 'スタッフと技能' }))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('スタッフと技能')
    expect(screen.getByRole('button', { name: 'スタッフと技能' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('6 項目のどれを選んでも面が出る（「この面はこれから作ります。」を出さない）', async () => {
    await openSettings()
    for (const section of [
      '営業日',
      '営業時間',
      'ご来店の目的',
      'スタッフと技能',
      '設備と点検',
      '店舗の情報',
    ]) {
      await userEvent.click(screen.getByRole('button', { name: section }))
      expect(screen.queryByText('この面はこれから作ります。')).not.toBeInTheDocument()
    }
  })
})

describe('保存バー', () => {
  it('変更が無ければ札を出さず、保存は押せない', async () => {
    await openSettings()
    expect(screen.queryByText(/未保存の変更/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '変更を捨てる' })).toBeDisabled()
  })

  it('編集を捨てるボタンは「変更を捨てる」で、「キャンセル」とは書かない', async () => {
    await openSettings()
    expect(screen.getByRole('button', { name: '変更を捨てる' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'キャンセル' })).not.toBeInTheDocument()
  })

  it('2 項目を直すと札が「未保存の変更 2件」になり、保存が押せる', async () => {
    await openSettings()
    await typeInto('店名', 'EYE 銀座本店')
    await typeInto('住所', '東京都中央区銀座4-5-7')
    expect(screen.getByText('未保存の変更 2件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('件数の変化は割り込まない知らせ（role="status"）として 1 度だけ伝わる', async () => {
    await openSettings()
    await typeInto('店名', 'EYE 銀座本店')
    const tags = screen.getAllByText('未保存の変更 1件')
    expect(tags).toHaveLength(1)
    const tag = tags[0] as HTMLElement
    expect(tag.closest('[role="status"]')).not.toBeNull()
    expect(tag.closest('[role="alert"]')).toBeNull()
  })

  it('「変更を捨てる」を押すと値が編集前へ戻り、札が消える', async () => {
    await openSettings()
    await typeInto('店名', 'EYE 銀座本店')
    await userEvent.click(screen.getByRole('button', { name: '変更を捨てる' }))
    expect(screen.getByLabelText('店名')).toHaveValue('EYE 銀座店')
    expect(screen.queryByText(/未保存の変更/)).not.toBeInTheDocument()
  })

  it('保存できたら「保存しました」が 1 度だけ伝わり、札が消える', async () => {
    await openSettings()
    await typeInto('店名', 'EYE 銀座本店')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    const saved = await screen.findAllByText('保存しました')
    expect(saved).toHaveLength(1)
    expect((saved[0] as HTMLElement).closest('[role="status"]')).not.toBeNull()
    expect(screen.queryByText(/未保存の変更/)).not.toBeInTheDocument()
  })

  it('保存が落ちたら「保存できませんでした。入力はそのまま残っています。」を出し、打ち込んだ値を保つ', async () => {
    patchReply = { status: 500, body: { error: 'internal' } }
    await openSettings()
    await typeInto('店名', 'EYE 銀座本店')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(
      await screen.findByText('保存できませんでした。入力はそのまま残っています。'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('店名')).toHaveValue('EYE 銀座本店')
  })

  it('影響するご予約が 1 件以上あると札が赤くなり、色だけでなく文字でも伝える', async () => {
    render(<SettingsScreen storeId={STORE_ID} panels={{ store: DangerPanel }} />)
    const tag = await screen.findByText('未保存の変更 1件')
    expect(tag).toHaveClass('text-danger')
    // 赤いだけにしない。理由を文字でも添える。
    expect(screen.getByText('止めると影響するご予約が 3件 あります')).toBeInTheDocument()
  })

  it('ほかの端末が先に保存していたら、何をすればよいかを出す', async () => {
    patchReply = { status: 409, body: { error: 'version_conflict' } }
    await openSettings()
    await typeInto('店名', 'EYE 銀座本店')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(
      await screen.findByText(
        'ほかの端末が先に保存しました。画面を開き直して、もう一度お試しください。',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('店名')).toHaveValue('EYE 銀座本店')
  })
})

describe('権限', () => {
  it('保存が 403 で跳ねられたら EX-PERMISSION の型で断り、打ち込んだ値を残す', async () => {
    patchReply = { status: 403, body: { error: 'forbidden' } }
    await openSettings()
    await typeInto('店名', 'EYE 銀座本店')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('この操作は店長だけができます')).toBeInTheDocument()
    expect(
      screen.getByText(
        '店舗の情報を変えられるのは 店長 だけです。中村 彩（スタッフ）の権限では保存できません。店舗の情報はまだ何も変わっていません。',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('下書きは残っています')).toBeInTheDocument()
    expect(screen.getByText(/店名を .* から .* に変える/)).toBeInTheDocument()
    expect(screen.getByLabelText('店名')).toHaveValue('EYE 銀座本店')
  })

  it('「この下書きを店長に依頼する」のボタンを出さない', async () => {
    patchReply = { status: 403, body: { error: 'forbidden' } }
    await openSettings()
    await typeInto('店名', 'EYE 銀座本店')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('この操作は店長だけができます')
    expect(
      screen.queryByRole('button', { name: 'この下書きを店長に依頼する' }),
    ).not.toBeInTheDocument()
  })
})

describe('文字を 200% にしたとき', () => {
  it('第2サイドバーが細い柱に倒れ、行き先の名前は読み上げに残る', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    await openSettings()
    const item = screen.getByRole('button', { name: '営業時間' })
    expect(item.querySelector('.sr-only')?.textContent).toBe('営業時間')
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: '設定の項目' })).toHaveClass('w-19'),
    )
  })
})

/** 影響の件数を出す面の代役。器が赤い札を出す道筋だけを見る。 */
function DangerPanel({ onDraftChange }: SettingsPanelProps) {
  useEffect(() => {
    onDraftChange({
      changes: ['視力測定機 B を止める'],
      blocked: null,
      danger: true,
      dangerNote: '止めると影響するご予約が 3件 あります',
      save: async () => 'saved',
      discard: () => {},
    })
  }, [onDraftChange])
  return <p>止めると影響するご予約　3件</p>
}
