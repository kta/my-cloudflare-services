import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import {
  CheckToggle,
  DateField,
  DateTimeField,
  formatIsoDateJa,
  formatIsoDateTimeJa,
} from './forms'

/*
 * 日付・日時の欄。
 *
 * ネイティブの `type="date"` / `type="datetime-local"` は、値こそ ISO だが
 * **描かれる字はブラウザの地域設定で決まる**（`08/27/2026` / `mm/dd/yyyy` と、
 * 選択中の青い地色）。承認済みモックは全画面が 24 時間表記と日本語の日付なので、
 * 欄だけが米国式になると同じ値が 2 通りの姿で並ぶ。
 *
 * ここで押さえるのは 2 つ。**値の形は今までどおり ISO のまま**であること
 * （送信・検証の経路を一切動かさない）と、**読み手に見える形は日本語**である
 * こと（ISO を打つ欄の隣に日本語の読み下しを添える）。
 */

test('日付を日本語で読み下す', () => {
  expect(formatIsoDateJa('2026-08-26')).toBe('8月26日（水）')
  expect(formatIsoDateJa('2026-01-01')).toBe('1月1日（木）')
  // うるう年の 2/29 は実在する日なので読み下せる。
  expect(formatIsoDateJa('2028-02-29')).toBe('2月29日（火）')
})

test('日付として読めない値は読み下さない（打ちかけの字を勝手に補わない）', () => {
  expect(formatIsoDateJa('')).toBeUndefined()
  expect(formatIsoDateJa('2026-08')).toBeUndefined()
  expect(formatIsoDateJa('2026-02-30')).toBeUndefined()
  expect(formatIsoDateJa('2026/08/26')).toBeUndefined()
})

test('日時は 24 時間表記で読み下す', () => {
  expect(formatIsoDateTimeJa('2026-08-26T09:05')).toBe('8月26日（水） 09:05')
  // 秒が付いた ISO も読める（API から戻る値をそのまま欄に載せる経路がある）。
  expect(formatIsoDateTimeJa('2026-08-26T21:30:00')).toBe('8月26日（水） 21:30')
  expect(formatIsoDateTimeJa('2026-08-26')).toBeUndefined()
  expect(formatIsoDateTimeJa('2026-08-26T25:00')).toBeUndefined()
})

test('日付の欄はネイティブの日付入力を使わず、値は ISO のまま渡す', () => {
  const onChange = vi.fn()
  render(<DateField id="d" label="対象日" value="2026-08-26" onChange={onChange} />)

  const input = screen.getByLabelText('対象日')
  // ブラウザ既定の書式・選択色が出るのは `type` が date のときだけ。
  expect(input).toHaveAttribute('type', 'text')
  expect(input).toHaveValue('2026-08-26')
  // 端末ではテンキーを出す。何を打つ欄かはプレースホルダが形で示す。
  expect(input).toHaveAttribute('inputmode', 'numeric')
  expect(input).toHaveAttribute('placeholder', '2026-09-23')

  fireEvent.change(input, { target: { value: '2026-08-31' } })
  expect(onChange).toHaveBeenCalledWith('2026-08-31')
})

test('日付の欄は打ち込んだ ISO を日本語で読み返す', () => {
  render(<DateField id="d" label="対象日" value="2026-08-26" />)
  expect(screen.getByText('8月26日（水）')).toBeInTheDocument()
})

test('読み下しは欄の名前を汚さない', () => {
  render(<DateField id="d" label="対象日" value="2026-08-26" />)
  // 読み下しが入力の名前に混ざると、読み上げが「対象日 8月26日（水）」になる。
  expect(screen.getByLabelText('対象日')).toHaveValue('2026-08-26')
})

test('日時の欄もネイティブを使わず、値は ISO のまま渡す', () => {
  const onChange = vi.fn()
  render(<DateTimeField id="t" label="開始日時" value="2026-08-26T10:00" onChange={onChange} />)

  const input = screen.getByLabelText('開始日時')
  expect(input).toHaveAttribute('type', 'text')
  expect(input).toHaveValue('2026-08-26T10:00')
  expect(input).toHaveAttribute('placeholder', '2026-09-15T10:00')

  fireEvent.change(input, { target: { value: '2026-08-26T11:30' } })
  expect(onChange).toHaveBeenCalledWith('2026-08-26T11:30')
  expect(screen.getByText('8月26日（水） 10:00')).toBeInTheDocument()
})

/*
 * 入り切りの印。ネイティブの `<input type="checkbox">` はブラウザ既定の青
 * （macOS では `#0075ff` 前後）で塗られ、モックのどの面にも無い色が出る。
 * 役割は checkbox のまま（読み上げも Playwright の `check()` も変わらない）、
 * 塗りだけをトークンへ移す。
 */
test('入り切りの印は checkbox として読める', () => {
  const onChange = vi.fn()
  render(<CheckToggle label="営業日にする" checked onChange={onChange} />)

  const box = screen.getByRole('checkbox', { name: '営業日にする' })
  expect(box).toBeChecked()
  // ネイティブの input を使っていない（既定の青が出ない）ことを型で押さえる。
  expect(box.tagName).toBe('BUTTON')

  fireEvent.click(box)
  expect(onChange).toHaveBeenCalledWith(false)
})

test('入り切りの印は押せないとき値を変えない', () => {
  const onChange = vi.fn()
  render(<CheckToggle label="営業日にする" checked={false} disabled onChange={onChange} />)
  fireEvent.click(screen.getByRole('checkbox', { name: '営業日にする' }))
  expect(onChange).not.toHaveBeenCalled()
})
