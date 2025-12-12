import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CasinoApp from './CasinoApp';
import EconomyDashboard from './components/EconomyDashboard';
import ExplorerLayout from './explorer/ExplorerLayout';
import BlocksPage from './explorer/BlocksPage';
import BlockDetailPage from './explorer/BlockDetailPage';
import TxDetailPage from './explorer/TxDetailPage';
import AccountPage from './explorer/AccountPage';
import TokensPage from './explorer/TokensPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CasinoApp />} />
        <Route path="/economy" element={<EconomyDashboard />} />
        <Route path="/explorer" element={<ExplorerLayout />}>
          <Route index element={<BlocksPage />} />
          <Route path="blocks/:id" element={<BlockDetailPage />} />
          <Route path="tx/:hash" element={<TxDetailPage />} />
          <Route path="account/:pubkey" element={<AccountPage />} />
          <Route path="tokens" element={<TokensPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
