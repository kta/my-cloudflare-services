import type { StorePermission } from '@app/contracts'
import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { useState } from 'react'
import {
  type MergeCustomer,
  type MergeFieldChoice,
  mergePreview,
  type ResolvedMergeField,
} from '../../worker/domain/customers'
import { formatPhoneDigits } from '../booking/CustomerStep'

/*
 * 同じお客様をまとめる（承認済みモック docs/frontend/mockups/eye/images/CUSTOMER-MERGE.png）。
 *
 * 題材: 取り消せない操作の前に、まとめたあとの姿と失うものを同じ画面で読ませる面。
 * トークン計画: 見比べ表は罫だけで組む（箱にしない）。残す側だけ 2px の緑枠と
 *   `--color-pine-soft` の地、残さない側は取り消し線と `--color-ink-faint`。
 *   右は結果（緑の箱）と警告（赤の箱）の 2 枚だけ。
 * シグネチャ: 「まとめると元に戻せません」と実行ボタンが同じ視線の上にあること。
 *
 * 実測（screens/CUSTOMER-MERGE.html の <style> と assets/eye.css）:
 *   本文 padding 28px 32px・2 列 1fr / 300px・gap 28px
 *   見比べ表 3 列 108px / 1fr / 1fr。見出し行は下に padding 14px ＋ 1px の line-strong
 *   各行 min-height 96px・下に 1px の罫。項目名 15px ＋ その下に 13px の「A を残します」
 *   値の枠 margin 10px 6px・padding 10px 12px・角 8px・2px の透明枠。値 16px/600・補足 13px
 *   結果の dl は 76px / 1fr・row-gap 10px（dt 13px / dd 15px/600）の 5 行
 *   警告の li は 13px・行間 1.7 の 2 項目
 * 15px はトークンに無いので `text-body`(16)、18px は `text-lead`(17) に寄せる。
 *
 * まとめたあとの姿は**サーバと同じ `mergePreview` から作る**。画面が別の言い方で
 * 組み立てると、読んで納得した姿と保存された姿が静かに食い違う。
 */

/** 見比べの片側。`registeredLabel` などは行の列に無いので、器から受け取る。 */
export type MergeSide = MergeCustomer & {
  /** おまとめの実行に要る版。下見のあとに動いていたら拒まれる。 */
  version: number
  /** 「2024年3月15日 ご登録／銀座店」。 */
  registeredLabel: string
  /** ご住所の下の 1 行。「2026年8月13日 受付でお伺いしました」。無ければ空。 */
  addressNote: string
  /** 接客のメモの下の 1 行。「注意ごと 1件（金属アレルギー）」。 */
  noteSummary: string
}

/** 実行が拒まれたとき、下見のあとに何が変わったか。 */
export type MergeRejection = {
  changes: readonly string[]
}

/** 実行に渡す中身。契約の `CustomerMergeInput` と同じ形で親が送る。 */
export type MergeRequest = {
  primaryId: string
  secondaryId: string
  primaryVersion: number
  secondaryVersion: number
  fields: MergeFieldChoice[]
}

export type CustomerMergeProps = {
  primary: MergeSide
  secondary: MergeSide
  /**
   * 店長かどうか。**`role` ではなく選択中店舗の `StorePermission` で決める**
   * （`04-api.md` §2.2）。`canOpenMerge` の答えをそのまま渡す。
   */
  canManage: boolean
  loading?: boolean
  /** 下見そのものが取れなかったときの理由。 */
  error?: string | null
  /** 実行が拒まれたときの差分。 */
  rejection?: MergeRejection | null
  onMerge: (request: MergeRequest) => void
  onPreviewAgain: () => void
  onCancel: () => void
  /** 上のバーの「別の組み合わせ」。 */
  onSwap: () => void
}

/**
 * おまとめの入口を出してよいか。**一覧も詳細もこの述語 1 つで決める**
 * （AC-CUST-16 が「入口が画面のどこにも出ず」と要求するので、3 か所で書き分けない）。
 * `requireRole('admin')` は店長判定に使わない。
 */
export function canOpenMerge(permissions: readonly StorePermission[]): boolean {
  return permissions.includes('settings.manage')
}

/** 見比べ表の項目名。順序は `mergePreview` が返す順（お名前 → お電話番号 → ご住所 → 接客のメモ）。 */
const FIELD_LABELS: Record<string, string> = {
  name: 'お名前',
  phone: 'お電話番号',
  address: 'ご住所',
  notes: '接客のメモ',
}

const NO_VALUE = 'ご登録がありません'

