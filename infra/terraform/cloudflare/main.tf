# Stateful Cloudflare substrate. Worker CODE and per-Worker bindings are owned
# by Wrangler (each wrangler.jsonc) — Terraform only provisions the resources
# below and exports their IDs (see outputs.tf) to wire into wrangler.jsonc.
# One owner per resource avoids drift.

# --- D1: admin owns its own database. ---
resource "cloudflare_d1_database" "admin" {
  account_id = var.cloudflare_account_id
  name       = "admin"
}

# glasses_management owns the EYEX reservation domain data. It is deliberately
# separate from admin's organization/authentication source of truth.
resource "cloudflare_d1_database" "glasses_management" {
  account_id = var.cloudflare_account_id
  name       = "glasses_management"
}

# --- KV ---
# admin: login rate-limit / lockout counters (email+IP window).
resource "cloudflare_workers_kv_namespace" "auth_rl" {
  account_id = var.cloudflare_account_id
  title      = "admin-auth-rl"
}

# notifier: 24-hour idempotency records for outbound email jobs.
resource "cloudflare_workers_kv_namespace" "notifier_dedupe" {
  account_id = var.cloudflare_account_id
  title      = "notifier-dedupe"
}

# glasses_management: short-lived reservation/session state. Long-lived domain
# data belongs in its D1; this KV is not used as a source of truth.
resource "cloudflare_workers_kv_namespace" "glasses_management_short_lived" {
  account_id = var.cloudflare_account_id
  title      = "glasses-management-short-lived"
}

# R2 objects are private by default. The Worker mediates recording metadata and
# retention; no public bucket or direct customer download URL is provisioned.
resource "cloudflare_r2_bucket" "glasses_management_recordings" {
  account_id = var.cloudflare_account_id
  name       = "glasses-management-recordings"
  location   = "apac"
}
