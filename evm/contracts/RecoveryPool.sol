// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract RecoveryPool is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable currency;
    uint256 public totalFunded;
    uint256 public totalRepaid;

    event Funded(address indexed from, uint256 amount, uint256 totalFunded);
    event Repaid(address indexed recipient, uint256 amount, uint256 totalRepaid);
    event Swept(address indexed recipient, uint256 amount);

    constructor(address owner_, IERC20 currency_) Ownable(owner_) {
        currency = currency_;
    }

    function fund(uint256 amount) external onlyOwner {
        require(amount > 0, "RecoveryPool: amount=0");
        currency.safeTransferFrom(msg.sender, address(this), amount);
        totalFunded += amount;
        emit Funded(msg.sender, amount, totalFunded);
    }

    function repay(address recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "RecoveryPool: recipient=0");
        require(amount > 0, "RecoveryPool: amount=0");
        currency.safeTransfer(recipient, amount);
        totalRepaid += amount;
        emit Repaid(recipient, amount, totalRepaid);
    }

    function sweep(address recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "RecoveryPool: recipient=0");
        require(amount > 0, "RecoveryPool: amount=0");
        currency.safeTransfer(recipient, amount);
        emit Swept(recipient, amount);
    }
}
