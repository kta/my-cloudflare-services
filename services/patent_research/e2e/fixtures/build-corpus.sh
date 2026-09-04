#!/usr/bin/env bash
# E2E 用の合成コーパスを作って、サイドカーを起こす。
#
# 実データ（受領媒体）は E2E に持ち込まない。合成データなら決定的で、公報の本文を
# リポジトリに置かずに済み、毎回同じ結果になる。
#
# 鍵は INTERNAL_KEY 環境変数から渡す（引数に置くと ps から見える）。
set -euo pipefail

DB="${1:?corpus db path required}"
PORT="${2:-8898}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORPUS_DIR="$(cd "$HERE/../../../../packages/patent-corpus" && pwd)"

rm -f "$DB" "$DB-wal" "$DB-shm"
node "$CORPUS_DIR/src/cli.ts" synth --db "$DB" --count 12 --seed 20260904 --paragraphs 8 --sentences 2 >/dev/null
exec node "$CORPUS_DIR/src/cli.ts" serve --db "$DB" --port "$PORT"
