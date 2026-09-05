import type { ReservationDetail as ReservationDetailShape } from '@app/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ReservationDetail } from './ReservationDetail'

/*
 * 予約の詳細（承認済みモック docs/frontend/mockups/eye/images/LEDGER-DETAIL.png）。
 *
 * この面の仕事は「台帳の位置を見失わないまま、1 件の中身と次の操作だけを見る」こと。
 * モーダルにしない — 後ろの台帳は見えたままで、押した帯へ矢印が刺さる。
 *
 * 実測値（screens/LEDGER-DETAIL.html と assets/eye.css の `.popover`）:
 *   幅 440px・角 16px・縁 1px --line-strong・影 0 12px 32px、矢印 16px を左 40px。
 *   頭 padding 14px 16px / 胴 12px 16px / 足 12px 16px（足の地は --surface-2）。
 *   主操作は幅いっぱい・min-height 52px・17px、その下に副操作 2 つを 10px 空けて置く。
 *
 * 閉じる道は 4 本 — ✕・Esc・台帳の空いているところを 1 回押す・開いた帯をもう一度押す。
 * モックに ✕ は描かれていないが、物理キーボードを持たない共有端末で Esc が使えないので置く
 * （`design/06-use-cases.md` IDX-LEDGER-04 の 6d が「①と③のどちらかは必ず実装する」と言う）。
 */

