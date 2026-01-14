# Mobile Integration Testing Framework

Comprehensive integration testing suite for all Nullspace casino games. Tests real WebSocket connections to the gateway and validates complete game flows.

## Overview

This testing framework provides:
- ✅ Real WebSocket connections to gateway (no mocks)
- ✅ Detailed structured logging with timestamps
- ✅ Balance tracking and validation
- ✅ Reconnection scenario testing
- ✅ Comprehensive game flow testing
- ✅ JSON test result reports
- ✅ Game statistics (RTP, win rate, P/L)

## Quick Start

### Prerequisites

```bash
# Install dependencies
npm install

# Install additional test dependencies
npm install --save-dev ws @types/ws ts-node
```

### Running Tests

**Run all tests:**
```bash
# Using default gateway (wss://api.testnet.regenesis.dev)
npx ts-node tests/integration/runTests.ts

# Specify custom gateway URL
npx ts-node tests/integration/runTests.ts ws://your-gateway:9010

# Or using environment variable
GATEWAY_URL=ws://your-gateway:9010 npx ts-node tests/integration/runTests.ts
```

**Run individual game test:**
```bash
npx ts-node -e "import('./tests/integration/games/BlackjackTest').then(m => new m.BlackjackTest({ gatewayUrl: 'wss://api.testnet.regenesis.dev' }).run())"
```

## Architecture

### Framework Components

```
tests/integration/
├── framework/
│   ├── TestLogger.ts          # Structured logging with timestamps
│   ├── WebSocketTestClient.ts # Real WebSocket connection manager
│   └── BaseGameTest.ts        # Base class for all game tests
├── games/
│   ├── BlackjackTest.ts       # Blackjack-specific tests
│   ├── HiLoTest.ts            # Hi-Lo-specific tests
│   ├── RouletteTest.ts        # Roulette-specific tests
│   └── ... (more games)
├── runTests.ts                # Test runner and report generator
└── results/                   # JSON test results (auto-created)
```

### Test Flow

1. **Setup Phase**
   - Connect to WebSocket gateway
   - Wait for `session_ready` message
   - Get initial balance

2. **Test Phase**
   - Run game-specific test scenarios
   - Track balance changes
   - Record game results
   - Log all messages and actions

3. **Reconnection Test**
   - Disconnect and reconnect
   - Verify session persists
   - Verify balance maintained

4. **Teardown Phase**
   - Get final balance
   - Disconnect from gateway
   - Generate test report

## Writing New Game Tests

### Example: Creating a New Game Test

```typescript
import { BaseGameTest, GameTestConfig } from '../framework/BaseGameTest';

export class MyGameTest extends BaseGameTest {
  constructor(config: Omit<GameTestConfig, 'testName'>) {
    super({ ...config, testName: 'MyGame' });
  }

  async runGameTests(): Promise<void> {
    this.logger.info('=== Running MyGame Tests ===');

    await this.testBasicFlow();
    await this.testSpecialAction();
  }

  private async testBasicFlow(): Promise<void> {
    this.logger.info('--- Test: Basic Flow ---');

    const betAmount = 10;

    // Start game
    this.client.send({
      type: 'start_game',
      gameType: 'mygame',
      bet: betAmount.toString(),
    });

    // Wait for game started
    const gameStarted = await this.assertMessageReceived('game_started');

    // Make game action
    this.client.send({
      type: 'game_move',
      action: 'my_action',
    });

    // Wait for result
    const gameResult = await this.assertMessageReceived('game_result');
    const won = gameResult.won as boolean;
    const payout = parseFloat(gameResult.payout as string);

    // Record result
    this.recordGameResult(betAmount, won ? 'won' : 'lost', payout);

    // Validate balance
    const expectedBalance = this.currentBalance + payout - betAmount;
    this.assertBalanceUpdated(expectedBalance, this.currentBalance);
  }

  private async testSpecialAction(): Promise<void> {
    // Implement game-specific test scenarios
  }
}
```

### BaseGameTest API

**Setup/Teardown:**
- `setup()` - Connect and establish session (auto-called)
- `teardown()` - Disconnect and generate report (auto-called)

**Assertions:**
- `assertBalanceUpdated(expected, actual, tolerance?)` - Verify balance
- `assertMessageReceived(messageType, timeout?)` - Wait for message

**Recording:**
- `recordGameResult(bet, result, payout)` - Track game outcome

**Testing:**
- `testReconnection()` - Test reconnection scenario (auto-called)

**Properties:**
- `client` - WebSocket test client
- `logger` - Test logger
- `currentBalance` - Current balance
- `sessionId` - Current session ID

## Test Results

### JSON Report Structure

Results are saved to `tests/integration/results/test-results-[timestamp].json`:

```json
{
  "timestamp": "2026-01-05T10:30:00.000Z",
  "gatewayUrl": "wss://api.testnet.regenesis.dev",
  "tests": {
    "Blackjack": {
      "passed": true,
      "duration": 12500,
      "errors": [],
      "warnings": [],
      "gameResults": [
        {
          "bet": 10,
          "result": "won",
          "payout": 20,
          "balanceChange": 10
        }
      ]
    }
  },
  "summary": {
    "total": 3,
    "passed": 3,
    "failed": 0,
    "totalErrors": 0,
    "totalWarnings": 0
  }
}
```

