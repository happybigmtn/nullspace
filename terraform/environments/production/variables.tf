variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "ssh_key_name" {
  description = "Name of SSH key in Hetzner Cloud"
  type        = string
}

variable "admin_ssh_ips" {
  description = "List of IP addresses/CIDRs allowed SSH access"
  type        = list(string)
  default     = []
}

variable "prometheus_ips" {
  description = "List of Prometheus server IPs for metrics scraping"
  type        = list(string)
  default     = []
}

# Scaling configuration (production defaults)
variable "gateway_count" {
  description = "Number of gateway instances"
  type        = number
  default     = 4
}

variable "validator_count" {
  description = "Number of validator nodes (minimum 4 for production BFT)"
  type        = number
  default     = 4

  validation {
    condition     = var.validator_count >= 4
    error_message = "Production requires at least 4 validators (f=1 with safety margin)."
  }
}

# Storage configuration
variable "database_volume_gb" {
  description = "Size of database persistent volume in GB"
  type        = number
  default     = 200
}

variable "convex_volume_gb" {
  description = "Size of Convex persistent volume in GB"
  type        = number
  default     = 100
}

variable "observability_volume_gb" {
  description = "Size of observability persistent volume in GB"
  type        = number
  default     = 500
}

# TLS configuration
variable "certificate_id" {
  description = "Hetzner managed certificate ID for HTTPS"
  type        = number
  default     = null
}

# Optional components
variable "enable_observability" {
  description = "Deploy observability stack"
  type        = bool
  default     = true
}

variable "enable_convex" {
  description = "Deploy Convex server"
  type        = bool
  default     = true
}
