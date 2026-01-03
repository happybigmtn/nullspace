# E09 - Mobile app architecture (from scratch)

Focus files: `mobile/App.tsx`, `mobile/src/hooks/useGatewaySession.ts`

Goal: explain how the mobile app boots, connects to the gateway, and updates UI state from WebSocket messages. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) React Native entrypoint
`App.tsx` is the root component for Expo. It wires providers, navigation, and app-wide lifecycle hooks.

### 2) WebSocket session management
The mobile client uses a WebSocket connection to the gateway. It listens for messages and updates local state.

### 3) Analytics and event tracking
The mobile app tracks session and game events to support product analytics and troubleshooting.

---

## Limits & management callouts (important)

1) **WebSocket reconnects on foreground**
- The app reconnects when returning to the foreground.
- If reconnect logic is too aggressive, it can spam the gateway.

2) **Balance parsing expects numeric strings**
- If the gateway changes balance formats, parsing will fail.

---

## Walkthrough with code excerpts

### 1) App entrypoint and providers
```rust
function App() {
  // Handle app lifecycle state persistence
  useAppState();

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <AuthProvider>
        <WebSocketProvider>
          <GatewaySessionBridge>
            <RootNavigator />
          </GatewaySessionBridge>
        </WebSocketProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

registerRootComponent(App);
```

Why this matters:
- This is where global context and navigation are initialized.

What this code does:
- Initializes app state persistence.
- Wraps the UI in auth and WebSocket providers.
- Registers the root component with Expo.

---

### 2) Bootstrapping the gateway session
```rust
useEffect(() => {
  if (connectionState === 'connected') {
    send({ type: 'get_balance' });
  }
}, [connectionState, send]);

useEffect(() => {
  if (!lastMessage) return;

  if (lastMessage.type === 'session_ready') {
    lastSessionIdRef.current = lastMessage.sessionId;
    setSessionInfo({
      sessionId: lastMessage.sessionId,
      publicKey: lastMessage.publicKey,
      registered: lastMessage.registered,
      hasBalance: lastMessage.hasBalance,
    });
    setAnalyticsContext({ publicKey: lastMessage.publicKey });
    void track('casino.session.started', {
      source: 'mobile',
      registered: lastMessage.registered,
      hasBalance: lastMessage.hasBalance,
    });
    const readyBalance = parseNumeric(lastMessage.balance);
    if (readyBalance !== null) {
      setBalance(readyBalance);
      setBalanceReady(true);
    }
    send({ type: 'get_balance' });
    return;
  }

  if (lastMessage.type === 'balance') {
    setSessionInfo({
      publicKey: lastMessage.publicKey,
      registered: lastMessage.registered,
      hasBalance: lastMessage.hasBalance,
    });
    const balanceValue = parseNumeric(lastMessage.balance);
    if (balanceValue !== null) {
      setBalance(balanceValue);
      setBalanceReady(true);
    }
    if (lastMessage.message === 'FAUCET_CLAIMED') {
      setFaucetStatus('success', 'Faucet claimed');
      void track('casino.faucet.claimed', { source: 'mobile' });
    }
    return;
  }
}, [lastMessage, send, setBalance, setBalanceReady, setSessionInfo, setFaucetStatus, faucetStatus]);
```

Why this matters:
- This is how the app learns its session ID, registration state, and balance.

What this code does:
- Requests balance when the socket connects.
- Handles `session_ready` and `balance` messages to update state.
- Tracks analytics events for session start and faucet claims.

---

### 3) Faucet request helper
```rust
const requestFaucet = useCallback((amount?: number) => {
  setFaucetStatus('pending', 'Requesting faucet...');
  if (typeof amount === 'number' && amount > 0) {
    send({ type: 'faucet_claim', amount });
  } else {
    send({ type: 'faucet_claim' });
  }
}, [send, setFaucetStatus]);
```

Why this matters:
- This provides the user’s primary on-ramp into the casino economy.

What this code does:
- Sends a faucet claim message, optionally with an amount.
- Updates UI state to show pending status.

---

## Key takeaways
- The mobile app is provider-driven: auth + WebSocket + navigation.
- The gateway session hook is responsible for balance and session state.
- Analytics events are emitted alongside key lifecycle events.

## Next lesson
E10 - Web app architecture: `feynman/lessons/E10-web-app.md`
