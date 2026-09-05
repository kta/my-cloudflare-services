import type { TerminalSession } from '@app/contracts'
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
  const [session, setSession] = useState<TerminalSession | null>(null)

  /*
   * **開いたセッションをそのまま業務画面へ渡す。**
   * 渡さないと、業務画面が自分の開始フロー（端末の使い方 → 置き場所 → 暗証番号）を
   * もう一度出す —— 入口を通ったのに、また同じことを聞かれることになる。
   */
  if (session !== null) {
    // 終業したら入口へ戻す（この面が置き場所の選択を持っている）。
    return <App initialSession={session} onExit={() => setSession(null)} />
  }

  return (
    <SiteEntry
      slug={slug}
      onStarted={(token, started) => {
        // 組織はトークンが名乗るものを使う。入口で人に入力させない。
        auth.setSession(token, organizationOfToken(token) ?? '')
        // 更新の宛先（住所と端末）を覚える。access が切れたら黙って取り直す。
        setSiteContext(slug, started.terminalId)
        storeTerminalSession(started.terminalId, started.sessionToken)
        setSession(started)
      }}
    />
  )
}
