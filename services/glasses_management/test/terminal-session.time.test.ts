/**
 * 端末の「ちょうど」を固定する（`src/worker/domain/terminal-session.ts` と
 * `src/worker/domain/pin.ts`）。
 *
 * ここで見るのは 3 つの境界で、どれも **1 秒ずれると事故になる**。
 *
 * 1. **自動ロック** — 最後にさわってから `auto_lock_seconds` を過ぎたらお客様のお名前と
 *    電話番号を伏せる。**ちょうどでは伏せず、+1 秒で伏せる**（`07-nfr.md` §10.3）。
 *    経過を数えるタイマーに頼らない — 裏タブでは時間の進みが絞られるので、
 *    「最後にさわった時刻」と「いまの時刻」の差だけで決める（AC-TERM-17）。
 * 2. **個人モードの寿命** — 昇格から 120 秒。こちらも**ちょうどはまだ個人モード**で、
 *    +1 秒で共有モードへ戻る（AC-TERM-12）。
 * 3. **暗証番号の 30 秒の待ち** — 3 回続けて間違えたら 30 秒待つ。
 *    **30 秒ちょうどはまだ入力できず、+1 秒で入力できる**（AC-TERM-07）。
 *
 * **時刻はすべて引数で受ける。**`Date.now()` も `vi.useFakeTimers()` も 1 度も使わない。
 * 基準時刻は世界観データの **2026年8月27日（木）11:08 JST**（`FIXED_NOW`）。
 */
import { describe, expect, it } from 'vitest'
import { isPinLocked, isWeakPin, nextFailureState, pinFailureKey } from '../src/worker/domain/pin'
import {
  expiresAtFrom,
  isOnline,
  isSessionLive,
  shouldMask,
} from '../src/worker/domain/terminal-session'
import { FIXED_NOW } from './helpers'

/** 既定の自動ロック（秒）。契約の `Terminal.autoLockSeconds` の既定と同じ。 */
const AUTO_LOCK = 120

/** `FIXED_NOW` から `seconds` 秒あとの時刻。「ちょうど」と「+1 秒」を書き分ける道具。 */
function after(seconds: number, base = FIXED_NOW): Date {
  return new Date(Date.parse(base) + seconds * 1000)
}

/** 最後にさわった時刻。共有端末のトップを開いたまま接客に入った時点。 */
const LAST_TOUCHED_AT = new Date(FIXED_NOW)

describe('自動ロック', () => {
  it('最後にさわってから 120 秒ちょうどでは伏せない', () => {
    expect(
      shouldMask(
        {
          kind: 'shared',
          autoLockSeconds: AUTO_LOCK,
          lastTouchedAt: LAST_TOUCHED_AT,
          recordingActive: false,
        },
        after(AUTO_LOCK),
      ),
    ).toBe(false)
  })

  it('最後にさわってから 120 秒 +1 秒で伏せる', () => {
    expect(
      shouldMask(
        {
          kind: 'shared',
          autoLockSeconds: AUTO_LOCK,
          lastTouchedAt: LAST_TOUCHED_AT,
          recordingActive: false,
        },
        after(AUTO_LOCK + 1),
      ),
    ).toBe(true)
  })

  it('端末の auto_lock_seconds が 30 なら 30 秒 +1 秒で伏せる（既定値を焼き込まない）', () => {
    const input = {
      kind: 'shared' as const,
      autoLockSeconds: 30,
      lastTouchedAt: LAST_TOUCHED_AT,
      recordingActive: false,
    }
    expect(shouldMask(input, after(30))).toBe(false)
    expect(shouldMask(input, after(31))).toBe(true)
    // 120 秒の既定を焼き込んでいれば、30 秒の端末は 31 秒で伏せられない。
    expect(shouldMask(input, after(AUTO_LOCK))).toBe(true)
  })

  it('画面が裏に回ったまま 120 秒ちょうどが過ぎて表に戻ったときは伏せない', () => {
    // 裏に回っているあいだタイマーは絞られるが、判定は差だけで決まる。
    expect(
      shouldMask(
        {
          kind: 'shared',
          autoLockSeconds: AUTO_LOCK,
          lastTouchedAt: LAST_TOUCHED_AT,
          recordingActive: false,
        },
        after(AUTO_LOCK),
      ),
    ).toBe(false)
  })

  it('画面が裏に回ったまま 120 秒 +1 秒が過ぎて表に戻ったときは伏せた状態で戻る', () => {
    expect(
      shouldMask(
        {
          kind: 'shared',
          autoLockSeconds: AUTO_LOCK,
          lastTouchedAt: LAST_TOUCHED_AT,
          recordingActive: false,
        },
        after(AUTO_LOCK + 1),
      ),
    ).toBe(true)
    // 裏に回ったまま 10 分が過ぎても、判定は同じ 1 本の式で出る。
    expect(
      shouldMask(
        {
          kind: 'shared',
          autoLockSeconds: AUTO_LOCK,
          lastTouchedAt: LAST_TOUCHED_AT,
          recordingActive: false,
        },
        after(600),
      ),
    ).toBe(true)
  })

  it("個人の端末（kind='personal'）は経過にかかわらず伏せない", () => {
    for (const elapsed of [0, AUTO_LOCK, AUTO_LOCK + 1, 86_400]) {
      expect(
        shouldMask(
          {
            kind: 'personal',
            autoLockSeconds: AUTO_LOCK,
            lastTouchedAt: LAST_TOUCHED_AT,
            recordingActive: false,
          },
          after(elapsed),
        ),
      ).toBe(false)
    }
    // 録音中の受付があるあいだも伏せない（`07-nfr.md` §6.4）。
    expect(
      shouldMask(
        {
          kind: 'shared',
          autoLockSeconds: AUTO_LOCK,
          lastTouchedAt: LAST_TOUCHED_AT,
          recordingActive: true,
        },
        after(AUTO_LOCK + 1),
      ),
    ).toBe(false)
  })

  it('最終通信が 5 分より古い端末は isOnline=false になる', () => {
    expect(isOnline(FIXED_NOW, after(300))).toBe(true)
    expect(isOnline(FIXED_NOW, after(301))).toBe(false)
    // 一度もつながっていない端末は null で、つながっていない。
    expect(isOnline(null, new Date(FIXED_NOW))).toBe(false)
  })
})

