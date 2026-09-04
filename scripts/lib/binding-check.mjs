/**
 * wrangler 設定のバインディングと Terraform 出力を突き合わせる。
 *
 * 環境を取り違えて別のリソースへ書きに行く事故は、成功してしまうので気づけない。
 * デプロイの前とマイグレーションの直前の 2 箇所でこの関数を通す。
 */

/** サービスごとの「バインディング ↔ Terraform 出力名」。新しい binding を足したらここに 1 行足す。 */
export const BINDING_MAP = {
  admin: [
    { kind: 'd1', binding: 'DB', output: 'admin_d1_database_id' },
    { kind: 'kv', binding: 'AUTH_RL', output: 'auth_rl_kv_namespace_id' },
  ],
  glasses_management: [
    { kind: 'd1', binding: 'DB', output: 'glasses_management_d1_database_id' },
    {
      kind: 'kv',
      binding: 'SHORT_LIVED',
      output: 'glasses_management_short_lived_kv_namespace_id',
    },
    { kind: 'r2', binding: 'RECORDINGS', output: 'glasses_management_recordings_bucket_name' },
  ],
  notifier: [{ kind: 'kv', binding: 'DEDUPE', output: 'notifier_dedupe_kv_namespace_id' }],
}

/** Terraform を通していない雛形値。`00000000-…` は wrangler.jsonc の placeholder。 */
function isPlaceholder(value) {
  return typeof value === 'string' && value.length > 0 && /^[0-]+$/.test(value)
}

function actualValue(kind, entry) {
  if (kind === 'd1') return entry.database_id
  if (kind === 'kv') return entry.id
  return entry.bucket_name
}

function findEntry(kind, resolved, binding) {
  const list = kind === 'd1' ? resolved.d1 : kind === 'kv' ? resolved.kv : resolved.r2
  return list.find((e) => e.binding === binding)
}

export function checkBindings({ service, resolved, tfOutputs }) {
  const map = BINDING_MAP[service]
  if (!map) return { ok: false, errors: [`未知のサービス: ${service}`] }
  const errors = []
  for (const { kind, binding, output } of map) {
    const entry = findEntry(kind, resolved, binding)
    if (!entry) {
      errors.push(`${service}: バインディング ${binding} が wrangler 設定にありません`)
      continue
    }
    const actual = actualValue(kind, entry)
    if (isPlaceholder(actual)) {
      errors.push(
        `${service}: ${binding} が placeholder のままです (${actual})。Terraform 出力 ${output} の実値に差し替えてください`,
      )
      continue
    }
    const expected = tfOutputs[output]?.value
    if (expected === undefined) {
      errors.push(`${service}: Terraform 出力に ${output} がありません`)
      continue
    }
    if (actual !== expected) {
      errors.push(
        `${service}: ${binding} が Terraform 出力と一致しません (wrangler=${actual} / terraform=${expected} / output=${output})`,
      )
    }
  }
  return { ok: errors.length === 0, errors }
}

export function planD1Migration({ service, resolved, tfOutputs, envName }) {
  const { ok, errors } = checkBindings({ service, resolved, tfOutputs })
  if (!ok) throw new Error(errors.join('\n'))
  const db = resolved.d1.find((e) => e.binding === 'DB')
  if (!db) throw new Error(`${service}: DB バインディングがありません`)
  const args = ['d1', 'migrations', 'apply', db.database_name, '--remote']
  if (envName) args.push('--env', envName)
  return { databaseName: db.database_name, args }
}
