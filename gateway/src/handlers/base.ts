/**
 * Base game handler interface and utilities
 */
import type { Session } from '../types/session.js';
import type { GameType } from '@nullspace/types';
import {
  encodeCasinoStartGame,
  encodeCasinoGameMove,
  buildTransaction,
  wrapSubmission,
} from '../codec/index.js';
import { parseGameLog, type CasinoGameEvent } from '../codec/events.js';
import { UpdatesClient } from '../backend/updates.js';
import type { SubmitClient } from '../backend/http.js';
import type { NonceManager } from '../session/nonce.js';
import { ErrorCodes, createError, type ErrorResponse } from '../types/errors.js';

/** Timeout for waiting for game events (ms) */
const GAME_EVENT_TIMEOUT = (() => {
  const raw = process.env.GATEWAY_EVENT_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30000;
})();

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
export abstract class GameHandler {
  protected gameType: GameType;

  constructor(gameType: GameType) {
    this.gameType = gameType;
  }

  /**
   * Handle a message for this game type
   */
  abstract handleMessage(
    ctx: HandlerContext,
    msg: Record<string, unknown>
  ): Promise<HandleResult>;

  /**
   * Start a new game and wait for on-chain game started event
   */
  protected async startGame(
    ctx: HandlerContext,
    bet: bigint,
    gameSessionId: bigint
  ): Promise<HandleResult> {
    const { session, submitClient, nonceManager, backendUrl } = ctx;

    // Check if already in a game
    if (session.activeGameId !== null) {
      return {
        success: false,
        error: createError(ErrorCodes.GAME_IN_PROGRESS, 'A game is already in progress'),
      };
    }

    // Check registration
    if (!session.registered) {
      return {
        success: false,
        error: createError(ErrorCodes.NOT_REGISTERED, 'Player not registered'),
      };
    }

    return nonceManager.withLock(session.publicKeyHex, async (nonce) => {
      // Encode and submit
      const instruction = encodeCasinoStartGame(this.gameType, bet, gameSessionId);
      const tx = buildTransaction(nonce, instruction, session.privateKey);
      const submission = wrapSubmission(tx);

      const result = await submitClient.submit(submission);

      if (result.accepted) {
        session.activeGameId = gameSessionId;
        session.gameType = this.gameType;
        nonceManager.setCurrentNonce(session.publicKeyHex, nonce + 1n);

        // Wait for CasinoGameStarted or CasinoError event from backend
        const gameEvent = await this.waitForEvent(session, 'started');

        if (gameEvent) {
          if (gameEvent.type === 'error') {
            // Backend rejected the game start
            session.activeGameId = null;
            session.gameType = null;
            const errorMsg = gameEvent.errorMessage || `Game rejected (code ${gameEvent.errorCode})`;
            console.log(`[GameHandler] Backend error: ${errorMsg}`);
            return {
              success: false,
              error: createError(ErrorCodes.TRANSACTION_REJECTED, errorMsg),
            };
          }

          // CRITICAL: Update session to use backend's actual on-chain session ID
          // The client generates a session ID but the backend may assign a different one
          if (gameEvent.sessionId && gameEvent.sessionId !== 0n) {
            console.log(`[GameHandler] Updating activeGameId: ${session.activeGameId} -> ${gameEvent.sessionId}`);
            session.activeGameId = gameEvent.sessionId;
          }

          await this.ensureSessionUpdatesClient(session, backendUrl, session.activeGameId!);

          return {
            success: true,
            response: this.buildGameStartedResponse(gameEvent, session, session.activeGameId!, bet),
          };
        }

        // Fallback if no event received (backend may be slow)
        await this.ensureSessionUpdatesClient(session, backendUrl, session.activeGameId!);
        return {
          success: true,
          response: {
            type: 'game_started',
            gameType: this.gameType,
            sessionId: gameSessionId.toString(),
            bet: bet.toString(),
            balance: session.balance.toString(),
          },
        };
      }

      if (result.error && nonceManager.handleRejection(session.publicKeyHex, result.error)) {
        const synced = await nonceManager.syncFromBackend(session.publicKeyHex, backendUrl);
        if (synced) {
          const retryNonce = nonceManager.getCurrentNonce(session.publicKeyHex);
          const retryTx = buildTransaction(retryNonce, instruction, session.privateKey);
          const retrySubmission = wrapSubmission(retryTx);
          const retryResult = await submitClient.submit(retrySubmission);
          if (retryResult.accepted) {
            session.activeGameId = gameSessionId;
            session.gameType = this.gameType;
            nonceManager.setCurrentNonce(session.publicKeyHex, retryNonce + 1n);

            const gameEvent = await this.waitForEvent(session, 'started');
            if (gameEvent) {
              if (gameEvent.type === 'error') {
                session.activeGameId = null;
                session.gameType = null;
                const errorMsg = gameEvent.errorMessage || `Game rejected (code ${gameEvent.errorCode})`;
                console.log(`[GameHandler] Backend error: ${errorMsg}`);
                return {
                  success: false,
                  error: createError(ErrorCodes.TRANSACTION_REJECTED, errorMsg),
                };
              }
              if (gameEvent.sessionId && gameEvent.sessionId !== 0n) {
                console.log(`[GameHandler] Updating activeGameId: ${session.activeGameId} -> ${gameEvent.sessionId}`);
                session.activeGameId = gameEvent.sessionId;
              }
              await this.ensureSessionUpdatesClient(session, backendUrl, session.activeGameId!);
              return {
                success: true,
                response: this.buildGameStartedResponse(gameEvent, session, session.activeGameId!, bet),
              };
            }

            await this.ensureSessionUpdatesClient(session, backendUrl, session.activeGameId!);
            return {
              success: true,
              response: {
                type: 'game_started',
                gameType: this.gameType,
                sessionId: gameSessionId.toString(),
                bet: bet.toString(),
                balance: session.balance.toString(),
              },
            };
          }
        }
      }

      return {
        success: false,
        error: createError(
          ErrorCodes.TRANSACTION_REJECTED,
          result.error ?? 'Transaction rejected'
        ),
      };
    });
  }

