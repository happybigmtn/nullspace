const { expect } = require('chai');
const { ethers } = require('hardhat');
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');

describe('EVM contracts', function () {
  it('mints RNG within cap and exposes underlying token address', async () => {
    const [owner, user] = await ethers.getSigners();
    const rngFactory = await ethers.getContractFactory('RNGToken');
    const rng = await rngFactory.deploy('RNG', 'RNG', 1_000_000n, owner.address);
    await rng.waitForDeployment();

    await expect(rng.mint(user.address, 500_000n)).to.not.be.reverted;
    await expect(rng.mint(user.address, 600_000n)).to.be.revertedWith('RNGToken: cap exceeded');

    const underlying = await rng.UNDERLYING_TOKEN_ADDRESS();
    expect(underlying).to.equal(await rng.getAddress());
  });

  it('mints mock USDT and respects custom decimals', async () => {
    const [owner, user] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('MockUSDT');
    const token = await factory.deploy(owner.address, 6);
    await token.waitForDeployment();

    expect(await token.decimals()).to.equal(6);
    await expect(token.mint(user.address, 1_000_000n)).to.not.be.reverted;
    expect(await token.balanceOf(user.address)).to.equal(1_000_000n);
  });

  it('funds and repays the recovery pool', async () => {
    const [owner, user] = await ethers.getSigners();
    const usdtFactory = await ethers.getContractFactory('MockUSDT');
    const usdt = await usdtFactory.deploy(owner.address, 6);
    await usdt.waitForDeployment();

    const poolFactory = await ethers.getContractFactory('RecoveryPool');
    const pool = await poolFactory.deploy(owner.address, await usdt.getAddress());
    await pool.waitForDeployment();

    await usdt.mint(owner.address, 2_000_000n);
    await usdt.approve(await pool.getAddress(), 2_000_000n);
    await expect(pool.fund(2_000_000n)).to.not.be.reverted;
    expect(await pool.totalFunded()).to.equal(2_000_000n);

    await expect(pool.repay(user.address, 500_000n)).to.not.be.reverted;
    expect(await usdt.balanceOf(user.address)).to.equal(500_000n);
    expect(await pool.totalRepaid()).to.equal(500_000n);
  });

  it('distributes BOGO claims via Merkle proofs', async () => {
    const [owner, alice, bob] = await ethers.getSigners();
    const rngFactory = await ethers.getContractFactory('RNGToken');
    const rng = await rngFactory.deploy('RNG', 'RNG', 1_000_000n, owner.address);
    await rng.waitForDeployment();

    const distributorFactory = await ethers.getContractFactory('BogoDistributor');
    const distributor = await distributorFactory.deploy(owner.address, await rng.getAddress());
    await distributor.waitForDeployment();

    const aliceAmount = 1000n;
    const bobAmount = 2000n;
    const leaves = [
      ethers.solidityPackedKeccak256(['address', 'uint256'], [alice.address, aliceAmount]),
      ethers.solidityPackedKeccak256(['address', 'uint256'], [bob.address, bobAmount])
    ].map((leaf) => Buffer.from(leaf.slice(2), 'hex'));

    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    const root = tree.getHexRoot();
    await distributor.setMerkleRoot(root, 0);

    await rng.mint(owner.address, 10_000n);
    await rng.approve(await distributor.getAddress(), 10_000n);
    await distributor.seed(10_000n);

    const aliceProof = tree.getHexProof(leaves[0]);
    await expect(distributor.connect(alice).claim(aliceAmount, aliceProof)).to.not.be.reverted;
    expect(await rng.balanceOf(alice.address)).to.equal(aliceAmount);
    await expect(distributor.connect(alice).claim(aliceAmount, aliceProof)).to.be.revertedWith(
      'BogoDistributor: already claimed'
    );

    const bobProof = tree.getHexProof(leaves[1]);
    await expect(distributor.connect(bob).claim(bobAmount, bobProof)).to.not.be.reverted;
    expect(await rng.balanceOf(bob.address)).to.equal(bobAmount);
  });

  it('locks and releases tokens in the bridge lockbox', async () => {
    const [owner, user] = await ethers.getSigners();
    const rngFactory = await ethers.getContractFactory('RNGToken');
    const rng = await rngFactory.deploy('RNG', 'RNG', 1_000_000n, owner.address);
    await rng.waitForDeployment();

    const lockboxFactory = await ethers.getContractFactory('BridgeLockbox');
    const lockbox = await lockboxFactory.deploy(owner.address, await rng.getAddress());
    await lockbox.waitForDeployment();

    await rng.mint(user.address, 1_000n);
    await rng.connect(user).approve(await lockbox.getAddress(), 1_000n);
    await expect(lockbox.connect(user).deposit(1_000n, ethers.id('dest'))).to.not.be.reverted;
    expect(await rng.balanceOf(await lockbox.getAddress())).to.equal(1_000n);

    await expect(lockbox.connect(user).withdraw(user.address, 1_000n, ethers.id('src'))).to.be.reverted;
    await expect(lockbox.withdraw(user.address, 1_000n, ethers.id('src'))).to.not.be.reverted;
    expect(await rng.balanceOf(user.address)).to.equal(1_000n);
  });
});
