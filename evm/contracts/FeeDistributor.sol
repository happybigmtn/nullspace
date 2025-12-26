// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract FeeDistributor is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable currency;
    bytes32 public merkleRoot;
    uint256 public claimDeadline;
    uint256 public distributionEpoch;
    bool public paused;

    mapping(address => uint256) public claimed;

    event MerkleRootUpdated(bytes32 root, uint256 claimDeadline, uint256 epoch);
    event Seeded(address indexed from, uint256 amount);
    event Claimed(address indexed account, uint256 amount, uint256 totalClaimed);
    event Paused(bool paused);
    event Swept(address indexed recipient, uint256 amount);

    constructor(address owner_, IERC20 currency_) Ownable(owner_) {
        currency = currency_;
    }

    function setMerkleRoot(bytes32 root, uint256 deadline, uint256 epoch) external onlyOwner {
        require(epoch >= distributionEpoch, "FeeDistributor: epoch regressed");
        if (deadline != 0) {
            require(deadline > block.timestamp, "FeeDistributor: bad deadline");
        }
        distributionEpoch = epoch;
        merkleRoot = root;
        claimDeadline = deadline;
        emit MerkleRootUpdated(root, deadline, epoch);
    }

    function setPaused(bool nextPaused) external onlyOwner {
        paused = nextPaused;
        emit Paused(nextPaused);
    }

    function seed(uint256 amount) external onlyOwner {
        require(amount > 0, "FeeDistributor: amount=0");
        currency.safeTransferFrom(msg.sender, address(this), amount);
        emit Seeded(msg.sender, amount);
    }

    function claim(uint256 totalEligible, bytes32[] calldata proof) external {
        require(!paused, "FeeDistributor: paused");
        if (claimDeadline != 0) {
            require(block.timestamp <= claimDeadline, "FeeDistributor: claim closed");
        }
        require(totalEligible > 0, "FeeDistributor: ineligible");

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, totalEligible));
        require(MerkleProof.verify(proof, merkleRoot, leaf), "FeeDistributor: invalid proof");

        uint256 alreadyClaimed = claimed[msg.sender];
        require(alreadyClaimed < totalEligible, "FeeDistributor: already claimed");

        uint256 amount = totalEligible - alreadyClaimed;
        claimed[msg.sender] = totalEligible;
        currency.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount, totalEligible);
    }

    function sweep(address recipient) external onlyOwner {
        require(recipient != address(0), "FeeDistributor: recipient=0");
        if (claimDeadline != 0) {
            require(block.timestamp > claimDeadline, "FeeDistributor: claim active");
        }
        uint256 balance = currency.balanceOf(address(this));
        require(balance > 0, "FeeDistributor: empty");
        currency.safeTransfer(recipient, balance);
        emit Swept(recipient, balance);
    }
}
