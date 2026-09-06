/**
 * 業務端末の入口 `/s/:storeSlug` のルート判定。
 *
 * `react-router` は入れない。要るのは「前置きが `/s/` か」「slug は何か」の
 * 2 つだけで、お客様向けの `/w/` も `public/PublicBookingApp` が同じ流儀で
 * 捌いている（README「空いた場所を埋めるために要素を足さない」）。
 */
const PREFIX = '/s/'

export function siteSlugOf(path: string): string {
  if (!path.startsWith(PREFIX)) return ''
  return path.slice(PREFIX.length).split('/')[0] ?? ''
}

export function isSitePath(path: string): boolean {
  return siteSlugOf(path).length > 0
}
