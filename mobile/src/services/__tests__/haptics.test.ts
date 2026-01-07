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
});
