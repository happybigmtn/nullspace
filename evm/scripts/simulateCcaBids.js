const fs = require('node:fs');
const path = require('node:path');
const { ethers, network } = require('hardhat');
const { ccaAbi } = require('../src/abis/cca');
const { erc20Abi } = require('../src/abis/erc20');
const { permit2Abi } = require('../src/abis/permit2');
const { DEFAULT_ADDRESSES } = require('../src/config/addresses');
const { envString, envNumber, envBigInt } = require('../src/utils/env.cjs');
const { loadDeployments } = require('../src/utils/deployments.cjs');
const { loadPrivateKeysFromFile, deriveKeysFromMnemonic } = require('../src/utils/bidders.cjs');

const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;

async function ensurePermit2Allowance(currency, permit2, owner, spender, amount, expirationDays) {
  const ownerAddress = await owner.getAddress();
  const allowance = await currency.allowance(ownerAddress, permit2.target);
  if (allowance < amount) {
    await (await currency.connect(owner).approve(permit2.target, MAX_UINT256)).wait();
  }

  const [permitAmount] = await permit2.allowance(ownerAddress, currency.target, spender);
  if (permitAmount < amount) {
    const expiration = BigInt(Math.floor(Date.now() / 1000) + expirationDays * 86400);
    await (await permit2.connect(owner).approve(currency.target, spender, MAX_UINT160, expiration)).wait();
  }
}

