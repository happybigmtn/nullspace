# Uniswap v4 CCA Testnet Runbook

This runbook documents the repeatable testnet flow for the RNG CCA (Continuous
Clearing Auction) deployment and validation. It assumes the `evm/` workspace is
installed and Hardhat is configured with the target testnet.

## Preconditions
- Testnet RPC configured in `evm/hardhat.config.js`.
- Deployer wallet funded on the target chain.
- External addresses set (or defaults used) for:
  - `VIRTUAL_LBP_FACTORY`
  - `CCA_FACTORY`
  - `PERMIT2_ADDRESS` (for bid simulation)
- Decide currency token:
  - `PHASE2_CURRENCY` set to the USDT/USDC address on testnet, or unset to
    deploy `MockUSDT`.

## Deployment Flow
1) Install deps:
   - `cd evm`
   - `npm install`

2) Deploy Phase 2 contracts + auction:
   - `npx hardhat run scripts/deployPhase2.js --network <network>`

3) Capture deployment output:
   - `evm/deployments/<network>.json` is written with auction params, addresses,
     and the derived CCA distribution contract.

## Parameter Validation Checklist
- `auctionParams.floorPrice` divides cleanly by `auctionParams.tickSpacing`.
- `startBlock < endBlock < claimBlock < migrationBlock < sweepBlock`.
- `requiredCurrencyRaised` is aligned to minimum liquidity needs.
- `tokenSplitToAuction` is correct for `AUCTION_ALLOCATION / (AUCTION + LIQUIDITY)`.
- `POOL_LP_FEE` and `POOL_TICK_SPACING` match intended Uniswap v4 pool params.

## Bid Simulation (Testnet Dry Run)
1) Generate bidder keys (optional):
   - `node scripts/generateBidders.mjs --out bidders.json`

2) Simulate bids:
   - `BIDDER_KEYS_FILE=./bidders.json npx hardhat run scripts/simulateCcaBids.js --network <network>`

3) Verify:
   - Auction receives bids and emits bid events.
   - Total raised meets `requiredCurrencyRaised` (if set).

## Finalization + Pool Seeding
1) After end block is reached, finalize:
   - `npx hardhat run scripts/finalizeCca.js --network <network>`

2) Validate:
   - Auction status transitions to finalized.
   - Liquidity launcher migrates and seeds the Uniswap v4 pool.
   - LP position recipient owns the position NFT.

## Failure / Rollback
- If minimum raise is not met:
  - Do not finalize; wait for governance decision.
  - Rerun with adjusted parameters or extended duration.
- If migration fails:
  - Pause additional bids (if possible).
  - Investigate the factory/migrator config mismatch.
  - Redeploy with corrected params and rerun a dry run.

## Artifacts to Save
- `deployments/<network>.json`
- Auction event logs (for audit/tracing).
- Bidder key list used in simulation (testnet only).
- Final pool address + LP NFT recipient address.
