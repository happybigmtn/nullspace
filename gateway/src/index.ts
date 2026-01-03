/**
 * Mobile Gateway WebSocket Server
 *
 * Bridges mobile JSON protocol to Rust backend binary protocol.
 * Enables full-stack testing with real on-chain game execution.
 */
import './telemetry.js';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { createHandlerRegistry, type HandlerContext } from './handlers/index.js';
import { SessionManager, NonceManager, ConnectionLimiter } from './session/index.js';
import { SubmitClient } from './backend/index.js';
import { ErrorCodes, createError } from './types/errors.js';
import { OutboundMessageSchema, type OutboundMessage, getOutboundMessageGameType } from '@nullspace/protocol/mobile';
import { trackGatewayFaucet, trackGatewayResponse, trackGatewaySession } from './ops.js';
import { crapsLiveTable } from './live-table/index.js';
import { logDebug, logError, logInfo, logWarn } from './logger.js';

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const IS_PROD = NODE_ENV === 'production';

const readStringEnv = (key: string, fallback: string, requiredInProd = false): string => {
  const raw = process.env[key]?.trim();
  if (raw) return raw;
  if (requiredInProd && IS_PROD) {
    throw new Error(`Missing required env: ${key}`);
  }
  return fallback;
};

const parsePositiveInt = (
  key: string,
  fallback: number,
  options: { allowZero?: boolean; requiredInProd?: boolean } = {},
): number => {
  const raw = process.env[key];
  if (!raw) {
    if (options.requiredInProd && IS_PROD) {
      throw new Error(`Missing required env: ${key}`);
    }
    return fallback;
  }
  const parsed = Number(raw);
  const valid = Number.isFinite(parsed) && (options.allowZero ? parsed >= 0 : parsed > 0);
  if (!valid) {
    if (IS_PROD) {
      throw new Error(`Invalid ${key}: ${raw}`);
    }
    logWarn(`[Gateway] Invalid ${key}=${raw}; using ${fallback}`);
    return fallback;
  }
  return Math.floor(parsed);
};

// Configuration from environment
const PORT = parsePositiveInt('GATEWAY_PORT', 9010, { requiredInProd: true });
const BACKEND_URL = readStringEnv('BACKEND_URL', 'http://localhost:8080', true);
const GATEWAY_ORIGIN = readStringEnv('GATEWAY_ORIGIN', `http://localhost:${PORT}`, true);
const GATEWAY_DATA_DIR = readStringEnv('GATEWAY_DATA_DIR', '.gateway-data', true);
const MAX_CONNECTIONS_PER_IP = parsePositiveInt('MAX_CONNECTIONS_PER_IP', 5, { requiredInProd: true });
const MAX_TOTAL_SESSIONS = parsePositiveInt('MAX_TOTAL_SESSIONS', 1000, { requiredInProd: true });
const DEFAULT_FAUCET_AMOUNT = 1000n;
const FAUCET_COOLDOWN_MS = 60_000;
const BALANCE_REFRESH_MS = parsePositiveInt('BALANCE_REFRESH_MS', 60_000);
const SUBMIT_TIMEOUT_MS = parsePositiveInt('GATEWAY_SUBMIT_TIMEOUT_MS', 10_000);
const HEALTH_TIMEOUT_MS = parsePositiveInt('GATEWAY_HEALTHCHECK_TIMEOUT_MS', 5_000);
const ACCOUNT_TIMEOUT_MS = parsePositiveInt('GATEWAY_ACCOUNT_TIMEOUT_MS', 5_000);
const SUBMIT_MAX_BYTES = parsePositiveInt('GATEWAY_SUBMIT_MAX_BYTES', 8 * 1024 * 1024);
const NONCE_PERSIST_INTERVAL_MS = parsePositiveInt(
  'GATEWAY_NONCE_PERSIST_INTERVAL_MS',
  15_000,
  { allowZero: true },
);
const GATEWAY_ALLOW_NO_ORIGIN = ['1', 'true', 'yes'].includes(
  String(process.env.GATEWAY_ALLOW_NO_ORIGIN ?? '').toLowerCase(),
);
const GATEWAY_ALLOWED_ORIGINS = (process.env.GATEWAY_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const validateProductionEnv = (): void => {
  if (!IS_PROD) return;
  parsePositiveInt('GATEWAY_SESSION_RATE_LIMIT_POINTS', 10, { requiredInProd: true });
  parsePositiveInt('GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000, { requiredInProd: true });
  parsePositiveInt('GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS', 60 * 60 * 1000, { requiredInProd: true });
  parsePositiveInt('GATEWAY_EVENT_TIMEOUT_MS', 30_000, { allowZero: true, requiredInProd: true });
  if (GATEWAY_ALLOWED_ORIGINS.length === 0) {
    throw new Error('GATEWAY_ALLOWED_ORIGINS must be set in production');
  }
};

validateProductionEnv();

// Core services
const nonceManager = new NonceManager({ origin: GATEWAY_ORIGIN, dataDir: GATEWAY_DATA_DIR });
const submitClient = new SubmitClient(BACKEND_URL, {
  origin: GATEWAY_ORIGIN,
  submitTimeoutMs: SUBMIT_TIMEOUT_MS,
  healthTimeoutMs: HEALTH_TIMEOUT_MS,
  accountTimeoutMs: ACCOUNT_TIMEOUT_MS,
  maxSubmissionBytes: SUBMIT_MAX_BYTES,
});
const sessionManager = new SessionManager(submitClient, BACKEND_URL, nonceManager, GATEWAY_ORIGIN);
const connectionLimiter = new ConnectionLimiter({
  maxConnectionsPerIp: MAX_CONNECTIONS_PER_IP,
  maxTotalSessions: MAX_TOTAL_SESSIONS,
});
const handlers = createHandlerRegistry();

crapsLiveTable.configure({ submitClient, nonceManager, backendUrl: BACKEND_URL, origin: GATEWAY_ORIGIN });

/**
 * Send JSON message to client
 */
function send(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Send error to client
 */
function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: 'error', code, message });
}

