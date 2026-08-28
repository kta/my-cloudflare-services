import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { RecordingIndicator, RecordingUploadFailedScreen } from './RecordingIndicator'

/*
 * 承認済みモックに合わせた録音面。
 *
 * - 録音状態は下部の進捗バーの右端に `● mm:ss` として常時出る
 *   （BOOK-TIME / BOOK-PURPOSE-CONFLICT / BOOK-CUSTOMER / BOOK-REPEAT の
 *   4 枚すべてが footer 右端に出している）。脇の列のカードではない。
 * - 録音の許可は入力の裏で求めるので確認の全画面は持たない。保存失敗だけが
 *   全画面の状態である（EX-UPLOAD-FAILED）。
 */

/* ------------------------------------------------------------------ *
 * 下部バーの録音表示
 * ------------------------------------------------------------------ */

test('録音中は ● と経過時間だけを mm:ss で示す', () => {
  render(<RecordingIndicator state="recording" elapsedSeconds={134} />)
  expect(screen.getByTestId('recording-state')).toHaveTextContent('02:14')
})

test('状態は色だけでなく文言でも読める', () => {
  render(<RecordingIndicator state="recording" elapsedSeconds={0} />)
  expect(screen.getByRole('status', { name: 'iPad録音' })).toHaveTextContent('録音中')
})

test('録音していないときは経過時間ではなく状態語を出す', () => {
  render(<RecordingIndicator state="permission_check" elapsedSeconds={null} />)
  const status = screen.getByRole('status', { name: 'iPad録音' })
  expect(status).toHaveTextContent('権限確認')
  expect(status).not.toHaveTextContent(':')
})

test('録音を使わない受付では下部バーに録音なしと出す', () => {
  render(<RecordingIndicator state={null} elapsedSeconds={null} />)
  expect(screen.getByRole('status', { name: 'iPad録音' })).toHaveTextContent('録音なし')
})

test('60 秒以上は分に繰り上げて表示する', () => {
  render(<RecordingIndicator state="recording" elapsedSeconds={3599} />)
  expect(screen.getByTestId('recording-state')).toHaveTextContent('59:59')
})

/* ------------------------------------------------------------------ *
 * EX-UPLOAD-FAILED（全画面）
 * ------------------------------------------------------------------ */

function renderUploadFailed(
  overrides: Partial<Parameters<typeof RecordingUploadFailedScreen>[0]> = {},
) {
  const props = {
    upload: { attempt: 2, maxAttempts: 5, lastAttemptAt: '2026-08-27T05:32:36.041Z' },
    onRetryUpload: vi.fn(),
    onOpenReservation: vi.fn(),
    ...overrides,
  }
  render(<RecordingUploadFailedScreen {...props} />)
  return props
}

test('保存失敗でも予約は成立したことを先に伝える', () => {
  renderUploadFailed()
  expect(screen.getByRole('heading', { name: '予約は成立しました' })).toBeVisible()
  const panel = screen.getByRole('alert')
  expect(panel).toHaveTextContent('録音を保存できていません')
  expect(panel).toHaveTextContent(
    '予約内容は登録済みです。録音は端末内の受付セッションに保持され、通信回復後に同じ送信キーで再試行します。',
  )
})

test('再試行の回数と最終試行時刻を示す', () => {
  renderUploadFailed()
  expect(screen.getByRole('alert')).toHaveTextContent('再試行 2/5 · 最終試行 14:32')
})

test('保存失敗の操作はモックの 2 つで、主操作は今すぐ再試行', () => {
  const props = renderUploadFailed()
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
    '予約詳細を見る',
    '今すぐ再試行',
  ])
  fireEvent.click(screen.getByRole('button', { name: '今すぐ再試行' }))
  expect(props.onRetryUpload).toHaveBeenCalled()
})

/* ------------------------------------------------------------------ *
 * 共通の品質フロア
 * ------------------------------------------------------------------ */

test('全画面状態のタッチ操作は44px以上の操作面を持つ', () => {
  renderUploadFailed()
  for (const button of screen.getAllByRole('button')) {
    expect(button.className).toMatch(/min-h-(1[1-9]|[2-9][0-9])/)
  }
})

test('録音の状態も権限の結果もブラウザストレージへ書かない', async () => {
  const local = vi.spyOn(Storage.prototype, 'setItem')
  const props = renderUploadFailed()
  fireEvent.click(screen.getByRole('button', { name: '今すぐ再試行' }))
  await waitFor(() => expect(props.onRetryUpload).toHaveBeenCalled())
  expect(local).not.toHaveBeenCalled()
  local.mockRestore()
})

/*
 * 最終試行はミリ秒付きの UTC で保持されている。そのまま出すと
 * `2026-08-27T23:51:36.041Z` が画面に載り、受付の人が読める形ではなくなる
 * （承認済みモックは `14:32`）。機械可読な値は JST の時刻へ翻して出す。
 */
test('最終試行は JST の時刻で読める形にする', () => {
  renderUploadFailed()
  const panel = screen.getByRole('alert')
  expect(panel).toHaveTextContent('最終試行 14:32')
  expect(panel.textContent).not.toContain('2026-08-27T05:32:36.041Z')
})
