import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const matters = vi.fn()
const createMatter = vi.fn()
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    api: { matters: () => matters(), createMatter: (...a: unknown[]) => createMatter(...a) },
  }
})
const { MattersScreen } = await import('./MattersScreen')
const { ApiError } = await import('../api')

function summary(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    organizationId: 'org',
    title: '視線追跡による眼鏡フィッティング支援',
    techField: '',
    status: 'searching',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-02T09:00:00.000Z',
    elementCount: 5,
    evidenceCount: 4,
    verifiedCount: 3,
    confirmedCount: 0,
    disputedCount: 0,
    rejectedCount: 1,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  matters.mockResolvedValue([summary()])
})

describe('案件一覧', () => {
  it('照合の内訳を見せる', async () => {
    render(<MattersScreen onOpen={vi.fn()} onSignOut={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('案件 1 件')).toBeInTheDocument())
    expect(screen.getByText('/ 全 4')).toBeInTheDocument()
  })

  it('棄却がある案件では、その事実を告げる', async () => {
    render(<MattersScreen onOpen={vi.fn()} onSignOut={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/棄却された典拠がある案件があります/)).toBeInTheDocument(),
    )
  })

  it('棄却が無ければ告げない', async () => {
    matters.mockResolvedValue([summary({ rejectedCount: 0 })])
    render(<MattersScreen onOpen={vi.fn()} onSignOut={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('案件 1 件')).toBeInTheDocument())
    expect(screen.queryByText(/棄却された典拠がある案件があります/)).not.toBeInTheDocument()
  })

  it('案件が無ければ、次にすることを告げる', async () => {
    matters.mockResolvedValue([])
    render(<MattersScreen onOpen={vi.fn()} onSignOut={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/最初の案件を作ってください/)).toBeInTheDocument())
  })

  it('名前が空なら作らずに理由を出す', async () => {
    render(<MattersScreen onOpen={vi.fn()} onSignOut={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '案件を作る' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '案件を作る' }))
    expect(await screen.findByText('案件の名前を入れてください。')).toBeInTheDocument()
    expect(createMatter).not.toHaveBeenCalled()
  })

  it('作ると、その案件を開く', async () => {
    createMatter.mockResolvedValue({ id: 'new-1' })
    const onOpen = vi.fn()
    render(<MattersScreen onOpen={onOpen} onSignOut={vi.fn()} />)
    await userEvent.type(screen.getByLabelText(/発明の名前/), '新しい発明')
    await userEvent.click(screen.getByRole('button', { name: '案件を作る' }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('new-1'))
  })

  it('保存に失敗しても入力は消えない', async () => {
    createMatter.mockRejectedValue(new ApiError(500, 'internal_error', null))
    render(<MattersScreen onOpen={vi.fn()} onSignOut={vi.fn()} />)
    const input = screen.getByLabelText(/発明の名前/)
    await userEvent.type(input, '消えないはず')
    await userEvent.click(screen.getByRole('button', { name: '案件を作る' }))
    await waitFor(() => expect(screen.getByText(/失敗しました/)).toBeInTheDocument())
    expect(input).toHaveValue('消えないはず')
  })

  it('401 ならサインアウトへ回す（永久に成功しない再試行をさせない）', async () => {
    matters.mockRejectedValue(new ApiError(401, 'unauthorized', null))
    const onSignOut = vi.fn()
    render(<MattersScreen onOpen={vi.fn()} onSignOut={onSignOut} />)
    await waitFor(() => expect(onSignOut).toHaveBeenCalled())
  })

  it('案件名を押すとその案件を開く', async () => {
    const onOpen = vi.fn()
    render(<MattersScreen onOpen={onOpen} onSignOut={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('視線追跡による眼鏡フィッティング支援')).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByText('視線追跡による眼鏡フィッティング支援'))
    expect(onOpen).toHaveBeenCalledWith('m1')
  })
})
