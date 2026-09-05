import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { PinEntry } from '../login/PinEntry'
import { PlacePick } from '../login/PlacePick'
import { DeviceMode } from '../start/DeviceMode'

/*
 * `packages/ui` の `cn()` は tailwind-merge を持たない単純な結合である。
 * だから同じ種類のユーティリティを 1 要素に 2 つ載せると、**勝つのはクラス列の順ではなく
 * Tailwind が CSS を書き出す順**になり、書いた側の意図と無関係に決まる。
 *
 * 実際にこれで 2 か所が壊れていた（UX 監査）:
 *   - テンキーの「確定」…… `bg-surface` + `bg-pine` で白地になり、文字は `text-on-pine`（白）。
 *     **白地に白文字でラベルが消え、空のボタンに見えていた。**
 *   - 置き場所の選択中カード…… `bg-surface` + `bg-pine-soft` で、選択の塗りが出ていなかった。
 *
 * 目で見つけるのは難しく、Tailwind を上げた日に黙って入れ替わる。
 * だから「打ち消しに頼らない」ことを面で守る。
 */

/** 同じ種類として扱うユーティリティの束。条件付き（`hover:` など）は競合しないので外す。 */
const GROUPS: Array<[string, RegExp]> = [
  ['地の色', /^bg-(?!none$)[a-z0-9-]+$/],
  ['文字の色', /^text-(ink|on-pine|on-danger|pine|danger|web|walkin|surface|paper)[a-z0-9-]*$/],
  ['縁の色', /^border-(ink|line|pine|danger|web|walkin|grid)[a-z0-9-]*$/],
  ['角丸', /^rounded-[a-z0-9]+$/],
]

function conflictsIn(ui: ReactElement): string[] {
  const { container } = render(ui)
  const found: string[] = []
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
    const raw = el.getAttribute('class')
    if (raw === null || raw === '') continue
    const list = raw.split(/\s+/).filter((name) => !name.includes(':'))
    for (const [label, pattern] of GROUPS) {
      const hits = list.filter((name) => pattern.test(name))
      if (hits.length > 1) {
        found.push(
          `${el.tagName.toLowerCase()}「${el.textContent?.trim().slice(0, 16) ?? ''}」の${label}: ${hits.join(' + ')}`,
        )
      }
    }
  }
  return [...new Set(found)]
}

const PLACES = [
  {
    id: 't1',
    storeId: 's1',
    name: '銀座店 レジ横iPad',
    kind: 'shared' as const,
    staffId: null,
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

describe('打ち消しに頼ったクラスを置かない', () => {
  it('端末の使い方を決める面', () => {
    expect(
      conflictsIn(
        <DeviceMode deviceLabel="EYE-iPad-07" onPersonal={() => {}} onShared={() => {}} />,
      ),
    ).toEqual([])
  })

  it('置き場所を選ぶ面（選択中のカードの塗りが消えていた）', () => {
    expect(
      conflictsIn(<PlacePick terminals={PLACES} onSelect={() => {}} onChangeMode={() => {}} />),
    ).toEqual([])
  })

  it('暗証番号の面（「確定」のラベルが消えていた）', () => {
    expect(
      conflictsIn(
        <PinEntry
          kind="shared"
          title="銀座店 レジ横iPad"
          detail="レジの右側"
          onSubmit={() => {}}
          onBack={() => {}}
        />,
      ),
    ).toEqual([])
  })
})
