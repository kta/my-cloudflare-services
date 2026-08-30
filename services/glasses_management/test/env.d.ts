import type { D1Migration } from '@cloudflare/vitest-pool-workers'

/*
 * テストの env に足すもの。
 *
 * secret（INTERNAL_KEY / JWT_SECRET / AUTH_DEV_GRANT）は `wrangler.jsonc` の vars に
 * 置いていないので、`wrangler types` が作る `Env` にはローカルの `.dev.vars` がある
 * ときだけ現れる。**CI に `.dev.vars` は無い**（gitignore。verify では作らない）ので、
 * 生成物に頼るとローカルだけ通って CI で `Property 'X' does not exist on type 'Env'`
 * になる。テストが読む値はここで明示する。
 *
 * 実際の値は `vitest.config.ts` の `miniflare.bindings` が注入する。
 */
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[]
      INTERNAL_KEY: string
      JWT_SECRET: string
      AUTH_DEV_GRANT: string
    }
  }
}
