import { PinInvalidError, PinLockedError, TerminalSession } from '@app/contracts'
import { focusRing, Keypad, PinField, TryMeter } from '@app/ui'
import { useEffect, useState } from 'react'
import { client } from '../client'
import { StartBar, StartBarButton } from './StartBar'

/*
 * LOGIN-STAFF-PIN / LOGIN-SHARED-PIN / LOGIN-PIN-ERROR。
 *
 * 画面の計画（DESIGN_RULE パス 1）
 *   主役は 1 画面に 1 つ ——「誰の番号か」。テンキーは右 420px に固定した道具。
 *   状態は色だけで伝えない —— 残り回数は目盛と文字の両方、待ち時間は秒数の文字。
 *   説明文は 2 つまで・各 1 行。空いた場所を埋めるために要素を足さない。
 *
 * **平文の暗証番号は state の外へ出さない。**画面にも `console` にも出さず、
 * 送るのは本文だけ。誤りの回数はサーバ（KV・30 秒）が数える。
 */

export type PinSubject =
  | { kind: 'personal'; staffId: string; name: string; note: string }
  | { kind: 'shared'; name: string; note: string }

const SHARED_GROUPS = [
  { label: '個人を選ばずにできる', words: ['予約を受ける', '台帳を見る', 'ご来店を受け付ける'] },
  { label: 'ご本人の確認が必要', words: ['録音の保全', '注意ごとの公開', '設定の変更'] },
] as const

export function PinEntry({
  storeName,
  terminalId,
  subject,
  onStarted,
  onBack,
  onQuit,
}: {
  storeName: string
  terminalId: string
  subject: PinSubject
  onStarted: (session: TerminalSession) => void
  onBack: () => void
  onQuit: () => void
}) {
  const personal = subject.kind === 'personal'
  const [value, setValue] = useState('')
  const [remaining, setRemaining] = useState<number | null>(null)
  const [lockSeconds, setLockSeconds] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (lockSeconds === null) return
    if (lockSeconds <= 0) {
      // 30 秒ちょうどはまだ入力できず、+1 秒で入力できる（07-nfr.md §10.3）。
      setLockSeconds(null)
      setFailed(false)
      return
    }
    const timer = setTimeout(
      () => setLockSeconds((left) => (left === null ? null : left - 1)),
      1000,
    )
    return () => clearTimeout(timer)
  }, [lockSeconds])

  async function submit() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const res = await client.api.staff.terminals[':terminalId'].sessions.$post({
        param: { terminalId },
        json:
          subject.kind === 'personal'
            ? { mode: 'personal', staffId: subject.staffId, pin: value }
            : { mode: 'shared', pin: value },
      })
      const status: number = res.status
      if (status === 201) {
        onStarted(TerminalSession.parse(await res.json()))
        return
      }
      setValue('')
      if (status === 401) {
        setFailed(true)
        setRemaining(PinInvalidError.parse(await res.json()).remainingAttempts)
        return
      }
      if (status === 429) {
        setFailed(true)
        setRemaining(0)
        setLockSeconds(PinLockedError.parse(await res.json()).retryAfterSeconds)
        return
      }
      setError('業務を始められませんでした。もう一度お試しください。')
    } catch {
      setValue('')
      setError('通信できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  const locked = lockSeconds !== null && lockSeconds > 0

  return (
    <div className="flex h-dvh flex-col bg-paper text-ink">
      <StartBar
        storeName={storeName}
        subline={personal ? '業務を始める　個人の端末' : '業務を始める　みんなで使う端末'}
        actions={<StartBarButton label="やめる" onPress={onQuit} />}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_420px]">
        <main className="min-h-0 overflow-auto px-11 py-10">
          {locked ? (
            <section className="rounded-panel border border-danger bg-danger-soft px-7 py-6">
              <h1 className="text-title font-bold text-danger">暗証番号を3回続けて間違えました</h1>
              <p role="status" className="mt-2 text-body">
                あと{lockSeconds}秒お待ちください。そのあと、もう一度お試しいただけます。
              </p>
              <TryMeter used={3} />
            </section>
          ) : failed ? (
            <section className="rounded-panel border border-danger bg-danger-soft px-7 py-6">
              <h1 className="text-title font-bold text-danger">
                暗証番号が違います。あと{remaining ?? 0}回お試しいただけます
              </h1>
              <p className="mt-2 text-body">3回続くと、30秒お待ちいただきます。</p>
              <TryMeter used={3 - (remaining ?? 0)} />
            </section>
          ) : (
            <>
              <h1 className="text-title font-bold">
                {personal
                  ? '4〜6桁の暗証番号を入力してください'
                  : '店舗の暗証番号を入力してください'}
              </h1>
              <p className="mt-1 text-body text-ink-muted">
                {personal
                  ? '番号は誰にも見えないよう ● で表示します。'
                  : '番号は店長からお聞きください。'}
              </p>
            </>
          )}

          <section
            aria-label="この暗証番号の持ち主"
            className={`mt-6 flex items-center gap-5 ${
              failed || locked
                ? 'py-2'
                : 'rounded-panel border border-pine-line bg-pine-soft px-6 py-5'
            }`}
          >
            <span
              aria-hidden="true"
              className={`grid size-14 shrink-0 place-items-center text-title font-bold text-on-pine ${
                personal ? 'rounded-circle bg-pine' : 'rounded-ctl bg-walkin'
              }`}
            >
              {personal ? subject.name.slice(0, 1) : '▤'}
            </span>
            <span>
              <span className="block text-lead font-bold">{subject.name}</span>
              <span className="mt-1 block text-grid text-ink-muted">{subject.note}</span>
            </span>
          </section>

          <div className="mt-6">
            <PinField
              label={personal ? '暗証番号' : '店舗の暗証番号'}
              filled={value.length}
              invalid={failed && value.length === 0}
            />
          </div>

          {!personal && (
            <dl className="mt-8.5 max-w-160">
              {SHARED_GROUPS.map((group, index) => (
                <div key={group.label} className={index === 0 ? '' : 'border-t border-line pt-4'}>
                  <dt className="text-grid text-ink-muted">{group.label}</dt>
                  <dd className="mt-1 pb-4">
                    <ul aria-label={group.label} className="flex flex-wrap gap-6 text-body">
                      {group.words.map((word) => (
                        <li key={word}>{word}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {error !== null && (
            <p role="status" className="mt-6 text-body text-danger">
              {error}
            </p>
          )}
          {notice !== null && (
            <p role="status" className="mt-6 text-body text-ink-muted">
              {notice}
            </p>
          )}

          <div className="mt-10 flex gap-4">
            {personal && failed && (
              <button
                type="button"
                onClick={() =>
                  setNotice('店長に、「設定 › スタッフ」から暗証番号を作り直してもらってください。')
                }
                className={`min-h-12 rounded-card bg-pine px-6 text-lead font-bold text-on-pine ${focusRing}`}
              >
                店長に暗証番号の再設定を頼む
              </button>
            )}
            <button
              type="button"
              onClick={onBack}
              className={`min-h-12 rounded-card border border-line-strong bg-surface px-6 text-lead font-semibold ${focusRing}`}
            >
              {personal ? '別のスタッフを選ぶ' : '別の置き場所を選ぶ'}
            </button>
          </div>
        </main>

        <aside className="grid content-center justify-center border-l border-line bg-surface px-6 py-10">
          <Keypad
            value={value}
            onChange={setValue}
            onSubmit={() => {
              void submit()
            }}
            {...(locked ? { blockedReason: `あと${lockSeconds}秒お待ちください` } : {})}
          />
        </aside>
      </div>
    </div>
  )
}
