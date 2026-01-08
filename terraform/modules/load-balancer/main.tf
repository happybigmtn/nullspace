# Load Balancer module - Creates Hetzner load balancers for Nullspace services
# Based on docs/hetzner-deployment-runbook.md Section 6

resource "hcloud_load_balancer" "lb" {
  name               = "${var.project_name}-${var.name}-lb"
  load_balancer_type = var.load_balancer_type
  location           = var.location

  labels = merge(var.labels, {
    component = "load-balancer"
    role      = var.name
  })

  algorithm {
    type = var.algorithm
  }
}

# Attach to network
resource "hcloud_load_balancer_network" "lb" {
  count = var.network_id != null ? 1 : 0

  load_balancer_id = hcloud_load_balancer.lb.id
  network_id       = var.network_id
  ip               = var.private_ip
}

# HTTP service (website, auth)
resource "hcloud_load_balancer_service" "http" {
  count = var.enable_http ? 1 : 0

  load_balancer_id = hcloud_load_balancer.lb.id
  protocol         = "http"
  listen_port      = 80
  destination_port = var.http_destination_port

  http {
    sticky_sessions = var.sticky_sessions
    cookie_name     = var.sticky_sessions ? "SERVERID" : null
    cookie_lifetime = var.sticky_sessions ? 300 : null
  }

  health_check {
    protocol = "http"
    port     = var.health_check_port
    interval = var.health_check_interval
    timeout  = var.health_check_timeout
    retries  = var.health_check_retries
    http {
      path         = var.health_check_path
      status_codes = ["200"]
    }
  }
}

# HTTPS service (website, auth with TLS)
resource "hcloud_load_balancer_service" "https" {
  count = var.enable_https && var.certificate_id != null ? 1 : 0

  load_balancer_id = hcloud_load_balancer.lb.id
  protocol         = "https"
  listen_port      = 443
  destination_port = var.https_destination_port

  http {
    sticky_sessions = var.sticky_sessions
    cookie_name     = var.sticky_sessions ? "SERVERID" : null
    cookie_lifetime = var.sticky_sessions ? 300 : null
    certificates    = [var.certificate_id]
    redirect_http   = var.redirect_http_to_https
  }

  health_check {
    protocol = "http"
    port     = var.health_check_port
    interval = var.health_check_interval
    timeout  = var.health_check_timeout
    retries  = var.health_check_retries
    http {
      path         = var.health_check_path
      status_codes = ["200"]
    }
  }
}

# TCP service (WebSocket gateway)
resource "hcloud_load_balancer_service" "tcp" {
  count = var.enable_tcp ? 1 : 0

  load_balancer_id = hcloud_load_balancer.lb.id
  protocol         = "tcp"
  listen_port      = var.tcp_listen_port
  destination_port = var.tcp_destination_port

  health_check {
    protocol = var.tcp_health_check_protocol
    port     = var.tcp_health_check_port
    interval = var.health_check_interval
    timeout  = var.health_check_timeout
    retries  = var.health_check_retries

    dynamic "http" {
      for_each = var.tcp_health_check_protocol == "http" ? [1] : []
      content {
        path         = var.health_check_path
        status_codes = ["200"]
      }
    }
  }
}

# Attach target servers
resource "hcloud_load_balancer_target" "servers" {
  count = length(var.target_server_ids)

  type             = "server"
  load_balancer_id = hcloud_load_balancer.lb.id
  server_id        = var.target_server_ids[count.index]
  use_private_ip   = var.use_private_ip
}
