// Wrapper for WASM functionality
import { setHealthStage } from '../services/startupHealth';

let wasmModule = null;
const GLOBAL_WASM_BINDINGS_KEY = '__NULLSPACE_WASM_BINDINGS__';

export async function initWasm() {
  if (!wasmModule) {
    console.log('[WASM] Checking for pre-initialized bindings...');
    const globalBindings = globalThis?.[GLOBAL_WASM_BINDINGS_KEY];
    if (globalBindings) {
      console.log('[WASM] Using pre-initialized global bindings');
      wasmModule = globalBindings;
      setHealthStage('wasm_loaded', 'Using pre-initialized bindings');
      return wasmModule;
    }
    try {
      setHealthStage('wasm_loading');
      console.log('[WASM] Loading module from nullspace_wasm.js...');
      wasmModule = await import('../../wasm/pkg/nullspace_wasm.js');
      console.log('[WASM] Module JS loaded, initializing WASM binary...');
      await wasmModule.default();
      console.log('[WASM] WASM binary initialized successfully');
      setHealthStage('wasm_loaded');
    } catch (error) {
      console.error('[WASM] Initialization failed:', error);
      setHealthStage('wasm_error', error?.message ?? String(error));
      // Re-throw to let callers handle the error
      throw error;
    }
  } else {
    console.log('[WASM] Using cached module');
  }
  return wasmModule;
}

export class WasmWrapper {
  constructor(identityHex) {
    this.wasm = null;
    this.keypair = null;
    this.identityHex = identityHex;
    this.identityBytes = null;
  }

  isProd() {
    return typeof import.meta !== 'undefined' && import.meta.env?.PROD === true;
  }

  async init() {
    console.log('[WASM] WasmWrapper.init() starting...');
    this.wasm = await initWasm();
    // Convert identity hex to bytes if provided
    if (this.identityHex) {
      this.identityBytes = this.hexToBytes(this.identityHex);
      console.log('[WASM] WasmWrapper identity configured');
    }
    console.log('[WASM] WasmWrapper.init() complete');
    return this;
  }

  // Create a new keypair
  createKeypair(privateKeyBytes) {
    if (privateKeyBytes !== undefined) {
      // Only support 32-byte private keys
      if (!(privateKeyBytes instanceof Uint8Array) || privateKeyBytes.length !== 32) {
        throw new Error('Private key must be a Uint8Array of exactly 32 bytes');
      }
      this.keypair = this.wasm.Signer.from_bytes(privateKeyBytes);
    } else {
      if (this.isProd()) {
        throw new Error('legacy-keys-disabled');
      }
      // Let WASM generate a new key using the browser's crypto API
      this.keypair = new this.wasm.Signer();
    }
    return this.keypair;
  }

  clearKeypair() {
    if (this.keypair && typeof this.keypair.free === 'function') {
      this.keypair.free();
    }
    this.keypair = null;
  }

  // Get public key as hex string
  getPublicKeyHex() {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    return this.keypair.public_key_hex;
  }

  // Get public key as bytes
  getPublicKeyBytes() {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    return this.keypair.public_key;
  }

  // Get private key as hex string
  getPrivateKeyHex() {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    return this.keypair.private_key_hex;
  }

  // Encode keys
  encodeAccountKey(publicKeyBytes) {
    return this.wasm.encode_account_key(publicKeyBytes);
  }

  // Encode casino player key
  encodeCasinoPlayerKey(publicKeyBytes) {
    return this.wasm.encode_casino_player_key(publicKeyBytes);
  }

  // Encode casino session key
  encodeCasinoSessionKey(sessionId) {
    return this.wasm.encode_casino_session_key(BigInt(sessionId));
  }

  // Encode casino leaderboard key
  encodeCasinoLeaderboardKey() {
    return this.wasm.encode_casino_leaderboard_key();
  }

  // Encode casino tournament key
  encodeCasinoTournamentKey(tournamentId) {
    return this.wasm.encode_casino_tournament_key(BigInt(tournamentId));
  }

  // Encode vault key
  encodeVaultKey(publicKeyBytes) {
    return this.wasm.encode_vault_key(publicKeyBytes);
  }

  // Encode AMM pool key
  encodeAmmPoolKey() {
    return this.wasm.encode_amm_pool_key();
  }

