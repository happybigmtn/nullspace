# E31 - EVM contracts (token distribution and cross-chain mechanics)

Focus directory: `evm/contracts/`

Goal: provide a university-level technical chapter that explains the EVM contract suite for token distribution, cross-chain bridging, and continuous clearing auction mechanics. This lesson covers the Solidity contracts that manage RNG token minting, airdrop distribution, fee collection, recovery pools, and the bridge lockbox for cross-chain operations.

---

## Learning objectives

After this lesson you should be able to:

1) Explain the RNG token contract design and its capped minting mechanism.
2) Describe the Merkle-based distribution pattern used in BogoDistributor and FeeDistributor.
3) Trace the cross-chain bridge flow through BridgeLockbox deposit and withdrawal.
4) Understand the RecoveryPool's role in managing protocol reserves and user recovery.
5) Explain the CCA (Continuous Clearing Auction) mechanics and parameter configuration.
6) Identify the security boundaries and ownership patterns across all contracts.

---

## 0) Big idea (Feynman summary)

Imagine you have a casino token that needs to be distributed fairly, bridged between chains, and later used to collect fees from the house. You want provable allocations (no hidden mints), a way to lock tokens on one chain and release them on another, and a safety net for recovering losses when things go wrong.

That is what this contract suite does. RNGToken is the main token with a hard cap. BogoDistributor and FeeDistributor use Merkle proofs so anyone can verify eligibility without storing every address on-chain. BridgeLockbox lets tokens move between EVM and Solana. RecoveryPool holds emergency funds. The CCA auction handles the initial token sale with fair price discovery.

Everything is owner-controlled but verifiable. The contracts are simple by design: no upgradability, no complex governance, just explicit owner actions with event logs for transparency.

---

## 1) Problem framing: what are we actually building?

A casino protocol needs several token mechanics:

- **Token supply management**: minting tokens up to a cap, no hidden inflation.
- **Fair distribution**: airdrops to players without storing every address on-chain.
- **Cross-chain bridging**: moving tokens between EVM (Ethereum, Base, Arbitrum) and Solana.
- **Fee collection**: distributing house profits to token holders.
- **Recovery mechanism**: a pool for refunding users in edge cases or protocol failures.
- **Initial sale**: a price discovery mechanism for the initial token allocation.

Each contract solves one piece:

- `RNGToken.sol` - the token itself
- `BogoDistributor.sol` - one-time airdrop claims
- `FeeDistributor.sol` - recurring fee distributions
- `BridgeLockbox.sol` - cross-chain locking/unlocking
- `RecoveryPool.sol` - protocol safety fund
- CCA auction contracts (external, via Uniswap v4 hooks) - initial sale

The design philosophy is: keep contracts small, explicit, and auditable. No proxies, no complex governance, no emergent behavior.

---

## 2) Design principles (from the contracts)

All contracts share common patterns:

### 2.1 Ownership and control

Every contract uses OpenZeppelin's `Ownable` for explicit owner control. The owner is set at deployment and can be transferred. This is simpler than multi-sig or DAO governance for initial deployment, but the owner should eventually be a multi-sig or governance contract.

### 2.2 No upgradeability

None of these contracts use proxies or upgradeability patterns. This is a deliberate choice: immutability is a feature for trust. If the contracts need to change, deploy new ones and migrate state explicitly.

### 2.3 Event-driven transparency

Every state change emits an event. This makes off-chain indexers and audits possible. Events are the primary way to track what the owner did.

### 2.4 SafeERC20 for token operations

All token transfers use OpenZeppelin's `SafeERC20` library to handle non-standard ERC20 implementations (like USDT which doesn't return a boolean).

---

## 3) RNGToken.sol - the core token

Location: `/home/r/Coding/nullspace/evm/contracts/RNGToken.sol`

This is the main token contract. It is a standard ERC20 with a hard cap and owner-controlled minting.

### 3.1 Contract structure

```solidity
// Lines 7-22
contract RNGToken is ERC20, Ownable {
    uint256 public immutable cap;

    constructor(string memory name_, string memory symbol_, uint256 cap_, address owner_)
        ERC20(name_, symbol_) Ownable(owner_) {
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
```

