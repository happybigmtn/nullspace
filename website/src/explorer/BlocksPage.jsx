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
    return <div className="text-gray-300">Loading blocks...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Recent Blocks</h1>
        <button
          className="text-terminal-green text-sm hover:underline"
          onClick={() => load(0)}
        >
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-900 text-gray-400">
            <tr>
              <th className="px-3 py-2 text-left">Height</th>
              <th className="px-3 py-2 text-left">View</th>
              <th className="px-3 py-2 text-left">Hash</th>
              <th className="px-3 py-2 text-left">Txs</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => (
              <tr key={block.block_digest} className="border-b border-gray-800">
                <td className="px-3 py-2">
                  <Link to={`/explorer/blocks/${block.height}`} className="text-terminal-green hover:underline">
                    {block.height}
                  </Link>
                </td>
                <td className="px-3 py-2 text-gray-300">{block.view}</td>
                <td className="px-3 py-2 font-mono text-xs break-all">
                  {block.block_digest.slice(0, 12)}...
                </td>
                <td className="px-3 py-2 text-gray-300">{block.tx_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {nextOffset !== null && (
        <div className="flex justify-end">
          <button
            onClick={() => load(nextOffset)}
            className="px-3 py-2 bg-gray-900 border border-gray-800 rounded text-sm"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
