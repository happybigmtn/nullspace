/**
 * Session lifecycle manager
 * Handles player registration, deposits, session tracking, and event subscriptions
 */
import { randomUUID } from "crypto";
import type { WebSocket } from "ws";
import { ed25519 } from "@noble/curves/ed25519";

import { NonceManager } from "./nonce.js";
import { SubmitClient } from "../backend/http.js";
import { UpdatesClient, type CasinoGameEvent } from "../backend/updates.js";
import { logDebug, logError, logWarn } from "../logger.js";
import { trackRateLimitHit, trackRateLimitReset } from "../metrics/index.js";
import {
	encodeCasinoRegister,
	encodeCasinoDeposit,
	buildTransaction,
	wrapSubmission,
	generateSessionId,
} from "../codec/index.js";
import { getValidPlayerName } from "../utils/player-name-validation.js";
import type { Session, SessionCreateOptions } from "../types/session.js";
import type { GameType } from "@nullspace/types";
import { CASINO_INITIAL_CHIPS } from "@nullspace/constants/limits";

function readEnvLimit(key: string, fallback: number): number {
	const parsed = Number(process.env[key]);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const SESSION_CREATE_LIMIT = {
	points: readEnvLimit("GATEWAY_SESSION_RATE_LIMIT_POINTS", 10),
	durationMs: readEnvLimit(
		"GATEWAY_SESSION_RATE_LIMIT_WINDOW_MS",
		60 * 60 * 1000,
	),
	blockMs: readEnvLimit("GATEWAY_SESSION_RATE_LIMIT_BLOCK_MS", 60 * 60 * 1000),
};

export class SessionManager {
	private sessions: Map<WebSocket, Session> = new Map();
	private byPublicKey: Map<string, Session> = new Map();
	private nonceManager: NonceManager;
	private submitClient: SubmitClient;
	private backendUrl: string;
	private origin: string;
	private sessionCreateAttempts: Map<
		string,
		{ count: number; windowStart: number; blockedUntil: number }
	> = new Map();

	constructor(
		submitClient: SubmitClient,
		backendUrl: string,
		nonceManager?: NonceManager,
		origin?: string,
	) {
		this.submitClient = submitClient;
		this.backendUrl = backendUrl;
		this.nonceManager = nonceManager ?? new NonceManager();
		this.origin = origin ?? "http://localhost:9010";
	}

	private generatePrivateKey(): Uint8Array {
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const privateKey = ed25519.utils.randomPrivateKey();
			const allZeros = privateKey.every((b) => b === 0);
			const allSame = privateKey.every((b) => b === privateKey[0]);
			if (!allZeros && !allSame) {
				return privateKey;
			}
		}
		throw new Error("Insufficient entropy detected for session key generation");
	}

	private enforceSessionRateLimit(clientIp: string): void {
		const now = Date.now();
		const existing = this.sessionCreateAttempts.get(clientIp);
		if (existing && existing.blockedUntil > now) {
			trackRateLimitHit("session_rate_limit", clientIp);
			throw new Error("Session creation rate limit exceeded");
		}

		const record = existing ?? { count: 0, windowStart: now, blockedUntil: 0 };
		if (now - record.windowStart > SESSION_CREATE_LIMIT.durationMs) {
			// Window expired, reset counter
			trackRateLimitReset("session_rate_limit");
			record.count = 0;
			record.windowStart = now;
		}
		record.count += 1;
		if (record.count > SESSION_CREATE_LIMIT.points) {
			record.blockedUntil = now + SESSION_CREATE_LIMIT.blockMs;
			this.sessionCreateAttempts.set(clientIp, record);
			trackRateLimitHit("session_rate_limit", clientIp);
			throw new Error("Session creation rate limit exceeded");
		}
		this.sessionCreateAttempts.set(clientIp, record);
	}

	/**
	 * Create a new session and register player on-chain
	 */
	async createSession(
		ws: WebSocket,
		options: SessionCreateOptions = {},
		clientIp: string = "unknown",
	): Promise<Session> {
		this.enforceSessionRateLimit(clientIp);
		let privateKey: Uint8Array;
		let publicKey: Uint8Array;
		let publicKeyHex: string;
		let attempts = 0;
		do {
			privateKey = this.generatePrivateKey();
			publicKey = ed25519.getPublicKey(privateKey);
			publicKeyHex = Buffer.from(publicKey).toString("hex");
			attempts += 1;
		} while (this.byPublicKey.has(publicKeyHex) && attempts < 3);

		if (this.byPublicKey.has(publicKeyHex)) {
			throw new Error("Failed to generate unique session key");
		}

		const { name: playerName } = getValidPlayerName(
			options.playerName,
			publicKeyHex,
		);

		const now = Date.now();
		const session: Session = {
			id: randomUUID(),
			ws,
			publicKey,
			privateKey,
			publicKeyHex,
			playerName,
			registered: false,
			hasBalance: false,
			balance: 0n,
			balanceSeq: 0n,
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
			await this.initializePlayer(session);
		} catch (err) {
			logError(`Failed to initialize player ${playerName}:`, err);
			// Clean up orphaned session on complete failure (US-105)
			this.cleanupFailedSession(ws, session);
			throw err;
		}

		// If registration failed (not exception, but rejected by backend), also cleanup
		if (!session.registered) {
			logWarn(`Registration failed for ${playerName}, cleaning up session`);
			this.cleanupFailedSession(ws, session);
			throw new Error(`Registration failed for player ${playerName}`);
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
	private async initializePlayer(
		session: Session,
	): Promise<void> {
		// Step 1: Connect to updates stream FIRST (before any transactions)
		// This ensures we're subscribed to receive event broadcasts
		try {
			const updatesClient = new UpdatesClient(this.backendUrl, this.origin);
			updatesClient.on("error", (err) => {
				logWarn(`Updates client error for ${session.playerName}:`, err);
			});
			await updatesClient.connectForAccount(session.publicKey);
			session.updatesClient = updatesClient;
			logDebug(`Connected to updates stream for ${session.playerName}`);
		} catch (err) {
			logWarn(
				`Failed to connect to updates stream for ${session.playerName}:`,
				err,
			);
			// Non-fatal - game can still work, just won't get real-time events
		}

		// Step 2: Register player (grants INITIAL_CHIPS automatically)
		// Now the WebSocket is ready to receive the registration result
		try {
			await this.nonceManager.syncFromBackend(
				session.publicKeyHex,
				this.getBackendUrl(),
			);
		} catch (err) {
			logWarn(
				`Nonce sync failed for ${session.playerName}:`,
				err,
			);
		}
		const registerResult = await this.registerPlayer(session);
		if (!registerResult) {
			logWarn(`Registration failed for ${session.playerName}`);
			return;
		}

		// Player gets 1,000 chips on registration - mark as having balance
		session.hasBalance = true;
		session.balance = BigInt(CASINO_INITIAL_CHIPS);
	}

	/**
	 * Submit a transaction with retry on nonce mismatch
	 */
	private async submitWithRetry(
		session: Session,
		instruction: Uint8Array,
		onSuccess: () => void,
		actionName: string
	): Promise<boolean> {
		return this.nonceManager.withLock(session.publicKeyHex, async () => {
			await this.nonceManager.maybeSync(
				session.publicKeyHex,
				this.getBackendUrl(),
			);

			const trySubmit = async (nonce: bigint): Promise<boolean> => {
				const tx = buildTransaction(nonce, instruction, session.privateKey);
				const submission = wrapSubmission(tx);
				const result = await this.submitClient.submit(submission);

				if (result.accepted) {
					this.nonceManager.setCurrentNonce(session.publicKeyHex, nonce + 1n);
					onSuccess();
					logDebug(`${actionName} for ${session.playerName}`);
					return true;
				}
				return false;
			};

			const nonce = this.nonceManager.getCurrentNonce(session.publicKeyHex);
			const tx = buildTransaction(nonce, instruction, session.privateKey);
			const submission = wrapSubmission(tx);
			const result = await this.submitClient.submit(submission);

			if (result.accepted) {
				this.nonceManager.setCurrentNonce(session.publicKeyHex, nonce + 1n);
				onSuccess();
				logDebug(`${actionName} for ${session.playerName}`);
				return true;
			}

			if (
				result.error &&
				this.nonceManager.handleRejection(session.publicKeyHex, result.error)
			) {
				const synced = await this.nonceManager.syncFromBackend(
					session.publicKeyHex,
					this.getBackendUrl(),
				);
				if (synced) {
					const retryNonce = this.nonceManager.getCurrentNonce(
						session.publicKeyHex,
					);
					if (await trySubmit(retryNonce)) {
						return true;
					}
				}
			}

			logWarn(`${actionName} rejected for ${session.playerName}: ${result.error}`);
			return false;
		});
	}

	/**
	 * Register player on-chain (CasinoRegister)
	 */
	private async registerPlayer(session: Session): Promise<boolean> {
		const instruction = encodeCasinoRegister(session.playerName);
		return this.submitWithRetry(
			session,
			instruction,
			() => { session.registered = true; },
			'Registered player'
		);
	}

	/**
	 * Deposit chips (CasinoDeposit)
	 */
	private async depositChips(
		session: Session,
		amount: bigint,
	): Promise<boolean> {
		const instruction = encodeCasinoDeposit(amount);
		return this.submitWithRetry(
			session,
			instruction,
			() => {
				session.hasBalance = true;
				session.balance = session.balance + amount;
			},
			`Deposited ${amount} chips`
		);
	}

	/**
	 * Refresh balance from backend account state (best-effort).
	 */
	async refreshBalance(session: Session): Promise<bigint | null> {
		const account = await this.submitClient.getAccount(session.publicKeyHex);
		if (!account) {
			return null;
		}
		session.balance = account.balance;
		return account.balance;
	}

	startBalanceRefresh(session: Session, intervalMs: number): void {
		if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
			return;
		}
		if (session.balanceRefreshIntervalId) {
			clearInterval(session.balanceRefreshIntervalId);
		}
		session.balanceRefreshIntervalId = setInterval(async () => {
			try {
				await this.refreshBalance(session);
			} catch (err) {
				logWarn(
					`[Gateway] Balance refresh failed for ${session.playerName}:`,
					err,
				);
			}
		}, intervalMs);
	}

	/**
	 * Request faucet chips (rate-limited client side).
	 */
	async requestFaucet(
		session: Session,
		amount: bigint,
		cooldownMs: number,
	): Promise<{ success: boolean; error?: string }> {
		const now = Date.now();
		const lastClaim = session.lastFaucetAt ?? 0;
		if (now - lastClaim < cooldownMs) {
			const seconds = Math.ceil((cooldownMs - (now - lastClaim)) / 1000);
			return {
				success: false,
				error: `Faucet cooling down. Try again in ${seconds}s.`,
			};
		}

		const ok = await this.depositChips(session, amount);
		if (ok) {
			session.lastFaucetAt = now;
			return { success: true };
		}

		return { success: false, error: "Faucet claim rejected" };
	}

	/**
	 * Get session by WebSocket.
	 * Returns undefined for sessions marked for cleanup (US-150: race condition fix).
	 */
	getSession(ws: WebSocket): Session | undefined {
		const session = this.sessions.get(ws);
		// US-150: Don't return sessions being cleaned up
		if (session?.markedForCleanup) {
			return undefined;
		}
		return session;
	}

	/**
	 * Get session by public key.
	 * Returns undefined for sessions marked for cleanup (US-150: race condition fix).
	 */
	getSessionByPublicKey(publicKey: Uint8Array): Session | undefined {
		const hex = Buffer.from(publicKey).toString("hex");
		const session = this.byPublicKey.get(hex);
		// US-150: Don't return sessions being cleaned up
		if (session?.markedForCleanup) {
			return undefined;
		}
		return session;
	}

	/**
	 * Get session by public key hex.
	 * Returns undefined for sessions marked for cleanup (US-150: race condition fix).
	 */
	getSessionByPublicKeyHex(publicKeyHex: string): Session | undefined {
		const session = this.byPublicKey.get(publicKeyHex);
		// US-150: Don't return sessions being cleaned up
		if (session?.markedForCleanup) {
			return undefined;
		}
		return session;
	}

	/**
	 * Destroy session on disconnect
	 */
	destroySession(ws: WebSocket): Session | undefined {
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
			logDebug(`Session destroyed: ${session.playerName}`);
		}
		return session;
	}

	/**
	 * Clean up a session that failed during initialization.
	 * Removes from tracking maps and disconnects any partial resources.
	 * US-105: Prevents orphaned sessions from accumulating after registration failures.
	 */
	private cleanupFailedSession(ws: WebSocket, session: Session): void {
		// Disconnect any updates client that was connected
		if (session.updatesClient) {
			try {
				session.updatesClient.disconnect();
			} catch {
				// Ignore disconnect errors
			}
		}
		// Remove from both maps
		this.byPublicKey.delete(session.publicKeyHex);
		this.sessions.delete(ws);
		logDebug(`Cleaned up failed session: ${session.playerName}`);
	}

	/**
	 * Update session activity timestamp
	 */
	touchSession(session: Session): void {
		session.lastActivityAt = Date.now();
	}

	/**
	 * Get balance with sequence number for sending to client.
	 * Increments balanceSeq to prevent out-of-order balance regression.
	 * See US-089 for rationale.
	 */
	getBalanceWithSeq(session: Session): { balance: string; balanceSeq: string } {
		session.balanceSeq++;
		return {
			balance: session.balance.toString(),
			balanceSeq: session.balanceSeq.toString(),
		};
	}

	/**
	 * Start a game for session
	 */
	startGame(session: Session, gameType: GameType): bigint {
		const gameId = generateSessionId(
			session.publicKey,
			session.gameSessionCounter++,
		);
		session.activeGameId = gameId;
		session.gameType = gameType;
		session.lastActivityAt = Date.now();
		return gameId;
	}

	/**
	 * End current game for session
	 */
	endGame(session: Session): void {
		session.activeGameId = null;
		session.gameType = null;
		session.lastActivityAt = Date.now();
	}

	/**
	 * Get nonce manager for direct access
	 */
	getNonceManager(): NonceManager {
		return this.nonceManager;
	}

	/**
	 * Get submit client for direct access
	 */
	getSubmitClient(): SubmitClient {
		return this.submitClient;
	}

	/**
	 * Get all active sessions
	 */
	getAllSessions(): Session[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Get session count
	 */
	getSessionCount(): number {
		return this.sessions.size;
	}

	/**
	 * Get backend URL (for nonce sync)
	 */
	getBackendUrl(): string {
		return this.backendUrl;
	}

	/**
	 * Clean up idle sessions using mark-and-sweep pattern (US-150).
	 *
	 * This avoids race conditions where message handlers could access
	 * a session being destroyed. The two-phase approach:
	 * 1. Mark phase: Flag sessions for cleanup (getSession returns undefined for marked sessions)
	 * 2. Sweep phase: Destroy marked sessions and close connections
	 *
	 * @param maxIdleMs Maximum idle time before session is cleaned up (default: 30 minutes)
	 * @param onSessionExpired Optional callback to notify client before closing. Receives (ws, session).
	 * @returns Number of sessions cleaned up
	 */
	cleanupIdleSessions(
		maxIdleMs: number = 30 * 60 * 1000,
		onSessionExpired?: (ws: WebSocket, session: Session) => void
	): number {
		const now = Date.now();

		// Phase 1: MARK - Identify and mark idle sessions
		// This prevents message handlers from using these sessions (getSession checks markedForCleanup)
		const sessionsToCleanup: Array<{ ws: WebSocket; session: Session }> = [];

		for (const [ws, session] of this.sessions.entries()) {
			// Skip already-marked sessions (defensive - shouldn't happen normally)
			if (session.markedForCleanup) {
				continue;
			}

			if (now - session.lastActivityAt > maxIdleMs) {
				// Mark for cleanup - getSession() will now return undefined for this session
				session.markedForCleanup = true;
				sessionsToCleanup.push({ ws, session });
			}
		}

		// Phase 2: SWEEP - Destroy marked sessions
		// Iterate over collected array, not the Map (avoids iterator invalidation)
		for (const { ws, session } of sessionsToCleanup) {
			// Notify client BEFORE destroying session so they can handle gracefully
			if (onSessionExpired) {
				try {
					onSessionExpired(ws, session);
				} catch {
					// Ignore callback errors - continue with cleanup
				}
			}

			this.destroySession(ws);
			try {
				ws.close(1000, "Session timeout");
			} catch {
				// Ignore close errors
			}
		}

		return sessionsToCleanup.length;
	}
}
