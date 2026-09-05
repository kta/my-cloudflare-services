# state は R2(S3 互換)。endpoints にアカウント ID が入るので、値は CI から
# -backend-config で注入する(ファイルにアカウント ID を書かない)。
# R2 にはネイティブなロックが無いため、CI の concurrency で apply を直列化する。
terraform {
  backend "s3" {
    key    = "cloudflare/production.tfstate"
    region = "auto"

    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true
  }
}
