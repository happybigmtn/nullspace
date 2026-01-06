import React from 'react';
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { isTutorialCompleted, markTutorialCompleted } from '../../../services/storage';
import { TutorialOverlay } from '../TutorialOverlay';

jest.mock('../../../services/haptics', () => ({
  haptics: { buttonPress: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../../services/storage', () => ({
  isTutorialCompleted: jest.fn(),
  markTutorialCompleted: jest.fn(),
}));

describe('TutorialOverlay', () => {
  let mockHaptics: { buttonPress: jest.Mock };

  beforeEach(() => {
    mockHaptics = (jest.requireMock('../../../services/haptics') as {
      haptics: { buttonPress: jest.Mock };
    }).haptics;
    (isTutorialCompleted as jest.Mock).mockReturnValue(false);
    (markTutorialCompleted as jest.Mock).mockReset();
    mockHaptics.buttonPress.mockClear();
  });

  it('advances through steps and completes', async () => {
    const onComplete = jest.fn();
    const steps = [
      { title: 'Step 1', description: 'First' },
      { title: 'Step 2', description: 'Second' },
    ];

    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <TutorialOverlay gameId="blackjack" steps={steps} onComplete={onComplete} forceShow />
      );
    });

    let text = tree.root.findAllByType(Text).map((node) => node.props.children).join(' ');
    expect(text).toContain('Step 1');

    const buttons = tree.root.findAll((node) => typeof node.props.onPress === 'function');
    await act(async () => {
      await buttons[1].props.onPress();
    });

    text = tree.root.findAllByType(Text).map((node) => node.props.children).join(' ');
    expect(text).toContain('Step 2');

    await act(async () => {
      await buttons[1].props.onPress();
    });

    expect(markTutorialCompleted).toHaveBeenCalledWith('blackjack');
    expect(onComplete).toHaveBeenCalled();
    expect(mockHaptics.buttonPress).toHaveBeenCalled();
  });

  it('skips tutorial when requested', async () => {
    const onComplete = jest.fn();
    const steps = [{ title: 'Only', description: 'One' }];
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <TutorialOverlay gameId="hilo" steps={steps} onComplete={onComplete} forceShow />
      );
    });

    const buttons = tree.root.findAll((node) => typeof node.props.onPress === 'function');
    await act(async () => {
      await buttons[0].props.onPress();
    });

    expect(markTutorialCompleted).toHaveBeenCalledWith('hilo');
    expect(onComplete).toHaveBeenCalled();
  });

  // ========================================================================
  // Storage Failure Tests (US-055)
  // ========================================================================

  describe('Storage failure handling', () => {
    it('shows tutorial when isTutorialCompleted throws error', () => {
      // Simulate storage not initialized (throws error)
      (isTutorialCompleted as jest.Mock).mockImplementation(() => {
        throw new Error('Storage not initialized');
      });

      const onComplete = jest.fn();
      const steps = [{ title: 'Welcome', description: 'First step' }];

      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <TutorialOverlay gameId="craps" steps={steps} onComplete={onComplete} />
        );
      });

      // Tutorial should be visible despite storage error (fallback to visible=true)
      const texts = tree.root.findAllByType(Text).map((node) => node.props.children);
      expect(texts).toContain('Welcome');
    });

    it('still calls onComplete when markTutorialCompleted throws on complete', async () => {
      (isTutorialCompleted as jest.Mock).mockReturnValue(false);
      (markTutorialCompleted as jest.Mock).mockImplementation(() => {
        throw new Error('Storage write failed');
      });

      const onComplete = jest.fn();
      const steps = [{ title: 'Single Step', description: 'Only one' }];

      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <TutorialOverlay gameId="roulette" steps={steps} onComplete={onComplete} forceShow />
        );
      });

      // Click Next (which completes single-step tutorial)
      const buttons = tree.root.findAll((node) => typeof node.props.onPress === 'function');
      await act(async () => {
        await buttons[1].props.onPress(); // Next/Done button
      });

      // markTutorialCompleted was called and threw, but onComplete still fired
      expect(markTutorialCompleted).toHaveBeenCalledWith('roulette');
      expect(onComplete).toHaveBeenCalled();
    });

    it('still calls onComplete when markTutorialCompleted throws on skip', async () => {
      (isTutorialCompleted as jest.Mock).mockReturnValue(false);
      (markTutorialCompleted as jest.Mock).mockImplementation(() => {
        throw new Error('Storage write failed');
      });

      const onComplete = jest.fn();
      const steps = [
        { title: 'Step 1', description: 'First' },
        { title: 'Step 2', description: 'Second' },
      ];

      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <TutorialOverlay gameId="baccarat" steps={steps} onComplete={onComplete} forceShow />
        );
      });

      // Click Skip button
      const buttons = tree.root.findAll((node) => typeof node.props.onPress === 'function');
      await act(async () => {
        await buttons[0].props.onPress(); // Skip button
      });

      // Storage write threw but onComplete still called
      expect(markTutorialCompleted).toHaveBeenCalledWith('baccarat');
      expect(onComplete).toHaveBeenCalled();
    });

    it('tutorial will show again on next visit if storage fails', async () => {
      // First visit: storage write fails
      (isTutorialCompleted as jest.Mock).mockReturnValue(false);
      (markTutorialCompleted as jest.Mock).mockImplementation(() => {
        throw new Error('Storage write failed');
      });

      const onComplete1 = jest.fn();
      const steps = [{ title: 'Tutorial', description: 'Learn this' }];

      let tree1!: ReturnType<typeof create>;
      act(() => {
        tree1 = create(
          <TutorialOverlay gameId="sic-bo" steps={steps} onComplete={onComplete1} forceShow />
        );
      });

      // Complete the tutorial (storage fails silently)
      const buttons = tree1.root.findAll((node) => typeof node.props.onPress === 'function');
      await act(async () => {
        await buttons[1].props.onPress();
      });

      expect(onComplete1).toHaveBeenCalled();

      // Second visit: Since storage never saved completion, isTutorialCompleted returns false
      // (We simulate this by keeping the mock returning false)
      (isTutorialCompleted as jest.Mock).mockReturnValue(false);
      (markTutorialCompleted as jest.Mock).mockClear();

      const onComplete2 = jest.fn();

      let tree2!: ReturnType<typeof create>;
      act(() => {
        tree2 = create(
          <TutorialOverlay gameId="sic-bo" steps={steps} onComplete={onComplete2} />
        );
      });

      // Tutorial should show again because storage never persisted completion
      const texts = tree2.root.findAllByType(Text).map((node) => node.props.children);
      expect(texts).toContain('Tutorial');
    });

    it('hides tutorial when forceShow is false and storage returns completed', () => {
      (isTutorialCompleted as jest.Mock).mockReturnValue(true);

      const onComplete = jest.fn();
      const steps = [{ title: 'Should Not Show', description: 'Hidden' }];

      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <TutorialOverlay
            gameId="completed-game"
            steps={steps}
            onComplete={onComplete}
            forceShow={false}
          />
        );
      });

      // Component returns null when tutorial is completed
      expect(tree.toJSON()).toBeNull();
    });

    it('forceShow bypasses storage check', () => {
      // Even if storage says completed, forceShow overrides
      (isTutorialCompleted as jest.Mock).mockReturnValue(true);

      const onComplete = jest.fn();
      const steps = [{ title: 'Forced', description: 'Must show' }];

      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <TutorialOverlay gameId="force-test" steps={steps} onComplete={onComplete} forceShow />
        );
      });

      // Should be visible despite storage saying completed
      const texts = tree.root.findAllByType(Text).map((node) => node.props.children);
      expect(texts).toContain('Forced');
    });

    it('empty steps array returns null', () => {
      (isTutorialCompleted as jest.Mock).mockReturnValue(false);

      const onComplete = jest.fn();

      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(
          <TutorialOverlay gameId="empty" steps={[]} onComplete={onComplete} forceShow />
        );
      });

      expect(tree.toJSON()).toBeNull();
    });
  });
});
