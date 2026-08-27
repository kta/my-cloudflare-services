/**
 * 運用・管理画面が共有する「モックに無い状態」の語彙。
 *
 * 骨格と面の語彙（`AdminLayout` / `Card` / `AdminRow` / `StatePill` / `Matrix`）は
 * `design/` へ移した。ここに残るのは権限なし・該当なし・競合の 3 つで、どれも
 * 承認済みモック `exception-states-approved.html` に絵があるが、業務のクロムを
 * 持たずに面の中へ差し込まれる点だけが違う。だから `design/` の部品で組み直し、
 * 新しい見た目は足していない。
 *
 * 色・角丸・余白はすべて `packages/ui/src/theme.css` のトークン経由。
 */

import type { ReactNode } from 'react'
import { Action } from './design/controls'
import { Card } from './design/surfaces'

/**
 * `#permission-denied`。設定の存在も内容もこれ以上見せない。
 *
 * `FullScreenState` は業務のクロムごと差し替える面の語彙なので使わない。ここは
 * バーもタブも生きたまま、本文だけがこの状態になる。
 */
export function PermissionDenied({ onReturnHome }: { onReturnHome: () => void }) {
  return (
    <section
      aria-label="権限がありません"
      className="mx-auto w-full max-w-225 px-8.5 pt-22.5 pb-8.5 text-center font-sans"
    >
      {/* モックの 54px の記号。読み上げには何も足さない。 */}
      <strong aria-hidden="true" className="font-bold text-glyph text-pine">
        —
      </strong>
      <h1>この設定を表示する権限がありません</h1>
      <p>権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。</p>
      <div className="mt-5 flex justify-center">
        <Action size="roomy" variant="primary" onClick={onReturnHome}>
          業務開始画面へ戻る
        </Action>
      </div>
    </section>
  )
}

/** `#empty`。消えたのではなく、条件に合わなかっただけだと言い切る。 */
export function EmptyResult({
  title,
  description = '検索語またはフィルターを変更してください。履歴自体は削除されていません。',
  onClearFilters,
}: {
  title: string
  description?: string
  onClearFilters: () => void
}) {
  return (
    <section
      aria-label="該当なし"
      className="mx-auto w-full max-w-225 px-8.5 pt-9 pb-8.5 text-center font-sans"
    >
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="mt-5 flex justify-center">
        <Action size="roomy" onClick={onClearFilters}>
          フィルターをすべて解除
        </Action>
      </div>
    </section>
  )
}

/** `#conflict`。最新と手元を並べ、破棄か再適用のどちらかを必ず選ばせる。 */
export function ConflictCompare({
  title,
  latestLabel = '最新の内容',
  mineLabel = 'この端末の入力',
  latest,
  mine,
  onDiscard,
  onReapply,
}: {
  title: string
  latestLabel?: string
  mineLabel?: string
  latest: ReactNode
  mine: ReactNode
  onDiscard: () => void
  onReapply: () => void
}) {
  return (
    <div className="mt-4.5 font-sans">
      <h3>{title}</h3>
      {/* `.compare{grid-template-columns:1fr 1fr;gap:14px}` */}
      <div className="mt-3 grid grid-cols-2 gap-3.5">
        <Card label={latestLabel}>
          <b>{latestLabel}</b>
          {latest}
        </Card>
        {/* 手元の入力だけ琥珀。失敗ではなく「まだ確かめていない」ことを言う。 */}
        <Card tone="warning" label={mineLabel}>
          <b>{mineLabel}</b>
          {mine}
        </Card>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        {/* 破棄は取り返しがつかない。既定の見た目にしない。 */}
        <Action size="roomy" variant="danger" onClick={onDiscard}>
          この入力を破棄
        </Action>
        <Action size="roomy" variant="primary" onClick={onReapply}>
          最新内容へ再適用
        </Action>
      </div>
    </div>
  )
}
