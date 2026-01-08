# Terraform state backend configuration for production
# Using S3-compatible storage with state locking

terraform {
  backend "s3" {
    bucket = "nullspace-terraform-state"
    key    = "production/terraform.tfstate"
    region = "us-east-1"

    # Enable state locking (AWS DynamoDB)
    # dynamodb_table = "nullspace-terraform-locks"

    encrypt = true
  }
}
