import React from 'react';
import { Link } from 'react-router-dom';
import { useSharedCasinoConnection } from '../chain/CasinoConnectionContext';

type ConnectionStatusProps = {
  className?: string;
};

const statusLabel = (status: string) => {
  switch (status) {
    case 'connected':
      return 'Online';
    case 'connecting':
      return 'Connecting...';
    case 'offline':
      return 'Offline';
    case 'vault_locked':
      return 'Vault locked';
    case 'missing_identity':
      return 'Setup required';
    case 'error':
      return 'Connection error';
    default:
      return 'Connecting...';
  }
};

const statusColor = (status: string) => {
  switch (status) {
    case 'connected':
      return 'text-terminal-green';
    case 'connecting':
      return 'text-gray-400';
    case 'offline':
    case 'error':
      return 'text-terminal-accent';
    case 'vault_locked':
    case 'missing_identity':
      return 'text-terminal-gold';
    default:
      return 'text-gray-400';
  }
};

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ className }) => {
  const { status, statusDetail, error, refreshOnce } = useSharedCasinoConnection();
  const label = statusLabel(status);
  const detail = statusDetail ?? error;
  const display = detail ?? label;
  const title = detail && detail !== label ? detail : undefined;
  const showRetry = status === 'offline' || status === 'error';
  const showUnlock = status === 'vault_locked';

  return (
    <div
      className={[
        'flex items-center gap-2 rounded border border-gray-800 bg-gray-900/40 px-2 py-1',
        className ?? '',
      ]
        .join(' ')
        .trim()}
      role="status"
      aria-live="polite"
    >
      <span
        className={[
          'text-[10px] tracking-widest uppercase max-w-[220px] truncate',
          statusColor(status),
        ]
          .join(' ')
          .trim()}
        title={title}
      >
        {display}
      </span>
      {showUnlock ? (
        <Link
          to="/security"
          className="text-[10px] text-terminal-green hover:underline"
        >
          Unlock
        </Link>
      ) : null}
      {showRetry ? (
        <button
          type="button"
          onClick={() => void refreshOnce()}
          className="text-[10px] border border-gray-700 rounded px-2 py-0.5 text-gray-300 hover:border-gray-500 hover:text-white"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
};
