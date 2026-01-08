variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
}

variable "admin_ssh_ips" {
  description = "List of IP addresses/CIDRs allowed SSH access"
  type        = list(string)
  default     = []
}

variable "private_network_cidr" {
  description = "CIDR of the private network for service-to-service rules"
  type        = string
  default     = "10.0.0.0/16"
}

variable "prometheus_ips" {
  description = "List of Prometheus server IPs for metrics scraping"
  type        = list(string)
  default     = []
}

variable "labels" {
  description = "Labels to apply to all resources"
  type        = map(string)
  default     = {}
}
