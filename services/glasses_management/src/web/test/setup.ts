import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/*
 * jsdom の `localStorage` は Node の実験的な localStorage に覆われて `undefined` になる
 * （`--localstorage-file` が無い、という警告が出る）。App は端末の使い方の記憶に
 * `localStorage` を使うので、これが無いと業務開始（使い方 → 置き場所 → 暗証番号）の
 * 経路がテストから触れなくなる。実際その経路には web テストが 1 本も無かった。
 * 中身だけの Storage を置いて、経路を試せるようにする。
 */
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key)
    },
    setItem: (key, value) => {
      store.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryStorage,
  })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage })
}

afterEach(() => cleanup())
