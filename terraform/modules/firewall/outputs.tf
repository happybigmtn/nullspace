output "bastion_firewall_id" {
  description = "ID of the bastion firewall"
  value       = hcloud_firewall.bastion.id
}

output "web_firewall_id" {
  description = "ID of the web firewall"
  value       = hcloud_firewall.web.id
}

output "internal_firewall_id" {
  description = "ID of the internal services firewall"
  value       = hcloud_firewall.internal.id
}

output "validator_firewall_id" {
  description = "ID of the validator firewall"
  value       = hcloud_firewall.validator.id
}

output "database_firewall_id" {
  description = "ID of the database firewall"
  value       = hcloud_firewall.database.id
}

output "observability_firewall_id" {
  description = "ID of the observability firewall"
  value       = hcloud_firewall.observability.id
}

output "firewall_ids" {
  description = "Map of all firewall IDs by role"
  value = {
    bastion       = hcloud_firewall.bastion.id
    web           = hcloud_firewall.web.id
    internal      = hcloud_firewall.internal.id
    validator     = hcloud_firewall.validator.id
    database      = hcloud_firewall.database.id
    observability = hcloud_firewall.observability.id
  }
}
