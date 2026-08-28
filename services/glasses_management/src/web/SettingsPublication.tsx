import {
  SettingsConflictResolution,
  type SettingsConflictResolutionKind,
  SettingsDraft,
  SettingsImpactReport,
  type SettingsImpactSeverity,
  SettingsOverrideRelease,
  SettingsOverrideView,
  SettingsPublication as SettingsPublicationContract,
  SettingsVersionDetail,
  SettingsVersionSummary,
  Store,
  type StorePermission,
} from '@app/contracts'
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react'
import { Action, Actions } from './design/controls'
import { Modal } from './design/dialogs'
import { PickerField, TextAreaField, TextField } from './design/forms'
import { FailureNotice, StatusNotice } from './design/notices'
import {
  AdminRow,
  Card,
  CardGrid,
  FieldCard,
  Preview,
  StatePill,
  TitleRow,
} from './design/surfaces'
import {
  diffRows,
  draftSaveState,
  formatJstInstant,
  IMPACT_SEVERITY_LABEL,
  impactSummary,
  ORIGIN_LABEL,
  type OverrideReleaseNotice,
  overrideReleaseNotice,
  publicationView,
  RESOLUTION_LABEL,
  scheduleError,
  settingsFieldLabel,
  settingsStateLabel,
  settingsWarnings,
  versionConflictNotice,
} from './settings-publication-view'
import type { StaffScreenProps } from './staff-screen'

/**
 * 設定ガイド 第6工程「影響確認と公開」と、その周辺（適用元・公開結果・版履歴）。
 *
 * 下書き → 影響確認 → 公開 は一本の閉ループで、途中を飛ばせないことが仕様の
 * 中身そのもの（AC-EYEX-108, 109）。したがって「公開する」は影響確認の結果に
 * 従属し、過去版の復元は再公開ではなく新しい下書きを作るだけに留める。
 *
 * 見た目は承認済みモック `settings-complete-approved.html#impact` の語彙で組む。
 * 数だけを 4 枚のカードで立て、やることは下の警告面が文章で持つ。数と指示を
 * 同じ面に混ぜると、どちらも読まれない。
 *
 * 時計はここにも helper にも無い。JST の今日は `today` で注入される。
 */

type Props = StaffScreenProps & {
  permissions: StorePermission[]
  /** JST `YYYY-MM-DD`, injected: this screen never reads the clock. */
  today: string
  /**
   * 工程1〜5に未保存の編集が残っているか。設定の編集はガイド側が持っている
   * ので、保存状態の真偽もそちらから渡す（AC-EYEX-45）。
   */
  dirty?: boolean
  /**
   * どちらの面として描くか。`guide` は設定ガイド工程 6「影響確認と公開」、
   * `result` は承認済みモック `#publish-result` の全幅の独立した面。
   * 公開結果を工程 6 の下端に埋めると、折り返しの下に隠れて一部失敗に
   * 誰も気づかない（UC-EYEX-162, AC-EYEX-107）。
   */
  view?: 'guide' | 'result'
  /** 公開が通ったことを親へ伝える。親は公開結果の面へ移す。 */
  onPublished?: () => void
}

const RESOLUTION_OPTIONS: readonly SettingsConflictResolutionKind[] = [
  'alternative_resource',
  'keep_exception',
  'customer_contacted',
]

/**
 * 重大度は語で読ませる（`IMPACT_SEVERITY_LABEL`）。ピルの色は語を補うだけで、
 * 情報を色だけに載せない。
 */
const SEVERITY_TONE: Record<SettingsImpactSeverity, 'plain' | 'danger' | 'caution'> = {
  blocking: 'danger',
  warning: 'caution',
  info: 'plain',
}

const LOAD_ERROR = '設定を取得できませんでした。もう一度お試しください。'

/**
 * 公開結果の数（モックの `.card strong{font-size:28px}`）。28px は 4 の倍数では
 * ない実測値なので、純粋な寸法としてインラインで持つ。
 */
