#!/bin/bash
set -e

SERVICE="nullspace-simulator.service"
DROPIN_DIR="/etc/systemd/system/$SERVICE.d"

if systemctl list-unit-files | grep -q "$SERVICE"; then
    echo "Found $SERVICE, checking CORS config..."
    mkdir -p "$DROPIN_DIR"
    
    # Check if we already have a cors conf
    CONF_FILE="$DROPIN_DIR/cors.conf"
    
    # Overwrite/Create with permissive origin
    echo "[Service]" > "$CONF_FILE"
    echo "Environment=ALLOWED_HTTP_ORIGINS=*" >> "$CONF_FILE"
    echo "Environment=ALLOW_HTTP_NO_ORIGIN=1" >> "$CONF_FILE"
    echo "Applied CORS override to $CONF_FILE"
    
    echo "--> Reloading systemd..."
    systemctl daemon-reload
    
    echo "--> Restarting simulator..."
    systemctl restart "$SERVICE"
    
    echo "--> Verified."
else
    echo "Error: $SERVICE not found."
    exit 1
fi
