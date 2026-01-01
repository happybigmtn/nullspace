import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import keccak256 from 'keccak256';
import { MerkleTree } from 'merkletreejs';
import env from '../src/utils/env.cjs';

const { envString, envBigInt } = env;

function normalizeAddress(value) {
  if (!value) return null;
  try {
    return ethers.getAddress(value);
  } catch {
    return null;
  }
}

function normalizePubKey(value) {
  if (!value) return null;
  const trimmed = value.toString().trim();
  if (trimmed.length === 0) return null;
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

function loadJson(filePath, label) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label} file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const bidsPath =
  process.argv[2] ?? envString('BIDS_PATH', path.resolve('data', 'cca-bids-sepolia.json'));
const snapshotPath = process.argv[3] ?? envString('PHASE1_SNAPSHOT_PATH', '');
const linksPath = process.argv[4] ?? envString('PLAYER_LINKS_PATH', '');
const outputPath = process.argv[5] ?? envString('OUTPUT_PATH', path.resolve('data', 'bogo-claims.json'));

const payload = loadJson(bidsPath, 'bids');
const bids = payload?.bids ?? [];
if (!Array.isArray(bids) || bids.length === 0) {
  throw new Error('No bids found in input file');
}

const snapshot = loadJson(snapshotPath, 'Phase 1 snapshot');
const links = loadJson(linksPath, 'player links');
if (links && !snapshot) {
  throw new Error('PLAYER_LINKS_PATH provided without PHASE1_SNAPSHOT_PATH');
}

const creditsByPubkey = new Map();
if (snapshot) {
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  for (const player of players) {
    const key =
      normalizePubKey(player.public_key_hex) ??
      normalizePubKey(player.publicKeyHex) ??
      normalizePubKey(player.publicKey);
    if (!key) continue;
    const total =
      player.freeroll_credits_total ??
      player.freerollCreditsTotal ??
      player.freeroll_credits ??
      player.freerollCredits;
    const totalCredits = total ? BigInt(total) : 0n;
    creditsByPubkey.set(key.toLowerCase(), totalCredits);
  }
}

const creditsByAddress = new Map();
if (links) {
  const entries = Array.isArray(links) ? links : links.links ?? links.accounts ?? [];
  for (const entry of entries) {
    const key =
      normalizePubKey(entry.public_key_hex) ??
      normalizePubKey(entry.publicKeyHex) ??
      normalizePubKey(entry.publicKey);
    const address =
      normalizeAddress(entry.evm_address ?? entry.evmAddress ?? entry.address ?? entry.wallet);
    if (!key || !address) continue;
    const credits = creditsByPubkey.get(key.toLowerCase()) ?? 0n;
    const existing = creditsByAddress.get(address.toLowerCase()) ?? 0n;
    creditsByAddress.set(address.toLowerCase(), existing + credits);
  }
}

const claimed = new Map();
for (const bid of bids) {
  const address = normalizeAddress(bid.bidder ?? bid.owner ?? bid.address);
  if (!address) continue;
  const amountRaw =
    bid.tokensFilled ??
    bid.tokens_filled ??
    bid.filled ??
    bid.amount ??
    bid.currencyAmount ??
    0;
  const bidAmount = amountRaw ? BigInt(amountRaw) : 0n;
  if (bidAmount === 0n) continue;
  if (bid.successful === false) continue;

  const cap = creditsByAddress.size > 0 ? creditsByAddress.get(address.toLowerCase()) ?? 0n : null;
  const prev = claimed.get(address.toLowerCase()) ?? 0n;
  let eligible = bidAmount;
  if (cap !== null) {
    if (prev >= cap) {
      continue;
    }
    const remaining = cap - prev;
    eligible = bidAmount > remaining ? remaining : bidAmount;
  }
  if (eligible <= 0n) continue;
  claimed.set(address.toLowerCase(), prev + eligible);
}

let claims = Array.from(claimed.entries()).map(([address, amount]) => ({
  address,
  amount
}));

const poolCap = envBigInt('BOGO_POOL_CAP', 0n);
if (poolCap > 0n) {
  const totalEligible = claims.reduce((sum, c) => sum + c.amount, 0n);
  if (totalEligible > poolCap && totalEligible > 0n) {
    const scale = (poolCap * 1_000_000n) / totalEligible;
    claims = claims
      .map((claim) => ({
        address: claim.address,
        amount: (claim.amount * scale) / 1_000_000n
      }))
      .filter((claim) => claim.amount > 0n);
  }
}

if (claims.length === 0) {
  throw new Error('No eligible claims after applying caps');
}

const leaves = claims.map((claim) => {
  const leaf = ethers.solidityPackedKeccak256(
    ['address', 'uint256'],
    [claim.address, claim.amount]
  );
  return Buffer.from(leaf.slice(2), 'hex');
});

const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
const root = tree.getHexRoot();

const claimsWithProof = claims.map((claim) => {
  const leaf = ethers.solidityPackedKeccak256(
    ['address', 'uint256'],
    [claim.address, claim.amount]
  );
  const proof = tree.getHexProof(Buffer.from(leaf.slice(2), 'hex'));
  return {
    address: claim.address,
    amount: claim.amount.toString(),
    proof
  };
});

const output = {
  root,
  generatedAt: new Date().toISOString(),
  bidsPath,
  snapshotPath: snapshotPath || null,
  linksPath: linksPath || null,
  totalClaims: claimsWithProof.length,
  claims: claimsWithProof
};

const outDir = path.dirname(outputPath);
if (outDir && outDir !== '.') {
  fs.mkdirSync(outDir, { recursive: true });
}
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`Wrote ${claimsWithProof.length} claims to ${outputPath}`);
