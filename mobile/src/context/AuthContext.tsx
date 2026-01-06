/**
 * Authentication Context
 * Provides auth state to the app and guards protected routes
 *
 * Session Expiration:
 * - Sessions expire after 24 hours
 * - Checked on app launch and when returning from background
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  getBoolean,
  setBoolean,
  getNumber,
  setNumber,
  deleteKey,
  STORAGE_KEYS,
  initializeStorage,
} from '../services/storage';

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  sessionExpired: boolean;
  authenticate: () => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * Check if the session has expired based on creation timestamp
 */
function isSessionExpired(): boolean {
  const createdAt = getNumber(STORAGE_KEYS.SESSION_CREATED_AT, 0);
  if (createdAt === 0) return false; // No timestamp = legacy session, don't expire
  return Date.now() - createdAt > SESSION_MAX_AGE_MS;
}

/**
 * Clear session data from storage
 */
function clearSessionStorage(): void {
  deleteKey(STORAGE_KEYS.SESSION_ACTIVE);
  deleteKey(STORAGE_KEYS.SESSION_CREATED_AT);
}

const AuthContext = createContext<AuthState | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  /**
   * Check session validity and clear if expired
   * Returns true if session is valid, false if expired or no session
   */
  const checkSessionValidity = useCallback((): boolean => {
    const hasSession = getBoolean(STORAGE_KEYS.SESSION_ACTIVE, false);
    if (!hasSession) return false;

    if (isSessionExpired()) {
      clearSessionStorage();
      setIsAuthenticated(false);
      setSessionExpired(true);
      return false;
    }
    return true;
  }, []);

  // Check if user was previously authenticated this session
  useEffect(() => {
    let mounted = true;
    const checkAuth = async () => {
      try {
        await initializeStorage();
        if (mounted) {
          const isValid = checkSessionValidity();
          setIsAuthenticated(isValid);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setIsAuthenticated(false);
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to initialize secure storage. Please restart the app.'
          );
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    void checkAuth();
    return () => {
      mounted = false;
    };
  }, [checkSessionValidity]);

  // Check session expiration when app returns to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      const previousState = appStateRef.current;

      // App returning to foreground - check session expiration
      if (
        (previousState === 'background' || previousState === 'inactive') &&
        nextAppState === 'active'
      ) {
        checkSessionValidity();
      }

      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [checkSessionValidity]);

  const authenticate = useCallback(async () => {
    try {
      setError(null);
      setSessionExpired(false);
      await initializeStorage();
      setBoolean(STORAGE_KEYS.SESSION_ACTIVE, true);
      setNumber(STORAGE_KEYS.SESSION_CREATED_AT, Date.now());
      // Only set authenticated AFTER storage write succeeds
      setIsAuthenticated(true);
    } catch (err) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : 'Failed to save session. Please try again.';
      setError(errorMsg);
      console.error('[auth] Failed to persist session:', err);
      throw err; // Re-throw so caller knows authentication failed
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      setError(null);
      setSessionExpired(false);
      await initializeStorage();
      clearSessionStorage();
      // Only clear authenticated state AFTER storage write succeeds
      setIsAuthenticated(false);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'Failed to logout. Please try again.';
      setError(errorMsg);
      console.error('[auth] Failed to clear session:', err);
      // Still set authenticated to false even if storage fails
      // Better to show logged out than keep user in broken authenticated state
      setIsAuthenticated(false);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, isLoading, error, sessionExpired, authenticate, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
