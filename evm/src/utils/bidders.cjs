const fs = require('node:fs');
const { ethers } = require('ethers');

function loadPrivateKeysFromFile(filePath) {
  if (!filePath) return [];
  if (!fs.existsSync(filePath)) {
    throw new Error(`BIDDER_KEYS_FILE not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((key) => String(key));
    }
    if (Array.isArray(parsed?.bidders)) {
      return parsed.bidders.map((bidder) => bidder.privateKey);
    }
  }
  return raw
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

function deriveKeysFromMnemonic(mnemonic, count) {
  const root = ethers.HDNodeWallet.fromPhrase(mnemonic);
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    const wallet = root.derivePath(`m/44'/60'/0'/0/${i}`);
    keys.push(wallet.privateKey);
  }
  return keys;
}

module.exports = {
  loadPrivateKeysFromFile,
  deriveKeysFromMnemonic,
};
