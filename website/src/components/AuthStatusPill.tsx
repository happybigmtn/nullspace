import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  linkEvmAddress,
  requestEvmChallenge,
  requestAuthChallenge,
  signInWithKey,
  unlinkEvmAddress,
} from '../services/authClient';
import { connectEvmWallet, hasEvmProvider, signEvmMessage } from '../services/evmWallet';

type AuthStatusPillProps = {
  publicKeyHex?: string | null;
  className?: string;
};

const ACTIVE_STATUSES = new Set(['active', 'trialing']);

export const AuthStatusPill: React.FC<AuthStatusPillProps> = ({ publicKeyHex, className }) => {
  const { session, entitlements, evmLink, loading, error, refresh } = useAuthSession();
  const [vaultStatus, setVaultStatus] = useState(() => getVaultStatusSync());
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkDone, setLinkDone] = useState(false);
  const [evmBusy, setEvmBusy] = useState(false);
  const [evmError, setEvmError] = useState<string | null>(null);
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

  const onLinkEvm = async () => {
    if (!session) return;
    setEvmBusy(true);
    setEvmError(null);
    try {
      if (!hasEvmProvider()) {
        throw new Error('No EVM wallet detected');
      }
      const wallet = await connectEvmWallet();
      const challenge = await requestEvmChallenge({
        address: wallet.address,
        chainId: wallet.chainId,
      });
      const signature = await signEvmMessage(wallet.address, challenge.message);
      await linkEvmAddress({
        address: wallet.address,
        chainId: wallet.chainId,
        signature,
        challengeId: challenge.challengeId,
      });
      refresh();
    } catch (err) {
      setEvmError(err instanceof Error ? err.message : 'EVM link failed');
    } finally {
      setEvmBusy(false);
    }
  };

  const onUnlinkEvm = async () => {
    if (!session) return;
    setEvmBusy(true);
    setEvmError(null);
    try {
      await unlinkEvmAddress();
      refresh();
    } catch (err) {
      setEvmError(err instanceof Error ? err.message : 'EVM unlink failed');
    } finally {
      setEvmBusy(false);
    }
  };

  const formatEvmAddress = (address?: string | null) => {
    if (!address) return 'Not linked';
    const trimmed = address.trim();
    if (trimmed.length <= 12) return trimmed;
    return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
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
    'flex flex-wrap items-center gap-3 rounded-full border border-titanium-200 bg-white shadow-soft px-4 py-1.5 text-[10px] font-bold tracking-widest uppercase dark:border-titanium-800 dark:bg-titanium-900/70 dark:text-titanium-100',
    className ?? '',
  ]
    .join(' ')
    .trim();

  return (
    <div className={pillClass}>
      <span className="text-titanium-400">Auth</span>
      {loading ? (
        <span className="text-titanium-300">Checking…</span>
      ) : session ? (
        <span className="text-titanium-900 dark:text-titanium-100 max-w-[140px] truncate" title={displayName}>
          {displayLabel}
        </span>
      ) : (
        <>
          {vaultStatus.supported && vaultStatus.unlocked && effectivePublicKey ? (
            <button
              type="button"
              onClick={onKeySignIn}
              disabled={signInBusy}
              className={`px-3 py-1 rounded-full transition-all duration-200 ${
                signInBusy
                  ? 'bg-titanium-100 text-titanium-300 dark:bg-titanium-800 dark:text-titanium-400'
                  : 'bg-action-primary text-white shadow-sm hover:scale-105 active:scale-95 dark:bg-action-primary/20 dark:text-action-primary dark:shadow-none'
              }`}
            >
              {signInBusy ? 'Signing…' : 'Sign in'}
            </button>
          ) : vaultStatus.supported ? (
            <Link to="/security" className="text-action-primary hover:opacity-70 transition-opacity">
              Unlock
            </Link>
          ) : (
            <span className="text-titanium-300 italic">Vault Unavailable</span>
          )}
        </>
      )}

      {session ? (
        <>
          <div className="h-3 w-px bg-titanium-200 dark:bg-titanium-800" />
          {!activeEntitlement && stripeTiers.length > 1 ? (
            <select
              className="bg-white border border-titanium-200 rounded-lg px-2 py-0.5 text-[10px] font-bold text-titanium-800 outline-none dark:bg-titanium-900 dark:border-titanium-800 dark:text-titanium-100"
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
            className="px-3 py-1 rounded-full bg-titanium-100 text-titanium-800 border border-titanium-200 hover:border-titanium-400 transition-all dark:bg-titanium-800 dark:text-titanium-100 dark:border-titanium-800 dark:hover:border-titanium-500"
          >
            {activeEntitlement ? 'Account' : 'Join'}
          </button>
          <div className="h-3 w-px bg-titanium-200 dark:bg-titanium-800" />
          <a href={signOutUrl} className="text-titanium-400 hover:text-titanium-900 transition-colors dark:text-titanium-400 dark:hover:text-titanium-100">
            Exit
          </a>
        </>
      ) : null}

      {billingError ? <span className="text-action-destructive">{billingError}</span> : null}
      {linkError ? <span className="text-action-destructive">{linkError}</span> : null}
      {evmError ? <span className="text-action-destructive">{evmError}</span> : null}
      {signInError ? <span className="text-action-destructive">{signInError}</span> : null}
      {error ? <span className="text-action-destructive">{error}</span> : null}
    </div>
  );
};