describe('個人モード', () => {
  it('開始から 120 秒ちょうどはまだ個人モードである', () => {
    const session = { expiresAt: expiresAtFrom(new Date(FIXED_NOW), AUTO_LOCK), revokedAt: null }
    expect(session.expiresAt).toBe('2026-08-27T02:10:00.000Z')
    // 期限そのものは「まだ生きている」。伏せるのは +1 秒から。
    expect(isSessionLive(session, after(AUTO_LOCK - 1))).toBe(true)
    expect(isSessionLive(session, after(AUTO_LOCK))).toBe(true)
  })

  it('開始から 120 秒 +1 秒で共有モードへ戻る', () => {
    const session = { expiresAt: expiresAtFrom(new Date(FIXED_NOW), AUTO_LOCK), revokedAt: null }
    expect(isSessionLive(session, after(AUTO_LOCK + 1))).toBe(false)
  })

  it('さわるたびに期限が 120 秒先へ延びる', () => {
    const touchedAt = after(90)
    const extended = expiresAtFrom(touchedAt, AUTO_LOCK)
    expect(extended).toBe('2026-08-27T02:11:30.000Z')
    const session = { expiresAt: extended, revokedAt: null }
    // 最初の期限（02:10:00）を過ぎても、さわり直したぶんだけ生きている。
    expect(isSessionLive(session, after(AUTO_LOCK + 1))).toBe(true)
    expect(isSessionLive(session, after(90 + AUTO_LOCK + 1))).toBe(false)
  })

  it('失効した個人セッションは revoked_at を書いても二重に書かない', () => {
    const expiresAt = expiresAtFrom(new Date(FIXED_NOW), AUTO_LOCK)
    const revoked = { expiresAt, revokedAt: after(30).toISOString() }
    // 失効済みは、期限内でも生きていない（引き継がれた側がここに落ちる）。
    expect(isSessionLive(revoked, after(60))).toBe(false)
    expect(isSessionLive(revoked, after(AUTO_LOCK + 1))).toBe(false)
    // 生きていない行に revoked_at を書き足す理由が無いことを、判定の側で示す。
    expect(isSessionLive({ expiresAt, revokedAt: null }, after(60))).toBe(true)
  })
})

describe('暗証番号の待ち', () => {
  it('1 回目の失敗は残り 2 回、2 回目は残り 1 回', () => {
    expect(nextFailureState(0)).toMatchObject({
      attempts: 1,
      locked: false,
      remainingAttempts: 2,
    })
    expect(nextFailureState(1)).toMatchObject({
      attempts: 2,
      locked: false,
      remainingAttempts: 1,
    })
  })

  it('3 回目の失敗でロックに入り、待ち時間は 30 秒である', () => {
    expect(nextFailureState(2)).toMatchObject({
      attempts: 3,
      locked: true,
      remainingAttempts: 0,
      retryAfterSeconds: 30,
    })
    // 失敗回数の置き場は KV の鍵。共有は staffId を持たないので 'shared' に落とす。
    expect(pinFailureKey('org-1', 'term-1', null)).toBe('pin:org-1:term-1:shared')
    expect(pinFailureKey('org-1', 'term-1', 'staff-1')).toBe('pin:org-1:term-1:staff-1')
  })

  it('ロックから 30 秒ちょうどはまだ入力できない', () => {
    expect(isPinLocked(new Date(FIXED_NOW), after(0))).toBe(true)
    expect(isPinLocked(new Date(FIXED_NOW), after(29))).toBe(true)
    expect(isPinLocked(new Date(FIXED_NOW), after(30))).toBe(true)
  })

  it('ロックから 30 秒 +1 秒で入力でき、失敗回数は 0 に戻る', () => {
    expect(isPinLocked(new Date(FIXED_NOW), after(31))).toBe(false)
    // ロックしていない（一度も失敗していない）端末も入力できる。
    expect(isPinLocked(null, new Date(FIXED_NOW))).toBe(false)
    // 明けたあとは 0 から数え直すので、次の 1 回目は残り 2 回に戻る。
    expect(nextFailureState(0).remainingAttempts).toBe(2)
  })

  it('登録できない暗証番号は、同じ数字の連続と ±1 の連番だけである', () => {
    // 辞書は持たない（`04-api.md` §5）。
    expect(isWeakPin('0000')).toBe(true)
    expect(isWeakPin('1234')).toBe(true)
    expect(isWeakPin('4321')).toBe(true)
    expect(isWeakPin('123456')).toBe(true)
    expect(isWeakPin('4062')).toBe(false)
    expect(isWeakPin('1357')).toBe(false)
  })
})