/** 値の無い側を既定で残さない（モックの「ご住所　B を残します」がこれ）。 */
function initialChoice(field: string, primary: MergeSide, secondary: MergeSide): MergeChoice {
  if (field === 'notes') return 'both'
  const has = (side: MergeSide): boolean => (rawValue(field, side) ?? '') !== ''
  if (!has(primary) && has(secondary)) return 'secondary'
  return 'primary'
}

type MergeChoice = 'primary' | 'secondary' | 'both'

function rawValue(field: string, side: MergeSide): string | null {
  if (field === 'name') return side.name
  if (field === 'phone') return side.phoneNormalized
  if (field === 'address') return side.address
  return String(side.noteCount)
}

/** 値の見せ方。番号は区切りを入れ、件数は「7件」、無い側は「ご登録がありません」。 */
function displayOf(field: string, raw: string | null): string {
  if (raw === null || raw === '') return NO_VALUE
  if (field === 'phone') return formatPhoneDigits(raw)
  if (field === 'notes') return `${raw}件`
  return raw
}

/** 値の下の 1 行。側によって言うことが違う（ふりがな・同じ番号・伺った日・メモの内訳）。 */
function subOf(field: string, side: MergeSide, samePhone: boolean, isPrimary: boolean): string {
  if (field === 'name') return `ふりがな：${side.kana === '' ? NO_VALUE : side.kana}`
  if (field === 'phone') {
    if (!samePhone) return ''
    return isPrimary ? 'ご連絡の希望はこちら' : '同じ番号です'
  }
  if (field === 'address') return side.addressNote
  return side.noteSummary
}

function stateLabel(choice: MergeChoice): string {
  if (choice === 'both') return '両方を残します'
  return choice === 'primary' ? 'A を残します' : 'B を残します'
}

