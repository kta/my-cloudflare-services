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

# NOTE: example_service は雛形なので本番 deploy ターゲットを持たない(CI matrix からも除外)。
## deploy/admin: build + deploy the admin Worker (SPA + API)
deploy/admin:
	pnpm --filter @app/admin run deploy

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

.PHONY: init dev/example_service dev/admin dev/glasses_management dev/notifier dev/all db/generate db/migrate/local db/migrate/remote db/seed/local db/reset/local \
	build test typecheck lint check dev-vars deploy/admin \
	worktree/new worktree/rm help
