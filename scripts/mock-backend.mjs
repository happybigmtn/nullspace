#!/usr/bin/env node
/**
 * Mock WebSocket backend for E2E testing
 *
 * Provides a minimal game server implementation for Detox tests.
 * Supports authentication, game joining, and bet resolution.
 *
 * Usage:
 *   node scripts/mock-backend.mjs [--port 9010]
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const seedValue = Number(process.env.E2E_SEED || 1);
let prngState = seedValue || 1;
const rand = () => {
  // xorshift32 for determinism across runs
  prngState ^= prngState << 13;
  prngState ^= prngState >> 17;
  prngState ^= prngState << 5;
  return ((prngState >>> 0) % 10000) / 10000;
};
import { randomBytes } from 'crypto';

const PORT = parseInt(process.env.MOCK_PORT || process.argv[2]?.replace('--port=', '') || '9010');

// Mock game state
const INITIAL_BALANCE = 10000_000000n; // 10,000 tokens (6 decimals)
const sessions = new Map();

// Generate deterministic but varied results based on seeded PRNG
function generateResult(_seed, odds = 0.48) {
  return rand() < odds;
}

// Game-specific handlers
const gameHandlers = {
  hilo: (msg, session) => {
    if (msg.action === 'deal') {
      const card = Math.floor(rand() * 13) + 1; // 1-13 (A-K)
      session.currentCard = card;
      return {
        type: 'game_state',
        gameId: 'hilo',
        state: { currentCard: card, canGuess: true }
      };
    }
    if (msg.action === 'guess') {
      const newCard = Math.floor(rand() * 13) + 1;
      const won = msg.guess === 'higher'
        ? newCard > session.currentCard
        : newCard < session.currentCard;
      const payout = won ? BigInt(msg.amount) * 2n : 0n;
      session.balance = session.balance - BigInt(msg.amount) + payout;
      session.currentCard = newCard;
      return {
        type: 'game_result',
        gameId: 'hilo',
        won,
        payout: payout.toString(),
        newBalance: session.balance.toString(),
        state: { currentCard: newCard, previousCard: session.currentCard }
      };
    }
  },

  blackjack: (msg, session) => {
    if (msg.action === 'deal') {
      // Simple blackjack simulation
      const playerHand = [randomCard(), randomCard()];
      const dealerHand = [randomCard(), randomCard()];
      session.blackjack = { playerHand, dealerHand, bet: BigInt(msg.amount) };
      session.balance -= BigInt(msg.amount);
      return {
        type: 'game_state',
        gameId: 'blackjack',
        state: {
          playerHand,
          dealerUpCard: dealerHand[0],
          playerTotal: handTotal(playerHand),
          canHit: true,
          canStand: true,
          canDouble: playerHand.length === 2,
          canSplit: playerHand[0].rank === playerHand[1].rank
        }
      };
    }
    if (msg.action === 'hit' || msg.action === 'stand' || msg.action === 'double') {
      const game = session.blackjack;
      if (msg.action === 'hit') {
        game.playerHand.push(randomCard());
      }
      if (msg.action === 'double') {
        session.balance -= game.bet;
        game.bet *= 2n;
        game.playerHand.push(randomCard());
      }
      const playerTotal = handTotal(game.playerHand);

      // Check bust or forced stand
      if (playerTotal > 21 || msg.action === 'stand' || msg.action === 'double') {
        // Dealer plays
        while (handTotal(game.dealerHand) < 17) {
          game.dealerHand.push(randomCard());
        }
        const dealerTotal = handTotal(game.dealerHand);
        const won = playerTotal <= 21 && (dealerTotal > 21 || playerTotal > dealerTotal);
        const push = playerTotal <= 21 && playerTotal === dealerTotal && dealerTotal <= 21;
        const payout = won ? game.bet * 2n : (push ? game.bet : 0n);
        session.balance += payout;

        return {
          type: 'game_result',
          gameId: 'blackjack',
          won,
          push,
          payout: payout.toString(),
          newBalance: session.balance.toString(),
          state: {
            playerHand: game.playerHand,
            dealerHand: game.dealerHand,
            playerTotal,
            dealerTotal,
            outcome: push ? 'push' : (won ? 'win' : 'loss')
          }
        };
      }

      return {
        type: 'game_state',
        gameId: 'blackjack',
        state: {
          playerHand: game.playerHand,
          dealerUpCard: game.dealerHand[0],
          playerTotal,
          canHit: playerTotal < 21,
          canStand: true,
          canDouble: false,
          canSplit: false
        }
      };
    }
  },

  roulette: (msg, session) => {
    if (msg.action === 'spin') {
      const result = Math.floor(rand() * 37); // 0-36
      const bets = msg.bets || [{ type: msg.betType, amount: msg.amount }];
      let totalPayout = 0n;
      let totalBet = 0n;

      for (const bet of bets) {
        totalBet += BigInt(bet.amount);
        if (checkRouletteBet(bet.type, bet.number, result)) {
          totalPayout += BigInt(bet.amount) * BigInt(getRouletteMultiplier(bet.type));
        }
      }

      session.balance = session.balance - totalBet + totalPayout;
      const won = totalPayout > 0n;

      return {
        type: 'game_result',
        gameId: 'roulette',
        won,
        result,
        payout: totalPayout.toString(),
        newBalance: session.balance.toString()
      };
    }
  },

  // Generic handler for other games
  default: (msg, session) => {
    const won = generateResult(randomBytes(32).toString('hex'));
    const amount = BigInt(msg.amount || 1000000);
    const payout = won ? amount * 2n : 0n;
    session.balance = session.balance - amount + payout;

    return {
      type: 'game_result',
      gameId: msg.gameId,
      won,
      payout: payout.toString(),
      newBalance: session.balance.toString()
    };
  }
};

function randomCard() {
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  return {
    rank: ranks[Math.floor(rand() * 13)],
    suit: suits[Math.floor(rand() * 4)]
  };
}

function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (['K', 'Q', 'J'].includes(card.rank)) return 10;
  return parseInt(card.rank);
}

function handTotal(hand) {
  let total = hand.reduce((sum, card) => sum + cardValue(card), 0);
  let aces = hand.filter(c => c.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function checkRouletteBet(type, number, result) {
  const red = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  switch (type) {
    case 'RED': return red.includes(result);
    case 'BLACK': return result > 0 && !red.includes(result);
    case 'ODD': return result > 0 && result % 2 === 1;
    case 'EVEN': return result > 0 && result % 2 === 0;
    case 'LOW': return result >= 1 && result <= 18;
    case 'HIGH': return result >= 19 && result <= 36;
    case 'STRAIGHT': return result === number;
    default: return false;
  }
}

function getRouletteMultiplier(type) {
  switch (type) {
    case 'STRAIGHT': return 36;
    case 'SPLIT': return 18;
    case 'STREET': return 12;
    case 'CORNER': return 9;
    case 'SIX_LINE': return 6;
    case 'DOZEN': case 'COLUMN': return 3;
    default: return 2; // RED, BLACK, ODD, EVEN, LOW, HIGH
  }
}

// HTTP server for health checks
const http = createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }));
  } else if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`mock_backend_sessions ${sessions.size}\nmock_backend_up 1\n`);
  } else {
    res.writeHead(404);
    res.end();
  }
});

// WebSocket server
const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws, req) => {
  const sessionId = randomBytes(16).toString('hex');
  const session = {
    id: sessionId,
    balance: INITIAL_BALANCE,
    authenticated: false,
    currentGame: null
  };
  sessions.set(sessionId, session);

  console.log(`[${new Date().toISOString()}] Client connected: ${sessionId}`);

  // Send initial state
  ws.send(JSON.stringify({
    type: 'connected',
    sessionId,
    serverTime: Date.now()
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`[${sessionId.slice(0, 8)}] <- ${msg.type || msg.action}`);

      let response;

      switch (msg.type) {
        case 'authenticate':
          session.authenticated = true;
          session.publicKey = msg.publicKey;
          response = {
            type: 'authenticated',
            balance: session.balance.toString(),
            sessionId
          };
          break;

        case 'faucet_claim':
          const faucetAmount = 1000_000000n;
          session.balance += faucetAmount;
          response = {
            type: 'faucet_result',
            success: true,
            amount: faucetAmount.toString(),
            newBalance: session.balance.toString(),
            message: 'FAUCET_CLAIMED'
          };
          break;

        case 'join_game':
          session.currentGame = msg.gameId;
          response = {
            type: 'game_joined',
            gameId: msg.gameId,
            state: null,
            balance: session.balance.toString()
          };
          break;

        case 'leave_game':
          session.currentGame = null;
          response = {
            type: 'game_left',
            gameId: msg.gameId
          };
          break;

        case 'game_action':
        case 'place_bet':
          const gameId = msg.gameId || session.currentGame || 'default';
          const handler = gameHandlers[gameId] || gameHandlers.default;
          response = handler(msg, session);
          break;

        case 'get_balance':
          response = {
            type: 'balance',
            balance: session.balance.toString()
          };
          break;

        case 'ping':
          response = { type: 'pong', timestamp: Date.now() };
          break;

        default:
          response = {
            type: 'error',
            code: 'UNKNOWN_MESSAGE_TYPE',
            message: `Unknown message type: ${msg.type}`
          };
      }

      if (response) {
        console.log(`[${sessionId.slice(0, 8)}] -> ${response.type}`);
        ws.send(JSON.stringify(response));
      }

    } catch (e) {
      console.error(`[${sessionId.slice(0, 8)}] Parse error:`, e.message);
      ws.send(JSON.stringify({
        type: 'error',
        code: 'PARSE_ERROR',
        message: e.message
      }));
    }
  });

  ws.on('close', () => {
    console.log(`[${new Date().toISOString()}] Client disconnected: ${sessionId}`);
    sessions.delete(sessionId);
  });

  ws.on('error', (err) => {
    console.error(`[${sessionId.slice(0, 8)}] WebSocket error:`, err.message);
  });
});

// Start server
http.listen(PORT, () => {
  console.log(`
========================================
  Mock Backend for E2E Tests
========================================
  WebSocket: ws://localhost:${PORT}
  Health:    http://localhost:${PORT}/healthz
  Metrics:   http://localhost:${PORT}/metrics

  Initial balance: ${INITIAL_BALANCE.toString()} (${Number(INITIAL_BALANCE) / 1_000000} tokens)

  Press Ctrl+C to stop
========================================
`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down mock backend...');
  wss.close();
  http.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  wss.close();
  http.close();
  process.exit(0);
});
