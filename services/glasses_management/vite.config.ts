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
  server: { port: 5175 },
})
