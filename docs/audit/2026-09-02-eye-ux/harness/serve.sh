#!/bin/zsh
# usage: serve.sh <port> — 使い捨てD1 + seed + vite preview を <port> で起こす
set -e
PORT=$1
ROOT=/Users/spmini/Documents/workspace/myspace/my-cloudflare-services
SVC=$ROOT/services/glasses_management
export E2E_STATE_PATH=${E2E_STATE_PATH:-$(mktemp -d)}
export E2E_TODAY=${E2E_TODAY:-2026-08-27}
rm -rf $E2E_STATE_PATH && mkdir -p $E2E_STATE_PATH
cd $SVC
pnpm exec wrangler d1 migrations apply glasses_management --local --persist-to "$E2E_STATE_PATH" >/dev/null 2>&1
node seed.mjs >/dev/null 2>&1
exec pnpm exec vite preview --port $PORT --strictPort
