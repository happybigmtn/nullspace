variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
}

variable "name" {
  description = "Name for this load balancer (gateway, web, etc.)"
  type        = string
}

variable "load_balancer_type" {
  description = "Hetzner load balancer type (lb11, lb21, lb31)"
  type        = string
  default     = "lb11"
}

variable "location" {
  description = "Hetzner datacenter location"
  type        = string
  default     = "ash"
}

variable "algorithm" {
  description = "Load balancing algorithm (round_robin, least_connections)"
  type        = string
  default     = "round_robin"
}

variable "network_id" {
  description = "Network ID to attach load balancer to"
  type        = number
  default     = null
}

variable "private_ip" {
  description = "Private IP for the load balancer"
  type        = string
  default     = null
}

# HTTP/HTTPS configuration
variable "enable_http" {
  description = "Enable HTTP listener"
  type        = bool
  default     = false
}

variable "http_destination_port" {
  description = "Backend port for HTTP traffic"
  type        = number
  default     = 80
}

variable "enable_https" {
  description = "Enable HTTPS listener"
  type        = bool
  default     = false
}

variable "https_destination_port" {
  description = "Backend port for HTTPS traffic"
  type        = number
  default     = 80
}

variable "certificate_id" {
  description = "Hetzner managed certificate ID for HTTPS"
  type        = number
  default     = null
}

variable "redirect_http_to_https" {
  description = "Redirect HTTP to HTTPS"
  type        = bool
  default     = true
}

variable "sticky_sessions" {
  description = "Enable sticky sessions"
  type        = bool
  default     = false
}

# TCP configuration (for WebSocket)
variable "enable_tcp" {
  description = "Enable TCP listener (for WebSocket)"
  type        = bool
  default     = false
}

variable "tcp_listen_port" {
  description = "External port for TCP listener"
  type        = number
  default     = 9010
}

variable "tcp_destination_port" {
  description = "Backend port for TCP traffic"
  type        = number
  default     = 9010
}

variable "tcp_health_check_protocol" {
  description = "Health check protocol for TCP service (tcp or http)"
  type        = string
  default     = "tcp"
}

variable "tcp_health_check_port" {
  description = "Port for TCP health checks"
  type        = number
  default     = 9010
}

# Health check configuration
variable "health_check_port" {
  description = "Port for health checks"
  type        = number
  default     = 80
}

variable "health_check_path" {
  description = "HTTP path for health checks"
  type        = string
  default     = "/healthz"
}

variable "health_check_interval" {
  description = "Health check interval in seconds"
  type        = number
  default     = 15
}

variable "health_check_timeout" {
  description = "Health check timeout in seconds"
  type        = number
  default     = 10
}

variable "health_check_retries" {
  description = "Number of health check retries"
  type        = number
  default     = 3
}

# Targets
variable "target_server_ids" {
  description = "List of server IDs to add as targets"
  type        = list(number)
  default     = []
}

variable "use_private_ip" {
  description = "Use private IPs for backend connections"
  type        = bool
  default     = true
}

variable "labels" {
  description = "Labels to apply to all resources"
  type        = map(string)
  default     = {}
}
