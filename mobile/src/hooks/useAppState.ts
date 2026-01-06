/**
 * useAppState - App lifecycle state persistence hook
 *
 * Listens to React Native AppState changes and persists/restores
 * game state to/from MMKV storage when app goes to background/foreground.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useGameStore } from '../stores/gameStore';
import { getStorage, initializeStorage, STORAGE_KEYS } from '../services/storage';
import type { ChipValue } from '../types';

const VALID_CHIP_VALUES: ChipValue[] = [1, 5, 25, 100, 500, 1000];

function isValidChipValue(value: number): value is ChipValue {
  return VALID_CHIP_VALUES.includes(value as ChipValue);
}

/**
 * Persist current game state to MMKV storage
 */
function persistGameState(): void {
  try {
    const storage = getStorage();
    const { balance, selectedChip } = useGameStore.getState();

    storage.set(STORAGE_KEYS.CACHED_BALANCE, balance);
    storage.set(STORAGE_KEYS.SELECTED_CHIP, selectedChip);
    storage.set(STORAGE_KEYS.LAST_SYNC, Date.now());
  } catch (error) {
    // Storage may not be initialized yet, silently fail
    if (__DEV__) {
      console.warn('[useAppState] Failed to persist game state:', error);
    }
  }
}

/**
 * Restore game state from MMKV storage
 */
function restoreGameState(): void {
  try {
    const storage = getStorage();
    const { setBalance, setSelectedChip } = useGameStore.getState();

    // Restore balance if cached
    const cachedBalance = storage.getNumber(STORAGE_KEYS.CACHED_BALANCE);
    if (cachedBalance !== undefined && cachedBalance > 0) {
      setBalance(cachedBalance);
    }

    // Restore selected chip if cached
    const cachedChip = storage.getNumber(STORAGE_KEYS.SELECTED_CHIP);
    if (cachedChip !== undefined && isValidChipValue(cachedChip)) {
      setSelectedChip(cachedChip);
    }
  } catch (error) {
    // Storage may not be initialized yet, silently fail
    if (__DEV__) {
      console.warn('[useAppState] Failed to restore game state:', error);
    }
  }
}

/**
 * Hook to handle app state changes and persist/restore game state
 *
 * Usage:
 * ```tsx
 * function App() {
 *   useAppState();
 *   return <RootNavigator />;
 * }
 * ```
 */
export function useAppState(): void {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    let mounted = true;

    const setup = async () => {
      try {
        await initializeStorage();
        if (!mounted) return;

        // Restore state on initial mount
        restoreGameState();

        subscription = AppState.addEventListener('change', (nextAppState) => {
          const previousState = appStateRef.current;

          // App going to background - persist state
          if (
            previousState === 'active' &&
            (nextAppState === 'background' || nextAppState === 'inactive')
          ) {
            persistGameState();
          }

          // App returning to foreground - restore state
          if (
            (previousState === 'background' || previousState === 'inactive') &&
            nextAppState === 'active'
          ) {
            restoreGameState();
          }

          appStateRef.current = nextAppState;
        });
      } catch (error) {
        if (__DEV__) {
          console.warn('[useAppState] Failed to initialize storage:', error);
        }
      }
    };

    void setup();

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, []);
}
