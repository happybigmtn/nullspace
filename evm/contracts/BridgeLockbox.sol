// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract BridgeLockbox is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable rng;

    event Deposited(address indexed from, uint256 amount, bytes32 destination);
    event Withdrawn(address indexed to, uint256 amount, bytes32 source);

    constructor(address owner_, IERC20 rng_) Ownable(owner_) {
        rng = rng_;
    }

    function deposit(uint256 amount, bytes32 destination) external {
        require(amount > 0, "BridgeLockbox: amount=0");
        rng.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, destination);
    }

    function withdraw(address to, uint256 amount, bytes32 source) external onlyOwner {
        require(to != address(0), "BridgeLockbox: to=0");
        require(amount > 0, "BridgeLockbox: amount=0");
        rng.safeTransfer(to, amount);
        emit Withdrawn(to, amount, source);
    }
}
