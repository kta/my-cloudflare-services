import type { CustomerCandidate, CustomerCreate } from '@app/contracts'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { CustomerNew } from './CustomerNew'

/*
 * 新しいお客様を登録（承認済みモック docs/frontend/mockups/eyex/images/CUSTOMER-NEW.png）。
 *
 * この面の仕事は「お電話番号を打った瞬間に同じ番号のご登録を突きつけ、二重の登録を止める」こと。
 *
 * 実測値（screens/CUSTOMER-NEW.html と assets/eyex.css）:
 *   本文 1fr ／ 右の柱 356px、本文の余白 32px 36px・間 26px、柱 32px 22px。
 *   お電話番号の欄は 幅 320px・21px の等幅。重複の箱は padding 20px 22px・幅 550px まで、
 *   該当行は白地・1px --line-strong・角 8px・padding 12px 16px・間 24px、
 *   2 択は間 10px・上に 16px。お名前とふりがなは 2 列・間 20px・幅 550px まで。
 *   テンキーは 3 列 × 96px・間 12px、キーの高さ 72px、角 12px、数字 28px、幅広キー 16px/600。
 *
 * 並びは `1 2 3 / 4 5 6 / 7 8 9 / ハイフン 0 削除` の 12 キーで、**確定キーを置かない**
 * （10 桁または 11 桁に達した時点で重複の照会が自動で走るため、押して確かめるものが無い）。
 */

function candidate(
  id: string,
  customerNumber: string,
  name: string,
  visitCount: number,
): CustomerCandidate {
  return {
    customer: {
      id,
      customerNumber,
      name,
      kana: 'たなか はなこ',
      phone: '09012345678',
      visitCount,
      lastVisitAt: '2026-05-12',
      memoShort: '',
    },
    match: 'strong',
    lastVisitAt: '2026-05-12',
    currentPrescription: null,
    lastStaffName: null,
    attentionSummary: '',
  }
}

const HANAKO = candidate('0f1b7a2c-9d64-4d1e-9d3a-2f4d6b8c1a01', 'G-01842', '田中 花子', 4)

/** 同じ番号を家族で使っている 6 件。5 件まで並べ、6 件目からは「ほか N件」に畳む。 */
const SIX: readonly CustomerCandidate[] = [
  HANAKO,
  candidate('1f1b7a2c-9d64-4d1e-9d3a-2f4d6b8c1a02', 'G-01843', '田中 一郎', 2),
  candidate('2f1b7a2c-9d64-4d1e-9d3a-2f4d6b8c1a03', 'G-01844', '田中 二郎', 1),
  candidate('3f1b7a2c-9d64-4d1e-9d3a-2f4d6b8c1a04', 'G-01845', '田中 三郎', 0),
  candidate('4f1b7a2c-9d64-4d1e-9d3a-2f4d6b8c1a05', 'G-01846', '田中 四郎', 7),
  candidate('5f1b7a2c-9d64-4d1e-9d3a-2f4d6b8c1a06', 'G-01847', '田中 五郎', 3),
]

/**
 * 器。登録できたお客様の数と、既存のお客様のまま進んだかを画面に出しておき、
 * 「押したのに増えていない／増えている」を目で確かめられるようにする。
 */
function Registry({
  hits = [HANAKO],
  lookup = 'ok',
}: {
  hits?: readonly CustomerCandidate[]
  lookup?: 'ok' | 'fail' | 'pending'
}) {
  const [created, setCreated] = useState<readonly CustomerCreate[]>([])
  const [proceeded, setProceeded] = useState<string | null>(null)
  return (
    <>
      <CustomerNew
        onLookup={async () => {
          if (lookup === 'fail') throw new Error('通信が切れています')
          if (lookup === 'pending') return await new Promise<readonly CustomerCandidate[]>(() => {})
          return hits
        }}
        onCreate={(input) => {
          setCreated((prev) => [...prev, input])
        }}
        onUseExisting={(customer) => setProceeded(customer.name)}
        onSkip={() => {}}
      />
      <p>{`ご登録　${created.length + 1}件`}</p>
      <p>{proceeded === null ? '進んでいません' : `${proceeded} 様で進みました`}</p>
    </>
  )
}

