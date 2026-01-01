/**
 * Base game handler interface and utilities
 */
import type { Session } from '../types/session.js';
import type { GameType } from '@nullspace/types';
import type { OutboundMessage } from '@nullspace/protocol/mobile';
import type { SubmitClient } from '../backend/http.js';
import type { NonceManager } from '../session/nonce.js';
import { type ErrorResponse } from '../types/errors.js';
/**
 * Result of handling a message
 */
export interface HandleResult {
    success: boolean;
    response?: Record<string, unknown>;
    error?: ErrorResponse;
}
/**
 * Context passed to handlers
 */
export interface HandlerContext {
    session: Session;
    submitClient: SubmitClient;
    nonceManager: NonceManager;
    backendUrl: string;
}
/**
 * Base game handler class
 */
export declare abstract class GameHandler {
    protected gameType: GameType;
    constructor(gameType: GameType);
    /**
     * Handle a message for this game type
     */
    abstract handleMessage(ctx: HandlerContext, msg: OutboundMessage): Promise<HandleResult>;
    /**
     * Start a new game and wait for on-chain game started event
     */
    protected startGame(ctx: HandlerContext, bet: bigint, gameSessionId: bigint): Promise<HandleResult>;
    /**
     * Make a move in the current game and wait for on-chain event
     */
    protected makeMove(ctx: HandlerContext, payload: Uint8Array): Promise<HandleResult>;
    /**
     * Wait for a specific event type from the updates stream
     * Uses waitForAnyEvent since we filter by Account (one game per player)
     * Also checks for error events if we're waiting for 'started'
     */
    private waitForEvent;
    /**
     * Wait for either a move or complete event
     */
    private waitForMoveOrComplete;
    private ensureSessionUpdatesClient;
    private clearSessionUpdatesClient;
    /**
     * Build response for game started event
     */
    private buildGameStartedResponse;
    /**
     * Build response for game move event
     */
    private buildGameMoveResponse;
    /**
     * Build response for game completed event
     */
    private buildGameCompletedResponse;
    /**
     * Parse initial state based on game type (override in subclasses if needed)
     */
    protected parseInitialState(state: Uint8Array): Record<string, unknown>;
}
//# sourceMappingURL=base.d.ts.map