function Tally({ count }: { count: string }) {
  return (
    <strong className="block font-bold" style={{ fontSize: '28px' }}>
      {count}
    </strong>
  )
}

/** 公開できない理由を指す先。押せない「公開する」から `aria-describedby` で結ぶ。 */
const BLOCKED_REASON_ID = 'settings-publication-blocked'

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * 名前のついた区画。承認済みモックの `.preview`（白・1px 罫・角丸 9px）で、
 * 見出しは中の太字 1 行目が持つ。区画の名前は装飾ではなく仕様なので
 * （UC-EYEX-159 は状態と警告を別の区画に分けることを求める）、必ず付ける。
 */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Preview label={label}>
      <b className="block">{label}</b>
      {children}
    </Preview>
  )
}

/** 面の中で 1 段落ぶんの間隔を空けた行。段落の既定余白は使わない。 */
function Line({ children }: { children: ReactNode }) {
  return <span className="mt-1.5 block">{children}</span>
}

export function SettingsPublication({
  storeId,
  storeName,
  api,
  permissions,
  today,
  dirty = false,
  view = 'guide',
  onPublished,
}: Props) {
  const canRead = permissions.includes('settings.read')
  const canManage = permissions.includes('settings.manage')

  const [draft, setDraft] = useState<SettingsDraft>()
  const [impact, setImpact] = useState<SettingsImpactReport>()
  const [override, setOverride] = useState<SettingsOverrideView>()
  const [versions, setVersions] = useState<SettingsVersionSummary[]>([])
  const [versionDetail, setVersionDetail] = useState<SettingsVersionDetail>()
  const [publication, setPublication] = useState<SettingsPublicationContract>()
  /*
   * 店舗の名前。公開は複数店舗に当たるので、結果の行が `storeId` のままだと
   * 生の UUID が画面に出る。UUID は誰も読めず、隣り合う店舗を取り違える。
   * 名前は `/api/staff/stores` にしか無いので、ここで引いて対応表にする。
   */
  const [storeNames, setStoreNames] = useState<Record<string, string>>({})
  const [releaseNotice, setReleaseNotice] = useState<OverrideReleaseNotice>()
  const [error, setError] = useState<string>()
  const [info, setInfo] = useState<string>()
  const [scheduleInput, setScheduleInput] = useState('')
  const [scheduleMessage, setScheduleMessage] = useState<string>()
  const [resolving, setResolving] = useState<{ reservationId: string; message: string }>()
  const [resolution, setResolution] =
    useState<SettingsConflictResolutionKind>('alternative_resource')
  const [resolutionNote, setResolutionNote] = useState('')
  const [rescheduling, setRescheduling] = useState(false)
  // 手前を塞ぐ面の見出しを名前として指すための id（描画には影響しない）。
  const resolveTitleId = useId()
  const rescheduleTitleId = useId()

  const base = `/api/staff/stores/${storeId}/availability`

  const loadImpact = useCallback(async () => {
    const response = await api(`${base}/draft/impact`)
    if (!response.ok) return
    const parsed = SettingsImpactReport.safeParse(await readJson(response))
    if (parsed.success) setImpact(parsed.data)
  }, [api, base])

  useEffect(() => {
    if (!canRead) return
    let active = true
    void (async () => {
      const [draftResponse, impactResponse, overrideResponse, versionsResponse, storesResponse] =
        await Promise.all([
          api(`${base}/draft`),
          api(`${base}/draft/impact`),
          api(`${base}/override`),
          api(`${base}/versions`),
          api('/api/staff/stores'),
        ])
      if (!active) return
      // 下書きがまだ無いのは失敗ではない。無いものを「取得できません」と
      // 言うと、実際の失敗と区別できなくなる。
      if (draftResponse.ok) {
        const parsed = SettingsDraft.safeParse(await readJson(draftResponse))
        if (active && parsed.success) setDraft(parsed.data)
      } else if (draftResponse.status >= 500) {
        if (active) setError(LOAD_ERROR)
      }
      if (impactResponse.ok) {
        const parsed = SettingsImpactReport.safeParse(await readJson(impactResponse))
        if (active && parsed.success) setImpact(parsed.data)
      }
      if (overrideResponse.ok) {
        const parsed = SettingsOverrideView.safeParse(await readJson(overrideResponse))
        if (active && parsed.success) setOverride(parsed.data)
      }
      if (versionsResponse.ok) {
        const parsed = SettingsVersionSummary.array().safeParse(await readJson(versionsResponse))
        if (active && parsed.success) setVersions(parsed.data)
      }
      if (storesResponse.ok) {
        const parsed = Store.array().safeParse(await readJson(storesResponse))
        if (active && parsed.success) {
          setStoreNames(Object.fromEntries(parsed.data.map((store) => [store.id, store.name])))
        }
      }
    })()
    return () => {
      active = false
    }
  }, [api, base, canRead])

  if (!canRead) {
    return <StatusNotice>設定を閲覧する権限がありません。</StatusNotice>
  }

  /*
   * 名前が引けていない店舗は UUID を出さずに「店舗名未取得」と言う。生の ID を
   * 出すくらいなら、分かっていないことを分かっていないと書く方が読める。
   */
  const storeLabel = (id: string) => storeNames[id] ?? '店舗名未取得'

  /*
   * 版履歴は新しい順で返る。結果の面はいちばん新しい版だけを指す（差分も復元も
   * 「いま公開した版」が対象で、古い版を選ばせるのは版履歴の面の役目）。
   */
  const latestVersion = versions[0]
  /* 見出しの下に出す実行者。公開した版の `publishedBy` を名前として読む。 */
  const resultVersion = latestVersion

  const summary = impact === undefined ? undefined : impactSummary(impact)
  const saveState = draftSaveState({ draft, dirty })
  const warnings = settingsWarnings({ impact, publication })
  const result = publication === undefined ? undefined : publicationView(publication)
  const canPublish = draft !== undefined && summary?.canPublish === true

  const saveDraft = async (status: 'draft' | 'review') => {
    if (draft === undefined) return
    setError(undefined)
    setInfo(undefined)
    const { storeId: _storeId, ...settings } = draft.settings
    const response = await api(`${base}/draft`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, settings }),
    })
    const body = await readJson(response)
    if (!response.ok) {
      setError(versionConflictNotice(body) ?? '下書きを保存できませんでした。')
      return
    }
    const parsed = SettingsDraft.safeParse(body)
    if (!parsed.success) {
      setError('下書きを保存できませんでした。')
      return
    }
    setDraft(parsed.data)
    setInfo(status === 'review' ? '確認へ回しました。' : '下書きを保存しました。')
    await loadImpact()
  }

  const recordResolution = async () => {
    if (resolving === undefined) return
    const response = await api(`${base}/draft/conflicts/${resolving.reservationId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution, note: resolutionNote }),
    })
    const parsed = SettingsConflictResolution.safeParse(await readJson(response))
    if (!response.ok || !parsed.success) {
      setError('解消を記録できませんでした。')
      return
    }
    setResolving(undefined)
    setResolutionNote('')
    // 記録しただけでは公開できるとは限らない。必ずサーバへ再確認させる。
    await loadImpact()
  }

  const publish = async (scheduledForJst?: string) => {
    if (draft === undefined) return
    setError(undefined)
    setScheduleMessage(undefined)
    const response = await api(`${base}/publications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        draftId: draft.id,
        targetStoreIds: [storeId],
        ...(scheduledForJst === undefined ? {} : { scheduledForJst }),
        idempotencyKey: crypto.randomUUID(),
      }),
    })
    const body = await readJson(response)
    if (!response.ok) {
      setError(
        (body as { error?: unknown } | undefined)?.error === 'publication_blocked'
          ? '未解消の影響予約があるため公開できません。影響確認をやり直してください。'
          : '公開できませんでした。もう一度お試しください。',
      )
      await loadImpact()
      return
    }
    const parsed = SettingsPublicationContract.safeParse(body)
    if (parsed.success) {
      setPublication(parsed.data)
      onPublished?.()
    }
  }

  const patchPublication = async (patch: { scheduledForJst?: string; status?: 'cancelled' }) => {
    if (publication === undefined) return
    const response = await api(`${base}/publications/${publication.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const parsed = SettingsPublicationContract.safeParse(await readJson(response))
    if (!response.ok || !parsed.success) {
      setError('公開予定を変更できませんでした。')
      return
    }
    setPublication(parsed.data)
    setRescheduling(false)
  }

  const postPublication = async (suffix: 'run' | 'retry') => {
    if (publication === undefined) return
    const response = await api(`${base}/publications/${publication.id}/${suffix}`, {
      method: 'POST',
    })
    const parsed = SettingsPublicationContract.safeParse(await readJson(response))
    if (!response.ok || !parsed.success) {
      setError(suffix === 'retry' ? '再試行できませんでした。' : '公開を実行できませんでした。')
      return
    }
    setPublication(parsed.data)
  }

  const openDiff = async (versionId: string) => {
    const response = await api(`${base}/versions/${versionId}`)
    const parsed = SettingsVersionDetail.safeParse(await readJson(response))
    if (response.ok && parsed.success) setVersionDetail(parsed.data)
  }

  const restoreVersion = async (versionId: string) => {
    const response = await api(`${base}/versions/${versionId}/restore`, { method: 'POST' })
    const parsed = SettingsDraft.safeParse(await readJson(response))
    if (!response.ok || !parsed.success) {
      setError('過去版を復元できませんでした。')
      return
    }
    setDraft(parsed.data)
    setPublication(undefined)
    setInfo('過去版を新しい下書きにしました。公開する前に影響確認を行ってください。')
    await loadImpact()
  }

  const releaseOverride = async () => {
    const response = await api(`${base}/override/release`, { method: 'POST' })
    const parsed = SettingsOverrideRelease.safeParse(await readJson(response))
    if (!response.ok || !parsed.success) {
      setError('店舗上書きを解除できませんでした。')
      return
    }
    setDraft(parsed.data.draft)
    setImpact(parsed.data.impact)
    setOverride((previous) =>
      previous === undefined ? previous : { ...previous, origin: 'chain', overriddenFields: [] },
    )
    setReleaseNotice(overrideReleaseNotice(parsed.data))
  }

  const scheduleAndPublish = () => {
    const message = scheduleError(scheduleInput, today)
    if (message !== undefined) {
      setScheduleMessage(message)
      return
    }
    void publish(scheduleInput)
  }

  const openResolution = (reservationId: string, message: string) => {
    setResolving({ reservationId, message })
    setResolution('alternative_resource')
    setResolutionNote('')
  }

  /*
   * 公開予定の変更の幕。工程6と公開結果の両方から開く。結果の面にだけ
   * 「公開予定を変更」の押しどころがあるのに幕が工程6にしか無いと、押しても
   * 何も起きない（UC-EYEX-161）。
   */
  const rescheduleModal = rescheduling ? (
    <Modal title="公開予定の変更" titleId={rescheduleTitleId}>
      <TextField
        id="reschedule-input"
        label="新しい公開日時（JST）"
        error={scheduleMessage}
        value={scheduleInput}
        placeholder="2026-08-30T18:00"
        onChange={(event) => {
          setScheduleInput(event.target.value)
          setScheduleMessage(undefined)
        }}
      />
      <Actions gap={2.5} mt={4}>
        <Action onClick={() => setRescheduling(false)}>やめる</Action>
        <Action
          variant="primary"
          onClick={() => {
            const message = scheduleError(scheduleInput, today)
            if (message !== undefined) {
              setScheduleMessage(message)
              return
            }
            void patchPublication({ scheduledForJst: scheduleInput })
          }}
        >
          この日時に変更
        </Action>
      </Actions>
    </Modal>
  ) : null

  /*
   * 承認済みモック `operations-approved.html#publish-result` — 全幅の独立した面。
   *
   *   .content{padding:24px 30px}（節ナビを持たないので幅いっぱい）
   *   .grid{grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}
   *   .card strong{font-size:28px}
   *   .row.error{background:#fff0ed;border-color:#d4a299}
   *
   * 「12店舗成功」で終わらせず、失敗した店舗をそのまま行にして再試行を並べる。
   * まとめだけを見せると、反映されていない店舗が翌日まで残る。
   */
  if (view === 'result') {
    if (result === undefined)
      return (
        <>
          <h1>公開結果</h1>
          <StatusNotice>
            まだ公開していません。設定ガイドの「影響確認と公開」から公開すると、ここに結果が出ます。
          </StatusNotice>
        </>
      )
    return (
      <section aria-label="公開結果">
        <TitleRow
          gap={0}
          push={
            <StatePill tone={result.statusTone === 'danger' ? 'danger' : 'caution'}>
              {result.statusLabel}
            </StatePill>
          }
        >
          <div>
            {/* `.title h2{margin:0}` — 実行者の行がすぐ下に続く。 */}
            <h1 className="my-0">{result.versionLabel}</h1>
            {/*
             * モックはここに「実行者 山田 · 承認者 佐藤」と書く。実行者は版が
             * `publishedBy` として持っているので出す。承認者は契約のどこにも
             * 無いので名乗らない（誰が承認したかを推測で書かない）。
             */}
            <p>
              {[
                result.executedLine,
                ...(resultVersion === undefined ? [] : [`実行者 ${resultVersion.publishedBy}`]),
                ...(result.scheduledLine === undefined ? [] : [result.scheduledLine]),
              ].join(' · ')}
            </p>
          </div>
        </TitleRow>

        {/*
         * モックの 3 枚（`.card strong{font-size:28px}`）。数を大きく立て、その
         * 内訳を下に 1 行だけ添える。数と内訳を同じ大きさで並べると、一部失敗の
         * 「1」が文章に埋もれて見落とされる。
         */}
        <CardGrid>
          <FieldCard title="成功">
            <Tally count={`${String(result.appliedCount)}店舗`} />
            <span className="block">{result.slotCountLabel}</span>
          </FieldCard>
          <FieldCard title="失敗" tone={result.failed.length > 0 ? 'error' : 'plain'}>
            <Tally count={`${String(result.failedCount)}店舗`} />
            {result.failed.map((target) => (
              <span key={target.storeId} className="block">
                {`${storeLabel(target.storeId)} · ${target.failureReason ?? '理由不明'}`}
              </span>
            ))}
          </FieldCard>
          <FieldCard title="反映確認">
            {/* Web枠と台帳は別々に読ませる。1 行に繋ぐと、どちらが未反映
                なのかを目で切り分けられない。 */}
            <span className="block">{result.webConfirmLabel}</span>
            <span className="block">{result.ledgerConfirmLabel}</span>
          </FieldCard>
        </CardGrid>

        {/* 失敗した店舗は 1 店舗 1 行。まとめの数字だけにしない。 */}
        {result.failed.length > 0 && (
          <section aria-label="失敗した店舗">
            {result.failed.map((target) => (
              <AdminRow key={target.storeId} tone="error" label={storeLabel(target.storeId)}>
                <b>{storeLabel(target.storeId)}</b>
                <span>{target.failureReason ?? '理由不明'}</span>
                <span>公開未反映</span>
                {canManage && result.canRetry ? (
                  <Action
                    variant="primary"
                    inset="tight"
                    onClick={() => void postPublication('retry')}
                  >
                    この店舗だけ再試行
                  </Action>
                ) : (
                  <span />
                )}
              </AdminRow>
            ))}
          </section>
        )}

        {/*
         * モックに無い面。モックは失敗した 1 店舗だけを行にするが、実アプリの
         * 公開は店舗数が可変で、成功した側が「どの版まで進んだか」はここにしか
         * 残らない。再試行のあと版が揃ったことを確かめる先が要る。
         */}
        {result.applied.length > 0 && (
          <Preview label="反映済みの店舗">
            <b className="block">反映済みの店舗</b>
            {result.applied.map((target) => (
              <Line key={target.storeId}>
                <span>{storeLabel(target.storeId)}</span>
                <span>{` ・ 第${target.appliedVersion ?? 0}版`}</span>
              </Line>
            ))}
          </Preview>
        )}

        {/*
         * モック `#publish-result` の下端の 2 つ。結果を見た人がそのまま
         * 「何が変わったのか」と「やり直す」へ行けるようにする（版履歴の面まで
         * 辿らせると、失敗した直後にもう一度探すことになる）。
         */}
        {latestVersion !== undefined && (
          <Actions gap={2.5} mt={4}>
            <Action onClick={() => void openDiff(latestVersion.versionId)}>版の差分を見る</Action>
            {canManage && (
              <Action onClick={() => void restoreVersion(latestVersion.versionId)}>
                過去版から新しい下書きを作る
              </Action>
            )}
          </Actions>
        )}

        {canManage && (result.canCancel || result.canReschedule) && (
          <Actions gap={2.5} mt={4}>
            <Action onClick={() => setRescheduling(true)}>公開予定を変更</Action>
            <Action onClick={() => void postPublication('run')}>今すぐ実行</Action>
            {/* 破棄は既定の見た目にしない。 */}
            <Action variant="danger" onClick={() => void patchPublication({ status: 'cancelled' })}>
              公開予定を取消
            </Action>
          </Actions>
        )}
        {rescheduleModal}
      </section>
    )
  }

  return (
    <>
      <TitleRow
        push={
          <span>
            {draft === undefined
              ? storeName
              : `版 draft-${String(draft.draftVersion).padStart(2, '0')}`}
          </span>
        }
      >
        <h1>影響を確認して公開</h1>
      </TitleRow>

      {error && <FailureNotice>{error}</FailureNotice>}
      {info && <StatusNotice>{info}</StatusNotice>}

      {/* ---------------- 影響確認（承認済みモック #impact） ---------------- */}
      <section aria-label="影響確認">
        {summary === undefined ? (
          <StatusNotice>影響確認の結果はまだありません。</StatusNotice>
        ) : (
          <>
            <CardGrid columns={2} mt={4}>
              <FieldCard title="公開予定枠">{summary.slotLabel}</FieldCard>
              <FieldCard title="既存予約">{summary.ledgerLabel}</FieldCard>
              {/* 公開できない理由（ブロッキング）は数だけを琥珀で立てる。 */}
              <FieldCard
                title="ブロッキング"
                tone={summary.unresolved.length > 0 ? 'caution' : 'plain'}
              >
                {summary.blockingLabel}
              </FieldCard>
              <FieldCard title="警告">{summary.warningLabel}</FieldCard>
            </CardGrid>
            {/*
             * 「公開できません」は 4 枚の数のすぐ下に置く（モック #impact の
             * `.preview.warning` の位置）。競合の内訳より後ろに回すと、内訳が
             * 伸びたぶん折り返しの下へ落ちて、公開できない事実に気づかない。
             */}
            {summary.blockedReason !== undefined && (
              <Preview id={BLOCKED_REASON_ID} tone="caution" label="公開できない理由">
                <b className="block">{summary.blockedHeadline}</b>
                {summary.blockedReason}
              </Preview>
            )}
            {/*
             * 操作は内訳より前に置く（モック `#impact` は 4 枚の数 →
             * 「公開できません」→ 2 つの操作の順）。内訳を先にすると、内訳が
             * 伸びたぶん「公開する」が画面の外へ落ちる。
             */}
            {canManage && (
              <Actions gap={2.5} mt={4}>
                {summary !== undefined && summary.unresolved.length > 0 && (
                  <Action
                    onClick={() => {
                      const first = summary.unresolved[0]
                      if (first === undefined) return
                      openResolution(first.reservationId ?? '', first.message)
                    }}
                  >
                    影響予約を解消
                  </Action>
                )}
                <Action onClick={() => void loadImpact()}>影響を再確認</Action>
                {/*
                 * 押せないのは事実だが、押せない理由は上の警告面が持っている。
                 * `aria-describedby` でその面へ結び付け、読み上げでも理由に届かせる。
                 */}
                <Action
                  disabled={!canPublish}
                  describedBy={summary?.blockedReason === undefined ? undefined : BLOCKED_REASON_ID}
                  onClick={() => void publish()}
                >
                  公開する
                </Action>
              </Actions>
            )}
            {summary.groups.map((group) => (
              <Preview key={group.kind} label={group.label}>
                <b className="block">{group.label}</b>
                <StatePill tone={SEVERITY_TONE[group.severity]}>{group.severityLabel}</StatePill>
                {group.items.map((item) => (
                  <Line key={`${item.kind}-${item.reservationId ?? item.message}`}>
                    {item.message}
                    {/* 群の見出しがすでに重大度を語で示している。差がある
                        項目だけ、行にも語を添える。 */}
                    {item.severity !== group.severity && (
                      <>
                        {' '}
                        <StatePill tone={SEVERITY_TONE[item.severity]}>
                          {IMPACT_SEVERITY_LABEL[item.severity]}
                        </StatePill>
                      </>
                    )}
                    {item.resolution !== null && (
                      <>
                        {' '}
                        <StatePill>{RESOLUTION_LABEL[item.resolution]}</StatePill>
                      </>
                    )}
                    {canManage && item.reservationId !== null && item.resolution === null && (
                      <>
                        {' '}
                        <Action
                          inset="tight"
                          onClick={() => openResolution(item.reservationId ?? '', item.message)}
                        >
                          解消を記録
                        </Action>
                      </>
                    )}
                  </Line>
                ))}
              </Preview>
            ))}
            <Line>{summary.evaluatedAtLabel}</Line>
          </>
        )}
      </section>

      {/* ---------------- 設定の状態と警告 ---------------- */}
      <Section label="設定の状態">
        <Line>
          <StatePill>{draft === undefined ? '下書きなし' : settingsStateLabel(draft)}</StatePill>{' '}
          <StatePill tone={saveState.dirty ? 'caution' : 'plain'}>{saveState.label}</StatePill>
        </Line>
        <Line>{saveState.savedAtLabel}</Line>
        <Line>{saveState.savedByLabel}</Line>
        {canManage && draft !== undefined && (
          <Actions gap={2.5} mt={4}>
            <Action onClick={() => void saveDraft('draft')}>下書きを保存</Action>
            <Action onClick={() => void saveDraft('review')}>確認へ回す</Action>
          </Actions>
        )}
      </Section>

      {warnings.length > 0 && (
        <Preview tone="caution" label="警告">
          <b className="block">警告</b>
          <Line>競合と失敗は設定の状態ではありません。状態とは別に解消してください。</Line>
          {warnings.map((warning) => (
            <Line key={warning.id}>
              <StatePill tone={warning.tone === 'danger' ? 'danger' : 'caution'}>
                {warning.label}
              </StatePill>
            </Line>
          ))}
        </Preview>
      )}

      {/* ---------------- 適用元 ---------------- */}
      {override !== undefined && (
        <Section label="適用元">
          <Line>
            <StatePill tone={override.origin === 'chain' ? 'plain' : 'caution'}>
              {ORIGIN_LABEL[override.origin]}
            </StatePill>{' '}
            <span>{`全店共通 第${override.chainVersion}版`}</span>
          </Line>
          {override.overriddenFields.length > 0 && (
            <>
              <Line>店舗で上書きしている項目</Line>
              <Line>
                {override.overriddenFields.map((field) => (
                  <span key={field}>
                    <StatePill>{settingsFieldLabel(field)}</StatePill>{' '}
                  </span>
                ))}
              </Line>
            </>
          )}
          {releaseNotice !== undefined && (
            <>
              <Line>
                <b>{releaseNotice.headline}</b>
              </Line>
              <Line>{releaseNotice.detail}</Line>
            </>
          )}
          {canManage && override.origin === 'store_override' && (
            <Actions gap={2.5} mt={4}>
              <Action onClick={() => void releaseOverride()}>店舗上書きを解除</Action>
            </Actions>
          )}
        </Section>
      )}

      {/* ---------------- 公開予約 ---------------- */}
      {canManage && (
        <Section label="公開予約">
          <TextField
            id="publish-schedule"
            label="公開日時（JST）"
            error={scheduleMessage}
            value={scheduleInput}
            placeholder="2026-08-30T18:00"
            onChange={(event) => {
              setScheduleInput(event.target.value)
              setScheduleMessage(undefined)
            }}
          />
          <Line>
            空欄のまま公開すると、その場で適用されます。日時を入れると公開予約になります。
          </Line>
          <Actions gap={2.5} mt={4}>
            <Action disabled={!canPublish} onClick={scheduleAndPublish}>
              公開を予約する
            </Action>
          </Actions>
        </Section>
      )}

      {/* ---------------- 版履歴 ---------------- */}
      <Section label="版履歴">
        {versions.length === 0 ? (
          <Line>公開済みの版はまだありません。</Line>
        ) : (
          versions.map((version) => (
            <Line key={version.versionId}>
              <b>{`第${version.version}版`}</b>
              <span>{`　${formatJstInstant(version.publishedAt)}　`}</span>
              <span>{version.publishedBy}</span>{' '}
              <StatePill>{ORIGIN_LABEL[version.origin]}</StatePill>{' '}
              <Action inset="tight" onClick={() => void openDiff(version.versionId)}>
                版の差分を見る
              </Action>{' '}
              {canManage && (
                <Action inset="tight" onClick={() => void restoreVersion(version.versionId)}>
                  過去版から新しい下書きを作る
                </Action>
              )}
            </Line>
          ))
        )}
        {versionDetail !== undefined && (
          <Card label={`第${versionDetail.version}版の差分`} className="mt-3.5 overflow-x-auto">
            <b className="block">{`第${versionDetail.version}版の差分`}</b>
            <table className="mt-2.5 w-full border-collapse text-left">
              <thead>
                <tr>
                  <th scope="col" className="border border-line p-2.5 font-bold">
                    項目
                  </th>
                  <th scope="col" className="border border-line p-2.5 font-bold">
                    変更前
                  </th>
                  <th scope="col" className="border border-line p-2.5 font-bold">
                    変更後
                  </th>
                </tr>
              </thead>
              <tbody>
                {diffRows(versionDetail).map((row) => (
                  <tr key={row.field}>
                    <th scope="row" className="border border-line p-2.5 text-left font-normal">
                      {row.label}
                    </th>
                    <td className="border border-line p-2.5">{row.before}</td>
                    <td className="border border-line p-2.5">{row.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Line>過去版は直接公開できません。復元すると新しい下書きになります。</Line>
          </Card>
        )}
      </Section>

      {/* ---------------- 手前を塞ぐ確認 ---------------- */}
      {resolving !== undefined && (
        <Modal title="影響予約の解消を記録" titleId={resolveTitleId}>
          <p>{resolving.message}</p>
          <div className="flex flex-col gap-3">
            <PickerField
              id="resolution-kind"
              label="対応"
              value={resolution}
              options={RESOLUTION_OPTIONS.map((kind) => ({
                value: kind,
                label: RESOLUTION_LABEL[kind],
              }))}
              onChange={(value) => {
                const next = RESOLUTION_OPTIONS.find((kind) => kind === value)
                if (next !== undefined) setResolution(next)
              }}
            />
            <TextAreaField
              id="resolution-note"
              label="メモ"
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
            />
          </div>
          <Actions gap={2.5} mt={4}>
            <Action onClick={() => setResolving(undefined)}>やめる</Action>
            <Action variant="primary" onClick={() => void recordResolution()}>
              記録する
            </Action>
          </Actions>
        </Modal>
      )}

      {rescheduleModal}
    </>
  )
}
