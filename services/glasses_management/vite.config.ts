import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const e2eStatePath = process.env.E2E_STATE_PATH
const persistState = e2eStatePath ? { path: e2eStatePath } : true

// 1 つの dev サーバ(:5175)が両方を動かす。Vite が SPA を配り、Worker(src/worker)は
// wrangler.jsonc のバインディングを持ったまま実 workerd で動く — proxy 無し・同一オリジン。
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare({ persistState })],
  /*
   * admin は service binding で `https://glasses-management.internal/api/internal/...` を
   * 叩いて組織と担当店舗を押し込む（`services/admin/src/worker/sync.ts:16,93`）。
   * dev では Vite がその Host を弾くので、**明示的に通す**。
   * 無いあいだ `make dev/all` では組織も担当店舗も届かず、業務 API が
   * 503 `not_synced` を返し続けていた（実装不足の洗い出し foundation-12 / T-018）。
   */
  server: { port: 5175, allowedHosts: ['glasses-management.internal'] },
})
