import type { PublicStorePurpose } from '@app/contracts'
import { cn } from '@app/ui'
import { PublicNotice, StickyAction } from './PublicBookingApp'

/*
 * 工程 2「ご用件を選ぶ」（承認済みモック docs/frontend/mockups/eye/images/WEB-02-PURPOSE.png）。
 *
 * 実測（screens/WEB-02-PURPOSE.html の <style>）:
 *   並び 間 10px・上 28px、1 件は最小高 60px・padding 0 16px・角 12px・16px/600
 *   選択中は縁 3px + 地 --brand-tint + padding 0 14px
 *   分数は右寄せ 13px/600 --ink-2、その下に「選択中」を --brand-dark で改行
 *
 * 出るのは `visit_purposes.name_public` だけである。店内名（`name_internal`）・技能・設備は
 * 契約の形（`PublicStorePurpose`）からして届かない。モックの 6 件・独自表記は写し間違いで、
 * 正本は `05-screen-flow.md` §3.11 の 6 行表（公開 5 件）である（TODO 0.2 の #2 / #3）。
 */

export type PurposeStepProps = {
  purposes: readonly PublicStorePurpose[]
  selectedId: string | null
  /** ご用件が 1 件も出ていないときのご案内に使う。 */
  storePhone: string
  onSelect: (purpose: PublicStorePurpose) => void
  onNext: () => void
}

const cardFocus = 'focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus'

export function PurposeStep({
  purposes,
  selectedId,
  storePhone,
  onSelect,
  onNext,
}: PurposeStepProps) {
  if (purposes.length === 0) {
    return (
      <PublicNotice
        heading="いまはWebでご予約を承れません"
        reason="この店舗のご用件が 1 件も出ていません。"
        action={
          <p className="text-grid text-ink-muted">
            {storePhone === ''
              ? 'お電話でご予約を承ります。'
              : `お電話（${storePhone}）でご予約を承ります。`}
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
          <h2 className="text-bar font-semibold text-ink">ご用件をお選びください</h2>
          <p className="mt-0.5 text-grid text-ink-muted">お時間は目安です。</p>
        </div>
      </div>

      <fieldset className="mt-7 grid gap-2.5">
        <legend className="sr-only">ご用件</legend>
        {purposes.map((purpose) => {
          const on = purpose.id === selectedId
          return (
            <label
              key={purpose.id}
              className={cn(
                'flex min-h-15 items-center gap-3 rounded-card',
                on
                  ? 'border-3 border-pine bg-pine-soft px-3.5'
                  : 'border border-line-strong bg-surface px-4',
                cardFocus,
              )}
            >
              <input
                type="radio"
                name="public-purpose"
                value={purpose.id}
                checked={on}
                onChange={() => onSelect(purpose)}
                className="sr-only"
              />
              <span className="text-body font-semibold text-ink">{purpose.name}</span>
              <span className="ml-auto text-right text-grid font-semibold text-ink-muted">
                約{purpose.durationMinutes}分
                {on && <span className="block text-pine-deep">選択中</span>}
              </span>
            </label>
          )
        })}
      </fieldset>

      <StickyAction
        label="日時を選ぶ"
        ready={selectedId !== null}
        reason="ご用件をお選びになると進めます。"
        onPress={onNext}
      />
    </>
  )
}
