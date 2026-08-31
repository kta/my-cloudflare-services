import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedRadio } from './SegmentedRadio'

/*
 * 切り口の札（P9 T-015。ANALYTICS-COUNT.png の丸印の帯）。
 * **モックが紙の再現のために置いている偽の印をそのまま写さない。**
 * 名前が読まれ、矢印キーで選べる、本物の radio group にする。
 */

const OPTIONS = [
  { value: 'day', label: '日別' },
  { value: 'month', label: '月別' },
  { value: 'hour', label: '時間帯別' },
]

function renderGroup(onChange = vi.fn(), value = 'day') {
  render(<SegmentedRadio label="集計の種類" value={value} options={OPTIONS} onChange={onChange} />)
  return onChange
}

describe('SegmentedRadio', () => {
  it('群に名前が付き、いま選ばれている 1 つが読み上げで分かる', () => {
    renderGroup()
    expect(screen.getByRole('radiogroup', { name: '集計の種類' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '日別' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '月別' })).toHaveAttribute('aria-checked', 'false')
  })

  it('矢印キーだけで選び替えられ、Tab では群を 1 つ飛び越す（roving tabindex）', async () => {
    const onChange = renderGroup()
    const radios = screen.getAllByRole('radio')
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1])
    radios[0]?.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith('month')
    await userEvent.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('hour')
  })

  it('触れる札は 44pt 以上ある', () => {
    renderGroup()
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.className).toContain('min-h-11')
    }
  })
})
