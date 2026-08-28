import type { StaffLocation } from './staff-navigation'

/*
 * 76px の緑バーの中身は面ごとに違う。承認済みモックの実測がここでの正である。
 *
 * - `staff-approved.html` の #ledger / #journey / #search / #customer は、
 *   タブの本数も主操作の文言も面ごとに違う（来店受付の主操作は「予約を取る」
 *   ではなく「店頭のお客様を受付」）。
 * - `operations-approved.html` は管理タブをバーの中に持つ。2 本目の緑帯は無い。
 * - 予約フローと設定ガイドはバーに操作を持たない。副題だけが今どこかを名乗る。
 */

export type BarSpec = {
  /** `home` だけが お知らせ / アラート / 設定 の 3 つを出す。 */
  kind: 'home' | 'business' | 'admin' | 'plain'
  /** ワードマークの 2 行目。 */
  subtitle: string
  /* バーは行き先を持たない。移動はすべて左サイドバーが担う。 */
  tabs: never[]
  primary?: { label: string; to: StaffLocation }
}

type StoreSummary = { name: string; isActive: boolean }

/*
 * 運用の面の副題は承認済みモック `operations-approved.html` のバーそのもの。
 * 8 面をひとまとめに「設定」と名乗ると、監査ログ・注意事項の確認・端末の一覧が
 * バーの上では見分けられない同じ面になる。
 *
 * 組織共通の面（注意事項の権限・監査ログ）だけ店舗名を持たない。店舗名を足すと
 * 「この店舗の監査」と読めてしまい、実際に見えている範囲より狭く伝わる。
 * ここに無い面はモックどおり `<店舗> · 設定` のまま。
 */
const OPERATION_SUBTITLES: Partial<Record<StaffLocation['screen'], (name: string) => string>> = {
  'attention-review': (name) => `${name} · 注意事項`,
  'attention-settings': () => '組織共通設定',
  audit: () => '監査',
}

/** 運用面の管理タブ。モック `operations-approved.html` の 3 つと、その順序。 */
const OPERATION_SCREENS = new Set<StaffLocation['screen']>([
  'shared-terminals',
  'audit',
  'recording-ops',
  'attention-settings',
  'attention-review',
  'customer-merge',
  'analytics',
  'alerts',
])

export function barFor(location: StaffLocation, store: StoreSummary): BarSpec {
  const name = store.name

  switch (location.screen) {
    case 'home':
      return {
        kind: 'home',
        subtitle: `${name} · ${store.isActive ? '営業中' : '受付停止'}`,
        tabs: [],
      }
    case 'booking':
      return { kind: 'plain', subtitle: `${name} · 新規予約`, tabs: [] }
    case 'settings':
      /*
       * 承認済みモックが 2 つあり、バーの中身が食い違っている。
       * `settings-complete-approved.html` はワードマークだけ、
       * `settings-approved.html` は `設定ガイド / 設定一覧 / 変更履歴` の 3 つ。
       * 操作を 1 つも持たない側を採ると、ガイドに入った利用者が出られなくなる
       * （2 本目の帯を作らない以上、他の入口はここにしかない）ので、タブを持つ
       * 側に従う。運用系の 8 つの入口は `設定一覧` の先にある。
       */
      return {
        kind: 'admin',
        subtitle: `${name} · 設定ガイド`,
        tabs: [],
      }
    case 'ledger':
      return {
        kind: 'business',
        subtitle: `${name} · ${store.isActive ? '営業中' : '受付停止'}`,
        tabs: [],
        primary: { label: '＋ 予約を取る', to: { screen: 'booking' } },
      }
    case 'journey':
      return {
        kind: 'business',
        subtitle: `${name} · 来店受付`,
        tabs: [],
        // 店頭に立っているお客様を通す面なので、主操作は予約ではない。
        primary: { label: '＋ 店頭のお客様を受付', to: { screen: 'journey' } },
      }
    case 'reception-history':
      /*
       * `reception-history-approved.html` のバーは `予約台帳 / 受付履歴 /
       * 予約検索` の 3 本。来店受付と顧客台帳はここには無く、予約台帳から辿る。
       */
      return {
        kind: 'business',
        subtitle: `${name} · 受付履歴`,
        tabs: [],
        // 履歴を見ている最中に「では予約を」と言われる面なので、主操作を持つ。
        primary: { label: '＋ 予約を取る', to: { screen: 'booking' } },
      }
    case 'reservation-search':
      return {
        kind: 'business',
        subtitle: `${name} · 検索対象店舗`,
        tabs: [],
        // 検索して見つからなかったときの続きが「取る」なので、ここにも置く。
        primary: { label: '＋ 予約を取る', to: { screen: 'booking' } },
      }
    case 'customers':
      /*
       * 基準画像 `ref--CUSTOMER-CURRENT.png` の緑バーは右肩に `＋ 予約を取る`
       * を持つ。お客様の記録を読みながら「では予約を」と言われる面なので、
       * ここで主操作を落とすと台帳へ戻らないと予約が取れない。
       */
      return {
        kind: 'business',
        subtitle: `${name} · 顧客台帳`,
        tabs: [],
        primary: { label: '＋ 予約を取る', to: { screen: 'booking' } },
      }
    case 'reservation-detail':
      return { kind: 'plain', subtitle: `${name} · 予約`, tabs: [] }
    default:
      break
  }

  if (OPERATION_SCREENS.has(location.screen))
    return {
      kind: 'admin',
      subtitle: OPERATION_SUBTITLES[location.screen]?.(name) ?? `${name} · 設定`,
      tabs: [],
    }

  return { kind: 'plain', subtitle: `${name} · 営業中`, tabs: [] }
}

