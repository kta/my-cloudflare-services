import { focusRing, focusRingOnPine } from '@app/ui'
import { useState } from 'react'
import { StartBar } from '../login/StartBar'

const modes = [
  {
    key: 'personal',
    glyph: '☺',
    title: '個人の端末として使う',
    note: 'スタッフが自分で持ち歩きます',
    rows: [
      ['記録される名前', '選んだスタッフご本人の名前'],
      ['お客様の情報', 'そのまま表示したまま'],
      ['暗証番号', 'スタッフ一人ひとりの4〜6桁'],
    ],
    button: '個人の端末にする',
  },
  {
    key: 'shared',
    glyph: '▤',
    title: 'みんなで使う端末として置く',
    note: 'レジ横・受付に据え置きます',
    rows: [
      ['記録される名前', '置き場所の名前（例：レジ横iPad）'],
      ['お客様の情報', '2分間さわらないと自動で隠す'],
      ['暗証番号', '店舗で共通の4〜6桁'],
    ],
    button: 'みんなで使う端末にする',
  },
] as const

export function DeviceMode({
  deviceLabel,
  onPersonal,
  onShared,
}: {
  deviceLabel: string
  onPersonal: () => void
  onShared: () => void
}) {
  const [helpOpen, setHelpOpen] = useState(false)

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <StartBar
        mode="端末のはじめの設定"
        action={{ label: 'ヘルプ', onPress: () => setHelpOpen(true) }}
        showWorkPrefix={false}
      />
      <main className="flex-1 overflow-auto px-11 py-9">
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className="mt-1.5 h-4 w-9 rounded-r-full bg-pine" />
          <div>
            <h1 className="text-title font-bold">この iPad の使い方を決めてください</h1>
            <p className="mt-1 text-body text-ink-muted">はじめの1回だけの設定です。</p>
          </div>
        </div>
        <div
          data-testid="device-mode-options"
          className="mt-7 grid grid-cols-1 gap-8 lg:grid-cols-2"
        >
          {modes.map((mode) => (
            <section
              key={mode.key}
              className="flex min-h-128 flex-col rounded-panel border border-line-strong bg-surface px-7.5 py-7"
            >
              <div className="flex items-center gap-5">
                <span
                  aria-hidden="true"
                  className={`grid size-15.5 place-items-center rounded-circle text-title text-on-pine ${
                    mode.key === 'personal' ? 'bg-pine' : 'bg-walkin'
                  }`}
                >
                  {mode.glyph}
                </span>
                <div>
                  <h2 className="text-hero font-bold">{mode.title}</h2>
                  <p className="mt-1 text-body text-ink-muted">{mode.note}</p>
                </div>
              </div>
              <dl className="mt-6">
                {mode.rows.map(([label, value]) => (
                  <div key={label} className="border-b border-line py-3.5 last:border-b-0">
                    <dt className="text-note font-semibold text-ink-muted">{label}</dt>
                    <dd className="mt-1 text-body">{value}</dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                onClick={mode.key === 'personal' ? onPersonal : onShared}
                className={`mt-auto min-h-12 w-full rounded-ctl bg-pine text-lead font-bold text-on-pine ${focusRing}`}
              >
                {mode.button}
              </button>
            </section>
          ))}
        </div>
        <p className="mt-6 text-note text-ink-muted">
          あとから「設定 › 端末」で変更できます。 端末の名前: {deviceLabel}
        </p>
      </main>
      {helpOpen && (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="device-mode-help-title"
          className="absolute inset-0 z-5 grid place-items-center bg-paper/90 p-5"
        >
          <div className="w-full max-w-140 rounded-panel border-3 border-pine bg-surface px-10 py-9 text-center">
            <h2 id="device-mode-help-title" className="text-title font-bold">
              端末の使い方について
            </h2>
            <p className="mt-3 text-body text-ink-muted">
              個人の端末はスタッフのお名前で、共有の端末は置き場所の名前で記録されます。
              あとから「設定 › 端末」で変更できます。
            </p>
            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              className={`mt-7 min-h-12 rounded-ctl bg-pine px-6 text-lead font-bold text-on-pine ${focusRingOnPine}`}
            >
              戻る
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