  /**
   * Make a move in the current game and wait for on-chain event
   */
  protected async makeMove(
    ctx: HandlerContext,
    payload: Uint8Array
  ): Promise<HandleResult> {
    const { session, submitClient, nonceManager, backendUrl } = ctx;

    // Check if in a game
    if (session.activeGameId === null) {
      return {
        success: false,
        error: createError(ErrorCodes.NO_ACTIVE_GAME, 'No game in progress'),
      };
    }

    const gameSessionId = session.activeGameId;
    console.log(`[GameHandler] Making move with sessionId=${gameSessionId} (hex=${gameSessionId.toString(16)})`);

    return nonceManager.withLock(session.publicKeyHex, async (nonce) => {
      const instruction = encodeCasinoGameMove(gameSessionId, payload);
      const tx = buildTransaction(nonce, instruction, session.privateKey);
      const submission = wrapSubmission(tx);

      const result = await submitClient.submit(submission);

      if (result.accepted) {
        nonceManager.setCurrentNonce(session.publicKeyHex, nonce + 1n);

        // Wait for either CasinoGameMoved or CasinoGameCompleted event
        const gameEvent = await this.waitForMoveOrComplete(session);

        if (gameEvent) {
          if (gameEvent.type === 'error') {
            // Move was rejected by backend
            const errorMsg = gameEvent.errorMessage || `Move rejected (code ${gameEvent.errorCode})`;
            console.log(`[GameHandler] Backend error during move: ${errorMsg}`);
            return {
              success: false,
              error: createError(ErrorCodes.TRANSACTION_REJECTED, errorMsg),
            };
          } else if (gameEvent.type === 'completed') {
            // Game is over, clear session state
            session.activeGameId = null;
            session.gameType = null;
            this.clearSessionUpdatesClient(session);
            if (gameEvent.finalChips !== undefined) {
              session.balance = gameEvent.finalChips;
            } else if (gameEvent.balanceSnapshot) {
              session.balance = gameEvent.balanceSnapshot.chips;
            }
            return {
              success: true,
              response: this.buildGameCompletedResponse(gameEvent, session),
            };
          } else if (gameEvent.type === 'moved') {
            if (gameEvent.balanceSnapshot) {
              session.balance = gameEvent.balanceSnapshot.chips;
            }
            return {
              success: true,
              response: this.buildGameMoveResponse(gameEvent, session),
            };
          }
        }

        // Fallback if no event received
        return {
          success: true,
          response: {
            type: 'move_accepted',
            sessionId: gameSessionId.toString(),
          },
        };
      }

      if (result.error && nonceManager.handleRejection(session.publicKeyHex, result.error)) {
        const synced = await nonceManager.syncFromBackend(session.publicKeyHex, backendUrl);
        if (synced) {
          const retryNonce = nonceManager.getCurrentNonce(session.publicKeyHex);
          const retryTx = buildTransaction(retryNonce, instruction, session.privateKey);
          const retrySubmission = wrapSubmission(retryTx);
          const retryResult = await submitClient.submit(retrySubmission);
          if (retryResult.accepted) {
            nonceManager.setCurrentNonce(session.publicKeyHex, retryNonce + 1n);

            const gameEvent = await this.waitForMoveOrComplete(session);
            if (gameEvent) {
              if (gameEvent.type === 'error') {
                const errorMsg = gameEvent.errorMessage || `Move rejected (code ${gameEvent.errorCode})`;
                console.log(`[GameHandler] Backend error during move: ${errorMsg}`);
                return {
                  success: false,
                  error: createError(ErrorCodes.TRANSACTION_REJECTED, errorMsg),
                };
              } else if (gameEvent.type === 'completed') {
                session.activeGameId = null;
                session.gameType = null;
                this.clearSessionUpdatesClient(session);
                if (gameEvent.finalChips !== undefined) {
                  session.balance = gameEvent.finalChips;
                } else if (gameEvent.balanceSnapshot) {
                  session.balance = gameEvent.balanceSnapshot.chips;
                }
                return {
                  success: true,
                  response: this.buildGameCompletedResponse(gameEvent, session),
                };
              } else if (gameEvent.type === 'moved') {
                if (gameEvent.balanceSnapshot) {
                  session.balance = gameEvent.balanceSnapshot.chips;
                }
                return {
                  success: true,
                  response: this.buildGameMoveResponse(gameEvent, session),
                };
              }
            }

            return {
              success: true,
              response: {
                type: 'move_accepted',
                sessionId: gameSessionId.toString(),
              },
            };
          }
        }
      }

      return {
        success: false,
        error: createError(
          ErrorCodes.TRANSACTION_REJECTED,
          result.error ?? 'Transaction rejected'
        ),
      };
    });
  }

