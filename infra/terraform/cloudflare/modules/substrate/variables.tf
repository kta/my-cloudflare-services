variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID that owns these resources."
}

variable "d1_suffix" {
  type        = string
  description = "D1 名に付ける接尾辞。production は空、staging は \"_staging\"(D1 はアンダースコア命名)。"
  default     = ""
}

variable "kv_r2_suffix" {
  type        = string
  description = "KV / R2 名に付ける接尾辞。production は空、staging は \"-staging\"(KV/R2 はハイフン命名)。"
  default     = ""
}
