import { GuideStep } from '../../design/layouts'

/*
 * 設定ガイドの 6 工程は 6 画面すべてで同じ並び・同じ名前で出る。
 * 画面ごとに書き写すと、1 つだけ表記が揺れても誰も気付けないのでここに 1 つ持つ。
 *
 * モック `settings-complete-approved.html` の実測:
 *   .steps{background:#e4ebe7;padding:18px}
 *   .step{min-height:58px;padding:10px;border-left:3px solid var(--l)}
 *   .step.done{border-color:var(--g)}
 *   .step.on{background:#fff;border-color:var(--g);color:var(--g);font-weight:700}
 *
 * 済んだ工程は `✓`、これからの工程は番号だけ。「完了」「編集中」のような
 * 状態語はモックに無い（レールが短くなるほど読み飛ばされるため）。
 */
const LABELS = [
  '店舗と営業時間',
  '来店目的',
  'スタッフと技能',
  '設備と点検',
  'Web予約',
  '影響確認と公開',
]

/** いま何工程目か（1 起算）を渡すと、レール 6 行ぶんを返す。 */
export function settingsSteps(current: number) {
  return LABELS.map((label, offset) => {
    const index = offset + 1
    return (
      <GuideStep
        key={label}
        index={index}
        label={label}
        state={index < current ? 'done' : index === current ? 'current' : 'todo'}
      />
    )
  })
}