### 3.2 Key properties

- **Immutable cap**: set at deployment, cannot be changed. This provides supply certainty.
- **Owner-only minting**: only the owner can mint tokens, up to the cap.
- **Standard ERC20**: inherits all standard token functions (transfer, approve, etc.).
- **UNDERLYING_TOKEN_ADDRESS**: a helper for compatibility with certain bridge interfaces.

### 3.3 Deployment considerations

The cap should be set to the total planned supply. For example, if the tokenomics document specifies 1 billion tokens, the cap should be `1_000_000_000 * 10**18` (assuming 18 decimals).

The owner should be a deployment EOA initially, then transferred to a multi-sig or governance contract after initial minting is complete.

### 3.4 Mint-once pattern

In practice, the owner mints tokens in several batches:

1) Mint tokens for the auction allocation to the auction contract.
2) Mint tokens for the airdrop allocation to the BogoDistributor.
3) Mint tokens for team, treasury, liquidity pools, etc.
4) After all minting is done, verify `totalSupply() == cap` or close to it.
5) Transfer ownership to a governance contract or burn the owner key.

This pattern ensures all tokens are accounted for at launch.

---

## 4) BogoDistributor.sol - one-time airdrop claims

Location: `/home/r/Coding/nullspace/evm/contracts/BogoDistributor.sol`

This contract distributes RNG tokens to eligible users via Merkle proofs. It is designed for one-time airdrops (like a genesis distribution or bonus program).

### 4.1 Contract structure

```solidity
// Lines 9-23
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
```

### 4.2 Merkle proof pattern

The owner computes a Merkle tree off-chain where each leaf is:

```
keccak256(abi.encodePacked(userAddress, totalEligible))
```

The root is published on-chain with `setMerkleRoot`:

```solidity
// Lines 25-30
function setMerkleRoot(bytes32 root, uint256 deadline) external onlyOwner {
    require(deadline == 0 || deadline > block.timestamp, "BogoDistributor: bad deadline");
    merkleRoot = root;
    claimDeadline = deadline;
    emit MerkleRootUpdated(root, deadline);
}
```

The deadline is optional (0 means no deadline). If set, users can only claim before that timestamp.

### 4.3 Claim flow

Users call `claim` with their proof:

```solidity
// Lines 36-52
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
```

This allows partial claims: if a user was eligible for 1000 tokens but only claimed 600, they can claim the remaining 400 later (as long as the deadline hasn't passed).

### 4.4 Seeding the distributor

The owner seeds the contract with tokens:

```solidity
// Lines 32-34
function seed(uint256 amount) external onlyOwner {
    rng.safeTransferFrom(msg.sender, address(this), amount);
}
```

The owner should seed enough tokens to cover all claims before users start claiming.

### 4.5 Why Merkle proofs?

Merkle proofs are gas-efficient for large airdrops. Instead of storing every eligible address on-chain (which would cost millions in gas for 100k+ users), the contract only stores a single 32-byte root. Users provide their own proofs, which are verified cheaply on-chain.

The tradeoff is that users must get their proof from an off-chain service (usually a web UI or API). The proof data is typically stored in IPFS or a backend and served on demand.

---

## 5) FeeDistributor.sol - recurring fee distributions

Location: `/home/r/Coding/nullspace/evm/contracts/FeeDistributor.sol`

This contract is similar to BogoDistributor but designed for recurring fee distributions. The key differences:

1) Uses a `distributionEpoch` counter for multiple rounds.
2) Includes a `paused` flag for emergency stops.
3) Has a `sweep` function to recover unclaimed funds after deadline.
4) Uses the protocol's fee currency (USDT/USDC) instead of RNG tokens.

### 5.1 Contract structure

```solidity
// Lines 9-28
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
```

### 5.2 Epoch-based distributions

Each distribution round increments the epoch:

```solidity
// Lines 30-39
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
```

The epoch must never decrease. This prevents the owner from rolling back to an old distribution by accident.

### 5.3 Pause mechanism

