import React, { useEffect, useState } from 'react';
import { Stats } from '@react-three/drei';

const getPerfEnabled = () => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('casino-3d-perf') === 'true';
};

export const PerformanceOverlay: React.FC = () => {
  const [enabled, setEnabled] = useState(getPerfEnabled);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleStorage = () => setEnabled(getPerfEnabled());
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  if (!import.meta.env.DEV || !enabled) return null;

  return <Stats />;
};

export default PerformanceOverlay;
