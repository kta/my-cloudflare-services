/**
 * 録音の純関数を固定する（`src/worker/domain/recording.ts`）。D1 も R2 も KV も触らない。
 *
 * ここで見るのは 4 つである。
 *
 * 1. **状態遷移** — `recording` → `uploading` → `stored`、途中で落ちたら `failed`、
 *    端末が送り直したら `failed` → `uploading`。**`stored` と `deleted` からは動かせない**。
 *    許されない遷移は例外にせず値で返す（呼び出し側が 409 `invalid_transition` にする）。
 * 2. **録音番号** — `EY-R-NNNN`。組織で通しの 4 桁ゼロ埋めで、9999 を越えたら 5 桁になる。
 *    予約番号（`EY-YYMM-NNNN`）とは別の採番系統で、お知らせの本文に載るのはこちらである。
 * 3. **R2 のキー** — `recordings/{org}/{store}/{YYYY}/{MM}/{id}.{ext}`。前置 `recordings/` で
 *    手書きメモの `notes/` と分け、**`id` から決まる**ので再送しても二重に置かれない。
 *    年月は **JST** で切る。UTC のまま切ると月末の夜に録った受付が翌月の棚に落ちる。
 * 4. **お知らせの本文** — 3 回続けて失敗したときに何を伝えるか。**失われていないものを先に言う**。
 *
 * 時刻はすべて引数で受ける。`Date.now()` を 1 度も呼ばない。
 */
import { AlertCode } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  nextRecordingCode,
  nextState,
  r2KeyFor,
  uploadFailedAlert,
} from '../src/worker/domain/recording'

/** 固定の識別子。キーの組み立てを見るだけなので、毎回同じ値でよい。 */
const ORG = '3f0c9f4a-1b2c-4d5e-8f90-1a2b3c4d5e6f'
const STORE = '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d'
const REC_ID = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f'

/** モックの ALERTS に出ている端末名（`terminals.name`）。P10 まではこの列が無いので null になる。 */
const TERMINAL = '銀座店 レジ横iPad'

describe('nextState', () => {
  it('recording から uploading へ進める', () => {
    expect(nextState('recording', 'uploading')).toEqual({ ok: true, state: 'uploading' })
  })

  it('uploading から stored へ進める', () => {
    expect(nextState('uploading', 'stored')).toEqual({ ok: true, state: 'stored' })
  })

  it('uploading から failed へ落とせる', () => {
    expect(nextState('uploading', 'failed')).toEqual({ ok: true, state: 'failed' })
    // 録り始めたところで止まることもある（マイクが途中で切れた・端末が落ちた）。
    expect(nextState('recording', 'failed')).toEqual({ ok: true, state: 'failed' })
  })

  it('failed から uploading へ戻せる（再送）', () => {
    expect(nextState('failed', 'uploading')).toEqual({ ok: true, state: 'uploading' })
  })

  it('stored から recording へは戻せない', () => {
    expect(nextState('stored', 'recording')).toEqual({ ok: false, error: 'invalid_transition' })
    // 保管庫に入ったものを「送り直す」経路も無い（同じキーを上書きする理由が無い）。
    expect(nextState('stored', 'uploading')).toEqual({ ok: false, error: 'invalid_transition' })
    expect(nextState('stored', 'failed')).toEqual({ ok: false, error: 'invalid_transition' })
  })

  it('deleted からはどこへも動かせない', () => {
    for (const wanted of ['recording', 'uploading', 'stored', 'failed'] as const) {
      expect(nextState('deleted', wanted)).toEqual({ ok: false, error: 'invalid_transition' })
    }
  })

  it('許されない遷移は invalid_transition を返し、例外を投げない', () => {
    // 本体を受け取らずに保管済みへ飛ばせない。
    expect(nextState('recording', 'stored')).toEqual({ ok: false, error: 'invalid_transition' })
    // 削除は `canDelete()` を通る別の経路なので、遷移としては許さない。
    expect(nextState('stored', 'deleted')).toEqual({ ok: false, error: 'invalid_transition' })
    expect(nextState('failed', 'stored')).toEqual({ ok: false, error: 'invalid_transition' })
    // 同じ状態への据え置きも遷移ではない。
    expect(nextState('uploading', 'uploading')).toEqual({ ok: false, error: 'invalid_transition' })
    // 500 にすると、端末の再送が落ちた原因を受付が読めなくなる。
    expect(() => nextState('deleted', 'stored')).not.toThrow()
  })
})