/* ------------------------------------------------------------------ *
 * 全画面共通の左サイドバー
 * ------------------------------------------------------------------ */

/*
 * 承認済みモックは、面の行き来を緑バーのタブと各面の左サイドに分けて持たせて
 * いる。その形は面ごとにタブの並びが変わり、同じ面が 2 つの名で呼ばれ、
 * 深いものは 3 階層辿らないと出てこない（分析・お知らせ）。実際に到達できない
 * 面が生まれもした。
 *
 * そこで、行き先はすべて 1 本の左サイドバーに集める。250px の左サイドは元から
 * 設定・運用の面が持っていた形なので、見た目の語彙は増えない。緑バーは店舗と
 * 主操作だけを持つ。モックからの意図的な逸脱で、理由は `docs/frontend/REBUILD.md`
 * に残す。
 */

type SidebarItem = { label: string; to: StaffLocation }
export type SidebarGroup = { label: string; items: SidebarItem[] }

export function sidebarFor(today: string | undefined): SidebarGroup[] {
  return [
    {
      label: '業務',
      items: [
        { label: '予約台帳', to: { screen: 'ledger', date: today ?? '' } },
        { label: '来店受付', to: { screen: 'journey' } },
        { label: '受付履歴', to: { screen: 'reception-history' } },
        { label: '予約検索', to: { screen: 'reservation-search' } },
        { label: '顧客台帳', to: { screen: 'customers' } },
      ],
    },
    {
      label: '設定・運用',
      items: [
        { label: '設定ガイド', to: { screen: 'settings' } },
        { label: '共有端末', to: { screen: 'shared-terminals' } },
        { label: '録音運用', to: { screen: 'recording-ops' } },
        { label: '注意事項', to: { screen: 'attention-settings' } },
        { label: '監査ログ', to: { screen: 'audit' } },
        { label: '顧客の統合・訂正', to: { screen: 'customer-merge' } },
        { label: '分析', to: { screen: 'analytics' } },
        { label: 'お知らせ', to: { screen: 'alerts' } },
      ],
    },
  ]
}

/**
 * 開いている面が、柱のどの行き先に属するか。
 *
 * 現在地を面の名前の一致だけで決めると、柱に行き先を持たない面（注意事項の
 * 確認・予約の詳細）へ入った瞬間にどの行も光らなくなり、「今どこにいるか」が
 * 読めなくなる。そういう面は親の行き先へ帰着させる。
 */
const SIDEBAR_PARENT: Partial<Record<StaffLocation['screen'], StaffLocation['screen']>> = {
  // 注意事項の確認は、権限設定の面から辿る同じ話の続きである。
  'attention-review': 'attention-settings',
  // 予約 1 件の詳細は台帳の中の 1 行を開いた姿である。
  'reservation-detail': 'ledger',
}

export function sidebarCurrentScreen(location: StaffLocation): StaffLocation['screen'] {
  return SIDEBAR_PARENT[location.screen] ?? location.screen
}