  // Encode LP balance key
  encodeLpBalanceKey(publicKeyBytes) {
    return this.wasm.encode_lp_balance_key(publicKeyBytes);
  }

  // Encode house key
  encodeHouseKey() {
    return this.wasm.encode_house_key();
  }

  // Encode policy key
  encodePolicyKey() {
    return this.wasm.encode_policy_key();
  }

  // Encode treasury key
  encodeTreasuryKey() {
    return this.wasm.encode_treasury_key();
  }

  // Encode treasury vesting key
  encodeTreasuryVestingKey() {
    return this.wasm.encode_treasury_vesting_key();
  }

  // Encode vault registry key
  encodeVaultRegistryKey() {
    return this.wasm.encode_vault_registry_key();
  }

  // Encode player registry key
  encodePlayerRegistryKey() {
    return this.wasm.encode_player_registry_key();
  }

  // Encode savings pool key
  encodeSavingsPoolKey() {
    return this.wasm.encode_savings_pool_key();
  }

  // Encode savings balance key
  encodeSavingsBalanceKey(publicKeyBytes) {
    return this.wasm.encode_savings_balance_key(publicKeyBytes);
  }

  // Encode staker key
  encodeStakerKey(publicKeyBytes) {
    return this.wasm.encode_staker_key(publicKeyBytes);
  }

  // Encode bridge state key
  encodeBridgeStateKey() {
    return this.wasm.encode_bridge_state_key();
  }

  // Encode bridge withdrawal key
  encodeBridgeWithdrawalKey(withdrawalId) {
    return this.wasm.encode_bridge_withdrawal_key(BigInt(withdrawalId));
  }

  // Encode oracle state key
  encodeOracleStateKey() {
    return this.wasm.encode_oracle_state_key();
  }

  // Encode UpdatesFilter for all events
  encodeUpdatesFilterAll() {
    return this.wasm.encode_updates_filter_all();
  }

  // Encode UpdatesFilter for a specific account
  encodeUpdatesFilterAccount(publicKeyBytes) {
    return this.wasm.encode_updates_filter_account(publicKeyBytes);
  }

  // Encode UpdatesFilter for a specific session
  encodeUpdatesFilterSession(sessionId) {
    return this.wasm.encode_updates_filter_session(sessionId);
  }

  // Hash a key for state queries
  hashKey(keyBytes) {
    return this.wasm.hash_key(keyBytes);
  }

  // Decode a lookup
  decodeLookup(bytes) {
    // Require identity for events verification
    if (!this.identityBytes) {
      throw new Error('No identity configured for events verification');
    }

    try {
      // Decode the Events struct - this will verify the certificate and proof
      const events = this.wasm.decode_lookup(bytes, this.identityBytes);
      return events;
    } catch (error) {
      // Log the actual error for debugging
      console.warn('Failed to decode as Lookup:', error.toString());
      throw error; // Re-throw to let caller handle it
    }
  }

  // Decode and verify seed in one operation
  decodeSeed(bytes) {
    // Require identity for seed verification
    if (!this.identityBytes) {
      throw new Error('No identity configured for seed verification');
    }

    // Decode the seed - this will throw if verification fails
    try {
      const seed = this.wasm.decode_seed(bytes, this.identityBytes);
      return seed;
    } catch (error) {
      // Re-throw with the original error message
      throw new Error(error.toString());
    }
  }

