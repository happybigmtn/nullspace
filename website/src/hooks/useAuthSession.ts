import { useCallback, useEffect, useState } from 'react';
import { type AuthProfile, getProfile } from '../services/authClient';

type AuthState = {
  session: AuthProfile['session'];
  entitlements: AuthProfile['entitlements'];
};

export function useAuthSession() {
  const [state, setState] = useState<AuthState>({ session: null, entitlements: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await getProfile();
      setState({ session: profile.session, entitlements: profile.entitlements });
      setError(null);
    } catch (err) {
      setState({ session: null, entitlements: [] });
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
