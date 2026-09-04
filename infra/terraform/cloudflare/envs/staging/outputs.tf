output "admin_d1_database_id" {
  value       = module.substrate.admin_d1_database_id
  description = "services/admin/wrangler.jsonc → d1_databases[0].database_id"
}

output "glasses_management_d1_database_id" {
  value       = module.substrate.glasses_management_d1_database_id
  description = "services/glasses_management/wrangler.jsonc → d1_databases[0].database_id"
}

output "auth_rl_kv_namespace_id" {
  value       = module.substrate.auth_rl_kv_namespace_id
  description = "services/admin/wrangler.jsonc → kv_namespaces[0].id (AUTH_RL)"
}

output "notifier_dedupe_kv_namespace_id" {
  value       = module.substrate.notifier_dedupe_kv_namespace_id
  description = "services/notifier/wrangler.jsonc → kv_namespaces[0].id (DEDUPE)"
}

output "glasses_management_short_lived_kv_namespace_id" {
  value       = module.substrate.glasses_management_short_lived_kv_namespace_id
  description = "services/glasses_management/wrangler.jsonc → kv_namespaces[0].id (SHORT_LIVED)"
}

output "glasses_management_recordings_bucket_name" {
  value       = module.substrate.glasses_management_recordings_bucket_name
  description = "services/glasses_management/wrangler.jsonc → r2_buckets[0].bucket_name (RECORDINGS)"
}
