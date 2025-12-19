# Super Mode: Revised Implementation Plan

## Executive Summary

After expert review (DHH-style pragmatism, Kieran-style type safety, and simplicity analysis), this plan has been **dramatically simplified**. The original 3-week, 3500+ line proposal is now a **1-week, ~300 line MVP** focused on the two things that actually matter:

1. **Staged reveal animations** (entertainment value)
2. **RTP adjustments** (95-99% target)

Everything else is deferred until we have real user data.

---

## Review Feedback Summary

| Reviewer | Key Criticism | Action Taken |
|----------|---------------|--------------|
| DHH | "Ship in 5 days, not 3 weeks" | Reduced to 1-week MVP |
| DHH | "RevealPhase is frontend state in backend" | Removed from backend |
| Kieran | "aura_meter missing from SuperModeState" | Added to type definition |
| Kieran | "No skip button for animations" | Added requirement |
| Kieran | "Fee calculation for atomic batches undefined" | Documented |
| Simplicity | "92% of plan is unnecessary" | Cut 5 game features, near-miss system |
| All Three | "Near-miss highlighting has regulatory risk" | Removed entirely |

---

## What We're Building (MVP)

### Core Requirements

1. **Staged Reveal Animation**: Multipliers appear one-by-one with 300-500ms delays
2. **RTP Target**: 95-99% across all games (currently 97-99%)
3. **Skip Functionality**: Players can skip reveal with SPACE key
4. **Reduced Motion Support**: Honor existing `reducedMotion` prop

### What We're NOT Building (Deferred)

- ~~RevealPhase backend state~~ (frontend-only concern)
- ~~5 game-specific features~~ (no user validation)
- ~~Enhanced NearMissIntensity system~~ (premature optimization)
- ~~Near-miss highlighting~~ (regulatory risk)
- ~~Chi-square distribution tests~~ (over-engineering)
- ~~Fee transparency modal~~ (tooltip is sufficient)

---

## Implementation Plan

### Day 1: Backend RTP Adjustments

**File**: `execution/src/casino/super_mode.rs`

Adjust multiplier distributions to lower RTP from ~98% to ~96-97%:

```rust
// Baccarat: Lower expected multiplier from 3.1x to 2.7x
// Current:  35% 2x, 30% 3x, 20% 4x, 10% 5x, 5% 8x
// New:      45% 2x, 35% 3x, 15% 4x, 4% 5x, 1% 8x
let multiplier = if m_roll < 0.45 { 2 }
    else if m_roll < 0.80 { 3 }
    else if m_roll < 0.95 { 4 }
    else if m_roll < 0.99 { 5 }
    else { 8 };
```

Apply similar adjustments to all 10 games. Target ~96-97% RTP.

**File**: `types/src/casino/game.rs`

Add missing `aura_meter` field (identified by Kieran):

```rust
pub struct SuperModeState {
    pub is_active: bool,
    pub multipliers: Vec<SuperMultiplier>,
    pub streak_level: u8,
    pub aura_meter: u8,  // NEW - 0-5, triggers Super Aura Round at 5
}
```

**Deliverable**: Backend changes complete, ~50 lines modified.

---

### Day 2: Frontend Staged Reveal

**File**: `website/src/components/casino/ActiveGame.tsx`

Replace instant multiplier display with staged reveal:

