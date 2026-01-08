#!/bin/bash
# Nullspace Testnet Staging Setup Script
# Usage: ./setup.sh
#
# Prerequisites:
#   - Ubuntu 22.04+ or similar
#   - Root or sudo access
#   - DNS records already configured (see DNS_RECORDS.md)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GHCR_REGISTRY="ghcr.io"
IMAGE_PREFIX="happybigmtn/nullspace"

echo "=========================================="
echo "  Nullspace Testnet Staging Setup"
echo "  Domain: testnet.regenesis.dev"
echo "=========================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)"
   exit 1
fi

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

# Install Docker Compose if not present
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "Installing Docker Compose..."
    apt-get update
    apt-get install -y docker-compose-plugin
fi

# Create necessary directories
echo "Creating directories..."
mkdir -p /etc/nullspace
mkdir -p /var/log/caddy
mkdir -p /var/lib/nullspace/{simulator,node,gateway}

# Check for env files
echo "Checking environment files..."
ENV_FILES=("simulator.env" "node.env" "gateway.env" "auth.env")
MISSING_FILES=()

for file in "${ENV_FILES[@]}"; do
    if [[ ! -f "/etc/nullspace/$file" ]]; then
        MISSING_FILES+=("$file")
    fi
done

if [[ ${#MISSING_FILES[@]} -gt 0 ]]; then
    echo ""
    echo "WARNING: Missing environment files in /etc/nullspace/:"
    for file in "${MISSING_FILES[@]}"; do
        echo "  - $file"
    done
    echo ""
    echo "Please copy the environment files before starting services."
    echo "You can get them from the deployment pipeline or create them manually."
    echo ""
fi

# Copy infrastructure files
echo "Copying infrastructure files..."
cp "$SCRIPT_DIR/docker-compose.yml" /opt/nullspace/
cp "$SCRIPT_DIR/Caddyfile" /opt/nullspace/
mkdir -p /opt/nullspace
cd /opt/nullspace

# Login to GHCR (optional - for pulling images)
echo ""
echo "To pull images, you may need to login to GitHub Container Registry:"
echo "  echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin"
echo ""

# Pull images
echo "Pulling Docker images..."
docker pull $GHCR_REGISTRY/$IMAGE_PREFIX-simulator:latest || echo "Failed to pull simulator image"
docker pull $GHCR_REGISTRY/$IMAGE_PREFIX-node:latest || echo "Failed to pull node image"
docker pull $GHCR_REGISTRY/$IMAGE_PREFIX-gateway:latest || echo "Failed to pull gateway image"
docker pull $GHCR_REGISTRY/$IMAGE_PREFIX-auth:latest || echo "Failed to pull auth image"
docker pull $GHCR_REGISTRY/$IMAGE_PREFIX-website:latest || echo "Failed to pull website image"
docker pull caddy:2-alpine

# Open firewall ports
echo "Configuring firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 80/tcp
    ufw allow 443/tcp
    echo "Firewall configured (ufw)"
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --permanent --add-port=80/tcp
    firewall-cmd --permanent --add-port=443/tcp
    firewall-cmd --reload
    echo "Firewall configured (firewalld)"
else
    echo "No firewall detected. Make sure ports 80 and 443 are open."
fi

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Ensure DNS records are configured (see DNS_RECORDS.md)"
echo ""
echo "2. Copy environment files to /etc/nullspace/"
echo "   - simulator.env"
echo "   - node.env"
echo "   - gateway.env"
echo "   - auth.env"
echo ""
echo "3. Start the services:"
echo "   cd /opt/nullspace"
echo "   docker compose up -d"
echo ""
echo "4. Check service status:"
echo "   docker compose ps"
echo "   docker compose logs -f"
echo ""
echo "5. Verify HTTPS (after DNS propagates):"
echo "   curl https://testnet.regenesis.dev"
echo ""
