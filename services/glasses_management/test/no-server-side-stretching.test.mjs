/*
 * 暗証番号のストレッチングが Worker 側へ戻っていないことを、ソースを読んで見張る。
 *
 * デプロイ先の workerd は PBKDF2 の iterations が 10 万回までで、既定の 60 万回を
 * サーバで回すと実機でだけ `NotSupportedError` になる。ローカルの workerd はこの
 * 上限を課さないため、実行して確かめることができない。静的に見張るしかない。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const worker = readFileSync(new URL('../src/worker/index.ts', import.meta.url), 'utf8')

test('Worker は暗証番号を自分で伸ばさない（ブラウザが伸ばした値を受け取る）', () => {
  assert.ok(
    !/\bstretchPin\s*\(/.test(worker),
    'src/worker/index.ts が stretchPin を呼んでいる。' +
      'workerd の PBKDF2 は 10 万回までなので、伸ばすのはブラウザ側の仕事である。',
  )
})
