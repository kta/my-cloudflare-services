import './app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { isPublicPath, publicFlowOf, publicStoreSlug } from './public/PublicBookingApp'
import { PublicBookingRoot } from './public/PublicBookingRoot'
import { SiteRoot } from './site/SiteRoot'
import { isSitePath, siteSlugOf } from './site/siteRoute'

const root = document.getElementById('root')
if (!root) throw new Error('root element not found')

/*
 * 入口の振り分け。`/w/**` はお客様のご予約ページ（未認証。iPhone 390×844）、
 * `/s/**` は業務端末の入口（未認証。置き場所と暗証番号だけ）、
 * それ以外は業務画面である。`react-router` は入れない —— ここで要るのは
 * 「前置きは何か」「slug は何か」の 2 つだけで、工程の戻りは
 * `PublicBookingApp` の `history.pushState` / `popstate` が持っている。
 */
const path = window.location.pathname

createRoot(root).render(
  <StrictMode>
    {isPublicPath(path) ? (
      <PublicBookingRoot slug={publicStoreSlug(path)} flow={publicFlowOf(path)} />
    ) : isSitePath(path) ? (
      <SiteRoot slug={siteSlugOf(path)} />
    ) : (
      <App />
    )}
  </StrictMode>,
)
