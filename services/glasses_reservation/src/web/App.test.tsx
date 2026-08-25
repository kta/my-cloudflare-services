import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('glasses reservation app', () => {
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
    await user.click(screen.getByRole('button', { name: '顧客を登録する' }))
    expect(screen.getByText('顧客情報を登録しました')).toBeVisible()
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
