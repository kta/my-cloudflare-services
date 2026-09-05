# Stateful Cloudflare substrate. Worker CODE and per-Worker bindings are owned
# by Wrangler (each wrangler.jsonc) — Terraform only provisions the resources
# below and exports their IDs (see outputs.tf) to wire into wrangler.jsonc.
# One owner per resource avoids drift.
#
# 名前の接尾辞で環境を分ける。D1 はアンダースコア、KV / R2 はハイフンで命名の
# 慣習が違うため、接尾辞を 2 つ受け取る。

# --- D1 ---
# D1 の read_replication は provider 5.24.0 で optional かつ **computed ではない**。
# API は常に {mode = "disabled"} を返すので、config に書かないと refresh のたびに
# 「消す」差分が立ち、PUT に read_replication: null が乗って API が 400(code 7400,
# "Expected object, received null") を返す。初回の create は通るが 2 回目以降の
# apply が必ず落ちるので、実体と同じ値を明示して差分を消す。
# 読み取りレプリカは有料機能なので無料枠の方針どおり disabled で固定する。

# admin owns its own database.
resource "cloudflare_d1_database" "admin" {
  account_id = var.cloudflare_account_id
  name       = "admin${var.d1_suffix}"

  read_replication = {
    mode = "disabled"
  }
}

# glasses_management owns the EYE reservation domain data. It is deliberately
# separate from admin's organization/authentication source of truth.
# read_replication を明示する理由は上の admin と同じ。
resource "cloudflare_d1_database" "glasses_management" {
  account_id = var.cloudflare_account_id
  name       = "glasses_management${var.d1_suffix}"

  read_replication = {
    mode = "disabled"
  }
}

# --- KV ---
# admin: login rate-limit / lockout counters (email+IP window).
resource "cloudflare_workers_kv_namespace" "auth_rl" {
  account_id = var.cloudflare_account_id
  title      = "admin-auth-rl${var.kv_r2_suffix}"
}

# notifier: 24-hour idempotency records for outbound email jobs.
resource "cloudflare_workers_kv_namespace" "notifier_dedupe" {
  account_id = var.cloudflare_account_id
  title      = "notifier-dedupe${var.kv_r2_suffix}"
}

# glasses_management: short-lived reservation/session state. Long-lived domain
# data belongs in its D1; this KV is not used as a source of truth.
resource "cloudflare_workers_kv_namespace" "glasses_management_short_lived" {
  account_id = var.cloudflare_account_id
  title      = "glasses-management-short-lived${var.kv_r2_suffix}"
}

# R2 objects are private by default. The Worker mediates recording metadata and
# retention; no public bucket or direct customer download URL is provisioned.
resource "cloudflare_r2_bucket" "glasses_management_recordings" {
  account_id = var.cloudflare_account_id
  name       = "glasses-management-recordings${var.kv_r2_suffix}"
  location   = "apac"
}
