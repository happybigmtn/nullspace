variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
}

variable "name" {
  description = "Base name for server instances"
  type        = string
}

variable "component" {
  description = "Component type (gateway, simulator, validator, etc.)"
  type        = string
}

variable "role" {
  description = "Server role for labeling"
  type        = string
}

variable "instance_count" {
  description = "Number of server instances to create"
  type        = number
  default     = 1
}

# Server specifications based on runbook Section 3
# Gateway: CPX31 (4 vCPU, 8 GB)
# Simulator: CPX41/CPX51 (8-16 vCPU, 16-32 GB)
# Validator: CPX31 (4 vCPU, 8 GB)
# Auth: CPX21 (2 vCPU, 4 GB)
# Convex: CPX41 (8 vCPU, 16 GB)
# Database: CPX41 (8 vCPU, 16 GB)
# Observability: CPX31 (4 vCPU, 8 GB)
# Ops: CPX21 (2 vCPU, 4 GB)
variable "server_type" {
  description = "Hetzner server type (cpx11, cpx21, cpx31, cpx41, cpx51)"
  type        = string
  default     = "cpx31"
}

variable "image" {
  description = "Server image (OS)"
  type        = string
  default     = "ubuntu-24.04"
}

variable "location" {
  description = "Hetzner datacenter location (ash, hil, nbg1, fsn1, hel1)"
  type        = string
  default     = "ash" # Ashburn (us-east)
}

variable "ssh_key_name" {
  description = "Name of existing SSH key in Hetzner"
  type        = string
  default     = null
}

variable "ssh_public_key" {
  description = "SSH public key to create and attach"
  type        = string
  default     = null
}

variable "firewall_ids" {
  description = "List of firewall IDs to attach"
  type        = list(number)
  default     = []
}

variable "network_id" {
  description = "Network ID to attach servers to"
  type        = number
  default     = null
}

variable "private_ips" {
  description = "List of private IPs to assign (one per instance)"
  type        = list(string)
  default     = null
}

variable "enable_public_ipv4" {
  description = "Enable public IPv4"
  type        = bool
  default     = false
}

variable "enable_public_ipv6" {
  description = "Enable public IPv6"
  type        = bool
  default     = false
}

variable "volume_size_gb" {
  description = "Size of persistent volume in GB (0 to disable)"
  type        = number
  default     = 0
}

variable "user_data" {
  description = "Custom cloud-init user data"
  type        = string
  default     = null
}

variable "labels" {
  description = "Labels to apply to all resources"
  type        = map(string)
  default     = {}
}