The owner can pause claims in emergencies:

```solidity
// Lines 41-44
function setPaused(bool nextPaused) external onlyOwner {
    paused = nextPaused;
    emit Paused(nextPaused);
}
```

The claim function checks this:

```solidity
// Lines 52-53
function claim(uint256 totalEligible, bytes32[] calldata proof) external {
    require(!paused, "FeeDistributor: paused");
    // ... rest of claim logic
```

### 5.4 Sweep unclaimed funds

After the deadline passes, the owner can recover unclaimed funds:

```solidity
// Lines 71-81
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
```

This is important because users may not claim all their fees (inactive users, lost wallets, etc.). The swept funds can be returned to the treasury or used for the next epoch.

### 5.5 Comparison: BogoDistributor vs FeeDistributor

| Feature | BogoDistributor | FeeDistributor |
|---------|----------------|----------------|
| Purpose | One-time airdrop | Recurring distributions |
| Token | RNG | USDT/USDC (fee currency) |
| Epochs | None (single distribution) | Incrementing epoch counter |
| Pause | No | Yes |
| Sweep | No | Yes (after deadline) |
| Use case | Genesis airdrop, bonuses | Weekly/monthly fee sharing |

---

## 6) RecoveryPool.sol - protocol safety fund

Location: `/home/r/Coding/nullspace/evm/contracts/RecoveryPool.sol`

This contract holds a reserve of the protocol's fee currency (USDT/USDC) for emergency recoveries. It has three functions: `fund`, `repay`, and `sweep`.

### 6.1 Contract structure

```solidity
// Lines 8-21
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
```

### 6.2 Fund the pool

The owner deposits funds:

```solidity
// Lines 23-28
function fund(uint256 amount) external onlyOwner {
    require(amount > 0, "RecoveryPool: amount=0");
    currency.safeTransferFrom(msg.sender, address(this), amount);
    totalFunded += amount;
    emit Funded(msg.sender, amount, totalFunded);
}
```

This is typically done after the CCA auction or from accumulated fees.

### 6.3 Repay users

The owner sends funds to users who need recovery:

```solidity
// Lines 30-36
function repay(address recipient, uint256 amount) external onlyOwner {
    require(recipient != address(0), "RecoveryPool: recipient=0");
    require(amount > 0, "RecoveryPool: amount=0");
    currency.safeTransfer(recipient, amount);
    totalRepaid += amount;
    emit Repaid(recipient, amount, totalRepaid);
}
```

This is manual recovery. The owner must decide who gets repaid based on off-chain analysis (for example, users affected by a bug or chain reorg).

### 6.4 Sweep excess

The owner can withdraw excess funds:

```solidity
// Lines 38-43
function sweep(address recipient, uint256 amount) external onlyOwner {
    require(recipient != address(0), "RecoveryPool: recipient=0");
    require(amount > 0, "RecoveryPool: amount=0");
    currency.safeTransfer(recipient, amount);
    emit Swept(recipient, amount);
}
```

Unlike `repay`, `sweep` does not increment `totalRepaid`. It is for removing surplus or reallocating funds, not for user recovery.

### 6.5 Why separate repay and sweep?

The distinction is semantic and audit-friendly:

- `repay` is for user recovery. The `totalRepaid` counter tracks how much was used for this purpose.
- `sweep` is for operational moves (e.g., moving funds to a new pool, returning to treasury).

Events make it easy to audit which was which.

### 6.6 Target funding level

The deployment script (`evm/scripts/finalizeCca.js`) references a `RECOVERY_POOL_TARGET` constant. This is the desired reserve size, typically a percentage of total value locked or a fixed amount like $100k. The owner should aim to keep the pool at this level.

---

## 7) BridgeLockbox.sol - cross-chain token bridge

Location: `/home/r/Coding/nullspace/evm/contracts/BridgeLockbox.sol`

This contract locks RNG tokens on the EVM side so they can be released on Solana (or another chain). It is the EVM half of a two-sided bridge.

### 7.1 Contract structure

