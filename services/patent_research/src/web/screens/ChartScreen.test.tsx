import type { ClaimElementSummary, Evidence } from '@app/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * クレームチャートは製品の心臓なので、画面でも次の 3 つを固定する。
 *   1. 棄却された典拠が、台帳（支持の根拠）に混ざらない
 *   2. 棄却された典拠は消えず、AI の主張と実際の原文の対比として残る
 *   3. 照合を通っていない典拠は、人間が「開示を認める」ことができない
 */

const recheckEvidence = vi.fn()
const reviewEvidence = vi.fn()
const elements = vi.fn()
const evidence = vi.fn()

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    api: {
      elements: (...args: unknown[]) => elements(...args),
      evidence: (...args: unknown[]) => evidence(...args),
      recheckEvidence: (...args: unknown[]) => recheckEvidence(...args),
      reviewEvidence: (...args: unknown[]) => reviewEvidence(...args),
    },
  }
})

const { ChartScreen } = await import('./ChartScreen')

const ELEMENTS: ClaimElementSummary[] = [
  {
    id: 'el-a',
    organizationId: 'org',
    matterId: 'm1',
    claimNo: 1,
    elementKey: 'A',
    text: '撮像部が利用者の眼部を撮像する',
    isEssential: true,
    sortOrder: 0,
    createdAt: '2026-03-01T00:00:00.000Z',
    evidenceCount: 3,
    verifiedCount: 1,
    confirmedCount: 0,
    disputedCount: 0,
    pendingCount: 1,
    rejectedCount: 1,
  },
  {
    id: 'el-d',
    organizationId: 'org',
    matterId: 'm1',
    claimNo: 1,
    elementKey: 'D',
    text: '視線ベクトルに基づき加入度を決定する',
    isEssential: true,
    sortOrder: 1,
    createdAt: '2026-03-01T00:00:00.000Z',
    evidenceCount: 0,
    verifiedCount: 0,
    confirmedCount: 0,
    disputedCount: 0,
    pendingCount: 0,
    rejectedCount: 0,
  },
]

function ev(over: Partial<Evidence>): Evidence {
  return {
    id: 'ev-1',
    organizationId: 'org',
    matterId: 'm1',
    elementId: 'el-a',
    pubNumber: '特開2018-134274',
    paraNo: '0032',
    quotedText: '瞳孔の中心座標を算出する',
    relation: 'discloses',
    note: '',
    producedBy: 'skill',
    quoteCheck: 'verified',
    quoteCheckDetail: null,
    review: 'unreviewed',
    reviewerNote: '',
    reviewedAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    title: '視線検出装置',
    applicants: ['株式会社ニコン'],
    pubDate: '2018-08-30',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  elements.mockResolvedValue(ELEMENTS)
  evidence.mockResolvedValue([
    ev({ id: 'ok' }),
    ev({
      id: 'pending',
      paraNo: '0033',
      quoteCheck: 'pending',
      quoteCheckDetail: 'コーパスに届かない',
    }),
    ev({
      id: 'bad',
      paraNo: '0040',
      quotedText: 'レンズ研磨工程における加工を行う',
      quoteCheck: 'quote_mismatch',
      quoteCheckDetail: '実際の段落の冒頭: 撮像部12により取得された眼部画像に…',
    }),
  ])
})

