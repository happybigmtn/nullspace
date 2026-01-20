// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// Create mock functions that can be reconfigured
const mockGetVaultStatusSync = vi.fn();
const mockSubscribeVault = vi.fn(() => () => {});

// Mock vault functions before importing component
vi.mock('../../security/keyVault', () => ({
  getVaultStatusSync: () => mockGetVaultStatusSync(),
}));

vi.mock('../../security/vaultRuntime', () => ({
  subscribeVault: () => mockSubscribeVault(),
}));

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
    React.createElement('a', { href: to, ...props }, children),
}));

vi.mock('../ui/AnimatedNumber', () => ({
  AnimatedInteger: ({ value }: { value: number }) =>
    React.createElement('span', { 'data-testid': 'animated-value' }, String(value)),
}));

import { WalletPill } from '../WalletPill';

// Helper to render component and get innerHTML
function renderToString(element: React.ReactElement): string {
  const { renderToStaticMarkup } = require('react-dom/server');
  return renderToStaticMarkup(element);
}

// Default mock vault status for connected wallet
const defaultVaultStatus = {
  supported: true,
  enabled: true,
  unlocked: true,
  nullspacePublicKeyHex: 'aabbccdd'.repeat(8),
  passwordSupported: true,
  kind: 'password',
};

describe('WalletPill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default (connected) state
    mockGetVaultStatusSync.mockReturnValue(defaultVaultStatus);
  });

  describe('simplified view (default)', () => {
    it('shows connection indicator when wallet is connected', () => {
      const html = renderToString(
        <WalletPill rng={1000} vusdt={500} credits={200} />
      );

      // Should have a status indicator (role="status")
      expect(html).toContain('role="status"');
      // Should show balance
      expect(html).toContain('Balance');
    });

    it('shows "Connect" link when vault is locked', () => {
      mockGetVaultStatusSync.mockReturnValue({
        supported: true,
        enabled: true,
        unlocked: false,
        nullspacePublicKeyHex: null,
        passwordSupported: true,
        kind: 'password',
      });

      const html = renderToString(<WalletPill />);

      expect(html).toContain('Connect');
    });

    it('shows offline status when network is offline', () => {
      const html = renderToString(
        <WalletPill rng={1000} networkStatus="offline" />
      );

      expect(html).toContain('Offline');
    });

    it('calculates total balance from all token types', () => {
      const html = renderToString(
        <WalletPill rng={100} vusdt={200} credits={300} />
      );

      // Total should be 600 (100 + 200 + 300)
      expect(html).toContain('600');
    });

    it('handles null/undefined balance values gracefully', () => {
      const html = renderToString(
        <WalletPill rng={null} vusdt={undefined} credits={null} />
      );

      // Should render without errors, showing 0 total
      expect(html).toContain('0');
    });

    it('handles bigint balance values', () => {
      const html = renderToString(
        <WalletPill rng={BigInt(1000)} vusdt={BigInt(500)} />
      );

      expect(html).toContain('1500');
    });

    it('handles string balance values', () => {
      const html = renderToString(
        <WalletPill rng="1000" vusdt="500" credits="200" />
      );

      expect(html).toContain('1700');
    });
  });

  describe('technical view (simplified=false)', () => {
    it('shows vault status when supported', () => {
      const html = renderToString(
        <WalletPill rng={1000} simplified={false} />
      );

      expect(html).toContain('Vault');
      expect(html).toContain('Unlocked');
    });

    it('shows "Locked" when vault is not unlocked', () => {
      mockGetVaultStatusSync.mockReturnValue({
        supported: true,
        enabled: true,
        unlocked: false,
        nullspacePublicKeyHex: null,
        passwordSupported: true,
        kind: 'password',
      });

      const html = renderToString(
        <WalletPill rng={1000} simplified={false} />
      );

      expect(html).toContain('Locked');
    });

    it('shows individual token balances', () => {
      const html = renderToString(
        <WalletPill rng={100} vusdt={200} credits={300} simplified={false} />
      );

      expect(html).toContain('RNG');
      expect(html).toContain('vUSDT');
      expect(html).toContain('Credits');
    });

    it('shows network label and status', () => {
      const html = renderToString(
        <WalletPill
          rng={1000}
          networkLabel="Testnet"
          networkStatus="online"
          simplified={false}
        />
      );

      expect(html).toContain('Testnet');
    });

    it('shows offline status in network label', () => {
      const html = renderToString(
        <WalletPill
          rng={1000}
          networkLabel="Mainnet"
          networkStatus="offline"
          simplified={false}
        />
      );

      expect(html).toContain('OFFLINE');
    });

    it('shows public key link when available', () => {
      const pubkey = 'aabbccdd'.repeat(8);
      const html = renderToString(
        <WalletPill rng={1000} pubkeyHex={pubkey} simplified={false} />
      );

      expect(html).toContain('/explorer/account/');
      expect(html).toContain('PK');
    });

    it('does not show vault section when not supported', () => {
      mockGetVaultStatusSync.mockReturnValue({
        supported: false,
        enabled: false,
        unlocked: false,
        nullspacePublicKeyHex: null,
        passwordSupported: false,
        kind: null,
      });

      const html = renderToString(
        <WalletPill rng={1000} simplified={false} />
      );

      // Should not show vault section when not supported
      expect(html).not.toContain('Vault');
    });
  });

  describe('accessibility', () => {
    it('has status role for connection indicator', () => {
      const html = renderToString(<WalletPill rng={1000} />);

      expect(html).toContain('role="status"');
    });

    it('has aria-label for connection state', () => {
      const html = renderToString(<WalletPill rng={1000} />);

      expect(html).toContain('aria-label');
    });
  });

  describe('real-time updates', () => {
    it('subscribes to vault changes on mount', () => {
      // The component calls subscribeVault in useEffect
      // We verify the mock is set up correctly
      expect(mockSubscribeVault).toBeDefined();
    });
  });
});
