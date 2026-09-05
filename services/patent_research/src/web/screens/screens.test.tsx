import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 残りの画面。それぞれ「この画面が守っている約束」を 1〜数本ずつ固定する。
 * 網羅より、壊れたら静かに間違う場所を選んでいる。
 */

const m = {
  disclosure: vi.fn(),
  saveDisclosure: vi.fn(),
  messages: vi.fn(),
  postMessage: vi.fn(),
  elements: vi.fn(),
  saveElements: vi.fn(),
  assessments: vi.fn(),
  saveAssessment: vi.fn(),
  evidence: vi.fn(),
  graph: vi.fn(),
  drafts: vi.fn(),
  saveDraft: vi.fn(),
  checks: vi.fn(),
  jobs: vi.fn(),
  corpusStatus: vi.fn(),
}
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, api: m }
})

const { IntakeScreen } = await import('./IntakeScreen')
const { ElementsScreen } = await import('./ElementsScreen')
const { AssessmentScreen } = await import('./AssessmentScreen')
const { GraphScreen } = await import('./GraphScreen')
const { DraftScreen } = await import('./DraftScreen')
const { JobsScreen } = await import('./JobsScreen')
const { CorpusScreen } = await import('./CorpusScreen')
const { ApiError } = await import('../api')

const noop = () => undefined

beforeEach(() => {
  vi.clearAllMocks()
  m.disclosure.mockResolvedValue(null)
  m.messages.mockResolvedValue([])
  m.elements.mockResolvedValue([])
  m.assessments.mockResolvedValue([])
  m.evidence.mockResolvedValue([])
  m.graph.mockResolvedValue({ nodes: [], edges: [] })
  m.drafts.mockResolvedValue([])
  m.checks.mockResolvedValue([])
  m.jobs.mockResolvedValue([])
  m.corpusStatus.mockResolvedValue({
    reachable: true,
    detail: null,
    publications: 1200,
    withFulltext: 900,
    paragraphs: 74000,
    chunks: 0,
    batches: 1,
    extractFailures: 0,
    byIpcSubclass: { G06F: 800, G02C: 400 },
  })
})

describe('発明を書く', () => {
  it('外部 LLM への送信は既定で切れている', async () => {
    render(<IntakeScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() => expect(screen.getByLabelText(/外部の LLM/)).toBeInTheDocument())
    expect(screen.getByLabelText(/外部の LLM/)).not.toBeChecked()
    expect(screen.getByText(/依頼者の秘密を扱う場合は開けないでください/)).toBeInTheDocument()
  })

  it('保存すると版が積まれたことを告げる', async () => {
    m.saveDisclosure.mockResolvedValue({ revision: 2 })
    render(<IntakeScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '発明を保存する' })).toBeEnabled(),
    )
    await userEvent.type(screen.getByLabelText('解決しようとする課題'), '課題')
    await userEvent.click(screen.getByRole('button', { name: '発明を保存する' }))
    await waitFor(() => expect(screen.getByText(/第 2 版として保存しました/)).toBeInTheDocument())
  })

  it('対話を書き足せる', async () => {
    m.postMessage.mockResolvedValue({})
    render(<IntakeScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() => expect(screen.getByLabelText('書き足す')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('書き足す'), 'こんな特許が欲しい')
    await userEvent.click(screen.getByRole('button', { name: '記録する' }))
    await waitFor(() =>
      expect(m.postMessage).toHaveBeenCalledWith('m1', {
        role: 'user',
        content: 'こんな特許が欲しい',
        provider: 'human',
      }),
    )
  })
})

describe('構成要件', () => {
  it('請求項の文を機械的に割り、人の目で直すよう促す', async () => {
    render(<ElementsScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() => expect(screen.getByLabelText('請求項 1 の文')).toBeInTheDocument())
    await userEvent.type(
      screen.getByLabelText('請求項 1 の文'),
      '撮像部が眼部を撮像し、瞳孔中心を検出し、視線を算出する',
    )
    await userEvent.click(screen.getByRole('button', { name: '構成要件に割る' }))
    await waitFor(() => expect(screen.getByText(/個の下書きに割りました/)).toBeInTheDocument())
    expect(screen.getByLabelText('構成要件 A')).toHaveValue('撮像部が眼部を撮像し')
  })

  it('割る文が空なら止める', async () => {
    render(<ElementsScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '構成要件に割る' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: '構成要件に割る' }))
    expect(await screen.findByText('請求項の文を入れてください。')).toBeInTheDocument()
  })

  it('1 つも書かずに保存しようとしたら止める', async () => {
    render(<ElementsScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '構成要件を保存する' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: '構成要件を保存する' }))
    expect(await screen.findByText('構成要件を 1 つ以上書いてください。')).toBeInTheDocument()
    expect(m.saveElements).not.toHaveBeenCalled()
  })

  it('足して保存できる', async () => {
    m.saveElements.mockResolvedValue([])
    render(<ElementsScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '1 つ足す' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '1 つ足す' }))
    await userEvent.type(screen.getByLabelText('構成要件 A'), '撮像部が眼部を撮像する')
    await userEvent.click(screen.getByRole('button', { name: '構成要件を保存する' }))
    await waitFor(() => expect(m.saveElements).toHaveBeenCalled())
  })
})

