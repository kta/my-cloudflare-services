import { type AuditActorType, AuditEventView, type StorePermission } from '@app/contracts'
import { useCallback, useEffect, useState } from 'react'
import { EmptyResult, PermissionDenied } from './admin-chrome'
import { auditDiffRows, formatJstInstant, jstWallClockToInstant } from './attention-view'
import { Action, Actions } from './design/controls'
import { DateTimeField, TextField, ToggleFilter } from './design/forms'
import { AdminLayout, AdminSurface } from './design/layouts'
import { MatrixCell, MatrixRow, MatrixTable } from './design/matrix'
import { FailureNotice, StatusNotice } from './design/notices'
import { AuditRecord, Card, DiffPair, TitleRow } from './design/surfaces'
import type { StaffLocation } from './staff-navigation'
import type { StaffScreenProps } from './staff-screen'

/** モック `operations-approved.html#audit` の節。この面の中の絞り込みである。 */
const SECTIONS: { label: string; to?: StaffLocation }[] = [
  { label: '本日の管理操作', to: { screen: 'audit' } },
  { label: '録音再生', to: { screen: 'recording-ops' } },
  /* 店舗切替はバーのシートで起きる。ここは節の名前としてだけ置く。 */
  { label: '店舗切替' },
  { label: '注意事項', to: { screen: 'attention-settings' } },
]

/** 主体種別の絞り込み。ブラウザ既定の `<select>` を使わない理由は下記。 */
const ACTOR_TYPES: { value: '' | AuditActorType; label: string }[] = [
  { value: '', label: 'すべて' },
  { value: 'user', label: '個人' },
  { value: 'shared_terminal', label: '共有端末' },
]

type Props = StaffScreenProps & {
  permissions: StorePermission[]
  /** JST `YYYY-MM-DD`, injected: a screen never reads the clock itself. */
  today: string
  /** Injected instant, for the same reason. */
  now: string
}

type Filters = {
  from: string
  to: string
  action: string
  actorType: '' | AuditActorType
  entityType: string
  entityId: string
}

const EMPTY_FILTERS: Filters = {
  from: '',
  to: '',
  action: '',
  actorType: '',
  entityType: '',
  entityId: '',
}

const ACTOR_TYPE_LABEL: Record<string, string> = {
  user: '個人',
  shared_terminal: '共有端末',
}

function actorTypeLabel(actorType: string): string {
  return ACTOR_TYPE_LABEL[actorType] ?? actorType
}

const FORBIDDEN = '権限のある範囲の監査イベントだけを表示できます。'
const GENERIC_FAILURE = '監査イベントを読み込めませんでした。通信を確認してください。'

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/** 監査は追記専用。画面は読むだけで、絞り込みは権限の中でしか広がらない。 */
function queryFrom(filters: Filters): string {
  const query = new URLSearchParams()
  const from = jstWallClockToInstant(filters.from)
  const to = jstWallClockToInstant(filters.to)
  if (from !== undefined) query.set('from', from)
  if (to !== undefined) query.set('to', to)
  if (filters.action.trim() !== '') query.set('action', filters.action.trim())
  if (filters.actorType !== '') query.set('actorType', filters.actorType)
  if (filters.entityType.trim() !== '') query.set('entityType', filters.entityType.trim())
  if (filters.entityId.trim() !== '') query.set('entityId', filters.entityId.trim())
  query.set('limit', '50')
  return query.toString()
}

/**
 * 監査検索 (UC-EYEX-155, AC-EYEX-102).
 *
 * 店舗はパスが決める境界であり、絞り込みでは広がらない。表示できるのは
 * 呼び出し元の権限内のイベントだけで、権限が無ければ検索そのものを出さない。
 */
