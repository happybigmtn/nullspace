import React from 'react';
import { act, create } from 'react-test-renderer';
import { RootNavigator } from '../RootNavigator';

let capturedLinking: any = null;
const mockGetStateFromPath = jest.fn();

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children, linking }: { children: React.ReactNode; linking?: unknown }) => {
    capturedLinking = linking;
    return <>{children}</>;
  },
  getStateFromPath: (...args: unknown[]) => mockGetStateFromPath(...args),
}));

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Screen: () => null,
  }),
}));

jest.mock('../../context', () => ({
  useAuth: jest.fn(),
}));

const mockUseAuth = require('../../context').useAuth as jest.Mock;

describe('RootNavigator', () => {
  beforeEach(() => {
    capturedLinking = null;
    mockGetStateFromPath.mockReset();
  });

  it('renders nothing while loading', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: true });

    let tree: unknown;
    act(() => {
      tree = create(<RootNavigator />).toJSON();
    });

    expect(tree).toBeNull();
  });

  it('redirects protected routes for unauthenticated users', () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    mockGetStateFromPath.mockReturnValue({ routes: [{ name: 'Lobby' }] });

    act(() => {
      create(<RootNavigator />);
    });

    const state = capturedLinking.getStateFromPath('lobby', {});
    expect(state).toEqual({ routes: [{ name: 'Auth' }] });
  });

  describe('SESSION_EXPIRED handling (US-068)', () => {
    it('redirects Game route to Auth when session expired (not authenticated)', () => {
      // When session expires, useAuth returns isAuthenticated: false
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        sessionExpired: true,
      });
      mockGetStateFromPath.mockReturnValue({ routes: [{ name: 'Game', params: { gameId: 'blackjack' } }] });

      act(() => {
        create(<RootNavigator />);
      });

      // Deep link to Game should redirect to Auth
      const state = capturedLinking.getStateFromPath('game/blackjack', {});
      expect(state).toEqual({ routes: [{ name: 'Auth' }] });
    });

    it('renders navigator when session expired (not loading)', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        sessionExpired: true,
      });

      let renderer: ReturnType<typeof create>;
      act(() => {
        renderer = create(<RootNavigator />);
      });

      // When session is expired (not authenticated, not loading),
      // the navigator should render (not return null like when loading)
      // The initialRouteName will be 'Splash' based on isAuthenticated: false
      // We verify the linking config was captured (component rendered)
      expect(capturedLinking).not.toBeNull();
      expect(capturedLinking.prefixes).toBeDefined();
    });

    it('redirects Lobby route to Auth when session expired', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        sessionExpired: true,
      });
      mockGetStateFromPath.mockReturnValue({ routes: [{ name: 'Lobby' }] });

      act(() => {
        create(<RootNavigator />);
      });

      const state = capturedLinking.getStateFromPath('lobby', {});
      expect(state).toEqual({ routes: [{ name: 'Auth' }] });
    });

    it('allows Vault route when session expired (not protected)', () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        sessionExpired: true,
      });
      mockGetStateFromPath.mockReturnValue({ routes: [{ name: 'Vault' }] });

      act(() => {
        create(<RootNavigator />);
      });

      // Vault is not in protectedRoutes, so should pass through
      const state = capturedLinking.getStateFromPath('vault', {});
      expect(state).toEqual({ routes: [{ name: 'Vault' }] });
    });
  });
});
