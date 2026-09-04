import { auth } from '@app/shared'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { ApiError, api } from './api'
import { needsMatter, parsePath, pushRoute, type Route, type ScreenName } from './nav'
import { AssessmentScreen } from './screens/AssessmentScreen'
import { ChartScreen } from './screens/ChartScreen'
import { CorpusScreen } from './screens/CorpusScreen'
import { DraftScreen } from './screens/DraftScreen'
import { ElementsScreen } from './screens/ElementsScreen'
import { GraphScreen } from './screens/GraphScreen'
import { IntakeScreen } from './screens/IntakeScreen'
import { JobsScreen } from './screens/JobsScreen'
import { MattersScreen } from './screens/MattersScreen'
import { SearchScreen } from './screens/SearchScreen'
import { Button, Field, Notice, Panel, TextInput } from './ui/parts'

/*
 * 典拠（Tenkyo）— 弁理士および自己出願する発明者の作業机。
 *
 * 見た目の題材は「特許事務所の出願台帳と検印」（承認済みモック
 * docs/frontend/mockups/patent_research/direction-c.html）。1 行 = 1 つの典拠で、
 * 行頭に必ず検印（済・未・却）が押される。**支持の根拠になるのは「済」の行だけ**である。
 *
 * この製品は法的助言をしない。出力はすべて下書きであり、判断は人間が行う。
 */

const NAV: { screen: ScreenName; label: string }[] = [
  { screen: 'intake', label: '発明を書く' },
  { screen: 'elements', label: '構成要件' },
  { screen: 'search', label: '先行技術検索' },
  { screen: 'chart', label: 'クレームチャート' },
  { screen: 'assessment', label: '特許性の判断' },
  { screen: 'graph', label: '引用の関係' },
  { screen: 'draft', label: '明細書ドラフト' },
]

const GLOBAL_NAV: { screen: ScreenName; label: string }[] = [
  { screen: 'matters', label: '案件' },
  { screen: 'jobs', label: 'ジョブ' },
  { screen: 'corpus', label: 'コーパス' },
]

export function App() {
  const [org, setOrg] = useState(() => auth.getOrganization())
  const signOut = useCallback(() => {
    auth.logout()
    setOrg(null)
  }, [])
  return org ? <Workbench org={org} onSignOut={signOut} /> : <SignIn onSignedIn={setOrg} />
}