describe('nextRecordingCode', () => {
  it('1 本も無い組織では EY-R-0001 を返す', () => {
    expect(nextRecordingCode(null)).toBe('EY-R-0001')
  })

  it('EY-R-1482 の次は EY-R-1483', () => {
    // モックの ALERTS に出ている番号。組織で通しなので、店舗をまたいでも続く。
    expect(nextRecordingCode('EY-R-1482')).toBe('EY-R-1483')
    expect(nextRecordingCode('EY-R-0001')).toBe('EY-R-0002')
    expect(nextRecordingCode('EY-R-0099')).toBe('EY-R-0100')
  })

  it('EY-R-9999 の次は EY-R-10000（桁が伸びても書式は保つ）', () => {
    expect(nextRecordingCode('EY-R-9999')).toBe('EY-R-10000')
    expect(nextRecordingCode('EY-R-10000')).toBe('EY-R-10001')
    // 頭を切らない。切ると 5 桁の組織が 0001 へ巻き戻り、一意 index に必ず弾かれ続ける。
    expect(nextRecordingCode('EY-R-99999')).toBe('EY-R-100000')
  })
})

describe('r2KeyFor', () => {
  it('recordings/ の前置と年月で分ける（手書きメモの notes/ と混ざらない）', () => {
    const key = r2KeyFor({
      organizationId: ORG,
      storeId: STORE,
      id: REC_ID,
      contentType: 'audio/mp4',
      createdAt: '2026-08-27T02:08:00.000Z',
    })
    expect(key).toBe(`recordings/${ORG}/${STORE}/2026/08/${REC_ID}.m4a`)
    expect(key.startsWith('notes/')).toBe(false)

    // 形式ごとの拡張子。再生側が Content-Type を推せるように 1 対 1 にする。
    const ext = (contentType: 'audio/mp4' | 'audio/webm' | 'audio/mpeg') =>
      r2KeyFor({
        organizationId: ORG,
        storeId: STORE,
        id: REC_ID,
        contentType,
        createdAt: '2026-08-27T02:08:00.000Z',
      }).split('.')[1]
    expect(ext('audio/mp4')).toBe('m4a')
    expect(ext('audio/webm')).toBe('webm')
    expect(ext('audio/mpeg')).toBe('mp3')

    // 年月は JST で切る。UTC 8月31日 15:00 は JST 9月1日 00:00 なので 2026/09 の棚。
    const at = (createdAt: string) =>
      r2KeyFor({
        organizationId: ORG,
        storeId: STORE,
        id: REC_ID,
        contentType: 'audio/mp4',
        createdAt,
      })
    expect(at('2026-08-31T14:59:59.999Z')).toContain('/2026/08/')
    expect(at('2026-08-31T15:00:00.000Z')).toContain('/2026/09/')
    // 年をまたぐ夜（UTC 12月31日 15:00 ＝ JST 1月1日 00:00）。
    expect(at('2026-12-31T15:00:00.000Z')).toContain('/2027/01/')
    // うるう年の 2月29日（JST）。UTC のまま読むと 2月28日 のままになる。
    expect(at('2028-02-28T15:30:00.000Z')).toContain('/2028/02/')
  })

  it('同じ録音 id からは必ず同じキーが出る（再送が二重に置かれない）', () => {
    const first = r2KeyFor({
      organizationId: ORG,
      storeId: STORE,
      id: REC_ID,
      contentType: 'audio/mp4',
      createdAt: '2026-08-27T02:08:00.000Z',
    })
    const retried = r2KeyFor({
      organizationId: ORG,
      storeId: STORE,
      id: REC_ID,
      contentType: 'audio/mp4',
      createdAt: '2026-08-27T02:08:00.000Z',
    })
    expect(retried).toBe(first)

    // 別の録音は必ず別のキー。1 録音 1 キーが第 2 の冪等キーである。
    const other = r2KeyFor({
      organizationId: ORG,
      storeId: STORE,
      id: '9e8d7c6b-5a49-4382-91f0-1e2d3c4b5a69',
      contentType: 'audio/mp4',
      createdAt: '2026-08-27T02:08:00.000Z',
    })
    expect(other).not.toBe(first)
  })
})

