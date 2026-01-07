import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { AuthScreen } from '../AuthScreen';
import { PrimaryButton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { authenticateWithBiometrics, getBiometricType } from '../../services/auth';

const mockAuthenticate = jest.fn();
const mockAuthenticateWithBiometrics = authenticateWithBiometrics as jest.Mock;
const mockGetBiometricType = getBiometricType as jest.Mock;

jest.mock('../../context', () => ({
  useAuth: () => ({ authenticate: mockAuthenticate }),
}));

jest.mock('../../services/auth', () => ({
  authenticateWithBiometrics: jest.fn(),
  getBiometricType: jest.fn(),
}));

jest.mock('../../services/haptics', () => ({
  haptics: {
    win: jest.fn(),
    loss: jest.fn(),
    buttonPress: jest.fn(),
    betConfirm: jest.fn(),
  },
}));

const mockIsOnboardingCompleted = jest.fn();
jest.mock('../../services', () => ({
  isOnboardingCompleted: () => mockIsOnboardingCompleted(),
}));

describe('AuthScreen', () => {
  const renderScreen = (navigation: { replace: jest.Mock }) => {
    const route = { key: 'Auth', name: 'Auth' as const };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<AuthScreen navigation={navigation as any} route={route as any} />);
    });
    return tree;
  };

  beforeEach(() => {
    mockAuthenticate.mockReset();
    mockAuthenticateWithBiometrics.mockReset();
    mockGetBiometricType.mockReset();
    mockIsOnboardingCompleted.mockReset();
    // Default: onboarding is completed (returning user)
    mockIsOnboardingCompleted.mockReturnValue(true);
  });

  it('renders biometric label based on type', () => {
    mockGetBiometricType.mockReturnValue('FACE_ID');
    const navigation = { replace: jest.fn() } as const;
    const tree = renderScreen(navigation);

    const buttons = tree.root.findAllByType(PrimaryButton);
    expect(buttons[0].props.label).toBe('Authenticate with Face ID');
    expect(buttons[1].props.label).toBe('Skip (Demo Mode)');
  });

  it('navigates to lobby on successful authentication', async () => {
    mockGetBiometricType.mockReturnValue('TOUCH_ID');
    mockAuthenticateWithBiometrics.mockResolvedValue(true);
    const navigation = { replace: jest.fn() } as const;
    const tree = renderScreen(navigation);

    const button = tree.root.findAllByType(PrimaryButton)[0];
    await act(async () => {
      await button.props.onPress();
    });

    expect(haptics.win).toHaveBeenCalled();
    expect(mockAuthenticate).toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('Lobby');
  });

  it('shows error message when authentication fails', async () => {
    mockGetBiometricType.mockReturnValue('FINGERPRINT');
    mockAuthenticateWithBiometrics.mockResolvedValue(false);
    const navigation = { replace: jest.fn() } as const;
    const tree = renderScreen(navigation);

    const button = tree.root.findAllByType(PrimaryButton)[0];
    await act(async () => {
      await button.props.onPress();
    });

    const texts = tree.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts.flat().join(' ')).toContain('Authentication failed. Please try again.');
  });

  it('allows skipping in dev mode', () => {
    mockGetBiometricType.mockReturnValue('FACE_ID');
    const navigation = { replace: jest.fn() } as const;
    const tree = renderScreen(navigation);

    const skipButton = tree.root.findAllByType(PrimaryButton)[1];
    act(() => {
      skipButton.props.onPress();
    });

    expect(haptics.buttonPress).toHaveBeenCalled();
    expect(mockAuthenticate).toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('Lobby');
  });

  it('navigates to onboarding for first-time users', async () => {
    mockGetBiometricType.mockReturnValue('FACE_ID');
    mockAuthenticateWithBiometrics.mockResolvedValue(true);
    mockIsOnboardingCompleted.mockReturnValue(false);
    const navigation = { replace: jest.fn() } as const;
    const tree = renderScreen(navigation);

    const button = tree.root.findAllByType(PrimaryButton)[0];
    await act(async () => {
      await button.props.onPress();
    });

    expect(navigation.replace).toHaveBeenCalledWith('Onboarding');
  });

  it('navigates to lobby when skipping for first-time users (shows onboarding)', () => {
    mockGetBiometricType.mockReturnValue('FACE_ID');
    mockIsOnboardingCompleted.mockReturnValue(false);
    const navigation = { replace: jest.fn() } as const;
    const tree = renderScreen(navigation);

    const skipButton = tree.root.findAllByType(PrimaryButton)[1];
    act(() => {
      skipButton.props.onPress();
    });

    expect(navigation.replace).toHaveBeenCalledWith('Onboarding');
  });
});