```solidity
// Lines 8-18
contract BridgeLockbox is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable rng;

    event Deposited(address indexed from, uint256 amount, bytes32 destination);
    event Withdrawn(address indexed to, uint256 amount, bytes32 source);

    constructor(address owner_, IERC20 rng_) Ownable(owner_) {
        rng = rng_;
    }
```

### 7.2 Deposit (lock) flow

Users lock tokens by calling `deposit`:

```solidity
// Lines 20-24
function deposit(uint256 amount, bytes32 destination) external {
    require(amount > 0, "BridgeLockbox: amount=0");
    rng.safeTransferFrom(msg.sender, address(this), amount);
    emit Deposited(msg.sender, amount, destination);
}
```

The `destination` is a 32-byte identifier for the target chain account (e.g., a Solana public key encoded as bytes32). This event is watched by an off-chain relayer, which then mints equivalent tokens on Solana.

### 7.3 Withdraw (unlock) flow

The owner (or relayer with owner privileges) calls `withdraw` to release locked tokens:

```solidity
// Lines 26-31
function withdraw(address to, uint256 amount, bytes32 source) external onlyOwner {
    require(to != address(0), "BridgeLockbox: to=0");
    require(amount > 0, "BridgeLockbox: amount=0");
    rng.safeTransfer(to, amount);
    emit Withdrawn(to, amount, source);
}
```

The `source` is the transaction ID or account on the Solana side that burned tokens. This event proves the unlock was triggered by a valid burn on the other side.

### 7.4 Trust model

This is a **centralized bridge** with owner control. The owner can unlock tokens at will. This is acceptable for initial launch but should be upgraded to a multi-sig or decentralized relayer network for mainnet.

The security assumption is: the owner is honest and only calls `withdraw` when tokens were actually burned on Solana. In practice, the owner is a backend service that watches Solana burn events and relays them to the EVM.

### 7.5 Bridge flow diagram

```
User (EVM)
   |
   | deposit(amount, solanaAddress)
   v
BridgeLockbox (EVM)
   |
   | emit Deposited event
   v
Relayer (off-chain)
   |
   | watch EVM events
   | mint on Solana
   v
User (Solana)

---

User (Solana)
   |
   | burn(amount)
   v
Solana program
   |
   | emit burn log
   v
Relayer (off-chain)
   |
   | watch Solana logs
   | call BridgeLockbox.withdraw(to, amount, txid)
   v
User (EVM)
```

### 7.6 Why bytes32 for destination?

Solana public keys are 32 bytes. Using `bytes32` is more efficient than `string` and avoids encoding issues. The relayer must decode this correctly on the Solana side.

---

## 8) CCA auction mechanics (via Uniswap v4 hooks)

The Continuous Clearing Auction (CCA) is not a standalone contract in `evm/contracts/`. Instead, it is deployed via Uniswap v4 factory contracts and hooks. The scripts in `evm/scripts/` show how this works.

### 8.1 What is a CCA?

A CCA is a batch auction where:

1) Bidders submit bids with a max price they are willing to pay.
2) The auction runs for a fixed duration (e.g., 7 days).
3) At the end, the clearing price is determined by the highest price that clears the full supply.
4) All winning bidders pay the same clearing price.
5) Losing bids (below clearing price) are refunded.

This is fairer than a first-come-first-serve sale because everyone who wins pays the same price. There is no front-running or race to submit.

### 8.2 CCA parameters (from deployPhase2.js)

Location: `/home/r/Coding/nullspace/evm/scripts/deployPhase2.js`

The deployment script configures:

- `floorPrice`: minimum price per token (in fee currency, with 96-bit fixed-point encoding).
- `tickSpacing`: granularity of price increments.
- `startBlock` / `endBlock`: auction duration.
- `claimBlock`: when winners can claim tokens.
- `migrationBlock`: when the auction closes and liquidity is migrated.
- `sweepBlock`: when unclaimed funds can be swept.
- `requiredCurrencyRaised`: minimum raise to consider the auction successful.

Example from lines 80-160 of `deployPhase2.js`:

