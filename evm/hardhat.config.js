const dotenv = require('dotenv');
const path = require('path');

require('@nomicfoundation/hardhat-chai-matchers');
require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-verify');

dotenv.config({ path: path.join(__dirname, '.env') });

const privateKey = process.env.EVM_PRIVATE_KEY ?? '';
const sepoliaUrl = process.env.SEPOLIA_RPC_URL ?? '';

/** @type {import('hardhat/config').HardhatUserConfig} */
const config = {
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    anvil: {
      url: process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545',
      chainId: 31337,
      accounts: privateKey ? [privateKey] : []
    },
    sepolia: {
      url: sepoliaUrl,
      chainId: 11155111,
      accounts: privateKey ? [privateKey] : []
    }
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY ?? ''
    }
  }
};

module.exports = config;