export function CustomerMerge({
  primary,
  secondary,
  canManage,
  loading = false,
  error = null,
  rejection = null,
  onMerge,
  onPreviewAgain,
  onCancel,
  onSwap,
}: CustomerMergeProps) {
  const [choices, setChoices] = useState<Record<string, MergeChoice>>(() => ({
    name: initialChoice('name', primary, secondary),
    phone: initialChoice('phone', primary, secondary),
    address: initialChoice('address', primary, secondary),
    notes: 'both',
  }))
  const [pending, setPending] = useState(false)
  // 拒まれて戻ってきたら、押した印を解いて下見からやり直せるようにする。
  const [seen, setSeen] = useState(rejection)
  if (seen !== rejection) {
    setSeen(rejection)
    setPending(false)
  }

  const samePhone =
    primary.phoneNormalized !== null && primary.phoneNormalized === secondary.phoneNormalized

  const asChoices: MergeFieldChoice[] = Object.entries(choices).map(([field, choice]) => ({
    field,
    choice,
  }))
  const preview = mergePreview(primary, secondary, asChoices)
  const fields: ResolvedMergeField[] = preview.ok ? preview.fields : []

  function merge() {
    if (pending) return
    setPending(true)
    onMerge({
      primaryId: primary.id,
      secondaryId: secondary.id,
      primaryVersion: primary.version,
      secondaryVersion: secondary.version,
      fields: fields.map((field) => ({ field: field.field, choice: field.choice })),
    })
  }

  return (
    <section className="flex h-full w-full min-h-0 flex-col bg-paper">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-line border-b bg-surface px-4">
        <h2 className="text-lead font-semibold text-ink">
          {`${primary.name} 様 が ふたつ登録されています`}
        </h2>
        {samePhone && (
          <span className="inline-flex min-h-5.5 items-center rounded-ctl border border-danger bg-danger-soft px-2 text-note font-semibold text-danger">
            お電話番号が同じ
          </span>
        )}
        <span className="text-grid text-ink-muted">残すほうを項目ごとにお選びください。</span>
        {/* 店長でない人には、別の組み合わせを探す入口も出さない。 */}
        {canManage && (
          <button
            type="button"
            onClick={onSwap}
            className={cn(
              'ml-auto min-h-11 rounded-card border border-line-strong bg-surface px-3.5 text-body font-semibold text-ink',
              focusRing,
            )}
          >
            別の組み合わせ
          </button>
        )}
      </div>

      {canManage ? (
        <div className="flex min-h-0 flex-1 gap-7 overflow-auto px-8 py-7">
          <div className="min-w-0 flex-1">
            {rejection !== null && (
              <div
                role="alert"
                className="mb-6 rounded-panel border border-danger bg-danger-soft px-7 py-5"
              >
                <p className="text-lead font-bold text-danger">まとめはまだ行っていません</p>
                <p className="mt-1.5 text-body text-ink">
                  下見をお出ししたあとに、どちらかの登録が動きました。
                </p>
                <ul className="mt-2.5 list-disc pl-4.5">
                  {rejection.changes.map((change) => (
                    <li key={change} className="text-grid leading-relaxed text-ink">
                      {change}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error !== null ? (
              <div
                role="alert"
                className="rounded-panel border border-danger bg-danger-soft px-7 py-5"
              >
                <p className="text-lead font-bold text-danger">下見をお出しできませんでした</p>
                <p className="mt-1.5 text-body text-ink">{error}</p>
              </div>
            ) : loading ? (
              <Skeleton />
            ) : (
              <Comparison
                primary={primary}
                secondary={secondary}
                fields={fields}
                samePhone={samePhone}
                onChoose={(field, choice) => setChoices((kept) => ({ ...kept, [field]: choice }))}
              />
            )}
          </div>

          <div className="w-75 shrink-0">
            {error === null && !loading && preview.ok && (
              <>
                <section
                  aria-label="まとめると、こうなります"
                  className="rounded-panel border border-pine-line bg-pine-soft px-5.5 py-5"
                >
                  <h3 className="text-body font-semibold text-pine-deep">
                    まとめると、こうなります
                  </h3>
                  <dl className="mt-4">
                    <Line label="お名前">{`${preview.result.name} 様`}</Line>
                    <Line label="お客様番号" mono>
                      {preview.result.customerNumber}
                    </Line>
                    <Line label="お電話番号" mono>
                      {displayOf('phone', preview.result.phone)}
                    </Line>
                    <Line label="ご住所">{resolvedDisplay(fields, 'address')}</Line>
                    <Line label="接客のメモ">{`${preview.noteCount}件`}</Line>
                  </dl>
                </section>

                <section
                  aria-label="ご注意"
                  className="mt-5 rounded-panel border border-danger bg-danger-soft px-5.5 py-5"
                >
                  <h3 className="text-body font-semibold text-danger">まとめると元に戻せません</h3>
                  <ul className="mt-2 list-disc pl-4.5">
                    <li className="text-grid leading-relaxed text-ink">
                      {'お客様番号 '}
                      <span className="font-mono">{preview.losingCustomerNumber}</span>
                      {' は使えなくなります。'}
                    </li>
                    <li className="text-grid leading-relaxed text-ink">
                      操作した者と日時は記録に残ります。
                    </li>
                  </ul>
                </section>
              </>
            )}

            <div className="mt-7 flex items-center gap-2.5">
              <button
                type="button"
                onClick={onCancel}
                className={cn(
                  'min-h-14 shrink-0 rounded-card border border-line-strong bg-surface px-4.5 text-body font-semibold text-ink',
                  focusRing,
                )}
              >
                やめる
              </button>
              {error !== null || rejection !== null ? (
                <button
                  type="button"
                  onClick={onPreviewAgain}
                  className={cn(
                    'min-h-14 flex-1 rounded-card border border-pine bg-pine text-lead font-bold text-on-pine',
                    focusRingOnPine,
                  )}
                >
                  もう一度下見する
                </button>
              ) : (
                !loading &&
                preview.ok && (
                  <button
                    type="button"
                    // 実行中も disabled にしない（フォーカスと文字色を保つ）。
                    aria-busy={pending}
                    aria-disabled={pending}
                    onClick={merge}
                    className={cn(
                      'min-h-14 flex-1 rounded-card border border-pine bg-pine text-lead font-bold text-on-pine',
                      focusRingOnPine,
                    )}
                  >
                    {pending ? 'まとめています…' : 'この内容でまとめる'}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-start px-8 py-7">
          <div className="rounded-panel border border-line-strong bg-surface px-7 py-6">
            <p className="text-lead font-bold text-ink">この操作は店長だけができます</p>
            <p className="mt-2 text-body text-ink-muted">
              おまとめは取り消せないので、営業時間を変えられる方だけが行えます。店長にお声がけください。
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

function resolvedDisplay(fields: ResolvedMergeField[], field: string): string {
  const found = fields.find((row) => row.field === field)
  return displayOf(field, found?.value ?? null)
}

function Line({
  label,
  mono = false,
  children,
}: {
  label: string
  mono?: boolean
  children: string
}) {
  return (
    <div className="mt-2.5 flex gap-3 first:mt-0">
      <dt className="w-19 shrink-0 text-grid text-ink-muted">{label}</dt>
      <dd className={cn('min-w-0 flex-1 text-body font-semibold text-ink', mono && 'font-mono')}>
        {children}
      </dd>
    </div>
  )
}

function Comparison({
  primary,
  secondary,
  fields,
  samePhone,
  onChoose,
}: {
  primary: MergeSide
  secondary: MergeSide
  fields: ResolvedMergeField[]
  samePhone: boolean
  onChoose: (field: string, choice: MergeChoice) => void
}) {
  return (
    <section aria-label="ふたつの登録の見比べ">
      <div className="flex border-line-strong border-b pb-3.5">
        <div className="flex w-27 shrink-0 items-end text-grid text-ink-muted">項目</div>
        <Head side="A" customer={primary} />
        <Head side="B" customer={secondary} />
      </div>

      {fields.map((field) => (
        <div
          key={field.field}
          role="radiogroup"
          aria-label={FIELD_LABELS[field.field] ?? field.field}
          className="flex min-h-24 border-line border-b"
        >
          <div className="w-27 shrink-0 pt-5">
            <b className="block text-body font-semibold text-ink">
              {FIELD_LABELS[field.field] ?? field.field}
            </b>
            <span className="mt-0.75 block text-grid text-ink-muted">
              {stateLabel(field.choice)}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 flex-1">
              <ValueBox
                field={field.field}
                raw={field.primaryValue}
                sub={subOf(field.field, primary, samePhone, true)}
                checked={field.choice === 'primary' || field.choice === 'both'}
                onSelect={() => onChoose(field.field, 'primary')}
              />
              <ValueBox
                field={field.field}
                raw={field.secondaryValue}
                sub={subOf(field.field, secondary, samePhone, false)}
                checked={field.choice === 'secondary' || field.choice === 'both'}
                onSelect={() => onChoose(field.field, 'secondary')}
              />
            </div>
            {/* 「両方を残します」は接客のメモにだけ置く（契約が 'both' をここにしか許さない）。 */}
            {field.field === 'notes' && (
              // biome-ignore lint/a11y/useSemanticElements: 選択肢は「印・値・補足」の 3 行を持つ面で、input 要素は子に持てない。
              <button
                type="button"
                role="radio"
                aria-checked={field.choice === 'both'}
                onClick={() => onChoose('notes', 'both')}
                className={cn(
                  'mx-1.5 mb-2.5 min-h-11 rounded-ctl border-2 px-3 text-left text-grid font-semibold',
                  field.choice === 'both'
                    ? 'border-pine bg-pine-soft text-pine-deep'
                    : 'border-line-strong bg-surface text-ink',
                  focusRing,
                )}
              >
                両方を残します
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}

function Head({ side, customer }: { side: string; customer: MergeSide }) {
  return (
    <div className="min-w-0 flex-1 px-2.5">
      <b className="block text-body font-semibold text-ink">
        {`${side}　`}
        <span className="font-mono">{customer.customerNumber}</span>
      </b>
      <span className="mt-0.75 block text-grid leading-normal text-ink-muted">
        {customer.registeredLabel}
      </span>
    </div>
  )
}

function ValueBox({
  field,
  raw,
  sub,
  checked,
  onSelect,
}: {
  field: string
  raw: string | null
  sub: string
  checked: boolean
  onSelect: () => void
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: 同上（値の枠そのものが 44pt 以上の押せる面である）。
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        'mx-1.5 my-2.5 min-h-11 min-w-0 flex-1 rounded-ctl border-2 px-3 py-2.5 text-left',
        checked ? 'border-pine bg-pine-soft' : 'border-transparent bg-transparent',
        focusRing,
      )}
    >
      <span
        className={cn(
          'block text-grid font-semibold',
          checked ? 'text-pine-deep' : 'text-ink-muted',
        )}
      >
        {checked ? '✓ 残す' : '残さない'}
      </span>
      <span
        data-testid="merge-value"
        className={cn(
          'mt-1 block text-body leading-snug',
          field === 'phone' && 'font-mono',
          checked ? 'font-semibold text-ink' : 'text-ink-faint line-through',
        )}
      >
        {displayOf(field, raw)}
      </span>
      {sub !== '' && <span className="mt-0.5 block text-grid text-ink-muted">{sub}</span>}
    </button>
  )
}

/** 下見を待つ間。行の高さを保った帯を置き、回るアイコンは置かない。 */
function Skeleton() {
  return (
    <div aria-hidden="true">
      {['name', 'phone', 'address', 'notes'].map((field) => (
        <div
          key={field}
          data-testid="merge-skeleton-row"
          className="flex min-h-24 items-center gap-3 border-line border-b"
        >
          <div className="h-5 w-27 shrink-0 rounded-ctl bg-surface-2" />
          <div className="h-14 min-w-0 flex-1 rounded-ctl bg-surface-2" />
          <div className="h-14 min-w-0 flex-1 rounded-ctl bg-surface-2" />
        </div>
      ))}
    </div>
  )
}
