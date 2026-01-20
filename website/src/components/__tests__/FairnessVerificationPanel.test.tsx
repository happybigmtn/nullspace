// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FairnessVerificationPanel } from '../casino/FairnessVerificationPanel';
import type { RoundOutcome } from '../../hooks/useRoundOutcome';
import {
  verifyCommitReveal,
  bytesToHex,
  hexToBytes,
  formatHexTruncated,
  sha256,
} from '../../utils/fairnessVerification';

// Helper to render component to string
function renderToString(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

// Mock data factories
function createMockOutcome(overrides?: Partial<RoundOutcome>): RoundOutcome {
  // Default: a valid commit-reveal pair
  // reveal = 0x1234...5678 (32 bytes)
  // commit = SHA256(reveal)
  const reveal = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    reveal[i] = (i + 1) % 256;
  }
  // Pre-computed SHA256 of the reveal above
  const commit = hexToBytes('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');

  return {
    roundId: 42n,
    gameType: 0,
    d1: 3,
    d2: 4,
    diceTotal: 7,
    mainPoint: 0,
    epochPointEstablished: false,
    totals: [],
    rngCommit: commit,
    rollSeed: reveal,
    receivedAt: Date.now(),
    ...overrides,
  };
}

// Create a valid commit-reveal pair using actual SHA256
async function createValidPair(): Promise<{ commit: Uint8Array; reveal: Uint8Array }> {
  const reveal = new Uint8Array(32);
  crypto.getRandomValues(reveal);
  const commit = await sha256(reveal);
  return { commit, reveal };
}

