# glasses_management エージェント指示

このファイルはルート `AGENTS.md` を継承し、このサービス固有の規約を定める。

## 役割

`glasses_management` は EYEX 予約ドメインの同一オリジン SPA/API Worker と専用 D1/R2/KV
を所有する。`admin` が認証・組織の正であり、組織同期は canonical id と単調増加 revision をそのまま受ける。到着順が逆転した古い snapshot は適用しない。認証プロキシも admin 境界を利用する。
旧予約モックは廃止済みであり、このサービスへコードを持ち込まない。

## 構成と入口

| 場所 | 責務 |
|---|---|
| `src/worker/index.ts` | Hono route chain と公開 health endpoint |
| `src/web/main.tsx` / `App.tsx` | 同一 Worker から配信する React SPA shell |
| `test/` | Workers integration tests |
| `wrangler.jsonc` | D1、R2 (`RECORDINGS`)、KV (`SHORT_LIVED`)、assets 設定 |

## 非交渉の境界

- 業務行は JWT の `org` による `organization_id` scope を必ず適用する（後続 API 含む）。
- API 契約は `packages/contracts/src/glasses_management.ts` の Zod 単一ソースとする。
- `admin` が組織・認証の源泉であり、このサービスは同期コピーだけを持つ。組織 ID は admin の canonical 形式（非 UUID を含む）を保持する。
- 録音本体は非公開 R2、短期状態は `SHORT_LIVED` KV に置く。通知はこのタスクでは実装しない。
- SPA/API は同一 origin を維持し、CORS や別 API origin を追加しない。
- 色、font、radius は `@app/ui` と `theme.css` のセマンティック token 経由だけを使う。

## コマンド

```sh
pnpm --filter @app/glasses_management dev
pnpm --filter @app/glasses_management build
pnpm --filter @app/glasses_management typecheck
pnpm --filter @app/glasses_management test
pnpm --filter @app/glasses_management test:web
pnpm --filter @app/glasses_management test:all
pnpm --filter @app/glasses_management cf-typegen
```

新しい route・業務挙動は、production code より先に対応テストを追加する。Worker coverage は
各指標 80%以上、web coverage は各指標 60%以上を維持する。secret、deploy、push、commit は
ルート規約に従う。
