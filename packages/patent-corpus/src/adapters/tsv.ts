/*
 * TSV（特許情報標準データ形式）から書誌を読む。
 *
 * **列名は未確認である。** 特許庁の一次情報で「特許情報標準データは TSV で提供され、
 * 出願マスタ・サーチマスタ等 16 種に分かれる」ことは確認できたが、各マスタの列名は
 * 提供データ一覧（xlsx）が機械では取得できず確認できなかった。
 *
 * だからマッピングを **コードではなくデータ** として外に出してある。実データが届いたら
 * `corpus probe` で実際のヘッダを見て、マッピングを差し替えるだけで動く。
 * 推測した既定値には `unverified: true` を立て、UI と CLI が「これは未確認の仮置き」と
 * 表示できるようにしている。
 */

import type { CorpusPublication } from '../synth.ts'

export interface TsvMapping {
  pubNumber: string
  appNumber?: string
  filingDate?: string
  pubDate?: string
  regDate?: string
  title?: string
  applicants?: string
  inventors?: string
  ipc?: string
  fi?: string
  fterm?: string
  abstract?: string
  kind?: string
  /** 複数値の区切り。既定は `;`。 */
  multiValueSeparator?: string
  /** この列名の対応が一次情報で未確認であることの目印。 */
  unverified?: boolean
}

/**
 * 仮置きの既定マッピング。**一次情報で未確認**なので `unverified` を立てている。
 * 実データ到着後に `corpus probe` の出力を見て確定させる。
 */
export const DEFAULT_TSV_MAPPING: TsvMapping = {
  pubNumber: '公開番号',
  appNumber: '出願番号',
  filingDate: '出願日',
  pubDate: '公開日',
  regDate: '登録日',
  title: '発明の名称',
  applicants: '出願人氏名',
  inventors: '発明者氏名',
  ipc: 'IPC',
  fi: 'FI',
  fterm: 'Fターム',
  abstract: '要約',
  unverified: true,
}

const YYYYMMDD = /^(\d{4})(\d{2})(\d{2})$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** 特許庁のデータは `YYYYMMDD` が多いが、`YYYY-MM-DD` も来得る。読めない値は null。 */
export function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (ISO_DATE.test(s)) return s
  const m = YYYYMMDD.exec(s)
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}`
  // 2018-02-30 のような存在しない日付を通さない。
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso
}

function splitMulti(raw: string | undefined, sep: string): string[] {
  if (!raw) return []
  return raw
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function parseTsv(content: string, mapping: TsvMapping): CorpusPublication[] {
  const sep = mapping.multiValueSeparator ?? ';'
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0)
  const header = lines.shift()
  if (header === undefined) return []
  const columns = header.split('\t').map((h) => h.trim())
  const at = (name: string | undefined): number => (name ? columns.indexOf(name) : -1)

  const pubIndex = at(mapping.pubNumber)
  if (pubIndex < 0) {
    // 黙って空を返すと「該当なし」と誤読される。列名の食い違いは必ず声を上げる。
    throw new Error(
      `TSV に必須の列 "${mapping.pubNumber}" が無い。実際のヘッダ: ${columns.join(', ')}`,
    )
  }

  const idx = {
    appNumber: at(mapping.appNumber),
    filingDate: at(mapping.filingDate),
    pubDate: at(mapping.pubDate),
    regDate: at(mapping.regDate),
    title: at(mapping.title),
    applicants: at(mapping.applicants),
    inventors: at(mapping.inventors),
    ipc: at(mapping.ipc),
    fi: at(mapping.fi),
    fterm: at(mapping.fterm),
    abstract: at(mapping.abstract),
    kind: at(mapping.kind),
  }
  const cell = (cells: string[], i: number): string | undefined =>
    i >= 0 ? cells[i]?.trim() : undefined

  const out: CorpusPublication[] = []
  for (const line of lines) {
    const cells = line.split('\t')
    const pubNumber = cells[pubIndex]?.trim()
    if (!pubNumber) continue
    out.push({
      pubNumber,
      country: 'JP',
      kind: cell(cells, idx.kind) ?? 'A',
      appNumber: cell(cells, idx.appNumber) ?? null,
      filingDate: normalizeDate(cell(cells, idx.filingDate)),
      pubDate: normalizeDate(cell(cells, idx.pubDate)),
      regDate: normalizeDate(cell(cells, idx.regDate)),
      title: cell(cells, idx.title) ?? '',
      applicants: splitMulti(cell(cells, idx.applicants), sep),
      inventors: splitMulti(cell(cells, idx.inventors), sep),
      ipc: splitMulti(cell(cells, idx.ipc), sep),
      fi: splitMulti(cell(cells, idx.fi), sep),
      fterm: splitMulti(cell(cells, idx.fterm), sep),
      abstract: cell(cells, idx.abstract) ?? null,
      pdfPath: null,
    })
  }
  return out
}
