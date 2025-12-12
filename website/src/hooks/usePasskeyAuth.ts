import { useState } from 'react';

interface SessionInfo {
  sessionToken: string;
  credentialId: string;
  ed25519PublicKey: string;
}

async function fetchChallenge(): Promise<string> {
  const res = await fetch('/api/webauthn/challenge');
  const data = await res.json();
  return data.challenge;
}

export function usePasskeyAuth() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const register = async () => {
    setLoading(true);
    setError(null);
    try {
      const challenge = await fetchChallenge();
      const credentialId = crypto.randomUUID().replace(/-/g, '');
      const webauthnPublicKey = 'dev-passkey'; // Placeholder until full WebAuthn flow is wired

      const res = await fetch('/api/webauthn/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential_id: credentialId, webauthn_public_key: webauthnPublicKey, challenge }),
      });

      if (!res.ok) {
        throw new Error('Registration failed');
      }

      const registerData = await res.json();
      // Immediately log in to get a session token
      const loginRes = await fetch('/api/webauthn/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential_id: registerData.credential_id ?? credentialId, challenge }),
      });

      if (!loginRes.ok) {
        throw new Error('Login failed');
      }
      const loginData = await loginRes.json();
      setSession({
        sessionToken: loginData.session_token,
        credentialId: loginData.credential_id,
        ed25519PublicKey: loginData.ed25519_public_key,
      });
      return loginData;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const signHex = async (messageHex: string) => {
    if (!session) {
      throw new Error('No active session');
    }
    const res = await fetch('/api/webauthn/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.sessionToken}`,
      },
      body: JSON.stringify({ message_hex: messageHex }),
    });
    if (!res.ok) {
      throw new Error('Sign failed');
    }
    return res.json();
  };

  const logout = () => setSession(null);

  return {
    session,
    loading,
    error,
    register,
    signHex,
    logout,
  };
}
