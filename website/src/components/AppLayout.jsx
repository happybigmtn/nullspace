import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { PageTransition } from './ui/PageTransition';

export default function AppLayout() {
  return (
    <div className="min-h-screen pb-bottom-nav">
      <a
        href="#app-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:border focus:border-terminal-green focus:bg-terminal-black focus:px-3 focus:py-2 focus:text-[10px] focus:tracking-widest focus:text-terminal-green"
      >
        Skip to content
      </a>
      <main id="app-main" tabIndex={-1}>
        <PageTransition>
          <Outlet />
        </PageTransition>
      </main>
      <BottomNav />
    </div>
  );
}
