/**
 * Tests for ThemeContext - Dark mode implementation
 */
import React from 'react';
import { act, create } from 'react-test-renderer';

// Mock storage before importing ThemeContext
const mockStorage = {
  STORAGE_KEYS: { COLOR_SCHEME_PREFERENCE: 'theme.color_scheme' },
  getString: jest.fn(() => ''),
  setString: jest.fn(),
  getStorage: jest.fn(() => ({
    getString: jest.fn(() => undefined),
    set: jest.fn(),
  })),
};

jest.mock('../../services/storage', () => mockStorage);

// Mock only useColorScheme hook, not entire react-native
let mockColorScheme: 'light' | 'dark' | null = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(() => mockColorScheme),
}));

// Mock Appearance
jest.mock('react-native/Libraries/Utilities/Appearance', () => ({
  addChangeListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const { ThemeProvider, useTheme, useIsDark } = require('../ThemeContext');

describe('ThemeContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockColorScheme = 'light';
  });

  describe('useTheme hook', () => {
    it('provides theme context with default values', () => {
      let ctx: ReturnType<typeof useTheme> | null = null;
      const Consumer = () => {
        ctx = useTheme();
        return null;
      };

      act(() => {
        create(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      expect(ctx!.colorSchemePreference).toBe('system');
      expect(ctx!.colorScheme).toBe('light');
      expect(ctx!.isDark).toBe(false);
    });

    it('respects system dark mode when preference is system', () => {
      mockColorScheme = 'dark';

      let ctx: ReturnType<typeof useTheme> | null = null;
      const Consumer = () => {
        ctx = useTheme();
        return null;
      };

      act(() => {
        create(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      expect(ctx!.colorSchemePreference).toBe('system');
      expect(ctx!.colorScheme).toBe('dark');
      expect(ctx!.isDark).toBe(true);
    });

    it('allows setting explicit dark preference', () => {
      let ctx: ReturnType<typeof useTheme> | null = null;
      const Consumer = () => {
        ctx = useTheme();
        return null;
      };

      act(() => {
        create(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      // Set dark preference
      act(() => {
        ctx!.setColorSchemePreference('dark');
      });

      expect(ctx!.colorSchemePreference).toBe('dark');
      expect(ctx!.colorScheme).toBe('dark');
      expect(ctx!.isDark).toBe(true);
    });

    it('persists preference to storage', () => {
      let ctx: ReturnType<typeof useTheme> | null = null;
      const Consumer = () => {
        ctx = useTheme();
        return null;
      };

      act(() => {
        create(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      act(() => {
        ctx!.setColorSchemePreference('dark');
      });

      expect(mockStorage.setString).toHaveBeenCalledWith('theme.color_scheme', 'dark');
    });

    it('toggleColorScheme toggles between light and dark', () => {
      let ctx: ReturnType<typeof useTheme> | null = null;
      const Consumer = () => {
        ctx = useTheme();
        return null;
      };

      act(() => {
        create(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      // Start at system (light)
      expect(ctx!.colorScheme).toBe('light');

      // Toggle -> dark
      act(() => {
        ctx!.toggleColorScheme();
      });
      expect(ctx!.colorScheme).toBe('dark');
    });
  });

  describe('useIsDark hook', () => {
    it('returns false for light mode', () => {
      let isDark: boolean | null = null;
      const Consumer = () => {
        isDark = useIsDark();
        return null;
      };

      act(() => {
        create(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      expect(isDark).toBe(false);
    });

    it('returns true for dark mode', () => {
      mockColorScheme = 'dark';

      let isDark: boolean | null = null;
      const Consumer = () => {
        isDark = useIsDark();
        return null;
      };

      act(() => {
        create(
          <ThemeProvider>
            <Consumer />
          </ThemeProvider>
        );
      });

      expect(isDark).toBe(true);
    });
  });

  describe('error handling', () => {
    it('handles error when useTheme is used outside provider', () => {
      // React 19 catches errors and logs them rather than throwing synchronously
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const Consumer = () => {
        useTheme();
        return null;
      };

      // The render should not succeed normally - React 19 catches and logs the error
      create(<Consumer />);

      // Verify console.error or console.warn was called (error was caught)
      const errorOrWarnCalled = consoleSpy.mock.calls.length > 0 || warnSpy.mock.calls.length > 0;
      expect(errorOrWarnCalled).toBe(true);

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});
