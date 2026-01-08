# Terraform state backend configuration
# Using S3-compatible storage (Hetzner Object Storage, Cloudflare R2, or AWS S3)

terraform {
  backend "s3" {
    # S3-compatible endpoint (configure via environment or backend config)
    # Hetzner Object Storage: https://fsn1.your-objectstorage.com
    # Cloudflare R2: https://<account-id>.r2.cloudflarestorage.com
    # AWS S3: Leave empty for AWS default
    # endpoint = "https://fsn1.your-objectstorage.com"

    bucket = "nullspace-terraform-state"
    key    = "staging/terraform.tfstate"
    region = "us-east-1" # Required even for non-AWS backends

    # For non-AWS S3-compatible backends
    # skip_credentials_validation = true
    # skip_metadata_api_check     = true
    # skip_region_validation      = true
    # force_path_style            = true

    # Enable state locking with DynamoDB (AWS only) or use workspace isolation
    # dynamodb_table = "nullspace-terraform-locks"

    encrypt = true
  }
}
