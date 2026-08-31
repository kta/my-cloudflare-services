import { focusRing } from '@app/ui'
import { useState } from 'react'
import { StartBar, StartBarButton } from '../login/StartBar'
import type { TerminalMode } from '../terminal/terminalState'

/*
 * START-DEVICE-MODE。まだ誰の端末でもない iPad に名前を与える 1 面。
 *
 * 画面の計画（DESIGN_RULE パス 1）
 *   主役は 1 画面に 1 つ ——「この iPad の使い方」。白い箱は 2 枚だけ。
 *   説明文は 2 つまで・各 1 行 ——「はじめの1回だけの設定です。」と脚注。
 *   空いた場所を埋めるために要素を足さない —— 下半分は空けたままにする。
 */

const ROWS = [
  {
    label: '記録される名前',
    personal: '選んだスタッフご本人の名前',
    shared: '置き場所の名前（例：レジ横iPad）',
  },
  {
    label: 'お客様の情報',
    personal: 'そのまま表示したまま',
    shared: '2分間さわらないと自動で隠す',
  },
  { label: '暗証番号', personal: 'スタッフ一人ひとりの4〜6桁', shared: '店舗で共通の4〜6桁' },
] as const

export function DeviceMode({
  storeName,
  deviceLabel,
  onChoose,
}: {
  storeName: string
  /** 端末そのものの名前（例: EYEX-iPad-07）。脚注にだけ出る。 */
  deviceLabel: string
  onChoose: (mode: TerminalMode) => void
}) {
  const [helpOpen, setHelpOpen] = useState(false)
  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <StartBar
        storeName={storeName}
        subline="端末のはじめの設定"
        actions={<StartBarButton label="ヘルプ" onPress={() => setHelpOpen(true)} />}
      />
      <main className="relative min-h-0 flex-1 overflow-auto px-11 py-9">
        <h1 className="text-title font-bold">この iPad の使い方を決めてください</h1>
        <p className="mt-1 text-body text-ink-muted">はじめの1回だけの設定です。</p>

        <div className="mt-7 grid grid-cols-2 gap-8">
          <Card
            mode="personal"
            title="個人の端末として使う"
            note="スタッフが自分で持ち歩きます"
            action="個人の端末にする"
            onChoose={onChoose}
          />
          <Card
            mode="shared"
            title="みんなで使う端末として置く"
            note="レジ横・受付に据え置きます"
            action="みんなで使う端末にする"
            onChoose={onChoose}
          />
        </div>

        <p className="mt-6.5 text-grid text-ink-muted">
          あとから「設定 › 端末」で変更できます。　端末の名前：{deviceLabel}
        </p>

        {helpOpen && (
          /* ヘルプはこの面に重ねる 1 枚のシート。別の画面を起こさない（戻る先が増えない）。 */
          <div className="absolute inset-0 grid place-items-center bg-paper/90 p-11">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="ヘルプ　端末の使い方"
              className="w-140 rounded-panel border-3 border-pine bg-surface p-9"
            >
              <h2 className="text-title font-bold">どちらを選べばよいですか</h2>
              <p className="mt-2.5 text-body leading-relaxed text-ink-muted">
                ご自分だけが使う iPad なら「個人の端末」、レジ横や受付に置いて何人もが さわる iPad
                なら「みんなで使う端末」を選んでください。
              </p>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className={`mt-7.5 min-h-14 w-full rounded-card bg-pine text-lead font-bold text-on-pine ${focusRing}`}
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function Card({
  mode,
  title,
  note,
  action,
  onChoose,
}: {
  mode: TerminalMode
  title: string
  note: string
  action: string
  onChoose: (mode: TerminalMode) => void
}) {
  return (
    <section
      aria-label={title}
      className="rounded-panel border border-line-strong bg-surface px-7.5 py-7"
    >
      <div className="flex items-center gap-5">
        <span
          aria-hidden="true"
          className={`grid size-15.5 shrink-0 place-items-center rounded-circle text-title text-on-pine ${
            mode === 'personal' ? 'bg-pine' : 'bg-walkin'
          }`}
        >
          {mode === 'personal' ? '☺' : '▤'}
        </span>
        <div>
          <h2 className="text-title font-bold">{title}</h2>
          <p className="mt-1 text-body text-ink-muted">{note}</p>
        </div>
      </div>
      <dl className="mt-6">
        {ROWS.map((row, index) => (
          <div
            key={row.label}
            className={index === ROWS.length - 1 ? 'py-3.5' : 'border-b border-line py-3.5'}
          >
            <dt className="text-grid font-semibold text-ink-muted">{row.label}</dt>
            <dd className="mt-1 text-body leading-normal">{row[mode]}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={() => onChoose(mode)}
        className={`mt-6.5 min-h-12 w-full rounded-card bg-pine text-lead font-bold text-on-pine ${focusRing}`}
      >
        {action}
      </button>
    </section>
  )
}
