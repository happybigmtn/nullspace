output "network_id" {
  description = "ID of the private network"
  value       = module.network.network_id
}

output "gateway_servers" {
  description = "Gateway server details"
  value       = module.gateway.servers
}

output "simulator_servers" {
  description = "Simulator server details"
  value       = module.simulator.servers
}

output "validator_servers" {
  description = "Validator server details"
  value       = module.validators.servers
}

output "auth_servers" {
  description = "Auth server details"
  value       = module.auth.servers
}

output "database_servers" {
  description = "Database server details"
  value       = module.database.servers
}

output "observability_servers" {
  description = "Observability server details"
  value       = var.enable_observability ? module.observability.servers : {}
}

output "gateway_lb_ip" {
  description = "Public IP of the gateway load balancer"
  value       = module.lb_gateway.public_ipv4
}

output "web_lb_ip" {
  description = "Public IP of the web load balancer"
  value       = module.lb_web.public_ipv4
}

output "dns_records" {
  description = "Suggested DNS records"
  value = {
    "gateway.staging.nullspace.example" = module.lb_gateway.public_ipv4
    "www.staging.nullspace.example"     = module.lb_web.public_ipv4
    "api.staging.nullspace.example"     = module.lb_web.public_ipv4
  }
}
