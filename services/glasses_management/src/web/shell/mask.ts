/*
 * 自動ロック中にお客様を識別できる文字列を残さないための表示専用変換。
 * 元データは変えず、Shell が画面へ渡す直前にこの値だけを使う。
 */

export type CustomerIdentity = {
  name: string
  phone: string
}

export function maskCustomerName(name: string): string {
  return name.trim() === '' ? 'お客様' : '●●●● 様'
}

export function maskPhoneNumber(phone: string): string {
  const digits = phone.replaceAll(/\D/g, '')
  if (digits.length < 10) {
    return '●●●●-●●●●'
  }

  const prefixLength = digits.length === 10 ? 2 : 3
  return `${digits.slice(0, prefixLength)}-●●●●-●●●●`
}

export function maskCustomerIdentity<T extends CustomerIdentity>(
  identity: T,
): Omit<T, keyof CustomerIdentity> & CustomerIdentity {
  return {
    ...identity,
    name: maskCustomerName(identity.name),
    phone: maskPhoneNumber(identity.phone),
  }
}
