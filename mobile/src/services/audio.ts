/**
 * Audio service skeleton for game sound effects
 *
 * US-136: Sound design service skeleton
 *
 * Mirrors the haptics.ts structure to provide consistent audio feedback
 * across all game interactions. Audio is disabled by default and requires
 * explicit user opt-in via settings.
 *
 * Sound Categories:
 * - UI: Interface interactions (buttons, navigation)
 * - Game: In-game actions (card deals, chip placement, dice rolls)
 * - Celebration: Win effects (win, big win, jackpot)
 * - Error: Negative feedback (loss, error, invalid action)
 *
 * Future implementation will use expo-av for audio playback.
 * This skeleton defines the API contract for consistent integration.
 */

/**
 * Sound category for organizing audio assets
 */
export type SoundCategory = 'ui' | 'game' | 'celebration' | 'error';

/**
 * Sound IDs for game audio
 * Maps to asset files when implemented
 */
export type SoundId =
  // UI sounds
  | 'buttonPress'
  | 'navigation'
  | 'toggleOn'
  | 'toggleOff'
  | 'modalOpen'
  | 'modalClose'
  // Game sounds
  | 'chipPlace'
  | 'chipStack'
  | 'cardDeal'
  | 'cardFlip'
  | 'diceRoll'
  | 'wheelSpin'
  | 'wheelStop'
  | 'dealerSpeak'
  // Celebration sounds
  | 'win'
  | 'bigWin'
  | 'jackpot'
  | 'push'
  // Error sounds
  | 'loss'
  | 'error'
  | 'invalidAction';

/**
 * Sound configuration for each sound ID
 */
interface SoundConfig {
  category: SoundCategory;
  volume: number; // 0.0 - 1.0
  /** Optional: multiple variants for variety (randomly selected) */
  variants?: number;
}

/**
 * Sound definitions with category and default volume
 */
const SOUND_DEFINITIONS: Record<SoundId, SoundConfig> = {
  // UI sounds - subtle, non-intrusive
  buttonPress: { category: 'ui', volume: 0.3 },
  navigation: { category: 'ui', volume: 0.2 },
  toggleOn: { category: 'ui', volume: 0.3 },
  toggleOff: { category: 'ui', volume: 0.25 },
  modalOpen: { category: 'ui', volume: 0.3 },
  modalClose: { category: 'ui', volume: 0.25 },

  // Game sounds - medium presence
  chipPlace: { category: 'game', volume: 0.5, variants: 3 },
  chipStack: { category: 'game', volume: 0.45, variants: 2 },
  cardDeal: { category: 'game', volume: 0.5, variants: 3 },
  cardFlip: { category: 'game', volume: 0.55 },
  diceRoll: { category: 'game', volume: 0.6, variants: 2 },
  wheelSpin: { category: 'game', volume: 0.5 },
  wheelStop: { category: 'game', volume: 0.6 },
  dealerSpeak: { category: 'game', volume: 0.7 },

  // Celebration sounds - prominent
  win: { category: 'celebration', volume: 0.7 },
  bigWin: { category: 'celebration', volume: 0.8 },
  jackpot: { category: 'celebration', volume: 0.9 },
  push: { category: 'celebration', volume: 0.5 },

  // Error sounds - attention-getting but not jarring
  loss: { category: 'error', volume: 0.5 },
  error: { category: 'error', volume: 0.6 },
  invalidAction: { category: 'error', volume: 0.4 },
};

/**
 * Audio settings for user preferences
 */
export interface AudioSettings {
  /** Master audio enabled/disabled */
  enabled: boolean;
  /** Master volume (0.0 - 1.0) */
  masterVolume: number;
  /** Per-category volume overrides */
  categoryVolumes: Record<SoundCategory, number>;
}

/**
 * Default audio settings - disabled by default
 */
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  enabled: false, // Disabled by default, user must opt-in
  masterVolume: 0.7,
  categoryVolumes: {
    ui: 0.6,
    game: 0.8,
    celebration: 0.9,
    error: 0.7,
  },
};

/**
 * AudioService - Centralized audio playback service
 *
 * Provides consistent audio feedback across game interactions.
 * Audio is disabled by default and controlled via settings.
 */
