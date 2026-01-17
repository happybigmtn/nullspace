import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { NonceManager } from '../../src/api/nonceManager.js';
import { WasmWrapper } from '../../src/api/wasm.js';
import { installLocalStorageMock } from './helpers/storage.js';
import { loadWasmBindings } from './helpers/wasm.js';

installLocalStorageMock();

// Mock client
class MockClient {
  constructor() {
    this.transactions = [];
    this.accountNonce = 0;
    this.autoIncrementNonce = true; // Simulate real chain behavior by default
  }

  async submitTransaction(txData) {
    this.transactions.push(txData);
    // Simulate chain behavior: nonce increments after successful submission
    if (this.autoIncrementNonce) {
      this.accountNonce++;
    }
    return { status: 'accepted' };
  }

  async getAccount(publicKeyBytes) {
    return {
      nonce: this.accountNonce,
      balance: 0
    };
  }

  setAccountNonce(nonce) {
    this.accountNonce = nonce;
  }

  // Disable auto-increment for tests that need manual nonce control
  disableAutoIncrement() {
    this.autoIncrementNonce = false;
  }
}

// Load WASM module
let wasmWrapper;
await loadWasmBindings();

describe('NonceManager Tests', () => {
  let nonceManager;
  let mockClient;
  let keypair;
  
  beforeEach(async () => {
    // Clear localStorage before each test
    localStorage.clear();
    
    // Create a new WasmWrapper instance with test identity
    wasmWrapper = new WasmWrapper('test-identity');
    await wasmWrapper.init();
    
    // Create a keypair
    wasmWrapper.createKeypair();
    keypair = {
      publicKey: wasmWrapper.getPublicKeyBytes(),
      publicKeyHex: wasmWrapper.getPublicKeyHex()
    };
    
    // Reset mock client state
    mockClient = new MockClient();
  });
  
  test('Initialize and basic nonce management', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);
    
    const account = await mockClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);
    
    // Initial nonce should be 0
    assert.equal(nonceManager.getCurrentNonce(), 0);
    
    // Get next nonce
    assert.equal(nonceManager.getNextNonce(), 0);
    
    // Increment nonce
    nonceManager.incrementNonce();
    assert.equal(nonceManager.getCurrentNonce(), 1);
    
    // Cleanup
    nonceManager.destroy();
  });
  
  test('Transaction storage and retrieval', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);
    
    const account = await mockClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);
    
    // Create and store an actual transaction
    const txData = wasmWrapper.createCasinoDepositTransaction(0, 1);
    nonceManager.storeTransaction(0, txData);
    
    // Get pending transactions
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].nonce, 0);
    assert(pending[0].txData.length > 64, 'Transaction should be larger than just signature');
    
    // Cleanup
    nonceManager.destroy();
  });
  
  test('Sync with account state', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);
    
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, null);
    
    // Set server nonce higher than local
    mockClient.setAccountNonce(5);
    
    // Sync with account state - pass account data directly
    const account = await mockClient.getAccount(keypair.publicKey);
    nonceManager.syncWithAccountState(account);
    
    // Local nonce should be updated
    assert.equal(nonceManager.getCurrentNonce(), 5);
    
    // Cleanup
    nonceManager.destroy();
  });
  
  test('Submit transaction with nonce management', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);
    
    const account = await mockClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);
    
    // Submit a deposit transaction
    const result = await nonceManager.submitCasinoDeposit(1);
    assert.equal(result.status, 'accepted');
    
    // Nonce should be incremented
    assert.equal(nonceManager.getCurrentNonce(), 1);
    
    // Transaction should be stored
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].nonce, 0);
    
    // Cleanup
    nonceManager.destroy();
  });
  
  test('Cleanup confirmed transactions', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);
    
    const account = await mockClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);
    
    // Store multiple actual transactions
    nonceManager.storeTransaction(0, wasmWrapper.createCasinoDepositTransaction(0, 1));
    nonceManager.storeTransaction(1, wasmWrapper.createCreateVaultTransaction(1));
    nonceManager.storeTransaction(2, wasmWrapper.createCasinoDepositTransaction(2, 1));
    
    // Cleanup transactions with nonce <= 1
    nonceManager.cleanupConfirmedTransactions(1);
    
    // Only transaction with nonce 2 should remain
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].nonce, 2);
    
    // Cleanup
    nonceManager.destroy();
  });
  
  test('Server/client nonce misalignment - server ahead', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);

    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, null);

    // Submit several transactions (mock auto-increments nonce to simulate chain)
    await nonceManager.submitCasinoDeposit(1);
    await nonceManager.submitCreateVault();
    await nonceManager.submitCasinoDeposit(1);

    // Local nonce should be 3 (with pre-submit sync, nonces stay aligned with server)
    assert.equal(nonceManager.getCurrentNonce(), 3);

    // Simulate server being ahead (e.g., background tx processing confirmed more)
    mockClient.setAccountNonce(5);

    // Sync with account state - pass account data directly
    const account = await mockClient.getAccount(keypair.publicKey);
    nonceManager.syncWithAccountState(account);

    // Local nonce should be updated to server nonce
    assert.equal(nonceManager.getCurrentNonce(), 5);

    // Pending transactions with nonces < 5 should be cleaned up (server nonce is "next expected")
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 0);

    // Cleanup
    nonceManager.destroy();
  });
  
  test('Server/client nonce misalignment - client ahead', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);

    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, null);

    // Submit several transactions (mock auto-increments to simulate chain)
    await nonceManager.submitCasinoDeposit(1);
    await nonceManager.submitCreateVault();
    await nonceManager.submitCasinoDeposit(1);

    // Local nonce should be 3 (pre-submit sync keeps aligned with server)
    assert.equal(nonceManager.getCurrentNonce(), 3);

    // Simulate chain reset: server nonce goes back to 1
    mockClient.setAccountNonce(1);

    // Sync with account state - pass account data directly
    const account = await mockClient.getAccount(keypair.publicKey);
    nonceManager.syncWithAccountState(account);

    // Client is ahead of server => reset to server nonce and clear stale pending
    assert.equal(nonceManager.getCurrentNonce(), 1);
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 0);

    // Cleanup
    nonceManager.destroy();
  });
  
  test('New account creation scenario', async () => {
    // Create a new mock client that returns null for non-existent accounts
    const newAccountClient = new MockClient();
    newAccountClient.getAccount = async (publicKeyBytes) => {
      // Return null for non-existent account
      return null;
    };
    
    nonceManager = new NonceManager(newAccountClient, wasmWrapper);
    
    // Set some non-zero nonce to simulate previous state
    nonceManager.setNonce(5);
    
    // Store some pending transactions
    nonceManager.storeTransaction(3, wasmWrapper.createCasinoDepositTransaction(3, 1));
    nonceManager.storeTransaction(4, wasmWrapper.createCreateVaultTransaction(4));
    
    // Initialize
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, null);
    
    // If account doesn't exist, we reset local state to avoid nonce drift.
    assert.equal(nonceManager.getCurrentNonce(), 0);
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 0);
    
    // Cleanup
    nonceManager.destroy();
  });
  
  test('Transaction resubmission after network issues', async () => {
    // Create a mock client that simulates network issues
    let submitAttempts = 0;
    const flakeyClient = new MockClient();
    flakeyClient.submitTransaction = async (txData) => {
      submitAttempts++;
      if (submitAttempts < 2) {
        throw new Error('Network error');
      }
      return { status: 'accepted' };
    };
    
    nonceManager = new NonceManager(flakeyClient, wasmWrapper);
    
    const account = await flakeyClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);
    
    // Try to submit a transaction (should fail first time)
    try {
      await nonceManager.submitCasinoDeposit(1);
    } catch (error) {
      assert(error.message.includes('Network error'));
    }
    
    // Nonce should not be incremented after failure
    assert.equal(nonceManager.getCurrentNonce(), 0);
    
    // Transaction should be stored after failure (for retry)
    let pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 1);
    
    // Now try again (should succeed)
    const result = await nonceManager.submitCasinoDeposit(1);
    assert.equal(result.status, 'accepted');
    
    // Nonce should be incremented after success
    assert.equal(nonceManager.getCurrentNonce(), 1);
    
    // Transaction should be stored after success
    pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 1);
    
    // Cleanup
    nonceManager.destroy();
  });
  
  test('Multiple pending transactions with gaps', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);
    
    const account = await mockClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);
    
    // Manually store transactions with gaps
    nonceManager.storeTransaction(0, wasmWrapper.createCasinoDepositTransaction(0, 1));
    nonceManager.storeTransaction(2, wasmWrapper.createCasinoDepositTransaction(2, 1));
    nonceManager.storeTransaction(5, wasmWrapper.createCasinoDepositTransaction(5, 1));
    
    // Get pending transactions should return them sorted by nonce
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 3);
    assert.equal(pending[0].nonce, 0);
    assert.equal(pending[1].nonce, 2);
    assert.equal(pending[2].nonce, 5);
    
    // Cleanup transactions with nonce <= 2
    nonceManager.cleanupConfirmedTransactions(2);
    
    // Only transaction with nonce 5 should remain
    const remaining = nonceManager.getPendingTransactions();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].nonce, 5);
    
    // Cleanup
    nonceManager.destroy();
  });
  
  test('Sequential transaction submission', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);

    const account = await mockClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);

    // Submit multiple transactions sequentially (mock auto-increments to simulate chain)
    await nonceManager.submitCasinoDeposit(1);
    await nonceManager.submitCreateVault();
    await nonceManager.submitCasinoDeposit(1);

    // Nonce should be incremented correctly
    assert.equal(nonceManager.getCurrentNonce(), 3);

    // Should have 3 pending transactions with sequential nonces
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 3);
    assert.equal(pending[0].nonce, 0);
    assert.equal(pending[1].nonce, 1);
    assert.equal(pending[2].nonce, 2);

    // Cleanup
    nonceManager.destroy();
  });
  
  test('Concurrent transaction submission', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);

    const account = await mockClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);

    // Submit multiple transactions concurrently (mock auto-increments to simulate chain)
    const promises = [
      nonceManager.submitCasinoDeposit(1),
      nonceManager.submitCreateVault(),
      nonceManager.submitCasinoDeposit(1),
      nonceManager.submitCreateVault(),
      nonceManager.submitCasinoDeposit(1)
    ];

    const results = await Promise.all(promises);

    // All should succeed
    results.forEach(result => {
      assert.equal(result.status, 'accepted');
    });

    // Nonce should be incremented correctly
    assert.equal(nonceManager.getCurrentNonce(), 5);

    // Should have 5 pending transactions with sequential nonces
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.equal(pending[i].nonce, i, `Transaction ${i} should have nonce ${i}`);
    }

    // Cleanup
    nonceManager.destroy();
  });
  
  test('Concurrent sync operations', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);
    
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, null);
    
    // Set server nonce
    mockClient.setAccountNonce(10);
    
    // Track sync calls (syncWithAccountState doesn't fetch, just processes provided data)
    let syncCalls = 0;
    const originalSync = nonceManager.syncWithAccountState;
    nonceManager.syncWithAccountState = function(account) {
      syncCalls++;
      return originalSync.call(this, account);
    };
    
    // Get account data once
    const account = await mockClient.getAccount(keypair.publicKey);
    
    // Trigger multiple concurrent syncs with the same account data
    const syncPromises = [
      Promise.resolve(nonceManager.syncWithAccountState(account)),
      Promise.resolve(nonceManager.syncWithAccountState(account)),
      Promise.resolve(nonceManager.syncWithAccountState(account)),
      Promise.resolve(nonceManager.syncWithAccountState(account))
    ];
    
    await Promise.all(syncPromises);
    
    // All sync calls should execute since they're just processing data
    assert.equal(syncCalls, 4, 'All sync calls should execute');
    assert.equal(nonceManager.getCurrentNonce(), 10);
    
    // Cleanup
    nonceManager.destroy();
  });
  
  test('Concurrent resubmit operations', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);
    
    const account = await mockClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);
    
    // Store a pending transaction
    nonceManager.setNonce(1);
    nonceManager.storeTransaction(0, wasmWrapper.createCasinoDepositTransaction(0, 1));
    
    // Track resubmit calls
    let submitCalls = 0;
    const originalSubmit = mockClient.submitTransaction;
    mockClient.submitTransaction = async (txData) => {
      submitCalls++;
      // Simulate slow network
      await new Promise(resolve => setTimeout(resolve, 50));
      return originalSubmit.call(mockClient, txData);
    };
    
    // Trigger multiple concurrent resubmits
    const resubmitPromises = [
      nonceManager.resubmitPendingTransactions(),
      nonceManager.resubmitPendingTransactions(),
      nonceManager.resubmitPendingTransactions()
    ];
    
    await Promise.all(resubmitPromises);
    
    // Due to resubmit protection, only one actual resubmit should occur
    assert.equal(submitCalls, 1, 'Only one resubmit should execute despite concurrent calls');
    
    // Restore original method
    mockClient.submitTransaction = originalSubmit;
    
    // Cleanup
    nonceManager.destroy();
  });
  
  test('Resubmission with nonce error does not auto-sync', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);
    
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, null);
    
    // Submit a transaction
    await nonceManager.submitCasinoDeposit(1);
    assert.equal(nonceManager.getCurrentNonce(), 1);
    
    // Store the transaction with nonce 0 (simulating an unconfirmed transaction)
    // The submitGenerate already stored it with nonce 0
    
    // Set server nonce to simulate confirmed transaction
    mockClient.setAccountNonce(1);
    
    // Modify client to throw error on resubmission
    const originalSubmit = mockClient.submitTransaction;
    mockClient.submitTransaction = async (txData) => {
      throw new Error('Invalid nonce: expected 1, got 0');
    };
    
    // Try to resubmit pending transactions (should log error but continue)
    await nonceManager.resubmitPendingTransactions();
    
    // There is one pending transaction with nonce 0
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 1, 'Should have 1 pending transaction');
    assert.equal(pending[0].nonce, 0, 'Pending transaction should have nonce 0');
    
    // Restore original submit function
    mockClient.submitTransaction = originalSubmit;
    
    // Cleanup
    nonceManager.destroy();
  });
  
  test('Account deletion keeps nonce state', async () => {
    // Create a mock client that simulates account deletion
    let accountExists = true;
    const deletableClient = new MockClient();
    deletableClient.getAccount = async (publicKeyBytes) => {
      if (!accountExists) {
        return null;
      }
      return {
        nonce: deletableClient.accountNonce,
        balance: 0
      };
    };

    nonceManager = new NonceManager(deletableClient, wasmWrapper);

    // Initialize with an account that exists
    const initialAccount = await deletableClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, initialAccount);

    // Submit some transactions (mock auto-increments to simulate chain)
    await nonceManager.submitCasinoDeposit(1);
    await nonceManager.submitCreateVault();

    // Local nonce should be 2 (pre-submit sync keeps it aligned)
    assert.equal(nonceManager.getCurrentNonce(), 2);

    // Simulate account deletion (404)
    accountExists = false;

    // Sync with null account (deleted)
    const deletedAccount = await deletableClient.getAccount(keypair.publicKey);
    nonceManager.syncWithAccountState(deletedAccount);

    // If account is missing, we reset local state to avoid nonce drift.
    assert.equal(nonceManager.getCurrentNonce(), 0);
    const pendingAfter = nonceManager.getPendingTransactions();
    assert.equal(pendingAfter.length, 0, 'Pending transactions should be cleared');

    // Cleanup
    nonceManager.destroy();
  });
  
  test('Transaction retry count tracking without limit', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);
    
    const account = await mockClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);
    nonceManager.setNonce(1);
    
    // Store a transaction with high retry count
    const txData = wasmWrapper.createCasinoDepositTransaction(0, 1);
    const key = `${nonceManager.TX_STORAGE_PREFIX}0`;  // No publicKeyHex in the key
    const txRecord = {
      nonce: 0,
      txData: Array.from(txData),
      timestamp: Date.now(),
      retryCount: 100 // High retry count
    };
    localStorage.setItem(key, JSON.stringify(txRecord));
    
    // Resubmit should increment retry count but not remove transaction
    await nonceManager.resubmitPendingTransactions();
    
    // Transaction should still exist with incremented retry count
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 1, 'Transaction should still exist (no max retry limit)');
    assert.equal(pending[0].retryCount, 101, 'Retry count should be incremented');
    
    // Cleanup
    nonceManager.destroy();
  });
  
  test('Corrupted localStorage data handling', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);
    
    const account = await mockClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);
    
    // Store valid transaction
    await nonceManager.submitCasinoDeposit(1);
    
    // Add corrupted data
    const corruptKey = `${nonceManager.TX_STORAGE_PREFIX}999`;
    localStorage.setItem(corruptKey, 'invalid json data');
    
    // Getting pending transactions should handle corrupted data gracefully
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 1, 'Should only return valid transaction');
    assert.equal(pending[0].nonce, 0);
    
    // Corrupted entry should be removed
    assert.equal(localStorage.getItem(corruptKey), null, 'Corrupted entry should be removed');
    
    // Cleanup
    nonceManager.destroy();
  });
  
  
  test('AC-4.2: Pre-submit nonce sync corrects drift', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);

    const account = await mockClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);

    // Manually set local nonce to 5 (simulating drift)
    nonceManager.setNonce(5);
    assert.equal(nonceManager.getCurrentNonce(), 5);

    // Server has nonce 2 (e.g., after chain reset)
    mockClient.setAccountNonce(2);

    // Submit a transaction - should sync nonce before submitting
    const result = await nonceManager.submitCasinoDeposit(1);
    assert.equal(result.status, 'accepted');

    // The transaction should have been submitted with nonce 2 (server nonce)
    // and then incremented to 3
    assert.equal(nonceManager.getCurrentNonce(), 3);

    // Verify the stored transaction has the correct nonce
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].nonce, 2, 'Transaction should have server nonce 2');

    // Cleanup
    nonceManager.destroy();
  });

  test('AC-4.2: Pre-submit nonce sync handles fetch failure gracefully', async () => {
    // Create a mock client that fails on getAccount
    const flakeyClient = new MockClient();
    let fetchCount = 0;
    flakeyClient.getAccount = async (publicKeyBytes) => {
      fetchCount++;
      if (fetchCount === 1) {
        // First call during init succeeds
        return { nonce: 0, balance: 0 };
      }
      // Subsequent calls fail (simulating network issues)
      throw new Error('Network error');
    };

    nonceManager = new NonceManager(flakeyClient, wasmWrapper);

    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, { nonce: 0, balance: 0 });
    assert.equal(nonceManager.getCurrentNonce(), 0);

    // Submit a transaction - sync will fail but transaction should still proceed
    const result = await nonceManager.submitCasinoDeposit(1);
    assert.equal(result.status, 'accepted');

    // Nonce should still be incremented (using local nonce fallback)
    assert.equal(nonceManager.getCurrentNonce(), 1);

    // Cleanup
    nonceManager.destroy();
  });

  test('AC-4.2: Pre-submit nonce sync on concurrent transactions', async () => {
    nonceManager = new NonceManager(mockClient, wasmWrapper);

    const account = await mockClient.getAccount(keypair.publicKey);
    await nonceManager.init(keypair.publicKeyHex, keypair.publicKey, account);

    // Server starts at nonce 0 (mock auto-increments after each submit)
    mockClient.setAccountNonce(0);

    // Track how many times getAccount is called
    let getAccountCalls = 0;
    const originalGetAccount = mockClient.getAccount.bind(mockClient);
    mockClient.getAccount = async (publicKeyBytes) => {
      getAccountCalls++;
      return originalGetAccount(publicKeyBytes);
    };

    // Submit multiple transactions concurrently
    // Due to transaction queue, they're processed sequentially
    const promises = [
      nonceManager.submitCasinoDeposit(1),
      nonceManager.submitCasinoDeposit(2),
      nonceManager.submitCasinoDeposit(3)
    ];

    const results = await Promise.all(promises);

    // All should succeed
    results.forEach(result => assert.equal(result.status, 'accepted'));

    // Each transaction should trigger a pre-submit sync
    assert.equal(getAccountCalls, 3, 'Each transaction should sync nonce from server');

    // Final nonce should be 3 (0, 1, 2 used, then incremented to 3)
    assert.equal(nonceManager.getCurrentNonce(), 3);

    // Should have 3 pending transactions with sequential nonces
    const pending = nonceManager.getPendingTransactions();
    assert.equal(pending.length, 3);
    assert.equal(pending[0].nonce, 0);
    assert.equal(pending[1].nonce, 1);
    assert.equal(pending[2].nonce, 2);

    // Cleanup
    nonceManager.destroy();
  });

  afterEach(() => {
    // Cleanup after each test
    if (nonceManager) {
      nonceManager.destroy();
    }
    localStorage.clear();
  });
});
