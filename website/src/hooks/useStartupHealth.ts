import { useEffect, useState } from 'react';
import { subscribeHealth, getStartupHealth, type StartupHealth, type HealthStage } from '../services/startupHealth';

/**
 * React hook to subscribe to startup health state changes.
 * Returns the current health state and updates when stages change.
 */
export function useStartupHealth(): StartupHealth {
  const [health, setHealth] = useState<StartupHealth>(() => getStartupHealth());

  useEffect(() => {
    return subscribeHealth(setHealth);
  }, []);

  return health;
}

/**
 * Get a human-readable message for the current health stage.
 */
export function getStageMessage(stage: HealthStage): string {
  switch (stage) {
    case 'uninitialized':
      return 'Starting up...';
    case 'main_jsx_loaded':
      return 'Loading application...';
    case 'app_mounted':
      return 'Initializing...';
    case 'wasm_loading':
      return 'Loading WASM module...';
    case 'wasm_loaded':
      return 'WASM ready';
    case 'wasm_error':
      return 'WASM failed to load';
    case 'websocket_connecting':
      return 'Connecting to chain...';
    case 'websocket_connected':
      return 'Connected to chain';
    case 'websocket_error':
      return 'Connection failed';
    case 'seed_waiting':
      return 'Syncing chain state...';
    case 'seed_received':
      return 'Chain synced';
    case 'seed_timeout':
      return 'Sync timed out';
    case 'ready':
      return 'Ready';
    case 'error':
      return 'Error';
    default:
      return 'Loading...';
  }
}

/**
 * Check if a stage indicates an error state.
 */
export function isErrorStage(stage: HealthStage): boolean {
  return stage === 'wasm_error' || stage === 'websocket_error' || stage === 'seed_timeout' || stage === 'error';
}

/**
 * Check if a stage indicates loading is in progress.
 */
export function isLoadingStage(stage: HealthStage): boolean {
  return (
    stage === 'uninitialized' ||
    stage === 'main_jsx_loaded' ||
    stage === 'app_mounted' ||
    stage === 'wasm_loading' ||
    stage === 'websocket_connecting' ||
    stage === 'seed_waiting'
  );
}
