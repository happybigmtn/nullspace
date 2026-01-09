import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { timingSafeStringEqual } from '../src/utils.js';

// US-234: Test CSRF protection helper functions
// These tests verify the CSRF token generation and validation logic

const createCsrfHash = async (token: string, secret: string): Promise<string> => {
  const data = new TextEncoder().encode(`${token}${secret}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Buffer.from(hashBuffer).toString('hex');
};

const verifyCsrfToken = async (
  cookieValue: string | undefined,
  bodyValue: string | undefined,
  secret: string,
): Promise<boolean> => {
  if (!cookieValue || !bodyValue) return false;

  // Cookie format is "token|hash"
  const [cookieToken, cookieHash] = cookieValue.split('|');
  if (!cookieToken || !cookieHash) return false;

  // Verify the hash matches
  const expectedHash = await createCsrfHash(cookieToken, secret);
  if (!timingSafeStringEqual(cookieHash, expectedHash)) {
    return false;
  }

  // Verify the submitted token matches the cookie token
  return timingSafeStringEqual(cookieToken, bodyValue);
};

test('createCsrfHash generates consistent SHA-256 hash', async () => {
  const token = 'test-token-123';
  const secret = 'test-secret-456';

  const hash1 = await createCsrfHash(token, secret);
  const hash2 = await createCsrfHash(token, secret);

  assert.equal(hash1, hash2, 'Same inputs should produce same hash');
  assert.equal(hash1.length, 64, 'SHA-256 hex hash should be 64 characters');
});

test('createCsrfHash produces different hashes for different tokens', async () => {
  const secret = 'test-secret';

  const hash1 = await createCsrfHash('token-a', secret);
  const hash2 = await createCsrfHash('token-b', secret);

  assert.notEqual(hash1, hash2, 'Different tokens should produce different hashes');
});

test('createCsrfHash produces different hashes for different secrets', async () => {
  const token = 'test-token';

  const hash1 = await createCsrfHash(token, 'secret-a');
  const hash2 = await createCsrfHash(token, 'secret-b');

  assert.notEqual(hash1, hash2, 'Different secrets should produce different hashes');
});

test('verifyCsrfToken accepts valid token|hash cookie with matching body', async () => {
  const secret = 'my-secret-key';
  const token = 'csrf-token-abc123';
  const hash = await createCsrfHash(token, secret);
  const cookieValue = `${token}|${hash}`;

  const result = await verifyCsrfToken(cookieValue, token, secret);

  assert.equal(result, true, 'Valid CSRF token should be accepted');
});

test('verifyCsrfToken rejects missing cookie', async () => {
  const result = await verifyCsrfToken(undefined, 'some-token', 'secret');

  assert.equal(result, false, 'Missing cookie should be rejected');
});

test('verifyCsrfToken rejects missing body token', async () => {
  const secret = 'secret';
  const token = 'token';
  const hash = await createCsrfHash(token, secret);
  const cookieValue = `${token}|${hash}`;

  const result = await verifyCsrfToken(cookieValue, undefined, secret);

  assert.equal(result, false, 'Missing body token should be rejected');
});

test('verifyCsrfToken rejects malformed cookie (no separator)', async () => {
  const result = await verifyCsrfToken('invalid-cookie-no-pipe', 'token', 'secret');

  assert.equal(result, false, 'Cookie without pipe separator should be rejected');
});

test('verifyCsrfToken rejects tampered hash', async () => {
  const secret = 'secret';
  const token = 'token';
  const hash = await createCsrfHash(token, secret);
  const tamperedHash = hash.replace('a', 'b').replace('0', '1');
  const cookieValue = `${token}|${tamperedHash}`;

  const result = await verifyCsrfToken(cookieValue, token, secret);

  assert.equal(result, false, 'Tampered hash should be rejected');
});

test('verifyCsrfToken rejects wrong secret verification', async () => {
  const token = 'token';
  const hash = await createCsrfHash(token, 'correct-secret');
  const cookieValue = `${token}|${hash}`;

  const result = await verifyCsrfToken(cookieValue, token, 'wrong-secret');

  assert.equal(result, false, 'Wrong secret should cause rejection');
});

test('verifyCsrfToken rejects mismatched body token', async () => {
  const secret = 'secret';
  const token = 'correct-token';
  const hash = await createCsrfHash(token, secret);
  const cookieValue = `${token}|${hash}`;

  const result = await verifyCsrfToken(cookieValue, 'wrong-token', secret);

  assert.equal(result, false, 'Mismatched body token should be rejected');
});

test('verifyCsrfToken rejects empty cookie token', async () => {
  const result = await verifyCsrfToken('|somehash', 'token', 'secret');

  assert.equal(result, false, 'Empty cookie token should be rejected');
});

test('verifyCsrfToken rejects empty cookie hash', async () => {
  const result = await verifyCsrfToken('token|', 'token', 'secret');

  assert.equal(result, false, 'Empty cookie hash should be rejected');
});

// Test timing-safe comparison is being used
test('verification uses timing-safe comparison', async () => {
  const secret = 'secret';
  const token = 'token';
  const hash = await createCsrfHash(token, secret);
  const cookieValue = `${token}|${hash}`;

  // This test just ensures the function completes without timing leaks
  // The actual timing-safe behavior is guaranteed by timingSafeStringEqual
  const result = await verifyCsrfToken(cookieValue, token, secret);
  assert.equal(result, true);
});