  // Convert hex to bytes
  hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  // Convert bytes to hex
  bytesToHex(bytes) {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Encode query
  encodeQuery(type, index) {
    if (type === 'latest') {
      return this.wasm.encode_query_latest();
    } else if (type === 'index' && index !== undefined) {
      // Convert to BigInt for WASM
      return this.wasm.encode_query_index(BigInt(index));
    }
    throw new Error('Invalid query type');
  }

  // Decode update (can be either Seed or Events)
  decodeUpdate(bytes) {
    // Require identity for update verification
    if (!this.identityBytes) {
      throw new Error('No identity configured for update verification');
    }

    const update = this.wasm.decode_update(bytes, this.identityBytes);
    return update;
  }

  // Wrap a transaction in a Submission enum
  wrapTransactionSubmission(transactionBytes) {
    return this.wasm.wrap_transaction_submission(transactionBytes);
  }

  // Compute explorer digest for a transaction (signature excluded)
  digestTransaction(transactionBytes) {
    return this.wasm.digest_transaction(transactionBytes);
  }

  // Wrap a summary in a Submission enum
  wrapSummarySubmission(summaryBytes) {
    return this.wasm.wrap_summary_submission(summaryBytes);
  }

  // Wrap a seed in a Submission enum
  wrapSeedSubmission(seedBytes) {
    return this.wasm.wrap_seed_submission(seedBytes);
  }

  // Get identity for a given seed
  getIdentity(seed) {
    return this.wasm.get_identity(seed);
  }

  // Encode a seed
  encodeSeed(seed, view) {
    return this.wasm.encode_seed(seed, view);
  }

  // Execute a block with transactions
  executeBlock(networkSecret, view, txBytes) {
    return this.wasm.execute_block(networkSecret, view, txBytes);
  }

  // Encode query latest
  encodeQueryLatest() {
    return this.wasm.encode_query_latest();
  }

  // Encode query index
  encodeQueryIndex(index) {
    return this.wasm.encode_query_index(index);
  }

  // Get access to Signer class
  get Signer() {
    return this.wasm.Signer;
  }

  // Get access to Transaction class
  get Transaction() {
    return this.wasm.Transaction;
  }

  // Create a casino start game transaction
  createCasinoStartGameTransaction(nonce, gameType, bet, sessionId) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.casino_start_game(
      this.keypair,
      BigInt(nonce),
      gameType,
      BigInt(bet),
      BigInt(sessionId)
    );
    return tx.encode();
  }

