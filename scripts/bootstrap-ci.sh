#!/usr/bin/env bash
# GitHub Environment (staging / production) と secrets を用意する。
#
# Worker 用の共有 secret は生成するだけで、人は値を知らなくてよい。人の手が要るのは
# Cloudflare の API トークンと R2 アクセスキーの発行だけ(S3 互換 backend は
# Cloudflare の API トークンでは認証できないため、R2 のアクセスキーが別に要る)。
#
# 値の渡し方は 2 通り。環境変数が設定されていればそれを使い、無ければ対話で聞く。
#
#   export CLOUDFLARE_API_TOKEN=...
#   export CLOUDFLARE_ACCOUNT_ID=...
#   export R2_STATE_ACCESS_KEY_ID=...
#   export R2_STATE_SECRET_ACCESS_KEY=...
#   export WORKER_RESEND_API_KEY=...      # 任意(production のみ)
#   make bootstrap/ci
#
# 冪等: 既にある WORKER_* は上書きしない。AUTH_PEPPER を変えると既存の
# パスワードハッシュが全て無効になるため、保持を既定にしている。
#
# 対象を絞るときは ENVS で指定する: ENVS="staging" make bootstrap/ci
# 何も書かずに確認だけするときは DRY_RUN=1 を付ける。
set -euo pipefail

command -v gh >/dev/null || { echo "gh CLI が要ります"; exit 1; }
command -v openssl >/dev/null || { echo "openssl が要ります"; exit 1; }

REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
ENVS="${ENVS:-staging production}"
DRY_RUN="${DRY_RUN:-}"
echo "対象リポジトリ: $REPO"
echo "対象 environment: $ENVS"
[ -n "$DRY_RUN" ] && echo "※ DRY_RUN: GitHub には何も書き込まない"
echo

# DRY_RUN のときは実行せず、何をするかだけ出す。
run_gh() {
  if [ -n "$DRY_RUN" ]; then
    echo "   (dry-run) gh $*"
    # パイプで渡された値は捨てる。端末から読むと止まるので tty のときは触らない。
    [ -t 0 ] || cat >/dev/null 2>&1 || true
    return 0
  fi
  gh "$@"
}

# 環境変数が空なら対話で聞く。secret は伏せ字で読む。
ask_secret() { # <var-name> <prompt>
  local name="$1" prompt="$2" value
  value="$(eval "printf '%s' \"\${$name:-}\"")"
  if [ -n "$value" ]; then
    echo "= $name は環境変数から取得"
    return
  fi
  read -rsp "$prompt: " value; echo
  eval "$name=\$value"
}

ask_plain() { # <var-name> <prompt>
  local name="$1" prompt="$2" value
  value="$(eval "printf '%s' \"\${$name:-}\"")"
  if [ -n "$value" ]; then
    echo "= $name は環境変数から取得 ($value)"
    return
  fi
  read -rp "$prompt: " value
  eval "$name=\$value"
}

ask_secret CLOUDFLARE_API_TOKEN        "CLOUDFLARE_API_TOKEN"
ask_plain  CLOUDFLARE_ACCOUNT_ID       "CLOUDFLARE_ACCOUNT_ID"
ask_secret R2_STATE_ACCESS_KEY_ID      "R2_STATE_ACCESS_KEY_ID"
ask_secret R2_STATE_SECRET_ACCESS_KEY  "R2_STATE_SECRET_ACCESS_KEY"

# production だけで使う。staging に入れると preflight が「実メール送信の事故」として落とす。
if [ -z "${WORKER_RESEND_API_KEY:-}" ] && [[ " $ENVS " == *" production "* ]]; then
  read -rsp "WORKER_RESEND_API_KEY (production のみ・空可): " WORKER_RESEND_API_KEY; echo
fi
echo

# staging を人が開くための 2 つだけは、生成した値を画面に出す。
# GitHub からは二度と読めないので、これを控えないと staging に入れない。
REVEAL="WORKER_STAGING_ACCESS_TOKEN WORKER_STAGING_ADMIN_PASSWORD"
revealed=""

set_generated() { # <env> <name> <existing-list> <generator>
  local env="$1" name="$2" existing="$3" generator="$4" value
  if echo "$existing" | grep -qx "$name"; then
    echo "= $name は設定済み(保持)"
    return
  fi
  value="$($generator)"
  printf '%s' "$value" | run_gh secret set "$name" --repo "$REPO" --env "$env"
  if [[ " $REVEAL " == *" $name "* ]]; then
    echo "+ $name を生成: $value"
    revealed="${revealed}\n  ${name} = ${value}"
  else
    echo "+ $name を生成(値は表示しない)"
  fi
}

gen_hex32() { openssl rand -hex 32; }
gen_hex16() { openssl rand -hex 16; }

for env in $ENVS; do
  echo "--- environment: $env"
  run_gh api -X PUT "repos/${REPO}/environments/${env}" >/dev/null

  printf '%s' "$CLOUDFLARE_API_TOKEN"       | run_gh secret set CLOUDFLARE_API_TOKEN       --repo "$REPO" --env "$env"
  printf '%s' "$CLOUDFLARE_ACCOUNT_ID"      | run_gh secret set CLOUDFLARE_ACCOUNT_ID      --repo "$REPO" --env "$env"
  printf '%s' "$R2_STATE_ACCESS_KEY_ID"     | run_gh secret set R2_STATE_ACCESS_KEY_ID     --repo "$REPO" --env "$env"
  printf '%s' "$R2_STATE_SECRET_ACCESS_KEY" | run_gh secret set R2_STATE_SECRET_ACCESS_KEY --repo "$REPO" --env "$env"

  existing=$(gh secret list --repo "$REPO" --env "$env" --json name -q '.[].name' 2>/dev/null || true)

  for name in WORKER_INTERNAL_KEY WORKER_JWT_SECRET WORKER_AUTH_PEPPER WORKER_DOMAIN_AUTH_KEY; do
    set_generated "$env" "$name" "$existing" gen_hex32
  done

  if [ "$env" = "staging" ]; then
    set_generated "$env" WORKER_STAGING_ACCESS_TOKEN   "$existing" gen_hex32
    set_generated "$env" WORKER_STAGING_ADMIN_PASSWORD "$existing" gen_hex16
  fi

  if [ "$env" = "production" ] && [ -n "${WORKER_RESEND_API_KEY:-}" ]; then
    printf '%s' "$WORKER_RESEND_API_KEY" | run_gh secret set WORKER_RESEND_API_KEY --repo "$REPO" --env "$env"
    echo "+ WORKER_RESEND_API_KEY を登録"
  fi
  echo
done

echo "✅ 完了。"
if [ -n "$revealed" ]; then
  echo
  echo "⚠️  次の値は GitHub から二度と読めない。安全な場所に保存すること:"
  printf '%b\n' "$revealed"
  echo
  echo "   staging に入るとき:"
  echo "     https://admin-staging.<subdomain>.workers.dev/?gate=<WORKER_STAGING_ACCESS_TOKEN>"
  echo "     admin@example.com / <WORKER_STAGING_ADMIN_PASSWORD> でログイン"
fi
