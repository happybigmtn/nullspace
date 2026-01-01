import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import bidders from '../src/utils/bidders.cjs';

const { deriveKeysFromMnemonic } = bidders;

const count = Number(process.env.BIDDER_COUNT ?? 100);
if (!Number.isFinite(count) || count <= 0) {
  throw new Error('BIDDER_COUNT must be > 0');
}

const mnemonic = process.env.BIDDER_MNEMONIC ?? ethers.Wallet.createRandom().mnemonic.phrase;
const keys = deriveKeysFromMnemonic(mnemonic, count);
const bidders = keys.map((key, index) => {
  const wallet = new ethers.Wallet(key);
  return {
    index,
    address: wallet.address,
    privateKey: key
  };
});

const outDir = path.resolve('data');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'bidders.json');
fs.writeFileSync(outPath, JSON.stringify({ mnemonic, bidders }, null, 2));

const keysPath = path.join(outDir, 'bidder-keys.txt');
fs.writeFileSync(keysPath, bidders.map((b) => b.privateKey).join(','));

console.log(`Generated ${count} bidders.`);
console.log(`Mnemonic: ${mnemonic}`);
console.log(`Saved ${outPath}`);
console.log(`Saved ${keysPath}`);