The script computes these parameters based on expected raise, total supply, and liquidity needs. The key insight is that the auction allocation and liquidity allocation must be coordinated: the auction raises currency, and some of that currency is used to seed a Uniswap v4 pool with the remaining tokens.

### 8.3 Bid submission (from simulateCcaBids.js)

Location: `/home/r/Coding/nullspace/evm/scripts/simulateCcaBids.js`

The script shows how bidders interact with the CCA:

```javascript
// Lines 188-189 (ERC20 currency)
await ensurePermit2Allowance(currency, permit2, bidder, auctionAddress, amount, expirationDays);
const tx = await auction.connect(bidder).submitBid(maxPrice, amount, bidderAddress, '0x');
```

Or for native ETH:

```javascript
// Lines 208-210
const tx = await auction
  .connect(bidder)
  .submitBid(maxPrice, amount, bidderAddress, '0x', { value: amount });
```

Key parameters:

- `maxPrice`: the highest price the bidder is willing to pay (in Q96 fixed-point).
- `amount`: the quantity of currency the bidder commits.
- `bidderAddress`: the recipient address for tokens if the bid wins.
- `0x`: extra data (unused in basic CCA).

### 8.4 Permit2 allowance

The CCA uses Uniswap's Permit2 contract for gasless approvals. Bidders approve the Permit2 contract once, then the Permit2 contract allows the auction to pull funds. This avoids per-bid approvals.

Lines 15-27 of `simulateCcaBids.js` show the setup:

```javascript
async function ensurePermit2Allowance(currency, permit2, owner, spender, amount, expirationDays) {
  const ownerAddress = await owner.getAddress();
  const allowance = await currency.allowance(ownerAddress, permit2.target);
  if (allowance < amount) {
    await (await currency.connect(owner).approve(permit2.target, MAX_UINT256)).wait();
  }

  const [permitAmount] = await permit2.allowance(ownerAddress, currency.target, spender);
  if (permitAmount < amount) {
    const expiration = BigInt(Math.floor(Date.now() / 1000) + expirationDays * 86400);
    await (await permit2.connect(owner).approve(currency.target, spender, MAX_UINT160, expiration)).wait();
  }
}
```

This is a two-step process: approve Permit2, then approve the auction within Permit2.

### 8.5 Finalization (from finalizeCca.js)

Location: `/home/r/Coding/nullspace/evm/scripts/finalizeCca.js`

After the auction ends, the owner calls:

```javascript
// Lines 47-48
await (await auction.checkpoint()).wait();
await (await auction.sweepCurrency()).wait();
```

`checkpoint()` computes the clearing price and marks winners.

`sweepCurrency()` transfers the raised currency to the auction owner (or liquidity launcher).

If the script is run with `RUN_MIGRATE=true`, it also migrates liquidity to a Uniswap v4 pool:

```javascript
// Lines 50-57
if (envConfig.RUN_MIGRATE) {
  const migrationBlock = deployments.blocks.migration;
  const now = await provider.getBlockNumber();
  if (now < migrationBlock && (network.name === 'anvil' || network.name === 'hardhat')) {
    await mineTo(migrationBlock);
  }
  await (await lbp.migrate()).wait();
}
```

This seeds the Uniswap v4 pool with the liquidity allocation tokens and the raised currency, creating the initial trading pair.

### 8.6 Recovery pool funding (from finalizeCca.js)

If the script is run with `FUND_RECOVERY=true`, it allocates a portion of the raised currency to the recovery pool:

```javascript
// Lines 59-76
if (envConfig.FUND_RECOVERY) {
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
```

This ensures the recovery pool is seeded from the auction proceeds.

---

## 9) Token allocation and minting strategy

The EVM contracts are part of a larger tokenomics plan. The total supply is divided into:

- Auction allocation (sold in CCA)
- Liquidity allocation (paired with auction proceeds in Uniswap)
- Airdrop allocation (distributed via BogoDistributor)
- Team allocation (vested)
- Treasury allocation (for future use)

From `evm/src/config/phase2.js`:

