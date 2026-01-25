#!/bin/bash
set -e

# Configuration to inject
OVERRIDE_CONTENT="[Service]
Environment=ALLOW_PRIVATE_IPS=1"

echo '--> Checking for validator services...'
for i in 0 1 2 3; do
    SERVICE="nullspace-node-$i.service"
    DROPIN_DIR="/etc/systemd/system/$SERVICE.d"
    
    if systemctl list-unit-files | grep -q "$SERVICE"; then
        echo "Found $SERVICE, applying override..."
        mkdir -p "$DROPIN_DIR"
        echo "$OVERRIDE_CONTENT" > "$DROPIN_DIR/private_ips.conf"
        echo "Applied override to $DROPIN_DIR/private_ips.conf"
    else
        echo "Warning: $SERVICE not found, skipping."
    fi
done

echo '--> Reloading systemd...'
systemctl daemon-reload

echo '--> Restarting validators...'
for i in 0 1 2 3; do
    SERVICE="nullspace-node-$i.service"
    if systemctl is-active --quiet "$SERVICE"; then
        echo "Restarting $SERVICE..."
        systemctl restart "$SERVICE"
    fi
done

echo '--> Verifying environment...'
for i in 0 1 2 3; do
    PID=$(systemctl show --property MainPID --value "nullspace-node-$i.service")
    if [ ! -z "$PID" ] && [ "$PID" != "0" ]; then
        # Check environ for the flag
        if tr '\0' '\n' < /proc/$PID/environ | grep -q ALLOW_PRIVATE_IPS=1; then
             echo "Node $i: ALLOW_PRIVATE_IPS=1 (Confirmed)"
        else
             echo "Node $i: ALLOW_PRIVATE_IPS NOT SET (Failed)"
        fi
    fi
done
