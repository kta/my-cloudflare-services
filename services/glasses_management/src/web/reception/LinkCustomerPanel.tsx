import type { CustomerCandidate, LocalDate, Walkin } from '@app/contracts'
import { auth } from '@app/shared'
import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { useEffect, useRef, useState } from 'react'
import { normalizePhone, searchMode, visitLabel } from '../../worker/domain/customers'
import { formatPhoneDigits } from '../booking/CustomerStep'
import { client } from '../client'

/*
 * 受け付けたあとのウォークインを、お客様へ結びつける面（AC-RECEP-08 / AC-RECEP-09）。
 *
 * この製品の芯は「お名前を伺わないうちから受け付けられること」なので、受付パネル
 * （`WalkinPanel`）はお客様を探す口を 1 つしか持たない。**結び直しはここでやる** ——
 * 来店受付ボードのその行から開き、今までのお客様を電話番号で探すか、その場で
 * 新しいお客様を登録して結びつける。
 *
 * 承認済みモックにこの面の絵は無い（`docs/frontend/mockups/eyex` は受付までを描く）。
 * 姿は `WalkinPanel` に揃えた —— 盤面を隠しきらない右 400px・見出し帯・足元の主操作の
 * 3 段で、覚え直しを作らない。白い箱は足さず、罫線だけで節を分ける。
 */

export type LinkCustomerPanelProps = {
  storeId: string
  /** 盤面の日（JST の暦日）。ウォークインの版を引くのに使う。 */
  date: LocalDate
  /** 結びつける先のウォークイン（`VisitBoardRow.subjectId` は `walk_ins.id`）。 */
  walkinId: string
  /** 「ウォークイン 003」。どの行を触っているかを面の中で言い直す。 */
  displayName: string
  /** 結びついた。器が盤面を読み直す。 */
  onLinked: () => void
  onClose: () => void
}

type Phase = 'loading' | 'ready' | 'sending' | 'missing'

/** 打たれた文字から照会の条件を作る（`WalkinPanel` と同じ読み分け）。 */
function lookupParam(typed: string): { key: 'phoneLast4' | 'phone'; value: string } | null {
  const mode = searchMode(typed)
  if (mode.kind === 'phoneLast4') return { key: 'phoneLast4', value: mode.value }
  const normalized = normalizePhone(typed)
  return normalized === null ? null : { key: 'phone', value: normalized }
}

