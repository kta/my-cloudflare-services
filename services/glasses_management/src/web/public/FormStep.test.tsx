import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FormStep } from './FormStep'

/*
 * 工程 4 お客様の情報（承認済みモック docs/frontend/mockups/eyex/images/WEB-04-FORM.png）。
 *
 * この面の仕事は「4 欄だけを伺い、ふりがなは打たせずに埋める」こと。
 *
 * 実測値（screens/WEB-04-FORM.html と assets/eyex.css）:
 *   本文の余白 32px 28px 120px。欄の並びは間 20px・上に 28px。
 *   見出し 13px `--color-ink-muted`、入力は最小高 52px・16px・角 12px・縁 1px `--color-line-strong`、
 *   焦点のある欄だけ縁 2px `--color-pine`。下の固定は左右 28px・下 32px の全幅 56px。
 */

function open(props: Partial<Parameters<typeof FormStep>[0]> = {}) {
  return render(<FormStep onProceed={() => {}} {...props} />)
}

function submit(): HTMLElement {
  return screen.getByRole('button', { name: '入力内容を確認する' })
}

/** 変換の途中まで（まだ確定していない）。 */
function compose(field: HTMLElement, reading: string): void {
  fireEvent.compositionStart(field)
  fireEvent.compositionUpdate(field, { data: reading })
  fireEvent.change(field, { target: { value: reading } })
}

async function fillAll(): Promise<void> {
  await userEvent.type(screen.getByLabelText('お名前'), '山口 真央')
  await userEvent.type(screen.getByLabelText('ふりがな'), 'やまぐち まお')
  await userEvent.type(screen.getByLabelText('お電話番号'), '080-2345-6789')
  await userEvent.type(screen.getByLabelText('メールアドレス'), 'm.yamaguchi@example.jp')
}

describe('お客様の情報', () => {
  it('見出しは「お客様のことを教えてください」で、補足は「ご予約のご連絡だけに使わせていただきます。」', () => {
    open()
    expect(screen.getByRole('heading', { name: 'お客様のことを教えてください' })).toBeVisible()
    expect(screen.getByText('ご予約のご連絡だけに使わせていただきます。')).toBeVisible()
  })

  it('お電話番号は数字のキーボード（inputmode=numeric）が出る', () => {
    open()
    const phone = screen.getByLabelText('お電話番号')
    expect(phone).toHaveAttribute('inputmode', 'numeric')
    expect(phone).toHaveAttribute('type', 'tel')
  })

  it('メールアドレスはメール用のキーボード（type=email / inputmode=email）が出る', () => {
    open()
    const mail = screen.getByLabelText('メールアドレス')
    expect(mail).toHaveAttribute('type', 'email')
    expect(mail).toHaveAttribute('inputmode', 'email')
  })

  it('お名前・お電話番号・メールアドレスは端末が覚えている値から入れられる（autocomplete が付く）', () => {
    open()
    expect(screen.getByLabelText('お名前')).toHaveAttribute('autocomplete', 'name')
    expect(screen.getByLabelText('お電話番号')).toHaveAttribute('autocomplete', 'tel')
    expect(screen.getByLabelText('メールアドレス')).toHaveAttribute('autocomplete', 'email')
  })

  it('ふりがなは autocomplete を持たない', () => {
    open()
    // 端末が覚えているのは氏名・電話・メールだけで、読みを覚える枠は無い。
    // `autocomplete="off"` を置くと iOS が氏名の候補を出してしまうので、属性そのものを置かない。
    expect(screen.getByLabelText('ふりがな')).not.toHaveAttribute('autocomplete')
  })

  it('工程の途中の欄は enterkeyhint=next、最後の欄は done', () => {
    open()
    expect(screen.getByLabelText('お名前')).toHaveAttribute('enterkeyhint', 'next')
    expect(screen.getByLabelText('ふりがな')).toHaveAttribute('enterkeyhint', 'next')
    expect(screen.getByLabelText('お電話番号')).toHaveAttribute('enterkeyhint', 'next')
    expect(screen.getByLabelText('メールアドレス')).toHaveAttribute('enterkeyhint', 'done')
  })

  it('4 欄が埋まるまで「入力内容を確認する」は押せない', async () => {
    const onProceed = vi.fn()
    open({ onProceed })
    expect(submit()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('4つの欄が埋まると進めます')).toBeVisible()

    await userEvent.click(submit())
    expect(onProceed).not.toHaveBeenCalled()

    await fillAll()
    expect(submit()).not.toHaveAttribute('aria-disabled')
    await userEvent.click(submit())
    expect(onProceed).toHaveBeenCalledWith({
      name: '山口 真央',
      kana: 'やまぐち まお',
      phone: '080-2345-6789',
      email: 'm.yamaguchi@example.jp',
    })
  })

  it('メールアドレスは必須で、空のままでは進めない', async () => {
    const onProceed = vi.fn()
    open({ onProceed })
    await userEvent.type(screen.getByLabelText('お名前'), '山口 真央')
    await userEvent.type(screen.getByLabelText('ふりがな'), 'やまぐち まお')
    await userEvent.type(screen.getByLabelText('お電話番号'), '080-2345-6789')

    expect(submit()).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(submit())
    expect(onProceed).not.toHaveBeenCalled()
  })

  it('電話番号・メールアドレスの形が正しくなければ進めない', async () => {
    const onProceed = vi.fn()
    open({ onProceed })
    await userEvent.type(screen.getByLabelText('お名前'), '山口 真央')
    await userEvent.type(screen.getByLabelText('ふりがな'), 'やまぐち まお')
    await userEvent.type(screen.getByLabelText('お電話番号'), '080-2345-67')
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'm.yamaguchi@example.jp')
    expect(screen.getByText('お電話番号は10桁か11桁でご入力ください')).toBeVisible()
    await userEvent.click(submit())
    expect(onProceed).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText('お電話番号'), '89')
    await userEvent.clear(screen.getByLabelText('メールアドレス'))
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'm.yamaguchi')
    expect(screen.getByText('メールアドレスの形をお確かめください')).toBeVisible()
    await userEvent.click(submit())
    expect(onProceed).not.toHaveBeenCalled()
  })
})

