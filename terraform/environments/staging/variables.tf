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

# Scaling configuration
variable "gateway_count" {
  description = "Number of gateway instances"
  type        = number
  default     = 2
}

variable "validator_count" {
  description = "Number of validator nodes (minimum 4 for BFT with f=1 fault tolerance)"
  type        = number
  default     = 4

  validation {
    condition     = var.validator_count >= 4
    error_message = "At least 4 validators required for BFT consensus (n >= 3f+1, f=1)."
  }
}

# Storage configuration
variable "database_volume_gb" {
  description = "Size of database persistent volume in GB"
  type        = number
  default     = 50
}

variable "observability_volume_gb" {
  description = "Size of observability persistent volume in GB"
  type        = number
  default     = 100
}

# Optional components
variable "enable_observability" {
  description = "Deploy observability stack (Prometheus, Grafana, Loki)"
  type        = bool
  default     = true
}
