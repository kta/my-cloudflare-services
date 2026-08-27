import type { ReactNode } from 'react'
import { Card, type Tone } from './surfaces'

/*
 * 読み込み中・失敗・保存できた、といった状態の告知。
 *
 * 承認済みモックはうまくいった面しか描いていないので、ここに対応する絵は無い。
 * だからといって新しい見た目を作らず、運用面がすでに持っている `Card` の調子
 * （error / warning / plain）だけで組む。緊急度は色ではなく role が運ぶ。
 */

/**
 * 失敗の告知。`role="alert"` を Card の外側に置くのは、Card は面の見た目だけを
 * 持ち、「今すぐ読ませる」かどうかは告知そのものの性質だから。
 */
export function FailureNotice({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="mt-3">
      <Card tone="error">{children}</Card>
    </div>
  )
}

/**
 * 結果・案内の告知。読み上げに割り込ませない（保存できたことを伝えるために
 * 操作の手を止めさせる理由が無い）。
 */
export function StatusNotice({ children, tone = 'plain' }: { children: ReactNode; tone?: Tone }) {
  return (
    <div role="status" className="mt-3">
      <Card tone={tone}>{children}</Card>
    </div>
  )
}
