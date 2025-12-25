import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { searchExplorer } from '../api/explorerClient';
import { AuthStatusPill } from '../components/AuthStatusPill';

export default function ExplorerLayout() {
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    setError(null);
    setIsSearching(true);
    try {
      const result = await searchExplorer(query.trim());
      if (result.type === 'block') {
        navigate(`/explorer/blocks/${result.block.height}`);
      } else if (result.type === 'transaction') {
        navigate(`/explorer/tx/${result.transaction.hash}`);
      } else if (result.type === 'account') {
        navigate(`/explorer/account/${result.account.public_key}`);
      }
    } catch (err) {
      setError('Not found');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-terminal-black text-white">
      <header className="border-b border-gray-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-sm text-terminal-green hover:underline">
            ← Casino
          </Link>
          <Link to="/explorer" className="text-lg font-bold tracking-wide">
            Block Explorer
          </Link>
          <nav className="flex items-center gap-3 text-sm text-gray-300">
            <Link to="/explorer" className="hover:text-white">
              Blocks
            </Link>
            <Link to="/explorer/tokens" className="hover:text-white">
              Tokens
            </Link>
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-3 justify-end">
          <AuthStatusPill className="w-full sm:w-auto" />
          <form onSubmit={onSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Height, block hash, tx hash, or account"
            className="bg-gray-900 text-white px-3 py-2 rounded border border-gray-700 w-72"
          />
          <button
            type="submit"
            className="bg-terminal-green text-black px-3 py-2 rounded disabled:opacity-50"
            disabled={isSearching}
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
          {error && <span className="text-red-400 text-xs ml-2">{error}</span>}
          </form>
        </div>
      </header>
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}
