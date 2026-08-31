import type { PublicStoreSummary } from '@app/contracts'
import { cn } from '@app/ui'
import { PublicNotice, StickyAction } from './PublicBookingApp'

/*
 * 工程 1「店舗を選ぶ」（承認済みモック docs/frontend/mockups/eyex/images/WEB-01-STORE.png）。
 *
 * 実測（screens/WEB-01-STORE.html の <style>）:
 *   並び 間 12px・上 28px、1 件は最小高 76px・padding 16px・角 12px・縁 1px --line-strong
 *   選択中は縁 3px --brand + 地 --brand-tint + padding 14px（外形を保つ）
 *   店名 16px/700（gap 8px）／道順 13px --ink-2（上 4px）
 *   「選択中」の札は最小高 22px・padding 1px 8px・角 8px・地 --brand-tint
 *
 * **モックの偽物の role を持ち込まない**。選択は `<button aria-pressed>` ではなく
 * `<fieldset>` + `<input type="radio">` にする（`07-nfr.md` §2.3）。
 * 補足は「近い順に」を落とした「3店舗を表示しています。」— 位置情報を使わず、
 * 並びは `stores.sort_order` である（TODO 0.2 の #1）。
 */

export type StoreStepProps = {
  stores: readonly PublicStoreSummary[]
  /** `/w/:storeSlug` で開いたときは、その店舗を選んだ状態で始める。 */
  selectedSlug: string | null
  onSelect: (store: PublicStoreSummary) => void
  onNext: () => void
}

/** 主操作に入れる呼び名。「EYEX 銀座店」→「銀座店」（屋号を二度読ませない）。 */
function shortStoreName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] ?? name
}

/** 焦点は隠した radio に当たるので、輪は札のほうへ出す。 */
const cardFocus = 'focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus'

export function StoreStep({ stores, selectedSlug, onSelect, onNext }: StoreStepProps) {
  const picked = stores.find((store) => store.slug === selectedSlug) ?? null

  if (stores.length === 0) {
    return (
      <PublicNotice
        heading="いまはWebでご予約を承れません"
        reason="ご予約を受け付けている店舗がありません。"
        action={
          <p className="text-grid text-ink-muted">
            お電話でご予約を承ります。お近くの店舗までお問い合わせください。
          </p>
        }
      />
    )
  }

  return (
    <>
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-1.5 h-3.75 w-4.5 shrink-0 rounded-ctl rounded-bl-none bg-pine"
        />
        <div>
          <h2 className="text-bar font-semibold text-ink">ご希望の店舗をお選びください</h2>
          <p className="mt-0.5 text-grid text-ink-muted">{stores.length}店舗を表示しています。</p>
        </div>
      </div>

      <fieldset className="mt-7 grid gap-3">
        <legend className="sr-only">ご希望の店舗</legend>
        {stores.map((store) => {
          const on = store.slug === selectedSlug
          return (
            <label
              key={store.slug}
              className={cn(
                'block min-h-19 rounded-card',
                on
                  ? 'border-3 border-pine bg-pine-soft p-3.5'
                  : 'border border-line-strong bg-surface p-4',
                cardFocus,
              )}
            >
              <input
                type="radio"
                name="public-store"
                value={store.slug}
                checked={on}
                onChange={() => onSelect(store)}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-body font-bold text-ink">
                {store.name}
                {on && (
                  <span className="min-h-5.5 rounded-ctl border border-pine-line bg-pine-soft px-2 text-note font-semibold text-pine-deep">
                    選択中
                  </span>
                )}
              </span>
              <span className="mt-1 block text-grid text-ink-muted">{store.accessNote}</span>
            </label>
          )
        })}
      </fieldset>

      <StickyAction
        label={picked === null ? '予約を進める' : `${shortStoreName(picked.name)}で予約を進める`}
        ready={picked !== null}
        reason="店舗をお選びになると進めます。"
        onPress={onNext}
      />
    </>
  )
}