function keypad(): HTMLElement {
  return screen.getByRole('group', { name: '電話番号のテンキー' })
}

async function press(...keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    await userEvent.click(within(keypad()).getByRole('button', { name: new RegExp(`^${key}`) }))
  }
}

/** 「090-1234-5678」を打ち切る。 */
async function typePhone(): Promise<void> {
  await press('0', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8')
}

function warning(): HTMLElement {
  const box = screen.getByText('同じお電話番号のお客様がいます').closest('[role="status"]')
  if (box === null) throw new Error('重複の知らせが role="status" ではない')
  return box as HTMLElement
}

function submit(): HTMLElement {
  return screen.getByRole('button', { name: /^登録してご予約に進む/ })
}

describe('テンキー', () => {
  it('キーは 12 枚で、右下は「削除」・左下は「ハイフン」', () => {
    render(<Registry />)
    const keys = within(keypad()).getAllByRole('button')
    expect(keys).toHaveLength(12)
    expect(keys.map((key) => key.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      'ハイフン',
      '0',
      '削除',
    ])
    // 押しても何も起きないキーにしない。区切りは欄が入れることを、キーの読み上げ名で言う
    // （盤の下に同じことを書いた 1 行は落とした —— この面の説明文が 3 つになり、
    //  「説明文は 2 つまで」の引き算の規準を超えていたため。モックにも無い行である）。
    expect(keys[9]).toHaveAccessibleName('ハイフン　区切りは自動で入ります')
    expect(screen.queryByText('区切りのハイフンは自動で入ります。')).not.toBeInTheDocument()
  })

  it('テンキーを使っている間、欄は inputMode="none" でソフトキーボードを出さない', () => {
    render(<Registry />)
    const phone = screen.getByLabelText('お電話番号')
    expect(phone).toHaveAttribute('inputmode', 'none')
    expect(phone).toHaveAttribute('type', 'tel')
    expect(phone).toHaveAttribute('autocomplete', 'off')
  })

  it('物理キーボードの数字と Backspace は画面のキーと同じ結果になる', async () => {
    render(<Registry />)
    const phone = screen.getByLabelText('お電話番号')
    await press('0', '9', '0')
    expect(phone).toHaveValue('090')

    await userEvent.type(phone, '1234')
    expect(phone).toHaveValue('090-1234')

    await userEvent.type(phone, '{backspace}')
    expect(phone).toHaveValue('090-123')

    await press('削除')
    expect(phone).toHaveValue('090-12')
  })
})

describe('重複の警告', () => {
  it('11 桁を打ち終えた時点で出る（保存を待たない）', async () => {
    render(<Registry />)
    expect(screen.queryByText('同じお電話番号のお客様がいます')).not.toBeInTheDocument()
    await typePhone()
    expect(screen.getByLabelText('お電話番号')).toHaveValue('090-1234-5678')
    expect(await screen.findByText('同じお電話番号のお客様がいます')).toBeVisible()
    // 知らせが出ただけで、まだ 1 件も登録していない。
    expect(screen.getByText('ご登録 1件')).toBeVisible()
  })

  it('該当 1 件のときは お名前・お客様番号・ご来店 4回・最後のご来店 2026年5月12日 を出す', async () => {
    render(<Registry />)
    await typePhone()
    const box = await screen.findByText('同じお電話番号のお客様がいます')
    expect(box).toBeVisible()
    const hits = within(warning()).getAllByRole('listitem')
    expect(hits).toHaveLength(1)
    const hit = hits[0] as HTMLElement
    expect(within(hit).getByText('田中 花子 様')).toBeVisible()
    expect(within(hit).getByText('たなか はなこ ／ G-01842')).toBeVisible()
    expect(within(hit).getByText('ご来店')).toBeVisible()
    expect(within(hit).getByText('4回')).toBeVisible()
    expect(within(hit).getByText('最後のご来店')).toBeVisible()
    expect(within(hit).getByText('2026年5月12日')).toBeVisible()
  })

  it('該当が 6 件あるときは 5 件まで並べ、6 件目からは「ほか 1件」に畳む', async () => {
    render(<Registry hits={SIX} />)
    await typePhone()
    await screen.findByText('同じお電話番号のお客様がいます')
    expect(within(warning()).getAllByRole('listitem')).toHaveLength(5)
    expect(within(warning()).getByText('ほか 1件')).toBeVisible()
    expect(screen.queryByText('田中 五郎 様')).not.toBeInTheDocument()
  })

  it('2 択のどちらかを押すまで「登録してご予約に進む」を押せない', async () => {
    render(<Registry />)
    await typePhone()
    await screen.findByText('同じお電話番号のお客様がいます')
    // `disabled` にはしない —— フォーカスが当たらないと「押せない理由」を読み上げられない。
    expect(submit()).toHaveAttribute('aria-disabled', 'true')
    await userEvent.type(screen.getByLabelText('お名前'), '田中 太郎')
    await userEvent.click(submit())
    expect(screen.getByText('ご登録 1件')).toBeVisible()

    await userEvent.click(
      within(warning()).getByRole('button', { name: '別の方なので、新しく登録する' }),
    )
    expect(submit()).not.toHaveAttribute('aria-disabled')
    await userEvent.click(submit())
    expect(screen.getByText('ご登録 2件')).toBeVisible()
  })

  it('押せない理由を aria-label に持つ（理由なしの disabled を置かない）', async () => {
    render(<Registry />)
    await typePhone()
    await screen.findByText('同じお電話番号のお客様がいます')
    expect(submit()).toHaveAccessibleName(
      '登録してご予約に進む　同じお電話番号のお客様がいます。どちらかをお選びになると押せます',
    )
  })

  it('番号が前方だけ一致した方は「同じお電話番号のお客様」に混ぜない', async () => {
    // 見出しが「同じお電話番号のお客様がいます」なので、全桁一致（strong）だけを並べる。
    // 照会は工程 4 の候補と同じ入口で先頭 7 桁の前方一致（weak）も返してくるが、
    // それは「よく似た番号の別の方」であって同じ番号ではない（AC-CUST-11 は該当 1 件）。
    const NEAR = {
      ...HANAKO,
      customer: {
        ...HANAKO.customer,
        id: '9f1b7a2c-9d64-4d1e-9d3a-2f4d6b8c1a09',
        customerNumber: 'G-02180',
        name: '田中 一郎',
        phone: '09012349912',
      },
      match: 'weak',
    } as const
    render(<Registry hits={[HANAKO, NEAR]} />)
    await typePhone()
    await screen.findByText('同じお電話番号のお客様がいます')
    expect(within(warning()).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText('田中 一郎 様')).not.toBeInTheDocument()
  })

  it('読み上げに割り込まない知らせとして伝わる（role="status"）', async () => {
    render(<Registry />)
    await typePhone()
    await screen.findByText('同じお電話番号のお客様がいます')
    expect(warning()).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('登録', () => {
  it('「このお客様として進む」ではお客様が 1 件も増えない', async () => {
    render(<Registry />)
    await typePhone()
    await screen.findByText('同じお電話番号のお客様がいます')
    await userEvent.click(within(warning()).getByRole('button', { name: 'このお客様として進む' }))
    expect(screen.getByText('田中 花子 様で進みました')).toBeVisible()
    expect(screen.getByText('ご登録 1件')).toBeVisible()
  })

  it('「別の方なので、新しく登録する」を選んでから登録すると 2 件目ができる', async () => {
    render(<Registry />)
    await typePhone()
    await screen.findByText('同じお電話番号のお客様がいます')
    await userEvent.click(
      within(warning()).getByRole('button', { name: '別の方なので、新しく登録する' }),
    )
    await userEvent.type(screen.getByLabelText('お名前'), '田中 太郎')
    await userEvent.click(submit())
    expect(screen.getByText('ご登録 2件')).toBeVisible()
    expect(screen.getByText('進んでいません')).toBeVisible()
  })

  it('お名前だけでも登録できる', async () => {
    render(<Registry />)
    await userEvent.type(screen.getByLabelText('お名前'), '山田 太郎')
    await userEvent.click(submit())
    expect(screen.getByText('ご登録 2件')).toBeVisible()
    expect(screen.getByLabelText('お電話番号')).toHaveValue('')
  })

  it('お名前もお電話番号も空だと「お名前が入っていません。」を欄の下に 1 行で出す', async () => {
    render(<Registry />)
    await userEvent.click(submit())
    const said = screen.getByText('お名前が入っていません。')
    expect(said).toBeVisible()
    expect(screen.getByLabelText('お名前')).toHaveAccessibleDescription('お名前が入っていません。')
    expect(screen.getByLabelText('お名前')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('ご登録 1件')).toBeVisible()
  })
})

describe('ふりがな', () => {
  function compose(field: HTMLElement, kana: string): void {
    fireEvent.compositionStart(field)
    fireEvent.compositionUpdate(field, { data: kana })
    fireEvent.change(field, { target: { value: kana } })
  }

  it('お名前の変換が確定した時点で 1 度だけ自動で埋め、「自動で入れました」の 1 行を欄の下に出す', () => {
    render(<Registry />)
    const name = screen.getByLabelText('お名前')
    compose(name, 'たなか')
    expect(screen.getByLabelText('ふりがな')).toHaveValue('')

    fireEvent.compositionUpdate(name, { data: '田中' })
    fireEvent.change(name, { target: { value: '田中' } })
    fireEvent.compositionEnd(name, { data: '田中' })
    expect(screen.getByLabelText('ふりがな')).toHaveValue('たなか')
    expect(screen.getByText('自動で入れました')).toBeVisible()
  })

  it('人が一度でも触れた欄は二度と上書きせず、その 1 行も消える', async () => {
    render(<Registry />)
    const name = screen.getByLabelText('お名前')
    compose(name, 'たなか')
    fireEvent.compositionEnd(name, { data: '田中' })
    expect(screen.getByLabelText('ふりがな')).toHaveValue('たなか')

    await userEvent.clear(screen.getByLabelText('ふりがな'))
    await userEvent.type(screen.getByLabelText('ふりがな'), 'たなか はなこ')
    expect(screen.queryByText('自動で入れました')).not.toBeInTheDocument()

    compose(name, 'たなかはなこ')
    fireEvent.compositionEnd(name, { data: '田中 花子' })
    expect(screen.getByLabelText('ふりがな')).toHaveValue('たなか はなこ')
    expect(screen.queryByText('自動で入れました')).not.toBeInTheDocument()
  })
})

describe('読み込み中・空・エラー・権限なし', () => {
  it('照会している間は「お調べしています…」を出し、登録は止めない', async () => {
    render(<Registry lookup="pending" />)
    await typePhone()
    expect(screen.getByText('同じお電話番号のご登録をお調べしています…')).toBeVisible()
    expect(submit()).toBeEnabled()
  })

  it('登録に失敗しても入力はそのまま残る', () => {
    render(
      <CustomerNew
        phase="error"
        onLookup={async () => [HANAKO]}
        onCreate={() => {}}
        onUseExisting={() => {}}
        onSkip={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      '登録できませんでした。入力はそのまま残っています。もう一度お試しください。',
    )
    expect(screen.getByLabelText('お名前')).toBeVisible()
  })

  it('当てはまる方がいないときは 1 行だけ知らせ、そのまま登録できる', async () => {
    render(<Registry hits={[]} />)
    await typePhone()
    expect(await screen.findByText('同じお電話番号のご登録はありません。')).toBeVisible()
    expect(submit()).toBeEnabled()
  })

  it('照会に失敗しても受付を止めず、もう一度お調べできる', async () => {
    render(<Registry lookup="fail" />)
    await typePhone()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '同じお電話番号のご登録をお調べできませんでした。もう一度お試しいただくか、このまま登録できます。',
    )
    expect(screen.getByRole('button', { name: 'もう一度お調べする' })).toBeEnabled()
    expect(submit()).toBeEnabled()
  })

  it('権限がないときは、お客様の名前も欄も出さない', () => {
    render(
      <CustomerNew
        phase="forbidden"
        onLookup={async () => [HANAKO]}
        onCreate={() => {}}
        onUseExisting={() => {}}
        onSkip={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('この画面は店長だけがご覧になれます')
    expect(screen.queryByLabelText('お名前')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '電話番号のテンキー' })).not.toBeInTheDocument()
  })
})
