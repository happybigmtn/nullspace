# Server module - Creates Hetzner Cloud servers for Nullspace services
# Based on docs/hetzner-deployment-runbook.md Section 3

# SSH key for server access
data "hcloud_ssh_key" "admin" {
  count = var.ssh_key_name != null ? 1 : 0
  name  = var.ssh_key_name
}

resource "hcloud_ssh_key" "deploy" {
  count      = var.ssh_public_key != null ? 1 : 0
  name       = "${var.project_name}-deploy-key"
  public_key = var.ssh_public_key

  labels = var.labels
}

locals {
  ssh_keys = compact([
    var.ssh_key_name != null ? data.hcloud_ssh_key.admin[0].id : null,
    var.ssh_public_key != null ? hcloud_ssh_key.deploy[0].id : null,
  ])
}

# Server instances
resource "hcloud_server" "instance" {
  count = var.instance_count

  name        = var.instance_count > 1 ? "${var.name}-${count.index + 1}" : var.name
  server_type = var.server_type
  image       = var.image
  location    = var.location
  ssh_keys    = local.ssh_keys

  labels = merge(var.labels, {
    component = var.component
    role      = var.role
    index     = tostring(count.index)
  })

  # Cloud-init for initial setup
  user_data = var.user_data != null ? var.user_data : templatefile(
    "${path.module}/templates/cloud-init.yaml.tpl",
    {
      hostname     = var.instance_count > 1 ? "${var.name}-${count.index + 1}" : var.name
      project_name = var.project_name
      role         = var.role
    }
  )

  # Attach firewall
  firewall_ids = var.firewall_ids

  # Public IP settings
  public_net {
    ipv4_enabled = var.enable_public_ipv4
    ipv6_enabled = var.enable_public_ipv6
  }

  lifecycle {
    ignore_changes = [
      ssh_keys,
      user_data,
    ]
  }
}

# Attach to private network
resource "hcloud_server_network" "instance" {
  count = var.network_id != null ? var.instance_count : 0

  server_id  = hcloud_server.instance[count.index].id
  network_id = var.network_id
  ip         = var.private_ips != null ? var.private_ips[count.index] : null
}

# Persistent volumes for stateful services
resource "hcloud_volume" "data" {
  count = var.volume_size_gb > 0 ? var.instance_count : 0

  name      = "${var.name}-data-${count.index + 1}"
  size      = var.volume_size_gb
  location  = var.location
  format    = "ext4"
  automount = false

  labels = merge(var.labels, {
    component = var.component
    role      = "${var.role}-data"
  })
}

resource "hcloud_volume_attachment" "data" {
  count = var.volume_size_gb > 0 ? var.instance_count : 0

  volume_id = hcloud_volume.data[count.index].id
  server_id = hcloud_server.instance[count.index].id
  automount = true
}
