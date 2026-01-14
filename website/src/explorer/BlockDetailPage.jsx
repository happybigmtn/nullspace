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
      .then((data) => mounted && setBlock(data))
      .catch(() => setError('Block not found'));
    return () => {
      mounted = false;
    };
  }, [id]);

  if (error) return <div className="text-action-destructive">{error}</div>;
  if (!block) return <div className="text-ns-muted">Loading block...</div>;

  return (
    <div className="space-y-6">
      <section className="liquid-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Block</div>
            <div className="text-lg font-display tracking-tight text-ns">Height {block.height}</div>
            <div className="text-[11px] text-ns-muted break-all">Hash: {block.block_digest}</div>
          </div>
          <Link
            to="/explorer"
            className="text-[10px] px-4 py-2 rounded-full liquid-chip text-ns uppercase tracking-[0.28em] hover:shadow-soft"
          >
            Back
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">View</div>
            <div className="text-ns">{block.view}</div>
          </div>
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Tx count</div>
            <div className="text-ns">{block.tx_count}</div>
          </div>
          <div className="liquid-panel p-3">
            <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase">Parent</div>
            {block.parent ? (
              <Link to={`/explorer/blocks/${block.parent}`} className="text-ns hover:underline">
                {block.parent.slice(0, 12)}...
              </Link>
            ) : (
              <div className="text-ns-muted">—</div>
            )}
          </div>
        </div>
      </section>

      <section className="liquid-card p-5">
        <div className="text-[10px] text-ns-muted tracking-[0.28em] uppercase mb-3">
          Transactions ({block.tx_count})
        </div>
        {block.tx_hashes.length === 0 ? (
          <div className="text-[11px] text-ns-muted">No transactions.</div>
        ) : (
          <ul className="space-y-2">
            {block.tx_hashes.map((hash) => (
              <li key={hash} className="font-mono text-[10px] liquid-panel p-2 break-all">
                <Link to={`/explorer/tx/${hash}`} className="text-ns hover:underline">
                  {hash}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