describe('uploadFailedAlert', () => {
  it('成立予約は「EY-R-1482　田中 花子 様。ご予約は成立しています。」を本文にする', () => {
    const alert = uploadFailedAlert({
      code: 'EY-R-1482',
      customerName: '田中 花子',
      hasReservation: true,
      terminalName: null,
    })
    expect(alert.body).toBe('EY-R-1482　田中 花子 様。ご予約は成立しています。')
  })

  it('破棄受付は「受付の記録は残っています。」に差し替える', () => {
    // 予約が無いので「ご予約は成立しています。」とは言えない（言うと嘘になる）。
    const alert = uploadFailedAlert({
      code: 'EY-R-1483',
      customerName: '山口 真央',
      hasReservation: false,
      terminalName: null,
    })
    expect(alert.body).toBe('EY-R-1483　山口 真央 様。受付の記録は残っています。')

    // お客様がまだ分からない受付（ウォークイン）では、お名前の一句ごと落とす。
    expect(
      uploadFailedAlert({
        code: 'EY-R-1484',
        customerName: null,
        hasReservation: false,
        terminalName: null,
      }).body,
    ).toBe('EY-R-1484　受付の記録は残っています。')
  })

  it('端末名があれば「銀座店 レジ横iPad に残っています」を後ろに足す', () => {
    // 音声の実体はその端末にしか無い。別の端末から「もう一度送る」を押しても直らないので、
    // どの端末へ行けばよいかを本文に必ず入れる（`07-nfr.md` §5.6）。
    const alert = uploadFailedAlert({
      code: 'EY-R-1482',
      customerName: '田中 花子',
      hasReservation: true,
      terminalName: TERMINAL,
    })
    expect(alert.body).toBe(
      'EY-R-1482　田中 花子 様。ご予約は成立しています。　銀座店 レジ横iPad に残っています',
    )
  })

  it('端末名が null なら端末の一句を落とす（P10 まではこちらになる）', () => {
    // `terminals` 表は P10（013-terminals-and-audit）まで無く、
    // `reception_sessions.terminal_id` は常に NULL である。
    const alert = uploadFailedAlert({
      code: 'EY-R-1482',
      customerName: '田中 花子',
      hasReservation: true,
      terminalName: null,
    })
    expect(alert.body).not.toContain('に残っています')
    expect(alert.body.endsWith('ご予約は成立しています。')).toBe(true)
  })

  it('本文が 120 文字を超えないよう、お客様名を先に切り詰める', () => {
    const alert = uploadFailedAlert({
      code: 'EY-R-1482',
      customerName: 'あ'.repeat(200),
      hasReservation: true,
      terminalName: TERMINAL,
    })
    // 削るのはお名前だけ。番号・成立文・端末名はどれも落とさない
    // （落とすと「どの録音か」「どこへ行けばよいか」が読めなくなる）。
    expect(alert.body).toBe(
      `EY-R-1482　${'あ'.repeat(74)}… 様。ご予約は成立しています。　銀座店 レジ横iPad に残っています`,
    )
    expect([...alert.body].length).toBe(120)

    // 収まる長さのお名前には手を触れない。
    expect(
      uploadFailedAlert({
        code: 'EY-R-1482',
        customerName: '田中 花子',
        hasReservation: true,
        terminalName: TERMINAL,
      }).body,
    ).not.toContain('…')
  })

  it('見出しは常に「録音の保存に3回失敗しました」で severity は action', () => {
    for (const hasReservation of [true, false]) {
      const alert = uploadFailedAlert({
        code: 'EY-R-1482',
        customerName: '田中 花子',
        hasReservation,
        terminalName: TERMINAL,
      })
      expect(alert.title).toBe('録音の保存に3回失敗しました')
      // モックの ALERTS で「対応が必要」の札が付いているのはこの 1 件だけである。
      expect(alert.severity).toBe('action')
      expect(alert.code).toBe('recording.upload_failed')
      // 契約の許可リストと `title` の上限（60 文字）の内側に収まっていること。
      expect(AlertCode.options).toContain(alert.code)
      expect([...alert.title].length).toBeLessThanOrEqual(60)
    }
  })

  it('端末名が伸びても本文は 120 文字を越えない（お知らせの一覧を 500 にしない）', () => {
    // 削るのはお客様名だけ、という決めのままだと、端末名が長い組織では
    // **お名前を全部落としても**固定の一句だけで 120 文字を越えられる。
    // 越えた本文は D1 に入ってしまい、`Alert.parse` を通す `GET /api/staff/alerts` が
    // 組織まるごと 500 になる。最後に本文そのものを 120 文字で切る。
    const alert = uploadFailedAlert({
      code: 'EY-R-10000',
      customerName: '田中 花子',
      hasReservation: true,
      terminalName: '銀座'.repeat(60),
    })
    expect([...alert.body].length).toBeLessThanOrEqual(120)
    // どの録音の話かは切り落とさない（番号は本文の先頭に残る）。
    expect(alert.body.startsWith('EY-R-10000')).toBe(true)
  })
})
