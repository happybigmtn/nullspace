// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

// Create mock functions at module scope so they can be reconfigured
const mockRefreshOnce = vi.fn().mockResolvedValue(undefined);
let mockConnectionState = {
  status: 'connected' as const,
  statusDetail: undefined as string | undefined,
  error: undefined as string | undefined,
  client: null,
  wasm: null,
  keypair: null,
  currentView: null,
  refreshOnce: mockRefreshOnce,
  onEvent: vi.fn(() => () => {}),
  vaultMode: 'unlocked' as const,
};

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
    React.createElement('a', { href: to, ...props }, children),
}));

vi.mock('@react-spring/web', () => ({
  animated: {
    div: ({ children, style, ...props }: any) =>
      React.createElement('div', props, children),
    span: ({ children, style, ...props }: any) =>
      React.createElement('span', props, children),
  },
  useSpring: () => ({
    color: '#34C759',
    scale: { to: (fn: Function) => fn(1) },
    opacity: { to: (fn: Function) => fn(1) },
    x: { to: (fn: Function) => fn(0) },
  }),
  useTransition: (item: string) => (fn: Function) => [fn({ opacity: 1, scale: 1 }, item)],
  config: { wobbly: {} },
}));

vi.mock('../../hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

vi.mock('../../chain/CasinoConnectionContext', () => ({
  useSharedCasinoConnection: () => mockConnectionState,
}));

vi.mock('../../security/keyVault', () => ({
  createPasswordVault: vi.fn().mockResolvedValue({}),
  unlockPasswordVault: vi.fn().mockResolvedValue({}),
  getVaultStatusSync: () => ({
    supported: true,
    enabled: true,
    unlocked: true,
    nullspacePublicKeyHex: 'aabbccdd'.repeat(8),
    passwordSupported: true,
    kind: 'password',
  }),
}));

import { ConnectionStatus } from '../ConnectionStatus';

// Helper to render component
function renderToString(element: React.ReactElement): string {
  const { renderToStaticMarkup } = require('react-dom/server');
  return renderToStaticMarkup(element);
}

describe('ConnectionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default connected state
    mockConnectionState = {
      status: 'connected',
      statusDetail: undefined,
      error: undefined,
      client: null,
      wasm: null,
      keypair: null,
      currentView: null,
      refreshOnce: mockRefreshOnce,
      onEvent: vi.fn(() => () => {}),
      vaultMode: 'unlocked',
    };
  });

  describe('status display', () => {
    it('shows "Online" when connected', () => {
      mockConnectionState.status = 'connected';

      const html = renderToString(<ConnectionStatus />);

      expect(html).toContain('Online');
    });

    it('shows "Connecting..." when connecting', () => {
      mockConnectionState.status = 'connecting';

      const html = renderToString(<ConnectionStatus />);

      expect(html).toContain('Connecting...');
    });

    it('shows "Reconnecting..." when offline', () => {
      mockConnectionState.status = 'offline';

      const html = renderToString(<ConnectionStatus />);

      expect(html).toContain('Reconnecting...');
    });

    it('shows "Tap to unlock" when vault is locked', () => {
      mockConnectionState.status = 'vault_locked';
      mockConnectionState.vaultMode = 'locked';

      const html = renderToString(<ConnectionStatus />);

      expect(html).toContain('Tap to unlock');
    });

    it('shows "Create vault" when vault is missing', () => {
      mockConnectionState.status = 'vault_locked';
      mockConnectionState.vaultMode = 'missing';

      const html = renderToString(<ConnectionStatus />);

      expect(html).toContain('Create vault');
    });

    it('shows error message or status label on error', () => {
      mockConnectionState.status = 'error';
      mockConnectionState.error = 'Network failure';
      mockConnectionState.statusDetail = undefined;

      const html = renderToString(<ConnectionStatus />);

      // Component shows error message when no statusDetail
      expect(html).toContain('Network failure');
    });

    it('shows "Complete setup" when identity is missing', () => {
      mockConnectionState.status = 'missing_identity';

      const html = renderToString(<ConnectionStatus />);

      expect(html).toContain('Complete setup');
    });
  });

  describe('retry functionality', () => {
    it('shows retry button when offline', () => {
      mockConnectionState.status = 'offline';

      const html = renderToString(<ConnectionStatus />);

      expect(html).toContain('Retry');
    });

    it('shows retry button on error', () => {
      mockConnectionState.status = 'error';

      const html = renderToString(<ConnectionStatus />);

      expect(html).toContain('Retry');
    });

    it('does not show retry button when connected', () => {
      mockConnectionState.status = 'connected';

      const html = renderToString(<ConnectionStatus />);

      // Look for the specific retry button pattern
      expect(html).not.toMatch(/>Retry</);
    });
  });

  describe('vault unlock', () => {
    it('shows vault/unlock button', () => {
      const html = renderToString(<ConnectionStatus />);

      // Should have a button for vault access
      expect(html).toMatch(/Vault|Unlock|Create/);
    });
  });

  describe('accessibility', () => {
    it('has status role', () => {
      const html = renderToString(<ConnectionStatus />);

      expect(html).toContain('role="status"');
    });

    it('has aria-live for real-time updates', () => {
      const html = renderToString(<ConnectionStatus />);

      expect(html).toContain('aria-live="polite"');
    });
  });

  describe('status detail display', () => {
    it('shows status detail when available', () => {
      mockConnectionState.status = 'error';
      mockConnectionState.statusDetail = 'Connection timeout after 5 seconds';

      const html = renderToString(<ConnectionStatus />);

      expect(html).toContain('Connection timeout');
    });

    it('shows error message when no status detail', () => {
      mockConnectionState.status = 'error';
      mockConnectionState.error = 'WebSocket closed unexpectedly';
      mockConnectionState.statusDetail = undefined;

      const html = renderToString(<ConnectionStatus />);

      expect(html).toContain('WebSocket closed');
    });
  });

  describe('real-time updates', () => {
    it('renders correctly with connection context', () => {
      const html = renderToString(<ConnectionStatus />);
      expect(html).toBeDefined();
    });

    it('shows retry for offline state (implying it can be clicked)', () => {
      mockConnectionState.status = 'offline';

      const html = renderToString(<ConnectionStatus />);
      expect(html).toContain('Retry');
    });
  });
});

