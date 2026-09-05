import { auth } from '@app/shared'
import { useState } from 'react'
import { App } from '../App'
import { organizationOfToken, setSiteContext, storeTerminalSession } from '../client'
import { SiteEntry } from './SiteEntry'

/**
 * `/s/:storeSlug` の配線。
 *
 * 入口で暗証番号を通したら、その端末のまま業務画面へ入る。**画面遷移はしない**
 * —— URL を書き換えると、iPad のホーム画面に置いたブックマークから開き直したとき
 * どこへ戻るのかが曖昧になる。`/s/ginza` はこの端末の住所そのものである。
 */
export function SiteRoot({ slug }: { slug: string }) {
  const [started, setStarted] = useState(false)

  if (started) return <App />

  return (
    <SiteEntry
      slug={slug}
      onStarted={(token, terminalId, sessionToken) => {
        // 組織はトークンが名乗るものを使う。入口で人に入力させない。
        auth.setSession(token, organizationOfToken(token) ?? '')
        // 更新の宛先（住所と端末）を覚える。access が切れたら黙って取り直す。
        setSiteContext(slug, terminalId)
        storeTerminalSession(terminalId, sessionToken)
        setStarted(true)
      }}
    />
  )
}
