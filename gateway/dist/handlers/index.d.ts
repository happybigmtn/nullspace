/**
 * Game handlers registry
 */
export * from './base.js';
export * from './baccarat.js';
export * from './blackjack.js';
export * from './casinowar.js';
export * from './craps.js';
export * from './hilo.js';
export * from './roulette.js';
export * from './sicbo.js';
export * from './threecardpoker.js';
export * from './ultimateholdem.js';
export * from './videopoker.js';
import { GameType } from '../codec/index.js';
import type { GameHandler } from './base.js';
/**
 * Create handler registry with all 10 games
 */
export declare function createHandlerRegistry(): Map<GameType, GameHandler>;
//# sourceMappingURL=index.d.ts.map