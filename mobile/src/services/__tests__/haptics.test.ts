const mockImpactAsync = jest.fn();
const mockNotificationAsync = jest.fn();
const mockSelectionAsync = jest.fn();

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: {
    Light: 'Light',
    Medium: 'Medium',
    Heavy: 'Heavy',
  },
  NotificationFeedbackType: {
    Success: 'Success',
    Warning: 'Warning',
    Error: 'Error',
  },
  impactAsync: (...args: unknown[]) => Promise.resolve(mockImpactAsync(...args)),
  notificationAsync: (...args: unknown[]) => Promise.resolve(mockNotificationAsync(...args)),
  selectionAsync: (...args: unknown[]) => Promise.resolve(mockSelectionAsync(...args)),
}));

describe('haptics service', () => {
  beforeEach(() => {
    mockImpactAsync.mockClear();
    mockNotificationAsync.mockClear();
    mockSelectionAsync.mockClear();
    jest.resetModules();
  });

  it('triggers impacts when enabled on native', async () => {
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { haptics } = require('../haptics');

    await haptics.chipPlace();
    await haptics.betConfirm();
    await haptics.selectionChange();

    expect(mockImpactAsync).toHaveBeenCalled();
    expect(mockSelectionAsync).toHaveBeenCalled();
  });

  it('skips haptics when disabled or on web', async () => {
    jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
    const { haptics } = require('../haptics');

    await haptics.win();
    expect(mockNotificationAsync).not.toHaveBeenCalled();

    haptics.setEnabled(false);
    await haptics.loss();
    expect(mockNotificationAsync).not.toHaveBeenCalled();
  });

  it('runs jackpot pattern and cleanup stops scheduled haptics', async () => {
    jest.useFakeTimers();
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { haptics } = require('../haptics');

    await haptics.jackpot();
    expect(mockImpactAsync).toHaveBeenCalledWith('Heavy');

    // Extended jackpot pattern: Heavy x3 at 0ms, 100ms, 200ms
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(3);

    // Success notification at 350ms
    jest.advanceTimersByTime(150);
    await Promise.resolve();
    expect(mockNotificationAsync).toHaveBeenCalledWith('Success');

    // Reset and test cleanup stops remaining scheduled haptics
    await haptics.jackpot();
    haptics.cleanup();
    jest.advanceTimersByTime(700);
    await Promise.resolve();
    // After cleanup, no additional haptics should fire (only 4 from initial + restart heavy)
    expect(mockImpactAsync).toHaveBeenCalledTimes(4);

    jest.useRealTimers();
  });

  it('handles push, error, and button feedback when enabled', async () => {
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { haptics } = require('../haptics');

    await haptics.push();
    await haptics.error();
    await haptics.buttonPress();

    expect(mockNotificationAsync).toHaveBeenCalledWith('Warning');
    expect(mockNotificationAsync).toHaveBeenCalledWith('Error');
    expect(mockImpactAsync).toHaveBeenCalledWith('Light');
    expect(haptics.isEnabled()).toBe(true);
  });

  it('runs sequentialBets with rapid light taps', async () => {
    jest.useFakeTimers();
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { haptics } = require('../haptics');

    await haptics.sequentialBets(3);
    expect(mockImpactAsync).toHaveBeenCalledWith('Light');
    expect(mockImpactAsync).toHaveBeenCalledTimes(1);

    // Second tap at 60ms
    jest.advanceTimersByTime(60);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(2);

    // Third tap at 120ms
    jest.advanceTimersByTime(60);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(3);

    jest.useRealTimers();
  });

  it('runs sequentialBets with custom count', async () => {
    jest.useFakeTimers();
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { haptics } = require('../haptics');

    await haptics.sequentialBets(5);
    // Run all timers to completion
    jest.advanceTimersByTime(300);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(5);
    // All should be Light
    expect(mockImpactAsync).toHaveBeenLastCalledWith('Light');

    jest.useRealTimers();
  });

  it('runs spinStart with ascending intensity', async () => {
    jest.useFakeTimers();
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { haptics } = require('../haptics');

    await haptics.spinStart();
    expect(mockImpactAsync).toHaveBeenCalledWith('Light');

    jest.advanceTimersByTime(80);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(2);
    expect(mockImpactAsync).toHaveBeenLastCalledWith('Light');

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(3);
    expect(mockImpactAsync).toHaveBeenLastCalledWith('Medium');

    jest.advanceTimersByTime(120);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(4);
    expect(mockImpactAsync).toHaveBeenLastCalledWith('Medium');

    jest.useRealTimers();
  });

  it('runs spinEnd with descending intensity and heavy landing', async () => {
    jest.useFakeTimers();
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { haptics } = require('../haptics');

    await haptics.spinEnd();
    expect(mockImpactAsync).toHaveBeenCalledWith('Medium');

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(2);
    expect(mockImpactAsync).toHaveBeenLastCalledWith('Medium');

    jest.advanceTimersByTime(120);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(3);
    expect(mockImpactAsync).toHaveBeenLastCalledWith('Light');

    // Heavy landing at 380ms
    jest.advanceTimersByTime(160);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(4);
    expect(mockImpactAsync).toHaveBeenLastCalledWith('Heavy');

    jest.useRealTimers();
  });

  it('runs dealerAction with double medium tap', async () => {
    jest.useFakeTimers();
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { haptics } = require('../haptics');

    await haptics.dealerAction();
    expect(mockImpactAsync).toHaveBeenCalledWith('Medium');
    expect(mockImpactAsync).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(80);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(2);
    expect(mockImpactAsync).toHaveBeenLastCalledWith('Medium');

    jest.useRealTimers();
  });

  it('runs roundStart with ascending pattern and success flourish', async () => {
    jest.useFakeTimers();
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { haptics } = require('../haptics');

    await haptics.roundStart();
    expect(mockImpactAsync).toHaveBeenCalledWith('Light');

    jest.advanceTimersByTime(100);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(2);
    expect(mockImpactAsync).toHaveBeenLastCalledWith('Light');

    jest.advanceTimersByTime(120);
    await Promise.resolve();
    expect(mockImpactAsync).toHaveBeenCalledTimes(3);
    expect(mockImpactAsync).toHaveBeenLastCalledWith('Medium');

    // Success notification flourish at 380ms
    jest.advanceTimersByTime(160);
    await Promise.resolve();
    expect(mockNotificationAsync).toHaveBeenCalledWith('Success');

    jest.useRealTimers();
  });

  it('runs allInBet with single heavy tap', async () => {
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { haptics } = require('../haptics');

    await haptics.allInBet();
    expect(mockImpactAsync).toHaveBeenCalledWith('Heavy');
    expect(mockImpactAsync).toHaveBeenCalledTimes(1);
  });

  it('cancels in-flight patterns when new pattern starts', async () => {
    jest.useFakeTimers();
    jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    const { haptics } = require('../haptics');

    // Start spinStart
    await haptics.spinStart();
    expect(mockImpactAsync).toHaveBeenCalledTimes(1);

    // Immediately start spinEnd (should cancel spinStart's scheduled haptics)
    await haptics.spinEnd();
    expect(mockImpactAsync).toHaveBeenCalledTimes(2); // Initial spinStart + initial spinEnd

    // Advance past all spinStart scheduled times
    jest.advanceTimersByTime(400);
    await Promise.resolve();

    // Only spinEnd pattern should have completed (4 taps total from spinEnd)
    // spinStart taps at 80, 180, 300ms should have been cancelled
    expect(mockImpactAsync).toHaveBeenCalledTimes(5); // 2 + 3 more from spinEnd

    jest.useRealTimers();
  });
});