describe('特許性の判断', () => {
  it('新規性では副引用と動機付けの欄を出さない（単一文献主義）', async () => {
    render(<AssessmentScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() => expect(screen.getByLabelText('どちらの要件か')).toBeInTheDocument())
    expect(screen.queryByLabelText('副引用発明')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('組合せの動機付け')).not.toBeInTheDocument()
  })

  it('進歩性にすると動機付けと阻害要因の欄が出る', async () => {
    render(<AssessmentScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() => expect(screen.getByLabelText('どちらの要件か')).toBeInTheDocument())
    await userEvent.selectOptions(screen.getByLabelText('どちらの要件か'), 'inventive_step')
    expect(screen.getByLabelText('組合せの動機付け')).toBeInTheDocument()
    expect(screen.getByLabelText('阻害要因')).toBeInTheDocument()
    expect(
      screen.getByText(/ここを空のまま結論を出すと、審査官と同じ土俵に立てません/),
    ).toBeInTheDocument()
  })

  it('契約に弾かれたら、審査基準の型で理由を言う', async () => {
    m.saveAssessment.mockRejectedValue(new ApiError(400, 'request_failed', null))
    render(<AssessmentScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '判断を記録する' })).toBeEnabled(),
    )
    await userEvent.click(screen.getByRole('button', { name: '判断を記録する' }))
    await waitFor(() =>
      expect(screen.getByText(/新規性では副引用と動機付けを使いません/)).toBeInTheDocument(),
    )
  })

  it('開示が見つかっていない要件を「勝ち筋」として並べる', async () => {
    m.elements.mockResolvedValue([
      {
        id: 'el-d',
        organizationId: 'o',
        matterId: 'm1',
        claimNo: 1,
        elementKey: 'D',
        text: '加入度を決定する',
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
    render(<AssessmentScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() =>
      expect(screen.getByText('まだ開示が見つかっていない要件')).toBeInTheDocument(),
    )
    expect(screen.getByText(/「まだ探していない」「まだ人が確認していない」/)).toBeInTheDocument()
  })
})

describe('引用の関係', () => {
  it('構成要件が無ければ、次にすることを告げる', async () => {
    render(<GraphScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() =>
      expect(screen.getByText(/「構成要件」の画面で請求項を分解してください/)).toBeInTheDocument(),
    )
  })

  it('典拠が無ければ、探すよう促す', async () => {
    m.graph.mockResolvedValue({
      nodes: [{ id: 'element:a', kind: 'element', label: 'A 撮像', weight: 0 }],
      edges: [],
    })
    render(<GraphScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() =>
      expect(screen.getByText(/クレームチャートに積んでください/)).toBeInTheDocument(),
    )
  })

  it('要件と公報を結び、塞がれていない要件を挙げる', async () => {
    m.graph.mockResolvedValue({
      nodes: [
        { id: 'element:a', kind: 'element', label: 'A 撮像部', weight: 1 },
        { id: 'element:d', kind: 'element', label: 'D 加入度', weight: 0 },
        {
          id: 'publication:特開2018-134274',
          kind: 'publication',
          label: '特開2018-134274',
          weight: 1,
        },
      ],
      edges: [
        {
          from: 'element:a',
          to: 'publication:特開2018-134274',
          relation: 'discloses',
          quoteCheck: 'verified',
        },
      ],
    })
    render(<GraphScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() => expect(screen.getByText('まだ塞がれていない構成要件')).toBeInTheDocument())
    expect(screen.getByRole('img', { name: '構成要件と公報の関係図' })).toBeInTheDocument()
    expect(screen.getByText('手強い先行技術（支持している要件の数）')).toBeInTheDocument()
  })
})

describe('明細書ドラフト', () => {
  it('節を施行規則の見出しで並べる', async () => {
    render(<DraftScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() => expect(screen.getByText(/【技術分野】/)).toBeInTheDocument())
    expect(screen.getByText(/【課題を解決するための手段】/)).toBeInTheDocument()
    expect(screen.getByText(/【産業上の利用可能性】/)).toBeInTheDocument()
  })

  it('要約が 400 字を超えたら、その場で告げる', async () => {
    m.drafts.mockResolvedValue([
      {
        id: 'd1',
        organizationId: 'o',
        matterId: 'm1',
        revision: 1,
        section: 'abstract',
        markdown: 'あ'.repeat(401),
        createdAt: '2026-03-01T00:00:00.000Z',
      },
    ])
    render(<DraftScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() => expect(screen.getAllByText(/【要約】/).length).toBeGreaterThan(0))
    await userEvent.click(screen.getAllByText(/【要約】/)[0] as HTMLElement)
    await waitFor(() =>
      expect(screen.getByText(/電子出願ではエラーになります/)).toBeInTheDocument(),
    )
  })

  it('保存できる', async () => {
    m.saveDraft.mockResolvedValue({})
    render(<DraftScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'この節を保存する' })).toBeEnabled(),
    )
    await userEvent.type(screen.getByLabelText('技術分野の本文'), '本発明は…')
    await userEvent.click(screen.getByRole('button', { name: 'この節を保存する' }))
    await waitFor(() =>
      expect(m.saveDraft).toHaveBeenCalledWith('m1', 'technical_field', '本発明は…'),
    )
  })

  it('検査の結果を適・否・未で見せる', async () => {
    m.checks.mockResolvedValue([
      {
        id: 'c1',
        organizationId: 'o',
        matterId: 'm1',
        checkKey: 'multi_multi',
        result: 'fail',
        detail: '請求項 5 が該当する',
        checkedAt: '2026-03-01T00:00:00.000Z',
      },
    ])
    render(<DraftScreen matterId="m1" onSignOut={noop} />)
    await waitFor(() =>
      expect(screen.getByText(/マルチマルチクレーム（施行規則24条の3第5号）/)).toBeInTheDocument(),
    )
    expect(screen.getByText('否')).toBeInTheDocument()
  })
})

