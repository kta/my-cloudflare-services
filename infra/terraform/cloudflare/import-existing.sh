#!/usr/bin/env bash
# Terraform state に無い「既に実在するリソース」を取り込む。
#
# admin の D1 / KV は wrangler.jsonc に実 ID があるのに state に無い。そのまま
# apply すると同名リソースを作りに行って壊れるため、apply の前に必ず通す。
# 冪等: 既に state にあるものは触らない。見つからないものは何もしない(apply が作る)。
#
# import ID の形式は provider v5 の docs で確認済み:
#   cloudflare_d1_database          '<account_id>/<database_id>'
#   cloudflare_workers_kv_namespace '<account_id>/<namespace_id>'
#   cloudflare_r2_bucket            '<account_id>/<bucket_name>/<jurisdiction>'
set -euo pipefail

ENV_NAME="${1:?usage: import-existing.sh <production|staging>}"
DIR="$(cd "$(dirname "$0")" && pwd)/envs/${ENV_NAME}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN が要ります}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID が要ります}"

case "$ENV_NAME" in
  production) D1_SUFFIX=""; NAME_SUFFIX="" ;;
  staging)    D1_SUFFIX="_staging"; NAME_SUFFIX="-staging" ;;
  *) echo "未知の環境: $ENV_NAME" >&2; exit 2 ;;
esac

API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"
AUTH=(-H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")
# R2 の jurisdiction。既定のまま運用しており、EU 専用バケットは作っていない。
R2_JURISDICTION="default"

in_state() { terraform -chdir="$DIR" state show "$1" >/dev/null 2>&1; }

do_import() { # <address> <import-id>
  echo "→ import $1 ($2)"
  terraform -chdir="$DIR" import "$1" "$2"
}

# --- D1 ---
for pair in "admin:admin${D1_SUFFIX}" "glasses_management:glasses_management${D1_SUFFIX}"; do
  res="module.substrate.cloudflare_d1_database.${pair%%:*}"
  name="${pair##*:}"
  if in_state "$res"; then echo "= $res は state 済み"; continue; fi
  id=$(curl -sf "${AUTH[@]}" "${API}/d1/database?name=${name}" \
       | jq -r --arg n "$name" '.result[]? | select(.name==$n) | .uuid' | head -1 || true)
  if [ -n "${id:-}" ]; then
    do_import "$res" "${CLOUDFLARE_ACCOUNT_ID}/${id}"
  else
    echo "· D1 ${name} は未作成(apply が作る)"
  fi
done

# --- KV ---
kv_json=$(curl -sf "${AUTH[@]}" "${API}/storage/kv/namespaces?per_page=100" || echo '{"result":[]}')
for pair in "auth_rl:admin-auth-rl${NAME_SUFFIX}" \
            "notifier_dedupe:notifier-dedupe${NAME_SUFFIX}" \
            "glasses_management_short_lived:glasses-management-short-lived${NAME_SUFFIX}"; do
  res="module.substrate.cloudflare_workers_kv_namespace.${pair%%:*}"
  title="${pair##*:}"
  if in_state "$res"; then echo "= $res は state 済み"; continue; fi
  id=$(echo "$kv_json" | jq -r --arg t "$title" '.result[]? | select(.title==$t) | .id' | head -1)
  if [ -n "${id:-}" ]; then
    do_import "$res" "${CLOUDFLARE_ACCOUNT_ID}/${id}"
  else
    echo "· KV ${title} は未作成(apply が作る)"
  fi
done

# --- R2 ---
res="module.substrate.cloudflare_r2_bucket.glasses_management_recordings"
bucket="glasses-management-recordings${NAME_SUFFIX}"
if in_state "$res"; then
  echo "= $res は state 済み"
elif curl -sf "${AUTH[@]}" "${API}/r2/buckets/${bucket}" >/dev/null 2>&1; then
  do_import "$res" "${CLOUDFLARE_ACCOUNT_ID}/${bucket}/${R2_JURISDICTION}"
else
  echo "· R2 ${bucket} は未作成(apply が作る)"
fi

echo "✅ import 済み(${ENV_NAME})"
