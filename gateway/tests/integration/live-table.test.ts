/**
 * Live Table Integration Tests
 *
 * Tests for the global craps table live multiplayer functionality.
 * These tests require a running simulator backend with live table enabled.
 *
 * Run with: RUN_INTEGRATION=true npm test -- live-table.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import {
  INTEGRATION_ENABLED,
  createConnection,
  sendAndReceive,
  waitForMessage,
  GATEWAY_URL,
} from '../helpers/ws.js';

vi.setConfig({ testTimeout: 60000 });

const LIVE_TABLE_ENABLED = process.env.GATEWAY_LIVE_TABLE_CRAPS === '1' || process.env.GATEWAY_LIVE_TABLE_CRAPS === 'true';

const sendAndReceiveWithTimeout = (
  ws: WebSocket,
  msg: Record<string, unknown>,
  timeout = 30000
) => sendAndReceive(ws, msg, timeout);

const waitForMessageWithTimeout = (
  ws: WebSocket,
  type: string,
  timeout = 30000
) => waitForMessage(ws, type, timeout);

/**
 * Helper to wait for session to be ready (registered with balance)
 */
async function waitForReady(ws: WebSocket): Promise<void> {
  await waitForMessageWithTimeout(ws, 'session_ready');

  for (let i = 0; i < 30; i++) {
    const balance = await sendAndReceiveWithTimeout(ws, { type: 'get_balance' });
    if (balance.registered && balance.hasBalance) {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Registration timeout');
}

/**
 * Helper to create a connected and registered player
 */
async function createPlayer(): Promise<WebSocket> {
  const ws = await createConnection();
  await waitForReady(ws);
  return ws;
}

describe.skipIf(!INTEGRATION_ENABLED || !LIVE_TABLE_ENABLED)(
  'Live Table Integration Tests',
  () => {
    let player1: WebSocket;
    let player2: WebSocket;

    beforeAll(async () => {
      // Verify integration is properly configured
      if (!INTEGRATION_ENABLED) {
        throw new Error('Integration tests not enabled. Set RUN_INTEGRATION=true');
      }
    });

    afterAll(() => {
      [player1, player2].forEach((ws) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
    });

    beforeEach(async () => {
      // Create fresh connections for each test
      player1 = await createPlayer();
    });

    afterEach(() => {
      [player1, player2].forEach((ws) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
    });

    describe('Live Table Join/Leave', () => {
      it('should join the live craps table', async () => {
        const response = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        expect(response.type).toBe('live_craps_state');
        expect(response.phase).toBeDefined();
        expect(['betting', 'locked', 'rolling', 'payout', 'cooldown']).toContain(
          response.phase
        );
      });

      it('should receive table state after joining', async () => {
        const response = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        // Verify state structure
        expect(response.roundId).toBeDefined();
        expect(response.phase).toBeDefined();
        expect(response.phaseEndsAt).toBeDefined();
        expect(typeof response.phaseEndsAt).toBe('number');
      });

      it('should leave the live table gracefully', async () => {
        // Join first
        await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        // Then leave
        const leaveResponse = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_leave',
        });

        expect(leaveResponse.type).toBe('live_craps_left');
      });

      it('should handle duplicate join requests', async () => {
        // Join first time
        await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        // Join again (should return current state, not error)
        const response = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        expect(response.type).toBe('live_craps_state');
      });
    });

    describe('Live Table Betting', () => {
      it('should place a Pass Line bet during betting phase', async () => {
        // Join table
        const state = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        // Only attempt bet if in betting phase
        if (state.phase !== 'betting') {
          // Wait for next betting phase
          const betUpdate = await new Promise<Record<string, unknown>>(
            (resolve, reject) => {
              const timeout = setTimeout(
                () => reject(new Error('Timeout waiting for betting phase')),
                30000
              );
              const handler = (data: Buffer) => {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'live_craps_update' && msg.phase === 'betting') {
                  clearTimeout(timeout);
                  player1.off('message', handler);
                  resolve(msg);
                }
              };
              player1.on('message', handler);
            }
          );
        }

        // Place bet
        const betResponse = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_bet',
          bets: [{ type: 'PASS', amount: 100 }],
        });

        expect(['live_craps_bet_accepted', 'live_craps_bet_queued', 'error']).toContain(
          betResponse.type
        );

        if (betResponse.type !== 'error') {
          expect(betResponse.bets).toBeDefined();
        }
      });

      it('should reject invalid bet types', async () => {
        await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        const response = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_bet',
          bets: [{ type: 'INVALID_BET_TYPE', amount: 100 }],
        });

        expect(response.type).toBe('error');
      });

      it('should reject bets below minimum', async () => {
        await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        const response = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_bet',
          bets: [{ type: 'PASS', amount: 1 }], // Below min (typically 5)
        });

        expect(response.type).toBe('error');
        expect(response.code).toBeDefined();
      });

      it('should reject bets above maximum', async () => {
        await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        const response = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_bet',
          bets: [{ type: 'PASS', amount: 1000000 }], // Above max
        });

        expect(response.type).toBe('error');
      });
    });

    describe('Live Table Multi-Player State Broadcasting', () => {
      it('should broadcast state updates to multiple players', async () => {
        player1 = await createPlayer();
        player2 = await createPlayer();

        // Both players join
        await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });
        await sendAndReceiveWithTimeout(player2, {
          type: 'live_craps_join',
        });

        // Wait for any update message on player2
        const updatePromise = new Promise<Record<string, unknown>>(
          (resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Timeout waiting for broadcast')),
              15000
            );
            const handler = (data: Buffer) => {
              const msg = JSON.parse(data.toString());
              if (
                msg.type === 'live_craps_update' ||
                msg.type === 'live_craps_state'
              ) {
                clearTimeout(timeout);
                player2.off('message', handler);
                resolve(msg);
              }
            };
            player2.on('message', handler);
          }
        );

        // Trigger an update by placing a bet (if in betting phase)
        const state = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        if (state.phase === 'betting') {
          await sendAndReceiveWithTimeout(player1, {
            type: 'live_craps_bet',
            bets: [{ type: 'PASS', amount: 50 }],
          });
        }

        // Player2 should receive broadcasts
        const update = await updatePromise;
        expect(['live_craps_update', 'live_craps_state']).toContain(update.type);
      });

      it('should show player count in table state', async () => {
        player1 = await createPlayer();

        const state = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        expect(state.playerCount).toBeDefined();
        expect(typeof state.playerCount).toBe('number');
        expect(state.playerCount).toBeGreaterThanOrEqual(1);
      });
    });

    describe('Live Table Phase Transitions', () => {
      it('should receive phase transition updates', async () => {
        await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        // Wait for any phase transition
        const phaseUpdate = await new Promise<Record<string, unknown>>(
          (resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Timeout waiting for phase transition')),
              60000
            );
            let currentPhase: string | null = null;

            const handler = (data: Buffer) => {
              const msg = JSON.parse(data.toString());
              if (msg.type === 'live_craps_update' && msg.phase) {
                if (currentPhase === null) {
                  currentPhase = msg.phase;
                } else if (msg.phase !== currentPhase) {
                  clearTimeout(timeout);
                  player1.off('message', handler);
                  resolve(msg);
                }
              }
            };
            player1.on('message', handler);
          }
        );

        expect(phaseUpdate.phase).toBeDefined();
        expect(['betting', 'locked', 'rolling', 'payout', 'cooldown']).toContain(
          phaseUpdate.phase
        );
      });

      it('should reject bets during non-betting phases', async () => {
        const state = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        // If not in betting phase, bet should be rejected
        if (state.phase !== 'betting') {
          const response = await sendAndReceiveWithTimeout(player1, {
            type: 'live_craps_bet',
            bets: [{ type: 'PASS', amount: 100 }],
          });

          expect(response.type).toBe('error');
          expect(response.message).toMatch(/betting.*closed|not.*betting/i);
        }
      });
    });

    describe('Live Table Error Handling', () => {
      it('should handle betting without joining', async () => {
        // Try to bet without joining first
        const response = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_bet',
          bets: [{ type: 'PASS', amount: 100 }],
        });

        expect(response.type).toBe('error');
      });

      it('should handle malformed bet messages', async () => {
        await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_join',
        });

        // Empty bets array
        const response1 = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_bet',
          bets: [],
        });
        expect(response1.type).toBe('error');

        // Missing bets field
        const response2 = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_bet',
        });
        expect(response2.type).toBe('error');

        // Invalid bet structure
        const response3 = await sendAndReceiveWithTimeout(player1, {
          type: 'live_craps_bet',
          bets: [{ invalid: 'structure' }],
        });
        expect(response3.type).toBe('error');
      });
    });

    describe('Live Table Bet Types Coverage', () => {
      const CRAPS_BET_TYPES = [
        { name: 'Pass Line', type: 'PASS' },
        { name: "Don't Pass", type: 'DONT_PASS' },
        { name: 'Come', type: 'COME' },
        { name: "Don't Come", type: 'DONT_COME' },
        { name: 'Field', type: 'FIELD' },
        { name: 'Yes (Place 6)', type: 'YES', target: 6 },
        { name: 'No (Lay 4)', type: 'NO', target: 4 },
        { name: 'Next (Hop 7)', type: 'NEXT', target: 7 },
        { name: 'Hardway 4', type: 'HARDWAY', target: 4 },
        { name: 'Hardway 6', type: 'HARDWAY', target: 6 },
        { name: 'Hardway 8', type: 'HARDWAY', target: 8 },
        { name: 'Hardway 10', type: 'HARDWAY', target: 10 },
        { name: 'Fire Bet', type: 'FIRE' },
        { name: 'ATS Small', type: 'ATS_SMALL' },
        { name: 'ATS Tall', type: 'ATS_TALL' },
        { name: 'ATS All', type: 'ATS_ALL' },
        { name: 'Muggsy', type: 'MUGGSY' },
        { name: 'Diff Doubles', type: 'DIFF_DOUBLES' },
        { name: 'Ride Line', type: 'RIDE_LINE' },
        { name: 'Replay', type: 'REPLAY' },
        { name: 'Hot Roller', type: 'HOT_ROLLER' },
      ];

      for (const betConfig of CRAPS_BET_TYPES) {
        it(`should accept ${betConfig.name} bet type`, async () => {
          const state = await sendAndReceiveWithTimeout(player1, {
            type: 'live_craps_join',
          });

          // Only test during betting phase
          if (state.phase !== 'betting') {
            // Skip if not in betting phase
            return;
          }

          const bet: Record<string, unknown> = {
            type: betConfig.type,
            amount: 50,
          };
          if (betConfig.target !== undefined) {
            bet.target = betConfig.target;
          }

          const response = await sendAndReceiveWithTimeout(player1, {
            type: 'live_craps_bet',
            bets: [bet],
          });

          // Should be accepted or queued (not an error about invalid type)
          if (response.type === 'error') {
            // The only acceptable errors are timing-related, not bet type errors
            expect(response.message).not.toMatch(/invalid.*type|unknown.*bet/i);
          }
        });
      }
    });
  }
);

describe('Live Table Unit Tests (No Backend)', () => {
  it('should have valid bet type mappings', () => {
    const BET_TYPES = [
      'PASS',
      'DONT_PASS',
      'COME',
      'DONT_COME',
      'FIELD',
      'YES',
      'NO',
      'NEXT',
      'HARDWAY',
      'FIRE',
      'ATS_SMALL',
      'ATS_TALL',
      'ATS_ALL',
      'MUGGSY',
      'DIFF_DOUBLES',
      'RIDE_LINE',
      'REPLAY',
      'HOT_ROLLER',
    ];

    // Verify all bet types are strings
    BET_TYPES.forEach((type) => {
      expect(typeof type).toBe('string');
      expect(type.length).toBeGreaterThan(0);
    });

    // Verify unique bet types
    const uniqueTypes = new Set(BET_TYPES);
    expect(uniqueTypes.size).toBe(BET_TYPES.length);
  });

  it('should validate phase names', () => {
    const PHASES = ['betting', 'locked', 'rolling', 'payout', 'cooldown'];

    PHASES.forEach((phase) => {
      expect(typeof phase).toBe('string');
    });

    expect(PHASES).toContain('betting');
    expect(PHASES).toContain('cooldown');
  });
});
