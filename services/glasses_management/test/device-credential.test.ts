/**
 * 端末そのものの資格情報。
 *
 * 30 日の境界は「ちょうど」と「±1 秒」を押さえる。期限で入れなくなること自体が
 * 仕様であり（そのとき PIN からやり直す。パスワードは出さない）、うっかり
 * 延びていると 30 日以上放置された端末がそのまま開いてしまう。
 *
 * 時刻はすべて引数で受ける。`Date.now()` に依存させない。
 */
import { describe, expect, it } from 'vitest'
import {
  DEVICE_TTL_SECONDS,
  deviceExpiresAt,
  hashDeviceToken,
  isDeviceUsable,
  newDeviceCredential,
} from '../src/worker/domain/device-credential'

const NOW = new Date('2026-09-05T00:00:00.000Z')

describe('newDeviceCredential', () => {
  it('平文とハッシュを返し、平文は毎回違う', async () => {
    const a = await newDeviceCredential()
    const b = await newDeviceCredential()
    expect(a.token).not.toBe(b.token)
    expect(a.hash).not.toBe(b.hash)
  })

  it('平文は URL 安全で、32 バイト以上の情報量を持つ', async () => {
    const { token } = await newDeviceCredential()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(43)
  })

  it('返すハッシュは、その平文を後から引き直したものと一致する', async () => {
    const { token, hash } = await newDeviceCredential()
    expect(await hashDeviceToken(token)).toBe(hash)
  })
})

describe('hashDeviceToken', () => {
  it('同じ平文からは同じハッシュ、違う平文からは違うハッシュ', async () => {
    expect(await hashDeviceToken('a')).toBe(await hashDeviceToken('a'))
    expect(await hashDeviceToken('a')).not.toBe(await hashDeviceToken('b'))
  })
})

describe('deviceExpiresAt', () => {
  it('30 日後の ISO 文字列を返す', () => {
    expect(deviceExpiresAt(NOW)).toBe('2026-10-05T00:00:00.000Z')
    expect(DEVICE_TTL_SECONDS).toBe(30 * 24 * 60 * 60)
  })
})

describe('isDeviceUsable', () => {
  const expiresAt = deviceExpiresAt(NOW)
  const at = (offsetSeconds: number) => new Date(NOW.getTime() + offsetSeconds * 1000)

  it('期限の 1 秒前は使える', () => {
    expect(isDeviceUsable({ expiresAt, revokedAt: null }, at(DEVICE_TTL_SECONDS - 1))).toBe(true)
  })

  it('期限ちょうどは使えない', () => {
    expect(isDeviceUsable({ expiresAt, revokedAt: null }, at(DEVICE_TTL_SECONDS))).toBe(false)
  })

  it('期限の 1 秒後は使えない', () => {
    expect(isDeviceUsable({ expiresAt, revokedAt: null }, at(DEVICE_TTL_SECONDS + 1))).toBe(false)
  })

  it('失効した資格情報は期限内でも使えない', () => {
    expect(isDeviceUsable({ expiresAt, revokedAt: '2026-09-05T00:00:01.000Z' }, NOW)).toBe(false)
  })

  it('壊れた期限は使えないものとして扱う（DB を信用しきらない）', () => {
    expect(isDeviceUsable({ expiresAt: 'not-a-date', revokedAt: null }, NOW)).toBe(false)
  })
})
