output "load_balancer_id" {
  description = "ID of the load balancer"
  value       = hcloud_load_balancer.lb.id
}

output "load_balancer_name" {
  description = "Name of the load balancer"
  value       = hcloud_load_balancer.lb.name
}

output "public_ipv4" {
  description = "Public IPv4 address of the load balancer"
  value       = hcloud_load_balancer.lb.ipv4
}

output "public_ipv6" {
  description = "Public IPv6 address of the load balancer"
  value       = hcloud_load_balancer.lb.ipv6
}

output "private_ip" {
  description = "Private IP of the load balancer (if attached to network)"
  value       = var.network_id != null ? hcloud_load_balancer_network.lb[0].ip : null
}