```javascript
const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n; // 1 billion tokens
const AUCTION_ALLOCATION = ...;
const LIQUIDITY_ALLOCATION = ...;
const BONUS_ALLOCATION = ...; // airdrop
const TEAM_ALLOCATION = ...;
const TREASURY_ALLOCATION = ...;
```

The deployment flow is:

1) Deploy RNGToken with cap = TOTAL_SUPPLY.
2) Mint AUCTION_ALLOCATION + LIQUIDITY_ALLOCATION to the CCA factory.
3) Mint BONUS_ALLOCATION to BogoDistributor.
4) Mint TEAM_ALLOCATION to team vesting contract (not in this lesson).
5) Mint TREASURY_ALLOCATION to treasury multi-sig.
6) Verify totalSupply() == TOTAL_SUPPLY.
7) Transfer RNGToken ownership to governance.

This ensures all tokens are accounted for at launch.

---

## 10) Security boundaries and ownership patterns

### 10.1 Owner powers by contract

| Contract | Owner can |
|----------|-----------|
| RNGToken | Mint tokens (up to cap) |
| BogoDistributor | Set Merkle root, seed tokens |
| FeeDistributor | Set Merkle root, seed tokens, pause, sweep |
| RecoveryPool | Fund, repay, sweep |
| BridgeLockbox | Withdraw (unlock tokens) |

### 10.2 Trust assumptions

All contracts trust the owner to act honestly. This is acceptable for initial launch but should be mitigated for mainnet:

- **RNGToken owner**: should be a multi-sig or governance contract after initial minting.
- **Distributor owners**: should be a backend service with limited keys, or governance.
- **RecoveryPool owner**: should be a multi-sig with documented procedures for repayment.
- **BridgeLockbox owner**: should be a relayer service, ideally with multi-party computation or threshold signatures.

### 10.3 No emergency stops

None of these contracts have emergency pause mechanisms (except FeeDistributor). This is by design: simplicity over flexibility. If a contract is compromised, the mitigation is to stop using it and deploy a new one.

The tradeoff is clear: fewer vectors for owner abuse, but less ability to react to exploits.

### 10.4 Event-driven auditing

All owner actions emit events. Off-chain monitors should watch these events and alert if:

- RNGToken mints exceed expected allocation.
- BogoDistributor or FeeDistributor Merkle root changes unexpectedly.
- RecoveryPool repays funds to unexpected addresses.
- BridgeLockbox withdraws without corresponding Solana burns.

The events are the audit trail. The contracts themselves do not enforce business logic beyond basic validations.

---

## 11) Gas optimization and deployment costs

### 11.1 Why no proxies?

Proxies add complexity and gas overhead. For these contracts, the state is simple enough that redeployment is cheaper than proxy maintenance. If a contract needs to change, deploy a new version and migrate users.

### 11.2 Immutable variables

All contracts use `immutable` for constructor parameters that never change (e.g., `rng`, `currency`, `cap`). This saves gas by embedding the values in bytecode instead of storage.

### 11.3 SafeERC20 overhead

SafeERC20 adds a small gas cost per token transfer (checking return values and catching reverts). This is worth it for compatibility with non-standard tokens like USDT.

### 11.4 Merkle proof gas costs

Verifying a Merkle proof costs about 1,000 gas per proof element. For a tree of 100k users, the proof depth is about 17, so 17k gas per verification. This is much cheaper than storing 100k addresses on-chain (which would cost millions of gas).

---

## 12) Integration with off-chain systems

### 12.1 Merkle tree generation

The owner must generate Merkle trees off-chain. Tools like `merkletreejs` (JavaScript) or `rs-merkle` (Rust) are commonly used. The tree leaves are hashed with keccak256 and encoded as `abi.encodePacked(address, uint256)`.

The owner publishes the root on-chain and the full tree (or per-user proofs) off-chain (IPFS, S3, etc.). Users fetch their proofs from the off-chain source and submit them to the contract.

### 12.2 Relayer for BridgeLockbox

The bridge requires an off-chain relayer that:

1) Watches EVM `Deposited` events and mints on Solana.
2) Watches Solana burn events and calls `withdraw` on EVM.

