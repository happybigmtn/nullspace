// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract BogoDistributor is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable rng;
    bytes32 public merkleRoot;
    uint256 public claimDeadline;

    mapping(address => uint256) public claimed;

    event MerkleRootUpdated(bytes32 root, uint256 claimDeadline);
    event Claimed(address indexed account, uint256 amount, uint256 totalClaimed);

    constructor(address owner_, IERC20 rng_) Ownable(owner_) {
        rng = rng_;
    }

    function setMerkleRoot(bytes32 root, uint256 deadline) external onlyOwner {
        require(deadline == 0 || deadline > block.timestamp, "BogoDistributor: bad deadline");
        merkleRoot = root;
        claimDeadline = deadline;
        emit MerkleRootUpdated(root, deadline);
    }

    function seed(uint256 amount) external onlyOwner {
        rng.safeTransferFrom(msg.sender, address(this), amount);
    }

    function claim(uint256 totalEligible, bytes32[] calldata proof) external {
        if (claimDeadline != 0) {
            require(block.timestamp <= claimDeadline, "BogoDistributor: claim closed");
        }
        require(totalEligible > 0, "BogoDistributor: ineligible");

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, totalEligible));
        require(MerkleProof.verify(proof, merkleRoot, leaf), "BogoDistributor: invalid proof");

        uint256 alreadyClaimed = claimed[msg.sender];
        require(alreadyClaimed < totalEligible, "BogoDistributor: already claimed");

        uint256 amount = totalEligible - alreadyClaimed;
        claimed[msg.sender] = totalEligible;
        rng.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount, totalEligible);
    }
}
