import React, { useEffect, useMemo, useState } from 'react';
import { useAuthSession } from '../hooks/useAuthSession';
import { getVaultStatusSync } from '../security/keyVault';
import { subscribeVault } from '../security/vaultRuntime';
import { signAuthChallenge } from '../security/authSigning';
import { getStripeTiers } from '../services/membershipConfig';
import {
  authLinks,
  createBillingPortalSession,
  createCheckoutSession,
  linkPublicKey,
  requestAuthChallenge,
  signInWithKey,
} from '../services/authClient';

type AuthStatusPillProps = {
  publicKeyHex?: string | null;
  className?: string;
};

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export const AuthStatusPill: React.FC<AuthStatusPillProps> = ({ publicKeyHex, className }) => {
  const { session, entitlements, loading, error, refresh } = useAuthSession();
  const [vaultStatus, setVaultStatus] = useState(() => getVaultStatusSync());
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkDone, setLinkDone] = useState(false);
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const stripeTiers = useMemo(() => getStripeTiers(), []);
  const [selectedTier, setSelectedTier] = useState(() => stripeTiers[0]?.tier ?? '');

  const activeEntitlement = useMemo(
    () => entitlements.find((item) => ACTIVE_STATUSES.has(item.status)) ?? null,
    [entitlements],
  );

  const displayName =
    session?.user?.email ?? session?.user?.name ?? (session ? 'SIGNED IN' : 'SIGN IN');
  const displayLabel =
    displayName.length > 20 ? `${displayName.slice(0, 16)}…` : displayName;

  const fallbackPriceId = (import.meta.env.VITE_STRIPE_PRICE_ID as string | undefined) ?? '';
  const fallbackTier = (import.meta.env.VITE_STRIPE_TIER as string | undefined) ?? undefined;

  useEffect(() => {
    if (!selectedTier && stripeTiers[0]) {
      setSelectedTier(stripeTiers[0].tier);
    }
  }, [selectedTier, stripeTiers]);

  useEffect(() => subscribeVault(() => setVaultStatus(getVaultStatusSync())), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const billing = params.get('billing');
    if (!billing) return;
    refresh();
    params.delete('billing');
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
  }, [refresh]);

  const onBilling = async () => {
    if (!session) return;
    const chosenTier = stripeTiers.find((tier) => tier.tier === selectedTier) ?? stripeTiers[0];
    const priceId = chosenTier?.priceId ?? fallbackPriceId;
    const tierLabel = chosenTier?.tier ?? fallbackTier;
    if (!activeEntitlement && !priceId) {
      setBillingError('Missing Stripe price configuration');
      return;
    }
    const returnUrl = typeof window !== 'undefined' ? window.location.href : '';
    if (!returnUrl) return;
    const successUrl = new URL(returnUrl);
    successUrl.searchParams.set('billing', 'success');
    const cancelUrl = new URL(returnUrl);
    cancelUrl.searchParams.set('billing', 'cancel');
    setBillingBusy(true);
    setBillingError(null);
    try {
      const result = activeEntitlement
        ? await createBillingPortalSession({ returnUrl })
        : await createCheckoutSession({
            priceId,
            successUrl: successUrl.toString(),
            cancelUrl: cancelUrl.toString(),
            tier: tierLabel,
          });
      window.location.assign(result.url);
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Billing failed');
    } finally {
      setBillingBusy(false);
    }
  };

  const onLinkKey = async () => {
    if (!session || !publicKeyHex) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const challenge = await requestAuthChallenge(publicKeyHex);
      const signature = await signAuthChallenge(challenge.challenge);
      await linkPublicKey({
        publicKey: publicKeyHex,
        signature,
        challengeId: challenge.challengeId,
      });
      setLinkDone(true);
      refresh();
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Link failed');
    } finally {
      setLinkBusy(false);
    }
  };

  const effectivePublicKey = publicKeyHex ?? vaultStatus.nullspacePublicKeyHex;

  const onKeySignIn = async () => {
    if (!effectivePublicKey) return;
    setSignInBusy(true);
    setSignInError(null);
    try {
      const challenge = await requestAuthChallenge(effectivePublicKey);
      const signature = await signAuthChallenge(challenge.challenge);
      await signInWithKey({
        publicKey: effectivePublicKey,
        signature,
        challengeId: challenge.challengeId,
      });
      await refresh();
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setSignInBusy(false);
    }
  };

  const signOutUrl =
    typeof window !== 'undefined' ? authLinks.signOut(window.location.href) : authLinks.signOut();

  const pillClass = [
    'flex flex-wrap items-center gap-2 rounded border border-gray-800 bg-gray-900/30 px-2 py-1 text-[10px] tracking-widest uppercase',
    className ?? '',
  ]
    .join(' ')
    .trim();

  return (
    <div className={pillClass}>
      <span className="text-gray-500">Auth</span>
      {loading ? (
        <span className="text-gray-500">Checking…</span>
      ) : session ? (
        <span className="text-terminal-green max-w-[140px] truncate" title={displayName}>
          {displayLabel}
        </span>
      ) : (
        <>
          {vaultStatus.supported && vaultStatus.unlocked && effectivePublicKey ? (
            <button
              type="button"
              onClick={onKeySignIn}
              disabled={signInBusy}
              className={`border px-2 py-1 rounded transition-colors ${
                signInBusy
                  ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-terminal-green/20 border-terminal-green text-terminal-green hover:bg-terminal-green/30'
              }`}
            >
              {signInBusy ? 'Signing…' : 'Sign in'}
            </button>
          ) : vaultStatus.supported ? (
            <a href="/security" className="text-terminal-green hover:underline">
              Unlock vault
            </a>
          ) : (
            <span className="text-gray-500">Passkey required</span>
          )}
        </>
      )}

      {session ? (
        <>
          <div className="h-4 w-px bg-gray-800" />
          {!activeEntitlement && stripeTiers.length > 1 ? (
            <select
              className="bg-gray-950 border border-gray-800 rounded px-2 py-1 text-[10px] text-gray-300"
              value={selectedTier}
              onChange={(event) => setSelectedTier(event.target.value)}
            >
              {stripeTiers.map((tier) => (
                <option key={tier.tier} value={tier.tier}>
                  {tier.label}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            onClick={onBilling}
            disabled={
              billingBusy ||
              (!activeEntitlement && !fallbackPriceId && stripeTiers.length === 0)
            }
            className={`border px-2 py-1 rounded transition-colors ${
              billingBusy
                ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-terminal-green/20 border-terminal-green text-terminal-green hover:bg-terminal-green/30'
            }`}
            title={
              !activeEntitlement && !fallbackPriceId && stripeTiers.length === 0
                ? 'Set VITE_STRIPE_TIERS or VITE_STRIPE_PRICE_ID'
                : undefined
            }
          >
            {activeEntitlement ? 'Manage' : 'Subscribe'}
          </button>
          {publicKeyHex ? (
            <button
              type="button"
              onClick={onLinkKey}
              disabled={linkBusy || linkDone}
              className={`border px-2 py-1 rounded transition-colors ${
                linkBusy
                  ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed'
                  : linkDone
                    ? 'bg-gray-900 border-gray-700 text-gray-500'
                    : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600'
              }`}
            >
              {linkDone ? 'Key linked' : linkBusy ? 'Linking…' : 'Link key'}
            </button>
          ) : null}
          <a href={signOutUrl} className="text-gray-400 hover:text-white">
            Sign out
          </a>
        </>
      ) : null}

      {activeEntitlement ? (
        <span className="text-gray-500">Tier {activeEntitlement.tier}</span>
      ) : null}
      {billingError ? <span className="text-terminal-accent">{billingError}</span> : null}
      {linkError ? <span className="text-terminal-accent">{linkError}</span> : null}
      {signInError ? <span className="text-terminal-accent">{signInError}</span> : null}
      {error ? <span className="text-terminal-accent">{error}</span> : null}
    </div>
  );
};
