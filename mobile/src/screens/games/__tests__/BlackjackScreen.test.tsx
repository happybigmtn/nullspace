import React from 'react';
import { InteractionManager, Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import {
  mockHaptics,
  mockUseGameConnection,
  pressAll,
  resetGameConnection,
  setGameConnectionMessage,
} from '../../../test-utils/gameScreenTestUtils';
import {
  createBlackjackPlayerTurnState,
  createBlackjackSplitableState,
} from '../../../test-utils/stateFixtures';
import { PrimaryButton } from '../../../components/ui';
import { BlackjackScreen } from '../BlackjackScreen';
import { parseBlackjackState as parseWrapper } from '../../../utils/state/blackjack';
import { decodeStateBytes } from '../../../utils/stateBytes';
import { parseBlackjackState as parseBlob } from '@nullspace/game-state';

const textMatches = (value: unknown, target: string): boolean => {
  if (typeof value === 'string') return value === target;
  if (Array.isArray(value)) return value.some((child) => textMatches(child, target));
  return false;
};

const findPrimaryButton = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAllByType(PrimaryButton).find((node) => node.props.label === label);

describe('BlackjackScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGameConnection();
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((cb) => {
      if (typeof cb === 'function') cb();
      return { cancel: jest.fn(), then: jest.fn(), done: jest.fn() };
    });
  });

  it('parses state bytes correctly with real parser', () => {
    // Verify the parsing chain works with real parser (not mocked)
    const stateBytes = createBlackjackPlayerTurnState();
    const uint8 = decodeStateBytes(stateBytes);
    expect(uint8).not.toBeNull();

    // Test low-level parser from @nullspace/game-state
    const blobResult = parseBlob(new Uint8Array(stateBytes));
    expect(blobResult).not.toBeNull();
    expect(blobResult!.stage).toBe(1); // player_turn
    expect(blobResult!.actionMask).toBe(0b00000011); // hit + stand

    // Test mobile wrapper parser
    const wrapperResult = parseWrapper(uint8!);
    expect(wrapperResult).not.toBeNull();
    expect(wrapperResult!.phase).toBe('player_turn');
    expect(wrapperResult!.canDouble).toBe(false); // bit 2 not set
    expect(wrapperResult!.canSplit).toBe(false); // bit 3 not set
  });

  it('renders and handles actions', async () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<BlackjackScreen />);
    });

    await pressAll(tree);
    expect(tree.toJSON()).toBeTruthy();
  });

  it('handles game_result win and push states', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<BlackjackScreen />);
    });

    setGameConnectionMessage({
      type: 'game_result',
      won: true,
      hands: [{ cards: [0, 1], value: 20 }],
      dealer: { cards: [2, 3], value: 18 },
    });

    act(() => {
      tree.update(<BlackjackScreen />);
    });

    expect(mockHaptics.win).toHaveBeenCalled();

    setGameConnectionMessage({
      type: 'game_result',
      push: true,
      hands: [{ cards: [4, 5], value: 19 }],
      dealer: { cards: [6, 7], value: 19 },
    });

    act(() => {
      tree.update(<BlackjackScreen />);
    });

    expect(mockHaptics.push).toHaveBeenCalled();
  });

  it('sends stand action and updates to dealer turn', async () => {
    const sendSpy = mockUseGameConnection().send;

    // Create the component first in betting phase
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<BlackjackScreen />);
    });

    // Set up the game_started message with player turn state
    const stateBytes = createBlackjackPlayerTurnState();
    setGameConnectionMessage({
      type: 'game_started',
      state: stateBytes,
    });

    // Trigger re-render to process the message
    await act(async () => {
      tree.update(<BlackjackScreen />);
    });

    const standButton = findPrimaryButton(tree, 'STAND');
    expect(standButton).toBeDefined();

    await act(async () => {
      await standButton?.props.onPress?.();
    });

    expect(sendSpy).toHaveBeenCalledWith({ type: 'blackjack_stand' });
    const hasDealerTurn = tree.root
      .findAllByType(Text)
      .some((node) => textMatches(node.props.children, "Dealer's turn"));
    expect(hasDealerTurn).toBe(true);
  });

  it('sends double and split actions when allowed', async () => {
    const sendSpy = mockUseGameConnection().send;

    // Create the component first in betting phase
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<BlackjackScreen />);
    });

    // Set up a splitable state (pair of 8s) where double and split are allowed
    setGameConnectionMessage({
      type: 'game_started',
      state: createBlackjackSplitableState(),
    });

    // Trigger re-render to process the message
    await act(async () => {
      tree.update(<BlackjackScreen />);
    });

    const doubleButton = findPrimaryButton(tree, 'DOUBLE');
    expect(doubleButton).toBeDefined();
    await act(async () => {
      await doubleButton?.props.onPress?.();
    });

    expect(sendSpy).toHaveBeenCalledWith({ type: 'blackjack_double' });

    const splitButton = findPrimaryButton(tree, 'SPLIT');
    expect(splitButton).toBeDefined();
    await act(async () => {
      await splitButton?.props.onPress?.();
    });

    expect(sendSpy).toHaveBeenCalledWith({ type: 'blackjack_split' });
  });
});
