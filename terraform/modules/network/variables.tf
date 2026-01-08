variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
}

variable "network_cidr" {
  description = "CIDR block for the private network"
  type        = string
  default     = "10.0.0.0/16"
}

variable "subnet_cidr" {
  description = "CIDR block for the main services subnet"
  type        = string
  default     = "10.0.1.0/24"
}

variable "network_zone" {
  description = "Hetzner network zone (eu-central, us-east, us-west)"
  type        = string
  default     = "us-east"
}

variable "create_observability_subnet" {
  description = "Whether to create a separate subnet for observability"
  type        = bool
  default     = false
}

variable "observability_subnet_cidr" {
  description = "CIDR block for observability subnet"
  type        = string
  default     = "10.0.2.0/24"
}

variable "labels" {
  description = "Labels to apply to all resources"
  type        = map(string)
  default     = {}
}
