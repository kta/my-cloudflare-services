import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 作業机の外枠。サインイン、案件の文脈、画面の切り替え、そして
 * 「この出力は法的助言ではない」という帰属が常に見えることを固定する。
 */

const login = vi.fn()
const logout = vi.fn()
let organization: string | null = null

vi.mock('@app/shared', () => ({
  auth: {
    getOrganization: () => organization,
    login: (...a: unknown[]) => login(...a),
    logout: () => {
      organization = null
      logout()
    },
    authFetch: () => Promise.resolve(new Response('{}')),
  },
}))

const apiMock = {
  matters: vi.fn(),
  createMatter: vi.fn(),
  matter: vi.fn(),
  jobs: vi.fn(),
  corpusStatus: vi.fn(),
  elements: vi.fn(),
  evidence: vi.fn(),
}
vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return { ...actual, api: apiMock }
})

const { App } = await import('./App')

beforeEach(() => {
  vi.clearAllMocks()
  organization = null
  globalThis.history.replaceState(null, '', '/')
  apiMock.matters.mockResolvedValue([])
  apiMock.jobs.mockResolvedValue([])
  apiMock.elements.mockResolvedValue([])
  apiMock.evidence.mockResolvedValue([])
  apiMock.matter.mockResolvedValue({ id: 'm1', title: '視線追跡の発明', status: 'intake' })
})

describe('サインイン', () => {
  it('作業空間を開く前は、製品の説明と入口だけを出す', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: '典拠' })).toBeInTheDocument()
    expect(screen.getByLabelText('作業空間')).toBeInTheDocument()
  })

  it('法的助言ではないことを、開く前から書いてある', () => {
    render(<App />)
    expect(screen.getByText(/法的助言ではありません/)).toBeInTheDocument()
  })

  it('空のまま押したら理由を出し、通信しない', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '作業空間を開く' }))
    expect(await screen.findByText('作業空間の名前を入れてください。')).toBeInTheDocument()
    expect(login).not.toHaveBeenCalled()
  })

  it('失敗したら、何をすればよいかを書く', async () => {
    login.mockRejectedValue(new Error('nope'))
    render(<App />)
    await userEvent.type(screen.getByLabelText('作業空間'), 'tenkyo')
    await userEvent.click(screen.getByRole('button', { name: '作業空間を開く' }))
    await waitFor(() =>
      expect(screen.getByText(/名前を確かめて、もう一度試してください/)).toBeInTheDocument(),
    )
  })

  it('開くと作業机に入る', async () => {
    login.mockResolvedValue(undefined)
    render(<App />)
    await userEvent.type(screen.getByLabelText('作業空間'), 'tenkyo')
    await userEvent.click(screen.getByRole('button', { name: '作業空間を開く' }))
    await waitFor(() => expect(screen.getByText('新しい案件')).toBeInTheDocument())
  })
})

describe('作業机', () => {
  beforeEach(() => {
    organization = 'tenkyo'
  })

  it('案件・ジョブ・コーパスへ行ける', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('新しい案件')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'ジョブ' }))
    await waitFor(() => expect(screen.getByText('スキルの起こし方')).toBeInTheDocument())
    expect(globalThis.location.pathname).toBe('/jobs')
  })

  it('案件を開くと、案件の中の画面が出る', async () => {
    apiMock.matters.mockResolvedValue([
      {
        id: 'm1',
        organizationId: 'tenkyo',
        title: '視線追跡の発明',
        techField: '',
        status: 'intake',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
        elementCount: 0,
        evidenceCount: 0,
        verifiedCount: 0,
        rejectedCount: 0,
      },
    ])
    render(<App />)
    await waitFor(() => expect(screen.getByText('視線追跡の発明')).toBeInTheDocument())
    await userEvent.click(screen.getByText('視線追跡の発明'))
    await waitFor(() => expect(globalThis.location.pathname).toBe('/m/m1/chart'))
    expect(screen.getByRole('button', { name: 'クレームチャート' })).toBeInTheDocument()
  })

  it('URL から直接その画面を開ける（戻るが効く）', async () => {
    globalThis.history.replaceState(null, '', '/m/m1/elements')
    render(<App />)
    await waitFor(() => expect(screen.getByText('請求項から割る')).toBeInTheDocument())
  })

  it('案件が要る画面を案件なしで開いたら、案件一覧に落とす', async () => {
    globalThis.history.replaceState(null, '', '/chart')
    render(<App />)
    await waitFor(() => expect(screen.getByText('新しい案件')).toBeInTheDocument())
  })

  it('法的助言ではないことが、どの画面でも足元に残る', async () => {
    render(<App />)
    await waitFor(() =>
      expect(
        screen.getByText(/出願の可否・記載の適否の判断は人間（弁理士または出願人本人）が行います/),
      ).toBeInTheDocument(),
    )
  })

  it('閉じると入口に戻る', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('新しい案件')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }))
    await waitFor(() => expect(screen.getByLabelText('作業空間')).toBeInTheDocument())
    expect(logout).toHaveBeenCalled()
  })
})
