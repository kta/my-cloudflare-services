# module 側でも provider の出所を宣言する。書かないと Terraform は
# hashicorp/cloudflare(存在しない)を推測して init が落ちる。
terraform {
  required_version = ">= 1.9, < 2.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}
