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
          'flex items-center gap-3 rounded-full border border-titanium-200 bg-white shadow-soft px-4 py-2 dark:border-titanium-800 dark:bg-titanium-900/70',
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
                  : 'bg-titanium-300'
            }`}
          />
          {!isConnected && vaultStatus.supported && (
            <Link
              to="/security"
              className="text-caption font-medium text-action-primary hover:underline"
            >
              Connect
            </Link>
          )}
        </div>

        {/* Balance Display */}
        {isConnected && (
          <>
            <div className="h-4 w-px bg-titanium-200 dark:bg-titanium-800" />
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 hover:opacity-80 transition-opacity"
            >
              <span className="text-micro text-titanium-500 uppercase tracking-wider">Balance</span>
              <span className="text-body font-semibold text-titanium-900 dark:text-titanium-100">
                <AnimatedInteger value={totalBalance} flashOnChange />
              </span>
            </button>
          </>
        )}

        {/* Offline Warning */}
        {isOffline && (
          <span className="text-micro text-action-destructive uppercase tracking-wider">
            Offline
          </span>
        )}

        {/* Expanded Details */}
        {showDetails && isConnected && (
          <div className="absolute top-full left-0 right-0 mt-2 p-4 bg-white rounded-2xl shadow-float border border-titanium-100 dark:bg-titanium-900 dark:border-titanium-800 z-50">
            <div className="space-y-2 text-caption">
              <div className="flex justify-between">
                <span className="text-titanium-500">RNG</span>
                <span className="text-titanium-900 dark:text-titanium-100 font-medium">
                  {toNumber(rng)?.toLocaleString() ?? '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-titanium-500">vUSDT</span>
                <span className="text-titanium-900 dark:text-titanium-100 font-medium">
                  {toNumber(vusdt)?.toLocaleString() ?? '—'}
                </span>
              </div>
              {credits !== undefined && (
                <div className="flex justify-between">
                  <span className="text-titanium-500">Credits</span>
                  <span className="text-titanium-900 dark:text-titanium-100 font-medium">
                    {toNumber(credits)?.toLocaleString() ?? '—'}
                  </span>
                </div>
              )}
              {effectivePubkey && (
                <div className="pt-2 border-t border-titanium-100 dark:border-titanium-800">
                  <Link
                    to={`/explorer/account/${effectivePubkey}`}
                    className="text-micro text-action-primary hover:underline"
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
      return { label: 'Unsupported', className: 'text-titanium-300' };
    }
    if (!vaultStatus.enabled) {
      return { label: 'Disabled', className: 'text-titanium-400' };
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
        'flex flex-wrap items-center gap-3 rounded-full border border-titanium-200 bg-white shadow-soft px-4 py-2 dark:border-titanium-800 dark:bg-titanium-900/70 dark:text-titanium-100',
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
            <span className="text-titanium-400 text-[10px] font-bold tracking-widest uppercase">Vault</span>
            <span className={`text-[10px] font-bold uppercase ${vault.className}`}>{vault.label}</span>
          </Link>

          <div className="h-3 w-px bg-titanium-200 dark:bg-titanium-800" />
        </>
      )}

      {networkText ? (
        <>
          <span className={`text-[10px] font-bold uppercase tracking-widest ${networkTone}`}>
            {networkText}
          </span>
          <div className="h-3 w-px bg-titanium-200 dark:bg-titanium-800" />
        </>
      ) : null}

      <div className="flex items-center gap-4 text-[10px] tracking-widest uppercase font-bold text-titanium-400 whitespace-nowrap">
        <span>
          RNG{' '}
          {toNumber(rng) !== null ? (
            <AnimatedInteger
              value={toNumber(rng)!}
              className="text-titanium-900 dark:text-titanium-100"
              flashOnChange
            />
          ) : (
            <span className="text-titanium-900 dark:text-titanium-100">—</span>
          )}
        </span>
        <span>
          vUSDT{' '}
          {toNumber(vusdt) !== null ? (
            <AnimatedInteger
              value={toNumber(vusdt)!}
              className="text-titanium-900 dark:text-titanium-100"
              flashOnChange
            />
          ) : (
            <span className="text-titanium-900 dark:text-titanium-100">—</span>
          )}
        </span>
        {credits !== undefined || creditsLocked !== undefined ? (
          <span>
            Credits{' '}
            {toNumber(credits) !== null ? (
              <AnimatedInteger
                value={toNumber(credits)!}
                className="text-titanium-900 dark:text-titanium-100"
                flashOnChange
              />
            ) : (
              <span className="text-titanium-900 dark:text-titanium-100">—</span>
            )}
          </span>
        ) : null}
      </div>

      {effectivePubkey ? (
        <>
          <div className="h-3 w-px bg-titanium-200 dark:bg-titanium-800" />
          <Link
            to={`/explorer/account/${effectivePubkey}`}
            className="text-[10px] font-bold tracking-widest uppercase text-action-primary hover:opacity-70 transition-opacity"
            title={effectivePubkey}
          >
            PK {shortHex(effectivePubkey, 6, 4)}
          </Link>
        </>
      ) : null}
    </div>
  );
};
