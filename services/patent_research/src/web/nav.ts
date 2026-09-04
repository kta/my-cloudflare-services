/*
 * 画面の切り替え。`react-router` は入れない — 要るのは
 * 「URL を進める / 戻る / 現在の場所を読む」だけで、`history.pushState` と
 * `popstate` で足りる（このリポジトリの既存サービスと同じ判断）。
 */

export type ScreenName =
  | 'matters'
  | 'intake'
  | 'elements'
  | 'search'
  | 'chart'
  | 'assessment'
  | 'graph'
  | 'draft'
  | 'jobs'
  | 'corpus'

export interface Route {
  screen: ScreenName
  matterId: string | null
}

const MATTER_SCREENS: ScreenName[] = [
  'intake',
  'elements',
  'search',
  'chart',
  'assessment',
  'graph',
  'draft',
]

/** 案件を選んでいないと開けない画面か。 */
export function needsMatter(screen: ScreenName): boolean {
  return MATTER_SCREENS.includes(screen)
}

export function routeToPath(route: Route): string {
  if (route.matterId && needsMatter(route.screen)) {
    return `/m/${route.matterId}/${route.screen}`
  }
  return `/${route.screen}`
}

export function parsePath(pathname: string): Route {
  const parts = pathname.split('/').filter((p) => p.length > 0)
  if (parts[0] === 'm' && parts[1]) {
    const screen = (parts[2] ?? 'chart') as ScreenName
    return { screen: needsMatter(screen) ? screen : 'chart', matterId: parts[1] }
  }
  const screen = (parts[0] ?? 'matters') as ScreenName
  const known: ScreenName[] = [...MATTER_SCREENS, 'matters', 'jobs', 'corpus']
  return { screen: known.includes(screen) ? screen : 'matters', matterId: null }
}

export function pushRoute(route: Route): void {
  const path = routeToPath(route)
  if (globalThis.location.pathname !== path) {
    globalThis.history.pushState(null, '', path)
  }
}
