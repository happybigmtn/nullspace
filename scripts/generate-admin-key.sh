#!/bin/bash
set -euo pipefail

OUTPUT_FILE="${1:-}"
if [[ -z "$OUTPUT_FILE" ]]; then
  echo "Usage: $0 /path/to/casino-admin-key.hex" >&2
  exit 1
fi

PRIVATE_KEY_HEX=$(node -e "const { ed25519 } = require('@noble/curves/ed25519'); const sk = ed25519.utils.randomPrivateKey(); console.log(Buffer.from(sk).toString('hex'));" )

if [[ -z "$PRIVATE_KEY_HEX" ]]; then
  echo "Failed to generate admin key." >&2
  exit 1
fi

printf '%s' "$PRIVATE_KEY_HEX" > "$OUTPUT_FILE"

PUBLIC_KEY_HEX=$(node -e "const fs=require('fs'); const { ed25519 } = require('@noble/curves/ed25519'); const hex=fs.readFileSync(process.argv[1],'utf8').trim(); if (!hex) { process.exit(1); } const pk=ed25519.getPublicKey(Buffer.from(hex,'hex')); console.log(Buffer.from(pk).toString('hex'));" "$OUTPUT_FILE")

if [[ -z "$PUBLIC_KEY_HEX" ]]; then
  echo "Failed to derive admin public key." >&2
  exit 1
fi

echo "$PUBLIC_KEY_HEX"
