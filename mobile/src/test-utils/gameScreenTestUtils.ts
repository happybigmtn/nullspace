import type { ReactTestRenderer } from 'react-test-renderer';
import { act } from 'react-test-renderer';

const resolved = () => Promise.resolve();

export const mockHaptics = {
  betConfirm: jest.fn(resolved),
  buttonPress: jest.fn(resolved),
  chipPlace: jest.fn(resolved),
  diceRoll: jest.fn(resolved),
  error: jest.fn(resolved),
  jackpot: jest.fn(resolved),
  loss: jest.fn(resolved),
  push: jest.fn(resolved),
  selectionChange: jest.fn(resolved),
  wheelSpin: jest.fn(resolved),
  win: jest.fn(resolved),
};

// Track state separately so we can return fresh objects on each mock call
let currentLastMessage: unknown = null;
let currentConnectionState: 'connecting' | 'connected' | 'disconnected' | 'failed' = 'connected';
let currentReconnectAttempt = 0;
const sendMock = jest.fn(() => currentConnectionState === 'connected');
const onRetryMock = jest.fn();

// Return a fresh object each call so React's useEffect sees changes
export const mockUseGameConnection = jest.fn(() => ({
  isDisconnected: currentConnectionState !== 'connected',
  send: sendMock,
  lastMessage: currentLastMessage,
  connectionStatusProps: {
    connectionState: currentConnectionState,
    reconnectAttempt: currentReconnectAttempt,
    maxReconnectAttempts: 3,
    onRetry: onRetryMock,
  },
}));

export function setGameConnectionMessage(message: unknown) {
  currentLastMessage = message;
}

export function setGameConnectionState(state: 'connecting' | 'connected' | 'disconnected' | 'failed') {
  currentConnectionState = state;
}

export function setReconnectAttempt(attempt: number) {
  currentReconnectAttempt = attempt;
}

export function getSendMock() {
  return sendMock;
}

export function getOnRetryMock() {
  return onRetryMock;
}

export function resetGameConnection() {
  currentLastMessage = null;
  currentConnectionState = 'connected';
  currentReconnectAttempt = 0;
  sendMock.mockClear();
  onRetryMock.mockClear();
}

export const mockUseChipBetting = jest.fn(() => ({
  bet: 0,
  selectedChip: 25,
  balance: 1000,
  setSelectedChip: jest.fn(),
  placeChip: jest.fn(() => true),
  clearBet: jest.fn(),
  setBet: jest.fn(),
}));

export const mockUseBetSubmission = jest.fn(() => ({
  isSubmitting: false,
  submitBet: jest.fn(() => true),
  clearSubmission: jest.fn(),
}));

export const mockUseGameKeyboard = jest.fn();
export const mockUseModalBackHandler = jest.fn();

jest.mock('../services/haptics', () => ({
  haptics: mockHaptics,
}));

jest.mock('../services/storage', () => ({
  isTutorialCompleted: jest.fn(() => true),
  markTutorialCompleted: jest.fn(),
}));

const mockGameStoreState = {
  balance: 1000,
  publicKey: null,
  betValidationLocked: false,
  pendingBalanceUpdate: null,
  lastBalanceSeq: 0,
};

const mockGameStoreActions = {
  validateAndLockBet: jest.fn((amount: number) => amount <= mockGameStoreState.balance),
  unlockBetValidation: jest.fn(),
  setBalanceWithSeq: jest.fn(() => true),
};

const mockUseGameStore = Object.assign(
  jest.fn((selector?: (state: typeof mockGameStoreState) => unknown) => {
    if (selector) {
      return selector(mockGameStoreState);
    }
    return mockGameStoreState;
  }),
  {
    getState: jest.fn(() => ({ ...mockGameStoreState, ...mockGameStoreActions })),
    setState: jest.fn(),
  }
);

jest.mock('../stores/gameStore', () => ({
  useGameStore: mockUseGameStore,
}));

jest.mock('../hooks', () => {
  const actual = jest.requireActual('../hooks');
  return {
    ...actual,
    useGameConnection: (...args: unknown[]) => mockUseGameConnection(...(args as [])),
    useChipBetting: (...args: unknown[]) => mockUseChipBetting(...(args as [])),
    useBetSubmission: (...args: unknown[]) => mockUseBetSubmission(...(args as [])),
    useGameKeyboard: (...args: unknown[]) => mockUseGameKeyboard(...args),
    useModalBackHandler: (...args: unknown[]) => mockUseModalBackHandler(...args),
  };
});

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      goBack: jest.fn(),
      navigate: jest.fn(),
      setOptions: jest.fn(),
    }),
  };
});

jest.mock('../components/game/EventBadge', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { EventBadge: () => React.createElement(Text, null, 'Event') };
});

export async function pressAll(tree: ReactTestRenderer) {
  const handlers = tree.root
    .findAll((node) => typeof node.props.onPress === 'function')
    .map((node) => node.props.onPress);
  for (const handler of handlers) {
    await act(async () => {
      await handler();
    });
  }
}
