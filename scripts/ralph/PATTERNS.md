# Nullspace Development Patterns

Consolidated technical reference from testnet production, QA testing, design system implementation, and luxury redesign work.

---

## Table of Contents

1. [Execution Layer (Rust)](#execution-layer-rust)
2. [Gateway (TypeScript)](#gateway-typescript)
3. [Mobile (React Native)](#mobile-react-native)
4. [Protocol](#protocol-nullspaceprotocol)
5. [Website (React)](#website-react)
6. [CI/CD](#cicd-github-actions)
7. [Testing](#testing)
8. [Observability](#observability)
9. [Infrastructure](#infrastructure)
10. [Design System](#design-system)
11. [QA & Browser Automation](#qa--browser-automation)
12. [Common Patterns](#common-patterns)

---

## Execution Layer (Rust)

### Game Architecture
- All casino games implement `CasinoGame` trait
- State blob versioning: v2 → v3 → v4 with migration support
- Deterministic RNG: SHA256 hash-chain from consensus seed
- Event logging: MMR-based append-only with crash recovery

### Error Handling
```rust
// Error codes mapped in execution/src/layer/handlers/casino.rs
ERROR_INVALID_PAYLOAD = 16    // Malformed/truncated payload
ERROR_INVALID_MOVE = 9         // Wrong action for current state
ERROR_SESSION_COMPLETE = 8     // Game already finished
ERROR_INVALID_STATE = 17       // Corrupted state blob
ERROR_DECK_EXHAUSTED = 18      // No more cards available
```

### Testing
```bash
cargo test --workspace                    # All 406 tests
cargo test -p nullspace-execution <game>  # Game-specific tests
cargo test -p nullspace-execution rtp     # RTP verification
```

---

## Gateway (TypeScript)

### Configuration Validation
```typescript
// gateway/src/config/validation.ts
// Rejects values containing 'example' in production
// Required: GATEWAY_ORIGIN, METRICS_AUTH_TOKEN, ALLOWED_ORIGINS
```

### Rate Limiting
```typescript
MAX_CONNECTIONS_PER_IP = 200      // Per-IP WebSocket limit
MAX_TOTAL_SESSIONS = 20000        // Global session cap
GATEWAY_MAX_MESSAGE_SIZE = 65536  // 64KB message limit
```

### Session Management
```typescript
// Mark-and-sweep pattern prevents cleanup races
session.markedForCleanup = true   // Mark phase
// ... then iterate collected array to destroy (sweep phase)
```

### Health Endpoints
```typescript
GET /healthz   // Readiness probe (checks backend connectivity)
GET /livez     // Liveness probe (no dependencies)
GET /readyz    // Alias for /healthz
// Returns 503 when draining or backend unreachable
```

### Graceful Shutdown
```typescript
GATEWAY_DRAIN_TIMEOUT_MS = 30000  // Wait for active games
// Process: mark draining → persist nonces → wait for games →
//         send SESSION_EXPIRED → close (1001) → shutdown
```

---

## Mobile (React Native)

### Cryptography
```typescript
// Ed25519 signing (via @noble/curves/ed25519)
// PBKDF2 key derivation (250k iterations)
// AES-GCM storage encryption
// XChaCha20-Poly1305 vault encryption (timing-safe)
```

### WebSocket
```typescript
// Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s cap
MAX_RECONNECT_ATTEMPTS = 10
MESSAGE_TIMEOUT_MS = 30000        // Expire stale messages
MAX_QUEUE_SIZE = 50               // Message queue cap

// Idempotency via message IDs
generateMessageId() => `${timestamp}-${counter}`
sentMessageIdsRef                 // Deduplicates on reconnect
```

### Storage
```typescript
// MMKV (native) → AsyncStorage (RN) → WebStorage (web) fallback
// Tutorial completion: isTutorialCompleted(gameId)
// Bet history: MAX_BET_HISTORY_ENTRIES = 500
```

### Theme System
```typescript
// Dark mode with OLED optimization
DARK_COLORS.background = '#000000'  // AMOLED battery savings
useTheme()                          // isDark, colorScheme
useThemedColors()                   // Color palette
useGlow()                           // Dark mode glow effects
```

### Typography
```typescript
// Design tokens integration
FONT_DISPLAY: 'Outfit'              // Headlines
FONT_BODY: 'Plus Jakarta Sans'      // Body text
fontVariant: ['tabular-nums']       // Balance/bet displays (no jumping)
```

### Animations
```typescript
// Reanimated patterns
withSequence()                      // Multi-phase animations
withSpring()                        // Physics-based
interpolateColor()                  // Color transitions
runOnJS()                           // Callback from worklet

// Common springs
SPRING.chipToss = { mass: 0.4, stiffness: 400, damping: 20 }
```

### Component Patterns
```typescript
// Memory leak prevention
const isMounted = useRef(true)
useEffect(() => () => { isMounted.current = false }, [])
if (!isMounted.current) return

// Balance updates with sequence numbers
balanceSeq                          // Monotonic counter
setBalanceWithSeq(balance, seq)     // Reject stale updates
```

---

## Protocol (@nullspace/protocol)

### Binary Message Format
```
[version:u8][opcode:u8][payload...]
```

### Version Handling
```typescript
CURRENT_PROTOCOL_VERSION = 1
withVersionHeader(payload)          // Prepend version
stripVersionHeader(data)            // Extract & validate
UnsupportedProtocolVersionError     // Graceful rejection
```

### Validation
```typescript
GameMessageSchema                   // Zod discriminated union
parseServerMessage()                // Safe parsing with errors
isGameResultMessage()               // Type guards
```

---

## Website (React)

### PWA Configuration
```javascript
// manifest.json with 192px, 512px, maskable icons
// Service worker: network-first navigation, stale-while-revalidate assets
// usePWA() hook for install prompts
// InstallBanner for Chrome + iOS Safari
```

### Security Headers
```nginx
# nginx.conf and nginx.ssl.conf
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'";
add_header X-Content-Type-Options "nosniff";
add_header X-Frame-Options "DENY";
add_header Referrer-Policy "strict-origin-when-cross-origin";
```

### Code Splitting
```javascript
// React.lazy() for all routes
// Vite manualChunks for vendor splitting
// Bundle limits: main<50KB, route<600KB, vendor<350KB
```

---

## CI/CD (GitHub Actions)

### Deployment
```yaml
concurrency:
  cancel-in-progress: false       # Avoid partial deploys
environment: production           # Approval gate
```

### Service Startup Order
```
simulator → validators → gateway → auth → website → ops
```

### Secrets Management
```bash
# SOPS + Age encryption
SOPS_AGE_KEY_*                    # Per-environment keys
./scripts/decrypt-secrets.sh      # Runtime decryption
```

---

## Testing

### Integration Tests
```bash
# Mobile E2E
detox build --configuration ios.sim.debug
detox test --headless --record-videos failing

# Gateway stress
RUN_STRESS=true vitest run tests/stress/websocket-stress.test.ts
STRESS_CONNECTIONS=1000           # 1k concurrent target

# Cross-service
tests/integration/                # Docker Compose stack
```

### Protocol Fuzzing
```bash
pnpm -C packages/protocol test test/fuzz.test.ts
FUZZ_ITERATIONS=1000000           # Extended fuzzing
```

---

## Observability

### Metrics
```typescript
// Gateway: JSON format at /metrics
// Simulator: Prometheus text at /metrics/prometheus
// Auth: both /metrics (JSON) and /metrics/prometheus

// RED pattern: Rate, Errors, Duration
// Bearer token auth via METRICS_AUTH_TOKEN
```

### Tracing
```typescript
// OpenTelemetry + Tempo
OTEL_EXPORTER_OTLP_ENDPOINT       // HTTP 4318, gRPC 4317
withSpan()                         // Wrap operations
traceId                            // W3C Trace Context format
```

### Alerting
```yaml
# Alertmanager with Slack + PagerDuty
critical: 10s group_wait          # Fast paging
warning: 30s group_wait           # Standard alerts
```

---

## Infrastructure

### Terraform Modules
```hcl
# terraform/modules/
network/                          # 10.0.0.0/16, subnets
firewall/                         # 6 firewall types
server/                           # Compute + cloud-init
load-balancer/                    # L4/L7 with health checks
```

### Capacity Planning
```
Staging: 5k concurrent (2x gateway, 3x validators)
Production: 20k+ concurrent (4x gateway, 4x validators)
```

---

## Design System

### Token Import Patterns

#### Web (Tailwind)
```javascript
import { TITANIUM, ACTION, GAME, TYPE_SCALE } from '@nullspace/design-tokens';

export default {
  theme: {
    extend: {
      colors: { titanium: TITANIUM, action: ACTION },
      fontSize: toTailwindFontSize(TYPE_SCALE),
    }
  }
}
```

#### Mobile (React Native)
```typescript
import { SHADOW, SPRING, TYPE_SCALE, STAGGER } from '@nullspace/design-tokens';

export const SHADOWS = {
  card: toRNShadow(SHADOW.md),
  // Include both shadowOffset/shadowRadius (iOS) and elevation (Android)
};
```

### Spring Animation Patterns

**Key Principle:** Springs feel premium because they "slowly and gradually come to rest" - no abrupt stopping.

#### Web (react-spring)
```typescript
import { useSpring } from '@react-spring/web';
import { SPRING_LIQUID_CONFIGS } from '@/utils/motion';

const style = useSpring({
  scale: pressed ? 0.95 : 1,
  config: SPRING_LIQUID_CONFIGS.button,
});
```

#### Mobile (Reanimated)
```typescript
import { withSpring } from 'react-native-reanimated';
import { SPRING } from '@/constants/theme';

pressProgress.value = withSpring(pressed ? 1 : 0, SPRING.button);
```

### Accessibility (WCAG AA)

**Critical Finding:** titanium-400 on titanium-50 = 2.42:1 (FAILS for normal text)

Solutions:
- **Primary text:** titanium-900 (17.18:1 ratio)
- **Body text:** titanium-600 (7.49:1 ratio)
- **Muted text:** titanium-500 (4.54:1 minimum for normal text)
- **Disabled text:** titanium-400 - ONLY for large text (18px+)

Accessible Action Colors:
- Success: `#15803d` (darker green, ~5.5:1)
- Error: `#b91c1c` (darker red, ~5.8:1)
- Warning: `#b45309` (darker orange, ~5.4:1)

### Reduced Motion Support

```css
/* Web */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

```typescript
// Mobile
const skipAnimation = useReducedMotion();
if (skipAnimation) return null; // or instant transition
```

### Animation Performance Budget
| Metric | Target | Acceptable |
|--------|--------|------------|
| Frame rate | 60fps | >55fps |
| JS thread (mobile) | <16ms | <32ms |
| Animation duration | <500ms | <1000ms |

### Glassmorphism Patterns

```css
/* Web */
backdrop-filter: blur(16px) brightness(1.1) saturate(1.2);
background: rgba(255, 255, 255, 0.15);
border: 1px solid rgba(255, 255, 255, 0.2);
```

```typescript
// Mobile (React Native)
import { BlurView } from 'expo-blur';
<BlurView intensity={80} tint="light">{/* content */}</BlurView>
```

### Game-Specific Physics

#### Chip Toss
```typescript
arcHeight: 40px
flightDuration: 280ms
tumbleRotations: 1.5 (360° × 1.5)
scatterRange: 6px horizontal, 3px vertical
```

#### Roulette Wheel
```typescript
initialVelocity: 720 deg/s (wheel), -1080 deg/s (ball opposite)
friction: 0.985 (wheel), 0.975 (ball - faster)
bounceCount: 4
bounceDecay: 0.6 (amplitude reduction)
```

---

## QA & Browser Automation

### Test Execution Flow
1. Navigate to http://localhost:8081
2. Complete auth if needed (new session)
3. From lobby, click target game
4. Execute bet placement via UI interactions
5. Capture screenshots at key states
6. Verify outcome matches expectations
7. Return to lobby for next test

### Game Complexity Rankings
1. **Baccarat** - 10 bet types (most complex betting)
2. **Craps** - Multi-phase betting with point tracking
3. **Video Poker** - Requires card selection before draw
4. **Roulette** - Multiple simultaneous bet types
5. **Blackjack** - Hit/stand/double/split actions

### Critical Betting Interaction
**Chips must be DRAGGED upward to place bet** (tap only selects)

### Infrastructure Setup
```bash
# Start local network
./scripts/start-local-network.sh --fresh

# Endpoints
Simulator: http://localhost:8080
Gateway: :9010
Mobile Web: http://localhost:8081 (cd mobile && npm run web)
```

### Known Bugs

| ID | Severity | Description |
|----|----------|-------------|
| BUG-003 | CRITICAL | Missing SafeAreaProvider crashes web app |
| BUG-002 | HIGH | Session not persisted on full page reload |
| BUG-001 | MEDIUM | Chip tap only selects, drag required to bet |

---

## Common Patterns

### Timing-Safe Operations
```typescript
// Use crypto.timingSafeEqual() for tokens
timingSafeStringEqual(a, b)       // Constant-time comparison
```

### Secure Randomness
```typescript
// Never use Math.random() for security
crypto.randomBytes(8)              // Node.js
crypto.getRandomValues()           // Browser
generateSecureId('prefix')         // Gateway helper
```

### Error Handling
```typescript
// Protocol: Only throw ProtocolError or subclasses
// Gateway: RFC 7807 Problem Details format
// Rust: Return Option/Result, log at boundaries
```

### State Management
```typescript
// Zustand pattern
getState()                         // Fresh read in callbacks
setState()                         // Batched updates
```

---

## Key Files Reference

```
docs/testnet-readiness-runbook.md      # Full deployment checklist
docs/limits.md                         # Rate limits
execution/src/casino/mod.rs            # Game dispatch
gateway/src/config/validation.ts       # Config validation
mobile/src/services/crypto.ts          # Crypto implementation
packages/protocol/src/version.ts       # Protocol versioning
terraform/README.md                    # IaC documentation
```

---

## Completed Work Summary

### Design System (ralph3) - 56 stories
All design tokens, animations, accessibility patterns completed across 9 phases.

### Luxury Redesign (ralph4) - 25 stories
Premium typography, decluttered game views, bet controls revolution, auth simplification, navigation refinement completed.

### QA Testing (ralph2) - 6 stories
Hi-Lo basic flow, lobby navigation, deposit flow, session management verified.

---

*Consolidated: 2026-01-08*
