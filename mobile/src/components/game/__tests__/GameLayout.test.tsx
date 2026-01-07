import React from 'react';
import { act, create } from 'react-test-renderer';
import { GameLayout } from '../GameLayout';
import type { ConnectionState } from '../../../services/websocket';

const mockGameHeader = jest.fn((_props: Record<string, unknown>) => null);
const mockConnectionStatusBanner = jest.fn((_props: Record<string, unknown>) => null);
const mockErrorRecoveryOverlay = jest.fn((_props: Record<string, unknown>) => null);

jest.mock('../GameHeader', () => ({
  GameHeader: (props: Record<string, unknown>) => mockGameHeader(props),
}));

jest.mock('../../ui/ConnectionStatusBanner', () => ({
  ConnectionStatusBanner: (props: Record<string, unknown>) => mockConnectionStatusBanner(props),
}));

jest.mock('../../ui/ErrorRecoveryOverlay', () => ({
  ErrorRecoveryOverlay: (props: Record<string, unknown>) => mockErrorRecoveryOverlay(props),
}));

describe('GameLayout', () => {
  beforeEach(() => {
    mockGameHeader.mockClear();
    mockConnectionStatusBanner.mockClear();
    mockErrorRecoveryOverlay.mockClear();
  });

  it('passes session delta to header and renders error overlay', () => {
    const connectionStatus = {
      connectionState: 'connected' as ConnectionState,
      reconnectAttempt: 1,
      maxReconnectAttempts: 3,
      onRetry: jest.fn(),
    };

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <GameLayout title="Test" balance={100} connectionStatus={connectionStatus}>
          {null}
        </GameLayout>
      );
    });

    // ErrorRecoveryOverlay is always rendered (even when hidden)
    expect(mockErrorRecoveryOverlay).toHaveBeenCalled();
    // ConnectionStatusBanner only shown when NOT in error state and NOT connected
    // Since connected, banner is hidden
    const firstCall = mockGameHeader.mock.calls[0] as [Record<string, unknown>] | undefined;
    expect(firstCall?.[0]).toEqual(
      expect.objectContaining({ title: 'Test', balance: 100, sessionDelta: 0 })
    );

    act(() => {
      tree.update(
        <GameLayout title="Test" balance={150} connectionStatus={connectionStatus}>
          {null}
        </GameLayout>
      );
    });

    const lastCall = mockGameHeader.mock.calls[mockGameHeader.mock.calls.length - 1] as [Record<string, unknown>] | undefined;
    expect(lastCall?.[0]).toEqual(
      expect.objectContaining({ title: 'Test', balance: 150, sessionDelta: 50 })
    );
  });
});
