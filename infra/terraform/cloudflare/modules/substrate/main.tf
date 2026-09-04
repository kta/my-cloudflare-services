# Stateful Cloudflare substrate. Worker CODE and per-Worker bindings are owned
# by Wrangler (each wrangler.jsonc) — Terraform only provisions the resources
# below and exports their IDs (see outputs.tf) to wire into wrangler.jsonc.
# One owner per resource avoids drift.
#
# 名前の接尾辞で環境を分ける。D1 はアンダースコア、KV / R2 はハイフンで命名の
# 慣習が違うため、接尾辞を 2 つ受け取る。

# --- D1: admin owns its own database. ---
resource "cloudflare_d1_database" "admin" {
  account_id = var.cloudflare_account_id
  name       = "admin${var.d1_suffix}"
}

# glasses_management owns the EYE reservation domain data. It is deliberately
# separate from admin's organization/authentication source of truth.
resource "cloudflare_d1_database" "glasses_management" {
  account_id = var.cloudflare_account_id
  name       = "glasses_management${var.d1_suffix}"
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
