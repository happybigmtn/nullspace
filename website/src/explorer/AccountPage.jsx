import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchAccount } from '../api/explorerClient';

export default function AccountPage() {
  const { pubkey } = useParams();
  const [account, setAccount] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    fetchAccount(pubkey)
      .then((data) => mounted && setAccount(data))
      .catch(() => setError('Account not found'));
    return () => {
      mounted = false;
    };
  }, [pubkey]);

  if (error) return <div className="text-action-destructive">{error}</div>;
  if (!account) return <div className="text-ns-muted">Loading account...</div>;

  return (
    <div className="space-y-6">
      <section className="liquid-card p-5">
        <div className="space-y-2">
          <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Account</div>
          <div className="text-lg font-display tracking-tight text-ns break-all">Account details</div>
          <div className="liquid-panel p-3 font-mono text-[10px] break-all text-ns">
            {account.public_key}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Last seen</div>
            <div className="text-ns">
              {account.last_updated_height ? `Height ${account.last_updated_height}` : '—'}
            </div>
          </div>
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Last nonce</div>
            <div className="text-ns">{account.last_nonce ?? '—'}</div>
          </div>
        </div>
      </section>

      <section className="liquid-card p-5">
        <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase mb-3">Transactions</div>
        {account.txs.length === 0 ? (
          <div className="text-[11px] text-ns-muted">No transactions indexed.</div>
        ) : (
          <ul className="space-y-2">
            {account.txs.map((hash) => (
              <li key={hash} className="font-mono text-[10px] liquid-panel p-2 break-all">
                <Link to={`/explorer/tx/${hash}`} className="text-ns hover:underline">
                  {hash}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="liquid-card p-5">
        <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase mb-3">Events</div>
        {account.events.length === 0 ? (
          <div className="text-[11px] text-ns-muted">No events recorded.</div>
        ) : (
          <div className="flex flex-wrap gap-2 text-[10px]">
            {account.events.map((ev, idx) => (
              <span key={`${ev}-${idx}`} className="liquid-chip px-3 py-1 text-ns">
                {ev}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
