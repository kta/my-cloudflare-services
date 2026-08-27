import { Store } from '@app/contracts'
import { Button, Card, Field, Notice, TextInput } from '@app/ui'
import { useEffect, useState } from 'react'
import { App } from './App'
import { authFetch, bootstrap, login } from './staff-session'
import { createStoreSwitchController, type SelectedStore } from './store-switch'

type Api = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type Props = {
  restore?: () => Promise<boolean>
  signIn?: (email: string, password: string) => Promise<boolean>
  api?: Api
}

function createAuditedStoreController(stores: SelectedStore[], api: Api) {
  const initialStore = stores[0]
  if (!initialStore) throw new RangeError('at least one accessible store is required')
  return createStoreSwitchController(initialStore, async (fromStoreId, toStoreId) => {
    const response = await api('/api/staff/store-switches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromStoreId, toStoreId }),
    })
    return response.ok
  })
}

/** Runtime bridge from the memory-only staff session to the selected-store UI. */
export function StaffWorkspace({ restore = bootstrap, signIn = login, api = authFetch }: Props) {
  const [state, setState] = useState<'loading' | 'unauthenticated' | 'error' | 'ready'>('loading')
  const [stores, setStores] = useState<SelectedStore[]>([])
  const [controller, setController] = useState<ReturnType<typeof createStoreSwitchController>>()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | undefined>()

  useEffect(() => {
    let active = true
    void (async () => {
      if (!(await restore())) {
        if (active) setState('unauthenticated')
        return
      }
      const response = await api('/api/staff/stores')
      if (!response.ok) {
        if (active) setState('error')
        return
      }
      const parsed = Store.array().safeParse(await response.json())
      if (!parsed.success || parsed.data.length === 0) {
        if (active) setState('error')
        return
      }
      if (!active) return
      const nextStores = parsed.data.map(({ id, name, isActive }) => ({ id, name, isActive }))
      setStores(nextStores)
      setController(createAuditedStoreController(nextStores, api))
      setState('ready')
    })().catch(() => {
      if (active) setState('error')
    })
    return () => {
      active = false
    }
  }, [api, restore])

  if (state === 'ready' && controller) {
    return <App storeSwitchController={controller} accessibleStores={stores} />
  }
  if (state === 'loading')
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p role="status">スタッフ情報を確認しています。</p>
      </main>
    )
  if (state === 'unauthenticated')
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center px-5">
        <Card className="w-full space-y-5">
          <div>
            <p className="text-sm text-ink-muted">EYEX予約</p>
            <h1 className="font-display text-3xl font-semibold">スタッフログイン</h1>
            <p className="mt-2 text-sm text-ink-muted">
              担当店舗の予約・受付を開くには個人アカウントでログインしてください。
            </p>
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void (async () => {
                if (await signIn(email, password)) {
                  setState('loading')
                  const response = await api('/api/staff/stores')
                  const parsed = response.ok
                    ? Store.array().safeParse(await response.json())
                    : undefined
                  if (parsed?.success && parsed.data.length > 0) {
                    const nextStores = parsed.data.map(({ id, name, isActive }) => ({
                      id,
                      name,
                      isActive,
                    }))
                    setStores(nextStores)
                    setController(createAuditedStoreController(nextStores, api))
                    setState('ready')
                  } else setState('error')
                } else setLoginError('メールアドレスまたはパスワードを確認してください。')
              })()
            }}
          >
            <Field label="メールアドレス" htmlFor="staff-email">
              <TextInput
                id="staff-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field label="パスワード" htmlFor="staff-password">
              <TextInput
                id="staff-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            {loginError && <Notice tone="danger">{loginError}</Notice>}
            <Button type="submit" className="w-full">
              ログインする
            </Button>
          </form>
        </Card>
      </main>
    )
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-5">
      <Notice tone="danger">
        利用可能な店舗を読み込めませんでした。通信を確認して再読み込みしてください。
      </Notice>
    </main>
  )
}
