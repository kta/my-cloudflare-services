#!/usr/bin/env bash
# GitHub Environment (staging / production) と secrets を用意する。
#
# Worker 用の値は生成するだけで、人は知らなくてよい。人の手が要るのは Cloudflare の
# API トークンと R2 アクセスキーの発行だけ(S3 互換 backend は Cloudflare の API
# トークンでは認証できないため、R2 のアクセスキーが別に要る)。
#
# 冪等: 既にある WORKER_* は上書きしない。AUTH_PEPPER を変えると既存の
# パスワードハッシュが全て無効になるため、保持を既定にしている。
set -euo pipefail

command -v gh >/dev/null || { echo "gh CLI が要ります"; exit 1; }
command -v openssl >/dev/null || { echo "openssl が要ります"; exit 1; }

REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
echo "対象リポジトリ: $REPO"
echo

read -rsp "CLOUDFLARE_API_TOKEN: " CF_TOKEN; echo
read -rp  "CLOUDFLARE_ACCOUNT_ID: " CF_ACCOUNT
read -rsp "R2_STATE_ACCESS_KEY_ID: " R2_KEY; echo
read -rsp "R2_STATE_SECRET_ACCESS_KEY: " R2_SECRET; echo
read -rsp "WORKER_RESEND_API_KEY (production のみ・空可): " RESEND; echo
echo

for env in staging production; do
  echo "--- environment: $env"
  gh api -X PUT "repos/${REPO}/environments/${env}" >/dev/null

  printf '%s' "$CF_TOKEN"   | gh secret set CLOUDFLARE_API_TOKEN       --repo "$REPO" --env "$env"
  printf '%s' "$CF_ACCOUNT" | gh secret set CLOUDFLARE_ACCOUNT_ID      --repo "$REPO" --env "$env"
  printf '%s' "$R2_KEY"     | gh secret set R2_STATE_ACCESS_KEY_ID     --repo "$REPO" --env "$env"
  printf '%s' "$R2_SECRET"  | gh secret set R2_STATE_SECRET_ACCESS_KEY --repo "$REPO" --env "$env"

  existing=$(gh secret list --repo "$REPO" --env "$env" --json name -q '.[].name' 2>/dev/null || true)

  names=(WORKER_INTERNAL_KEY WORKER_JWT_SECRET WORKER_AUTH_PEPPER WORKER_DOMAIN_AUTH_KEY)
  if [ "$env" = "staging" ]; then
    names+=(WORKER_STAGING_ACCESS_TOKEN WORKER_STAGING_ADMIN_PASSWORD)
  fi

  for name in "${names[@]}"; do
    if echo "$existing" | grep -qx "$name"; then
      echo "= $name は設定済み(保持)"
    else
      openssl rand -hex 32 | tr -d '\n' | gh secret set "$name" --repo "$REPO" --env "$env"
      echo "+ $name を生成"
    fi
  done

  if [ "$env" = "production" ] && [ -n "$RESEND" ]; then
    printf '%s' "$RESEND" | gh secret set WORKER_RESEND_API_KEY --repo "$REPO" --env "$env"
    echo "+ WORKER_RESEND_API_KEY を登録"
  fi
done

echo
echo "✅ 完了。"
echo "   staging のゲートトークン(WORKER_STAGING_ACCESS_TOKEN)は GitHub からは読めない。"
echo "   staging を人が開くときは、この値を配るために再生成するか、生成時に控えること:"
echo "     openssl rand -hex 32 | tee /dev/tty | gh secret set WORKER_STAGING_ACCESS_TOKEN --repo $REPO --env staging"
