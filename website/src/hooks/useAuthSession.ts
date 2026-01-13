import { useCallback, useEffect, useState } from 'react';
import { type AuthProfile, getProfile, isAuthEnabled } from '../services/authClient';

type AuthState = {
  session: AuthProfile['session'];
  entitlements: AuthProfile['entitlements'];
  evmLink?: AuthProfile['evmLink'];
};

export function useAuthSession() {
  const [state, setState] = useState<AuthState>({
    session: null,
    entitlements: [],
    evmLink: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (!isAuthEnabled()) {
        setState({ session: null, entitlements: [], evmLink: null });
        setError(null);
        return;
      }
      const profile = await getProfile();
      setState({
        session: profile.session,
        entitlements: profile.entitlements,
        evmLink: profile.evmLink ?? null,
      });
      setError(null);
    } catch (err) {
      setState({ session: null, entitlements: [], evmLink: null });
      setError(err instanceof Error ? err.message : 'Failed to load auth session');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handleFocus = () => refresh();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refresh]);

  return { ...state, loading, error, refresh };
}
