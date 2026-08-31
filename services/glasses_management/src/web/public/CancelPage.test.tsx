import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CancelPage, type ManagedReservation } from './CancelPage'

/*
 * ご予約の確認・変更・取り消し（承認済みモック docs/frontend/mockups/eyex/images/WEB-CANCEL.png）。
 *
 * この面の仕事は「番号 2 つだけで自分の予約に戻り、変更と取消の 2 つの出口だけを置く」こと。
 *
 * 実測値（screens/WEB-CANCEL.html と assets/eyex.css）:
 *   進捗は 2 段（両方点灯）。本文の余白 32px 28px 152px。
 *   明細は上に 24px、見出し列 78px・13px、値 16px 太さ 600、ご来店の行だけ 20px `--color-pine-deep`、
 *   ご予約番号の行は等幅。期限の 1 行は上に 24px・13px `--color-ink-muted`。
 *   下の固定は「日時を変更する」（56px の緑）と「この予約を取り消す」（48px・文字と縁が `--color-danger`・上に 10px）。
 */

const NOW = '2026-08-27T09:42:00.000Z' // JST 8月27日 18:42（モックの時刻）
const RESERVATION: ManagedReservation = {
  code: 'EY-W-2608-0031',
  status: 'confirmed',
  startsAt: '2026-08-29T02:00:00.000Z', // JST 8月29日（土）11:00
  endsAt: '2026-08-29T03:00:00.000Z',
  storeName: 'EYEX 銀座店',
  storePhone: '03-1234-5678',
  purposeName: '新しいメガネを作る',
  durationMinutes: 60,
  contactName: '山口 真央',
  // 既定（`change_deadline_days` = 1）＝来店日の前日 23:59:59.999 JST。
  changeDeadlineAt: '2026-08-28T14:59:59.999Z',
}

const MISMATCH = 'ご予約番号か確認番号が違います。お送りしたメールの番号をお確かめください。'

function open(props: Partial<Parameters<typeof CancelPage>[0]> = {}) {
  return render(
    <CancelPage
      now={NOW}
      onLookup={async () => ({ ok: true, value: RESERVATION })}
      onChangeDateTime={async () => ({ ok: true, value: RESERVATION })}
      onCancelReservation={async () => ({ ok: true, value: { cancelledAt: NOW } })}
      {...props}
    />,
  )
}

async function lookUp(code = 'EY-W-2608-0031', management = '4821-9930'): Promise<void> {
  await userEvent.type(screen.getByLabelText('ご予約番号'), code)
  await userEvent.type(screen.getByLabelText('確認番号'), management)
  await userEvent.click(screen.getByRole('button', { name: 'ご予約をお調べする' }))
}

function line(term: string): HTMLElement {
  return screen.getByRole('group', { name: term })
}

/** WEB-03-DATETIME をそのまま差し込む口（器が `DateTimeStep` を渡す）。 */
function stubDateTime({
  heading,
  onPick,
}: {
  heading: string
  onPick: (startsAt: string) => void
}) {
  return (
    <div>
      <h2>{heading}</h2>
      <button type="button" onClick={() => onPick('2026-08-29T05:00:00.000Z')}>
        14:00
      </button>
    </div>
  )
}