  /**
   * Wait for a specific event type from the updates stream
   * Uses waitForAnyEvent since we filter by Account (one game per player)
   * Also checks for error events if we're waiting for 'started'
   */
  private async waitForEvent(
    session: Session,
    eventType: CasinoGameEvent['type']
  ): Promise<CasinoGameEvent | null> {
    if (!session.updatesClient) {
      console.warn('No updates client connected, skipping event wait');
      return null;
    }

    try {
      // If waiting for 'started', also accept 'error' events
      if (eventType === 'started') {
        return await session.updatesClient.waitForStartedOrError(GAME_EVENT_TIMEOUT);
      }
      return await session.updatesClient.waitForAnyEvent(eventType, GAME_EVENT_TIMEOUT);
    } catch (err) {
      console.warn(`Timeout waiting for ${eventType} event:`, err);
      return null;
    }
  }

  /**
   * Wait for either a move or complete event
   */
  private async waitForMoveOrComplete(
    session: Session
  ): Promise<CasinoGameEvent | null> {
    const accountClient = session.updatesClient;
    const sessionClient = session.sessionUpdatesClient ?? accountClient;

    if (!accountClient && !sessionClient) {
      console.warn('No updates client connected, skipping event wait');
      return null;
    }

    try {
      const movePromise = sessionClient
        ? sessionClient.waitForAnyEvent('moved', GAME_EVENT_TIMEOUT).catch(() => null)
        : Promise.resolve(null);
      const completePromise = accountClient
        ? accountClient.waitForAnyEvent('completed', GAME_EVENT_TIMEOUT).catch(() => null)
        : Promise.resolve(null);
      const errorPromise = accountClient
        ? accountClient.waitForAnyEvent('error', GAME_EVENT_TIMEOUT).catch(() => null)
        : Promise.resolve(null);

      const event = await Promise.race([movePromise, completePromise, errorPromise]);
      return event ?? null;
    } catch (err) {
      console.warn('Timeout waiting for move/complete event:', err);
      return null;
    }
  }

