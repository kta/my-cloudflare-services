.DEFAULT_GOAL := help
SHELL := /bin/bash

## init: install deps + generate types + apply local DB migrations + seed
init:
	pnpm install
	$(MAKE) dev-vars
	pnpm -r --if-present cf-typegen
	$(MAKE) db/migrate/local
	$(MAKE) db/seed/local

## dev-vars: copy each service's .dev.vars.example to .dev.vars (no overwrite)
dev-vars:
	@for f in services/*/.dev.vars.example; do \
		d="$${f%.example}"; \
		[ -f "$$d" ] || { cp "$$f" "$$d"; echo "created $$d"; }; \
	done

## db/seed/local: seed local D1s with dev data (services with a db:seed:local script)
db/seed/local:
	pnpm -r --if-present db:seed:local

## dev/example_service: run example_service — SPA + API in one dev server (:5173)
dev/example_service:
	pnpm --filter @app/example_service dev

## dev/admin: run admin — SPA + API in one dev server (:5174)
dev/admin:
	 pnpm --filter @app/admin dev

## dev/glasses_management: run glasses_management — SPA + API in one dev server (:5175)
dev/glasses_management:
	pnpm --filter @app/glasses_management dev

## dev/patent_research: run 典拠 — SPA + API (:5177). Start `make corpus/serve` first.
# コーパスはローカルの別プロセスなので、先に別のターミナルで `make corpus/serve` を起こす。
dev/patent_research:
	pnpm --filter @app/patent_research dev

## corpus/serve: run the patent corpus sidecar (:8899). DB=... to point at another corpus.
corpus/serve:
	INTERNAL_KEY=$${INTERNAL_KEY:-dev-internal-key} node packages/patent-corpus/src/cli.ts serve --db $${DB:-packages/patent-corpus/.data/corpus.db}

## corpus/synth: build a synthetic corpus so the app is usable before the real bulk data arrives
corpus/synth:
	mkdir -p packages/patent-corpus/.data
	node packages/patent-corpus/src/cli.ts synth --db $${DB:-packages/patent-corpus/.data/corpus.db} --count $${COUNT:-500}

## corpus/probe: ask the received media what shape it actually is (run this FIRST on real data)
corpus/probe:
	node packages/patent-corpus/src/cli.ts probe $${PATH_TO_MEDIA:?PATH_TO_MEDIA=... が要る} --sample 20

## dev/notifier: run notifier internal notification Worker (:5176)
dev/notifier:
	pnpm --filter @app/notifier dev -- --port 5176

## dev/all: run admin (:5174), example_service (:5173), glasses_management (:5175), and notifier (:5176) together
dev/all:
	@echo "starting admin (:5174) + example_service (:5173) + glasses_management (:5175) + notifier (:5176); Ctrl-C stops all"
	@trap 'kill 0' EXIT; \
		pnpm --filter @app/admin dev & \
		pnpm --filter @app/example_service dev & \
		pnpm --filter @app/glasses_management dev & \
		pnpm --filter @app/notifier dev -- --port 5176 & \
		wait

## db/generate: generate Drizzle migrations from schemas
db/generate:
	pnpm -r --if-present db:generate

## db/migrate/local: apply all migrations to local D1
db/migrate/local:
	pnpm -r --if-present db:migrate:local

## db/migrate/remote: apply all migrations to remote D1
db/migrate/remote:
	pnpm -r --if-present db:migrate:remote

## db/reset/local: throw away local D1 state, then migrate + seed from scratch
##   マイグレーションがリネーム・再生成されると、d1_migrations に残った古い名前のせいで
##   db/migrate/local が `table ... already exists` で落ち、その先の seed（旧組織 ID の
##   移行を含む）が一度も走らなくなる。ローカルの開発データだけを捨てて作り直す。
db/reset/local:
	rm -rf services/*/.wrangler/state/v3/d1
	$(MAKE) db/migrate/local
	$(MAKE) db/seed/local

## build: build all packages
build:
	pnpm -r --if-present build

## test: run the root combined test gate (Worker/web coverage + traceability)
test:
	pnpm run test

## typecheck: typecheck all packages
typecheck:
	pnpm -r --if-present typecheck

## lint: biome check
lint:
	pnpm exec biome check .

## check: lint + dependency audit + typecheck + combined test (the "definition of done")
check:
	pnpm run check

# NOTE: 手元からの deploy ターゲットは置かない。デプロイは GitHub Actions が
# Environment secrets を使って行う唯一の経路であり、緊急時は workflow_dispatch を使う
# (docs/howto/deploy.md)。手元に本番トークンを常設させないための意図的な欠落である。

## bootstrap/ci: GitHub Environment と secrets を用意する(人の手は R2 トークン発行のみ)
bootstrap/ci:
	bash scripts/bootstrap-ci.sh

## worktree/new: isolated worktree for a parallel agent (name=<branch>)
worktree/new:
	git worktree add -b "$(name)" "../$(notdir $(CURDIR))-worktrees/$(name)" HEAD
	cd "../$(notdir $(CURDIR))-worktrees/$(name)" && pnpm install

## worktree/rm: remove a worktree + its branch (name=<branch>)
worktree/rm:
	git worktree remove "../$(notdir $(CURDIR))-worktrees/$(name)" && git worktree prune && git branch -D "$(name)"

## help: list targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## //' | awk -F': ' '{printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2}'

.PHONY: init dev/example_service dev/admin dev/glasses_management dev/patent_research dev/notifier dev/all corpus/serve corpus/synth corpus/probe db/generate db/migrate/local db/migrate/remote db/seed/local db/reset/local \
	build test typecheck lint check dev-vars bootstrap/ci \
	worktree/new worktree/rm help
