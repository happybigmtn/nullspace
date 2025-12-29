import type { WebSocket } from 'ws';
import { NonceManager } from './nonce.js';
import { SubmitClient } from '../backend/http.js';
import type { Session, SessionCreateOptions } from '../types/session.js';
import type { GameType } from '@nullspace/types';
export declare class SessionManager {
    private sessions;
    private byPublicKey;
    private nonceManager;
    private submitClient;
    private backendUrl;
    constructor(submitClient: SubmitClient, backendUrl: string, nonceManager?: NonceManager);
    /**
     * Create a new session and register player on-chain
     */
    createSession(ws: WebSocket, options?: SessionCreateOptions): Promise<Session>;
    /**
     * Register player on-chain and connect to updates stream.
     * Note: Players receive INITIAL_CHIPS (1,000) on registration automatically.
     * The faucet (CasinoDeposit) is rate-limited for new accounts so we don't auto-deposit.
     *
     * IMPORTANT: Must connect WebSocket FIRST before sending transactions,
     * otherwise we miss the broadcast of results (race condition).
     */
    private initializePlayer;
    /**
     * Register player on-chain (CasinoRegister)
     */
    private registerPlayer;
    /**
     * Deposit chips (CasinoDeposit)
     */
    private depositChips;
    /**
     * Get session by WebSocket
     */
    getSession(ws: WebSocket): Session | undefined;
    /**
     * Get session by public key
     */
    getSessionByPublicKey(publicKey: Uint8Array): Session | undefined;
    /**
     * Get session by public key hex
     */
    getSessionByPublicKeyHex(publicKeyHex: string): Session | undefined;
    /**
     * Destroy session on disconnect
     */
    destroySession(ws: WebSocket): Session | undefined;
    /**
     * Update session activity timestamp
     */
    touchSession(session: Session): void;
    /**
     * Start a game for session
     */
    startGame(session: Session, gameType: GameType): bigint;
    /**
     * End current game for session
     */
    endGame(session: Session): void;
    /**
     * Get nonce manager for direct access
     */
    getNonceManager(): NonceManager;
    /**
     * Get submit client for direct access
     */
    getSubmitClient(): SubmitClient;
    /**
     * Get all active sessions
     */
    getAllSessions(): Session[];
    /**
     * Get session count
     */
    getSessionCount(): number;
    /**
     * Get backend URL (for nonce sync)
     */
    getBackendUrl(): string;
    /**
     * Clean up idle sessions
     */
    cleanupIdleSessions(maxIdleMs?: number): number;
}
//# sourceMappingURL=manager.d.ts.map