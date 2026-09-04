output "admin_d1_database_id" {
  value       = cloudflare_d1_database.admin.id
  description = "services/admin/wrangler.jsonc → d1_databases[0].database_id"
}

output "glasses_management_d1_database_id" {
  value       = cloudflare_d1_database.glasses_management.id
  description = "services/glasses_management/wrangler.jsonc → d1_databases[0].database_id"
}

output "auth_rl_kv_namespace_id" {
  value       = cloudflare_workers_kv_namespace.auth_rl.id
  description = "services/admin/wrangler.jsonc → kv_namespaces[0].id (AUTH_RL)"
}

output "notifier_dedupe_kv_namespace_id" {
  value       = cloudflare_workers_kv_namespace.notifier_dedupe.id
  description = "services/notifier/wrangler.jsonc → kv_namespaces[0].id (DEDUPE)"
}

output "glasses_management_short_lived_kv_namespace_id" {
  value       = cloudflare_workers_kv_namespace.glasses_management_short_lived.id
  description = "services/glasses_management/wrangler.jsonc → kv_namespaces[0].id (SHORT_LIVED)"
}

output "glasses_management_recordings_bucket_name" {
  value       = cloudflare_r2_bucket.glasses_management_recordings.name
  description = "services/glasses_management/wrangler.jsonc → r2_buckets[0].bucket_name (RECORDINGS)"
}
