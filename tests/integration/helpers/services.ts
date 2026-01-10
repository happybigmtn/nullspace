/**
 * Service orchestration helpers for cross-service integration tests
 *
 * Provides utilities to:
 * - Check service health
 * - Wait for all services to be ready
 * - Get service URLs from environment
 *
 * Required environment variables for production-like testing:
 * - GATEWAY_ALLOWED_ORIGINS: Comma-separated list of allowed origins for gateway CORS
 * - GATEWAY_ALLOW_NO_ORIGIN: Set to '1' to allow mobile clients without Origin header
 * - AUTH_ALLOWED_ORIGINS: Comma-separated list of allowed origins for auth service CORS
 * - METRICS_AUTH_TOKEN: Shared token for metrics endpoint authentication
 *
 * Defaults target the testnet deployment; override via env vars for local runs.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ServiceConfig {
  name: string;
  healthUrl: string;
  timeout: number;
}

// Default to fully local, hermetic endpoints so automation can run without
// internet access or staging dependencies. CI overrides these when targeting
// hosted environments.
const DEFAULT_WEBSITE_URL =
  process.env.TEST_ORIGIN ||
  process.env.WEBSITE_URL ||
  'http://127.0.0.1:5173';
const DEFAULT_CONVEX_URL =
  process.env.CONVEX_URL || 'http://127.0.0.1:3210';
const DEFAULT_AUTH_URL =
  process.env.AUTH_URL || 'http://127.0.0.1:4000';
const DEFAULT_BACKEND_URL =
  process.env.BACKEND_URL || 'http://127.0.0.1:8080';
const DEFAULT_GATEWAY_HTTP_URL =
  process.env.GATEWAY_HTTP_URL || 'http://127.0.0.1:9010';
const DEFAULT_GATEWAY_WS_URL =
  process.env.GATEWAY_WS_URL || 'ws://127.0.0.1:9010';

export const DEFAULT_SERVICES: ServiceConfig[] = [
  {
    name: 'convex',
    healthUrl: DEFAULT_CONVEX_URL,
    timeout: 30000,
  },
  {
    name: 'auth',
    healthUrl: DEFAULT_AUTH_URL,
    timeout: 30000,
  },
  {
    name: 'simulator',
    healthUrl: DEFAULT_BACKEND_URL,
    timeout: 60000,
  },
  {
    name: 'gateway',
    healthUrl: DEFAULT_GATEWAY_HTTP_URL,
    timeout: 30000,
  },
];

export const SERVICE_URLS = {
  website: DEFAULT_WEBSITE_URL,
  convex: DEFAULT_CONVEX_URL,
  auth: DEFAULT_AUTH_URL,
  simulator: DEFAULT_BACKEND_URL,
  gatewayHttp: DEFAULT_GATEWAY_HTTP_URL,
  gatewayWs: DEFAULT_GATEWAY_WS_URL,
};

/**
 * Check if a service is healthy
 */
export async function checkServiceHealth(
  url: string,
  path = '/healthz'
): Promise<boolean> {
  try {
    const fullUrl = url.endsWith('/') ? `${url}${path.slice(1)}` : `${url}${path}`;
    const headers: Record<string, string> = {};
    if (DEFAULT_WEBSITE_URL) {
      headers['Origin'] = DEFAULT_WEBSITE_URL;
    }
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for a service to become healthy
 */
export async function waitForService(
  config: ServiceConfig,
  pollIntervalMs = 1000
): Promise<void> {
  const startTime = Date.now();
  const healthPath = config.name === 'convex' ? '/version' : '/healthz';

  while (Date.now() - startTime < config.timeout) {
    const healthy = await checkServiceHealth(config.healthUrl, healthPath);
    if (healthy) {
      console.log(`✓ ${config.name} is healthy at ${config.healthUrl}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Service ${config.name} failed to become healthy within ${config.timeout}ms`
  );
}

/**
 * Wait for all services to be ready
 */
export async function waitForAllServices(
  services: ServiceConfig[] = DEFAULT_SERVICES
): Promise<void> {
  console.log('\n⏳ Waiting for services to be ready...\n');

  // Check services sequentially to maintain dependency order
  for (const service of services) {
    await waitForService(service);
  }

  console.log('\n✅ All services are healthy\n');
}

/**
 * Start Docker Compose stack for integration tests
 */
export async function startDockerStack(
  composeFile = 'tests/integration/docker-compose.cross-service.yml'
): Promise<void> {
  console.log('🐳 Starting Docker Compose stack...');

  try {
    await execAsync(`docker compose -f ${composeFile} up -d --wait`, {
      cwd: process.cwd(),
      timeout: 180000, // 3 minutes
    });
    console.log('✓ Docker Compose stack started');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to start Docker stack: ${message}`);
  }
}

/**
 * Stop Docker Compose stack
 */
export async function stopDockerStack(
  composeFile = 'tests/integration/docker-compose.cross-service.yml'
): Promise<void> {
  console.log('🛑 Stopping Docker Compose stack...');

  try {
    await execAsync(`docker compose -f ${composeFile} down -v`, {
      cwd: process.cwd(),
      timeout: 60000,
    });
    console.log('✓ Docker Compose stack stopped');
  } catch (error) {
    console.warn('Warning: Failed to stop Docker stack cleanly');
  }
}

/**
 * Check if Docker Compose stack is already running
 */
export async function isStackRunning(
  composeFile = 'tests/integration/docker-compose.cross-service.yml'
): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `docker compose -f ${composeFile} ps --status running --format json`,
      { cwd: process.cwd() }
    );
    const containers = stdout.trim().split('\n').filter(Boolean);
    return containers.length >= 4; // All 4 services should be running
  } catch {
    return false;
  }
}