describe('ジョブ', () => {
  it('スキルの起こし方を見せる（画面が勝手に走らせない）', async () => {
    render(<JobsScreen onOpen={noop} onSignOut={noop} />)
    await waitFor(() => expect(screen.getByText('スキルの起こし方')).toBeInTheDocument())
    expect(
      screen.getByText(/画面が勝手に走らせないのは、未出願の発明が動くからです/),
    ).toBeInTheDocument()
  })

  it('積まれた仕事を並べる', async () => {
    m.jobs.mockResolvedValue([
      {
        id: 'j1',
        organizationId: 'o',
        matterId: 'm1',
        kind: 'search',
        status: 'queued',
        instruction: '構成要件Bの先行技術を探す',
        runner: null,
        error: null,
        resultRef: null,
        requestedAt: '2026-03-01T00:00:00.000Z',
        startedAt: null,
        finishedAt: null,
      },
    ])
    render(<JobsScreen onOpen={noop} onSignOut={noop} />)
    await waitFor(() => expect(screen.getByText('仕事 1 件')).toBeInTheDocument())
    expect(screen.getByText('構成要件Bの先行技術を探す')).toBeInTheDocument()
    expect(screen.getByText('待ち')).toBeInTheDocument()
  })
})

describe('コーパスの状態', () => {
  it('見ている範囲を件数で見せる', async () => {
    render(<CorpusScreen onSignOut={noop} onFatal={noop} />)
    await waitFor(() => expect(screen.getByText('1,200')).toBeInTheDocument())
    expect(screen.getByText(/ここに無い公報は照合できない/)).toBeInTheDocument()
    expect(screen.getByText('IPC サブクラス別の件数')).toBeInTheDocument()
  })

  it('届かないときは 0 件と言わず、起こし方を示す', async () => {
    m.corpusStatus.mockResolvedValue({
      reachable: false,
      detail: 'ECONNREFUSED',
      publications: 0,
      withFulltext: 0,
      paragraphs: 0,
      chunks: 0,
      batches: 0,
      extractFailures: 0,
      byIpcSubclass: {},
    })
    const onFatal = vi.fn()
    render(<CorpusScreen onSignOut={noop} onFatal={onFatal} />)
    await waitFor(() =>
      expect(screen.getByText(/コーパスサイドカーに届きませんでした/)).toBeInTheDocument(),
    )
    expect(
      screen.getByText((_, el) => el?.textContent?.includes('node src/cli.ts serve') ?? false, {
        selector: 'span',
      }),
    ).toBeTruthy()
    await waitFor(() =>
      expect(onFatal).toHaveBeenCalledWith(expect.stringContaining('まだ見ていない')),
    )
  })

  it('取り込みに失敗した公報があれば、握りつぶさず告げる', async () => {
    m.corpusStatus.mockResolvedValue({
      reachable: true,
      detail: null,
      publications: 10,
      withFulltext: 8,
      paragraphs: 100,
      chunks: 0,
      batches: 1,
      extractFailures: 2,
      byIpcSubclass: {},
    })
    render(<CorpusScreen onSignOut={noop} onFatal={noop} />)
    await waitFor(() =>
      expect(screen.getByText(/取り込みに失敗した公報が 2 件あります/)).toBeInTheDocument(),
    )
  })
})