describe('ConnectionStatus status colors', () => {
  beforeEach(() => {
    mockConnectionState = {
      status: 'connected',
      statusDetail: undefined,
      error: undefined,
      client: null,
      wasm: null,
      keypair: null,
      currentView: null,
      refreshOnce: mockRefreshOnce,
      onEvent: vi.fn(() => () => {}),
      vaultMode: 'unlocked',
    };
  });

  it('renders for connected state', () => {
    mockConnectionState.status = 'connected';
    const html = renderToString(<ConnectionStatus />);
    expect(html).toBeDefined();
  });

  it('renders for offline state', () => {
    mockConnectionState.status = 'offline';
    const html = renderToString(<ConnectionStatus />);
    expect(html).toBeDefined();
  });

  it('renders for error state', () => {
    mockConnectionState.status = 'error';
    const html = renderToString(<ConnectionStatus />);
    expect(html).toBeDefined();
  });
});

describe('ConnectionStatus icons', () => {
  beforeEach(() => {
    mockConnectionState = {
      status: 'connected',
      statusDetail: undefined,
      error: undefined,
      client: null,
      wasm: null,
      keypair: null,
      currentView: null,
      refreshOnce: mockRefreshOnce,
      onEvent: vi.fn(() => () => {}),
      vaultMode: 'unlocked',
    };
  });

  it('shows SVG icon when connected', () => {
    mockConnectionState.status = 'connected';
    const html = renderToString(<ConnectionStatus />);
    expect(html).toContain('svg');
  });

  it('shows SVG icon when connecting', () => {
    mockConnectionState.status = 'connecting';
    const html = renderToString(<ConnectionStatus />);
    expect(html).toContain('svg');
  });

  it('shows SVG icon when vault is locked', () => {
    mockConnectionState.status = 'vault_locked';
    const html = renderToString(<ConnectionStatus />);
    expect(html).toContain('svg');
  });
});
