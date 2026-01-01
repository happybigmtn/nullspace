/**
 * Session lifecycle manager
 * Handles player registration, deposits, session tracking, and event subscriptions
 */
import { randomUUID } from 'crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { NonceManager } from './nonce.js';
import { UpdatesClient } from '../backend/updates.js';
import { encodeCasinoRegister, encodeCasinoDeposit, buildTransaction, wrapSubmission, generateSessionId, } from '../codec/index.js';
const DEFAULT_INITIAL_BALANCE = 10000n; // 10,000 test chips
const readEnvLimit = (key, fallback) => {
    const raw = process.env[key];
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const SESSION_CREATE_LIMIT = {
    points: readEnvLimit('GATEWAY_SESSION_RATE_LIMIT_POINTS', 10),
    durationMs: readEnvLimit('GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000),
    blockMs: readEnvLimit('GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS', 60 * 60 * 1000),
};
export class SessionManager {
    sessions = new Map();
    byPublicKey = new Map();
    nonceManager;
    submitClient;
    backendUrl;
    sessionCreateAttempts = new Map();
    constructor(submitClient, backendUrl, nonceManager) {
        this.submitClient = submitClient;
        this.backendUrl = backendUrl;
        this.nonceManager = nonceManager ?? new NonceManager();
    }
    generatePrivateKey() {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const privateKey = ed25519.utils.randomPrivateKey();
            const allZeros = privateKey.every((b) => b === 0);
            const allSame = privateKey.every((b) => b === privateKey[0]);
            if (!allZeros && !allSame) {
                return privateKey;
            }
        }
        throw new Error('Insufficient entropy detected for session key generation');
    }
    enforceSessionRateLimit(clientIp) {
        const now = Date.now();
        const existing = this.sessionCreateAttempts.get(clientIp);
        if (existing && existing.blockedUntil > now) {
            throw new Error('Session creation rate limit exceeded');
        }
        const record = existing ?? { count: 0, windowStart: now, blockedUntil: 0 };
        if (now - record.windowStart > SESSION_CREATE_LIMIT.durationMs) {
            record.count = 0;
            record.windowStart = now;
        }
        record.count += 1;
        if (record.count > SESSION_CREATE_LIMIT.points) {
            record.blockedUntil = now + SESSION_CREATE_LIMIT.blockMs;
            this.sessionCreateAttempts.set(clientIp, record);
            throw new Error('Session creation rate limit exceeded');
        }
        this.sessionCreateAttempts.set(clientIp, record);
    }
    /**
     * Create a new session and register player on-chain
     */
    async createSession(ws, options = {}, clientIp = 'unknown') {
        this.enforceSessionRateLimit(clientIp);
        let privateKey;
        let publicKey;
        let publicKeyHex;
        let attempts = 0;
        do {
            privateKey = this.generatePrivateKey();
            publicKey = ed25519.getPublicKey(privateKey);
            publicKeyHex = Buffer.from(publicKey).toString('hex');
            attempts += 1;
        } while (this.byPublicKey.has(publicKeyHex) && attempts < 3);
        if (this.byPublicKey.has(publicKeyHex)) {
            throw new Error('Failed to generate unique session key');
        }
        const playerName = options.playerName ?? `Player_${publicKeyHex.slice(0, 8)}`;
        const initialBalance = options.initialBalance ?? DEFAULT_INITIAL_BALANCE;
        const now = Date.now();
        const session = {
            id: randomUUID(),
            ws,
            publicKey,
            privateKey,
            publicKeyHex,
            playerName,
            registered: false,
            hasBalance: false,
            balance: 0n,
            activeGameId: null,
            gameType: null,
            gameSessionCounter: 0n,
            connectedAt: now,
            lastActivityAt: now,
            lastFaucetAt: 0,
        };
        this.sessions.set(ws, session);
        this.byPublicKey.set(publicKeyHex, session);
        // Register and deposit before returning session (must complete before client can play)
        try {
            await this.initializePlayer(session, initialBalance);
        }
        catch (err) {
            console.error(`Failed to initialize player ${playerName}:`, err);
        }
        return session;
    }
    /**
     * Register player on-chain and connect to updates stream.
     * Note: Players receive INITIAL_CHIPS (1,000) on registration automatically.
     * The faucet (CasinoDeposit) is rate-limited for new accounts so we don't auto-deposit.
     *
     * IMPORTANT: Must connect WebSocket FIRST before sending transactions,
     * otherwise we miss the broadcast of results (race condition).
     */
    async initializePlayer(session, _initialBalance) {
        // Step 1: Connect to updates stream FIRST (before any transactions)
        // This ensures we're subscribed to receive event broadcasts
        try {
            const updatesClient = new UpdatesClient(this.backendUrl);
            await updatesClient.connectForAccount(session.publicKey);
            session.updatesClient = updatesClient;
            console.log(`Connected to updates stream for ${session.playerName}`);
        }
        catch (err) {
            console.warn(`Failed to connect to updates stream for ${session.playerName}:`, err);
            // Non-fatal - game can still work, just won't get real-time events
        }
        // Step 2: Register player (grants INITIAL_CHIPS automatically)
        // Now the WebSocket is ready to receive the registration result
        const registerResult = await this.registerPlayer(session);
        if (!registerResult) {
            console.warn(`Registration failed for ${session.playerName}`);
            return;
        }
        // Player gets 1,000 chips on registration - mark as having balance
        session.hasBalance = true;
        session.balance = 1000n;
    }
    /**
     * Register player on-chain (CasinoRegister)
     */
    async registerPlayer(session) {
        return this.nonceManager.withLock(session.publicKeyHex, async (nonce) => {
            const instruction = encodeCasinoRegister(session.playerName);
            const tx = buildTransaction(nonce, instruction, session.privateKey);
            const submission = wrapSubmission(tx);
            const result = await this.submitClient.submit(submission);
            if (result.accepted) {
                session.registered = true;
                this.nonceManager.setCurrentNonce(session.publicKeyHex, nonce + 1n);
                console.log(`Registered player: ${session.playerName}`);
                return true;
            }
            if (result.error && this.nonceManager.handleRejection(session.publicKeyHex, result.error)) {
                const synced = await this.nonceManager.syncFromBackend(session.publicKeyHex, this.getBackendUrl());
                if (synced) {
                    const retryNonce = this.nonceManager.getCurrentNonce(session.publicKeyHex);
                    const retryTx = buildTransaction(retryNonce, instruction, session.privateKey);
                    const retrySubmission = wrapSubmission(retryTx);
                    const retryResult = await this.submitClient.submit(retrySubmission);
                    if (retryResult.accepted) {
                        session.registered = true;
                        this.nonceManager.setCurrentNonce(session.publicKeyHex, retryNonce + 1n);
                        console.log(`Registered player: ${session.playerName}`);
                        return true;
                    }
                }
            }
            console.error(`Registration rejected for ${session.playerName}: ${result.error}`);
            return false;
        });
    }
    /**
     * Deposit chips (CasinoDeposit)
     */
    async depositChips(session, amount) {
        return this.nonceManager.withLock(session.publicKeyHex, async (nonce) => {
            const instruction = encodeCasinoDeposit(amount);
            const tx = buildTransaction(nonce, instruction, session.privateKey);
            const submission = wrapSubmission(tx);
            const result = await this.submitClient.submit(submission);
            if (result.accepted) {
                session.hasBalance = true;
                session.balance = session.balance + amount;
                this.nonceManager.setCurrentNonce(session.publicKeyHex, nonce + 1n);
                console.log(`Deposited ${amount} chips for ${session.playerName}`);
                return true;
            }
            if (result.error && this.nonceManager.handleRejection(session.publicKeyHex, result.error)) {
                const synced = await this.nonceManager.syncFromBackend(session.publicKeyHex, this.getBackendUrl());
                if (synced) {
                    const retryNonce = this.nonceManager.getCurrentNonce(session.publicKeyHex);
                    const retryTx = buildTransaction(retryNonce, instruction, session.privateKey);
                    const retrySubmission = wrapSubmission(retryTx);
                    const retryResult = await this.submitClient.submit(retrySubmission);
                    if (retryResult.accepted) {
                        session.hasBalance = true;
                        session.balance = session.balance + amount;
                        this.nonceManager.setCurrentNonce(session.publicKeyHex, retryNonce + 1n);
                        console.log(`Deposited ${amount} chips for ${session.playerName}`);
                        return true;
                    }
                }
            }
            console.error(`Deposit rejected for ${session.playerName}: ${result.error}`);
            return false;
        });
    }
    /**
     * Refresh balance from backend account state (best-effort).
     */
    async refreshBalance(session) {
        const account = await this.submitClient.getAccount(session.publicKeyHex);
        if (!account) {
            return null;
        }
        session.balance = account.balance;
        return account.balance;
    }
    startBalanceRefresh(session, intervalMs) {
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
            return;
        }
        if (session.balanceRefreshIntervalId) {
            clearInterval(session.balanceRefreshIntervalId);
        }
        session.balanceRefreshIntervalId = setInterval(async () => {
            try {
                await this.refreshBalance(session);
            }
            catch (err) {
                console.warn(`[Gateway] Balance refresh failed for ${session.playerName}:`, err);
            }
        }, intervalMs);
    }
    /**
     * Request faucet chips (rate-limited client side).
     */
    async requestFaucet(session, amount, cooldownMs) {
        const now = Date.now();
        const lastClaim = session.lastFaucetAt ?? 0;
        if (now - lastClaim < cooldownMs) {
            const seconds = Math.ceil((cooldownMs - (now - lastClaim)) / 1000);
            return { success: false, error: `Faucet cooling down. Try again in ${seconds}s.` };
        }
        const ok = await this.depositChips(session, amount);
        if (ok) {
            session.lastFaucetAt = now;
            return { success: true };
        }
        return { success: false, error: 'Faucet claim rejected' };
    }
    /**
     * Get session by WebSocket
     */
    getSession(ws) {
        return this.sessions.get(ws);
    }
    /**
     * Get session by public key
     */
    getSessionByPublicKey(publicKey) {
        const hex = Buffer.from(publicKey).toString('hex');
        return this.byPublicKey.get(hex);
    }
    /**
     * Get session by public key hex
     */
    getSessionByPublicKeyHex(publicKeyHex) {
        return this.byPublicKey.get(publicKeyHex);
    }
    /**
     * Destroy session on disconnect
     */
    destroySession(ws) {
        const session = this.sessions.get(ws);
        if (session) {
            if (session.balanceRefreshIntervalId) {
                clearInterval(session.balanceRefreshIntervalId);
            }
            // Disconnect updates client
            if (session.updatesClient) {
                session.updatesClient.disconnect();
            }
            if (session.sessionUpdatesClient) {
                session.sessionUpdatesClient.disconnect();
            }
            this.byPublicKey.delete(session.publicKeyHex);
            this.sessions.delete(ws);
            console.log(`Session destroyed: ${session.playerName}`);
        }
        return session;
    }
    /**
     * Update session activity timestamp
     */
    touchSession(session) {
        session.lastActivityAt = Date.now();
    }
    /**
     * Start a game for session
     */
    startGame(session, gameType) {
        const gameId = generateSessionId(session.publicKey, session.gameSessionCounter++);
        session.activeGameId = gameId;
        session.gameType = gameType;
        session.lastActivityAt = Date.now();
        return gameId;
    }
    /**
     * End current game for session
     */
    endGame(session) {
        session.activeGameId = null;
        session.gameType = null;
        session.lastActivityAt = Date.now();
    }
    /**
     * Get nonce manager for direct access
     */
    getNonceManager() {
        return this.nonceManager;
    }
    /**
     * Get submit client for direct access
     */
    getSubmitClient() {
        return this.submitClient;
    }
    /**
     * Get all active sessions
     */
    getAllSessions() {
        return Array.from(this.sessions.values());
    }
    /**
     * Get session count
     */
    getSessionCount() {
        return this.sessions.size;
    }
    /**
     * Get backend URL (for nonce sync)
     */
    getBackendUrl() {
        return this.backendUrl;
    }
    /**
     * Clean up idle sessions
     */
    cleanupIdleSessions(maxIdleMs = 30 * 60 * 1000) {
        const now = Date.now();
        let cleaned = 0;
        for (const [ws, session] of this.sessions.entries()) {
            if (now - session.lastActivityAt > maxIdleMs) {
                this.destroySession(ws);
                try {
                    ws.close(1000, 'Session timeout');
                }
                catch {
                    // Ignore close errors
                }
                cleaned++;
            }
        }
        return cleaned;
    }
}
//# sourceMappingURL=manager.js.map