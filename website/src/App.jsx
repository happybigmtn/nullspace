import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CasinoApp from './CasinoApp';
import EconomyDashboard from './components/EconomyDashboard';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CasinoApp />} />
        <Route path="/economy" element={<EconomyDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