export class AudioService {
  private settings: AudioSettings = DEFAULT_AUDIO_SETTINGS;

  /**
   * Check if audio can be played
   */
  private canPlay(): boolean {
    return this.settings.enabled;
  }

  /**
   * Get effective volume for a sound
   */
  private getVolume(soundId: SoundId): number {
    const config = SOUND_DEFINITIONS[soundId];
    if (!config) return 0;

    return (
      config.volume *
      this.settings.masterVolume *
      this.settings.categoryVolumes[config.category]
    );
  }

  /**
   * Play a sound by ID
   * @param soundId The sound to play
   * @returns Promise that resolves when sound starts playing
   */
  async play(soundId: SoundId): Promise<void> {
    if (!this.canPlay()) return;

    const _volume = this.getVolume(soundId);
    const config = SOUND_DEFINITIONS[soundId];

    // TODO: Implement actual audio playback with expo-av
    // For now, this is a no-op skeleton
    console.debug(`[Audio] Would play: ${soundId} (volume: ${_volume.toFixed(2)}, category: ${config?.category})`);
  }

  /**
   * Stop all currently playing sounds
   */
  async stopAll(): Promise<void> {
    // TODO: Implement with expo-av
    console.debug('[Audio] Would stop all sounds');
  }

  /**
   * Update audio settings
   */
  setSettings(settings: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * Get current audio settings
   */
  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  /**
   * Enable/disable audio
   */
  setEnabled(enabled: boolean): void {
    this.settings.enabled = enabled;
  }

  /**
   * Check if audio is enabled
   */
  isEnabled(): boolean {
    return this.settings.enabled;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Convenience methods mirroring haptics.ts API
  // ─────────────────────────────────────────────────────────────────────────────

  /** UI: Button press feedback */
  async buttonPress(): Promise<void> {
    await this.play('buttonPress');
  }

  /** UI: Navigation sound */
  async navigation(): Promise<void> {
    await this.play('navigation');
  }

  /** UI: Toggle on */
  async toggleOn(): Promise<void> {
    await this.play('toggleOn');
  }

  /** UI: Toggle off */
  async toggleOff(): Promise<void> {
    await this.play('toggleOff');
  }

  /** UI: Modal open */
  async modalOpen(): Promise<void> {
    await this.play('modalOpen');
  }

  /** UI: Modal close */
  async modalClose(): Promise<void> {
    await this.play('modalClose');
  }

  /** Game: Chip placement */
  async chipPlace(): Promise<void> {
    await this.play('chipPlace');
  }

  /** Game: Chip stack sound */
  async chipStack(): Promise<void> {
    await this.play('chipStack');
  }

  /** Game: Card deal */
  async cardDeal(): Promise<void> {
    await this.play('cardDeal');
  }

  /** Game: Card flip */
  async cardFlip(): Promise<void> {
    await this.play('cardFlip');
  }

  /** Game: Dice roll */
  async diceRoll(): Promise<void> {
    await this.play('diceRoll');
  }

  /** Game: Wheel spin start */
  async wheelSpin(): Promise<void> {
    await this.play('wheelSpin');
  }

  /** Game: Wheel spin stop */
  async wheelStop(): Promise<void> {
    await this.play('wheelStop');
  }

  /** Game: Dealer voice line */
  async dealerSpeak(): Promise<void> {
    await this.play('dealerSpeak');
  }

  /** Celebration: Standard win */
  async win(): Promise<void> {
    await this.play('win');
  }

  /** Celebration: Big win (3x+) */
  async bigWin(): Promise<void> {
    await this.play('bigWin');
  }

  /** Celebration: Jackpot */
  async jackpot(): Promise<void> {
    await this.play('jackpot');
  }

  /** Celebration: Push/tie result */
  async push(): Promise<void> {
    await this.play('push');
  }

  /** Error: Loss result */
  async loss(): Promise<void> {
    await this.play('loss');
  }

  /** Error: General error */
  async error(): Promise<void> {
    await this.play('error');
  }

  /** Error: Invalid action attempted */
  async invalidAction(): Promise<void> {
    await this.play('invalidAction');
  }
}

/**
 * Global audio service instance
 */
export const audio = new AudioService();
