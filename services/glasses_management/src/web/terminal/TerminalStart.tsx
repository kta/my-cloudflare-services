import type { Store, Terminal, TerminalSession } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { useCallback, useEffect, useState } from 'react'
import { client } from '../client'
import { PinEntry, type PinSubject } from '../login/PinEntry'
import { PlacePick } from '../login/PlacePick'
import { type PickedStaff, StaffPick } from '../login/StaffPick'
import { DeviceMode } from '../start/DeviceMode'
import { saveTerminal, type TerminalContext, type TerminalMode } from './terminalState'

/*
 * 業務開始 6 面の器。`react-router` を入れず、この状態だけで出し分ける（URL は書き換えない）。
 *   device → staff → personal-pin
 *   device → place → shared-pin
 */

type Phase =
  | { at: 'device' }
  | { at: 'staff' }
  | { at: 'place' }
  | { at: 'pin'; terminal: Terminal; subject: PinSubject; staffName: string | null }

export function TerminalStart({
  onReady,
  onQuit,
}: {
  onReady: (context: TerminalContext) => void
  onQuit: () => void
}) {
  const [store, setStore] = useState<Store | null>(null)
  const [terminals, setTerminals] = useState<Terminal[] | null>(null)
  const [phase, setPhase] = useState<Phase>({ at: 'device' })
  const [error, setError] = useState<string | null>(null)
  const [today] = useState(() => toJstDateString(new Date()))

  useEffect(() => {
    let live = true
    client.api.staff.stores
      .$get()
      .then(async (res) => {
        if (!live || !res.ok) {
          if (live) setError('お店の情報を読み込めませんでした。画面を開き直してください。')
          return
        }
        const rows: Store[] = await res.json()
        const chosen = rows.find((row) => row.isActive) ?? rows[0] ?? null
        if (!live) return
        setStore(chosen)
        if (chosen === null) {
          setError('お店がまだ登録されていません。')
          return
        }
        const list = await client.api.staff.terminals.$get({ query: { storeId: chosen.id } })
        if (!live) return
        setTerminals(list.ok ? (await list.json()).items : [])
      })
      .catch(() => {
        if (live) setError('通信できませんでした。画面を開き直してください。')
      })
    return () => {
      live = false
    }
  }, [])

  /** 個人の端末は 1 台に 1 行。無ければこの iPad のぶんを作る。 */
  const personalTerminal = useCallback(async (): Promise<Terminal | null> => {
    const found = terminals?.find((row) => row.kind === 'personal')
    if (found !== undefined) return found
    if (store === null) return null
    const res = await client.api.staff.terminals.$post({
      json: {
        name: `${store.name} 個人の端末`,
        kind: 'personal',
        deviceLabel: deviceLabelOf(terminals),
      },
    })
    if (res.status !== 201) return null
    const created: Terminal = await res.json()
    setTerminals((rows) => [...(rows ?? []), created])
    return created
  }, [store, terminals])

  function started(session: TerminalSession, terminal: Terminal, staffName: string | null) {
    const context: TerminalContext = {
      terminalId: terminal.id,
      terminalName: terminal.name,
      mode: session.mode,
      staffId: session.staffId,
      staffName,
      sessionId: session.id,
      autoLockSeconds: terminal.autoLockSeconds,
    }
    saveTerminal(context)
    onReady(context)
  }

  async function chooseStaff(staff: PickedStaff) {
    const terminal = await personalTerminal()
    if (terminal === null) {
      setError(
        'この iPad がまだ登録されていません。店長に「設定 › 端末」から登録してもらってください。',
      )
      return
    }
    setPhase({
      at: 'pin',
      terminal,
      staffName: staff.name,
      subject: { kind: 'personal', staffId: staff.id, name: staff.name, note: staff.note },
    })
  }

  if (error !== null) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper px-6">
        <p role="status" className="max-w-160 text-body text-ink-muted">
          {error}
        </p>
      </main>
    )
  }
  if (store === null || terminals === null) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper px-6">
        <p role="status" className="text-body text-ink-muted">
          読み込んでいます…
        </p>
      </main>
    )
  }

  if (phase.at === 'pin') {
    const { terminal, subject, staffName } = phase
    return (
      <PinEntry
        storeName={store.name}
        terminalId={terminal.id}
        subject={subject}
        onStarted={(session) => started(session, terminal, staffName)}
        onBack={() => setPhase({ at: subject.kind === 'personal' ? 'staff' : 'place' })}
        onQuit={onQuit}
      />
    )
  }
  if (phase.at === 'staff') {
    return (
      <StaffPick
        storeId={store.id}
        storeName={store.name}
        today={today}
        onPick={(staff) => {
          void chooseStaff(staff)
        }}
        onShared={() => setPhase({ at: 'place' })}
        onQuit={onQuit}
      />
    )
  }
  if (phase.at === 'place') {
    return (
      <PlacePick
        storeId={store.id}
        storeName={store.name}
        onPick={(terminal) =>
          setPhase({
            at: 'pin',
            terminal,
            staffName: null,
            subject: {
              kind: 'shared',
              name: terminal.name,
              note: `設置場所　${terminal.placeNote}　／　みんなで使う端末`,
            },
          })
        }
        onChangeMode={() => setPhase({ at: 'device' })}
        onQuit={onQuit}
      />
    )
  }
  return (
    <DeviceMode
      storeName={store.name}
      deviceLabel={deviceLabelOf(terminals)}
      onChoose={(mode: TerminalMode) => setPhase({ at: mode === 'personal' ? 'staff' : 'place' })}
    />
  )
}

function deviceLabelOf(terminals: Terminal[] | null): string {
  return terminals?.find((row) => row.deviceLabel !== '')?.deviceLabel ?? 'この iPad'
}
