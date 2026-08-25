# Stateful Cloudflare substrate. Worker CODE and per-Worker bindings are owned
# by Wrangler (each wrangler.jsonc) — Terraform only provisions the resources
# below and exports their IDs (see outputs.tf) to wire into wrangler.jsonc.
# One owner per resource avoids drift.

# --- D1: admin owns its own database. ---
resource "cloudflare_d1_database" "admin" {
  account_id = var.cloudflare_account_id
  name       = "admin"
}

# --- KV ---
# admin: login rate-limit / lockout counters (email+IP window).
resource "cloudflare_workers_kv_namespace" "auth_rl" {
  account_id = var.cloudflare_account_id
  title      = "admin-auth-rl"
}