export function AuditSearchScreen({ storeId, storeName, api, permissions, navigate }: Props) {
  const mayRead = permissions.includes('audit.read')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [events, setEvents] = useState<AuditEventView[]>()
  const [failure, setFailure] = useState<string>()
  const [detail, setDetail] = useState<AuditEventView>()
  const [loading, setLoading] = useState(false)
  /*
   * モックのこの面は詳細ビューである。絞り込みの板を既定で開くと、監査が
   * 「まず条件を組み立てる面」になってしまう。監査で最初に読みたいのは直近の
   * 1 件そのものなので、詳細を既定にし、検索はそこから開く同じ面の別の姿とする。
   */
  const [searching, setSearching] = useState(false)

  const search = useCallback(
    async (current: Filters) => {
      setLoading(true)
      setFailure(undefined)
      try {
        const response = await api(
          `/api/staff/stores/${encodeURIComponent(storeId)}/audit-events?${queryFrom(current)}`,
        )
        if (!response.ok) {
          setEvents(undefined)
          setDetail(undefined)
          setFailure(response.status === 403 ? FORBIDDEN : GENERIC_FAILURE)
          return
        }
        const parsed = AuditEventView.array().safeParse(await readJson(response))
        if (!parsed.success) {
          setEvents(undefined)
          setDetail(undefined)
          setFailure(GENERIC_FAILURE)
          return
        }
        setEvents(parsed.data)
        // モックのファーストビューは詳細ビュー。一覧に結果があるかぎり、
        // 先頭の 1 件を選んだ状態で開く (`AUDIT-DETAIL`)。
        setDetail(parsed.data[0])
      } catch {
        setEvents(undefined)
        setDetail(undefined)
        setFailure(GENERIC_FAILURE)
      } finally {
        setLoading(false)
      }
    },
    [api, storeId],
  )

  useEffect(() => {
    if (!mayRead) return
    void search(EMPTY_FILTERS)
  }, [mayRead, search])

  if (!mayRead) return <PermissionDenied onReturnHome={() => navigate({ screen: 'home' })} />

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS)
    setDetail(undefined)
    void search(EMPTY_FILTERS)
  }

  return (
    /* 承認済みモック `operations-approved.html#audit` /
       `AUDIT-DETAIL--default--ipad-landscape.png`。 */
    <AdminSurface label="監査">
      <AdminLayout
        /*
         * 柱は全画面共通の 1 本しかないので、この面の節はそこへ渡す。
         * 別の面への移動はサイドバーが持つので、ここでは並べない。
         */
        sections={SECTIONS.map((section) => ({
          ...section,
          current: section.label === '本日の管理操作',
        }))}
      >
        <TitleRow
          push={
            <Action
              inset="tight"
              onClick={() => {
                setSearching(!searching)
              }}
            >
              {searching ? '詳細に戻る' : '監査を検索'}
            </Action>
          }
        >
          <h1>{searching ? '監査イベントの検索' : '監査イベント詳細'}</h1>
        </TitleRow>

        {!searching && detail === undefined && (
          <StatusNotice>
            {`表示できる監査イベントがありません（${storeName} · 権限のある範囲のみ）。`}
          </StatusNotice>
        )}

        {!searching && detail && (
          /* 記録は要約せず、保存されている姿のまま等幅で出す。整形して
             読みやすくすると、後から「本当にこう記録されていたのか」を
             確かめられなくなる。前後の差分だけは人が読む形に開く。 */
          <section aria-label="監査イベント詳細">
            <AuditRecord
              label="監査イベントの記録"
              lines={[
                `event: ${detail.action}`,
                `store: ${storeName}`,
                `actor_type: ${detail.actorType}`,
                `actor: ${detail.actorId}`,
                `target: ${detail.entityType} ${detail.entityId}`,
                `correlation_id: ${detail.correlationId ?? 'なし'}`,
                `occurred_at: ${formatJstInstant(detail.occurredAt)}`,
              ]}
            />
            {auditDiffRows(detail).length === 0 ? (
              <StatusNotice>変更前後の記録はありません。</StatusNotice>
            ) : (
              <div className="mt-3">
                <DiffPair>
                  {(['before', 'after'] as const).map((side) => (
                    <Card key={side} label={side === 'before' ? '変更前' : '変更後'}>
                      <b>{side === 'before' ? '変更前' : '変更後'}</b>
                      {auditDiffRows(detail).map((row) => (
                        <span key={row.key} className="block">
                          {`${row.key} ${side === 'before' ? row.before : row.after}`}
                        </span>
                      ))}
                    </Card>
                  ))}
                </DiffPair>
              </div>
            )}
          </section>
        )}

        {searching && (
          <div className="mt-4.5">
            <Card label="監査の絞り込み">
              <b>監査の絞り込み</b>
              <div className="mt-2.5 grid gap-3 md:grid-cols-3">
                <DateTimeField
                  id="audit-from"
                  label="開始日時"
                  value={filters.from}
                  onChange={(from) => setFilters({ ...filters, from })}
                />
                <DateTimeField
                  id="audit-to"
                  label="終了日時"
                  value={filters.to}
                  onChange={(to) => setFilters({ ...filters, to })}
                />
                <TextField
                  id="audit-action"
                  label="操作"
                  value={filters.action}
                  onChange={(event) => setFilters({ ...filters, action: event.target.value })}
                />
                {/*
                 * ブラウザ既定の `<select>` は地域設定の書体と既定の青を持ち込み、
                 * モックのどの面にも無い色が 1 か所だけ出る。選択肢が 3 つしか
                 * ないので、押した状態を面の上に開いたまま並べる。
                 */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-sans text-note">主体種別</span>
                  <fieldset aria-label="主体種別" className="m-0 flex flex-wrap gap-2 border-0 p-0">
                    {ACTOR_TYPES.map((actorType) => (
                      <ToggleFilter
                        key={actorType.label}
                        on={filters.actorType === actorType.value}
                        onClick={() => setFilters({ ...filters, actorType: actorType.value })}
                      >
                        {actorType.label}
                      </ToggleFilter>
                    ))}
                  </fieldset>
                </div>
                <TextField
                  id="audit-entity-type"
                  label="対象種別"
                  value={filters.entityType}
                  onChange={(event) => setFilters({ ...filters, entityType: event.target.value })}
                />
                <TextField
                  id="audit-entity-id"
                  label="対象ID"
                  value={filters.entityId}
                  onChange={(event) => setFilters({ ...filters, entityId: event.target.value })}
                />
              </div>
              <Actions>
                <Action
                  variant="primary"
                  inset="tight"
                  disabled={loading}
                  onClick={() => {
                    void search(filters)
                  }}
                >
                  監査を検索する
                </Action>
              </Actions>
            </Card>
          </div>
        )}

        {failure && <FailureNotice>{failure}</FailureNotice>}
        {searching && events?.length === 0 && (
          <EmptyResult
            title="条件に一致する監査イベントはありません"
            onClearFilters={clearFilters}
          />
        )}

        {searching && events !== undefined && events.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <MatrixTable
              label="監査イベント"
              columns={['日時', '操作', '主体種別', '主体', '対象', '詳細']}
            >
              {events.map((event) => (
                <MatrixRow key={event.id} header={formatJstInstant(event.occurredAt)}>
                  {/* 操作名と対象 ID は記録そのもの。桁で読むので等幅のまま出す。 */}
                  <MatrixCell>
                    <span className="font-record text-grid">{event.action}</span>
                  </MatrixCell>
                  <MatrixCell>{actorTypeLabel(event.actorType)}</MatrixCell>
                  <MatrixCell>{event.actorId}</MatrixCell>
                  <MatrixCell>
                    <span className="font-record text-grid">
                      {`${event.entityType} · ${event.entityId}`}
                    </span>
                  </MatrixCell>
                  <MatrixCell>
                    <Action
                      inset="tight"
                      onClick={() => {
                        setDetail(event)
                        // 詳細を選んだら詳細ビューへ戻す。表の下に開くと、
                        // どちらを読んでいるのかが面の中で二重になる。
                        setSearching(false)
                      }}
                    >
                      詳細
                    </Action>
                  </MatrixCell>
                </MatrixRow>
              ))}
            </MatrixTable>
          </div>
        )}
      </AdminLayout>
    </AdminSurface>
  )
}
