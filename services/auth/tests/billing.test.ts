import test from 'node:test';
import assert from 'node:assert/strict';

// US-251: Test billing configuration and optional billing flag
// These tests verify the billing enable/disable logic

const parseStripeTierMap = (raw: string): Map<string, string> => {
  const map = new Map<string, string>();
  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [tier, priceId] = entry.split(':').map((value) => value.trim());
      if (tier && priceId) {
        map.set(priceId, tier);
      }
    });
  return map;
};

const isBillingEnabled = (envValue: string | undefined): boolean => {
  return !['0', 'false', 'no'].includes(
    String(envValue ?? '').toLowerCase(),
  );
};

const validateBillingConfig = (
  billingEnabled: boolean,
  stripeTierMap: Map<string, string>,
): { valid: boolean; error?: string } => {
  if (billingEnabled && stripeTierMap.size === 0) {
    return { valid: false, error: 'STRIPE_PRICE_TIERS must be set when billing is enabled' };
  }
  return { valid: true };
};

test('isBillingEnabled defaults to true when env is undefined', () => {
  assert.equal(isBillingEnabled(undefined), true);
});

test('isBillingEnabled defaults to true when env is empty string', () => {
  assert.equal(isBillingEnabled(''), true);
});

test('isBillingEnabled returns true for "1"', () => {
  assert.equal(isBillingEnabled('1'), true);
});

test('isBillingEnabled returns true for "true"', () => {
  assert.equal(isBillingEnabled('true'), true);
});

test('isBillingEnabled returns true for "TRUE"', () => {
  assert.equal(isBillingEnabled('TRUE'), true);
});

test('isBillingEnabled returns true for "yes"', () => {
  assert.equal(isBillingEnabled('yes'), true);
});

test('isBillingEnabled returns false for "0"', () => {
  assert.equal(isBillingEnabled('0'), false);
});

test('isBillingEnabled returns false for "false"', () => {
  assert.equal(isBillingEnabled('false'), false);
});

test('isBillingEnabled returns false for "FALSE"', () => {
  assert.equal(isBillingEnabled('FALSE'), false);
});

test('isBillingEnabled returns false for "no"', () => {
  assert.equal(isBillingEnabled('no'), false);
});

test('isBillingEnabled returns false for "NO"', () => {
  assert.equal(isBillingEnabled('NO'), false);
});

test('parseStripeTierMap parses single tier correctly', () => {
  const map = parseStripeTierMap('member:price_abc123');
  assert.equal(map.size, 1);
  assert.equal(map.get('price_abc123'), 'member');
});

test('parseStripeTierMap parses multiple tiers correctly', () => {
  const map = parseStripeTierMap('member:price_abc,premium:price_xyz');
  assert.equal(map.size, 2);
  assert.equal(map.get('price_abc'), 'member');
  assert.equal(map.get('price_xyz'), 'premium');
});

test('parseStripeTierMap handles whitespace', () => {
  const map = parseStripeTierMap(' member : price_abc , premium : price_xyz ');
  assert.equal(map.size, 2);
  assert.equal(map.get('price_abc'), 'member');
  assert.equal(map.get('price_xyz'), 'premium');
});

test('parseStripeTierMap handles empty string', () => {
  const map = parseStripeTierMap('');
  assert.equal(map.size, 0);
});

test('parseStripeTierMap ignores malformed entries', () => {
  const map = parseStripeTierMap('member:price_abc,invalid,premium:price_xyz');
  assert.equal(map.size, 2);
  assert.equal(map.get('price_abc'), 'member');
  assert.equal(map.get('price_xyz'), 'premium');
});

test('validateBillingConfig accepts enabled billing with tiers', () => {
  const tiers = parseStripeTierMap('member:price_abc');
  const result = validateBillingConfig(true, tiers);
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test('validateBillingConfig rejects enabled billing without tiers', () => {
  const tiers = parseStripeTierMap('');
  const result = validateBillingConfig(true, tiers);
  assert.equal(result.valid, false);
  assert.equal(result.error, 'STRIPE_PRICE_TIERS must be set when billing is enabled');
});

test('validateBillingConfig accepts disabled billing without tiers', () => {
  const tiers = parseStripeTierMap('');
  const result = validateBillingConfig(false, tiers);
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test('validateBillingConfig accepts disabled billing with tiers', () => {
  const tiers = parseStripeTierMap('member:price_abc');
  const result = validateBillingConfig(false, tiers);
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});
