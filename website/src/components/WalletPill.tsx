import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getVaultStatusSync } from '../security/keyVault';
import { subscribeVault } from '../security/vaultRuntime';

type WalletPillProps = {
  rng?: number | bigint | string | null;
  vusdt?: number | bigint | string | null;
  credits?: number | bigint | string | null;
  creditsLocked?: number | bigint | string | null;
  pubkeyHex?: string | null;
  className?: string;
};

function formatInteger(value: number | bigint | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    return Math.floor(value).toLocaleString();
  }
  const raw = typeof value === 'bigint' ? value.toString() : value.trim();
  if (!raw) return '—';
  if (/^\d+$/.test(raw)) return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return raw;
}

function shortHex(hex: string, start = 10, end = 6): string {
  const s = hex.trim();
  if (s.length <= start + end + 1) return s;
  return `${s.slice(0, start)}…${s.slice(-end)}`;
}

export const WalletPill: React.FC<WalletPillProps> = ({ rng, vusdt, credits, creditsLocked, pubkeyHex, className }) => {
  const [vaultStatus, setVaultStatus] = useState(() => getVaultStatusSync());

  useEffect(() => subscribeVault(() => setVaultStatus(getVaultStatusSync())), []);

  const vault = useMemo(() => {
    if (!vaultStatus.supported) {
      return { label: 'PASSKEY UNAVAILABLE', className: 'text-gray-500 border-gray-800' };
    }
    if (!vaultStatus.enabled) {
      return { label: 'PASSKEY OFF', className: 'text-gray-400 border-gray-800' };
    }
    if (vaultStatus.unlocked) {
      return { label: 'UNLOCKED', className: 'text-terminal-green border-terminal-green/50' };
    }
    return { label: 'LOCKED', className: 'text-terminal-accent border-terminal-accent/50' };
  }, [vaultStatus.enabled, vaultStatus.supported, vaultStatus.unlocked]);

  const effectivePubkey = pubkeyHex ?? vaultStatus.nullspacePublicKeyHex;

  return (
    <div
      className={[
        'flex flex-wrap items-center gap-2 rounded border border-gray-800 bg-gray-900/30 px-2 py-1',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      {vaultStatus.supported && (
        <>
          <Link
            to="/security"
            className={[
              'inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] tracking-widest uppercase hover:bg-gray-900/60',
              vault.className,
            ].join(' ')}
          >
            <span className="text-gray-500">Passkey</span>
            <span className="font-bold">{vault.label}</span>
          </Link>

          <div className="h-4 w-px bg-gray-800" />
        </>
      )}

      <div className="flex items-center gap-2 text-[10px] tracking-widest uppercase text-gray-400 whitespace-nowrap">
        <span>
          RNG <span className="text-white font-bold">{formatInteger(rng)}</span>
        </span>
        <span>
          vUSDT <span className="text-white font-bold">{formatInteger(vusdt)}</span>
        </span>
        {credits !== undefined || creditsLocked !== undefined ? (
          <span>
            Credits <span className="text-white font-bold">{formatInteger(credits)}</span>
            {creditsLocked !== undefined && creditsLocked !== null
              ? ` (${formatInteger(creditsLocked)} locked)`
              : ''}
          </span>
        ) : null}
      </div>

      {effectivePubkey ? (
        <>
          <div className="h-4 w-px bg-gray-800" />
          <Link
            to={`/explorer/account/${effectivePubkey}`}
            className="text-[10px] tracking-widest uppercase text-terminal-green hover:underline"
            title={effectivePubkey}
          >
            PK {shortHex(effectivePubkey)}
          </Link>
        </>
      ) : null}
    </div>
  );
};
