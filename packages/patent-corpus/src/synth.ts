/*
 * 合成コーパス。実データ（媒体で受領するバルクデータ）が未着でも全機能を作り切るために要る。
 *
 * 決定的であること（seed が同じなら完全に同じ結果）が回帰テストの前提である。
 * 実データ到着後もこれは捨てない — 実データを使わずに検索・照合・画面の回帰を確認できる
 * 唯一の手段であり、公報の本文を CI に持ち込まずに済む。
 */

export type Section = 'claim' | 'desc' | 'abstract'

export interface CorpusParagraph {
  paraNo: string
  section: Section
  text: string
}

export interface CorpusPublication {
  pubNumber: string
  country: string
  kind: string
  appNumber: string | null
  filingDate: string | null
  pubDate: string | null
  regDate: string | null
  title: string
  applicants: string[]
  inventors: string[]
  ipc: string[]
  fi: string[]
  fterm: string[]
  abstract: string | null
  pdfPath: string | null
}

export interface SynthesizedPublication {
  publication: CorpusPublication
  paragraphs: CorpusParagraph[]
}

export interface SynthOptions {
  count: number
  seed: number
  ipc?: string[]
  pubDateFrom?: string
  pubDateTo?: string
  /**
   * 1 公報あたりの明細書段落の目安。既定は実際の日本語特許公報に近い分量にしてある
   * （ソフトウェア分野の公開特許公報は 1 万文字前後・数十段落が一般的）。
   * 見積り（docs/patent/BUDGET.md）を CLI で再現できるようにするための既定値である。
   */
  descParagraphs?: number
  /** 1 段落あたりの文の目安。 */
  sentencesPerParagraph?: number
}

/** mulberry32。小さく、決定的で、依存が無い。 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NOUNS = [
  '撮像部',
  '瞳孔',
  '中心座標',
  '眼部画像',
  '輝度勾配',
  '円形状検出',
  '赤外光',
  '暗瞳孔法',
  '視線ベクトル',
  '累進屈折力レンズ',
  '加入度',
  '処方データ',
  '制御部',
  '記憶部',
  '通信部',
  '判定閾値',
  '学習モデル',
  '特徴量',
  '半導体基板',
  '電極',
  '樹脂層',
  '較正パラメータ',
  '角度補正',
  '利用者端末',
  '記録媒体',
  '推論結果',
  '前眼部',
  '角膜反射',
  '装用者',
]
const VERBS = [
  '算出する',
  '検出する',
  '抽出する',
  '決定する',
  '出力する',
  '記憶する',
  '補正する',
  '判定する',
]
const IPC_POOL = [
  'G06F3/01',
  'G06T7/00',
  'G06V10/70',
  'G02C13/00',
  'A61B3/113',
  'G06N3/08',
  'H01L21/02',
]
const APPLICANTS = [
  '株式会社ニコン・エシロール',
  'キヤノン株式会社',
  '株式会社トプコン',
  'セイコーエプソン株式会社',
  '国立大学法人東京大学',
  'パナソニックホールディングス株式会社',
]
const INVENTORS = ['田中一郎', '佐藤花子', '鈴木次郎', '高橋三郎', '伊藤四郎']

/** 実データに近い分量の既定値（BUDGET.md の見積りはこの値で測る）。 */
const DEFAULT_DESC_PARAGRAPHS = 60
const DEFAULT_SENTENCES = 4

const DEFAULT_FROM = '2010-01-01'
const DEFAULT_TO = '2024-12-31'
const MS_PER_DAY = 86_400_000

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)] as T
}

function dateBetween(r: () => number, from: string, to: string): string {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  const days = Math.floor((b - a) / MS_PER_DAY)
  const d = new Date(a + Math.floor(r() * (days + 1)) * MS_PER_DAY)
  return d.toISOString().slice(0, 10)
}

function sentence(r: () => number): string {
  const a = pick(r, NOUNS)
  const b = pick(r, NOUNS)
  const c = pick(r, NOUNS)
  const v = pick(r, VERBS)
  return `前記${a}は、${b}に基づいて${c}を${v}。`
}

export function synthesizePublications(options: SynthOptions): SynthesizedPublication[] {
  const {
    count,
    seed,
    ipc,
    pubDateFrom = DEFAULT_FROM,
    pubDateTo = DEFAULT_TO,
    descParagraphs = DEFAULT_DESC_PARAGRAPHS,
    sentencesPerParagraph = DEFAULT_SENTENCES,
  } = options
  const r = rng(seed)
  const out: SynthesizedPublication[] = []

  for (let i = 0; i < count; i++) {
    const pubDate = dateBetween(r, pubDateFrom, pubDateTo)
    const year = pubDate.slice(0, 4)
    // 連番を含めるので、同一 seed の中で公報番号が衝突しない。
    const pubNumber = `特開${year}-${String(100000 + i).padStart(6, '0')}`
    const codes =
      ipc ?? [pick(r, IPC_POOL), pick(r, IPC_POOL)].filter((v, idx, arr) => arr.indexOf(v) === idx)

    const claimCount = 1 + Math.floor(r() * 4)
    const paragraphs: CorpusParagraph[] = []
    for (let c = 0; c < claimCount; c++) {
      const head = c === 0 ? '' : `請求項${c}に記載の装置であって、`
      paragraphs.push({
        paraNo: `C${String(c + 1).padStart(3, '0')}`,
        section: 'claim',
        text: `${head}${pick(r, NOUNS)}と、${pick(r, NOUNS)}とを備え、${sentence(r)}装置。`,
      })
    }
    // 段落数と 1 段落の文数は既定値の ±50% の範囲でばらつかせる（実データの分布に近づける）。
    const descCount = Math.max(1, Math.round(descParagraphs * (0.5 + r())))
    for (let d = 0; d < descCount; d++) {
      const lines = Math.max(1, Math.round(sentencesPerParagraph * (0.5 + r())))
      let text = ''
      for (let l = 0; l < lines; l++) text += sentence(r)
      paragraphs.push({ paraNo: String(d + 1).padStart(4, '0'), section: 'desc', text })
    }

    out.push({
      publication: {
        pubNumber,
        country: 'JP',
        kind: 'A',
        appNumber: `特願${Number(year) - 1}-${String(20000 + i).padStart(6, '0')}`,
        filingDate: dateBetween(r, pubDateFrom, pubDate),
        pubDate,
        regDate: null,
        title: `${pick(r, NOUNS)}を用いた${pick(r, NOUNS)}の${pick(r, ['検出装置', '推定方法', '制御システム', '生成装置'])}`,
        applicants: [pick(r, APPLICANTS)],
        inventors: [pick(r, INVENTORS)],
        ipc: codes,
        fi: codes.map((c) => `${c},${String(100 + Math.floor(r() * 900))}A`),
        fterm: [`5B${String(Math.floor(r() * 900) + 100)}AA00`],
        abstract: sentence(r),
        pdfPath: `/synthetic/${year}/${pubNumber}.pdf`,
      },
      paragraphs,
    })
  }
  return out
}
