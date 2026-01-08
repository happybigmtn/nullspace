# Firewall module - Creates security rules for Nullspace services
# Based on docs/hetzner-deployment-runbook.md Section 2

# Bastion/SSH firewall - restricted to admin IPs
resource "hcloud_firewall" "bastion" {
  name = "${var.project_name}-bastion-fw"

  labels = merge(var.labels, {
    component = "firewall"
    role      = "bastion"
  })

  # SSH from admin IPs only
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_ssh_ips
  }

  # Allow all outbound
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction       = "out"
    protocol        = "udp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction       = "out"
    protocol        = "icmp"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }
}

# Public web firewall - HTTP/HTTPS via load balancer
resource "hcloud_firewall" "web" {
  name = "${var.project_name}-web-fw"

  labels = merge(var.labels, {
    component = "firewall"
    role      = "web"
  })

  # HTTP
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # HTTPS
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  # SSH from admin IPs
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_ssh_ips
  }

  # Allow all outbound
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction       = "out"
    protocol        = "udp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }
}

# Internal services firewall - service-to-service communication
resource "hcloud_firewall" "internal" {
  name = "${var.project_name}-internal-fw"

  labels = merge(var.labels, {
    component = "firewall"
    role      = "internal"
  })

  # SSH from admin IPs
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_ssh_ips
  }

  # Simulator/Indexer HTTP + WS (8080)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "8080"
    source_ips = [var.private_network_cidr]
  }

  # Gateway WS (9010)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "9010"
    source_ips = [var.private_network_cidr]
  }

  # Auth service (4000)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "4000"
    source_ips = [var.private_network_cidr]
  }

  # Ops service (9020)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "9020"
    source_ips = [var.private_network_cidr]
  }

  # Allow all outbound
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction       = "out"
    protocol        = "udp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction       = "out"
    protocol        = "icmp"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }
}

# Validator P2P firewall
resource "hcloud_firewall" "validator" {
  name = "${var.project_name}-validator-fw"

  labels = merge(var.labels, {
    component = "firewall"
    role      = "validator"
  })

  # SSH from admin IPs
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_ssh_ips
  }

  # Validator P2P ports (9001-9004)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "9001-9004"
    source_ips = [var.private_network_cidr]
  }

  # Metrics scraping (9100-9104)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "9100-9104"
    source_ips = var.prometheus_ips
  }

  # Allow all outbound
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction       = "out"
    protocol        = "udp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }
}

# Database firewall - Postgres
resource "hcloud_firewall" "database" {
  name = "${var.project_name}-database-fw"

  labels = merge(var.labels, {
    component = "firewall"
    role      = "database"
  })

  # SSH from admin IPs
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_ssh_ips
  }

  # Postgres (5432) from simulator/indexer only
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "5432"
    source_ips = [var.private_network_cidr]
  }

  # Allow all outbound
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }
}

# Observability firewall - Prometheus/Grafana/Loki
resource "hcloud_firewall" "observability" {
  name = "${var.project_name}-observability-fw"

  labels = merge(var.labels, {
    component = "firewall"
    role      = "observability"
  })

  # SSH from admin IPs
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_ssh_ips
  }

  # Prometheus (9090)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "9090"
    source_ips = var.admin_ssh_ips
  }

  # Grafana (3000/3001)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "3000-3001"
    source_ips = var.admin_ssh_ips
  }

  # Loki (3100)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "3100"
    source_ips = [var.private_network_cidr]
  }

  # Tempo OTLP receivers (4317-4318)
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "4317-4318"
    source_ips = [var.private_network_cidr]
  }

  # Allow all outbound
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction       = "out"
    protocol        = "udp"
    port            = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }
}
