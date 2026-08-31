import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

/*
 * 承認済みモック（docs/frontend/mockups/eyex/images/HOME.png）の骨格が
 * 実際に描かれていることを固定する。見た目の寸法は e2e の突き合わせで見るので、
 * ここでは「何が読めて、何が押せるか」を見る。
 */

const stores = [
  {
    id: '11111111-2222-4333-8444-555555555555',
    organizationId: 'eyex',
    name: 'EYEX 銀座店',
    slug: 'ginza',
    phone: '',
    address: '',
    accessNote: '',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
]

function mockFetch(handler: (url: string) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => handler(String(input))),
  )
}

beforeEach(() => {
  sessionStorage.clear()
  mockFetch((url) => {
    if (url.includes('/api/auth/token')) {
      return new Response(JSON.stringify({ token: 'test-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/staff/stores')) {
      return new Response(JSON.stringify(stores), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function startWork() {
  render(<App />)
  await userEvent.type(screen.getByLabelText('お店のコード'), 'eyex')
  await userEvent.click(screen.getByRole('button', { name: '業務を始める' }))
}

describe('業務開始', () => {
  it('コードが空のまま始めようとすると、何を入れるか教える', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '業務を始める' }))
    expect(screen.getByText('お店のコードを入れてください。')).toBeInTheDocument()
  })

  it('始めると店舗名が上のバーに出る', async () => {
    await startWork()
    await waitFor(() => expect(screen.getByText('EYEX 銀座店')).toBeInTheDocument())
    expect(screen.getByText(/営業中\s+10:00–19:00/)).toBeInTheDocument()
  })
})

describe('左サイドバー', () => {
  it('行き先を上から順に持つ', async () => {
    await startWork()
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: '画面の切り替え' })).toBeInTheDocument(),
    )
    for (const label of [
      'トップ',
      '予約台帳',
      '来店受付',
      '予約を探す',
      '受付履歴',
      '顧客台帳',
      '分析',
      '設定',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: '予約を取る' })).toBeInTheDocument()
    expect(screen.getByText('お店の運用')).toBeInTheDocument()
  })

  it('つまみで細い柱にたたむと、文字は見えなくなるが読み上げ名は残る', async () => {
    await startWork()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '予約台帳' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'サイドバーをたたむ' }))
    // アイコンだけのボタンに名前が無いのは重大な欠陥なので、名前は残したまま隠す
    const collapsed = screen.getByRole('button', { name: '予約台帳' })
    expect(collapsed.querySelector('.sr-only')?.textContent).toBe('予約台帳')
    expect(screen.getByRole('button', { name: 'サイドバーをひらく' })).toBeInTheDocument()
  })

  it('横に広い画面へ移ると、たたんだ状態が既定になる', async () => {
    await startWork()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '予約台帳' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: '予約台帳' }))
    expect(screen.getByRole('button', { name: 'サイドバーをひらく' })).toBeInTheDocument()
  })

  it('いま開いている行き先が分かる', async () => {
    await startWork()
    await waitFor(() => expect(screen.getByRole('button', { name: 'トップ' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'トップ' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('トップ', () => {
  it('主操作は 2 つだけ', async () => {
    await startWork()
    await waitFor(() => expect(screen.getByText('新しい予約を取る')).toBeInTheDocument())
    expect(screen.getByText('お電話・ご来店のお客様')).toBeInTheDocument()
    expect(screen.getByText('予約を変更する')).toBeInTheDocument()
    expect(screen.getByText('日時・内容の変更、取り消し')).toBeInTheDocument()
  })

  it('「予約を変更する」を押すと予約を探す面へ移る（押して何も起きないボタンを置かない）', async () => {
    await startWork()
    await waitFor(() => expect(screen.getByText('予約を変更する')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /予約を変更する/ }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'お客様を伺って探します' })).toBeInTheDocument(),
    )
  })

  it('お店が届いていないときは、その理由と次の行動を出す', async () => {
    mockFetch((url) =>
      url.includes('/api/auth/token')
        ? new Response(JSON.stringify({ token: 't' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(JSON.stringify({ error: 'not_synced' }), { status: 503 }),
    )
    await startWork()
    await waitFor(() =>
      expect(
        screen.getByText(
          'お店の情報がまだ届いていません。しばらくしてからもう一度開いてください。',
        ),
      ).toBeInTheDocument(),
    )
  })

  it('お店が 1 つも無ければ、その事実だけを出す', async () => {
    mockFetch((url) =>
      url.includes('/api/auth/token')
        ? new Response(JSON.stringify({ token: 't' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    )
    await startWork()
    await waitFor(() =>
      expect(screen.getByText('お店がまだ登録されていません。')).toBeInTheDocument(),
    )
  })
})

describe('業務を終える', () => {
  it('終えると業務開始の画面へ戻る', async () => {
    await startWork()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '業務を終える' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: '業務を終える' }))
    expect(screen.getByLabelText('お店のコード')).toBeInTheDocument()
  })
})
