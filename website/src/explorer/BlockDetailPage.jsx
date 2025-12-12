import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchBlock } from '../api/explorerClient';

export default function BlockDetailPage() {
  const { id } = useParams();
  const [block, setBlock] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    fetchBlock(id)
      .then((data) => {
        if (mounted) setBlock(data);
      })
      .catch(() => setError('Block not found'));
    return () => {
      mounted = false;
    };
  }, [id]);

  if (error) return <div className="text-red-400">{error}</div>;
  if (!block) return <div className="text-gray-300">Loading block...</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Block {block.height}</h1>
        <p className="text-gray-400 text-sm">Hash: {block.block_digest}</p>
        <p className="text-gray-400 text-sm">View: {block.view}</p>
        {block.parent && (
          <p className="text-gray-400 text-sm">
            Parent:{' '}
            <Link to={`/explorer/blocks/${block.parent}`} className="text-terminal-green hover:underline">
              {block.parent.slice(0, 12)}...
            </Link>
          </p>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Transactions ({block.tx_count})</h2>
        {block.tx_hashes.length === 0 && <div className="text-gray-500 text-sm">No transactions.</div>}
        <ul className="space-y-2">
          {block.tx_hashes.map((hash) => (
            <li key={hash} className="font-mono text-xs bg-gray-900 border border-gray-800 rounded p-2">
              <Link to={`/explorer/tx/${hash}`} className="text-terminal-green hover:underline">
                {hash}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
