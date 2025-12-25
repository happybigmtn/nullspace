import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import keccak256 from 'keccak256';
import { MerkleTree } from 'merkletreejs';

const inputPath = process.argv[2] ?? path.resolve('data', 'cca-bids-sepolia.json');
if (!fs.existsSync(inputPath)) {
  throw new Error(`Missing input file: ${inputPath}`);
}

const payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const bids = payload.bids ?? [];
if (!Array.isArray(bids) || bids.length === 0) {
  throw new Error('No bids found in input file');
}

const leaves = bids.map((bid) => {
  const address = bid.bidder;
  const amount = BigInt(bid.amount);
  const leaf = ethers.solidityPackedKeccak256(['address', 'uint256'], [address, amount]);
  return Buffer.from(leaf.slice(2), 'hex');
});

const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
const root = tree.getHexRoot();

const claims = bids.map((bid) => {
  const address = bid.bidder;
  const amount = BigInt(bid.amount);
  const leaf = ethers.solidityPackedKeccak256(['address', 'uint256'], [address, amount]);
  const proof = tree.getHexProof(Buffer.from(leaf.slice(2), 'hex'));
  return {
    address,
    amount: amount.toString(),
    proof
  };
});

const output = {
  root,
  generatedAt: new Date().toISOString(),
  totalClaims: claims.length,
  claims
};

const outDir = path.resolve('data');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'bogo-claims.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log(`Wrote ${claims.length} claims to ${outPath}`);