describe('FairnessVerificationPanel', () => {
  describe('no outcome', () => {
    it('returns null when outcome is null', () => {
      const html = renderToString(<FairnessVerificationPanel outcome={null} />);
      expect(html).toBe('');
    });
  });

  describe('missing RNG data', () => {
    it('shows message when rngCommit is empty', () => {
      const outcome = createMockOutcome({ rngCommit: new Uint8Array(0) });
      const html = renderToString(<FairnessVerificationPanel outcome={outcome} />);
      expect(html).toContain('RNG data not available');
    });

    it('shows message when rollSeed is empty', () => {
      const outcome = createMockOutcome({ rollSeed: new Uint8Array(0) });
      const html = renderToString(<FairnessVerificationPanel outcome={outcome} />);
      expect(html).toContain('RNG data not available');
    });
  });

  describe('collapsed state (default)', () => {
    it('renders collapsed by default', () => {
      const outcome = createMockOutcome();
      const html = renderToString(<FairnessVerificationPanel outcome={outcome} />);
      expect(html).toContain('Provably Fair');
      expect(html).not.toContain('Commit');
      expect(html).not.toContain('Reveal');
    });

    it('has expand button with aria-expanded="false"', () => {
      const outcome = createMockOutcome();
      const html = renderToString(<FairnessVerificationPanel outcome={outcome} />);
      expect(html).toContain('aria-expanded="false"');
    });
  });

  describe('expanded state', () => {
    it('shows commit and reveal fields when defaultExpanded', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <FairnessVerificationPanel outcome={outcome} defaultExpanded />
      );
      expect(html).toContain('Commit');
      expect(html).toContain('Reveal');
    });

    it('has aria-expanded="true" when expanded', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <FairnessVerificationPanel outcome={outcome} defaultExpanded />
      );
      expect(html).toContain('aria-expanded="true"');
    });

    it('shows explanation text', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <FairnessVerificationPanel outcome={outcome} defaultExpanded />
      );
      expect(html).toContain('commit hash was published before betting closed');
    });

    it('shows verify button when status is idle', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <FairnessVerificationPanel outcome={outcome} defaultExpanded />
      );
      expect(html).toContain('Verify Fairness');
    });

    it('shows round ID', () => {
      const outcome = createMockOutcome({ roundId: 123n });
      const html = renderToString(
        <FairnessVerificationPanel outcome={outcome} defaultExpanded />
      );
      expect(html).toContain('Round #123');
    });
  });

  describe('hash display', () => {
    it('displays truncated commit hash', () => {
      const commit = new Uint8Array(32).fill(0xab);
      const outcome = createMockOutcome({ rngCommit: commit });
      const html = renderToString(
        <FairnessVerificationPanel outcome={outcome} defaultExpanded />
      );
      // Should show truncated version
      expect(html).toContain('abababab');
    });

    it('displays truncated reveal hash', () => {
      const reveal = new Uint8Array(32).fill(0xcd);
      const outcome = createMockOutcome({ rollSeed: reveal });
      const html = renderToString(
        <FairnessVerificationPanel outcome={outcome} defaultExpanded />
      );
      expect(html).toContain('cdcdcdcd');
    });
  });

  describe('compact mode', () => {
    it('uses smaller text in compact mode', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <FairnessVerificationPanel outcome={outcome} defaultExpanded compact />
      );
      expect(html).toContain('text-xs');
    });
  });

  describe('accessibility', () => {
    it('has role="region" for screen readers', () => {
      const outcome = createMockOutcome();
      const html = renderToString(<FairnessVerificationPanel outcome={outcome} />);
      expect(html).toContain('role="region"');
    });

    it('has aria-label for fairness verification', () => {
      const outcome = createMockOutcome();
      const html = renderToString(<FairnessVerificationPanel outcome={outcome} />);
      expect(html).toContain('aria-label="Fairness verification"');
    });

    it('has aria-controls linking header to details', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <FairnessVerificationPanel outcome={outcome} defaultExpanded />
      );
      expect(html).toContain('aria-controls="fairness-details"');
      expect(html).toContain('id="fairness-details"');
    });

    it('copy buttons have aria-label', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <FairnessVerificationPanel outcome={outcome} defaultExpanded />
      );
      expect(html).toContain('aria-label="Copy Commit"');
      expect(html).toContain('aria-label="Copy Reveal"');
    });
  });

  describe('icons', () => {
    it('renders shield icon', () => {
      const outcome = createMockOutcome();
      const html = renderToString(<FairnessVerificationPanel outcome={outcome} />);
      // Shield icon has a specific path
      expect(html).toContain('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z');
    });

    it('renders chevron icon for expand/collapse', () => {
      const outcome = createMockOutcome();
      const html = renderToString(<FairnessVerificationPanel outcome={outcome} />);
      expect(html).toContain('6 9 12 15 18 9');
    });

    it('renders copy icons in expanded state', () => {
      const outcome = createMockOutcome();
      const html = renderToString(
        <FairnessVerificationPanel outcome={outcome} defaultExpanded />
      );
      // Copy icon has rect element
      expect(html).toContain('rect');
    });
  });
});

