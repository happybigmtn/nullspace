import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBlocks } from '../api/explorerClient';

export default function BlocksPage() {
  const [blocks, setBlocks] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async (offset = 0) => {
    setLoading(true);
    try {
      const data = await fetchBlocks(offset, 20);
      setBlocks(data.blocks);
      setNextOffset(data.next_offset ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(0);
  }, []);

  if (loading) {
    return <div className="text-ns-muted">Loading blocks...</div>;
  }

  return (
    <div className="space-y-6">
      <section className="liquid-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Blocks</div>
            <div className="text-lg font-display tracking-tight text-ns">Recent blocks</div>
            <div className="text-[11px] text-ns-muted">The latest finalized blocks on chain.</div>
          </div>
          <button
            className="text-[10px] px-4 py-2 rounded-full liquid-chip text-ns hover:shadow-soft uppercase tracking-[0.28em]"
            onClick={() => load(0)}
          >
            Refresh
          </button>
        </div>
      </section>

      <section className="liquid-card p-0">
        <div className="overflow-x-auto liquid-panel">
          <table className="min-w-full text-[11px]">
            <thead className="text-ns-muted border-b border-black/10 dark:border-white/10">
              <tr className="uppercase tracking-[0.28em] text-[10px]">
                <th className="px-4 py-3 text-left">Height</th>
                <th className="px-4 py-3 text-left">View</th>
                <th className="px-4 py-3 text-left">Hash</th>
                <th className="px-4 py-3 text-left">Txs</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((block) => (
                <tr key={block.block_digest} className="border-b border-black/5 dark:border-white/5">
                  <td className="px-4 py-3">
                    <Link to={`/explorer/blocks/${block.height}`} className="text-ns hover:underline">
                      {block.height}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ns">{block.view}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-ns-muted break-all">
                    {block.block_digest.slice(0, 12)}...
                  </td>
                  <td className="px-4 py-3 text-ns">{block.tx_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {nextOffset !== null && (
        <div className="flex justify-end">
          <button
            onClick={() => load(nextOffset)}
            className="px-4 py-2 rounded-full liquid-chip text-ns text-[10px] uppercase tracking-[0.28em] hover:shadow-soft"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
