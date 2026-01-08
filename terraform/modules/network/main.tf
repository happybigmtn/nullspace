# Network module - Creates private network and subnets for Nullspace services
# Based on docs/hetzner-deployment-runbook.md Section 1

resource "hcloud_network" "main" {
  name     = "${var.project_name}-network"
  ip_range = var.network_cidr

  labels = merge(var.labels, {
    component = "network"
  })
}

resource "hcloud_network_subnet" "services" {
  network_id   = hcloud_network.main.id
  type         = "cloud"
  network_zone = var.network_zone
  ip_range     = var.subnet_cidr
}

# Optional: Additional subnet for observability stack
resource "hcloud_network_subnet" "observability" {
  count = var.create_observability_subnet ? 1 : 0

  network_id   = hcloud_network.main.id
  type         = "cloud"
  network_zone = var.network_zone
  ip_range     = var.observability_subnet_cidr
}