describe('ふりがな', () => {
  it('日本語入力の変換中は値を読まず、変換の途中の文字が入らない', () => {
    open()
    compose(screen.getByLabelText('お名前'), 'やまぐち')
    expect(screen.getByLabelText('ふりがな')).toHaveValue('')
  })

  it('変換を確定すると「やまぐち まお」が一度だけ入る', () => {
    open()
    const name = screen.getByLabelText('お名前')
    compose(name, 'やまぐち まお')
    fireEvent.compositionUpdate(name, { data: '山口 真央' })
    fireEvent.change(name, { target: { value: '山口 真央' } })
    fireEvent.compositionEnd(name, { data: '山口 真央' })

    expect(screen.getByLabelText('ふりがな')).toHaveValue('やまぐち まお')
    expect(screen.getByText('自動で入れました')).toBeVisible()

    // 2 度目の確定でも足し込まない。
    compose(name, 'やまぐちまおこ')
    fireEvent.compositionEnd(name, { data: '山口 真央子' })
    expect(screen.getByLabelText('ふりがな')).toHaveValue('やまぐち まお')
  })

  it('お客様が自分でふりがなを直したあとは、名前を打ち直しても上書きしない', async () => {
    open()
    const name = screen.getByLabelText('お名前')
    compose(name, 'やまぐち')
    fireEvent.compositionEnd(name, { data: '山口' })
    expect(screen.getByLabelText('ふりがな')).toHaveValue('やまぐち')

    await userEvent.clear(screen.getByLabelText('ふりがな'))
    await userEvent.type(screen.getByLabelText('ふりがな'), 'やまぐち まお')
    expect(screen.queryByText('自動で入れました')).not.toBeInTheDocument()

    compose(name, 'やまぐちまお')
    fireEvent.compositionEnd(name, { data: '山口 真央' })
    expect(screen.getByLabelText('ふりがな')).toHaveValue('やまぐち まお')
  })

  it('変換の確定イベントが来ない経路でも、欄を離れたときに 1 回だけ埋まる', () => {
    open()
    const name = screen.getByLabelText('お名前')
    // iOS のかなキーボードは予測変換の直接確定で `compositionend` を出さないことがある。
    compose(name, 'やまぐち まお')
    fireEvent.change(name, { target: { value: '山口 真央' } })
    expect(screen.getByLabelText('ふりがな')).toHaveValue('')

    fireEvent.blur(name)
    expect(screen.getByLabelText('ふりがな')).toHaveValue('やまぐち まお')
  })
})