/**
 * Handle incoming message from mobile client
 */
async function handleMessage(ws: WebSocket, rawData: Buffer): Promise<void> {
  // Parse JSON
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(rawData.toString());
  } catch {
    sendError(ws, ErrorCodes.INVALID_MESSAGE, 'Invalid JSON');
    return;
  }

  const msgType = msg.type as string | undefined;
  logDebug(`[Gateway] Received message: ${msgType}`, JSON.stringify(msg).slice(0, 200));

  if (!msgType) {
    sendError(ws, ErrorCodes.INVALID_MESSAGE, 'Missing message type');
    return;
  }

  // Handle system messages
  if (msgType === 'ping') {
    send(ws, { type: 'pong', timestamp: Date.now() });
    return;
  }

  if (msgType === 'get_balance') {
    const session = sessionManager.getSession(ws);
    if (session) {
      await sessionManager.refreshBalance(session);
      send(ws, {
        type: 'balance',
        registered: session.registered,
        hasBalance: session.hasBalance,
        publicKey: session.publicKeyHex,
        balance: session.balance.toString(),
      });
    } else {
      sendError(ws, ErrorCodes.SESSION_EXPIRED, 'No active session');
    }
    return;
  }

  if (msgType === 'faucet_claim') {
    const session = sessionManager.getSession(ws);
    if (!session) {
      sendError(ws, ErrorCodes.SESSION_EXPIRED, 'No active session');
      return;
    }

    const amountRaw = typeof msg.amount === 'number' ? msg.amount : null;
    const amount = amountRaw && amountRaw > 0 ? BigInt(Math.floor(amountRaw)) : DEFAULT_FAUCET_AMOUNT;

    const result = await sessionManager.requestFaucet(session, amount, FAUCET_COOLDOWN_MS);
    if (!result.success) {
      sendError(ws, ErrorCodes.INVALID_MESSAGE, result.error ?? 'Faucet claim failed');
      return;
    }

    await sessionManager.refreshBalance(session);
    send(ws, {
      type: 'balance',
      registered: session.registered,
      hasBalance: session.hasBalance,
      publicKey: session.publicKeyHex,
      balance: session.balance.toString(),
      message: 'FAUCET_CLAIMED',
    });
    trackGatewayFaucet(session, amount);
    return;
  }

  const validation = OutboundMessageSchema.safeParse(msg);
  if (!validation.success) {
    sendError(ws, ErrorCodes.INVALID_MESSAGE, 'Invalid message payload');
    return;
  }

  const validatedMsg = validation.data as OutboundMessage;
  const validatedType = validatedMsg.type;

  // Get session
  const session = sessionManager.getSession(ws);
  if (!session) {
    sendError(ws, ErrorCodes.SESSION_EXPIRED, 'Session not found');
    return;
  }

  // Map message type to game type
  const gameType = getOutboundMessageGameType(validatedType);
  if (gameType === null || gameType === undefined) {
    sendError(ws, ErrorCodes.INVALID_MESSAGE, `Unknown message type: ${validatedType}`);
    return;
  }

  // Get handler for game type
  const handler = handlers.get(gameType);
  if (!handler) {
    sendError(ws, ErrorCodes.INVALID_GAME_TYPE, `No handler for game type: ${gameType}`);
    return;
  }

  // Build handler context
  const ctx: HandlerContext = {
    session,
    submitClient,
    nonceManager,
    backendUrl: BACKEND_URL,
    origin: GATEWAY_ORIGIN,
  };

  // Execute handler
  logDebug(`[Gateway] Executing handler for ${validatedType}...`);
  const result = await handler.handleMessage(ctx, validatedMsg);
  logDebug(
    `[Gateway] Handler result:`,
    result.success ? 'success' : 'failed',
    result.error?.message ?? '',
  );

  if (result.success) {
    if (result.response) {
      logDebug(`[Gateway] Sending response:`, JSON.stringify(result.response).slice(0, 200));
      send(ws, result.response);
      trackGatewayResponse(session, result.response as Record<string, unknown>);
    }
  } else if (result.error) {
    sendError(ws, result.error.code, result.error.message);
  }
}

