/**
 * はじめの設定の残り（`014-store-provisioning`）。
 *
 * AdminLTE の `small-box` の型を借りるが、**ダッシュボードにはしない**。
 * ここでやることは多くて 2 つ（店員・端末）しかないのに、揃ったものまで数え上げて
 * 4 枚並べると、毎日見る面の一等地を数字の飾りに取られ、主操作が下へ押し出される。
 *
 * だから **足りないものだけを出す**。揃ったものは黙って消え、全部揃えば行ごと消える。
 */
import { SmallBox } from './parts'

export type SetupCounts = {
  stores: number
  staff: number
  terminals: number
  purposes: number
}

/** まだ手が要るもの。0 件なら案内は出さない。 */
export function missingSetup(counts: SetupCounts): Array<'staff' | 'terminals'> {
  const missing: Array<'staff' | 'terminals'> = []
  if (counts.staff === 0) missing.push('staff')
  if (counts.terminals === 0) missing.push('terminals')
  return missing
}

const LABEL = { staff: '店員', terminals: '端末' } as const
const ACTION = { staff: '店員を登録する', terminals: '端末を登録する' } as const

export function SetupProgress({
  counts,
  onOpenSettings,
  onOpenTerminals,
}: {
  /** 数がまだ分からない間は `null`。**分からない数を 0 と言わない。** */
  counts: SetupCounts | null
  onOpenSettings: () => void
  onOpenTerminals: () => void
}) {
  if (counts === null) return null
  const missing = missingSetup(counts)
  if (missing.length === 0) return null

  return (
    <section aria-label="はじめの設定" className="grid max-w-lg gap-2">
      <div>
        <h2 className="text-grid font-bold text-ink">はじめの設定</h2>
        <p className="text-note text-ink-muted">
          あと{missing.length}つです。揃うとこの案内は消えます。
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {missing.map((key) => (
          <SmallBox
            key={key}
            value={0}
            label={LABEL[key]}
            tone="walkin"
            action={{
              label: ACTION[key],
              onPress: key === 'staff' ? onOpenSettings : onOpenTerminals,
            }}
          />
        ))}
      </div>
    </section>
  )
}
