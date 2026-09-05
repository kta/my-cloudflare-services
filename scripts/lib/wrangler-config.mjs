/**
 * `wrangler.jsonc` を読み、指定した環境の実効バインディングを返す。
 *
 * デプロイ先の D1 をここで解決する。文字列リテラルの中の `//` をコメントと
 * 誤認すると宛先が変わりうるので、パーサは素朴な走査で厳密に書く。
 */
import { readFileSync } from 'node:fs'

/** jsonc → json。文字列リテラルとエスケープを尊重してコメントと末尾カンマを落とす。 */
export function stripJsonc(source) {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]
    if (inLine) {
      if (ch === '\n') {
        inLine = false
        out += ch
      }
      continue
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false
        i++
      }
      continue
    }
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i++
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      inLine = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      inBlock = true
      i++
      continue
    }
    out += ch
  }
  // 末尾カンマ(`,` の後に空白を挟んで `}` か `]`)を落とす。
  return out.replace(/,(\s*[}\]])/g, '$1')
}

export function parseWranglerConfig(source) {
  return JSON.parse(stripJsonc(source))
}

export function readWranglerConfig(path) {
  return parseWranglerConfig(readFileSync(path, 'utf8'))
}

/**
 * 環境の実効バインディング。wrangler の非継承キーは環境ごとに全部書き下ろす
 * 決まりなので、上位にあって環境に無いキーは「書き落とし」として失敗させる。
 */
export function resolveEnv(config, envName) {
  const name = envName || ''
  const source = name ? config.env?.[name] : config
  if (name && !source) {
    throw new Error(`wrangler 設定に env.${name} がありません`)
  }
  if (name) {
    for (const key of ['d1_databases', 'kv_namespaces', 'r2_buckets']) {
      if (Array.isArray(config[key]) && config[key].length > 0 && !source[key]) {
        throw new Error(
          `env.${name} に ${key} がありません(wrangler の非継承キーは環境ごとに書き下ろす必要があります)`,
        )
      }
    }
  }
  return {
    workerName: name ? `${config.name}-${name}` : config.name,
    d1: source.d1_databases ?? [],
    kv: source.kv_namespaces ?? [],
    r2: source.r2_buckets ?? [],
    services: source.services ?? [],
    crons: source.triggers?.crons ?? [],
  }
}

/**
 * seed の宛先 D1。`CLOUDFLARE_ENV` の環境の `DB` バインディングを解決し、
 * wrangler へ渡す `--env` もここで組む。
 *
 * DB 名を seed に直書きすると、staging の seed が本番の D1 へ当たる。
 * `INSERT OR IGNORE` は宛先を間違えても静かに成功するので、事故に気づけない。
 * 宛先の決め方は 1 か所に閉じ、seed 側では選ばせない。
 */
export function resolveSeedTarget(config, envName) {
  const name = envName || ''
  const db = resolveEnv(config, name).d1.find((d) => d.binding === 'DB')
  if (!db) {
    throw new Error(`wrangler 設定(${name || '上位'})に DB バインディングがありません`)
  }
  return { dbName: db.database_name, envArgs: name ? ['--env', name] : [] }
}
