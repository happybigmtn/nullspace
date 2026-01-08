// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../contracts/RecoveryPool.sol";
import "../../contracts/MockUSDT.sol";

/**
 * @title RecoveryPool Fuzz Tests
 * @notice Foundry fuzz tests for RecoveryPool overflow protection and invariants
 */
contract RecoveryPoolFuzzTest is Test {
    RecoveryPool public pool;
    MockUSDT public usdt;
    address public owner;
    address public recipient;

    function setUp() public {
        owner = address(this);
        recipient = makeAddr("recipient");

        usdt = new MockUSDT(owner, 6);
        pool = new RecoveryPool(owner, usdt);
    }

    /**
     * @notice Fuzz test: fund should never overflow totalFunded
     * @param amount Random amount to fund
     */
    function testFuzz_FundDoesNotOverflow(uint256 amount) public {
        // Bound to reasonable amounts (avoid zero which reverts)
        vm.assume(amount > 0);
        vm.assume(amount < type(uint128).max); // Stay within mintable range

        usdt.mint(owner, amount);
        usdt.approve(address(pool), amount);

        pool.fund(amount);

        assertEq(pool.totalFunded(), amount);
        assertEq(usdt.balanceOf(address(pool)), amount);
    }

    /**
     * @notice Fuzz test: repay should never overflow totalRepaid
     * @param fundAmount Amount to fund first
     * @param repayAmount Amount to repay (bounded by fundAmount)
     */
    function testFuzz_RepayDoesNotOverflow(uint256 fundAmount, uint256 repayAmount) public {
        // Bound inputs
        vm.assume(fundAmount > 0);
        vm.assume(fundAmount < type(uint128).max);
        vm.assume(repayAmount > 0);
        vm.assume(repayAmount <= fundAmount);

        // Setup: fund the pool
        usdt.mint(owner, fundAmount);
        usdt.approve(address(pool), fundAmount);
        pool.fund(fundAmount);

        // Action: repay
        pool.repay(recipient, repayAmount);

        // Assert invariants
        assertEq(pool.totalRepaid(), repayAmount);
        assertEq(usdt.balanceOf(recipient), repayAmount);
        assertEq(usdt.balanceOf(address(pool)), fundAmount - repayAmount);
    }

    /**
     * @notice Fuzz test: multiple fund/repay cycles maintain accounting invariants
     * @param amounts Array of amounts to fund and repay
     */
    function testFuzz_MultipleCyclesMaintainInvariants(uint64[5] memory amounts) public {
        uint256 totalFunded = 0;
        uint256 totalRepaid = 0;

        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 amount = uint256(amounts[i]);
            if (amount == 0) continue;

            // Fund
            usdt.mint(owner, amount);
            usdt.approve(address(pool), amount);
            pool.fund(amount);
            totalFunded += amount;

            // Repay half
            uint256 repayAmount = amount / 2;
            if (repayAmount > 0) {
                pool.repay(recipient, repayAmount);
                totalRepaid += repayAmount;
            }
        }

        // Verify invariants
        assertEq(pool.totalFunded(), totalFunded);
        assertEq(pool.totalRepaid(), totalRepaid);
        assertEq(usdt.balanceOf(address(pool)), totalFunded - totalRepaid);
    }

    /**
     * @notice Fuzz test: sweep should transfer exact amount
     * @param fundAmount Amount to fund
     * @param sweepAmount Amount to sweep
     */
    function testFuzz_SweepExactAmount(uint256 fundAmount, uint256 sweepAmount) public {
        vm.assume(fundAmount > 0);
        vm.assume(fundAmount < type(uint128).max);
        vm.assume(sweepAmount > 0);
        vm.assume(sweepAmount <= fundAmount);

        usdt.mint(owner, fundAmount);
        usdt.approve(address(pool), fundAmount);
        pool.fund(fundAmount);

        pool.sweep(recipient, sweepAmount);

        assertEq(usdt.balanceOf(recipient), sweepAmount);
        assertEq(usdt.balanceOf(address(pool)), fundAmount - sweepAmount);
    }

    /**
     * @notice Fuzz test: zero amount should always revert
     */
    function testFuzz_ZeroAmountReverts() public {
        vm.expectRevert("RecoveryPool: amount=0");
        pool.fund(0);

        vm.expectRevert("RecoveryPool: amount=0");
        pool.repay(recipient, 0);

        vm.expectRevert("RecoveryPool: amount=0");
        pool.sweep(recipient, 0);
    }

    /**
     * @notice Fuzz test: zero recipient should always revert
     * @param amount Any positive amount
     */
    function testFuzz_ZeroRecipientReverts(uint256 amount) public {
        vm.assume(amount > 0);
        vm.assume(amount < type(uint128).max);

        usdt.mint(owner, amount);
        usdt.approve(address(pool), amount);
        pool.fund(amount);

        vm.expectRevert("RecoveryPool: recipient=0");
        pool.repay(address(0), amount);

        vm.expectRevert("RecoveryPool: recipient=0");
        pool.sweep(address(0), amount);
    }
}