describe('本人確認', () => {
  it('欄はご予約番号と確認番号の 2 つだけで、「ご予約をお調べする」の 1 操作', () => {
    open()
    expect(screen.getByLabelText('ご予約番号')).toBeVisible()
    expect(screen.getByLabelText('確認番号')).toBeVisible()
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'ご予約をお調べする' })).toBeVisible()
  })

  it('番号が違うと「ご予約番号か確認番号が違います。お送りしたメールの番号をお確かめください。」を出し、入力を残す', async () => {
    open({ onLookup: async () => ({ ok: false, reason: 'mismatch' }) })
    await lookUp('EY-W-2608-0031', '0000-0000')
    expect(await screen.findByRole('alert')).toHaveTextContent(MISMATCH)
    expect(screen.getByLabelText('ご予約番号')).toHaveValue('EY-W-2608-0031')
    expect(screen.getByLabelText('確認番号')).toHaveValue('0000-0000')
  })

  it('番号が違ったとき、どちらが違うかを言わない', async () => {
    // 存在しないご予約番号でも、確認番号だけが違うときでも、出る文はまったく同じにする。
    open({ onLookup: async () => ({ ok: false, reason: 'mismatch' }) })
    await lookUp('EY-W-2608-0031', '0000-0000')
    const wrongManagementCode = (await screen.findByRole('alert')).textContent
    cleanup()

    open({ onLookup: async () => ({ ok: false, reason: 'mismatch' }) })
    await lookUp('EY-W-2608-9999', '4821-9930')
    const unknownCode = (await screen.findByRole('alert')).textContent

    expect(wrongManagementCode).toBe(MISMATCH)
    expect(unknownCode).toBe(wrongManagementCode)
  })

  it('10 回失敗すると「お待ちください。15分ほど経ってから、もう一度お試しください。」を出す', async () => {
    let tries = 0
    open({
      onLookup: async () => {
        tries += 1
        return tries < 10
          ? ({ ok: false, reason: 'mismatch' } as const)
          : ({ ok: false, reason: 'locked' } as const)
      },
    })
    await lookUp()
    for (let i = 1; i < 10; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'ご予約をお調べする' }))
    }
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'お待ちください。15分ほど経ってから、もう一度お試しください。',
    )
  })

  it('短命の鍵が切れたら「お時間が経ちましたので、もう一度ご予約番号と確認番号をご入力ください。」を出して入力へ戻す', async () => {
    open({ onCancelReservation: async () => ({ ok: false, reason: 'expired' }) })
    await lookUp()
    await userEvent.click(await screen.findByRole('button', { name: 'この予約を取り消す' }))
    await userEvent.click(screen.getByRole('button', { name: 'この予約を取り消す（確定）' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'お時間が経ちましたので、もう一度ご予約番号と確認番号をご入力ください。',
    )
    expect(screen.getByLabelText('ご予約番号')).toBeVisible()
    expect(screen.getByLabelText('確認番号')).toBeVisible()
  })
})

describe('明細', () => {
  it('見出しは「ご予約をお調べしました」で、補足は「ご本人様の確認ができました。」', async () => {
    open()
    await lookUp()
    expect(await screen.findByRole('heading', { name: 'ご予約をお調べしました' })).toBeVisible()
    expect(screen.getByText('ご本人様の確認ができました。')).toBeVisible()
  })

  it('5 行（ご来店・店舗・ご用件・お名前・ご予約番号）が出る', async () => {
    open()
    await lookUp()
    expect(await screen.findByRole('group', { name: 'ご来店' })).toBeVisible()
    expect(within(line('ご来店')).getByText('8月29日（土）11:00')).toBeVisible()
    expect(within(line('店舗')).getByText('EYEX 銀座店')).toBeVisible()
    expect(within(line('ご用件')).getByText('新しいメガネを作る（約60分）')).toBeVisible()
    expect(within(line('お名前')).getByText('山口 真央 様')).toBeVisible()
    expect(within(line('ご予約番号')).getByText('EY-W-2608-0031')).toBeVisible()
  })

  it('期限の文は設定から作り、画面に固定で書かない', async () => {
    open()
    await lookUp()
    expect(await screen.findByText('変更・取り消しは前日までにお願いいたします。')).toBeVisible()

    // `change_deadline_days` を 3 にした店舗では、同じ 1 行が「3日前まで」に変わる。
    cleanup()
    open({
      onLookup: async () => ({
        ok: true,
        value: {
          ...RESERVATION,
          startsAt: '2026-09-01T02:00:00.000Z',
          endsAt: '2026-09-01T03:00:00.000Z',
          // JST 8月29日 23:59:59.999 = ご来店（9月1日）の 3 日前。
          changeDeadlineAt: '2026-08-29T14:59:59.999Z',
        },
      }),
    })
    await lookUp()
    expect(await screen.findByText('変更・取り消しは3日前までにお願いいたします。')).toBeVisible()
  })

  it('確認番号を 1 度も画面に出さない', async () => {
    open()
    await lookUp('EY-W-2608-0031', '4821-9930')
    await screen.findByRole('heading', { name: 'ご予約をお調べしました' })
    expect(screen.queryByText('4821-9930')).not.toBeInTheDocument()
    expect(screen.queryByText(/確認番号/)).not.toBeInTheDocument()
  })
})

