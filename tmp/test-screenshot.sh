#!/bin/bash
# Test if pages render with a longer wait

URL="$1"
OUTPUT="$2"

# Try with a much longer timeout and additional flags
google-chrome-stable \
  --headless=new \
  --screenshot="$OUTPUT" \
  --window-size=1280,900 \
  --disable-gpu \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-software-rasterizer \
  --virtual-time-budget=15000 \
  "$URL" 2>&1 | tail -3
