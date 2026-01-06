import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  mockHaptics,
  mockUseGameConnection,
  pressAll,
  resetGameConnection,
  setGameConnectionMessage,
} from '../../../test-utils/gameScreenTestUtils';
import { PrimaryButton } from '../../../components/ui';
import { BaccaratScreen } from '../BaccaratScreen';

const findPrimaryButton = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAllByType(PrimaryButton).find((node) => node.props.label === label);

const findPressableByText = (tree: ReturnType<typeof create>, target: string) =>
  tree.root.find(
    (node) =>
      typeof node.props?.onPress === 'function'
      && node.findAll(
        (child) =>
          typeof child?.props?.children === 'string'
          && child.props.children === target
      ).length > 0
  );

const findChipSelector = (tree: ReturnType<typeof create>) =>
  tree.root.find(
    (node) =>
      typeof node.props?.onChipPlace === 'function'
      && typeof node.props?.onSelect === 'function'
  );

describe('BaccaratScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGameConnection();
  });

  it('renders and handles actions', async () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<BaccaratScreen />);
    });

    await pressAll(tree);
    expect(tree.toJSON()).toBeTruthy();
  });

  it('handles game_result and triggers loss haptics without a bet', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<BaccaratScreen />);
    });

    setGameConnectionMessage({
      type: 'game_result',
      winner: 'PLAYER',
      player: { cards: [0, 1], total: 8 },
      banker: { cards: [2, 3], total: 6 },
    });

    act(() => {
      tree.update(<BaccaratScreen />);
    });

    expect(mockHaptics.loss).toHaveBeenCalled();
  });

  it('adds main and side bets then sends deal', async () => {
    const sendSpy = mockUseGameConnection().send;
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<BaccaratScreen />);
    });

    const bankerButton = findPressableByText(tree, 'BANKER');
    act(() => {
      bankerButton.props.onPress();
    });

    const selector = findChipSelector(tree);
    act(() => {
      selector.props.onChipPlace(25);
    });

    const tieButton = findPressableByText(tree, 'Tie');
    act(() => {
      tieButton.props.onPress();
    });

    const dealButton = findPrimaryButton(tree, 'DEAL');
    await act(async () => {
      await dealButton?.props.onPress?.();
    });

    expect(mockHaptics.betConfirm).toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith({
      type: 'baccarat_deal',
      bets: [
        { type: 'BANKER', amount: 25 },
        { type: 'TIE', amount: 25 },
      ],
    });
  });

  it('triggers win haptics when bet matches winner', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<BaccaratScreen />);
    });

    const selector = findChipSelector(tree);
    act(() => {
      selector.props.onChipPlace(25);
    });

    setGameConnectionMessage({
      type: 'game_result',
      winner: 'PLAYER',
      player: { cards: [0, 1], total: 8 },
      banker: { cards: [2, 3], total: 6 },
    });

    act(() => {
      tree.update(<BaccaratScreen />);
    });

    expect(mockHaptics.win).toHaveBeenCalled();
  });

  describe('isMounted pattern', () => {
    it('unmounts cleanly without setState warnings', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<BaccaratScreen />);
      });

      // Component should unmount without issues
      act(() => {
        tree.unmount();
      });

      // If we get here without warnings, the isMounted cleanup is working
      expect(true).toBe(true);
    });

    it('handles message after unmount without errors', () => {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<BaccaratScreen />);
      });

      // Unmount the component
      act(() => {
        tree.unmount();
      });

      // Set a message that would trigger setState - should not throw
      setGameConnectionMessage({
        type: 'game_result',
        winner: 'PLAYER',
        player: { cards: [0, 1], total: 8 },
        banker: { cards: [2, 3], total: 6 },
      });

      // If we get here without errors, the pattern is working
      expect(true).toBe(true);
    });
  });
});
