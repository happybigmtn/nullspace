/**
 * Game Subscription Routing Unit Tests (AC-6.3)
 *
 * Tests for game subscription message handling and topic-based routing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock WebSocket for unit testing
class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  sentMessages: string[] = [];

  get OPEN() { return MockWebSocket.OPEN; }
  get CLOSED() { return MockWebSocket.CLOSED; }

  send(data: string, callback?: (err?: Error) => void) {
    if (this.readyState !== MockWebSocket.OPEN) {
      callback?.(new Error('WebSocket not open'));
      return;
    }
    this.sentMessages.push(data);
    callback?.();
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  clearSent() {
    this.sentMessages = [];
  }

  getParsedMessages() {
    return this.sentMessages.map((m) => JSON.parse(m));
  }
}

// Import after mock setup
import { BroadcastManager } from '../../src/broadcast/manager.js';
import {
  gameIdToGameType,
  gameTypeToName,
  getGameSubscriptionTopic,
  InboundMessageSchema,
  GameIdSchema,
} from '@nullspace/protocol/mobile';
import { GameType } from '@nullspace/types';

describe('Game Subscription Protocol (AC-6.3)', () => {
  describe('GameIdSchema', () => {
    it('should accept numeric game IDs (0-9)', () => {
      for (let i = 0; i <= 9; i++) {
        const result = GameIdSchema.safeParse(i);
        expect(result.success).toBe(true);
      }
    });

    it('should reject numeric game IDs outside 0-9', () => {
      expect(GameIdSchema.safeParse(-1).success).toBe(false);
      expect(GameIdSchema.safeParse(10).success).toBe(false);
      expect(GameIdSchema.safeParse(100).success).toBe(false);
    });

    it('should accept string game names', () => {
      const validNames = [
        'blackjack', 'roulette', 'craps', 'hilo', 'baccarat',
        'sicbo', 'casinowar', 'videopoker', 'threecard', 'ultimateholdem',
      ];
      for (const name of validNames) {
        const result = GameIdSchema.safeParse(name);
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid string game names', () => {
      expect(GameIdSchema.safeParse('poker').success).toBe(false);
      expect(GameIdSchema.safeParse('slots').success).toBe(false);
      expect(GameIdSchema.safeParse('').success).toBe(false);
    });
  });

  describe('gameIdToGameType', () => {
    it('should convert numeric IDs to GameType', () => {
      // GameType enum: Baccarat=0, Blackjack=1, CasinoWar=2, Craps=3,
      // VideoPoker=4, HiLo=5, Roulette=6, SicBo=7, ThreeCard=8, UltimateHoldem=9
      expect(gameIdToGameType(0)).toBe(GameType.Baccarat);
      expect(gameIdToGameType(1)).toBe(GameType.Blackjack);
      expect(gameIdToGameType(2)).toBe(GameType.CasinoWar);
      expect(gameIdToGameType(3)).toBe(GameType.Craps);
      expect(gameIdToGameType(4)).toBe(GameType.VideoPoker);
      expect(gameIdToGameType(5)).toBe(GameType.HiLo);
      expect(gameIdToGameType(6)).toBe(GameType.Roulette);
      expect(gameIdToGameType(7)).toBe(GameType.SicBo);
      expect(gameIdToGameType(8)).toBe(GameType.ThreeCard);
      expect(gameIdToGameType(9)).toBe(GameType.UltimateHoldem);
    });

    it('should convert string names to GameType', () => {
      expect(gameIdToGameType('blackjack')).toBe(GameType.Blackjack);
      expect(gameIdToGameType('roulette')).toBe(GameType.Roulette);
      expect(gameIdToGameType('craps')).toBe(GameType.Craps);
      expect(gameIdToGameType('hilo')).toBe(GameType.HiLo);
      expect(gameIdToGameType('baccarat')).toBe(GameType.Baccarat);
      expect(gameIdToGameType('sicbo')).toBe(GameType.SicBo);
      expect(gameIdToGameType('casinowar')).toBe(GameType.CasinoWar);
      expect(gameIdToGameType('videopoker')).toBe(GameType.VideoPoker);
      expect(gameIdToGameType('threecard')).toBe(GameType.ThreeCard);
      expect(gameIdToGameType('ultimateholdem')).toBe(GameType.UltimateHoldem);
    });

    it('should return null for invalid IDs', () => {
      expect(gameIdToGameType(100 as any)).toBe(null);
      expect(gameIdToGameType(-1 as any)).toBe(null);
    });
  });

  describe('gameTypeToName', () => {
    it('should convert GameType to string name', () => {
      expect(gameTypeToName(GameType.Blackjack)).toBe('blackjack');
      expect(gameTypeToName(GameType.Roulette)).toBe('roulette');
      expect(gameTypeToName(GameType.Craps)).toBe('craps');
      expect(gameTypeToName(GameType.HiLo)).toBe('hilo');
      expect(gameTypeToName(GameType.Baccarat)).toBe('baccarat');
      expect(gameTypeToName(GameType.SicBo)).toBe('sicbo');
      expect(gameTypeToName(GameType.CasinoWar)).toBe('casinowar');
      expect(gameTypeToName(GameType.VideoPoker)).toBe('videopoker');
      expect(gameTypeToName(GameType.ThreeCard)).toBe('threecard');
      expect(gameTypeToName(GameType.UltimateHoldem)).toBe('ultimateholdem');
    });
  });

  describe('getGameSubscriptionTopic', () => {
    it('should generate correct topic format', () => {
      expect(getGameSubscriptionTopic(GameType.Blackjack)).toBe('game:blackjack');
      expect(getGameSubscriptionTopic(GameType.Roulette)).toBe('game:roulette');
      expect(getGameSubscriptionTopic(GameType.Craps)).toBe('game:craps');
    });
  });

  describe('InboundMessageSchema - Subscription Messages', () => {
    it('should validate subscribe_game message with numeric gameId', () => {
      const msg = { type: 'subscribe_game', gameId: 1 };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should validate subscribe_game message with string gameId', () => {
      const msg = { type: 'subscribe_game', gameId: 'roulette' };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should validate unsubscribe_game message', () => {
      const msg = { type: 'unsubscribe_game', gameId: 'blackjack' };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should validate list_subscriptions message', () => {
      const msg = { type: 'list_subscriptions' };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it('should reject subscribe_game with invalid gameId', () => {
      const msg = { type: 'subscribe_game', gameId: 'invalid' };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it('should reject subscribe_game without gameId', () => {
      const msg = { type: 'subscribe_game' };
      const result = InboundMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });
});

describe('BroadcastManager Subscriptions (AC-6.3)', () => {
  let broadcastManager: BroadcastManager;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcastManager = new BroadcastManager({
      flushIntervalMs: 10,
    });
    broadcastManager.start();
  });

  afterEach(() => {
    broadcastManager.destroy();
    vi.useRealTimers();
  });

  describe('Topic Subscription', () => {
    it('should subscribe client to a topic', () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      broadcastManager.subscribe(ws, ['game:roulette']);

      expect(broadcastManager.isSubscribed(ws)).toBe(true);
      expect(broadcastManager.getSubscriptions(ws)).toContain('game:roulette');
    });

    it('should subscribe to multiple topics', () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      broadcastManager.subscribeToTopic(ws, 'game:roulette');
      broadcastManager.subscribeToTopic(ws, 'game:blackjack');
      broadcastManager.subscribeToTopic(ws, 'game:craps');

      const subs = broadcastManager.getSubscriptions(ws);
      expect(subs).toContain('game:roulette');
      expect(subs).toContain('game:blackjack');
      expect(subs).toContain('game:craps');
    });

    it('should unsubscribe from specific topic', () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      broadcastManager.subscribeToTopic(ws, 'game:roulette');
      broadcastManager.subscribeToTopic(ws, 'game:blackjack');
      broadcastManager.unsubscribeFromTopic(ws, 'game:roulette');

      const subs = broadcastManager.getSubscriptions(ws);
      expect(subs).not.toContain('game:roulette');
      expect(subs).toContain('game:blackjack');
    });

    it('should remove all subscriptions on unsubscribe', () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      broadcastManager.subscribeToTopic(ws, 'game:roulette');
      broadcastManager.subscribeToTopic(ws, 'game:blackjack');
      broadcastManager.unsubscribe(ws);

      expect(broadcastManager.isSubscribed(ws)).toBe(false);
      expect(broadcastManager.getSubscriptions(ws)).toEqual([]);
    });

    it('should return empty array for non-subscribed client', () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;
      expect(broadcastManager.getSubscriptions(ws)).toEqual([]);
    });
  });

  describe('Topic-Based Publishing', () => {
    it('should deliver messages only to subscribed clients', async () => {
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;

      broadcastManager.subscribeToTopic(ws1, 'game:roulette');
      broadcastManager.subscribeToTopic(ws2, 'game:blackjack');

      broadcastManager.publishToTopic('game:roulette', { type: 'test', data: 'roulette' });

      // Flush queues
      await broadcastManager.flush();

      const mock1 = ws1 as unknown as MockWebSocket;
      const mock2 = ws2 as unknown as MockWebSocket;

      expect(mock1.sentMessages.length).toBe(1);
      expect(JSON.parse(mock1.sentMessages[0])).toEqual({ type: 'test', data: 'roulette' });
      expect(mock2.sentMessages.length).toBe(0);
    });

    it('should deliver to all subscribers of a topic', async () => {
      const ws1 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws2 = new MockWebSocket() as unknown as import('ws').WebSocket;
      const ws3 = new MockWebSocket() as unknown as import('ws').WebSocket;

      broadcastManager.subscribeToTopic(ws1, 'game:roulette');
      broadcastManager.subscribeToTopic(ws2, 'game:roulette');
      // ws3 not subscribed

      broadcastManager.publishToTopic('game:roulette', { type: 'spin', number: 17 });

      await broadcastManager.flush();

      const mock1 = ws1 as unknown as MockWebSocket;
      const mock2 = ws2 as unknown as MockWebSocket;
      const mock3 = ws3 as unknown as MockWebSocket;

      expect(mock1.sentMessages.length).toBe(1);
      expect(mock2.sentMessages.length).toBe(1);
      expect(mock3.sentMessages.length).toBe(0);
    });

    it('should support multiple topic subscriptions per client', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      broadcastManager.subscribeToTopic(ws, 'game:roulette');
      broadcastManager.subscribeToTopic(ws, 'game:blackjack');

      broadcastManager.publishToTopic('game:roulette', { type: 'roulette_event' });
      broadcastManager.publishToTopic('game:blackjack', { type: 'blackjack_event' });

      await broadcastManager.flush();

      const mock = ws as unknown as MockWebSocket;
      expect(mock.sentMessages.length).toBe(2);
    });
  });

  describe('Game ID Routing Integration', () => {
    it('should route by game type correctly', async () => {
      const ws = new MockWebSocket() as unknown as import('ws').WebSocket;

      // Subscribe using game ID
      const gameType = gameIdToGameType('roulette');
      expect(gameType).toBe(GameType.Roulette);

      const topic = getGameSubscriptionTopic(gameType!);
      expect(topic).toBe('game:roulette');

      broadcastManager.subscribeToTopic(ws, topic);

      // Publish to the same topic
      broadcastManager.publishToTopic(topic, { type: 'round_opened', roundId: 1 });

      await broadcastManager.flush();

      const mock = ws as unknown as MockWebSocket;
      expect(mock.sentMessages.length).toBe(1);
      expect(JSON.parse(mock.sentMessages[0])).toEqual({ type: 'round_opened', roundId: 1 });
    });

    it('should correctly isolate games by topic', async () => {
      const rouletteClient = new MockWebSocket() as unknown as import('ws').WebSocket;
      const blackjackClient = new MockWebSocket() as unknown as import('ws').WebSocket;
      const crapsClient = new MockWebSocket() as unknown as import('ws').WebSocket;

      // Subscribe each client to their game
      broadcastManager.subscribeToTopic(rouletteClient, 'game:roulette');
      broadcastManager.subscribeToTopic(blackjackClient, 'game:blackjack');
      broadcastManager.subscribeToTopic(crapsClient, 'game:craps');

      // Publish to each game
      broadcastManager.publishToTopic('game:roulette', { game: 'roulette' });
      broadcastManager.publishToTopic('game:blackjack', { game: 'blackjack' });
      broadcastManager.publishToTopic('game:craps', { game: 'craps' });

      await broadcastManager.flush();

      const mockRoulette = rouletteClient as unknown as MockWebSocket;
      const mockBlackjack = blackjackClient as unknown as MockWebSocket;
      const mockCraps = crapsClient as unknown as MockWebSocket;

      // Each client should only receive their game's message
      expect(mockRoulette.sentMessages.length).toBe(1);
      expect(JSON.parse(mockRoulette.sentMessages[0]).game).toBe('roulette');

      expect(mockBlackjack.sentMessages.length).toBe(1);
      expect(JSON.parse(mockBlackjack.sentMessages[0]).game).toBe('blackjack');

      expect(mockCraps.sentMessages.length).toBe(1);
      expect(JSON.parse(mockCraps.sentMessages[0]).game).toBe('craps');
    });
  });
});
