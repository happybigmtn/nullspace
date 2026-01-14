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
      switch (result.type) {
        case 'block':
          navigate(`/explorer/blocks/${result.block.height}`);
          break;
        case 'transaction':
          navigate(`/explorer/tx/${result.transaction.hash}`);
          break;
        case 'account':
          navigate(`/explorer/account/${result.account.public_key}`);
          break;
      }
    } catch {
      setError('Not found');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="min-h-screen text-ns font-sans space-y-6">
      <header className="liquid-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[10px] text-ns-muted tracking-[0.32em] uppercase">Explorer</div>
            <Link to="/explorer" className="text-lg font-display tracking-tight text-ns">
              Block Explorer
            </Link>
            <div className="text-[11px] text-ns-muted">
              Search blocks, transactions, or accounts across the chain.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 justify-end">
            <AuthStatusPill className="w-full sm:w-auto" />
            <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Height, block hash, tx hash, or account"
                className="liquid-input px-3 py-2 text-sm w-full sm:w-80"
              />
              <button
                type="submit"
                className="liquid-chip px-4 py-2 text-[10px] uppercase tracking-[0.28em] text-ns disabled:opacity-50"
                disabled={isSearching}
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
              {error && <span className="text-action-destructive text-xs">{error}</span>}
            </form>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.28em] text-ns-muted">
          <Link to="/" className="liquid-chip px-3 py-1 text-ns-muted hover:text-ns">
            ← Casino
          </Link>
          <div className="h-4 w-px bg-black/10 dark:bg-white/10" />
          <nav className="flex items-center gap-3">
            <Link to="/explorer" className="hover:text-ns">
              Blocks
            </Link>
            <Link to="/explorer/tokens" className="hover:text-ns">
              Tokens
            </Link>
          </nav>
        </div>
      </header>
      <main className="space-y-6">
        <Outlet />
      </main>
    </div>
  );
}
