import { render, screen } from '@testing-library/react'
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

test('柱そのものは送らせず、送るのは節だけ', () => {
  /*
   * 見えない行き先は「無い」のと同じで、それを無くすために柱を作った。
   * 入り切らないときに送るのは、開いている面の節の側である。
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
  expect(nav.className).toContain('overflow-hidden')
  const sections = screen.getByRole('button', { name: '共有iPad' }).parentElement
  expect(sections?.className).toContain('overflow-auto')
})