/* ------------------------------------------------------------------ *
 * 面からバーへ書き込む値
 * ------------------------------------------------------------------ */

/**
 * モックのバーは、予約フローでは工程に応じて右のチップと副題が変わる
 * (`BOOK-TIME` の `8月27日`、`BOOK-REPEAT` の `銀座店 · 最終確認` かつチップ無し)。
 * 面が持つ下書きに依存する値なので、`barFor` では決められない。面が書き、
 * バーが読む小さな置き場をひとつだけ用意する。
 */
type BarOverlay = { chip?: string; subtitle?: string }

function createBarOverlay() {
  let current: BarOverlay = {}
  const listeners = new Set<() => void>()
  return {
    snapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next: BarOverlay) {
      // 同じ値で起こすと、面の描画ごとにバーが揺れる。
      if (next.chip === current.chip && next.subtitle === current.subtitle) return
      current = next
      for (const listener of listeners) listener()
    },
  }
}

export const barOverlay = createBarOverlay()

/**
 * 緑バーの主操作が「移動」ではなく「その面での行い」であることがある。
 * 来店受付の `＋ 店頭のお客様を受付` は、店頭に立っているお客様をその場で
 * 起こす操作であって、来店受付へ移動する操作ではない（すでにその面にいる）。
 *
 * モックの主操作はバーの中にひとつだけなので、面の中にもう 1 枚同じボタンを
 * 置くと段が増え、同じ操作が 2 か所に見える。何を行うかは面しか知らないので、
 * overlay と同じく面が書き、バーは押された瞬間に読む（読むのが押した時だけ
 * なので、購読も再描画も要らない）。
 */
function createBarPrimaryAction() {
  let current: (() => void) | undefined
  return {
    snapshot: () => current,
    /** 面が書く。戻り値を呼ぶと自分が書いたものだけを取り下げる。 */
    set(next: () => void) {
      current = next
      return () => {
        if (current === next) current = undefined
      }
    },
  }
}

export const barPrimaryAction = createBarPrimaryAction()

/* ------------------------------------------------------------------ *
 * 面からサイドバーへ書き込む節
 * ------------------------------------------------------------------ */

/**
 * 開いている面の中の節（`operations-approved.html` の `.side` が並べていたもの）。
 *
 * 250px の柱を面ごとに 2 本立てると、本文が半分になってしまう。柱は 1 本に
 * して、その面の節は開いている行き先の下へ入れる。どの節を出すかは面しか
 * 知らないので、面が書きサイドバーが読む。
 */
export type ScreenSection = {
  label: string
  to?: StaffLocation
  current?: boolean
  /**
   * 読み上げ上の名前。柱に出る字は工程の番号と名前だけなので、「完了 / 編集中」
   * のような状態語はここへ持たせる（色に頼らず語で伝える）。
   */
  name?: string
  /**
   * 押すと同じ面の中で見る対象が変わる節（設定の工程・分析の観点）。何をするかは
   * 面しか知らないので、押されたことだけを `select` で面へ返す。
   */
  selectable?: boolean
}

function createSectionStore() {
  let current: ScreenSection[] = []
  /*
   * 節を押したときの処理は面が持つ。値として節に混ぜると、同じ並びのときに
   * 古い関数が残る（`same` が真になり書き換えないため）。比較する値とは別の
   * 場所に、購読者を起こさずに毎回上書きして持つ。
   */
  let handler: ((label: string) => void) | undefined
  const listeners = new Set<() => void>()
  const same = (next: ScreenSection[]) =>
    next.length === current.length &&
    next.every(
      (section, index) =>
        section.label === current[index]?.label &&
        section.current === current[index]?.current &&
        section.name === current[index]?.name &&
        section.selectable === current[index]?.selectable &&
        section.to?.screen === current[index]?.to?.screen,
    )
  return {
    snapshot: () => current,
    bindSelect(next: ((label: string) => void) | undefined) {
      handler = next
    },
    select(label: string) {
      handler?.(label)
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next: ScreenSection[]) {
      // 同じ並びで起こすと、面の描画ごとに柱が揺れる。
      if (same(next)) return
      current = next
      for (const listener of listeners) listener()
    },
  }
}

export const screenSections = createSectionStore()

