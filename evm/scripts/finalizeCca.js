const { ethers, network } = require('hardhat');
const { ccaAbi } = require('../src/abis/cca');
const { lbpStrategyAbi } = require('../src/abis/lbpStrategy');
const { erc20Abi } = require('../src/abis/erc20');
const { recoveryPoolAbi } = require('../src/abis/recoveryPool');
const { RECOVERY_POOL_TARGET } = require('../src/config/phase2');
const { loadDeployments } = require('../src/utils/deployments.cjs');

async function mineTo(target) {
  const provider = ethers.provider;
  let current = await provider.getBlockNumber();
  while (current < target) {
    await provider.send('evm_mine', []);
    current = await provider.getBlockNumber();
  }
}

async function main() {
  const deployments = loadDeployments();
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;

  const auction = new ethers.Contract(deployments.auction, ccaAbi, deployer);
  const lbp = new ethers.Contract(deployments.distribution, lbpStrategyAbi, deployer);
  const currency =
    deployments.currency === ethers.ZeroAddress
      ? null
      : new ethers.Contract(deployments.currency, erc20Abi, deployer);
  const recoveryPool = new ethers.Contract(deployments.recoveryPool, recoveryPoolAbi, deployer);

  const endBlock = Number(deployments.auctionParams.endBlock);
  const currentBlock = await provider.getBlockNumber();
  if (currentBlock < endBlock) {
    if (network.name === 'anvil' || network.name === 'hardhat') {
      await mineTo(endBlock + 1);
    } else {
      throw new Error(`Auction not finished yet (block ${currentBlock} < ${endBlock})`);
    }
  }

  await (await auction.checkpoint()).wait();
  await (await auction.sweepCurrency()).wait();

  if (process.env.RUN_MIGRATE === '1') {
    const migrationBlock = deployments.blocks.migration;
    const now = await provider.getBlockNumber();
    if (now < migrationBlock && (network.name === 'anvil' || network.name === 'hardhat')) {
      await mineTo(migrationBlock);
    }
    await (await lbp.migrate()).wait();
  }

  if (process.env.FUND_RECOVERY === '1') {
    const sweepBlock = deployments.blocks.sweep;
    const now = await provider.getBlockNumber();
    if (now < sweepBlock && (network.name === 'anvil' || network.name === 'hardhat')) {
      await mineTo(sweepBlock);
    }
    await (await lbp.sweepCurrency()).wait();

    if (!currency) {
      throw new Error('Cannot fund recovery pool with native currency');
    }
    const balance = await currency.balanceOf(deployer.address);
    const fundAmount = balance > RECOVERY_POOL_TARGET ? RECOVERY_POOL_TARGET : balance;
    if (fundAmount > 0n) {
      await (await currency.approve(recoveryPool.target, fundAmount)).wait();
      await (await recoveryPool.fund(fundAmount)).wait();
    }
  }

  console.log('Finalization complete.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