async function main() {
  const deployments = loadDeployments();
  const [deployer] = await ethers.getSigners();
  const addresses = DEFAULT_ADDRESSES[network.name];
  if (!addresses) {
    throw new Error(`Unsupported network: ${network.name}`);
  }

  const auctionAddress = envString('AUCTION_ADDRESS', deployments.auction);
  const currencyAddress = envString('AUCTION_CURRENCY', deployments.currency);
  if (!auctionAddress) {
    throw new Error('AUCTION_ADDRESS not set and no deployment found');
  }

  const floorPrice = BigInt(deployments.auctionParams.floorPrice);
  const tickSpacing = BigInt(deployments.auctionParams.tickSpacing);
  const startBlock = BigInt(deployments.auctionParams.startBlock);

  const provider = ethers.provider;
  const currentBlock = BigInt(await provider.getBlockNumber());
  if (currentBlock < startBlock) {
    if (network.name === 'anvil' || network.name === 'hardhat') {
      const blocks = Number(startBlock - currentBlock);
      for (let i = 0; i < blocks; i += 1) {
        await provider.send('evm_mine', []);
      }
    } else {
      throw new Error(`Auction has not started. Current block ${currentBlock} < ${startBlock}`);
    }
  }

  const numBidders = envNumber('NUM_BIDDERS', 10);
  const privateKeys = envString('BIDDER_PRIVATE_KEYS');
  const keysFile = envString('BIDDER_KEYS_FILE');
  const mnemonic = envString('BIDDER_MNEMONIC');
  const derivedKeys = mnemonic ? deriveKeysFromMnemonic(mnemonic, numBidders) : [];
  const fileKeys = keysFile ? loadPrivateKeysFromFile(keysFile) : [];
  const rawKeys = fileKeys.length
    ? fileKeys
    : derivedKeys.length
      ? derivedKeys
      : privateKeys
        ? privateKeys
            .split(',')
            .map((key) => key.trim())
            .filter((key) => key.length > 0)
        : [];

  const bidders = rawKeys.length
    ? rawKeys.slice(0, numBidders).map((key) => new ethers.Wallet(key, provider))
    : (await ethers.getSigners()).slice(1, numBidders + 1);

  if (bidders.length === 0) {
    throw new Error('No bidders configured');
  }
  if (bidders.length < numBidders) {
    console.warn(`Only ${bidders.length} bidder keys available (requested ${numBidders}).`);
  }

  const auction = new ethers.Contract(auctionAddress, ccaAbi, deployer);
  const currency =
    currencyAddress === ethers.ZeroAddress
      ? null
      : new ethers.Contract(currencyAddress, erc20Abi, deployer);
  const permit2Address = envString('PERMIT2_ADDRESS', addresses.permit2);
  const permit2 = new ethers.Contract(permit2Address, permit2Abi, deployer);

  const minBid = envBigInt('MIN_BID_AMOUNT', 2_500_000n);
  const maxBid = envBigInt('MAX_BID_AMOUNT', 15_000_000n);
  const priceMultiplierBps = BigInt(envNumber('PRICE_MULTIPLIER_BPS', 12000));
  const expirationDays = envNumber('PERMIT2_EXPIRATION_DAYS', 30);
  const minEthBalance = envBigInt('MIN_BIDDER_ETH', 0n);

  if (maxBid < minBid) {
    throw new Error('MAX_BID_AMOUNT must be >= MIN_BID_AMOUNT');
  }

  const bids = [];

  for (const bidder of bidders) {
    const bidderAddress = await bidder.getAddress();
    if (minEthBalance > 0n) {
      const balance = await provider.getBalance(bidderAddress);
      if (balance < minEthBalance) {
        const topUp = minEthBalance - balance;
        await (await deployer.sendTransaction({ to: bidderAddress, value: topUp })).wait();
      }
    }

    const jitterBps = BigInt(envNumber('PRICE_JITTER_BPS', 5000));
    const randBps =
      priceMultiplierBps +
      (jitterBps === 0n ? 0n : BigInt(Math.floor(Math.random() * Number(jitterBps))));
    let maxPrice = (floorPrice * randBps) / 10_000n;
    if (maxPrice <= floorPrice) {
      maxPrice = floorPrice + tickSpacing;
    }
    const remainder = maxPrice % tickSpacing;
    if (remainder !== 0n) {
      maxPrice -= remainder;
    }

    const amount = minBid + BigInt(Math.floor(Math.random() * Number(maxBid - minBid + 1n)));

    if (currency) {
      const mintable = currency.interface.fragments.some(
        (f) => f.type === 'function' && f.name === 'mint'
      );
      if (mintable) {
        try {
          await (await currency.connect(deployer).mint(bidderAddress, amount)).wait();
        } catch {
          // Ignore mint failures for non-mintable tokens.
        }
      }
      await ensurePermit2Allowance(currency, permit2, bidder, auctionAddress, amount, expirationDays);
      const tx = await auction.connect(bidder).submitBid(maxPrice, amount, bidderAddress, '0x');
      const receipt = await tx.wait();
      const bidId = receipt?.logs
        .filter((log) => log.address.toLowerCase() === auctionAddress.toLowerCase())
        .map((log) => {
          try {
            return auction.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed && parsed.name === 'BidSubmitted')?.args?.id;

      bids.push({
        bidder: bidderAddress,
        amount: amount.toString(),
        maxPrice: maxPrice.toString(),
        bidId: bidId ? bidId.toString() : '0'
      });
    } else {
      const tx = await auction
        .connect(bidder)
        .submitBid(maxPrice, amount, bidderAddress, '0x', { value: amount });
      const receipt = await tx.wait();
      const bidId = receipt?.logs
        .filter((log) => log.address.toLowerCase() === auctionAddress.toLowerCase())
        .map((log) => {
          try {
            return auction.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed && parsed.name === 'BidSubmitted')?.args?.id;

      bids.push({
        bidder: bidderAddress,
        amount: amount.toString(),
        maxPrice: maxPrice.toString(),
        bidId: bidId ? bidId.toString() : '0'
      });
    }
  }

  const output = {
    network: network.name,
    auction: auctionAddress,
    currency: currencyAddress,
    bids
  };

  const outDir = path.resolve('data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `cca-bids-${network.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`Submitted ${bids.length} bids. Saved ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
