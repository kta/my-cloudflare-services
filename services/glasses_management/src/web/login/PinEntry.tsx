import { Keypad, PinField, TryMeter } from '@app/ui'
import { useState } from 'react'
import { StartBar } from './StartBar'

export function PinEntry({
  kind,
  title,
  detail,
  remainingAttempts,
  retryAfterSeconds,
  onSubmit,
  onBack,
}: {
  kind: 'personal' | 'shared'
  title: string
  detail: string
  remainingAttempts?: number
  retryAfterSeconds?: number
  onSubmit: (pin: string) => void
  onBack: () => void
}) {
  const [pin, setPin] = useState('')
  const invalid = remainingAttempts !== undefined
  const locked = retryAfterSeconds !== undefined && retryAfterSeconds > 0 && remainingAttempts === 0
  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <StartBar
        mode={kind === 'personal' ? '個人の端末' : 'みんなで使う端末'}
        action={{ label: 'やめる', onPress: onBack }}
      />
      <main className="flex min-h-0 flex-1">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col px-11 py-10">
          {invalid && (
            <div className="mb-6 rounded-panel border border-danger bg-danger-soft px-7 py-6">
              <h1 className="text-title font-bold text-danger">
                {locked
                  ? `${retryAfterSeconds}秒お待ちください`
                  : `暗証番号が違います。あと${remainingAttempts}回お試しいただけます`}
              </h1>
              <p className="mt-2 text-body">3回続くと、30秒お待ちいただきます。</p>
              <div className="mt-3.5">
                <TryMeter remainingAttempts={remainingAttempts} />
              </div>
            </div>
          )}
          {!invalid && <h1 className="text-title font-bold">4〜6桁の暗証番号を入力してください</h1>}
          <p className="mt-1 text-body text-ink-muted">番号は誰にも見えないよう ● で表示します。</p>
          <div className="mt-5 flex items-center gap-5 rounded-panel border border-pine-line bg-pine-soft px-5 py-4">
            <span
              className={`grid size-14 place-items-center text-lead font-bold text-on-pine ${
                kind === 'personal' ? 'rounded-circle bg-pine' : 'rounded-ctl bg-walkin'
              }`}
            >
              {kind === 'personal' ? title.slice(0, 1) : '▤'}
            </span>
            <div>
              <h2 className="text-lead font-bold">{title}</h2>
              <p className="mt-1 text-note text-ink-muted">{detail}</p>
            </div>
          </div>
          <div className="mt-7">
            <PinField
              value={pin}
              onChange={setPin}
              onConfirm={() => !locked && onSubmit(pin)}
              invalid={invalid}
            />
          </div>
          {invalid && (
            <p className="mt-5 text-body font-semibold text-pine">店長に暗証番号の再設定を頼む</p>
          )}
          {kind === 'shared' && (
            <div className="mt-8 border-t border-line pt-5 text-body">
              <p className="text-note font-semibold text-ink-muted">個人を選ばずにできる</p>
              <p className="mt-1">予約を受ける　台帳を見る　ご来店を受け付ける</p>
              <p className="mt-5 border-t border-line pt-5 text-note font-semibold text-ink-muted">
                ご本人の確認が必要
              </p>
              <p className="mt-1">録音の保全　注意ごとの公開　設定の変更</p>
            </div>
          )}
          <button
            type="button"
            onClick={onBack}
            className="mt-auto min-h-12 self-start rounded-ctl border border-line-strong bg-surface px-5 font-semibold"
          >
            {kind === 'personal' ? '別のスタッフを選ぶ' : '別の置き場所を選ぶ'}
          </button>
        </section>
        <aside className="grid w-105 shrink-0 content-center justify-center border-l border-line bg-surface px-6 py-10">
          <Keypad
            value={pin}
            onChange={setPin}
            onConfirm={() => {
              if (!locked) onSubmit(pin)
            }}
          />
        </aside>
      </main>
    </div>
  )
}
