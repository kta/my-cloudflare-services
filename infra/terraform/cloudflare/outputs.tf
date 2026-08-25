output "admin_d1_database_id" {
  value       = cloudflare_d1_database.admin.id
  description = "services/admin/wrangler.jsonc → d1_databases[0].database_id"
}

output "auth_rl_kv_namespace_id" {
  value       = cloudflare_workers_kv_namespace.auth_rl.id
  description = "services/admin/wrangler.jsonc → kv_namespaces[0].id (AUTH_RL)"
}
