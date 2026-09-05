import type { D1Migration } from '@cloudflare/vitest-pool-workers'

// Augment the test env with the bindings injected in vitest.config.ts.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[]
      /** コーパスサイドカーの代役（miniflare の serviceBindings で挿す）。 */
      CORPUS: Fetcher
    }
  }
}
