import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('glasses reservation app', () => {
  it('source parity: booking exposes the complete source form and side summaries', async () => {
    render(<App initialView="booking" />)

    expect(screen.getByRole('heading', { name: '電話予約入力' })).toBeVisible()
    expect(screen.getByText('CALL RESERVATION')).toBeVisible()
    expect(screen.getByText('お名前と電話番号を伺えますか？')).toBeVisible()
    expect(screen.getByText('ご希望・ご用件を伺います')).toBeVisible()
    expect(screen.getByText('内容を復唱・確認します')).toBeVisible()

    for (const purpose of [
      '検眼・カウンセリング',
      'メガネの作製・ご相談',
      'メガネの調整・フィッティング',
      'メガネの修理・クリーニング',
      'コンタクトレンズの相談・購入',
      'その他',
    ]) {
      expect(screen.getByRole('button', { name: purpose })).toBeVisible()
    }

    for (const staffChoice of ['前回と同じ', '指名なし', '別の担当者を希望']) {
      expect(screen.getByRole('button', { name: new RegExp(staffChoice) })).toBeVisible()
    }

    expect(screen.getByRole('heading', { name: /お客様情報/ })).toBeVisible()
    expect(screen.getByRole('heading', { name: /選択中の条件/ })).toBeVisible()
    expect(screen.getByRole('heading', { name: /予約可能な候補/ })).toBeVisible()
    expect(screen.getByRole('button', { name: '録音を一時停止' })).toBeVisible()
  })

  it('録音widgetは視認性の高いパネル構造を持つ', () => {
    render(<App initialView="booking" />)
    const widget = screen.getByRole('complementary', { name: '通話録音状態' })
    expect(widget).toHaveClass('recording-panel')
    expect(screen.getByText('通話を記録中')).toBeVisible()
    expect(screen.getByText('00:00')).toBeVisible()
    expect(widget.querySelectorAll('.wave-bar')).toHaveLength(6)
    expect(screen.getByRole('button', { name: '録音を一時停止' })).toHaveClass('recording-stop')
  })

  it('予約フォームは質問、必須表示、入力を読みやすい順で提示する', () => {
    render(<App initialView="booking" />)
    expect(screen.getByRole('heading', { name: 'お日にちはいつですか？' })).toHaveClass(
      'form-question',
    )
    expect(screen.getAllByText('必須').length).toBeGreaterThanOrEqual(3)
    expect(screen.getByLabelText('日付')).toHaveClass('booking-input')
  })

  it('source parity: every desktop view exposes source page chrome and primary region', () => {
    const views = [
      ['home', '新規予約'],
      ['booking', '電話予約入力'],
      ['ledger', '予約台帳'],
      ['list', '予約一覧'],
      ['customer', '顧客カルテ'],
      ['dashboard', 'ダッシュボード'],
    ] as const

    for (const [view, heading] of views) {
      const { unmount } = render(<App initialView={view} />)
      if (view !== 'home') expect(screen.getByRole('heading', { name: heading })).toBeVisible()
      if (view === 'home') {
        expect(screen.getByRole('button', { name: heading })).toBeVisible()
      } else {
        expect(screen.getByText(/電話応対中のお客様の予約を入力しています/)).toBeVisible()
      }
      unmount()
    }
  })

  it('必要な条件が揃うまで候補を出さず、揃うと5候補を表示する', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '新規予約' }))
    expect(screen.getByText('日付・時間・ご用件を選ぶと候補を表示します')).toBeVisible()
    await user.type(screen.getByLabelText('日付'), '2025-05-20')
    await user.selectOptions(screen.getByLabelText('開始時間'), '14:00')
    await user.click(screen.getByRole('button', { name: '検眼・カウンセリング' }))
    expect(screen.getAllByRole('button', { name: /14:00 〜 15:30/ })).toHaveLength(1)
  })

  it('電話番号サジェストを選択すると氏名と電話番号が入力される', async () => {
    const user = userEvent.setup()
    render(<App initialView="booking" />)
    await user.type(screen.getByLabelText('電話番号'), '090000000')
    await user.click(screen.getByRole('button', { name: /佐藤 みどり/ }))
    expect(screen.getByLabelText('お名前')).toHaveValue('佐藤 みどり')
    expect(screen.getByLabelText('電話番号')).toHaveValue('090-0000-0000')
  })

  it('未登録顧客を登録して通知を表示する', async () => {
    const user = userEvent.setup()
    render(<App initialView="booking" />)
    await user.type(screen.getByLabelText('お名前'), '高橋 あかり')
    await user.click(screen.getByRole('button', { name: '情報を検索' }))
    await user.type(screen.getByLabelText('登録氏名'), '高橋 あかり')
    await user.type(screen.getByLabelText('登録電話番号'), '090-1111-2222')
    await user.selectOptions(screen.getByLabelText('登録性別'), '女性')
    await user.selectOptions(screen.getByLabelText('登録年代'), '30代')
    await user.type(screen.getByLabelText('登録生年月日'), '1990-04-12')
    await user.type(screen.getByLabelText('登録会員ID'), 'M-9001')
    await user.type(screen.getByLabelText('登録最終来店日'), '2025-08-20')
    await user.type(screen.getByLabelText('登録用件'), 'メガネの作製')
    await user.click(screen.getByRole('button', { name: '顧客を登録する' }))
    expect(screen.getByText('顧客情報を登録しました')).toBeVisible()
  })

  it('ヘッダー、サポート、一覧更新、カルテ編集を通知する', async () => {
    const user = userEvent.setup()
    render(<App initialView="booking" />)
    await user.click(screen.getByRole('button', { name: '通話メモ' }))
    expect(screen.getByText('通話メモを保存しました')).toBeVisible()

    await user.click(screen.getByRole('link', { name: 'EYEX予約 ホーム' }))
    await user.click(screen.getByRole('button', { name: 'メニュー' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'メインメニュー' })).getByRole('link', {
        name: '予約台帳',
      }),
    )
    await user.click(screen.getByRole('button', { name: '？ サポート' }))
    expect(screen.getByText('サポートを表示しました')).toBeVisible()

    await user.click(screen.getByRole('link', { name: /予約一覧/ }))
    await user.click(screen.getByRole('button', { name: '↻ 更新' }))
    expect(screen.getByText('予約一覧を更新しました')).toBeVisible()
    await user.click(screen.getByRole('link', { name: '顧客カルテ' }))
    await user.click(screen.getByRole('button', { name: '顧客情報を編集' }))
    expect(screen.getByText('顧客情報を編集しました')).toBeVisible()
    const editButtons = screen.getAllByRole('button', { name: '編集' })
    const noteEdit = editButtons.at(-1)
    if (!noteEdit) throw new Error('note edit button is missing')
    await user.click(noteEdit)
    expect(screen.getByText('メモ編集を開きました')).toBeVisible()
  })

  it('予約確定後に一覧通知と予約行を表示する', async () => {
    const user = userEvent.setup()
    render(<App initialView="booking" />)
    await user.type(screen.getByLabelText('電話番号'), '090000000')
    await user.click(screen.getByRole('button', { name: /佐藤 みどり/ }))
    await user.type(screen.getByLabelText('日付'), '2025-05-20')
    await user.selectOptions(screen.getByLabelText('開始時間'), '14:00')
    await user.click(screen.getByRole('button', { name: '検眼・カウンセリング' }))
    await user.click(screen.getByRole('button', { name: '14:00 〜 15:30' }))
    await user.click(screen.getByRole('button', { name: '予約を確定する' }))
    expect(screen.getByText('予約を確定しました')).toBeVisible()
    expect(screen.getAllByText('佐藤 みどり 様').length).toBeGreaterThan(0)
  })

  it('録音を停止して再開できる', async () => {
    const user = userEvent.setup()
    render(<App initialView="booking" />)
    await user.click(screen.getByRole('button', { name: '録音を一時停止' }))
    expect(screen.getByRole('button', { name: '録音を再開' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(screen.getByRole('button', { name: '録音を再開' }))
    expect(screen.getByRole('button', { name: '録音を一時停止' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('カルテの4タブを切り替えられる', async () => {
    const user = userEvent.setup()
    render(<App initialView="customer" />)
    for (const label of ['来店履歴', 'メガネ情報', 'コンタクト情報', '会計履歴']) {
      await user.click(screen.getByRole('tab', { name: label }))
      expect(screen.getByRole('tabpanel')).toBeVisible()
    }
  })

  it('担当者フィルターとメニューの主要遷移を使える', async () => {
    const user = userEvent.setup()
    render(<App initialView="list" />)
    await user.selectOptions(screen.getByLabelText('担当者で絞り込み'), '田中 健一')
    expect(screen.getAllByText('田中 健一').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'メニュー' }))
    expect(screen.getByRole('dialog', { name: 'メインメニュー' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'メニューを閉じる' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ホームの日付カレンダーを開閉し、予約入力を一時保存できる', async () => {
    const user = userEvent.setup()
    window.history.replaceState({}, '', '/')
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'カレンダーを開く' }))
    expect(screen.getByRole('dialog', { name: '日付カレンダー' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '21日' }))
    expect(screen.queryByRole('dialog', { name: '日付カレンダー' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '新規予約' }))
    await user.click(screen.getByRole('button', { name: '一時保存する' }))
    expect(screen.getByText('入力内容を一時保存しました')).toBeVisible()
  })

  it('台帳で詳細を開き変更保存して取消できる', async () => {
    const user = userEvent.setup()
    render(<App initialView="ledger" />)
    await user.click(screen.getByRole('button', { name: /佐藤 みどり/ }))
    await user.click(screen.getByRole('button', { name: '予約を変更' }))
    await user.click(screen.getByRole('button', { name: '変更を保存' }))
    expect(screen.getByText('予約内容を変更しました')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.getByText('予約をキャンセルしました')).toBeVisible()
    expect(screen.queryByRole('button', { name: /佐藤 みどり/ })).not.toBeInTheDocument()
  })
})
