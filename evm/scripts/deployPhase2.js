const fs = require('node:fs');
const path = require('node:path');
const { ethers, network } = require('hardhat');
const { buildAuctionParameters } = require('../src/auction/params');
const { virtualLbpFactoryAbi } = require('../src/abis/virtualLbpFactory');
const { distributionContractAbi } = require('../src/abis/distributionContract');
const { erc20Abi } = require('../src/abis/erc20');
const { DEFAULT_ADDRESSES } = require('../src/config/addresses');
const {
  AUCTION_ALLOCATION,
  BONUS_ALLOCATION,
  LIQUIDITY_ALLOCATION,
  LBP_TOTAL,
  PLAYER_ALLOCATION,
  TEAM_ALLOCATION,
  TOTAL_SUPPLY,
  TREASURY_ALLOCATION,
  tokenSplitMps,
  USDT_DECIMALS,
  USDT_UNIT
} = require('../src/config/phase2');

const Q96 = 2n ** 96n;
const ACTION_MSG_SENDER = '0x0000000000000000000000000000000000000001';

function envString(key, fallback = '') {
  const value = process.env[key];
  return value && value.length > 0 ? value : fallback;
}

function envNumber(key, fallback) {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function floorPriceQ96(currencyDecimals) {
  const explicit = envString('AUCTION_FLOOR_PRICE_Q96');
  if (explicit) {
    return BigInt(explicit);
  }
  const floorUnitsRaw = envString('AUCTION_FLOOR_PRICE', '0.05');
  const floorUnits = ethers.parseUnits(floorUnitsRaw, currencyDecimals);
  return floorUnits * Q96;
}

function resolveTickSpacing(floorPrice) {
  const explicit = envString('AUCTION_TICK_SPACING');
  if (explicit) {
    const spacing = BigInt(explicit);
    if (spacing < 2n) {
      throw new Error('AUCTION_TICK_SPACING must be >= 2');
    }
    if (floorPrice % spacing !== 0n) {
      throw new Error('AUCTION_TICK_SPACING must divide the floor price');
    }
    return spacing;
  }
  const spacing = floorPrice / 100n;
  if (spacing < 2n) {
    return 2n;
  }
  return spacing;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const addresses = DEFAULT_ADDRESSES[network.name];
  if (!addresses) {
    throw new Error(`Unsupported network: ${network.name}`);
  }

  const virtualLbpFactory = envString('VIRTUAL_LBP_FACTORY', addresses.virtualLbpFactory);
  const ccaFactory = envString('CCA_FACTORY', addresses.ccaFactory);

  if (virtualLbpFactory === ethers.ZeroAddress) {
    throw new Error('VIRTUAL_LBP_FACTORY is required for this deployment');
  }

  const currencyDecimals = envNumber('CURRENCY_DECIMALS', Number(USDT_DECIMALS));
  const currentBlock = await ethers.provider.getBlockNumber();
  const startOffset = envNumber('AUCTION_START_BLOCK_OFFSET', 30);
  const durationBlocks = envNumber('AUCTION_DURATION_BLOCKS', 7200);
  const claimOffset = envNumber('AUCTION_CLAIM_BLOCK_OFFSET', 400);
  const migrationOffset = envNumber('MIGRATION_BLOCK_OFFSET', 200);
  const sweepOffset = envNumber('SWEEP_BLOCK_OFFSET', 400);

  const startBlock = currentBlock + startOffset;
  const endBlock = startBlock + durationBlocks;
  const claimBlock = endBlock + claimOffset;
  const migrationBlock = endBlock + migrationOffset;
  const sweepBlock = migrationBlock + sweepOffset;

  const floorPrice = floorPriceQ96(currencyDecimals);
  const tickSpacing = resolveTickSpacing(floorPrice);
  const requiredRaise = envString('AUCTION_REQUIRED_RAISE')
    ? ethers.parseUnits(envString('AUCTION_REQUIRED_RAISE'), currencyDecimals)
    : 0n;

  const steps = (() => {
    const step1 = Math.max(1, Math.floor(durationBlocks * 0.2));
    const step2 = Math.max(1, Math.floor(durationBlocks * 0.3));
    const step3 = Math.max(1, durationBlocks - step1 - step2);
    return [
      { blockDelta: step1, weight: 10 },
      { blockDelta: step2, weight: 30 },
      { blockDelta: step3, weight: 60 }
    ];
  })();

  const [rngTokenFactory, mockUsdtFactory, recoveryPoolFactory, bogoFactory, bridgeFactory] =
    await Promise.all([
      ethers.getContractFactory('RNGToken'),
      ethers.getContractFactory('MockUSDT'),
      ethers.getContractFactory('RecoveryPool'),
      ethers.getContractFactory('BogoDistributor'),
      ethers.getContractFactory('BridgeLockbox')
    ]);

  const rngToken = await rngTokenFactory.deploy('RNG', 'RNG', TOTAL_SUPPLY, deployer.address);
  await rngToken.waitForDeployment();

  let currencyAddress = envString('PHASE2_CURRENCY');
  let mockUsdt = null;
  if (!currencyAddress) {
    mockUsdt = await mockUsdtFactory.deploy(deployer.address, currencyDecimals);
    await mockUsdt.waitForDeployment();
    currencyAddress = await mockUsdt.getAddress();
  }
  if (currencyAddress === ethers.ZeroAddress) {
    throw new Error('PHASE2_CURRENCY must be an ERC-20 for recovery pool support');
  }

  const auctionParams = buildAuctionParameters({
    currency: currencyAddress,
    tokensRecipient: ACTION_MSG_SENDER,
    fundsRecipient: ACTION_MSG_SENDER,
    startBlock: BigInt(startBlock),
    endBlock: BigInt(endBlock),
    claimBlock: BigInt(claimBlock),
    tickSpacing,
    validationHook: ethers.ZeroAddress,
    floorPrice,
    requiredCurrencyRaised: requiredRaise,
    totalMps: 10_000_000,
    steps
  });

  const auctionParamsEncoded = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      'tuple(address currency,address tokensRecipient,address fundsRecipient,uint64 startBlock,uint64 endBlock,uint64 claimBlock,uint256 tickSpacing,address validationHook,uint256 floorPrice,uint128 requiredCurrencyRaised,bytes auctionStepsData)'
    ],
    [auctionParams]
  );

  const poolLPFee = envNumber('POOL_LP_FEE', 3000);
  const poolTickSpacing = envNumber('POOL_TICK_SPACING', 60);
  const positionRecipient = envString('POOL_POSITION_RECIPIENT', deployer.address);
  const operator = envString('TREASURY_OPERATOR', deployer.address);
  const governanceAddress = envString('GOVERNANCE_ADDRESS', deployer.address);
  const createOneSidedTokenPosition = envString('ONE_SIDED_TOKEN', '0') === '1';
  const createOneSidedCurrencyPosition = envString('ONE_SIDED_CURRENCY', '0') === '1';

  const migratorParams = {
    migrationBlock: BigInt(migrationBlock),
    currency: currencyAddress,
    poolLPFee,
    poolTickSpacing,
    tokenSplitToAuction: tokenSplitMps(),
    auctionFactory: ccaFactory,
    positionRecipient,
    sweepBlock: BigInt(sweepBlock),
    operator,
    createOneSidedTokenPosition,
    createOneSidedCurrencyPosition
  };

  const configData = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      'address',
      'tuple(uint64 migrationBlock,address currency,uint24 poolLPFee,int24 poolTickSpacing,uint24 tokenSplitToAuction,address auctionFactory,address positionRecipient,uint64 sweepBlock,address operator,bool createOneSidedTokenPosition,bool createOneSidedCurrencyPosition)',
      'bytes'
    ],
    [governanceAddress, migratorParams, auctionParamsEncoded]
  );

  const saltInput = envString('LBP_SALT');
  const salt = saltInput
    ? saltInput.length === 66 && saltInput.startsWith('0x')
      ? saltInput
      : ethers.id(saltInput)
    : ethers.id('RNG-LBP');

  const factory = new ethers.Contract(virtualLbpFactory, virtualLbpFactoryAbi, deployer);
  const expectedDistribution = await factory.getVirtualLBPAddress(
    await rngToken.getAddress(),
    LBP_TOTAL,
    configData,
    salt,
    deployer.address
  );

  const recoveryPool = await recoveryPoolFactory.deploy(deployer.address, currencyAddress);
  await recoveryPool.waitForDeployment();

  const bogoDistributor = await bogoFactory.deploy(deployer.address, await rngToken.getAddress());
  await bogoDistributor.waitForDeployment();

  const bridgeLockbox = await bridgeFactory.deploy(deployer.address, await rngToken.getAddress());
  await bridgeLockbox.waitForDeployment();

  await (await rngToken.mint(deployer.address, TOTAL_SUPPLY)).wait();

  const rng = new ethers.Contract(await rngToken.getAddress(), erc20Abi, deployer);
  await (await rng.transfer(expectedDistribution, LBP_TOTAL)).wait();
  await (await rng.transfer(await bridgeLockbox.getAddress(), PLAYER_ALLOCATION)).wait();
  await (await rng.transfer(envString('TREASURY_ADDRESS', deployer.address), TREASURY_ALLOCATION)).wait();
  await (await rng.transfer(envString('TEAM_ADDRESS', deployer.address), TEAM_ALLOCATION)).wait();

  await (await rng.approve(await bogoDistributor.getAddress(), BONUS_ALLOCATION)).wait();
  await (await bogoDistributor.seed(BONUS_ALLOCATION)).wait();

  const initTx = await factory.initializeDistribution(
    await rngToken.getAddress(),
    LBP_TOTAL,
    configData,
    salt
  );
  await initTx.wait();

  const distribution = new ethers.Contract(expectedDistribution, distributionContractAbi, deployer);
  await (await distribution.onTokensReceived()).wait();
  const auctionAddress = await distribution.auction();

  const output = {
    network: network.name,
    deployer: deployer.address,
    rng: await rngToken.getAddress(),
    currency: currencyAddress,
    mockUsdt: mockUsdt ? await mockUsdt.getAddress() : null,
    recoveryPool: await recoveryPool.getAddress(),
    bogoDistributor: await bogoDistributor.getAddress(),
    bridgeLockbox: await bridgeLockbox.getAddress(),
    distribution: expectedDistribution,
    auction: auctionAddress,
    allocations: {
      total: TOTAL_SUPPLY.toString(),
      auction: AUCTION_ALLOCATION.toString(),
      liquidity: LIQUIDITY_ALLOCATION.toString(),
      bonus: BONUS_ALLOCATION.toString(),
      player: PLAYER_ALLOCATION.toString(),
      treasury: TREASURY_ALLOCATION.toString(),
      team: TEAM_ALLOCATION.toString()
    },
    auctionParams: {
      ...auctionParams,
      floorPrice: auctionParams.floorPrice.toString(),
      tickSpacing: auctionParams.tickSpacing.toString(),
      requiredCurrencyRaised: auctionParams.requiredCurrencyRaised.toString(),
      startBlock: auctionParams.startBlock.toString(),
      endBlock: auctionParams.endBlock.toString(),
      claimBlock: auctionParams.claimBlock.toString()
    },
    migratorParams: {
      ...migratorParams,
      migrationBlock: migratorParams.migrationBlock.toString(),
      sweepBlock: migratorParams.sweepBlock.toString()
    },
    blocks: {
      current: currentBlock,
      start: startBlock,
      end: endBlock,
      claim: claimBlock,
      migration: migrationBlock,
      sweep: sweepBlock
    }
  };

  const deploymentsDir = path.resolve('deployments');
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outPath = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  const recoveryTarget = 20_000_000n * USDT_UNIT;
  console.log('Deployment complete.');
  console.log(`RNG token: ${output.rng}`);
  console.log(`Currency: ${output.currency}`);
  console.log(`Distribution: ${output.distribution}`);
  console.log(`Auction: ${output.auction}`);
  console.log(`Recovery pool target: ${recoveryTarget.toString()}`);
  console.log(`Saved deployment to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
