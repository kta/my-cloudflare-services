import { type AuditActorType, AuditEventView, type StorePermission } from '@app/contracts'
import { Button, Card, Field, Notice, Select, TextInput } from '@app/ui'
import { useCallback, useEffect, useState } from 'react'
import { AdminScreen, EmptyResult, PermissionDenied } from './admin-chrome'
import { auditDiffRows, formatJstInstant, jstWallClockToInstant } from './attention-view'
import type { StaffScreenProps } from './staff-screen'

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
    <AdminScreen
      label="監査"
      navigate={navigate}
      sectionsLabel="監査の節"
      activeSection="本日の管理操作"
      sections={[
        { label: '本日の管理操作', to: { screen: 'audit' } },
        { label: '録音再生' },
        { label: '店舗切替' },
        { label: '注意事項' },
      ]}
    >
      <div className="mb-3">
        <p className="font-sans text-ink-muted text-sm">
          表示中の店舗 {storeName} · 権限のある範囲のみ
        </p>
        <h2 className="font-display font-semibold text-2xl text-ink">監査イベント</h2>
      </div>

      {detail && (
        /* モックの `.card.audit` — 等幅で 1 行 1 項目。監査は読むだけなので
           ダイアログにせず、一覧の下に開いたまま置く。 */
        <section aria-label="監査イベント詳細" className="mt-4.5">
          <h3 className="font-display font-semibold text-2xl text-ink">監査イベント詳細</h3>
          <div className="mt-3 rounded-card border border-line bg-surface p-3.5 font-mono text-ink text-sm leading-relaxed">
            <p>{`event: ${detail.action}`}</p>
            <p>{`store: ${storeName}`}</p>
            <p>{`actor_type: ${detail.actorType}`}</p>
            <p>{`actor: ${detail.actorId}`}</p>
            <p>{`target: ${detail.entityType} ${detail.entityId}`}</p>
            <p>{`correlation_id: ${detail.correlationId ?? 'なし'}`}</p>
            <p>{`occurred_at: ${formatJstInstant(detail.occurredAt)}`}</p>
          </div>
          {auditDiffRows(detail).length === 0 ? (
            <div className="mt-3">
              <Notice tone="info">変更前後の記録はありません。</Notice>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {(['before', 'after'] as const).map((side) => (
                <section
                  key={side}
                  aria-label={side === 'before' ? '変更前' : '変更後'}
                  className="rounded-card border border-line bg-surface p-3.5"
                >
                  <p className="font-sans font-bold text-ink text-sm">
                    {side === 'before' ? '変更前' : '変更後'}
                  </p>
                  {auditDiffRows(detail).map((row) => (
                    <p key={row.key} className="font-sans text-ink text-sm">
                      {`${row.key} ${side === 'before' ? row.before : row.after}`}
                    </p>
                  ))}
                </section>
              ))}
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              variant="danger"
              className="min-h-12"
              onClick={() => setDetail(undefined)}
            >
              閉じる
            </Button>
          </div>
        </section>
      )}
      <Card className="grid gap-4 md:grid-cols-3">
        <Field label="開始日時" htmlFor="audit-from">
          <TextInput
            id="audit-from"
            type="datetime-local"
            className="min-h-12"
            value={filters.from}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
        </Field>
        <Field label="終了日時" htmlFor="audit-to">
          <TextInput
            id="audit-to"
            type="datetime-local"
            className="min-h-12"
            value={filters.to}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
        </Field>
        <Field label="操作" htmlFor="audit-action">
          <TextInput
            id="audit-action"
            className="min-h-12"
            value={filters.action}
            onChange={(event) => setFilters({ ...filters, action: event.target.value })}
          />
        </Field>
        <Field label="主体種別" htmlFor="audit-actor-type">
          <Select
            id="audit-actor-type"
            className="min-h-12"
            value={filters.actorType}
            onChange={(event) =>
              setFilters({ ...filters, actorType: event.target.value as '' | AuditActorType })
            }
          >
            <option value="">すべて</option>
            <option value="user">個人</option>
            <option value="shared_terminal">共有端末</option>
          </Select>
        </Field>
        <Field label="対象種別" htmlFor="audit-entity-type">
          <TextInput
            id="audit-entity-type"
            className="min-h-12"
            value={filters.entityType}
            onChange={(event) => setFilters({ ...filters, entityType: event.target.value })}
          />
        </Field>
        <Field label="対象ID" htmlFor="audit-entity-id">
          <TextInput
            id="audit-entity-id"
            className="min-h-12"
            value={filters.entityId}
            onChange={(event) => setFilters({ ...filters, entityId: event.target.value })}
          />
        </Field>
        <div className="flex items-end justify-end md:col-span-3">
          <Button
            type="button"
            className="min-h-12"
            disabled={loading}
            onClick={() => {
              void search(filters)
            }}
          >
            監査を検索する
          </Button>
        </div>
      </Card>

      {failure && (
        <div className="mt-3">
          <Notice tone="danger">{failure}</Notice>
        </div>
      )}
      {events?.length === 0 && (
        <EmptyResult title="条件に一致する監査イベントはありません" onClearFilters={clearFilters} />
      )}

      {events !== undefined && events.length > 0 && (
        <Card className="mt-3 overflow-x-auto">
          <table aria-label="監査イベント" className="w-full border-collapse text-left">
            <thead>
              <tr className="border-line border-b">
                {['日時', '操作', '主体種別', '主体', '対象', '詳細'].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="p-3 font-sans font-semibold text-ink text-sm"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-line border-b last:border-b-0">
                  <td className="p-3 font-sans text-ink text-sm">
                    {formatJstInstant(event.occurredAt)}
                  </td>
                  <td className="p-3 font-mono text-ink text-sm">{event.action}</td>
                  <td className="p-3 font-sans text-ink text-sm">
                    {actorTypeLabel(event.actorType)}
                  </td>
                  <td className="p-3 font-sans text-ink text-sm">{event.actorId}</td>
                  <td className="p-3 font-sans text-ink-muted text-sm">
                    {event.entityType} · {event.entityId}
                  </td>
                  <td className="p-3">
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-12"
                      onClick={() => setDetail(event)}
                    >
                      詳細
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </AdminScreen>
  )
}
