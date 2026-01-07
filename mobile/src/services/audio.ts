/**
 * Audio service for game sound effects
 *
 * US-136: Sound design service skeleton
 * US-143: Implement mobile audio system with expo-av
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
 */
import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import { getBoolean, setBoolean, getObject, setObject, STORAGE_KEYS } from './storage';

/**
 * Sound category for organizing audio assets
 */
export type SoundCategory = 'ui' | 'game' | 'celebration' | 'error';

/**
 * Sound IDs for game audio
 * Maps to asset files in mobile/assets/sounds/
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
  /** Asset require path - undefined if sound not available yet */
  asset?: ReturnType<typeof require>;
}

/**
 * Sound definitions with category and default volume
 * Assets will be added as sound files become available
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

/** Storage key for detailed audio settings */
const AUDIO_SETTINGS_KEY = 'settings.audio_settings';

/**
 * Loaded sound instance with metadata
 */
interface LoadedSound {
  sound: Audio.Sound;
  loaded: boolean;
}

/**
 * AudioService - Centralized audio playback service
 *
 * Provides consistent audio feedback across game interactions.
 * Audio is disabled by default and controlled via settings.
 *
 * Features:
 * - Preloads sounds at app startup for instant playback
 * - Gracefully handles missing sound files
 * - Persists user audio preferences
 * - Category-based volume control
 */
export class AudioService {
  private settings: AudioSettings = DEFAULT_AUDIO_SETTINGS;
  private loadedSounds: Map<SoundId, LoadedSound> = new Map();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize audio system and preload sounds
   * Call this during app startup (from splash screen)
   */
  async initialize(): Promise<void> {
    // Prevent multiple concurrent initializations
    if (this.initPromise) {
      return this.initPromise;
    }

    if (this.isInitialized) {
      return;
    }

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      // Configure audio mode for game sounds
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: false, // Respect iOS silent switch
        staysActiveInBackground: false, // Don't play when backgrounded
        shouldDuckAndroid: true, // Lower other app volume
      });

      // Load settings from storage
      await this.loadSettings();

      // Preload all sounds that have assets defined
      await this.preloadSounds();

      this.isInitialized = true;
      if (__DEV__) {
        console.log('[Audio] Initialized successfully');
      }
    } catch (error) {
      console.warn('[Audio] Initialization failed:', error);
      this.isInitialized = true; // Mark as initialized to prevent retries
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Load settings from persistent storage
   */
  private async loadSettings(): Promise<void> {
    try {
      // First check the simple enabled toggle
      const enabled = getBoolean(STORAGE_KEYS.SOUND_ENABLED, false);

      // Then load detailed settings if available
      const savedSettings = getObject<Partial<AudioSettings>>(AUDIO_SETTINGS_KEY, {});

      this.settings = {
        ...DEFAULT_AUDIO_SETTINGS,
        ...savedSettings,
        enabled, // Simple toggle takes precedence
      };
    } catch (error) {
      console.warn('[Audio] Failed to load settings:', error);
      this.settings = DEFAULT_AUDIO_SETTINGS;
    }
  }

  /**
   * Save settings to persistent storage
   */
  private saveSettings(): void {
    try {
      // Save simple toggle for quick access
      setBoolean(STORAGE_KEYS.SOUND_ENABLED, this.settings.enabled);

      // Save full settings object
      setObject(AUDIO_SETTINGS_KEY, this.settings);
    } catch (error) {
      console.warn('[Audio] Failed to save settings:', error);
    }
  }

  /**
   * Preload all sounds that have assets defined
   */
  private async preloadSounds(): Promise<void> {
    const loadPromises: Promise<void>[] = [];

    for (const [soundId, config] of Object.entries(SOUND_DEFINITIONS) as [SoundId, SoundConfig][]) {
      if (config.asset) {
        loadPromises.push(this.loadSound(soundId, config.asset));
      }
    }

    // Load sounds in parallel, failures are logged but don't block
    await Promise.allSettled(loadPromises);
  }

  /**
   * Load a single sound asset
   */
  private async loadSound(soundId: SoundId, asset: ReturnType<typeof require>): Promise<void> {
    try {
      const { sound } = await Audio.Sound.createAsync(asset, { shouldPlay: false });
      this.loadedSounds.set(soundId, { sound, loaded: true });
      if (__DEV__) {
        console.log(`[Audio] Loaded: ${soundId}`);
      }
    } catch (error) {
      console.warn(`[Audio] Failed to load ${soundId}:`, error);
      // Store as not loaded so we don't retry
      this.loadedSounds.set(soundId, { sound: null as unknown as Audio.Sound, loaded: false });
    }
  }

  /**
   * Check if audio can be played
   */
  private canPlay(): boolean {
    return this.settings.enabled && Platform.OS !== 'web';
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

    const loadedSound = this.loadedSounds.get(soundId);

    // If sound isn't loaded or failed to load, log and return
    if (!loadedSound?.loaded) {
      if (__DEV__) {
        console.debug(`[Audio] Sound not available: ${soundId}`);
      }
      return;
    }

    try {
      const volume = this.getVolume(soundId);

      // Set volume and reset to start
      await loadedSound.sound.setStatusAsync({
        volume,
        positionMillis: 0,
        shouldPlay: true,
      });
    } catch (error) {
      // Sound playback failures are non-critical
      if (__DEV__) {
        console.warn(`[Audio] Playback failed for ${soundId}:`, error);
      }
    }
  }

  /**
   * Stop all currently playing sounds
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [, loadedSound] of this.loadedSounds) {
      if (loadedSound.loaded) {
        stopPromises.push(
          loadedSound.sound.stopAsync().then(() => {
            // Success, nothing to return
          }).catch(() => {
            // Ignore stop errors
          })
        );
      }
    }

    await Promise.allSettled(stopPromises);
  }

  /**
   * Cleanup and unload all sounds
   * Call when app is terminating or audio is no longer needed
   */
  async cleanup(): Promise<void> {
    for (const [, loadedSound] of this.loadedSounds) {
      if (loadedSound.loaded) {
        try {
          await loadedSound.sound.unloadAsync();
        } catch {
          // Ignore unload errors
        }
      }
    }
    this.loadedSounds.clear();
    this.isInitialized = false;
  }

  /**
   * Update audio settings
   */
  setSettings(settings: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.saveSettings();
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
    this.saveSettings();
  }

  /**
   * Check if audio is enabled
   */
  isEnabled(): boolean {
    return this.settings.enabled;
  }

  /**
   * Toggle audio enabled state
   * @returns The new enabled state
   */
  toggle(): boolean {
    const newState = !this.settings.enabled;
    this.setEnabled(newState);
    return newState;
  }

  /**
   * Set master volume
   * @param volume 0.0 to 1.0
   */
  setMasterVolume(volume: number): void {
    this.settings.masterVolume = Math.max(0, Math.min(1, volume));
    this.saveSettings();
  }

  /**
   * Set category volume
   * @param category The sound category
   * @param volume 0.0 to 1.0
   */
  setCategoryVolume(category: SoundCategory, volume: number): void {
    this.settings.categoryVolumes[category] = Math.max(0, Math.min(1, volume));
    this.saveSettings();
  }

  /**
   * Check if audio system is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
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
