import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchTransaction } from '../api/explorerClient';

export default function TxDetailPage() {
  const { hash } = useParams();
  const [tx, setTx] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    fetchTransaction(hash)
      .then((data) => {
        if (mounted) setTx(data);
      })
      .catch(() => setError('Transaction not found'));
    return () => {
      mounted = false;
    };
  }, [hash]);

  if (error) return <div className="text-red-400">{error}</div>;
  if (!tx) return <div className="text-gray-300">Loading transaction...</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold break-all">Tx {tx.hash}</h1>
        <p className="text-gray-400 text-sm">
          Block:{' '}
          <Link to={`/explorer/blocks/${tx.block_height}`} className="text-terminal-green hover:underline">
            #{tx.block_height}
          </Link>
        </p>
        <p className="text-gray-400 text-sm">Position: {tx.position}</p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Public Key</span>
          <span className="font-mono break-all">{tx.public_key}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Nonce</span>
          <span>{tx.nonce}</span>
        </div>
        <div className="mt-2">
          <div className="text-gray-400">Instruction</div>
          <div className="font-mono break-words text-xs">{tx.instruction}</div>
        </div>
      </div>
    </div>
  );
}
