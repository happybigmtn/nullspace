output "network_id" {
  description = "ID of the created network"
  value       = hcloud_network.main.id
}

output "network_name" {
  description = "Name of the created network"
  value       = hcloud_network.main.name
}

output "subnet_id" {
  description = "ID of the main services subnet"
  value       = hcloud_network_subnet.services.id
}

output "subnet_cidr" {
  description = "CIDR of the main services subnet"
  value       = hcloud_network_subnet.services.ip_range
}

output "observability_subnet_id" {
  description = "ID of the observability subnet (if created)"
  value       = var.create_observability_subnet ? hcloud_network_subnet.observability[0].id : null
}
