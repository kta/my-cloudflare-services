import { describe, expect, it } from 'vitest'
import { maskCustomerIdentity, maskCustomerName, maskPhoneNumber } from './mask'

describe('mask', () => {
  it('お客様の氏名は元の文字を DOM に残せない伏せ字にする', () => {
    const masked = maskCustomerName('田中 花子')

    expect(masked).toBe('●●●● 様')
    expect(masked).not.toContain('田中')
    expect(masked).not.toContain('花子')
  })

  it('電話番号は先頭の識別部分だけを残して伏せる', () => {
    const masked = maskPhoneNumber('090-1234-5678')

    expect(masked).toBe('090-●●●●-●●●●')
    expect(masked).not.toContain('1234')
    expect(masked).not.toContain('5678')
  })

  it('氏名・電話以外を変えずに、表示用の識別情報だけを伏せる', () => {
    expect(
      maskCustomerIdentity({
        name: '田中 花子',
        phone: '08012345678',
        reservationNote: 'レンズ交換をご相談',
      }),
    ).toEqual({
      name: '●●●● 様',
      phone: '080-●●●●-●●●●',
      reservationNote: 'レンズ交換をご相談',
    })
  })
})
