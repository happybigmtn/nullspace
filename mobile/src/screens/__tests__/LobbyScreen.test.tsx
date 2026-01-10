import React from 'react';
import { Linking, Share, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { LobbyScreen } from '../LobbyScreen';
import { useGameStore } from '../../stores/gameStore';

jest.mock('react-native/Libraries/Lists/FlatList', () => {
  const React = require('react');
  const FlatListMock = ({ data = [], renderItem, ListHeaderComponent, ListFooterComponent }: any) => (
    <React.Fragment>
      {ListHeaderComponent ? <ListHeaderComponent /> : null}
      {data.map((item: any, index: number) => (
        <React.Fragment key={item?.id ?? index}>
          {renderItem({ item, index })}
        </React.Fragment>
      ))}
      {ListFooterComponent ? <ListFooterComponent /> : null}
    </React.Fragment>
  );
  FlatListMock.displayName = 'FlatList';
  return {
    __esModule: true,
    default: FlatListMock,
  };
});

const mockRequestFaucet = jest.fn();
const mockUseEntitlements = jest.fn();
const mockUseGatewaySession = jest.fn();

jest.mock('../../hooks', () => ({
  useEntitlements: () => mockUseEntitlements(),
  useGatewaySession: () => mockUseGatewaySession(),
}));

jest.mock('../../services', () => ({
  initializeNotifications: jest.fn(),
}));

jest.mock('../../services/haptics', () => ({
  haptics: { selectionChange: jest.fn(() => Promise.resolve()) },
}));

const readText = (node: any) => {
  const { children } = node.props ?? {};
  if (Array.isArray(children)) {
    return children
      .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
      .join('');
  }
  return typeof children === 'string' || typeof children === 'number' ? String(children) : '';
};

const findPressableByLabel = (root: ReturnType<typeof create>['root'], label: string) => {
  const textNode = root.findAllByType(Text).find((node) => readText(node).includes(label));
  let current = textNode?.parent;
  while (current && typeof current.props?.onPress !== 'function') {
    current = current.parent;
  }
  return current;
};

describe('LobbyScreen', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const originalShare = Share.share;
  const originalOpenUrl = Linking.openURL;

  beforeEach(() => {
    jest.clearAllMocks();
    act(() => {
      useGameStore.setState({
        balance: 500,
        balanceReady: true,
        publicKey: 'abcdef1234567890',
        faucetStatus: 'idle',
        faucetMessage: null,
      } as never);
    });
    process.env = { ...originalEnv };
    mockUseEntitlements.mockReturnValue({ entitlements: [], loading: false });
    mockUseGatewaySession.mockReturnValue({ requestFaucet: mockRequestFaucet, connectionState: 'connected' });
    (Share.share as jest.Mock) = jest.fn().mockResolvedValue({ action: 'sharedAction' });
    (Linking.openURL as jest.Mock) = jest.fn();
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    Share.share = originalShare;
    Linking.openURL = originalOpenUrl;
  });

  it('renders lobby screen', async () => {
    const navigation = { navigate: jest.fn(), replace: jest.fn() } as any;
    const route = { key: 'lobby-1', name: 'Lobby' as const };
    const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(<LobbyScreen navigation={navigation} route={route} />);
      await flushPromises();
    });

    expect(tree?.toJSON()).toBeTruthy();
  });

  it('allows game navigation', async () => {
    const navigation = { navigate: jest.fn(), replace: jest.fn() } as any;
    const route = { key: 'lobby-1', name: 'Lobby' as const };
    const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(<LobbyScreen navigation={navigation} route={route} />);
      await flushPromises();
    });

    // Find the header buttons (History and Profile) - 44x44 circular pressables
    const pressables = tree!.root.findAll((node) =>
      typeof node.props.onPress === 'function'
    );
    // Both header buttons have 44x44 dimensions - find them all
    const headerButtons = pressables.filter((node) => {
      const style = node.props.style;
      if (Array.isArray(style)) {
        return style.some((s: any) => s?.width === 44 && s?.height === 44);
      }
      return style?.width === 44 && style?.height === 44;
    });

    // US-165: We now have 2 header buttons - History (first) and Profile (second)
    expect(headerButtons.length).toBeGreaterThanOrEqual(2);

    // Test History button navigates to History
    const historyButton = headerButtons[0];
    expect(historyButton?.props.onPress).toBeDefined();
    act(() => {
      historyButton!.props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith('History');

    navigation.navigate.mockClear();

    // Test Profile button navigates to Vault
    const profileButton = headerButtons[1];
    expect(profileButton?.props.onPress).toBeDefined();
    act(() => {
      profileButton!.props.onPress();
    });
    expect(navigation.navigate).toHaveBeenCalledWith('Vault');
  });

  it('requests faucet when claim pressed', async () => {
    const navigation = { navigate: jest.fn(), replace: jest.fn() } as any;
    const route = { key: 'lobby-1', name: 'Lobby' as const };
    const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(<LobbyScreen navigation={navigation} route={route} />);
      await flushPromises();
    });

    const claimButton = findPressableByLabel(tree!.root, 'Claim');
    expect(claimButton).toBeDefined();
    expect(claimButton?.props.disabled).toBeFalsy();

    act(() => {
      claimButton?.props.onPress?.();
    });

    expect(mockRequestFaucet).toHaveBeenCalled();
  });

  it('disables faucet claim while pending', async () => {
    act(() => {
      useGameStore.setState({
        faucetStatus: 'pending',
        faucetMessage: 'Working...',
      } as never);
    });

    const navigation = { navigate: jest.fn(), replace: jest.fn() } as any;
    const route = { key: 'lobby-1', name: 'Lobby' as const };
    const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(<LobbyScreen navigation={navigation} route={route} />);
      await flushPromises();
    });

    const disabledClaim = findPressableByLabel(tree!.root, 'Claim');
    act(() => {
      disabledClaim?.props.onPress?.();
    });
    expect(mockRequestFaucet).not.toHaveBeenCalled();
  });

  it('opens billing when membership button is tapped', async () => {
    process.env.EXPO_PUBLIC_BILLING_URL = 'https://billing.test';
    mockUseEntitlements.mockReturnValue({
      entitlements: [{ status: 'active', tier: 'gold' }],
      loading: false,
    });

    const navigation = { navigate: jest.fn(), replace: jest.fn() } as any;
    const route = { key: 'lobby-1', name: 'Lobby' as const };
    const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(<LobbyScreen navigation={navigation} route={route} />);
      await flushPromises();
    });

    const hasManageLabel = tree!.root
      .findAllByType(Text)
      .some((node) => readText(node).includes('Manage'));
    expect(hasManageLabel).toBe(true);

    const manageButton = findPressableByLabel(tree!.root, 'Manage');
    expect(manageButton).toBeDefined();
    act(() => {
      manageButton?.props.onPress?.();
    });

    expect(Linking.openURL).toHaveBeenCalledWith('https://billing.test');
  });

  it('renders league and referral data', async () => {
    process.env.EXPO_PUBLIC_OPS_URL = 'https://ops.test';
    process.env.EXPO_PUBLIC_WEBSITE_URL = 'https://site.test';

    const leaderboardKey = 'abcdef1234567890';
    const referralCode = 'REF123';

    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/league/leaderboard')) {
        return { ok: true, json: async () => ({ entries: [{ publicKey: leaderboardKey, points: 120 }] }) } as Response;
      }
      if (url.endsWith('/referrals/code')) {
        return { ok: true, json: async () => ({ code: referralCode }) } as Response;
      }
      if (url.includes('/referrals/summary')) {
        return { ok: true, json: async () => ({ referrals: 2, qualified: 1, code: referralCode }) } as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const navigation = { navigate: jest.fn(), replace: jest.fn() } as any;
    const route = { key: 'lobby-1', name: 'Lobby' as const };
    const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

    let tree: ReturnType<typeof create> | null = null;
    await act(async () => {
      tree = create(<LobbyScreen navigation={navigation} route={route} />);
      await flushPromises();
    });
    await act(async () => {
      await flushPromises();
      await flushPromises();
    });
    await act(async () => {
      await flushPromises();
    });

    expect(global.fetch).toHaveBeenCalled();
    const hasWeeklyLeague = tree!.root.findAllByType(Text).some((node) => readText(node).includes('Weekly league'));
    expect(hasWeeklyLeague).toBe(true);

    const leagueRank = tree!.root.findAllByType(Text).some((node) => readText(node).includes('#1'));
    expect(leagueRank).toBe(true);

    const referralCodeNode = tree!.root.findAllByType(Text).some((node) => readText(node).includes(referralCode));
    expect(referralCodeNode).toBe(true);

    const shareButton = findPressableByLabel(tree!.root, 'Share invite');
    expect(shareButton).toBeDefined();
    await act(async () => {
      await shareButton?.props.onPress?.();
    });

    expect(Share.share).toHaveBeenCalled();
  });
});
