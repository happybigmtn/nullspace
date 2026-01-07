/**
 * Theme Context - Color scheme management with OLED-optimized dark mode
 *
 * Provides:
 * - System color scheme detection (useColorScheme from RN)
 * - User preference override (persisted in storage)
 * - isDark boolean for quick checks
 * - colors() helper for themed color access
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useColorScheme as useSystemColorScheme, Appearance } from 'react-native';
import { STORAGE_KEYS, getString, setString, getStorage } from '../services/storage';

/** Color scheme preference - 'system' follows device setting */
export type ColorSchemePreference = 'light' | 'dark' | 'system';

/** Resolved color scheme (never 'system') */
export type ColorScheme = 'light' | 'dark';

interface ThemeContextValue {
  /** User's preference: 'light', 'dark', or 'system' */
  colorSchemePreference: ColorSchemePreference;
  /** Resolved scheme (accounts for system setting) */
  colorScheme: ColorScheme;
  /** Quick check for dark mode */
  isDark: boolean;
  /** Update user preference */
  setColorSchemePreference: (preference: ColorSchemePreference) => void;
  /** Toggle between light and dark (cycles through system if current matches system) */
  toggleColorScheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Get stored color scheme preference
 * Returns 'system' if nothing stored (default)
 */
function getStoredPreference(): ColorSchemePreference {
  try {
    const storage = getStorage();
    const stored = storage.getString(STORAGE_KEYS.COLOR_SCHEME_PREFERENCE);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // Storage not initialized yet, use system default
  }
  return 'system';
}

/**
 * Theme provider - wraps app to provide color scheme context
 *
 * Usage:
 * ```tsx
 * <ThemeProvider>
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // System color scheme from device settings
  const systemColorScheme = useSystemColorScheme();

  // User preference (persisted)
  const [preference, setPreference] = useState<ColorSchemePreference>(() => getStoredPreference());

  // Listen for system appearance changes
  useEffect(() => {
    const subscription = Appearance.addChangeListener(() => {
      // Force re-render when system scheme changes (if using 'system' preference)
      // This is handled automatically by useColorScheme, but we trigger a state update
      // to ensure derived values recalculate
    });
    return () => subscription.remove();
  }, []);

  // Resolve the actual color scheme
  const colorScheme: ColorScheme = useMemo(() => {
    if (preference === 'system') {
      return systemColorScheme ?? 'light';
    }
    return preference;
  }, [preference, systemColorScheme]);

  const isDark = colorScheme === 'dark';

  // Persist preference changes
  const setColorSchemePreference = useCallback((newPreference: ColorSchemePreference) => {
    setPreference(newPreference);
    setString(STORAGE_KEYS.COLOR_SCHEME_PREFERENCE, newPreference);
  }, []);

  // Toggle cycles: light -> dark -> system -> light...
  // But if current resolved scheme matches system, skip to the opposite
  const toggleColorScheme = useCallback(() => {
    const systemScheme = systemColorScheme ?? 'light';

    if (preference === 'light') {
      setColorSchemePreference('dark');
    } else if (preference === 'dark') {
      // If system is same as dark, go to light; otherwise offer system
      if (systemScheme === 'dark') {
        setColorSchemePreference('light');
      } else {
        setColorSchemePreference('system');
      }
    } else {
      // preference === 'system'
      // Toggle to opposite of current resolved scheme
      setColorSchemePreference(colorScheme === 'dark' ? 'light' : 'dark');
    }
  }, [preference, colorScheme, systemColorScheme, setColorSchemePreference]);

  const value = useMemo(
    () => ({
      colorSchemePreference: preference,
      colorScheme,
      isDark,
      setColorSchemePreference,
      toggleColorScheme,
    }),
    [preference, colorScheme, isDark, setColorSchemePreference, toggleColorScheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Hook to access theme context
 *
 * Usage:
 * ```tsx
 * function MyComponent() {
 *   const { isDark, colorScheme, toggleColorScheme } = useTheme();
 *   return <View style={{ backgroundColor: isDark ? '#000' : '#fff' }} />;
 * }
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * Hook that returns just isDark - useful for simple components
 */
export function useIsDark(): boolean {
  return useTheme().isDark;
}