// Create HTTP server with healthz endpoint, then attach WebSocket server
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url?.split('?')[0] === '/healthz') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.statusCode = 404;
  res.end();
});

const wss = new WebSocketServer({ server });
server.listen(PORT);

wss.on('connection', async (ws: WebSocket, req) => {
  const clientIp = req.socket.remoteAddress ?? 'unknown';
  const originHeader = req.headers.origin;
  const originValue = typeof originHeader === 'string' ? originHeader : null;
  const origin = originValue === 'null' ? null : originValue;

  if (GATEWAY_ALLOWED_ORIGINS.length > 0) {
    if (!origin) {
      if (!GATEWAY_ALLOW_NO_ORIGIN) {
        logWarn('[Gateway] Connection rejected: missing origin header');
        sendError(ws, ErrorCodes.INVALID_MESSAGE, 'Origin required');
        ws.close(1008, 'Origin required');
        return;
      }
    } else if (!GATEWAY_ALLOWED_ORIGINS.includes(origin)) {
      logWarn(`[Gateway] Connection rejected: origin not allowed (${origin})`);
      sendError(ws, ErrorCodes.INVALID_MESSAGE, 'Origin not allowed');
      ws.close(1008, 'Origin not allowed');
      return;
    }
  }
  logDebug(`[Gateway] Client connected from ${clientIp}`);

  // Check connection limits before proceeding
  const limitCheck = connectionLimiter.canConnect(clientIp);
  if (!limitCheck.allowed) {
    logWarn(`[Gateway] Connection rejected: ${limitCheck.reason}`);
    sendError(ws, limitCheck.code ?? ErrorCodes.BACKEND_UNAVAILABLE, limitCheck.reason ?? 'Connection limit exceeded');
    ws.close(1013, limitCheck.reason); // 1013 = Try Again Later
    return;
  }

  // Generate a connection ID for tracking (will be replaced by session.id once created)
  const connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Register the connection
  connectionLimiter.registerConnection(clientIp, connectionId);

  try {
    // Create session with auto-registration
    const session = await sessionManager.createSession(ws, {}, clientIp);
    sessionManager.startBalanceRefresh(session, BALANCE_REFRESH_MS);

    // Send session ready message
    send(ws, {
      type: 'session_ready',
      sessionId: session.id,
      publicKey: session.publicKeyHex,
      registered: session.registered,
      hasBalance: session.hasBalance,
    });
    trackGatewaySession(session);

    // Handle messages
    ws.on('message', async (data: Buffer) => {
      try {
        await handleMessage(ws, data);
      } catch (err) {
        logError('[Gateway] Message handling error:', err);
        sendError(
          ws,
          ErrorCodes.BACKEND_UNAVAILABLE,
          err instanceof Error ? err.message : 'Internal error'
        );
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      logDebug(`[Gateway] Client disconnected: ${session.id}`);
      const destroyed = sessionManager.destroySession(ws);
      if (destroyed) {
        crapsLiveTable.removeSession(destroyed);
      }
      connectionLimiter.unregisterConnection(clientIp, connectionId);
    });

    // Handle errors
    ws.on('error', (err) => {
      logError(`[Gateway] WebSocket error for ${session.id}:`, err);
    });
  } catch (err) {
    logError('[Gateway] Session creation error:', err);
    sendError(
      ws,
      ErrorCodes.BACKEND_UNAVAILABLE,
      'Failed to create session'
    );
    // Clean up the connection tracking on error
    connectionLimiter.unregisterConnection(clientIp, connectionId);
    ws.close();
  }
});

wss.on('error', (err) => {
  logError('[Gateway] Server error:', err);
});

const noncePersistTimer =
  NONCE_PERSIST_INTERVAL_MS > 0
    ? setInterval(() => {
        nonceManager.persist();
      }, NONCE_PERSIST_INTERVAL_MS)
    : null;
noncePersistTimer?.unref?.();

// Graceful shutdown
const shutdown = (label: string): void => {
  logInfo(`[Gateway] ${label}...`);
  nonceManager.persist();
  if (noncePersistTimer) {
    clearInterval(noncePersistTimer);
  }
  wss.close(() => {
    server.close(() => {
      logInfo('[Gateway] Server closed');
      process.exit(0);
    });
  });
};

process.on('SIGINT', () => shutdown('Shutting down'));
process.on('SIGTERM', () => shutdown('Terminating'));

// Restore nonces on startup
nonceManager.restore();

logInfo(`[Gateway] Mobile gateway listening on ws://0.0.0.0:${PORT}`);
logInfo(`[Gateway] Backend URL: ${BACKEND_URL}`);
logInfo(`[Gateway] Gateway Origin: ${GATEWAY_ORIGIN}`);
logInfo(`[Gateway] Connection limits: ${MAX_CONNECTIONS_PER_IP} per IP, ${MAX_TOTAL_SESSIONS} total`);
logInfo(`[Gateway] Registered handlers for ${handlers.size} game types`);