function SignIn({ onSignedIn }: { onSignedIn: (org: string) => void }) {
  const [orgId, setOrgId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const id = orgId.trim()
    if (!id) {
      setError('作業空間の名前を入れてください。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await auth.login(id)
      onSignedIn(id)
    } catch {
      setError('作業空間を開けませんでした。名前を確かめて、もう一度試してください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6 py-12">
      <div>
        <h1 className="font-bold text-tk-display text-tk-ink tracking-tk-display">典拠</h1>
        <p className="mt-1 text-tk-body text-tk-ink-muted leading-relaxed">
          特許の先行技術調査と明細書の下書きを、公報の原文に一つずつ突き合わせながら進める作業机。
        </p>
      </div>
      <Panel>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field
            label="作業空間"
            htmlFor="org"
            error={error}
            hint="ローカルで動く開発用の入口です。認証はまだ入っていません。"
          >
            <TextInput
              id="org"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="例: tenkyo"
              autoFocus
            />
          </Field>
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? '開いています…' : '作業空間を開く'}
            </Button>
          </div>
        </form>
      </Panel>
      <p className="text-tk-note text-tk-ink-muted leading-relaxed">
        本システムの出力はすべて下書きであり、法的助言ではありません。出願の判断は人間が行います。
      </p>
    </main>
  )
}

function Workbench({ org, onSignOut }: { org: string; onSignOut: () => void }) {
  const [route, setRoute] = useState<Route>(() => parsePath(globalThis.location.pathname))
  const [matterTitle, setMatterTitle] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)

  const go = useCallback((next: Route) => {
    pushRoute(next)
    setRoute(next)
  }, [])

  useEffect(() => {
    const onPop = () => setRoute(parsePath(globalThis.location.pathname))
    globalThis.addEventListener('popstate', onPop)
    return () => globalThis.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!route.matterId) {
      setMatterTitle(null)
      return
    }
    let alive = true
    api
      .matter(route.matterId)
      .then((m) => {
        if (alive) setMatterTitle(m.title)
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (err instanceof ApiError && err.status === 401) {
          onSignOut()
          return
        }
        setMatterTitle(null)
      })
    return () => {
      alive = false
    }
  }, [route.matterId, onSignOut])

  const openMatter = useCallback((matterId: string) => go({ screen: 'chart', matterId }), [go])

  return (
    <div className="min-h-dvh">
      <header className="bg-tk-band text-on-tk-band">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-6 py-2.5">
          <div className="flex items-baseline gap-5">
            <button
              type="button"
              onClick={() => go({ screen: 'matters', matterId: null })}
              className="font-bold text-tk-masthead tracking-tk-masthead"
            >
              典拠
            </button>
            <nav className="flex gap-4">
              {GLOBAL_NAV.map((item) => (
                <button
                  key={item.screen}
                  type="button"
                  onClick={() => go({ screen: item.screen, matterId: null })}
                  className={`text-tk-body ${
                    route.screen === item.screen ? 'font-bold underline underline-offset-4' : ''
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <p className="flex items-baseline gap-3 text-tk-data">
            <span className="font-tk-mono">{org}</span>
            <button type="button" onClick={onSignOut} className="underline underline-offset-2">
              閉じる
            </button>
          </p>
        </div>
      </header>

      {route.matterId && (
        <div className="border-tk-line-strong border-b bg-tk-sheet">
          <div className="mx-auto flex max-w-[1440px] items-baseline gap-6 px-6 py-2">
            <h1 className="shrink-0 font-bold text-tk-matter text-tk-ink">
              {matterTitle ?? '案件を読み込んでいます…'}
            </h1>
            <nav className="flex flex-wrap gap-4">
              {NAV.map((item) => (
                <button
                  key={item.screen}
                  type="button"
                  onClick={() => go({ screen: item.screen, matterId: route.matterId })}
                  className={`text-tk-body ${
                    route.screen === item.screen
                      ? 'font-bold text-tk-verified underline underline-offset-4'
                      : 'text-tk-ink-muted'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1440px] px-6 py-5">
        {fatal && <Notice tone="rejected">{fatal}</Notice>}
        <Screen route={route} onOpenMatter={openMatter} onSignOut={onSignOut} onFatal={setFatal} />
      </main>

      <footer className="mx-auto max-w-[1440px] px-6 pb-8 text-tk-fine text-tk-ink-muted leading-relaxed">
        本システムの出力はすべて下書きであり、法的助言ではありません。出願の可否・記載の適否の判断は人間（弁理士または出願人本人）が行います。
      </footer>
    </div>
  )
}

function Screen({
  route,
  onOpenMatter,
  onSignOut,
  onFatal,
}: {
  route: Route
  onOpenMatter: (id: string) => void
  onSignOut: () => void
  onFatal: (message: string | null) => void
}) {
  if (needsMatter(route.screen) && !route.matterId) {
    return <MattersScreen onOpen={onOpenMatter} onSignOut={onSignOut} />
  }
  const matterId = route.matterId as string
  switch (route.screen) {
    case 'intake':
      return <IntakeScreen matterId={matterId} onSignOut={onSignOut} />
    case 'elements':
      return <ElementsScreen matterId={matterId} onSignOut={onSignOut} />
    case 'search':
      return <SearchScreen matterId={matterId} onSignOut={onSignOut} />
    case 'chart':
      return <ChartScreen matterId={matterId} onSignOut={onSignOut} />
    case 'assessment':
      return <AssessmentScreen matterId={matterId} onSignOut={onSignOut} />
    case 'graph':
      return <GraphScreen matterId={matterId} onSignOut={onSignOut} />
    case 'draft':
      return <DraftScreen matterId={matterId} onSignOut={onSignOut} />
    case 'jobs':
      return <JobsScreen onOpen={onOpenMatter} onSignOut={onSignOut} />
    case 'corpus':
      return <CorpusScreen onSignOut={onSignOut} onFatal={onFatal} />
    default:
      return <MattersScreen onOpen={onOpenMatter} onSignOut={onSignOut} />
  }
}
