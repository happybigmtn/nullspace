import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CasinoApp from './CasinoApp';
import { isFeatureEnabled } from './services/featureFlags';
import { ToastHost } from './components/ui/ToastHost';

const AppLayout = lazy(() => import('./components/AppLayout'));
const ChainConnectionLayout = lazy(() => import('./components/ChainConnectionLayout'));
const EconomyDashboard = lazy(() => import('./components/EconomyDashboard'));
const EconomyApp = lazy(() => import('./EconomyApp'));
const StakingApp = lazy(() => import('./StakingApp'));
const BridgeApp = lazy(() => import('./BridgeApp'));
const SecurityApp = lazy(() => import('./SecurityApp'));

const LegacyEconomyApp = lazy(() => import('./LegacyLiquidityApp'));
const LegacyStakingApp = lazy(() => import('./LegacyStakingApp'));

const ExplorerLayout = lazy(() => import('./explorer/ExplorerLayout'));
const BlocksPage = lazy(() => import('./explorer/BlocksPage'));
const BlockDetailPage = lazy(() => import('./explorer/BlockDetailPage'));
const TxDetailPage = lazy(() => import('./explorer/TxDetailPage'));
const AccountPage = lazy(() => import('./explorer/AccountPage'));
const TokensPage = lazy(() => import('./explorer/TokensPage'));

const EconomyRoute = () => (isFeatureEnabled('new_economy_ui') ? <EconomyApp /> : <LegacyEconomyApp />);
const StakingRoute = () => (isFeatureEnabled('new_staking_ui') ? <StakingApp /> : <LegacyStakingApp />);

function App() {
  return (
    <BrowserRouter>
      <ToastHost />
      <Suspense
        fallback={
          <div className="min-h-screen bg-terminal-black text-white flex items-center justify-center font-mono">
            <div className="text-[10px] tracking-widest text-gray-400">LOADING…</div>
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<CasinoApp />} />
          <Route element={<AppLayout />}>
            <Route path="economy" element={<EconomyDashboard />} />
            <Route element={<ChainConnectionLayout />}>
              <Route path="swap" element={<EconomyRoute />} />
              <Route path="borrow" element={<EconomyRoute />} />
              <Route path="stake" element={<StakingRoute />} />
              <Route path="liquidity" element={<EconomyRoute />} />
              <Route path="bridge" element={<BridgeApp />} />
            </Route>
            <Route path="security" element={<SecurityApp />} />
            <Route path="explorer" element={<ExplorerLayout />}>
              <Route index element={<BlocksPage />} />
              <Route path="blocks/:id" element={<BlockDetailPage />} />
              <Route path="tx/:hash" element={<TxDetailPage />} />
              <Route path="account/:pubkey" element={<AccountPage />} />
              <Route path="tokens" element={<TokensPage />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