  private async ensureSessionUpdatesClient(
    session: Session,
    backendUrl: string,
    sessionId: bigint
  ): Promise<void> {
    if (!sessionId) {
      return;
    }

    if (session.sessionUpdatesClient && session.sessionUpdatesSessionId === sessionId) {
      return;
    }

    if (session.sessionUpdatesClient) {
      session.sessionUpdatesClient.disconnect();
      session.sessionUpdatesClient = undefined;
      session.sessionUpdatesSessionId = undefined;
    }

    try {
      const updatesClient = new UpdatesClient(backendUrl);
      await updatesClient.connectForSession(sessionId);
      session.sessionUpdatesClient = updatesClient;
      session.sessionUpdatesSessionId = sessionId;
    } catch (err) {
      console.warn('Failed to connect session updates client:', err);
    }
  }

  private clearSessionUpdatesClient(session: Session): void {
    if (session.sessionUpdatesClient) {
      session.sessionUpdatesClient.disconnect();
      session.sessionUpdatesClient = undefined;
      session.sessionUpdatesSessionId = undefined;
    }
  }

  /**
   * Build response for game started event
   */
  private buildGameStartedResponse(
    event: CasinoGameEvent,
    session: Session,
    sessionId: bigint,
    bet: bigint
  ): Record<string, unknown> {
    const response: Record<string, unknown> = {
      type: 'game_started',
      gameType: event.gameType ?? this.gameType,
      sessionId: sessionId.toString(),
      bet: bet.toString(),
    };

    // Include initial state if available (parsed from binary or logs)
    if (event.initialState && event.initialState.length > 0) {
      // Parse initial state based on game type
      response.initialState = this.parseInitialState(event.initialState);
      response.state = Array.from(event.initialState);
    }

    if (session.balance > 0n) {
      response.balance = session.balance.toString();
    }

    return response;
  }

  /**
   * Build response for game move event
   */
  private buildGameMoveResponse(event: CasinoGameEvent, session: Session): Record<string, unknown> {
    const response: Record<string, unknown> = {
      type: 'game_move',
      sessionId: event.sessionId.toString(),
      moveNumber: event.moveNumber,
      gameType: session.gameType ?? this.gameType,
    };

    // Parse JSON logs for game state
    if (event.logs && event.logs.length > 0) {
      const parsedLog = parseGameLog(event.logs[0]);
      if (parsedLog) {
        Object.assign(response, parsedLog);
      }
    }

    if (event.newState && event.newState.length > 0) {
      response.state = Array.from(event.newState);
    }

    if (event.balanceSnapshot) {
      response.balance = event.balanceSnapshot.chips.toString();
    }

    return response;
  }

  /**
   * Build response for game completed event
   */
  private buildGameCompletedResponse(event: CasinoGameEvent, session: Session): Record<string, unknown> {
    const response: Record<string, unknown> = {
      type: 'game_result',
      sessionId: event.sessionId.toString(),
      payout: event.payout?.toString() ?? '0',
      finalChips: event.finalChips?.toString() ?? '0',
      gameType: event.gameType ?? session.gameType ?? this.gameType,
    };

    // Determine win/loss status
    const payout = event.payout ?? 0n;
    if (payout > 0n) {
      response.won = true;
      response.message = `You win ${payout}!`;
    } else if (payout < 0n) {
      response.won = false;
      response.message = 'You lose!';
    } else {
      response.won = false;
      response.push = true;
      response.message = 'Push - bet returned';
    }

    // Parse JSON logs for detailed game state
    if (event.logs && event.logs.length > 0) {
      const parsedLog = parseGameLog(event.logs[0]);
      if (parsedLog) {
        Object.assign(response, parsedLog);
      }
    }

    if (event.finalChips !== undefined) {
      response.balance = event.finalChips.toString();
    } else if (event.balanceSnapshot) {
      response.balance = event.balanceSnapshot.chips.toString();
    }

    return response;
  }

  /**
   * Parse initial state based on game type (override in subclasses if needed)
   */
  protected parseInitialState(state: Uint8Array): Record<string, unknown> {
    // Default: return raw state as hex
    return { rawState: Buffer.from(state).toString('hex') };
  }
}