export function LinkCustomerPanel({
  storeId,
  date,
  walkinId,
  displayName,
  onLinked,
  onClose,
}: LinkCustomerPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  const [version, setVersion] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [typedPhone, setTypedPhone] = useState('')
  const [candidates, setCandidates] = useState<readonly CustomerCandidate[]>([])
  const [name, setName] = useState('')
  const [kana, setKana] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  // 面が差し替わったら見出しへ焦点を移し、Esc で閉じる（`WalkinPanel` と同じ鍵）。
  useEffect(() => {
    const previous = document.activeElement
    headingRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  /*
   * 版を引く。`PATCH /api/staff/walkins/:walkinId` は `version` を必ず要る形なので、
   * **端末が控えていた版ではなく、いまの版**をここで読む（2 台の iPad が同じ行を
   * 触っていたときに、古い版で上書きしない）。
   */
  useEffect(() => {
    let live = true
    async function read() {
      const res = await client.api.staff.walkins.$get({ query: { storeId, date } })
      if (!live) return
      if (!res.ok) {
        setPhase('missing')
        return
      }
      const rows: Walkin[] = await res.json()
      if (!live) return
      const found = rows.find((row) => row.id === walkinId) ?? null
      if (found === null) {
        setPhase('missing')
        return
      }
      setVersion(found.version)
      setPhase('ready')
    }
    read().catch(() => {
      if (live) setPhase('missing')
    })
    return () => {
      live = false
    }
  }, [storeId, date, walkinId])

  // 番号を打ち終えた瞬間に候補を出す。**入力欄からフォーカスを奪わない。**
  useEffect(() => {
    const param = lookupParam(typedPhone)
    if (param === null) {
      setCandidates([])
      return
    }
    let live = true
    async function ask(query: { key: string; value: string }) {
      const res = await client.api.staff.customers.lookup.$get(undefined, {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          auth.authFetch(`${String(input)}?${query.key}=${encodeURIComponent(query.value)}`, init),
      })
      if (!live || !res.ok) return
      const hits: CustomerCandidate[] = await res.json()
      if (live) setCandidates(hits)
    }
    ask(param).catch(() => {
      if (live) setCandidates([])
    })
    return () => {
      live = false
    }
  }, [typedPhone])

  /** 結びつけの 1 手。**版は読み直した値のまま**送り、断られたら文で言う。 */
  async function patchCustomer(customerId: string): Promise<boolean> {
    if (version === null) return false
    const res = await client.api.staff.walkins[':walkinId'].$patch({
      param: { walkinId },
      json: { version, customerId },
    })
    if (res.ok) {
      onLinked()
      return true
    }
    setFailure(
      res.status === 409
        ? 'ほかの端末がこのご来店を触りました。開き直してからもう一度お試しください。'
        : '結びつけられませんでした。もう一度お試しください。',
    )
    return false
  }

  async function link(customerId: string) {
    if (phase !== 'ready') return
    setPhase('sending')
    setFailure(null)
    if (!(await patchCustomer(customerId))) setPhase('ready')
  }

  /** 新しいお客様を 1 件作って、そのままこのご来店へ結びつける。 */
  async function createAndLink() {
    if (phase !== 'ready' || name.trim() === '') return
    setPhase('sending')
    setFailure(null)
    const created = await client.api.staff.customers.$post({
      json: {
        name: name.trim(),
        ...(kana.trim() === '' ? {} : { kana: kana.trim() }),
        ...(normalizePhone(typedPhone) === null ? {} : { phone: typedPhone.trim() }),
      },
    })
    if (!created.ok) {
      setPhase('ready')
      setFailure('お客様を登録できませんでした。もう一度お試しください。')
      return
    }
    const customer = (await created.json()) as { id: string }
    if (!(await patchCustomer(customer.id))) setPhase('ready')
  }

  const busy = phase === 'sending' || phase === 'loading'

  return (
    <aside
      aria-label="お客様を結びつける"
      className="absolute top-0 right-0 bottom-0 z-20 flex w-100 flex-col border-line-strong border-l bg-surface"
    >
      <div className="flex flex-none items-center gap-2.5 border-line border-b px-5.5 py-3">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className={cn('m-0 flex-1 text-bar font-semibold text-ink', focusRing)}
        >
          お客様を結びつけます
        </h2>
        <button
          type="button"
          onClick={onClose}
          className={cn('min-h-11 rounded-ctl px-2.5 text-body font-semibold text-pine', focusRing)}
        >
          やめる
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5.5 pt-5.5 pb-5.5">
        <p className="text-grid text-ink-muted">{`${displayName} のご来店です。`}</p>

        {phase === 'loading' && (
          <p role="status" className="mt-2.5 text-body text-ink-muted">
            読み込んでいます…
          </p>
        )}

        {phase === 'missing' && (
          <p role="alert" className="mt-2.5 text-body text-ink-muted">
            このご来店が見つかりませんでした。盤面を読み直してください。
          </p>
        )}

        {phase !== 'loading' && phase !== 'missing' && (
          <>
            <div className="mt-6">
              <span className="mb-2.5 block text-grid font-semibold text-ink-muted">
                今までのお客様から探す
              </span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={typedPhone}
                aria-label="電話番号で探す（下4桁でも探せます）"
                placeholder="電話番号で探す（下4桁でも探せます）"
                onChange={(event) => setTypedPhone(event.target.value)}
                className={cn(
                  'min-h-13 w-full rounded-card border border-line-strong bg-surface px-3.5 text-body text-ink',
                  'placeholder:text-ink-faint',
                  focusRing,
                )}
              />
              {candidates.length > 0 && (
                <fieldset aria-label="同じ番号のお客様" className="mt-2.5 flex flex-col gap-2">
                  {candidates.map((hit) => (
                    <button
                      key={hit.customer.id}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        link(hit.customer.id).catch(() =>
                          setFailure('結びつけられませんでした。もう一度お試しください。'),
                        )
                      }}
                      className={cn(
                        'flex min-h-11 items-center gap-2.5 rounded-card border border-line-strong bg-surface px-3 text-left text-ink',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                        focusRing,
                      )}
                    >
                      <span className="text-body font-semibold">{`${hit.customer.name} 様`}</span>
                      <span className="text-note text-ink-muted">
                        {visitLabel(hit.customer.visitCount, 'list')}
                      </span>
                      {hit.customer.phone !== null && (
                        <span className="ml-auto font-mono text-note text-ink-muted">
                          {formatPhoneDigits(hit.customer.phone)}
                        </span>
                      )}
                    </button>
                  ))}
                </fieldset>
              )}
            </div>

            <div className="mt-6 border-line border-t pt-5.5">
              <span className="mb-2.5 block text-grid font-semibold text-ink-muted">
                新しいお客様を登録して結びつける
              </span>
              <input
                type="text"
                autoComplete="off"
                value={name}
                aria-label="お名前"
                placeholder="お名前"
                onChange={(event) => setName(event.target.value)}
                className={cn(
                  'min-h-13 w-full rounded-card border border-line-strong bg-surface px-3.5 text-body text-ink',
                  'placeholder:text-ink-faint',
                  focusRing,
                )}
              />
              <input
                type="text"
                autoComplete="off"
                value={kana}
                aria-label="ふりがな"
                placeholder="ふりがな"
                onChange={(event) => setKana(event.target.value)}
                className={cn(
                  'mt-2.5 min-h-13 w-full rounded-card border border-line-strong bg-surface px-3.5 text-body text-ink',
                  'placeholder:text-ink-faint',
                  focusRing,
                )}
              />
            </div>
          </>
        )}
      </div>

      <div className="flex-none px-5.5 py-5">
        {failure !== null && (
          <p role="alert" className="mb-2.5 text-grid text-danger">
            {failure}
          </p>
        )}
        <button
          type="button"
          disabled={busy || name.trim() === ''}
          onClick={() => {
            createAndLink().catch(() =>
              setFailure('お客様を登録できませんでした。もう一度お試しください。'),
            )
          }}
          className={cn(
            'min-h-14 w-full rounded-card bg-pine text-lead font-semibold text-on-pine',
            'disabled:cursor-not-allowed disabled:opacity-50',
            focusRingOnPine,
          )}
        >
          登録して結びつける
        </button>
      </div>
    </aside>
  )
}