```typescript
// Current implementation (instant display):
{gameState.superMode?.isActive && (
    <div className="absolute top-4 left-4...">
        {gameState.superMode.multipliers.map((m, idx) => (
            <span key={idx}>{m.superType}:{m.id} x{m.multiplier}</span>
        ))}
    </div>
)}

// New implementation (staged reveal):
const SuperModeDisplay: React.FC<{
  multipliers: SuperMultiplier[];
  reducedMotion: boolean;
}> = ({ multipliers, reducedMotion }) => {
  const [revealedCount, setRevealedCount] = useState(0);
  const [skipped, setSkipped] = useState(false);

  // Skip handler (SPACE or ESC)
  useEffect(() => {
    const handleSkip = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Escape') {
        setSkipped(true);
        setRevealedCount(multipliers.length);
      }
    };
    window.addEventListener('keydown', handleSkip);
    return () => window.removeEventListener('keydown', handleSkip);
  }, [multipliers.length]);

  // Staged reveal (skip if reducedMotion)
  useEffect(() => {
    if (reducedMotion || skipped) {
      setRevealedCount(multipliers.length);
      return;
    }

    if (revealedCount < multipliers.length) {
      const timer = setTimeout(() => {
        setRevealedCount(prev => prev + 1);
      }, 400); // 400ms per element
      return () => clearTimeout(timer);
    }
  }, [revealedCount, multipliers.length, reducedMotion, skipped]);

  const visibleMultipliers = multipliers.slice(0, revealedCount);
  const isRevealing = revealedCount < multipliers.length && !skipped;

  return (
    <div className="absolute top-4 left-4 max-w-sm bg-terminal-black/90 border border-terminal-gold/50 p-3 rounded shadow-lg z-40 text-xs">
      <div className="font-bold text-terminal-gold mb-1">
        SUPER MODE {isRevealing && '(SPACE to skip)'}
      </div>
      <div className="flex flex-wrap gap-1">
        {visibleMultipliers.map((m, idx) => (
          <span
            key={idx}
            className="px-2 py-0.5 rounded border border-terminal-gold/30 text-terminal-gold/90 animate-fade-in"
          >
            {formatMultiplier(m)}
          </span>
        ))}
      </div>
    </div>
  );
};

const formatMultiplier = (m: SuperMultiplier): string => {
  switch (m.superType) {
    case 'Card': return `${cardName(m.id)} x${m.multiplier}`;
    case 'Number': return `#${m.id} x${m.multiplier}`;
    case 'Total': return `${m.id} x${m.multiplier}`;
    case 'Rank': return `${rankName(m.id)} x${m.multiplier}`;
    case 'Suit': return `${suitName(m.id)} x${m.multiplier}`;
  }
};
```

**Deliverable**: Staged reveal with skip functionality, ~100 lines.

---

### Day 3: Aura Meter Visual Enhancement

**File**: `website/src/components/casino/Layout.tsx`

Enhance existing Aura Meter display:

```typescript
const AuraMeter: React.FC<{ value: number; max: number }> = ({ value, max }) => {
  return (
    <div className="flex gap-1 items-center">
      <span className="text-xs text-terminal-gold/70">AURA</span>
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`w-2 h-4 rounded-sm transition-all duration-300 ${
            i < value
              ? 'bg-terminal-gold shadow-[0_0_8px_rgba(255,215,0,0.6)]'
              : 'bg-terminal-gold/20'
          }`}
        />
      ))}
      {value >= max && (
        <span className="text-xs text-terminal-gold animate-pulse ml-1">
          SUPER ROUND!
        </span>
      )}
    </div>
  );
};
```

**Deliverable**: Enhanced meter visualization, ~30 lines.

---

### Day 4: Monte Carlo RTP Verification

**File**: `execution/tests/super_mode_rtp.rs` (new)

Run RTP verification for each game:

```rust
#[test]
fn verify_all_games_super_rtp() {
    const ROUNDS: u64 = 1_000_000; // 1M rounds per game

    let games = [
        ("Baccarat", simulate_baccarat_super),
        ("Blackjack", simulate_blackjack_super),
        ("Craps", simulate_craps_super),
        ("Roulette", simulate_roulette_super),
        ("SicBo", simulate_sicbo_super),
        ("HiLo", simulate_hilo_super),
        ("VideoPoker", simulate_videopoker_super),
        ("ThreeCard", simulate_threecard_super),
        ("UTH", simulate_uth_super),
        ("CasinoWar", simulate_casinowar_super),
    ];

    for (name, simulate_fn) in games {
        let (wagered, returned) = simulate_fn(ROUNDS);
        let rtp = (returned as f64) / (wagered as f64);

        println!("{}: RTP = {:.2}%", name, rtp * 100.0);

        assert!(
            rtp >= 0.95 && rtp <= 0.99,
            "{} RTP {:.2}% outside 95-99% target",
            name, rtp * 100.0
        );
    }
}
```

**Deliverable**: RTP verification tests, ~100 lines.

---

### Day 5: Integration & Deploy

1. **Manual Testing**: Play each game with Super Mode enabled
2. **Edge Cases**:
   - Player disconnects during reveal (frontend handles gracefully)
   - Reduced motion enabled (instant display)
   - Super Aura Round triggers (meter at 5/5)
3. **Deploy to Staging**: Verify on test environment
4. **Deploy to 10% of Users**: A/B test engagement metrics

**Metrics to Track**:
- Super Mode opt-in rate
- Average session duration (Super vs. Normal)
- Revenue per user (Super vs. Normal)
- Bet frequency (Super vs. Normal)

---

## Technical Specifications

### Fee Calculation for Atomic Batches

Per Kieran's review, this must be documented:

```rust
/// Super Mode fee is 20% of TOTAL WAGER across all bets in atomic batch.
///
/// Example:
/// - Bet 1: 100 chips on Player
/// - Bet 2: 50 chips on Banker
/// - Total: 150 chips
/// - Fee: 150 × 0.2 = 30 chips
///
/// This ensures consistent pricing regardless of bet count.
pub fn calculate_super_mode_fee(total_wager: u64) -> u64 {
    total_wager / 5 // 20% = 1/5
}
```

### Animation Timing

| Event | Duration | Notes |
|-------|----------|-------|
| Per-element reveal | 400ms | Allows 5 elements in 2 seconds |
| Fade-in animation | 200ms | CSS transition |
| Skip response | Instant | SPACE or ESC key |

### RTP Targets (Post-Adjustment)

| Game | Current RTP | Target RTP | Adjustment Method |
|------|-------------|------------|-------------------|
| Baccarat | 98.5% | 96.5% | Lower multiplier distribution |
| Blackjack | 98.2% | 96.5% | Remove BJ bonus, lower multipliers |
| Craps | 99.0% | 97.0% | Reduce Thunder Odds bonus |
| UTH | 98.5% | 97.0% | Lower Blitz frequency |
| Three Card | 98.7% | 96.5% | Reduce Flash rates |
| Roulette | 97.3% | 96.0% | Already close, minor tweaks |
| Casino War | 98.0% | 96.5% | Reduce Strike rates |
| Video Poker | 98.0% | 96.0% | Lower Mega multipliers |
| Sic Bo | 98.0% | 96.5% | Reduce Fortune frequency |
| Hi-Lo | 98.5% | 97.0% | Adjust streak ladder |

---

## Files to Modify

| File | Changes | LOC |
|------|---------|-----|
| `types/src/casino/game.rs` | Add `aura_meter` field | ~5 |
| `execution/src/casino/super_mode.rs` | Adjust distributions | ~50 |
| `website/src/components/casino/ActiveGame.tsx` | Staged reveal | ~100 |
| `website/src/components/casino/Layout.tsx` | Aura meter enhancement | ~30 |
| `execution/tests/super_mode_rtp.rs` | RTP verification (new) | ~100 |

**Total: ~285 lines**

---

## What's Deferred (Phase 2)

After shipping MVP and gathering user data, consider:

1. **Game-Specific Features** (if engagement is low on specific games)
   - Aura Prism (Baccarat)
   - Perfect Strike (Blackjack)
   - Rolling Thunder (Craps)
   - Sector Storm (Roulette)
   - Lucky 7 (Hi-Lo)

2. **Enhanced Aura Meter** (if users don't notice basic meter)
   - NearMissIntensity tiers
   - Progressive fill based on "closeness"

3. **Backend RevealPhase** (if frontend-only causes sync issues)
   - Only if we observe actual problems in production

4. **Sound Effects** (if engagement metrics warrant)
   - Lightning crack for reveals
   - Celebration sounds scaled by multiplier

---

## Success Criteria

**Week 1 (MVP Launch)**:
- [ ] All 10 games have staged reveal animation
- [ ] Skip button works (SPACE/ESC)
- [ ] Reduced motion honored
- [ ] RTP verified at 95-99% per game
- [ ] Deployed to 10% of users

**Week 2 (Validation)**:
- [ ] Opt-in rate > 20% of active players
- [ ] No increase in support tickets
- [ ] Session duration stable or improved
- [ ] Revenue per user stable or improved

**Phase 2 Trigger**:
- If engagement is lower than expected → Add game-specific features
- If users ignore aura meter → Enhance visualization
- If sync issues occur → Consider backend state

---

## Conclusion

The original plan was 3 weeks and 3500+ lines of speculative features. This revised plan is **1 week and ~285 lines** focused on what matters:

1. **Staged reveals** for entertainment
2. **RTP adjustments** for sustainability
3. **Skip functionality** for user control

Ship it, measure it, then decide what's next based on real data—not neuroscience papers.

---

*Plan revised based on expert reviews from DHH-style, Kieran-style, and Simplicity analysis perspectives.*
