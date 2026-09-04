import type { EvidenceGraph, GraphNode } from '@app/contracts'
import { useMemo } from 'react'
import { api } from '../api'
import { Empty, Mono, Panel, Seal, sealOf } from '../ui/parts'
import { Frame } from './Frame'
import { useAsync } from './useAsync'

/*
 * 引用の関係を見る図。
 *
 * 左に構成要件、右に公報を置き、典拠を線で結ぶ。**線の見え方が照合状態を表す**:
 *   実線（藍）= 照合済み。支持している
 *   破線（琥珀）= 未照合。まだ何も言えない
 *   点線（朱）= 棄却。原文と食い違った
 * 力学配置にしないのは、この関係が二部グラフ（要件 × 公報）で、
 * 左右に並べたほうが「どの要件が塞がれているか」が一目で分かるからである。
 */

const ROW = 64
const PAD = 28
const COL_ELEMENT = 20
const COL_PUB = 700
const NODE_W = 340
/** 和文は 12.5px でだいたい 1 文字 12.5px。枠からはみ出さない字数で切る。 */
const LABEL_CHARS = 24

function clip(label: string): string {
  const chars = Array.from(label)
  return chars.length <= LABEL_CHARS ? label : `${chars.slice(0, LABEL_CHARS - 1).join('')}…`
}

export function GraphScreen({ matterId, onSignOut }: { matterId: string; onSignOut: () => void }) {
  const state = useAsync<EvidenceGraph>(() => api.graph(matterId), [matterId], onSignOut)
  return <Frame state={state}>{(graph) => <Diagram graph={graph} />}</Frame>
}

function Diagram({ graph }: { graph: EvidenceGraph }) {
  const elements = useMemo(() => graph.nodes.filter((n) => n.kind === 'element'), [graph])
  const publications = useMemo(() => graph.nodes.filter((n) => n.kind === 'publication'), [graph])

  if (elements.length === 0) {
    return <Empty>まだ構成要件がありません。「構成要件」の画面で請求項を分解してください。</Empty>
  }
  if (publications.length === 0) {
    return (
      <Empty>
        まだ典拠がありません。「先行技術検索」で公報を探し、クレームチャートに積んでください。
      </Empty>
    )
  }

  const y = (list: GraphNode[], id: string) => PAD + list.findIndex((n) => n.id === id) * ROW + 18
  const height = PAD * 2 + Math.max(elements.length, publications.length) * ROW
  const width = COL_PUB + NODE_W + PAD

  return (
    <Panel
      title="構成要件と公報の関係"
      aside={
        <span className="flex items-center gap-3 text-tk-note text-tk-ink-muted">
          <span className="flex items-center gap-1">
            <Seal kind="verified" size="sm" /> 実線＝支持
          </span>
          <span className="flex items-center gap-1">
            <Seal kind="pending" size="sm" /> 破線＝未照合
          </span>
          <span className="flex items-center gap-1">
            <Seal kind="rejected" size="sm" /> 点線＝棄却
          </span>
        </span>
      }
    >
      <div className="overflow-x-auto">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="構成要件と公報の関係図"
          className="min-w-[66rem]"
        >
          <title>構成要件と公報の関係図</title>
          {graph.edges.map((e) => {
            const kind = sealOf(e.quoteCheck)
            const stroke =
              kind === 'verified'
                ? 'var(--color-tk-verified)'
                : kind === 'pending'
                  ? 'var(--color-tk-pending)'
                  : 'var(--color-tk-rejected)'
            const dash = kind === 'verified' ? undefined : kind === 'pending' ? '6 4' : '2 3'
            const y1 = y(elements, e.from)
            const y2 = y(publications, e.to)
            const midX = (COL_ELEMENT + NODE_W + COL_PUB) / 2
            return (
              <path
                key={`${e.from}->${e.to}-${e.relation}`}
                d={`M ${COL_ELEMENT + NODE_W} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${COL_PUB} ${y2}`}
                fill="none"
                stroke={stroke}
                strokeWidth={kind === 'verified' ? 1.6 : 1.1}
                strokeDasharray={dash}
              />
            )
          })}

          {elements.map((n, i) => (
            <g key={n.id}>
              <rect
                x={COL_ELEMENT}
                y={PAD + i * ROW}
                width={NODE_W}
                height={36}
                fill="var(--color-tk-sheet)"
                stroke={n.weight === 0 ? 'var(--color-tk-ink)' : 'var(--color-tk-line-strong)'}
                strokeWidth={n.weight === 0 ? 2 : 1}
              />
              <text
                x={COL_ELEMENT + 10}
                y={PAD + i * ROW + 22}
                fontSize="12.5"
                fill="var(--color-tk-ink)"
              >
                {clip(n.label)}
              </text>
            </g>
          ))}

          {publications.map((n, i) => (
            <g key={n.id}>
              <rect
                x={COL_PUB}
                y={PAD + i * ROW}
                width={NODE_W}
                height={36}
                fill="var(--color-tk-sheet)"
                stroke="var(--color-tk-line-strong)"
                // 支持している要件が多い公報ほど太い＝手強い先行技術
                strokeWidth={1 + Math.min(n.weight, 4)}
              />
              <text
                x={COL_PUB + 10}
                y={PAD + i * ROW + 22}
                fontSize="12.5"
                fontFamily="var(--font-tk-mono)"
                fill="var(--color-tk-ink)"
              >
                {n.label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-6 border-tk-line border-t pt-3 text-tk-data md:grid-cols-2">
        <div>
          <p className="font-bold text-tk-ink">まだ塞がれていない構成要件</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {elements
              .filter((n) => n.weight === 0)
              .map((n) => (
                <li key={n.id} className="text-tk-ink">
                  {n.label}
                </li>
              ))}
            {elements.every((n) => n.weight > 0) && (
              <li className="text-tk-ink-muted">ありません（すべてに典拠が付いています）</li>
            )}
          </ul>
        </div>
        <div>
          <p className="font-bold text-tk-ink">手強い先行技術（支持している要件の数）</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {[...publications]
              .sort((a, b) => b.weight - a.weight)
              .slice(0, 5)
              .map((n) => (
                <li key={n.id} className="flex items-baseline gap-2">
                  <Mono className="text-tk-verified">{n.label}</Mono>
                  <Mono className="text-tk-ink-muted">{n.weight} 要件</Mono>
                </li>
              ))}
          </ul>
        </div>
      </div>
    </Panel>
  )
}
