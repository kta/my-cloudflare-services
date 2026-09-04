import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const elements = vi.fn()
const searches = vi.fn()
const runSearch = vi.fn()
const proposeEvidence = vi.fn()
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    api: {
      elements: () => elements(),
      searches: () => searches(),
      runSearch: (...a: unknown[]) => runSearch(...a),
      proposeEvidence: (...a: unknown[]) => proposeEvidence(...a),
    },
  }
})
const { SearchScreen } = await import('./SearchScreen')
const { ApiError } = await import('../api')

const RECORD = {
  id: 's1',
  organizationId: 'org',
  matterId: 'm1',
  elementId: null,
  query: { terms: ['瞳孔'] },
  matchExpression: '"瞳孔"',
  compiledSql: 'SELECT ...',
  mode: 'fts',
  hitCount: 2,
  undatedCount: 1,
  splitTerms: ['瞳孔、中心'],
  droppedTerms: ['、'],
  corpusBatchCount: 3,
  searchedChunks: null,
  vectorModel: null,
  vectorSemantic: null,
  executedAt: '2026-03-01T04:05:06.000Z',
}

const HIT = {
  pubNumber: '特開2018-134274',
  paraNo: '0032',
  section: 'desc',
  title: '視線検出装置',
  applicants: ['株式会社ニコン'],
  pubDate: '2018-08-30',
  snippet: '瞳孔の中心座標を算出する',
  text: '撮像部12により取得された眼部画像に対して、瞳孔の中心座標を算出する。',
  score: -1,
}

beforeEach(() => {
  vi.clearAllMocks()
  elements.mockResolvedValue([
    {
      id: 'el-b',
      organizationId: 'org',
      matterId: 'm1',
      claimNo: 1,
      elementKey: 'B',
      text: '前記画像から瞳孔中心を検出する',
      isEssential: true,
      sortOrder: 0,
      createdAt: '2026-03-01T00:00:00.000Z',
      evidenceCount: 0,
      verifiedCount: 0,
      confirmedCount: 0,
      disputedCount: 0,
      pendingCount: 0,
      rejectedCount: 0,
    },
  ])
  searches.mockResolvedValue([])
})

describe('先行技術検索', () => {
  it('検索語が空なら実行しない', async () => {
    render(<SearchScreen matterId="m1" onSignOut={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '検索する' }))
    expect(await screen.findByText('検索語を 1 つ以上入れてください。')).toBeInTheDocument()
    expect(runSearch).not.toHaveBeenCalled()
  })

  it('実行した検索式・ヒット件数・日付不明の件数を見せる', async () => {
    runSearch.mockResolvedValue({ record: RECORD, hits: [HIT] })
    render(<SearchScreen matterId="m1" onSignOut={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('検索語'), '瞳孔 中心')
    await userEvent.click(screen.getByRole('button', { name: '検索する' }))
    await waitFor(() => expect(screen.getByText('実行した検索式')).toBeInTheDocument())
    expect(screen.getByText('"瞳孔"')).toBeInTheDocument()
    expect(screen.getByText(/件（うち公開日不明/)).toBeInTheDocument()
  })

  it('分割した語・落とした語を黙って隠さない', async () => {
    runSearch.mockResolvedValue({ record: RECORD, hits: [HIT] })
    render(<SearchScreen matterId="m1" onSignOut={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('検索語'), '瞳孔')
    await userEvent.click(screen.getByRole('button', { name: '検索する' }))
    await waitFor(() => expect(screen.getByText('分割した語')).toBeInTheDocument())
    expect(screen.getByText('落とした語')).toBeInTheDocument()
  })

  it('コーパスに届かなければ「0 件」と言わず、届かなかったと言う', async () => {
    runSearch.mockRejectedValue(new ApiError(503, 'corpus_unavailable', 'corpus serve を起動する'))
    render(<SearchScreen matterId="m1" onSignOut={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('検索語'), '瞳孔')
    await userEvent.click(screen.getByRole('button', { name: '検索する' }))
    await waitFor(() =>
      expect(screen.getByText(/0 件ではなく「まだ見ていない」状態です/)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/ヒット 0 件/)).not.toBeInTheDocument()
  })

  it('0 件のときは「取り込まれている範囲での結果」と断る', async () => {
    runSearch.mockResolvedValue({ record: { ...RECORD, hitCount: 0 }, hits: [] })
    render(<SearchScreen matterId="m1" onSignOut={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('検索語'), '存在しない語')
    await userEvent.click(screen.getByRole('button', { name: '検索する' }))
    await waitFor(() =>
      expect(screen.getByText(/コーパスに取り込まれている範囲での結果です/)).toBeInTheDocument(),
    )
  })

  it('構成要件を選ばずに典拠を積もうとしたら止める', async () => {
    runSearch.mockResolvedValue({ record: RECORD, hits: [HIT] })
    render(<SearchScreen matterId="m1" onSignOut={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('検索語'), '瞳孔')
    await userEvent.click(screen.getByRole('button', { name: '検索する' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '典拠に積む' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '典拠に積む' }))
    expect(
      await screen.findByText('典拠として積むには、先に構成要件を選んでください。'),
    ).toBeInTheDocument()
    expect(proposeEvidence).not.toHaveBeenCalled()
  })

  it('積んだあと、照合が通ったかどうかを告げる', async () => {
    runSearch.mockResolvedValue({ record: RECORD, hits: [HIT] })
    proposeEvidence.mockResolvedValue({ quoteCheck: 'quote_mismatch' })
    render(<SearchScreen matterId="m1" onSignOut={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('構成要件')).toBeInTheDocument())
    await userEvent.selectOptions(screen.getByLabelText('構成要件'), 'el-b')
    await userEvent.type(screen.getByLabelText('検索語'), '瞳孔')
    await userEvent.click(screen.getByRole('button', { name: '検索する' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '典拠に積む' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '典拠に積む' }))
    await waitFor(() => expect(screen.getByText(/照合は通りませんでした/)).toBeInTheDocument())
  })
})