describe('日時の変更', () => {
  it('WEB-03 と同じ形の候補が出て、見出しだけ「ご予約の変更」に変わる', async () => {
    open({ renderChangeDateTime: stubDateTime })
    await lookUp()
    await userEvent.click(await screen.findByRole('button', { name: '日時を変更する' }))

    expect(screen.getByRole('heading', { name: 'ご予約の変更' })).toBeVisible()
    expect(screen.getByRole('button', { name: '14:00' })).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'ご予約をお調べしました' }),
    ).not.toBeInTheDocument()
  })

  it('確かめると「ご来店」の日時がその時刻に変わる', async () => {
    const moved = {
      ...RESERVATION,
      startsAt: '2026-08-29T05:00:00.000Z',
      endsAt: '2026-08-29T06:00:00.000Z',
    }
    const onChangeDateTime = vi.fn(async () => ({ ok: true, value: moved }) as const)
    open({ renderChangeDateTime: stubDateTime, onChangeDateTime })
    await lookUp()
    await userEvent.click(await screen.findByRole('button', { name: '日時を変更する' }))
    await userEvent.click(screen.getByRole('button', { name: '14:00' }))

    expect(onChangeDateTime).toHaveBeenCalledWith('2026-08-29T05:00:00.000Z')
    expect(await screen.findByRole('group', { name: 'ご来店' })).toHaveTextContent(
      '8月29日（土）14:00',
    )
  })
})

describe('取消', () => {
  it('確かめる前に role="alertdialog" で問い直す', async () => {
    const onCancelReservation = vi.fn(
      async () => ({ ok: true, value: { cancelledAt: NOW } }) as const,
    )
    open({ onCancelReservation })
    await lookUp()
    await userEvent.click(await screen.findByRole('button', { name: 'この予約を取り消す' }))

    const asked = screen.getByRole('alertdialog')
    expect(within(asked).getByRole('heading', { name: 'このご予約を取り消しますか' })).toBeVisible()
    expect(onCancelReservation).not.toHaveBeenCalled()

    await userEvent.click(within(asked).getByRole('button', { name: 'やめる' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onCancelReservation).not.toHaveBeenCalled()
  })

  it('取り消すと「ご予約を取り消しました」「またのご来店をお待ちしております。」を出す', async () => {
    open()
    await lookUp()
    await userEvent.click(await screen.findByRole('button', { name: 'この予約を取り消す' }))
    await userEvent.click(screen.getByRole('button', { name: 'この予約を取り消す（確定）' }))

    expect(await screen.findByRole('heading', { name: 'ご予約を取り消しました' })).toBeVisible()
    expect(screen.getByText('またのご来店をお待ちしております。')).toBeVisible()
  })

  it('取り消したあとは「日時を変更する」も「この予約を取り消す」も出さない', async () => {
    open()
    await lookUp()
    await userEvent.click(await screen.findByRole('button', { name: 'この予約を取り消す' }))
    await userEvent.click(screen.getByRole('button', { name: 'この予約を取り消す（確定）' }))
    await screen.findByRole('heading', { name: 'ご予約を取り消しました' })

    expect(screen.queryByRole('button', { name: '日時を変更する' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この予約を取り消す' })).not.toBeInTheDocument()
  })
})

describe('締切', () => {
  it('前日の終わりを過ぎていると、変更も取消も押せず、お電話でのご連絡をお願いする案内と店舗の電話番号を出す', async () => {
    open({ now: '2026-08-28T15:00:00.000Z' }) // JST 8月29日 00:00:00 ちょうど
    await lookUp()
    await screen.findByRole('heading', { name: 'ご予約をお調べしました' })

    expect(screen.queryByRole('button', { name: '日時を変更する' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この予約を取り消す' })).not.toBeInTheDocument()
    expect(
      screen.getByText(
        '前日を過ぎたため、この画面では変更・お取り消しができません。お手数ですが 03-1234-5678 までお電話でお願いいたします。',
      ),
    ).toBeVisible()
  })
})
