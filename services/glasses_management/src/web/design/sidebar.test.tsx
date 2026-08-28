import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { AppSidebar, SidebarGroup, SidebarItem, SidebarSection, SidebarSections } from './sidebar'

/*
 * 柱は指で押す。iPad は触る端末なので、押せるものが 44pt を割ると狙って押せない。
 * 13 の行き先が高さに入らないからといって行を詰めると、そこが真っ先に犠牲になる。
 * 入らないぶんは柱を送らせる（行を小さくして全部見せるのは、押せない列を作る）。
 */
test('柱の行き先も節も 44px の touch target を割らない', () => {
  render(
    <AppSidebar>
      <SidebarGroup label="業務">
        <SidebarItem current>予約台帳</SidebarItem>
        <SidebarSections>
          <SidebarSection>共有iPad</SidebarSection>
        </SidebarSections>
      </SidebarGroup>
    </AppSidebar>,
  )

  for (const name of ['予約台帳', '共有iPad'])
    expect(screen.getByRole('button', { name })).toHaveClass('min-h-11')
})

test('狭い画面では柱を畳み、本文の幅を返す', () => {
  /*
   * 250px の柱を 375px の端末で開いたままにすると、本文に 109px しか残らず
   * 和文が 1 行 1 文字に折れて読めなくなる。狭い幅では引き出しにして、開く口
   * だけを残す。
   */
  render(
    <AppSidebar>
      <SidebarGroup label="業務">
        <SidebarItem current>予約台帳</SidebarItem>
      </SidebarGroup>
    </AppSidebar>,
  )

  const nav = screen.getByRole('navigation', { name: '画面の一覧' })
  expect(nav.className).toContain('max-md:hidden')
  expect(screen.getByRole('button', { name: '画面の一覧を開く' })).toBeVisible()
})

test('節は高さで切らず、入り切らないときは柱ごと送らせる', () => {
  /*
   * 節を 88px の窓に押し込んでいたが、設定の 6 工程・分析の 6 観点はモックでは
   * 常に全部見えている列である。窓に入れると 2 つしか見えないうえ、行が上下で
   * 切れて次の行き先と字が重なった。高さで切るのをやめ、入り切らないぶんは
   * 柱ごと送らせる。行き先も節も 44px のまま、送れば必ず届く。
   */
  render(
    <AppSidebar>
      <SidebarGroup label="業務">
        <SidebarItem current>予約台帳</SidebarItem>
        <SidebarSections>
          <SidebarSection>共有iPad</SidebarSection>
        </SidebarSections>
      </SidebarGroup>
    </AppSidebar>,
  )

  const nav = screen.getByRole('navigation', { name: '画面の一覧' })
  expect(nav.className).toContain('overflow-auto')
  expect(nav.className).not.toContain('overflow-hidden')
  const sections = screen.getByRole('button', { name: '共有iPad' }).parentElement
  expect(sections?.className).not.toContain('max-h-')
})

/*
 * 引き出しは本文の上に重なる。行き先を選んだあとも開いたままだと、選んだ先の
 * 面が引き出しの下に隠れる（SP 幅では画面の 7 割が引き出しである）。選んだ時点で
 * 用は済んでいるので閉じる。
 */
test('狭い画面の引き出しは、行き先を選んだら閉じる', () => {
  render(
    <AppSidebar>
      <SidebarGroup label="業務">
        <SidebarItem>予約台帳</SidebarItem>
      </SidebarGroup>
    </AppSidebar>,
  )

  fireEvent.click(screen.getByRole('button', { name: '画面の一覧を開く' }))
  const drawer = screen.getByRole('navigation', { name: '画面の一覧（開いた状態）' })
  fireEvent.click(within(drawer).getByRole('button', { name: '予約台帳' }))

  expect(screen.queryByRole('navigation', { name: '画面の一覧（開いた状態）' })).toBeNull()
})
