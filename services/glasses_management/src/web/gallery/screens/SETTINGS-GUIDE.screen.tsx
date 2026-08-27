import {
  StatusBar,
  TerminalBar,
  TerminalNav,
  TerminalScreen,
  TerminalWordmark,
} from '../../design/chrome'
import { TerminalFormPrimary } from '../../design/controls'
import { TerminalGuideLayout, TerminalGuideStep } from '../../design/layouts'
import { TerminalField, TerminalImpact, TerminalPreview } from '../../design/surfaces'

/*
 * SETTINGS-GUIDE — 承認済みモック `settings-approved.html` の `.screen`。
 *
 * 設定ガイドには承認済みの方言が 2 つある。`settings-complete-approved.html`
 * は 76px バー・本文 16px、こちらは iOS ステータスバー 25px + バー 67px・
 * 本文 10〜11px で、緑も #286b55 と僅かに明るい。どちらも却下されていないので
 * 両方を持つ（`SETTINGS-STORE-HOURS` 等が前者、この面が後者）。
 *
 *   .guided{height:calc(100% - 92px);grid-template-columns:255px 1fr}
 *   .form{padding:24px 34px}.form h2{margin:0;font-size:23px}
 *   .muted{font-size:10px;color:var(--m)}
 *   .formgrid{grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}
 *   .field{…;min-height:76px}.preview{…}.impact{…}
 *   .primary{float:right;margin-top:14px}
 *
 * 6 工程のうち 1 つだけを開き、その工程で決めることだけを画面に出す。
 * 影響の確認を最終工程へ回す（この面では予告だけする）のは、1 つ直すたびに
 * 既存予約との突き合わせを走らせると、設定を触ること自体が重くなるため。
 */

/** 工程レール。済んだ工程は `✓`、今の工程だけが状態語を持つ。 */
const STEPS = [
  { badge: '✓', label: '店舗と営業時間', note: '設定済み' },
  { badge: '2', label: '来店目的', note: '編集中', state: 'current' as const },
  { badge: '3', label: 'スタッフと技能' },
  { badge: '4', label: '設備と点検' },
  { badge: '5', label: 'Web予約公開' },
  { badge: '6', label: '影響を確認して公開' },
]

export default function SettingsGuide() {
  return (
    <TerminalScreen>
      <StatusBar time="9:41" />
      <TerminalBar>
        <TerminalWordmark subtitle="銀座店　⌄" />
        <TerminalNav on>設定ガイド</TerminalNav>
        <TerminalNav>設定一覧</TerminalNav>
        <TerminalNav>変更履歴</TerminalNav>
      </TerminalBar>
      <TerminalGuideLayout
        steps={STEPS.map((step) => (
          <TerminalGuideStep
            key={step.label}
            badge={step.badge}
            label={step.label}
            note={step.note}
            state={step.state}
          />
        ))}
      >
        {/* モックの `<h2>` を 1 段繰り上げる。寸法と余白は実測のまま持つ。 */}
        <h1 className="text-terminal-title" style={{ margin: 0 }}>
          視力測定・新調相談を設定
        </h1>
        <p className="text-terminal-ink-muted text-terminal-note">
          お客様がメガネを新しく作るときの予約条件です。
        </p>
        <div className="mt-4.5 grid grid-cols-2 gap-3">
          <TerminalField title="お客様への表示名">メガネを新しく作りたい</TerminalField>
          <TerminalField title="標準所要時間">60分</TerminalField>
          <TerminalField title="必要なスタッフ技能">眼鏡作製技能士</TerminalField>
          <TerminalField title="必要な設備">視力測定機 1台</TerminalField>
        </div>
        <TerminalPreview>
          {/* モックの `<h4>` は本文と同じ 16px。1 段繰り上げても寸法は変えない。 */}
          <h2 className="text-body" style={{ margin: '0 0 8px' }}>
            Web予約での見え方
          </h2>
          <b className="font-bold">メガネを新しく作りたい</b>
          <br />
          <span className="text-terminal-ink-muted text-terminal-note">
            {'視力測定とフレーム・レンズ相談　約60分'}
          </span>
        </TerminalPreview>
        <TerminalImpact>
          <b className="font-bold">公開前に影響を確認します</b>
          <br />
          既存予約の競合、Web公開枠、技能・設備不足を最終工程で確認します。
        </TerminalImpact>
        <TerminalFormPrimary>次の来店目的へ</TerminalFormPrimary>
      </TerminalGuideLayout>
    </TerminalScreen>
  )
}
