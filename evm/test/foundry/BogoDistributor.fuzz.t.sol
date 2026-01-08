// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../contracts/BogoDistributor.sol";
import "../../contracts/RNGToken.sol";

/**
 * @title BogoDistributor Fuzz Tests
 * @notice Foundry fuzz tests for BogoDistributor claim logic and Merkle verification
 */
contract BogoDistributorFuzzTest is Test {
    BogoDistributor public distributor;
    RNGToken public rng;
    address public owner;
    address public alice;
    address public bob;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        rng = new RNGToken("RNG", "RNG", 10 ** 27, owner);
        distributor = new BogoDistributor(owner, rng);

        // Seed distributor with tokens
        rng.mint(owner, 10 ** 18);
        rng.approve(address(distributor), 10 ** 18);
        distributor.seed(10 ** 18);
    }

    /**
     * @notice Fuzz test: claimed amount should never exceed totalEligible
     * @param totalEligible Random eligible amount
     */
    function testFuzz_ClaimedNeverExceedsTotalEligible(uint256 totalEligible) public {
        vm.assume(totalEligible > 0);
        vm.assume(totalEligible <= 10 ** 18);

        // Build simple merkle tree with just alice
        bytes32 leaf = keccak256(abi.encodePacked(alice, totalEligible));
        bytes32[] memory proof = new bytes32[](0);

        // Set merkle root as just the leaf (single element tree)
        distributor.setMerkleRoot(leaf, 0);

        // Claim as alice
        vm.prank(alice);
        distributor.claim(totalEligible, proof);

        // Verify claimed matches totalEligible
        assertEq(distributor.claimed(alice), totalEligible);
        assertEq(rng.balanceOf(alice), totalEligible);
    }

    /**
     * @notice Fuzz test: double claim should always revert
     * @param amount Claim amount
     */
    function testFuzz_DoubleClaimReverts(uint256 amount) public {
        vm.assume(amount > 0);
        vm.assume(amount <= 10 ** 18);

        bytes32 leaf = keccak256(abi.encodePacked(alice, amount));
        bytes32[] memory proof = new bytes32[](0);
        distributor.setMerkleRoot(leaf, 0);

        // First claim succeeds
        vm.prank(alice);
        distributor.claim(amount, proof);

        // Second claim reverts
        vm.expectRevert("BogoDistributor: already claimed");
        vm.prank(alice);
        distributor.claim(amount, proof);
    }

    /**
     * @notice Fuzz test: cumulative claims work correctly
     * @param firstAmount First claim amount
     * @param secondAmount Second (larger) claim amount
     */
    function testFuzz_CumulativeClaimsWork(uint128 firstAmount, uint128 secondAmount) public {
        vm.assume(firstAmount > 0);
        vm.assume(secondAmount > firstAmount);
        vm.assume(uint256(secondAmount) <= 10 ** 18);

        // First distribution
        bytes32 leaf1 = keccak256(abi.encodePacked(alice, uint256(firstAmount)));
        bytes32[] memory proof = new bytes32[](0);
        distributor.setMerkleRoot(leaf1, 0);

        vm.prank(alice);
        distributor.claim(uint256(firstAmount), proof);
        assertEq(rng.balanceOf(alice), uint256(firstAmount));

        // Second distribution with higher amount
        bytes32 leaf2 = keccak256(abi.encodePacked(alice, uint256(secondAmount)));
        distributor.setMerkleRoot(leaf2, 0);

        vm.prank(alice);
        distributor.claim(uint256(secondAmount), proof);

        // Should have received the difference
        assertEq(rng.balanceOf(alice), uint256(secondAmount));
        assertEq(distributor.claimed(alice), uint256(secondAmount));
    }

    /**
     * @notice Fuzz test: wrong amount should fail proof verification
     * @param correctAmount Correct amount in tree
     * @param wrongAmount Wrong amount to claim
     */
    function testFuzz_WrongAmountFailsVerification(uint128 correctAmount, uint128 wrongAmount) public {
        vm.assume(correctAmount > 0);
        vm.assume(wrongAmount > 0);
        vm.assume(correctAmount != wrongAmount);
        vm.assume(uint256(correctAmount) <= 10 ** 18);
        vm.assume(uint256(wrongAmount) <= 10 ** 18);

        bytes32 leaf = keccak256(abi.encodePacked(alice, uint256(correctAmount)));
        bytes32[] memory proof = new bytes32[](0);
        distributor.setMerkleRoot(leaf, 0);

        // Try to claim wrong amount
        vm.expectRevert("BogoDistributor: invalid proof");
        vm.prank(alice);
        distributor.claim(uint256(wrongAmount), proof);
    }

    /**
     * @notice Fuzz test: zero eligibility always reverts
     */
    function testFuzz_ZeroEligibilityReverts() public {
        bytes32[] memory proof = new bytes32[](0);

        vm.expectRevert("BogoDistributor: ineligible");
        vm.prank(alice);
        distributor.claim(0, proof);
    }

    /**
     * @notice Fuzz test: different user with same proof fails
     * @param amount Claim amount
     */
    function testFuzz_DifferentUserFailsWithSameProof(uint256 amount) public {
        vm.assume(amount > 0);
        vm.assume(amount <= 10 ** 18);

        // Set up for alice
        bytes32 leaf = keccak256(abi.encodePacked(alice, amount));
        bytes32[] memory proof = new bytes32[](0);
        distributor.setMerkleRoot(leaf, 0);

        // Bob tries to claim with alice's proof
        vm.expectRevert("BogoDistributor: invalid proof");
        vm.prank(bob);
        distributor.claim(amount, proof);
    }

    /**
     * @notice Fuzz test: deadline enforcement
     * @param amount Claim amount
     * @param timeAfterDeadline Time to advance past deadline
     */
    function testFuzz_DeadlineEnforcement(uint256 amount, uint32 timeAfterDeadline) public {
        vm.assume(amount > 0);
        vm.assume(amount <= 10 ** 18);
        vm.assume(timeAfterDeadline > 0);

        uint256 deadline = block.timestamp + 100;

        bytes32 leaf = keccak256(abi.encodePacked(alice, amount));
        bytes32[] memory proof = new bytes32[](0);
        distributor.setMerkleRoot(leaf, deadline);

        // Advance time past deadline
        vm.warp(deadline + uint256(timeAfterDeadline));

        vm.expectRevert("BogoDistributor: claim closed");
        vm.prank(alice);
        distributor.claim(amount, proof);
    }
}
