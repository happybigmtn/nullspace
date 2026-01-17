/**
 * Startup Health Check Service
 *
 * Tracks initialization stages for debugging silent failures.
 * Exposes status on window.__NULLSPACE_HEALTH__ for console/automation access.
 *
 * Usage:
 *   - From console: window.__NULLSPACE_HEALTH__
 *   - From code: import { getStartupHealth, setHealthStage } from './services/startupHealth'
 */

export type HealthStage =
  | 'uninitialized'
  | 'main_jsx_loaded'
  | 'app_mounted'
  | 'wasm_loading'
  | 'wasm_loaded'
  | 'wasm_error'
  | 'websocket_connecting'
  | 'websocket_connected'
  | 'websocket_error'
  | 'seed_waiting'
  | 'seed_received'
  | 'seed_timeout'
  | 'ready'
  | 'error';

export interface StartupHealth {
  stage: HealthStage;
  timestamp: number;
  wasmLoaded: boolean;
  websocketConnected: boolean;
  seedReceived: boolean;
  error: string | null;
  history: Array<{ stage: HealthStage; timestamp: number; detail?: string }>;
}

const health: StartupHealth = {
  stage: 'uninitialized',
  timestamp: Date.now(),
  wasmLoaded: false,
  websocketConnected: false,
  seedReceived: false,
  error: null,
  history: [],
};

// Expose on window for console/automation access
if (typeof window !== 'undefined') {
  (window as any).__NULLSPACE_HEALTH__ = health;
}

export function setHealthStage(stage: HealthStage, detail?: string): void {
  const timestamp = Date.now();
  health.stage = stage;
  health.timestamp = timestamp;
  health.history.push({ stage, timestamp, detail });

  // Update boolean flags based on stage
  if (stage === 'wasm_loaded') {
    health.wasmLoaded = true;
  } else if (stage === 'wasm_error') {
    health.wasmLoaded = false;
    health.error = detail ?? 'WASM initialization failed';
  } else if (stage === 'websocket_connected') {
    health.websocketConnected = true;
  } else if (stage === 'websocket_error') {
    health.websocketConnected = false;
    health.error = detail ?? 'WebSocket connection failed';
  } else if (stage === 'seed_received') {
    health.seedReceived = true;
  } else if (stage === 'seed_timeout') {
    health.error = detail ?? 'Seed timeout';
  } else if (stage === 'error') {
    health.error = detail ?? 'Unknown error';
  } else if (stage === 'ready') {
    health.error = null;
  }

  // Log stage transition for debugging
  console.log(`[HEALTH] ${stage}${detail ? ': ' + detail : ''}`);
}

export function setHealthError(error: string): void {
  health.error = error;
  health.stage = 'error';
  health.timestamp = Date.now();
  health.history.push({ stage: 'error', timestamp: health.timestamp, detail: error });
  console.error(`[HEALTH] Error: ${error}`);
}

export function getStartupHealth(): StartupHealth {
  return { ...health, history: [...health.history] };
}

export function isHealthy(): boolean {
  return health.wasmLoaded && health.websocketConnected && health.seedReceived && health.error === null;
}

// Initialize as main_jsx_loaded if this module is imported from main.jsx
// (will be called explicitly after this module loads)
