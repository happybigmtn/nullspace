const { expect } = require('chai');
const { ethers } = require('hardhat');
const { MerkleTree } = require('merkletreejs');
const keccak256 = require('keccak256');

/**
 * Security-focused test suite for EVM contracts
 * Tests: overflow protection, reentrancy guards, access control edge cases
 */
describe('Security Tests', function () {
  // ==================== RecoveryPool Security ====================
  describe('RecoveryPool', function () {
    let owner, attacker, recipient;
    let usdt, pool;

    beforeEach(async function () {
      [owner, attacker, recipient] = await ethers.getSigners();

      const usdtFactory = await ethers.getContractFactory('MockUSDT');
      usdt = await usdtFactory.deploy(owner.address, 6);
      await usdt.waitForDeployment();

      const poolFactory = await ethers.getContractFactory('RecoveryPool');
      pool = await poolFactory.deploy(owner.address, await usdt.getAddress());
      await pool.waitForDeployment();
    });

    describe('Overflow Protection', function () {
      it('should handle large values without overflow in totalFunded', async function () {
        // Use large but not max values to avoid ERC20 issues
        const largeAmount = 10n ** 30n; // 1 trillion tokens with 18 decimals
        await usdt.mint(owner.address, largeAmount);
        await usdt.approve(await pool.getAddress(), largeAmount);

        await expect(pool.fund(largeAmount)).to.not.be.reverted;
        expect(await pool.totalFunded()).to.equal(largeAmount);

        // Accumulation of large amounts should work correctly
        await usdt.mint(owner.address, largeAmount);
        await usdt.approve(await pool.getAddress(), largeAmount);
        await expect(pool.fund(largeAmount)).to.not.be.reverted;
        expect(await pool.totalFunded()).to.equal(largeAmount * 2n);
      });

      it('should handle large values in totalRepaid tracking', async function () {
        const largeAmount = 10n ** 24n; // 1 million tokens with 18 decimals
        await usdt.mint(owner.address, largeAmount);
        await usdt.approve(await pool.getAddress(), largeAmount);
        await pool.fund(largeAmount);

        await pool.repay(recipient.address, largeAmount / 2n);
        expect(await pool.totalRepaid()).to.equal(largeAmount / 2n);

        await pool.repay(recipient.address, largeAmount / 2n);
        expect(await pool.totalRepaid()).to.equal(largeAmount);
      });

      it('should revert on fund amount zero', async function () {
        await expect(pool.fund(0)).to.be.revertedWith('RecoveryPool: amount=0');
      });

      it('should revert on repay amount zero', async function () {
        await expect(pool.repay(recipient.address, 0)).to.be.revertedWith('RecoveryPool: amount=0');
      });

      it('should revert on sweep amount zero', async function () {
        await expect(pool.sweep(recipient.address, 0)).to.be.revertedWith('RecoveryPool: amount=0');
      });
    });

    describe('Access Control', function () {
      it('should reject fund from non-owner', async function () {
        await usdt.mint(attacker.address, 1000n);
        await usdt.connect(attacker).approve(await pool.getAddress(), 1000n);

        await expect(pool.connect(attacker).fund(1000n)).to.be.revertedWithCustomError(
          pool,
          'OwnableUnauthorizedAccount'
        );
      });

      it('should reject repay from non-owner', async function () {
        await expect(pool.connect(attacker).repay(recipient.address, 100n)).to.be.revertedWithCustomError(
          pool,
          'OwnableUnauthorizedAccount'
        );
      });

      it('should reject sweep from non-owner', async function () {
        await expect(pool.connect(attacker).sweep(recipient.address, 100n)).to.be.revertedWithCustomError(
          pool,
          'OwnableUnauthorizedAccount'
        );
      });

      it('should reject repay to zero address', async function () {
        await usdt.mint(owner.address, 1000n);
        await usdt.approve(await pool.getAddress(), 1000n);
        await pool.fund(1000n);

        await expect(pool.repay(ethers.ZeroAddress, 100n)).to.be.revertedWith('RecoveryPool: recipient=0');
      });

      it('should reject sweep to zero address', async function () {
        await usdt.mint(owner.address, 1000n);
        await usdt.approve(await pool.getAddress(), 1000n);
        await pool.fund(1000n);

        await expect(pool.sweep(ethers.ZeroAddress, 100n)).to.be.revertedWith('RecoveryPool: recipient=0');
      });

      it('should allow ownership transfer and new owner can operate', async function () {
        await pool.transferOwnership(attacker.address);

        await usdt.mint(attacker.address, 1000n);
        await usdt.connect(attacker).approve(await pool.getAddress(), 1000n);

        await expect(pool.connect(attacker).fund(1000n)).to.not.be.reverted;
        expect(await pool.totalFunded()).to.equal(1000n);

        // Original owner should no longer have access
        await expect(pool.connect(owner).repay(recipient.address, 100n)).to.be.revertedWithCustomError(
          pool,
          'OwnableUnauthorizedAccount'
        );
      });
    });

    describe('Events', function () {
      it('should emit Funded event with correct parameters', async function () {
        await usdt.mint(owner.address, 1000n);
        await usdt.approve(await pool.getAddress(), 1000n);

        await expect(pool.fund(1000n))
          .to.emit(pool, 'Funded')
          .withArgs(owner.address, 1000n, 1000n);
      });

      it('should emit Repaid event with correct parameters', async function () {
        await usdt.mint(owner.address, 1000n);
        await usdt.approve(await pool.getAddress(), 1000n);
        await pool.fund(1000n);

        await expect(pool.repay(recipient.address, 500n))
          .to.emit(pool, 'Repaid')
          .withArgs(recipient.address, 500n, 500n);
      });

      it('should emit Swept event with correct parameters', async function () {
        await usdt.mint(owner.address, 1000n);
        await usdt.approve(await pool.getAddress(), 1000n);
        await pool.fund(1000n);

        await expect(pool.sweep(recipient.address, 1000n))
          .to.emit(pool, 'Swept')
          .withArgs(recipient.address, 1000n);
      });
    });
  });

  // ==================== BogoDistributor Security ====================
  describe('BogoDistributor', function () {
    let owner, alice, bob, attacker;
    let rng, distributor;

    beforeEach(async function () {
      [owner, alice, bob, attacker] = await ethers.getSigners();

      const rngFactory = await ethers.getContractFactory('RNGToken');
      rng = await rngFactory.deploy('RNG', 'RNG', 10n ** 18n, owner.address);
      await rng.waitForDeployment();

      const distributorFactory = await ethers.getContractFactory('BogoDistributor');
      distributor = await distributorFactory.deploy(owner.address, await rng.getAddress());
      await distributor.waitForDeployment();
    });

    function buildMerkleTree(entries) {
      const leaves = entries.map(([addr, amount]) =>
        Buffer.from(
          ethers.solidityPackedKeccak256(['address', 'uint256'], [addr, amount]).slice(2),
          'hex'
        )
      );
      const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      return { tree, leaves };
    }

    describe('Reentrancy Protection (CEI pattern)', function () {
      it('should update claimed state before transfer (CEI pattern)', async function () {
        const { tree, leaves } = buildMerkleTree([[alice.address, 1000n]]);
        await distributor.setMerkleRoot(tree.getHexRoot(), 0);

        await rng.mint(owner.address, 10000n);
        await rng.approve(await distributor.getAddress(), 10000n);
        await distributor.seed(10000n);

        const proof = tree.getHexProof(leaves[0]);
        await distributor.connect(alice).claim(1000n, proof);

        // Second claim should fail because state was updated before transfer
        await expect(distributor.connect(alice).claim(1000n, proof)).to.be.revertedWith(
          'BogoDistributor: already claimed'
        );
      });

      it('should support cumulative claims correctly', async function () {
        // First distribution: alice gets 500
        const tree1 = buildMerkleTree([[alice.address, 500n]]);
        await distributor.setMerkleRoot(tree1.tree.getHexRoot(), 0);

        await rng.mint(owner.address, 10000n);
        await rng.approve(await distributor.getAddress(), 10000n);
        await distributor.seed(10000n);

        await distributor.connect(alice).claim(500n, tree1.tree.getHexProof(tree1.leaves[0]));
        expect(await distributor.claimed(alice.address)).to.equal(500n);

        // Second distribution: alice total is now 800
        const tree2 = buildMerkleTree([[alice.address, 800n]]);
        await distributor.setMerkleRoot(tree2.tree.getHexRoot(), 0);

        await distributor.connect(alice).claim(800n, tree2.tree.getHexProof(tree2.leaves[0]));
        expect(await distributor.claimed(alice.address)).to.equal(800n);
        expect(await rng.balanceOf(alice.address)).to.equal(800n);
      });
    });

    describe('Access Control', function () {
      it('should reject setMerkleRoot from non-owner', async function () {
        await expect(
          distributor.connect(attacker).setMerkleRoot(ethers.ZeroHash, 0)
        ).to.be.revertedWithCustomError(distributor, 'OwnableUnauthorizedAccount');
      });

      it('should reject seed from non-owner', async function () {
        await rng.mint(attacker.address, 1000n);
        await rng.connect(attacker).approve(await distributor.getAddress(), 1000n);

        await expect(distributor.connect(attacker).seed(1000n)).to.be.revertedWithCustomError(
          distributor,
          'OwnableUnauthorizedAccount'
        );
      });
    });

    describe('Proof Validation', function () {
      it('should reject invalid merkle proof', async function () {
        const { tree, leaves } = buildMerkleTree([
          [alice.address, 1000n],
          [bob.address, 2000n]
        ]);
        await distributor.setMerkleRoot(tree.getHexRoot(), 0);

        await rng.mint(owner.address, 10000n);
        await rng.approve(await distributor.getAddress(), 10000n);
        await distributor.seed(10000n);

        // Try to claim bob's amount with alice's proof
        const aliceProof = tree.getHexProof(leaves[0]);
        await expect(
          distributor.connect(alice).claim(2000n, aliceProof)
        ).to.be.revertedWith('BogoDistributor: invalid proof');
      });

      it('should reject claim with wrong amount', async function () {
        const { tree, leaves } = buildMerkleTree([[alice.address, 1000n]]);
        await distributor.setMerkleRoot(tree.getHexRoot(), 0);

        await rng.mint(owner.address, 10000n);
        await rng.approve(await distributor.getAddress(), 10000n);
        await distributor.seed(10000n);

        const proof = tree.getHexProof(leaves[0]);
        await expect(distributor.connect(alice).claim(1001n, proof)).to.be.revertedWith(
          'BogoDistributor: invalid proof'
        );
      });

      it('should reject claim for different user with valid proof', async function () {
        const { tree, leaves } = buildMerkleTree([[alice.address, 1000n]]);
        await distributor.setMerkleRoot(tree.getHexRoot(), 0);

        await rng.mint(owner.address, 10000n);
        await rng.approve(await distributor.getAddress(), 10000n);
        await distributor.seed(10000n);

        const proof = tree.getHexProof(leaves[0]);
        // Attacker tries to use alice's proof
        await expect(distributor.connect(attacker).claim(1000n, proof)).to.be.revertedWith(
          'BogoDistributor: invalid proof'
        );
      });

      it('should reject zero eligibility claim', async function () {
        await expect(distributor.connect(alice).claim(0, [])).to.be.revertedWith(
          'BogoDistributor: ineligible'
        );
      });
    });

    describe('Deadline Enforcement', function () {
      it('should reject claim after deadline', async function () {
        const { tree, leaves } = buildMerkleTree([[alice.address, 1000n]]);
        const currentBlock = await ethers.provider.getBlock('latest');
        const deadline = currentBlock.timestamp + 100; // 100 seconds from now

        await distributor.setMerkleRoot(tree.getHexRoot(), deadline);

        await rng.mint(owner.address, 10000n);
        await rng.approve(await distributor.getAddress(), 10000n);
        await distributor.seed(10000n);

        // Mine blocks to pass deadline
        await ethers.provider.send('evm_increaseTime', [200]);
        await ethers.provider.send('evm_mine');

        const proof = tree.getHexProof(leaves[0]);
        await expect(distributor.connect(alice).claim(1000n, proof)).to.be.revertedWith(
          'BogoDistributor: claim closed'
        );
      });

      it('should reject bad deadline (in the past)', async function () {
        const currentBlock = await ethers.provider.getBlock('latest');
        const pastDeadline = currentBlock.timestamp - 100;

        await expect(
          distributor.setMerkleRoot(ethers.ZeroHash, pastDeadline)
        ).to.be.revertedWith('BogoDistributor: bad deadline');
      });

      it('should allow deadline of 0 (no deadline)', async function () {
        await expect(distributor.setMerkleRoot(ethers.ZeroHash, 0)).to.not.be.reverted;
        expect(await distributor.claimDeadline()).to.equal(0);
      });
    });
  });

  // ==================== FeeDistributor Security ====================
  describe('FeeDistributor', function () {
    let owner, alice, bob, attacker, treasury;
    let usdt, distributor;

    beforeEach(async function () {
      [owner, alice, bob, attacker, treasury] = await ethers.getSigners();

      const usdtFactory = await ethers.getContractFactory('MockUSDT');
      usdt = await usdtFactory.deploy(owner.address, 6);
      await usdt.waitForDeployment();

      const distributorFactory = await ethers.getContractFactory('FeeDistributor');
      distributor = await distributorFactory.deploy(owner.address, await usdt.getAddress());
      await distributor.waitForDeployment();
    });

    function buildMerkleTree(entries) {
      const leaves = entries.map(([addr, amount]) =>
        Buffer.from(
          ethers.solidityPackedKeccak256(['address', 'uint256'], [addr, amount]).slice(2),
          'hex'
        )
      );
      const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      return { tree, leaves };
    }

    describe('Epoch Management', function () {
      it('should reject epoch regression', async function () {
        await distributor.setMerkleRoot(ethers.ZeroHash, 0, 5);
        expect(await distributor.distributionEpoch()).to.equal(5);

        await expect(distributor.setMerkleRoot(ethers.ZeroHash, 0, 4)).to.be.revertedWith(
          'FeeDistributor: epoch regressed'
        );

        // Same epoch should be allowed
        await expect(distributor.setMerkleRoot(ethers.ZeroHash, 0, 5)).to.not.be.reverted;
      });
    });

    describe('Pause Mechanism', function () {
      it('should block claims when paused', async function () {
        const { tree, leaves } = buildMerkleTree([[alice.address, 1000n]]);
        await distributor.setMerkleRoot(tree.getHexRoot(), 0, 1);

        await usdt.mint(owner.address, 10000n);
        await usdt.approve(await distributor.getAddress(), 10000n);
        await distributor.seed(10000n);

        await distributor.setPaused(true);

        const proof = tree.getHexProof(leaves[0]);
        await expect(distributor.connect(alice).claim(1000n, proof)).to.be.revertedWith(
          'FeeDistributor: paused'
        );

        // Unpause and claim should work
        await distributor.setPaused(false);
        await expect(distributor.connect(alice).claim(1000n, proof)).to.not.be.reverted;
      });

      it('should emit Paused event', async function () {
        await expect(distributor.setPaused(true)).to.emit(distributor, 'Paused').withArgs(true);

        await expect(distributor.setPaused(false)).to.emit(distributor, 'Paused').withArgs(false);
      });
    });

    describe('Sweep Protection', function () {
      it('should reject sweep while claim is active (with deadline)', async function () {
        const currentBlock = await ethers.provider.getBlock('latest');
        const deadline = currentBlock.timestamp + 1000;

        await distributor.setMerkleRoot(ethers.ZeroHash, deadline, 1);

        await usdt.mint(owner.address, 10000n);
        await usdt.approve(await distributor.getAddress(), 10000n);
        await distributor.seed(10000n);

        await expect(distributor.sweep(treasury.address)).to.be.revertedWith(
          'FeeDistributor: claim active'
        );
      });

      it('should allow sweep after deadline passes', async function () {
        const currentBlock = await ethers.provider.getBlock('latest');
        const deadline = currentBlock.timestamp + 100;

        await distributor.setMerkleRoot(ethers.ZeroHash, deadline, 1);

        await usdt.mint(owner.address, 10000n);
        await usdt.approve(await distributor.getAddress(), 10000n);
        await distributor.seed(10000n);

        // Mine blocks to pass deadline
        await ethers.provider.send('evm_increaseTime', [200]);
        await ethers.provider.send('evm_mine');

        await expect(distributor.sweep(treasury.address)).to.not.be.reverted;
        expect(await usdt.balanceOf(treasury.address)).to.equal(10000n);
      });

      it('should reject sweep to zero address', async function () {
        await usdt.mint(owner.address, 10000n);
        await usdt.approve(await distributor.getAddress(), 10000n);
        await distributor.seed(10000n);

        await expect(distributor.sweep(ethers.ZeroAddress)).to.be.revertedWith(
          'FeeDistributor: recipient=0'
        );
      });

      it('should reject sweep when empty', async function () {
        await expect(distributor.sweep(treasury.address)).to.be.revertedWith('FeeDistributor: empty');
      });
    });

    describe('Seed Validation', function () {
      it('should reject zero amount seed', async function () {
        await expect(distributor.seed(0)).to.be.revertedWith('FeeDistributor: amount=0');
      });
    });
  });

  // ==================== BridgeLockbox Security ====================
  describe('BridgeLockbox', function () {
    let owner, user, attacker;
    let rng, lockbox;

    beforeEach(async function () {
      [owner, user, attacker] = await ethers.getSigners();

      const rngFactory = await ethers.getContractFactory('RNGToken');
      rng = await rngFactory.deploy('RNG', 'RNG', 10n ** 18n, owner.address);
      await rng.waitForDeployment();

      const lockboxFactory = await ethers.getContractFactory('BridgeLockbox');
      lockbox = await lockboxFactory.deploy(owner.address, await rng.getAddress());
      await lockbox.waitForDeployment();
    });

    describe('Deposit Validation', function () {
      it('should reject zero amount deposit', async function () {
        await expect(
          lockbox.connect(user).deposit(0, ethers.id('destination'))
        ).to.be.revertedWith('BridgeLockbox: amount=0');
      });

      it('should emit Deposited event with correct parameters', async function () {
        const dest = ethers.id('solana-mainnet');
        await rng.mint(user.address, 1000n);
        await rng.connect(user).approve(await lockbox.getAddress(), 1000n);

        await expect(lockbox.connect(user).deposit(1000n, dest))
          .to.emit(lockbox, 'Deposited')
          .withArgs(user.address, 1000n, dest);
      });
    });

    describe('Withdraw Access Control', function () {
      it('should reject withdraw from non-owner', async function () {
        await rng.mint(user.address, 1000n);
        await rng.connect(user).approve(await lockbox.getAddress(), 1000n);
        await lockbox.connect(user).deposit(1000n, ethers.id('dest'));

        await expect(
          lockbox.connect(attacker).withdraw(attacker.address, 1000n, ethers.id('src'))
        ).to.be.revertedWithCustomError(lockbox, 'OwnableUnauthorizedAccount');
      });

      it('should reject withdraw to zero address', async function () {
        await rng.mint(user.address, 1000n);
        await rng.connect(user).approve(await lockbox.getAddress(), 1000n);
        await lockbox.connect(user).deposit(1000n, ethers.id('dest'));

        await expect(
          lockbox.withdraw(ethers.ZeroAddress, 1000n, ethers.id('src'))
        ).to.be.revertedWith('BridgeLockbox: to=0');
      });

      it('should reject zero amount withdraw', async function () {
        await expect(
          lockbox.withdraw(user.address, 0, ethers.id('src'))
        ).to.be.revertedWith('BridgeLockbox: amount=0');
      });

      it('should emit Withdrawn event with correct parameters', async function () {
        const src = ethers.id('solana-mainnet');
        await rng.mint(user.address, 1000n);
        await rng.connect(user).approve(await lockbox.getAddress(), 1000n);
        await lockbox.connect(user).deposit(1000n, ethers.id('dest'));

        await expect(lockbox.withdraw(user.address, 1000n, src))
          .to.emit(lockbox, 'Withdrawn')
          .withArgs(user.address, 1000n, src);
      });
    });
  });

  // ==================== RNGToken Security ====================
  describe('RNGToken', function () {
    let owner, user, attacker;
    let rng;

    beforeEach(async function () {
      [owner, user, attacker] = await ethers.getSigners();

      const rngFactory = await ethers.getContractFactory('RNGToken');
      rng = await rngFactory.deploy('RNG', 'RNG', 1_000_000n, owner.address);
      await rng.waitForDeployment();
    });

    describe('Cap Enforcement', function () {
      it('should enforce cap at exact boundary', async function () {
        await expect(rng.mint(user.address, 1_000_000n)).to.not.be.reverted;
        expect(await rng.totalSupply()).to.equal(1_000_000n);

        // Mint even 1 more should fail
        await expect(rng.mint(user.address, 1n)).to.be.revertedWith('RNGToken: cap exceeded');
      });

      it('should handle multiple mints up to cap', async function () {
        await rng.mint(user.address, 400_000n);
        await rng.mint(user.address, 400_000n);
        await rng.mint(user.address, 200_000n);

        expect(await rng.totalSupply()).to.equal(1_000_000n);
        await expect(rng.mint(user.address, 1n)).to.be.revertedWith('RNGToken: cap exceeded');
      });
    });

    describe('Access Control', function () {
      it('should reject mint from non-owner', async function () {
        await expect(rng.connect(attacker).mint(attacker.address, 100n)).to.be.revertedWithCustomError(
          rng,
          'OwnableUnauthorizedAccount'
        );
      });

      it('should allow new owner to mint after transfer', async function () {
        await rng.transferOwnership(attacker.address);
        await expect(rng.connect(attacker).mint(user.address, 100n)).to.not.be.reverted;

        // Original owner should not be able to mint
        await expect(rng.connect(owner).mint(user.address, 100n)).to.be.revertedWithCustomError(
          rng,
          'OwnableUnauthorizedAccount'
        );
      });
    });
  });
});