This relayer should be highly available and monitor both chains continuously. If it goes down, the bridge is frozen until it recovers.

### 12.3 Recovery pool repayment process

When a user needs recovery (e.g., lost bet due to a bug), the process is:

1) User reports issue to support.
2) Support investigates and confirms the issue.
3) Support generates a repayment transaction (amount + recipient).
4) Owner (multi-sig) approves and submits `recoveryPool.repay(user, amount)`.
5) User receives funds.

This is manual and trust-based. Automating it would require on-chain logic to detect edge cases, which is complex and risky.

---

## 13) Testing and deployment checklist

### 13.1 Pre-deployment

- [ ] Verify cap and total supply match tokenomics document.
- [ ] Verify owner addresses are correct (preferably multi-sig).
- [ ] Verify currency token address (USDT/USDC) for distributors and pool.
- [ ] Verify RNG token address for distributors and bridge.
- [ ] Run Hardhat tests: `npx hardhat test`.
- [ ] Run Foundry fuzz tests: `forge test`.

### 13.2 Post-deployment

- [ ] Verify all contracts on block explorer (Etherscan, etc.).
- [ ] Mint initial allocations to contracts.
- [ ] Verify totalSupply() matches expected.
- [ ] Transfer RNGToken ownership to multi-sig.
- [ ] Set Merkle roots for distributors.
- [ ] Seed distributors and recovery pool with tokens/currency.
- [ ] Test a small claim on BogoDistributor.
- [ ] Test a small deposit/withdraw on BridgeLockbox.
- [ ] Monitor events for first 24 hours.

### 13.3 Testnet rehearsal

Before mainnet, run a full rehearsal on testnet (Goerli, Sepolia, etc.):

1) Deploy all contracts.
2) Simulate a small CCA auction with test bidders.
3) Finalize auction and migrate liquidity.
4) Fund recovery pool.
5) Generate a test Merkle tree for BogoDistributor.
6) Have test users claim.
7) Test bridge deposit and relayer mint on Solana testnet.
8) Test Solana burn and bridge withdraw back to EVM.

Document any issues and fix before mainnet.

---

## 14) Feynman recap

There are five main contracts:

1) RNGToken: the token itself, with a hard cap and owner minting.
2) BogoDistributor: airdrops via Merkle proofs, one-time claims.
3) FeeDistributor: recurring fee sharing via Merkle proofs, with epochs and pause.
4) RecoveryPool: a safety fund for repaying users in edge cases.
5) BridgeLockbox: locks tokens on EVM so they can be released on Solana.

Plus a CCA auction (via Uniswap v4 factory) for initial sale and price discovery.

All contracts are owner-controlled but event-logged for transparency. They are simple by design: no upgrades, no complex governance, just explicit owner actions. The owner should be a multi-sig or governance contract for mainnet.

The contracts work together: the auction raises currency, some goes to the recovery pool, tokens are distributed via Merkle trees, and the bridge lets tokens move cross-chain. Everything is auditable via events and immutable code.

One operational implication: the owner keys are critical. If they are compromised, attackers can mint tokens (up to cap), sweep distributor funds, or unlock bridge tokens. Use hardware wallets and multi-sig for all owner addresses.

A helpful mental test is to imagine an attacker with owner keys. What can they do? They cannot exceed the token cap, they cannot change contract logic, but they can misallocate funds or unlock tokens. That is why ownership should be transferred to governance as soon as possible.

---

## 15) Exercises

1) Why does RNGToken use a hard cap instead of unlimited owner minting? What attack does this prevent?
2) Explain why Merkle proofs are more gas-efficient than storing all eligible addresses on-chain. At what user count does the Merkle approach become better?
3) What is the difference between `RecoveryPool.repay()` and `RecoveryPool.sweep()`? Why have both?
4) In BridgeLockbox, why is `withdraw` owner-only but `deposit` is open to anyone?
5) Draw the flow diagram for a user bridging tokens from EVM to Solana and back. Where are the trust assumptions?

---

## Next lesson

E32 - Solana program architecture: `feynman/lessons/E32-solana-programs.md`