function jst(hhmm: string): string {
  return new Date(Date.parse(`2026-08-27T${hhmm}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

const DETAIL: ReservationDetailShape = {
  id: 'r03',
  code: 'EY-2608-0003',
  storeId: 'store-ginza',
  source: 'phone',
  status: 'confirmed',
  startsAt: jst('11:00'),
  endsAt: jst('12:00'),
  durationMinutes: 60,
  purposes: [
    { purposeId: 'p-new', nameInternal: 'メガネを新しく作る', durationMinutes: 40, sortOrder: 0 },
    { purposeId: 'p-measure', nameInternal: '視力測定だけ', durationMinutes: 20, sortOrder: 1 },
  ],
  assignments: [
    { kind: 'staff', targetId: 'st-sato', startsAt: jst('11:00'), endsAt: jst('12:00') },
    { kind: 'equipment', targetId: 'eq-measure-a', startsAt: jst('11:00'), endsAt: jst('11:30') },
    { kind: 'equipment', targetId: 'eq-counter-2', startsAt: jst('11:30'), endsAt: jst('12:00') },
  ],
  webBookingCode: null,
  purposeLabel: '新調相談・視力測定',
  purposeLabelInternal: 'メガネを新しく作る・視力測定だけ',
  noteCustomer: '遠近は初めてです',
  noteInternal: '度数変更の理由は、段階的に説明してください。',
  version: 1,
  createdAt: jst('09:10'),
  updatedAt: jst('09:10'),
  createdBy: null,
  cancelledAt: null,
  cancelReason: null,
}

const PLACES = ['視力測定機 A', '相談カウンター 2'] as const

function open(props: Partial<Parameters<typeof ReservationDetail>[0]> = {}) {
  return render(
    <div className="relative">
      <ReservationDetail
        detail={DETAIL}
        staffName="佐藤 美咲"
        equipmentNames={PLACES}
        anchor={{ left: 260, top: 172 }}
        onClose={() => {}}
        onCheckIn={() => {}}
        onChange={() => {}}
        onCancel={() => {}}
        {...props}
      />
    </div>,
  )
}

function dialog(): HTMLElement {
  return screen.getByRole('dialog', { name: '予約の詳細' })
}

/**
 * 台帳の器。詳細は props だけを受け取る部品なので、開閉・フォーカスの戻り先・
 * 日付や並べ方を保つのは器の仕事である。器がどう配線すればよいかをここで固定する。
 */
function Ledger({
  onNewBooking = () => {},
  onCellPress = () => {},
}: {
  onNewBooking?: () => void
  onCellPress?: () => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [date] = useState('2026年8月27日（木）')
  const [axis] = useState('担当者')
  const [mode] = useState('タイムテーブル')
  return (
    <div>
      <p>{`${date} ${axis} ${mode}`}</p>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 台帳の空きセルを押したときの新規予約を模した器 */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 同上（器の配線を確かめるためだけの模型） */}
      <div className="relative" onClick={onNewBooking}>
        <button
          type="button"
          onClick={() => setOpenId((id) => (id === DETAIL.id ? null : DETAIL.id))}
        >
          11:00から12:00　新調相談・視力測定　佐藤 美咲
        </button>
        <button type="button" onClick={onCellPress}>
          10:30　佐藤 美咲　空いています
        </button>
        {openId !== null && (
          <ReservationDetail
            onCheckIn={() => {}}
            onChange={() => {}}
            onCancel={() => {}}
            detail={DETAIL}
            staffName="佐藤 美咲"
            equipmentNames={PLACES}
            anchor={{ left: 260, top: 172 }}
            onClose={() => setOpenId(null)}
          />
        )}
      </div>
    </div>
  )
}

describe('予約の詳細', () => {
  it('見出しに「11:00–12:00」と「60分」が並ぶ', () => {
    open()
    const head = within(dialog()).getByRole('heading', { level: 2 })
    expect(head.textContent).toBe('11:00–12:00')
    expect(within(dialog()).getByText('60分')).toBeVisible()
  })

  it('ご用件・担当・場所・ご要望・注意ごとの 5 行が並ぶ', () => {
    open()
    const terms = within(dialog())
      .getAllByRole('term')
      .map((node) => node.textContent)
    expect(terms).toEqual(['ご用件', '担当', '場所', 'ご要望', '注意ごと'])
    const values = within(dialog())
      .getAllByRole('definition')
      .map((node) => node.textContent)
    expect(values).toEqual([
      'メガネを新しく作る・視力測定だけ',
      '佐藤 美咲',
      '視力測定機 A ／ 相談カウンター 2',
      '「遠近は初めてです」',
      '度数変更の理由は、段階的に説明してください。',
    ])
  })

  it('場所が 2 つあるときは「視力測定機 A ／ 相談カウンター 2」と連ねる', () => {
    open()
    expect(within(dialog()).getByText('視力測定機 A ／ 相談カウンター 2')).toBeVisible()
  })

  it('出どころの札は「お電話」と出る（「電話予約」にしない）', () => {
    open()
    expect(within(dialog()).getByText('お電話')).toBeVisible()
    expect(screen.queryByText('電話予約')).not.toBeInTheDocument()
  })

  it('下段の操作は「ご来店を受け付ける」「変更する」「取り消す」の 3 つだけ', () => {
    open()
    const foot = within(dialog()).getByRole('group', { name: 'このご予約への操作' })
    expect(
      within(foot)
        .getAllByRole('button')
        .map((node) => node.textContent),
    ).toEqual(['ご来店を受け付ける', '変更する', '取り消す'])
    // 主操作は幅いっぱい・52px（触れる大きさの下限 44pt を越える）。
    expect(within(foot).getByRole('button', { name: 'ご来店を受け付ける' }).className).toContain(
      'min-h-13',
    )
  })

  it('受付が済んだ予約では「ご来店を受け付ける」を出さず「受付済み 11:02」を出す', () => {
    open({ detail: { ...DETAIL, status: 'arrived' }, checkedInAt: jst('11:02') })
    expect(screen.queryByRole('button', { name: 'ご来店を受け付ける' })).not.toBeInTheDocument()
    expect(screen.getByText('受付済み 11:02')).toBeVisible()
    const foot = within(dialog()).getByRole('group', { name: 'このご予約への操作' })
    expect(
      within(foot)
        .getAllByRole('button')
        .map((node) => node.textContent),
    ).toEqual(['変更する', '取り消す'])
  })

  it('受け付けた時刻が分からないときは、時刻を作らずに「受付済み」だけを出す', () => {
    open({ detail: { ...DETAIL, status: 'serving' } })
    expect(screen.getByText('受付済み')).toBeVisible()
  })

  it('押した帯の左端に矢印が付く', () => {
    open()
    // 矢印は詳細の左 40px にあるので、詳細そのものは帯より 40px 左から始まる。
    expect(dialog().style.left).toBe('220px')
    expect(dialog().style.top).toBe('172px')
    const arrow = dialog().querySelector('[data-testid="reservation-detail-arrow"]')
    expect(arrow?.className).toContain('left-10')
  })

  it('台帳の空いているところを 1 回押すと閉じ、その 1 回は新しい予約を起こさない', async () => {
    const onNewBooking = vi.fn()
    const onCellPress = vi.fn()
    render(<Ledger onNewBooking={onNewBooking} onCellPress={onCellPress} />)
    await userEvent.click(screen.getByRole('button', { name: /11:00から12:00/ }))
    expect(dialog()).toBeVisible()
    // 帯そのものも台帳の中にあるので、開くための 1 回はここまでで数え終える。
    onNewBooking.mockClear()

    await userEvent.click(screen.getByTestId('reservation-detail-dismiss'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onCellPress).not.toHaveBeenCalled()
    expect(onNewBooking).not.toHaveBeenCalled()
  })

  it('開いた帯をもう一度押すと閉じる', async () => {
    render(<Ledger />)
    const band = screen.getByRole('button', { name: /11:00から12:00/ })
    await userEvent.click(band)
    expect(dialog()).toBeVisible()
    await userEvent.click(band)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Esc を押すと閉じる', async () => {
    render(<Ledger />)
    await userEvent.click(screen.getByRole('button', { name: /11:00から12:00/ }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('✕ を押すと閉じる（物理キーボードの無い端末のため）', async () => {
    const onClose = vi.fn()
    open({ onClose })
    await userEvent.click(screen.getByRole('button', { name: '詳細を閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('開いたときのフォーカスは詳細そのものに置き、主操作には置かない', async () => {
    render(<Ledger />)
    await userEvent.click(screen.getByRole('button', { name: /11:00から12:00/ }))
    expect(document.activeElement).toBe(dialog())
  })

  it('閉じるとフォーカスが元の帯へ戻る', async () => {
    render(<Ledger />)
    const band = screen.getByRole('button', { name: /11:00から12:00/ })
    await userEvent.click(band)
    await userEvent.keyboard('{Escape}')
    expect(document.activeElement).toBe(band)
  })

  it('開いても閉じても日付・並べ方・表示のかたち・スクロールの位置は変わらない', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    render(<Ledger />)
    const before = screen.getByText('2026年8月27日（木） 担当者 タイムテーブル').textContent
    await userEvent.click(screen.getByRole('button', { name: /11:00から12:00/ }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByText('2026年8月27日（木） 担当者 タイムテーブル').textContent).toBe(before)
    // 台帳を動かさない（開いた拍子に見ていた時間帯を見失わせない）。
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('担当が未定のご予約は担当の欄に「担当が未定」と書く', () => {
    open({ staffName: null, equipmentNames: [] })
    const values = within(dialog())
      .getAllByRole('definition')
      .map((node) => node.textContent)
    expect(values[1]).toBe('担当が未定')
    expect(values[2]).toBe('場所は決めていません')
  })

  it('ご要望と注意ごとが無いご予約では、その行を出さない', () => {
    open({ detail: { ...DETAIL, noteCustomer: '', noteInternal: '' } })
    const terms = within(dialog())
      .getAllByRole('term')
      .map((node) => node.textContent)
    expect(terms).toEqual(['ご用件', '担当', '場所'])
  })

  it('通信が切れている間は書き込みの操作を押せない', () => {
    open({ isOffline: true })
    const foot = within(dialog()).getByRole('group', { name: 'このご予約への操作' })
    for (const action of within(foot).getAllByRole('button')) {
      expect(action).toBeDisabled()
    }
    // 読むことと閉じることは続けられる。
    expect(screen.getByRole('button', { name: '詳細を閉じる' })).toBeEnabled()
  })

  it('読み込み中と、見つからないときを持つ', () => {
    const { rerender } = render(
      <ReservationDetail
        detail={null}
        staffName={null}
        equipmentNames={[]}
        onClose={() => {}}
        onCheckIn={() => {}}
        onChange={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe('ご予約を読み込んでいます…')

    rerender(
      <ReservationDetail
        onCheckIn={() => {}}
        onChange={() => {}}
        onCancel={() => {}}
        detail={null}
        staffName={null}
        equipmentNames={[]}
        onClose={() => {}}
        phase="not_found"
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      'このご予約は見つかりませんでした。台帳を読み直してください。',
    )
  })
})

/*
 * 台帳の器は `overflow: hidden` なので、はみ出した詳細はまったく読めなくなる。
 * 下のほうの行の帯を押しても必ず読めるところに置く（jsdom は寸法を持たないので、
 * 器と面の矩形をこの describe の中だけ差し替えて測る）。
 */
describe('台帳の中に収める', () => {
  const PANEL_HEIGHT = 330

  function measure(room: { width: number; height: number }): () => void {
    const kept = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) {
        return this.closest('[data-stage]')
      },
    })
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function box(this: HTMLElement) {
        const size = this.hasAttribute('data-stage') ? room : { width: 440, height: PANEL_HEIGHT }
        return {
          ...size,
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: size.width,
          bottom: size.height,
          toJSON: () => ({}),
        } as DOMRect
      })
    return () => {
      rect.mockRestore()
      if (kept !== undefined) Object.defineProperty(HTMLElement.prototype, 'offsetParent', kept)
    }
  }

  function openIn(anchor: { left: number; top: number; bandTop: number }) {
    render(
      <div data-stage className="relative">
        <ReservationDetail
          onCheckIn={() => {}}
          onChange={() => {}}
          onCancel={() => {}}
          detail={DETAIL}
          staffName="佐藤 美咲"
          equipmentNames={PLACES}
          anchor={anchor}
          onClose={() => {}}
        />
      </div>,
    )
  }

  function arrowLeft(): string {
    const arrow = dialog().querySelector<HTMLElement>('[data-testid="reservation-detail-arrow"]')
    return arrow?.style.left ?? ''
  }

  it('下に入らない帯では、詳細を帯の上へ返す', () => {
    const restore = measure({ width: 1000, height: 600 })
    try {
      openIn({ left: 260, top: 560, bandTop: 460 })
      // 560 + 330 + 8 は器の 600 を越えるので、帯の上端 460 から面の高さと隙間を引く。
      expect(dialog().style.top).toBe('122px')
      expect(dialog().style.left).toBe('220px')
      expect(arrowLeft()).toBe('40px')
    } finally {
      restore()
    }
  })

  it('右に入らない帯では詳細を左へ寄せ、矢印だけを帯の位置に残す', () => {
    const restore = measure({ width: 600, height: 600 })
    try {
      openIn({ left: 560, top: 100, bandTop: 40 })
      // 520 では右へ 360px はみ出すので、器の右端から 8px 内側の 152px まで戻す。
      expect(dialog().style.left).toBe('152px')
      expect(dialog().style.top).toBe('100px')
      expect(arrowLeft()).toBe('408px')
    } finally {
      restore()
    }
  })

  it('そのまま入る帯では、渡された座標をそのまま使う', () => {
    const restore = measure({ width: 1000, height: 600 })
    try {
      openIn({ left: 260, top: 172, bandTop: 100 })
      expect(dialog().style.left).toBe('220px')
      expect(dialog().style.top).toBe('172px')
      expect(arrowLeft()).toBe('40px')
    } finally {
      restore()
    }
  })
})