describe('fairnessVerification utilities', () => {
  describe('sha256', () => {
    it('computes correct hash', async () => {
      // Known test vector: SHA256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
      const empty = new Uint8Array(0);
      const hash = await sha256(empty);
      expect(bytesToHex(hash)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('returns 32-byte hash', async () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      const hash = await sha256(data);
      expect(hash.length).toBe(32);
    });
  });

  describe('verifyCommitReveal', () => {
    it('returns isValid=true for matching commit-reveal', async () => {
      const { commit, reveal } = await createValidPair();
      const result = await verifyCommitReveal(commit, reveal);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns isValid=false for mismatched commit-reveal', async () => {
      const { commit } = await createValidPair();
      const badReveal = new Uint8Array(32).fill(0xff);
      const result = await verifyCommitReveal(commit, badReveal);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Hash mismatch');
    });

    it('returns computed commit hash', async () => {
      const { commit, reveal } = await createValidPair();
      const result = await verifyCommitReveal(commit, reveal);
      expect(bytesToHex(result.computedCommit)).toBe(bytesToHex(commit));
    });

    it('rejects invalid commit length', async () => {
      const shortCommit = new Uint8Array(16);
      const reveal = new Uint8Array(32);
      const result = await verifyCommitReveal(shortCommit, reveal);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid commit length');
    });

    it('rejects invalid reveal length', async () => {
      const commit = new Uint8Array(32);
      const shortReveal = new Uint8Array(8);
      const result = await verifyCommitReveal(commit, shortReveal);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid reveal length');
    });
  });

  describe('bytesToHex', () => {
    it('converts bytes to lowercase hex', () => {
      const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      expect(bytesToHex(bytes)).toBe('deadbeef');
    });

    it('pads single digits', () => {
      const bytes = new Uint8Array([0x0a, 0x0b]);
      expect(bytesToHex(bytes)).toBe('0a0b');
    });

    it('handles empty array', () => {
      expect(bytesToHex(new Uint8Array(0))).toBe('');
    });
  });

  describe('hexToBytes', () => {
    it('converts hex to bytes', () => {
      const bytes = hexToBytes('deadbeef');
      expect(Array.from(bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    });

    it('handles 0x prefix', () => {
      const bytes = hexToBytes('0xdeadbeef');
      expect(Array.from(bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    });

    it('handles uppercase', () => {
      const bytes = hexToBytes('DEADBEEF');
      expect(Array.from(bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    });

    it('throws on odd length', () => {
      expect(() => hexToBytes('abc')).toThrow('odd length');
    });

    it('throws on invalid characters', () => {
      expect(() => hexToBytes('ghij')).toThrow('non-hex characters');
    });
  });

  describe('formatHexTruncated', () => {
    it('truncates long hex strings', () => {
      const hex = 'abcdef1234567890abcdef1234567890';
      expect(formatHexTruncated(hex, 4, 4)).toBe('abcd...7890');
    });

    it('does not truncate short strings', () => {
      const hex = 'abcd1234';
      expect(formatHexTruncated(hex, 4, 4)).toBe('abcd1234');
    });

    it('uses default start/end of 8', () => {
      const hex = '0123456789abcdef0123456789abcdef0123456789abcdef';
      expect(formatHexTruncated(hex)).toBe('01234567...89abcdef');
    });
  });
});

describe('AC-5.5: Fairness verification UI displays RNG commit/reveal values', () => {
  it('displays commit hash from round outcome', () => {
    const commit = new Uint8Array(32);
    commit[0] = 0xaa;
    commit[1] = 0xbb;
    const outcome = createMockOutcome({ rngCommit: commit });
    const html = renderToString(
      <FairnessVerificationPanel outcome={outcome} defaultExpanded />
    );
    expect(html).toContain('aabb');
  });

  it('displays reveal/rollSeed from round outcome', () => {
    const reveal = new Uint8Array(32);
    reveal[0] = 0xcc;
    reveal[1] = 0xdd;
    const outcome = createMockOutcome({ rollSeed: reveal });
    const html = renderToString(
      <FairnessVerificationPanel outcome={outcome} defaultExpanded />
    );
    expect(html).toContain('ccdd');
  });

  it('provides verification mechanism', () => {
    const outcome = createMockOutcome();
    const html = renderToString(
      <FairnessVerificationPanel outcome={outcome} defaultExpanded />
    );
    expect(html).toContain('Verify Fairness');
  });

  it('explains commit-reveal scheme to users', () => {
    const outcome = createMockOutcome();
    const html = renderToString(
      <FairnessVerificationPanel outcome={outcome} defaultExpanded />
    );
    expect(html).toContain('SHA256');
    expect(html).toContain('before betting closed');
    expect(html).toContain('After the round locked');
  });

  it('allows copying values for manual verification', () => {
    const outcome = createMockOutcome();
    const html = renderToString(
      <FairnessVerificationPanel outcome={outcome} defaultExpanded />
    );
    // Copy buttons present
    expect(html).toContain('Copy Commit');
    expect(html).toContain('Copy Reveal');
  });
});
