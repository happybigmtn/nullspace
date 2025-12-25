// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract RNGToken is ERC20, Ownable {
    uint256 public immutable cap;

    constructor(string memory name_, string memory symbol_, uint256 cap_, address owner_) ERC20(name_, symbol_) Ownable(owner_) {
        cap = cap_;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= cap, "RNGToken: cap exceeded");
        _mint(to, amount);
    }

    function UNDERLYING_TOKEN_ADDRESS() external view returns (address) {
        return address(this);
    }
}
