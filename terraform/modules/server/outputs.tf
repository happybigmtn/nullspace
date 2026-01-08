output "server_ids" {
  description = "IDs of created servers"
  value       = hcloud_server.instance[*].id
}

output "server_names" {
  description = "Names of created servers"
  value       = hcloud_server.instance[*].name
}

output "public_ipv4" {
  description = "Public IPv4 addresses (if enabled)"
  value       = hcloud_server.instance[*].ipv4_address
}

output "public_ipv6" {
  description = "Public IPv6 addresses (if enabled)"
  value       = hcloud_server.instance[*].ipv6_address
}

output "private_ips" {
  description = "Private network IPs"
  value       = hcloud_server_network.instance[*].ip
}

output "volume_ids" {
  description = "IDs of attached volumes (if created)"
  value       = hcloud_volume.data[*].id
}

output "volume_paths" {
  description = "Linux device paths for attached volumes"
  value       = hcloud_volume.data[*].linux_device
}

output "servers" {
  description = "Map of server details"
  value = {
    for i, server in hcloud_server.instance : server.name => {
      id         = server.id
      name       = server.name
      public_ip  = server.ipv4_address
      private_ip = var.network_id != null ? hcloud_server_network.instance[i].ip : null
      status     = server.status
    }
  }
}