### Console Output

The test runner provides detailed console output:

```
╔══════════════════════════════════════════════════════════════╗
║         Nullspace Mobile Integration Test Suite             ║
╚══════════════════════════════════════════════════════════════╝

Gateway URL: wss://api.testnet.regenesis.dev
Start Time: 2026-01-05T10:30:00.000Z

================================================================================
Running: Blackjack
================================================================================
[0.50s] [INFO] [Blackjack] Connecting to wss://api.testnet.regenesis.dev
[1.20s] [SUCCESS] [Blackjack] WebSocket connected
[1.35s] [SUCCESS] [Blackjack] Session established
...
✓ Blackjack PASSED (12.50s)

================================================================================
FINAL TEST SUMMARY
================================================================================

Total Tests: 3
✓ Passed: 3
✗ Failed: 0
⚠ Total Warnings: 0
✗ Total Errors: 0

Game Statistics:
  Total Games Played: 25
  Wins: 12 (48.0%)
  Total Bet: 250.00
  Total Payout: 245.50
  Net P/L: -4.50
  RTP: 98.20%

================================================================================
✓ ALL TESTS PASSED
================================================================================
```

## Game Coverage

### ✅ All Tests Implemented (10/10)

- ✅ **Blackjack** - Basic game, hit/stand, double down, multiple hands, blackjack detection
- ✅ **Hi-Lo** - Immediate cashout, multiple predictions, higher/lower predictions, streak tracking
- ✅ **Roulette** - Single bet, multiple bets (atomic batch), color bets, straight number bets
- ✅ **Craps** - Pass/don't pass, field bets, multiple bets (atomic batch), YES bets
- ✅ **Baccarat** - Player/banker/tie bets, multiple bets (atomic batch), player pair side bet
- ✅ **Sic Bo** - Small/big bets, single number, total bets, multiple bets (atomic batch)
- ✅ **Video Poker** - Hold/draw mechanics, selective hold, hold all, hold none (replace all)
- ✅ **Casino War** - Deal, war on tie, surrender on tie, tie bet side bet
- ✅ **Three Card Poker** - Ante, pairplus side bet, play decision, fold decision
- ✅ **Ultimate Hold'em** - Bet 4x/3x/2x/1x, check, fold, ante+blind mechanics

## Testing Scenarios

Each game test covers:

1. **Basic Flow** - Minimum bet → action → result
2. **Multiple Actions** - Complex game flows
3. **Balance Validation** - Verify balance updates
4. **Payout Verification** - Verify correct payout ratios
5. **Reconnection** - Disconnect → reconnect → verify state
6. **Edge Cases** - Game-specific edge cases

## Logging Levels

- **DEBUG** - Verbose details (message payloads, etc.)
- **INFO** - Test progress and state changes
- **WARN** - Non-fatal issues
- **ERROR** - Test failures and fatal errors
- **SUCCESS** - Successful operations

## Best Practices

### 1. Test Isolation
Each test should be independent and not rely on previous test state.

### 2. Balance Tracking
Always verify balance before and after game operations.

### 3. Message Handling
Use `waitForMessage()` with appropriate timeouts for asynchronous responses.

### 4. Error Handling
Wrap risky operations in try/catch and use logger.error() to record failures.

### 5. Game State
Record game results for reporting and analysis.

## Troubleshooting

### Connection Failures

**Symptom**: `WebSocket connection timeout`

**Solutions**:
- Verify gateway is running: `curl https://api.testnet.regenesis.dev/healthz`
- Check gateway URL is correct
- Ensure firewall allows connection
- Increase timeout in test config

### Session Issues

**Symptom**: `Timeout waiting for message type: session_ready`

**Solutions**:
- Verify authentication is working
- Check gateway logs for errors
- Ensure crypto keys are initialized

### Balance Mismatch

**Symptom**: `Balance mismatch: expected X, got Y`

**Solutions**:
- Check for pending transactions
- Verify game result messages
- Review balance calculation logic
- Check for race conditions in balance updates

### Message Queue

**Symptom**: Messages arriving out of order

**Solutions**:
- Use `waitForMessage()` instead of direct queue access
- Clear queue between tests if needed: `client.clearQueue()`
- Add appropriate delays between rapid operations

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Mobile Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      gateway:
        image: nullspace/gateway:latest
        ports:
          - 9010:9010

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install Dependencies
        run: npm install

      - name: Run Integration Tests
        run: npx ts-node tests/integration/runTests.ts wss://api.testnet.regenesis.dev

      - name: Upload Results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: tests/integration/results/
```

## Contributing

When adding new game tests:

1. Create new test file in `tests/integration/games/`
2. Extend `BaseGameTest`
3. Implement `runGameTests()` method
4. Add game-specific test scenarios
5. Add test to `runTests.ts`
6. Update this README with coverage status

## Additional Resources

- [WebSocket Protocol Spec](../../docs/protocol.md)
- [Gateway API Documentation](../../docs/gateway-api.md)
- [Mobile App Architecture](../../docs/mobile-architecture.md)

---

**Last Updated**: 2026-01-05
**Status**: ✅ **COMPLETE** - Framework complete, all 10/10 games implemented
**Next**: Run tests against local/staging gateway and validate end-to-end