  // Create a casino game move transaction
  createCasinoGameMoveTransaction(nonce, sessionId, payload) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.casino_game_move(
      this.keypair,
      BigInt(nonce),
      BigInt(sessionId),
      payload
    );
    return tx.encode();
  }

  // Create a casino toggle shield transaction
  createCasinoToggleShieldTransaction(nonce) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.casino_toggle_shield(
      this.keypair,
      BigInt(nonce)
    );
    return tx.encode();
  }

  // Create a casino toggle double transaction
  createCasinoToggleDoubleTransaction(nonce) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.casino_toggle_double(
      this.keypair,
      BigInt(nonce)
    );
    return tx.encode();
  }

  // Create a casino toggle super transaction
  createCasinoToggleSuperTransaction(nonce) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.casino_toggle_super(
      this.keypair,
      BigInt(nonce)
    );
    return tx.encode();
  }

  // Create a casino register transaction
  createCasinoRegisterTransaction(nonce, name) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.casino_register(
      this.keypair,
      BigInt(nonce),
      name
    );
    return tx.encode();
  }

  // Create a casino join tournament transaction
  createCasinoJoinTournamentTransaction(nonce, tournamentId) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.casino_join_tournament(
      this.keypair,
      BigInt(nonce),
      BigInt(tournamentId)
    );
    return tx.encode();
  }

  // Admin: create a casino set tournament limit transaction
  createCasinoSetTournamentLimitTransaction(nonce, playerPublicKeyBytes, dailyLimit) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.casino_set_tournament_limit(
      this.keypair,
      BigInt(nonce),
      playerPublicKeyBytes,
      dailyLimit
    );
    return tx.encode();
  }

  // Create a casino start tournament transaction
  createCasinoStartTournamentTransaction(nonce, tournamentId, startTimeMs, endTimeMs) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.casino_start_tournament(
      this.keypair,
      BigInt(nonce),
      BigInt(tournamentId),
      BigInt(startTimeMs),
      BigInt(endTimeMs)
    );
    return tx.encode();
  }

  // Create a casino deposit transaction (dev faucet / testing)
  createCasinoDepositTransaction(nonce, amount) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.casino_deposit(
      this.keypair,
      BigInt(nonce),
      BigInt(amount)
    );
    return tx.encode();
  }

  // Create a casino end tournament transaction
  createCasinoEndTournamentTransaction(nonce, tournamentId) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.casino_end_tournament(
      this.keypair,
      BigInt(nonce),
      BigInt(tournamentId)
    );
    return tx.encode();
  }

  // Create a stake transaction
  createStakeTransaction(nonce, amount, duration) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.stake(
      this.keypair,
      BigInt(nonce),
      BigInt(amount),
      BigInt(duration)
    );
    return tx.encode();
  }

  // Create an unstake transaction
  createUnstakeTransaction(nonce) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.unstake(
      this.keypair,
      BigInt(nonce)
    );
    return tx.encode();
  }

  // Create a claim rewards transaction
  createClaimRewardsTransaction(nonce) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.claim_rewards(
      this.keypair,
      BigInt(nonce)
    );
    return tx.encode();
  }

  // Create a process epoch transaction
  createProcessEpochTransaction(nonce) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.process_epoch(
      this.keypair,
      BigInt(nonce)
    );
    return tx.encode();
  }

  // Create a create vault transaction
  createCreateVaultTransaction(nonce) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.create_vault(
      this.keypair,
      BigInt(nonce)
    );
    return tx.encode();
  }

  // Create a deposit collateral transaction
  createDepositCollateralTransaction(nonce, amount) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.deposit_collateral(
      this.keypair,
      BigInt(nonce),
      BigInt(amount)
    );
    return tx.encode();
  }

  // Create a borrow vUSDT transaction
  createBorrowUsdtTransaction(nonce, amount) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.borrow_usdt(
      this.keypair,
      BigInt(nonce),
      BigInt(amount)
    );
    return tx.encode();
  }

  // Create a repay vUSDT transaction
  createRepayUsdtTransaction(nonce, amount) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.repay_usdt(
      this.keypair,
      BigInt(nonce),
      BigInt(amount)
    );
    return tx.encode();
  }

  // Create an AMM swap transaction
  createSwapTransaction(nonce, amountIn, minAmountOut, isBuyingRng) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.swap(
      this.keypair,
      BigInt(nonce),
      BigInt(amountIn),
      BigInt(minAmountOut),
      !!isBuyingRng
    );
    return tx.encode();
  }

  // Create an add liquidity transaction
  createAddLiquidityTransaction(nonce, rngAmount, usdtAmount) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.add_liquidity(
      this.keypair,
      BigInt(nonce),
      BigInt(rngAmount),
      BigInt(usdtAmount)
    );
    return tx.encode();
  }

  // Create a remove liquidity transaction
  createRemoveLiquidityTransaction(nonce, shares) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.remove_liquidity(
      this.keypair,
      BigInt(nonce),
      BigInt(shares)
    );
    return tx.encode();
  }

  // Create a savings deposit transaction
  createDepositSavingsTransaction(nonce, amount) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.deposit_savings(
      this.keypair,
      BigInt(nonce),
      BigInt(amount)
    );
    return tx.encode();
  }

  // Create a savings withdraw transaction
  createWithdrawSavingsTransaction(nonce, amount) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.withdraw_savings(
      this.keypair,
      BigInt(nonce),
      BigInt(amount)
    );
    return tx.encode();
  }

  // Create a savings claim transaction
  createClaimSavingsRewardsTransaction(nonce) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.claim_savings_rewards(
      this.keypair,
      BigInt(nonce)
    );
    return tx.encode();
  }

  // Create a bridge withdraw transaction
  createBridgeWithdrawTransaction(nonce, amount, destinationBytes) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.bridge_withdraw(
      this.keypair,
      BigInt(nonce),
      BigInt(amount),
      destinationBytes
    );
    return tx.encode();
  }

  // Admin: create a bridge deposit transaction
  createBridgeDepositTransaction(nonce, recipientPublicKeyBytes, amount, sourceBytes) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.bridge_deposit(
      this.keypair,
      BigInt(nonce),
      recipientPublicKeyBytes,
      BigInt(amount),
      sourceBytes
    );
    return tx.encode();
  }

  // Admin: create a bridge withdrawal finalize transaction
  createFinalizeBridgeWithdrawalTransaction(nonce, withdrawalId, sourceBytes) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.finalize_bridge_withdrawal(
      this.keypair,
      BigInt(nonce),
      BigInt(withdrawalId),
      sourceBytes
    );
    return tx.encode();
  }

  // Admin: update oracle price data
  createUpdateOracleTransaction(nonce, priceVusdtNumerator, priceRngDenominator, updatedTs, sourceBytes) {
    if (!this.keypair) {
      throw new Error('Keypair not initialized');
    }
    const tx = this.wasm.Transaction.update_oracle(
      this.keypair,
      BigInt(nonce),
      BigInt(priceVusdtNumerator),
      BigInt(priceRngDenominator),
      BigInt(updatedTs),
      sourceBytes
    );
    return tx.encode();
  }
}
