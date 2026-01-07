/**
 * Centralized haptic feedback service
 * Provides consistent tactile response across all game interactions
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export class HapticsService {
  private enabled = true;
  private abortController: AbortController | null = null;

  /**
   * Check if haptics can be triggered
   */
  private canVibrate(): boolean {
    return this.enabled && Platform.OS !== 'web';
  }

  /**
   * Schedule a haptic with abort support for cleanup
   */
  private scheduleHaptic(
    fn: () => Promise<void>,
    delayMs: number,
    signal: AbortSignal
  ): void {
    const timeoutId = setTimeout(() => {
      if (!signal.aborted) {
        fn().catch(() => {
          // Haptic failure is non-critical, silently ignore
        });
      }
    }, delayMs);

    signal.addEventListener('abort', () => clearTimeout(timeoutId), { once: true });
  }

  /**
   * Light haptic for chip selection/placement
   */
  async chipPlace(): Promise<void> {
    if (!this.canVibrate()) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  /**
   * Medium haptic for bet confirmation
   */
  async betConfirm(): Promise<void> {
    if (!this.canVibrate()) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  /**
   * Light haptic for card deals
   */
  async cardDeal(): Promise<void> {
    if (!this.canVibrate()) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  /**
   * Light haptic for dice roll
   */
  async diceRoll(): Promise<void> {
    if (!this.canVibrate()) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  /**
   * Light haptic for wheel spin
   */
  async wheelSpin(): Promise<void> {
    if (!this.canVibrate()) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  /**
   * Success notification for wins
   */
  async win(): Promise<void> {
    if (!this.canVibrate()) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  /**
   * Error notification for losses
   */
  async loss(): Promise<void> {
    if (!this.canVibrate()) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }

  /**
   * Error notification for invalid actions (e.g., insufficient balance)
   */
  async error(): Promise<void> {
    if (!this.canVibrate()) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }

  /**
   * Celebratory pattern for jackpots - extended multi-burst
   */
  async jackpot(): Promise<void> {
    if (!this.canVibrate()) return;

    // Cancel any in-flight pattern
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Extended celebratory pattern: Heavy x3 → Success → Medium burst
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
      100,
      signal
    );
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
      200,
      signal
    );
    this.scheduleHaptic(
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      350,
      signal
    );
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
      500,
      signal
    );
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
      600,
      signal
    );
  }

  /**
   * Big win pattern - strong celebration for significant wins (3x+)
   */
  async bigWin(): Promise<void> {
    if (!this.canVibrate()) return;

    // Cancel any in-flight pattern
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Ascending intensity: Medium → Heavy → Success
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
      120,
      signal
    );
    this.scheduleHaptic(
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      280,
      signal
    );
  }

  /**
   * Warning haptic for push/tie results
   */
  async push(): Promise<void> {
    if (!this.canVibrate()) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }

  /**
   * Button press feedback
   */
  async buttonPress(): Promise<void> {
    if (!this.canVibrate()) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  /**
   * Selection change feedback
   */
  async selectionChange(): Promise<void> {
    if (!this.canVibrate()) return;
    await Haptics.selectionAsync();
  }

  /**
   * Sequential bets - rapid light taps as chips are placed
   * Use for bulk chip placement or bet building
   * @param count Number of taps (default 3)
   */
  async sequentialBets(count = 3): Promise<void> {
    if (!this.canVibrate()) return;

    // Cancel any in-flight pattern
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Rapid light taps at 60ms intervals for tactile feedback
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    for (let i = 1; i < count; i++) {
      this.scheduleHaptic(
        () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
        i * 60,
        signal
      );
    }
  }

  /**
   * Spin start - building intensity pattern for roulette/slot spins
   * Ascending: Light → Light → Medium → Medium
   */
  async spinStart(): Promise<void> {
    if (!this.canVibrate()) return;

    // Cancel any in-flight pattern
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Ascending intensity mimics spin acceleration
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      80,
      signal
    );
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
      180,
      signal
    );
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
      300,
      signal
    );
  }

  /**
   * Spin end - decelerating pattern as wheel/slot comes to rest
   * Descending: Medium → Medium → Light → Heavy (landing)
   */
  async spinEnd(): Promise<void> {
    if (!this.canVibrate()) return;

    // Cancel any in-flight pattern
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Decelerating pattern with heavy final "landing"
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
      100,
      signal
    );
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      220,
      signal
    );
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
      380,
      signal
    );
  }

  /**
   * Dealer action - subtle double-tap for dealer moves
   * Used when dealer draws cards, reveals, or takes action
   */
  async dealerAction(): Promise<void> {
    if (!this.canVibrate()) return;

    // Cancel any in-flight pattern
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Quick double-tap: medium intensity for authority
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
      80,
      signal
    );
  }

  /**
   * Round start - ascending pattern to signal new round beginning
   * Light → Light → Medium → Success notification
   */
  async roundStart(): Promise<void> {
    if (!this.canVibrate()) return;

    // Cancel any in-flight pattern
    this.abortController?.abort();
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Ascending pattern with notification flourish
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      100,
      signal
    );
    this.scheduleHaptic(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
      220,
      signal
    );
    this.scheduleHaptic(
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      380,
      signal
    );
  }

  /**
   * All-in bet - strong warning-style single tap
   * Signals high-stakes action, immediate feedback for gravity
   */
  async allInBet(): Promise<void> {
    if (!this.canVibrate()) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }

  /**
   * Enable or disable haptics
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if haptics are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Cleanup pending haptics (call on unmount)
   */
  cleanup(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}

export const haptics = new HapticsService();
