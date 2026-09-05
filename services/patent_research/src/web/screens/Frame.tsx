import type { ReactNode } from 'react'
import { Empty, Notice } from '../ui/parts'
import type { AsyncState } from './useAsync'

/*
 * 読み込み中・失敗・空を、**同じ見え方にしない**ための枠。
 * この製品では「0 件」と「まだ見ていない」と「届かなかった」の取り違えが、
 * そのまま調査の結論の誤りになる。
 */

const MESSAGES: Record<string, string> = {
  corpus_unavailable:
    'コーパスに届きませんでした。0 件ではなく「まだ見ていない」状態です。別のターミナルで `corpus serve` を起動してから、もう一度実行してください。',
  matter_not_found: 'この案件は見つかりませんでした。案件一覧から選び直してください。',
  element_not_found: 'この構成要件は見つかりませんでした。構成要件の画面で作り直してください。',
  external_llm_not_allowed:
    'この案件は、未出願の発明を外部の LLM へ送ることを許可していません。発明開示の画面で明示的に許可してください。',
  quote_not_verified:
    '照合を通っていない典拠は承認できません。引用を直して照合を通すか、棄却のまま残してください。',
  network_error: '通信に失敗しました。読み込み直してください。',
}

export function Frame<T>({
  state,
  empty,
  children,
}: {
  state: AsyncState<T>
  empty?: ReactNode
  children: (data: T) => ReactNode
}) {
  if (state.error) {
    return (
      <Notice tone={state.error.code === 'corpus_unavailable' ? 'pending' : 'rejected'}>
        {MESSAGES[state.error.code] ?? `読み込みに失敗しました（${state.error.code}）。`}
        {state.error.detail && (
          <span className="mt-1 block font-tk-mono text-tk-fine opacity-80">
            {state.error.detail}
          </span>
        )}
      </Notice>
    )
  }
  // 初回だけ読み込み中を出す。再読み込み中は前の中身を残す（画面が点滅しない）。
  if (state.loading && state.data === null) {
    return <p className="py-8 text-center text-tk-body text-tk-ink-muted">読み込んでいます…</p>
  }
  // `null` を「空」と決めつけない。発明開示のように「まだ書かれていない」を null で返す
  // API があり、その画面は null を受け取って空のフォームを出したい。
  // 空の見せ方を出すのは、呼び出し側が `empty` を渡したときだけにする。
  if (empty !== undefined) {
    const isEmpty = state.data === null || (Array.isArray(state.data) && state.data.length === 0)
    if (isEmpty) return <Empty>{empty}</Empty>
  }
  return <>{children(state.data as T)}</>
}

export function errorMessage(code: string, detail?: string | null): string {
  const base = MESSAGES[code] ?? `失敗しました（${code}）。`
  return detail ? `${base} ${detail}` : base
}
