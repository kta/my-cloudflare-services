terraform {
  required_version = ">= 1.9, < 2.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment. Scope the token minimally:
# Account: Workers Scripts Edit, D1 Edit, Workers KV Storage Edit, Workers R2
# Storage Edit, Account Settings Read. (No Queues — free-tier policy.)
provider "cloudflare" {}

module "substrate" {
  source                = "../../modules/substrate"
  cloudflare_account_id = var.cloudflare_account_id
  # D1 はアンダースコア、KV / R2 はハイフンで命名の慣習が違う。
  d1_suffix    = "_staging"
  kv_r2_suffix = "-staging"
}
