import React from 'react';
import { Outlet } from 'react-router-dom';
import { CasinoConnectionProvider } from '../chain/CasinoConnectionContext';

// Use VITE_URL in production (no /api proxy), fall back to /api for dev
const baseUrl = import.meta.env.VITE_URL || '/api';

export default function ChainConnectionLayout() {
  return (
    <CasinoConnectionProvider baseUrl={baseUrl}>
      <Outlet />
    </CasinoConnectionProvider>
  );
}

