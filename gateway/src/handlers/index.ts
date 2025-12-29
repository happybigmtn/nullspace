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
import { BaccaratHandler } from './baccarat.js';
import { BlackjackHandler } from './blackjack.js';
import { CasinoWarHandler } from './casinowar.js';
import { CrapsHandler } from './craps.js';
import { HiLoHandler } from './hilo.js';
import { RouletteHandler } from './roulette.js';
import { SicBoHandler } from './sicbo.js';
import { ThreeCardPokerHandler } from './threecardpoker.js';
import { UltimateHoldemHandler } from './ultimateholdem.js';
import { VideoPokerHandler } from './videopoker.js';

/**
 * Create handler registry with all 10 games
 */
export function createHandlerRegistry(): Map<GameType, GameHandler> {
  const registry = new Map<GameType, GameHandler>();

  registry.set(GameType.Baccarat, new BaccaratHandler());
  registry.set(GameType.Blackjack, new BlackjackHandler());
  registry.set(GameType.CasinoWar, new CasinoWarHandler());
  registry.set(GameType.Craps, new CrapsHandler());
  registry.set(GameType.HiLo, new HiLoHandler());
  registry.set(GameType.Roulette, new RouletteHandler());
  registry.set(GameType.SicBo, new SicBoHandler());
  registry.set(GameType.ThreeCard, new ThreeCardPokerHandler());
  registry.set(GameType.UltimateHoldem, new UltimateHoldemHandler());
  registry.set(GameType.VideoPoker, new VideoPokerHandler());

  return registry;
}
