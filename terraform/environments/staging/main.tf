# Staging environment for Nullspace
# Provisions infrastructure on Hetzner Cloud for ~5k concurrent players

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

locals {
  project_name = "nullspace-staging"
  location     = "ash" # Ashburn (us-east)
  network_zone = "us-east"

  labels = {
    project     = "nullspace"
    environment = "staging"
    managed_by  = "terraform"
  }
}

# Network
module "network" {
  source = "../../modules/network"

  project_name = local.project_name
  network_cidr = "10.0.0.0/16"
  subnet_cidr  = "10.0.1.0/24"
  network_zone = local.network_zone
  labels       = local.labels
}

# Firewalls
module "firewall" {
  source = "../../modules/firewall"

  project_name         = local.project_name
  admin_ssh_ips        = var.admin_ssh_ips
  private_network_cidr = "10.0.0.0/16"
  prometheus_ips       = var.prometheus_ips
  labels               = local.labels
}

# Gateway servers (2x CPX31 for horizontal scaling)
module "gateway" {
  source = "../../modules/server"

  project_name     = local.project_name
  name             = "ns-gw"
  component        = "gateway"
  role             = "gateway"
  instance_count   = var.gateway_count
  server_type      = "cpx31" # 4 vCPU, 8 GB
  location         = local.location
  ssh_key_name     = var.ssh_key_name
  network_id       = module.network.network_id
  firewall_ids     = [module.firewall.internal_firewall_id]
  enable_public_ipv4 = false
  labels           = local.labels

  depends_on = [module.network, module.firewall]
}

# Simulator/Indexer server (1x CPX41)
module "simulator" {
  source = "../../modules/server"

  project_name     = local.project_name
  name             = "ns-sim"
  component        = "simulator"
  role             = "simulator"
  instance_count   = 1
  server_type      = "cpx41" # 8 vCPU, 16 GB
  location         = local.location
  ssh_key_name     = var.ssh_key_name
  network_id       = module.network.network_id
  firewall_ids     = [module.firewall.internal_firewall_id]
  enable_public_ipv4 = false
  labels           = local.labels

  depends_on = [module.network, module.firewall]
}

# Validator nodes (3x CPX31 for BFT consensus)
module "validators" {
  source = "../../modules/server"

  project_name     = local.project_name
  name             = "ns-node"
  component        = "validator"
  role             = "validator"
  instance_count   = var.validator_count
  server_type      = "cpx31" # 4 vCPU, 8 GB
  location         = local.location
  ssh_key_name     = var.ssh_key_name
  network_id       = module.network.network_id
  firewall_ids     = [module.firewall.validator_firewall_id]
  enable_public_ipv4 = false
  labels           = local.labels

  depends_on = [module.network, module.firewall]
}

# Auth server (1x CPX21)
module "auth" {
  source = "../../modules/server"

  project_name     = local.project_name
  name             = "ns-auth"
  component        = "auth"
  role             = "auth"
  instance_count   = 1
  server_type      = "cpx21" # 2 vCPU, 4 GB
  location         = local.location
  ssh_key_name     = var.ssh_key_name
  network_id       = module.network.network_id
  firewall_ids     = [module.firewall.internal_firewall_id]
  enable_public_ipv4 = false
  labels           = local.labels

  depends_on = [module.network, module.firewall]
}

# Database server (1x CPX41 with persistent volume)
module "database" {
  source = "../../modules/server"

  project_name     = local.project_name
  name             = "ns-db"
  component        = "database"
  role             = "database"
  instance_count   = 1
  server_type      = "cpx41" # 8 vCPU, 16 GB
  location         = local.location
  ssh_key_name     = var.ssh_key_name
  network_id       = module.network.network_id
  firewall_ids     = [module.firewall.database_firewall_id]
  volume_size_gb   = var.database_volume_gb
  enable_public_ipv4 = false
  labels           = local.labels

  depends_on = [module.network, module.firewall]
}

# Observability server (1x CPX31)
module "observability" {
  source = "../../modules/server"

  project_name     = local.project_name
  name             = "ns-obs"
  component        = "observability"
  role             = "observability"
  instance_count   = var.enable_observability ? 1 : 0
  server_type      = "cpx31" # 4 vCPU, 8 GB
  location         = local.location
  ssh_key_name     = var.ssh_key_name
  network_id       = module.network.network_id
  firewall_ids     = [module.firewall.observability_firewall_id]
  volume_size_gb   = var.observability_volume_gb
  enable_public_ipv4 = false
  labels           = local.labels

  depends_on = [module.network, module.firewall]
}

# Gateway load balancer (WebSocket)
module "lb_gateway" {
  source = "../../modules/load-balancer"

  project_name       = local.project_name
  name               = "gateway"
  load_balancer_type = "lb11"
  location           = local.location
  network_id         = module.network.network_id

  enable_tcp           = true
  tcp_listen_port      = 9010
  tcp_destination_port = 9010
  tcp_health_check_protocol = "http"
  tcp_health_check_port     = 9010
  health_check_path    = "/healthz"

  target_server_ids = module.gateway.server_ids
  use_private_ip    = true
  labels            = local.labels

  depends_on = [module.gateway]
}

# Web load balancer (Website + Auth)
module "lb_web" {
  source = "../../modules/load-balancer"

  project_name       = local.project_name
  name               = "web"
  load_balancer_type = "lb11"
  location           = local.location
  network_id         = module.network.network_id

  enable_http        = true
  http_destination_port = 80
  health_check_port  = 80
  health_check_path  = "/healthz"

  # Add website server when created (or auth server)
  target_server_ids = []
  use_private_ip    = true
  labels            = local.labels
}
