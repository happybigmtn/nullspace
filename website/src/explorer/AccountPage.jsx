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

  if (error) return <div className="text-red-400">{error}</div>;
  if (!account) return <div className="text-gray-300">Loading account...</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold break-all">Account</h1>
        <p className="font-mono break-all text-sm text-terminal-green">{account.public_key}</p>
        {account.last_updated_height && (
          <p className="text-gray-400 text-sm">Last seen at height {account.last_updated_height}</p>
        )}
        {account.last_nonce !== undefined && account.last_nonce !== null && (
          <p className="text-gray-400 text-sm">Last nonce: {account.last_nonce}</p>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Transactions</h2>
        {account.txs.length === 0 && <div className="text-gray-500 text-sm">No transactions indexed.</div>}
        <ul className="space-y-2">
          {account.txs.map((hash) => (
            <li key={hash} className="font-mono text-xs bg-gray-900 border border-gray-800 rounded p-2">
              <Link to={`/explorer/tx/${hash}`} className="text-terminal-green hover:underline">
                {hash}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Events</h2>
        {account.events.length === 0 && <div className="text-gray-500 text-sm">No events recorded.</div>}
        <ul className="text-sm text-gray-200 space-y-1">
          {account.events.map((ev, idx) => (
            <li key={`${ev}-${idx}`} className="bg-gray-900 border border-gray-800 rounded px-2 py-1 inline-block mr-2 mb-2">
              {ev}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
