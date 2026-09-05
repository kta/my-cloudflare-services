import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PinEntry } from '../login/PinEntry'
import { PlacePick } from '../login/PlacePick'
import { CalendarPanel } from '../settings/CalendarPanel'
import { EquipmentPanel } from '../settings/EquipmentPanel'
import { HoursPanel } from '../settings/HoursPanel'
import { PurposePanel } from '../settings/PurposePanel'
import { StaffPanel } from '../settings/StaffPanel'
import { StoreInfoPanel } from '../settings/StoreInfoPanel'
import { WebPublishPanel } from '../settings/WebPublishPanel'
import { DeviceMode } from '../start/DeviceMode'

/*
 * 画面をまたいで守りたい約束を、1 つの面でまとめて確かめる。
 *
 * 個々の画面の面は「その画面が何をするか」を書く。ここは「どの画面でも破ってはいけない
 * こと」だけを書く。新しい画面を足したら SCREENS に 1 行足すこと。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const NOW = '2026-08-27T02:08:00.000Z'

beforeEach(() => {
  sessionStorage.setItem(
    'app.auth.token',
    `header.${btoa(JSON.stringify({ sub: 'dev:eye', org: 'eye' }))}.signature`,
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

const PLACES = [
  {
    id: 't1',
    storeId: 's1',
    name: '銀座店 レジ横iPad',
    kind: 'shared' as const,
    placeNote: 'レジの右側',
    deviceLabel: 'EYE-iPad-07',
    autoLockSeconds: 120,
    lastSeenAt: null,
    isOnline: false,
    hasPin: true,
    isActive: true,
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
]

const panelProps = { storeId: STORE_ID, now: NOW, onDraftChange: () => {} }

const SCREENS: Array<[string, () => ReactElement]> = [
  [
    '端末の使い方',
    () => <DeviceMode deviceLabel="EYE-iPad-07" onPersonal={() => {}} onShared={() => {}} />,
  ],
  ['置き場所', () => <PlacePick terminals={PLACES} onSelect={() => {}} onChangeMode={() => {}} />],
  [
    '暗証番号',
    () => (
      <PinEntry
        kind="shared"
        title="銀座店 レジ横iPad"
        detail="レジの右側"
        onSubmit={() => {}}
        onBack={() => {}}
      />
    ),
  ],
  ['設定 › 店舗の情報', () => <StoreInfoPanel {...panelProps} />],
  ['設定 › 営業日', () => <CalendarPanel {...panelProps} />],
  ['設定 › 営業時間', () => <HoursPanel {...panelProps} />],
  ['設定 › ご来店の目的', () => <PurposePanel {...panelProps} />],
  ['設定 › スタッフと技能', () => <StaffPanel {...panelProps} />],
  ['設定 › 設備と点検', () => <EquipmentPanel {...panelProps} />],
  ['設定 › Web予約の公開', () => <WebPublishPanel {...panelProps} />],
]

/** 同じ種類のユーティリティを 1 要素に 2 つ載せていないか（`cn()` は打ち消せない）。 */
const UTILITY_GROUPS: Array<[string, RegExp]> = [
  ['地の色', /^bg-(?!none$)[a-z0-9-]+$/],
  ['文字の色', /^text-(ink|on-pine|on-danger|pine|danger|web|walkin|surface|paper)[a-z0-9-]*$/],
  ['縁の色', /^border-(ink|line|pine|danger|web|walkin|grid)[a-z0-9-]*$/],
  ['角丸', /^rounded-[a-z0-9]+$/],
]

describe.each(SCREENS)('%s', (_name, mount) => {
  it('押せる見た目のものは、すべてハンドラか無効の印を持つ', () => {
    const { container } = render(mount())
    const naked: string[] = []
    for (const button of Array.from(container.querySelectorAll('button'))) {
      const key = Object.keys(button).find((k) => k.startsWith('__reactProps$'))
      const props = key === undefined ? null : (button as unknown as Record<string, unknown>)[key]
      const handlers = props as { onClick?: unknown; onPointerDown?: unknown } | null
      const wired =
        typeof handlers?.onClick === 'function' || typeof handlers?.onPointerDown === 'function'
      const excused = button.disabled || button.type === 'submit'
      if (!wired && !excused) naked.push(button.textContent?.trim().slice(0, 20) ?? '（名前なし）')
    }
    expect(naked).toEqual([])
  })

  it('打ち消しに頼ったクラスを置かない', () => {
    const { container } = render(mount())
    const clashes: string[] = []
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
      const raw = el.getAttribute('class')
      if (raw === null || raw === '') continue
      const list = raw.split(/\s+/).filter((name) => !name.includes(':'))
      for (const [label, pattern] of UTILITY_GROUPS) {
        const hits = list.filter((name) => pattern.test(name))
        if (hits.length > 1) clashes.push(`${label}: ${hits.join(' + ')}`)
      }
    }
    expect([...new Set(clashes)]).toEqual([])
  })

  it('押せるものはすべて名前を持つ（アイコンだけのボタンを置かない）', () => {
    const { container } = render(mount())
    const nameless: string[] = []
    for (const button of Array.from(container.querySelectorAll('button'))) {
      const label = button.getAttribute('aria-label') ?? ''
      const text = (button.textContent ?? '').replace(/[\s⠿⌂☎✎▤☺●‹›✓]/g, '').trim()
      if (label.trim() === '' && text === '') nameless.push(button.outerHTML.slice(0, 60))
    }
    expect(nameless).toEqual([])
  })

  it('無効なボタンは、なぜ押せないかを支援技術へ渡す', () => {
    const { container } = render(mount())
    const silent: string[] = []
    for (const button of Array.from(container.querySelectorAll('button'))) {
      const off = button.disabled || button.getAttribute('aria-disabled') === 'true'
      if (!off) continue
      const explained =
        button.hasAttribute('aria-describedby') ||
        (button.getAttribute('aria-label') ?? '').length > 4
      if (!explained) silent.push(button.textContent?.trim().slice(0, 20) ?? '')
    }
    expect(silent).toEqual([])
  })
})