describe('クレームチャート', () => {
  it('照合を通った典拠と未照合の典拠は台帳に載る', async () => {
    render(<ChartScreen matterId="m1" onSignOut={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('【A】撮像部が利用者の眼部を撮像する')).toBeInTheDocument(),
    )
    // 同じ引用文が照合済みと未照合で 2 行に出る（台帳に両方載る）
    expect(screen.getAllByText('瞳孔の中心座標を算出する')).toHaveLength(2)
    expect(screen.getAllByText('【0033】').length).toBeGreaterThan(0)
  })

  it('棄却された典拠は台帳に載らず、棄却欄に降ろされる', async () => {
    render(<ChartScreen matterId="m1" onSignOut={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('棄却された典拠')).toBeInTheDocument())
    // 棄却欄には AI の主張と、照合の結果が並ぶ
    expect(screen.getByText('AI が引用したとする文')).toBeInTheDocument()
    expect(screen.getByText('レンズ研磨工程における加工を行う')).toBeInTheDocument()
    expect(screen.getByText(/実際の段落の冒頭/)).toBeInTheDocument()
  })

  it('棄却された典拠は「支持の根拠にはならない」と明示される', async () => {
    render(<ChartScreen matterId="m1" onSignOut={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/支持の根拠にはならないが、記録として残す/)).toBeInTheDocument(),
    )
  })

  it('照合を通っていない典拠は人間が承認できない', async () => {
    render(<ChartScreen matterId="m1" onSignOut={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('【A】撮像部が利用者の眼部を撮像する')).toBeInTheDocument(),
    )
    expect(screen.getAllByText('照合を通るまで確認できません').length).toBe(1)
    // 承認できるのは照合済みの 1 件だけ
    expect(screen.getAllByRole('button', { name: '開示を認める' })).toHaveLength(1)
  })

  it('照合済みの典拠は承認できる', async () => {
    reviewEvidence.mockResolvedValue(ev({ review: 'confirmed' }))
    render(<ChartScreen matterId="m1" onSignOut={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('【A】撮像部が利用者の眼部を撮像する')).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: '開示を認める' }))
    await waitFor(() => expect(reviewEvidence).toHaveBeenCalledWith('ok', { review: 'confirmed' }))
  })

  it('典拠が 0 件の要件は「新規性の勝ち筋」として索引に立つ', async () => {
    render(<ChartScreen matterId="m1" onSignOut={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('典拠 0 件 — 新規性の勝ち筋')).toBeInTheDocument())
  })

  it('典拠を持てない主張には「典拠なし — 表示しない」が付く', async () => {
    render(<ChartScreen matterId="m1" onSignOut={vi.fn()} />)
    // 人が開示を認めた典拠が 1 件も無い状態なので、所見はどれも札を持てない。
    // 「不存在の主張」は原文で示せないので、常にここに含まれる。
    await waitFor(() =>
      expect(screen.getAllByText('典拠なし — 表示しない').length).toBeGreaterThan(0),
    )
  })

  it('人が開示を認めた典拠だけが、所見の裏付けとして札になる', async () => {
    evidence.mockResolvedValue([ev({ id: 'ok', review: 'confirmed' })])
    render(<ChartScreen matterId="m1" onSignOut={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/機械照合を通り、人が開示を認めたもの/)).toBeInTheDocument(),
    )
    expect(screen.getAllByText('特開2018-134274').length).toBeGreaterThan(1)
  })

  it('再照合を押すと、状態が変わった件数を告げる', async () => {
    recheckEvidence.mockResolvedValue({ rechecked: 2 })
    render(<ChartScreen matterId="m1" onSignOut={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '再照合する' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '再照合する' }))
    await waitFor(() =>
      expect(screen.getByText('再照合しました。2 件の状態が変わりました。')).toBeInTheDocument(),
    )
  })

  it('構成要件を選び直すと、その要件の典拠に切り替わる', async () => {
    render(<ChartScreen matterId="m1" onSignOut={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('【A】撮像部が利用者の眼部を撮像する')).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByText('視線ベクトルに基づき加入度を決定する'))
    await waitFor(() =>
      expect(
        screen.getByText(/この構成要件を開示する公報は、まだ 1 件も見つかっていません/),
      ).toBeInTheDocument(),
    )
    // 「まだ探していないだけかもしれない」と言い添える（0 件を結論にしない）
    expect(screen.getByText(/まだ探していないだけかもしれません/)).toBeInTheDocument()
  })

  it('構成要件がまだ無ければ、次にすることを告げる', async () => {
    elements.mockResolvedValue([])
    render(<ChartScreen matterId="m1" onSignOut={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/「構成要件」の画面で請求項を分解してください/)).toBeInTheDocument(),
    )
  })
})
