import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getVaultStatusSync } from '../security/keyVault';
import { subscribeVault } from '../security/vaultRuntime';
import { AnimatedInteger } from './ui/AnimatedNumber';

/**
 * LUX-016: Simplified WalletPill
 *
 * Design principles:
 * - Show balance prominently, not technical details
 * - Hide wallet address (available in settings/explorer)
 * - Simple connected/not connected state
 * - Technical info moved to expandable section
 */

type WalletPillProps = {
  rng?: number | bigint | string | null;
  vusdt?: number | bigint | string | null;
  credits?: number | bigint | string | null;
  creditsLocked?: number | bigint | string | null;
  pubkeyHex?: string | null;
  networkLabel?: string;
  networkStatus?: 'online' | 'offline';
  className?: string;
  /** Show simplified view (balance only) vs full technical view */
  simplified?: boolean;
};

function toNumber(value: number | bigint | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function shortHex(hex: string, start = 6, end = 4): string {
  const s = hex.trim();
  if (s.length <= start + end + 1) return s;
  return `${s.slice(0, start)}…${s.slice(-end)}`;
}

export const WalletPill: React.FC<WalletPillProps> = ({
  rng,
  vusdt,
  credits,
  creditsLocked,
  pubkeyHex,
  networkLabel,
  networkStatus,
  className,
  simplified = true,
}) => {
  const [vaultStatus, setVaultStatus] = useState(() => getVaultStatusSync());
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => subscribeVault(() => setVaultStatus(getVaultStatusSync())), []);

  const isConnected = vaultStatus.supported && vaultStatus.unlocked;
  const effectivePubkey = pubkeyHex ?? vaultStatus.nullspacePublicKeyHex;

  // Calculate total balance for simplified view
  const totalBalance = useMemo(() => {
    const rngVal = toNumber(rng) ?? 0;
    const vusdtVal = toNumber(vusdt) ?? 0;
    const creditsVal = toNumber(credits) ?? 0;
    return rngVal + vusdtVal + creditsVal;
  }, [rng, vusdt, credits]);

  const isOffline = networkStatus === 'offline';

  // Simplified view - just balance and connection indicator
  if (simplified) {
    return (
      <div
        className={[
          'relative flex items-center gap-3 liquid-chip px-4 py-2 shadow-soft',
          className ?? '',
        ]
          .join(' ')
          .trim()}
      >
        {/* Connection Status Indicator */}
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isOffline
                ? 'bg-action-destructive'
                : isConnected
                  ? 'bg-action-success'
                  : 'bg-black/20 dark:bg-white/20'
            }`}
          />
          {!isConnected && vaultStatus.supported && (
            <Link
              to="/security"
              className="text-[10px] uppercase tracking-[0.3em] font-semibold text-ns hover:text-ns-muted"
            >
              Connect
            </Link>
          )}
        </div>

        {/* Balance Display */}
        {isConnected && (
          <>
            <div className="h-4 w-px bg-black/10 dark:bg-white/10" />
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              aria-expanded={showDetails}
              aria-haspopup="true"
              className="flex items-center gap-1 hover:opacity-80 transition-opacity focus-visible:ring-2 focus-visible:ring-action-primary/50 rounded"
            >
              <span className="text-[10px] uppercase tracking-[0.3em] text-ns-muted">Balance</span>
              <span className="text-body font-semibold text-ns">
                <AnimatedInteger value={totalBalance} flashOnChange />
              </span>
            </button>
          </>
        )}

        {/* Offline Warning */}
        {isOffline && (
          <span className="text-[10px] uppercase tracking-[0.3em] text-action-destructive">
            Offline
          </span>
        )}

        {/* Expanded Details */}
        {showDetails && isConnected && (
          <div
            role="menu"
            aria-label="Wallet details"
            className="absolute top-full right-0 mt-2 w-64 p-4 liquid-card z-50"
          >
            <div className="space-y-2 text-caption">
              <div className="flex justify-between">
                <span className="text-ns-muted">RNG</span>
                <span className="text-ns font-medium">
                  {toNumber(rng)?.toLocaleString() ?? '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ns-muted">vUSDT</span>
                <span className="text-ns font-medium">
                  {toNumber(vusdt)?.toLocaleString() ?? '—'}
                </span>
              </div>
              {credits !== undefined && (
                <div className="flex justify-between">
                  <span className="text-ns-muted">Credits</span>
                  <span className="text-ns font-medium">
                    {toNumber(credits)?.toLocaleString() ?? '—'}
                  </span>
                </div>
              )}
              {effectivePubkey && (
                <div className="pt-2 border-t border-black/10 dark:border-white/10">
                  <Link
                    to={`/explorer/account/${effectivePubkey}`}
                    className="text-[10px] uppercase tracking-[0.3em] text-ns hover:text-ns-muted"
                  >
                    View Account →
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full technical view (for settings/admin pages)
  const vault = useMemo(() => {
    if (!vaultStatus.supported) {
      return { label: 'Unsupported', className: 'text-ns-muted' };
    }
    if (!vaultStatus.enabled) {
      return { label: 'Disabled', className: 'text-ns-muted' };
    }
    if (vaultStatus.unlocked) {
      return { label: 'Unlocked', className: 'text-action-success' };
    }
    return { label: 'Locked', className: 'text-action-destructive' };
  }, [vaultStatus.enabled, vaultStatus.supported, vaultStatus.unlocked]);

  const networkTone = networkStatus === 'offline' ? 'text-action-destructive' : 'text-action-success';
  const networkText =
    networkLabel && networkStatus === 'offline' ? `${networkLabel} · OFFLINE` : networkLabel;

  return (
    <div
      className={[
        'flex flex-wrap items-center gap-3 liquid-chip px-4 py-2 shadow-soft',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      {vaultStatus.supported && (
        <>
          <Link
            to="/security"
            className="flex items-center gap-2 group transition-opacity hover:opacity-70"
          >
            <span className="text-ns-muted text-[10px] font-bold tracking-[0.28em] uppercase">Vault</span>
            <span className={`text-[10px] font-bold uppercase ${vault.className}`}>{vault.label}</span>
          </Link>

          <div className="h-3 w-px bg-black/10 dark:bg-white/10" />
        </>
      )}

      {networkText ? (
        <>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${networkTone}`}>
            {networkText}
          </span>
          <div className="h-3 w-px bg-black/10 dark:bg-white/10" />
        </>
      ) : null}

      <div className="flex items-center gap-4 text-[10px] tracking-[0.28em] uppercase font-bold text-ns-muted whitespace-nowrap">
        <span>
          RNG{' '}
          {toNumber(rng) !== null ? (
            <AnimatedInteger
              value={toNumber(rng)!}
              className="text-ns"
              flashOnChange
            />
          ) : (
            <span className="text-ns">—</span>
          )}
        </span>
        <span>
          vUSDT{' '}
          {toNumber(vusdt) !== null ? (
            <AnimatedInteger
              value={toNumber(vusdt)!}
              className="text-ns"
              flashOnChange
            />
          ) : (
            <span className="text-ns">—</span>
          )}
        </span>
        {credits !== undefined || creditsLocked !== undefined ? (
          <span>
            Credits{' '}
            {toNumber(credits) !== null ? (
              <AnimatedInteger
                value={toNumber(credits)!}
                className="text-ns"
                flashOnChange
              />
            ) : (
              <span className="text-ns">—</span>
            )}
          </span>
        ) : null}
      </div>

      {effectivePubkey ? (
        <>
          <div className="h-3 w-px bg-black/10 dark:bg-white/10" />
          <Link
            to={`/explorer/account/${effectivePubkey}`}
            className="text-[10px] font-bold tracking-[0.28em] uppercase text-ns hover:text-ns-muted transition-opacity"
            title={effectivePubkey}
          >
            PK {shortHex(effectivePubkey, 6, 4)}
          </Link>
        </>
      ) : null}
    </div>
  );
};
