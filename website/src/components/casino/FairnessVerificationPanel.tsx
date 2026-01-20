import React, { useState, useCallback, useEffect } from 'react';
import type { RoundOutcome } from '../../hooks/useRoundOutcome';
import {
  verifyCommitReveal,
  bytesToHex,
  formatHexTruncated,
  copyToClipboard,
  type VerificationResult,
} from '../../utils/fairnessVerification';

/**
 * Simple className joiner
 */
const cn = (...args: (string | boolean | undefined | null)[]) =>
  args.filter(Boolean).join(' ');

export interface FairnessVerificationPanelProps {
  /** Round outcome containing RNG commit and reveal values */
  outcome: RoundOutcome | null;
  /** Additional CSS classes */
  className?: string;
  /** Whether to auto-verify on mount/outcome change */
  autoVerify?: boolean;
  /** Compact mode for smaller displays */
  compact?: boolean;
  /** Initially expanded (default: false) */
  defaultExpanded?: boolean;
}

/**
 * Verification status for display
 */
type VerificationStatus = 'idle' | 'verifying' | 'verified' | 'failed';

/**
 * FairnessVerificationPanel - Displays RNG commit/reveal values for provably fair verification.
 *
 * Shows:
 * - Commit hash (published before betting closed)
 * - Reveal/roll seed (disclosed after betting locked)
 * - Verification status (SHA256(reveal) == commit)
 * - Copy buttons for manual verification
 *
 * AC-5.5: Fairness verification UI displays RNG commit/reveal values for the round.
 *
 * @example
 * ```tsx
 * <FairnessVerificationPanel outcome={outcome} autoVerify />
 * ```
 */
export const FairnessVerificationPanel: React.FC<FairnessVerificationPanelProps> = ({
  outcome,
  className = '',
  autoVerify = false,
  compact = false,
  defaultExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [status, setStatus] = useState<VerificationStatus>('idle');
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [copiedField, setCopiedField] = useState<'commit' | 'reveal' | 'computed' | null>(null);

  // Convert bytes to hex strings for display
  const commitHex = outcome?.rngCommit ? bytesToHex(outcome.rngCommit) : '';
  const revealHex = outcome?.rollSeed ? bytesToHex(outcome.rollSeed) : '';
  const computedHex = verificationResult?.computedCommit
    ? bytesToHex(verificationResult.computedCommit)
    : '';

  // Verify commit-reveal
  const handleVerify = useCallback(async () => {
    if (!outcome?.rngCommit || !outcome?.rollSeed) return;

    setStatus('verifying');
    try {
      const result = await verifyCommitReveal(outcome.rngCommit, outcome.rollSeed);
      setVerificationResult(result);
      setStatus(result.isValid ? 'verified' : 'failed');
    } catch (err) {
      setVerificationResult({
        isValid: false,
        computedCommit: new Uint8Array(0),
        error: err instanceof Error ? err.message : 'Verification error',
      });
      setStatus('failed');
    }
  }, [outcome?.rngCommit, outcome?.rollSeed]);

  // Auto-verify when outcome changes
  useEffect(() => {
    if (autoVerify && outcome?.rngCommit && outcome?.rollSeed) {
      handleVerify();
    } else {
      // Reset state when outcome changes
      setStatus('idle');
      setVerificationResult(null);
    }
  }, [autoVerify, outcome?.rngCommit, outcome?.rollSeed, handleVerify]);

  // Handle copy to clipboard
  const handleCopy = useCallback(async (field: 'commit' | 'reveal' | 'computed', value: string) => {
    try {
      await copyToClipboard(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Copy failed, ignore
    }
  }, []);

  // No outcome yet
  if (!outcome) {
    return null;
  }

  // Check if we have RNG data
  const hasRngData = outcome.rngCommit?.length > 0 && outcome.rollSeed?.length > 0;

  if (!hasRngData) {
    return (
      <div
        className={cn(
          'p-3 rounded-lg bg-mono-100/50 dark:bg-mono-800/50 border border-mono-200 dark:border-mono-700',
          className
        )}
        role="region"
        aria-label="Fairness verification"
      >
        <span className="text-sm text-mono-500">RNG data not available for this round</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border',
        isExpanded
          ? 'bg-white dark:bg-mono-900 border-mono-200 dark:border-mono-700'
          : 'bg-mono-50 dark:bg-mono-800/50 border-mono-200 dark:border-mono-700',
        className
      )}
      role="region"
      aria-label="Fairness verification"
    >
      {/* Header - always visible */}
      <button
        type="button"
        className={cn(
          'w-full flex items-center justify-between p-3 text-left',
          'hover:bg-mono-100 dark:hover:bg-mono-800 transition-colors rounded-t-lg',
          !isExpanded && 'rounded-b-lg'
        )}
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-controls="fairness-details"
      >
        <div className="flex items-center gap-2">
          <ShieldIcon className="w-4 h-4 text-mono-500" />
          <span className={cn('font-medium', compact ? 'text-xs' : 'text-sm')}>
            Provably Fair
          </span>
          {status === 'verified' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded">
              <CheckIcon className="w-3 h-3" />
              Verified
            </span>
          )}
          {status === 'failed' && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded">
              <XIcon className="w-3 h-3" />
              Failed
            </span>
          )}
        </div>
        <ChevronIcon className={cn('w-4 h-4 text-mono-400 transition-transform', isExpanded && 'rotate-180')} />
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div id="fairness-details" className="p-3 pt-0 space-y-3 border-t border-mono-200 dark:border-mono-700">
          {/* Explanation */}
          <p className="text-xs text-mono-500 leading-relaxed">
            The commit hash was published before betting closed. After the round locked,
            the reveal was disclosed. Verify that SHA256(Reveal) equals the Commit.
          </p>

          {/* Commit field */}
          <HashField
            label="Commit"
            value={commitHex}
            fullValue={commitHex}
            compact={compact}
            copied={copiedField === 'commit'}
            onCopy={() => handleCopy('commit', commitHex)}
          />

          {/* Reveal field */}
          <HashField
            label="Reveal"
            value={revealHex}
            fullValue={revealHex}
            compact={compact}
            copied={copiedField === 'reveal'}
            onCopy={() => handleCopy('reveal', revealHex)}
          />

          {/* Computed hash (after verification) */}
          {computedHex && (
            <HashField
              label="SHA256(Reveal)"
              value={computedHex}
              fullValue={computedHex}
              compact={compact}
              copied={copiedField === 'computed'}
              onCopy={() => handleCopy('computed', computedHex)}
              highlight={status === 'verified'}
              error={status === 'failed'}
            />
          )}

          {/* Verify button */}
          {status === 'idle' && (
            <button
              type="button"
              className={cn(
                'w-full py-2 px-3 rounded-md text-sm font-medium transition-colors',
                'bg-mono-900 dark:bg-mono-100 text-white dark:text-mono-900',
                'hover:bg-mono-700 dark:hover:bg-mono-300'
              )}
              onClick={handleVerify}
            >
              Verify Fairness
            </button>
          )}

          {status === 'verifying' && (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-mono-500">
              <SpinnerIcon className="w-4 h-4 animate-spin" />
              Verifying...
            </div>
          )}

          {/* Verification result message */}
          {status === 'verified' && (
            <div
              className="flex items-center gap-2 p-2 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
              role="status"
              aria-live="polite"
            >
              <CheckIcon className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">
                Verification passed! The commit matches SHA256(reveal).
              </span>
            </div>
          )}

          {status === 'failed' && verificationResult?.error && (
            <div
              className="flex items-start gap-2 p-2 rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
              role="alert"
            >
              <XIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{verificationResult.error}</span>
            </div>
          )}

          {/* Round info */}
          <div className="pt-2 border-t border-mono-100 dark:border-mono-800">
            <span className="text-xs text-mono-400">
              Round #{outcome.roundId.toString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Hash field with copy button
 */
interface HashFieldProps {
  label: string;
  value: string;
  fullValue: string;
  compact?: boolean;
  copied?: boolean;
  onCopy: () => void;
  highlight?: boolean;
  error?: boolean;
}

function HashField({
  label,
  value,
  fullValue,
  compact = false,
  copied = false,
  onCopy,
  highlight = false,
  error = false,
}: HashFieldProps) {
  const truncated = formatHexTruncated(value, compact ? 6 : 8, compact ? 6 : 8);

  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-mono-500 uppercase tracking-wider">
        {label}
      </label>
      <div
        className={cn(
          'flex items-center gap-2 p-2 rounded-md font-mono text-xs break-all',
          highlight && 'bg-emerald-50 dark:bg-emerald-900/20 ring-1 ring-emerald-300 dark:ring-emerald-700',
          error && 'bg-red-50 dark:bg-red-900/20 ring-1 ring-red-300 dark:ring-red-700',
          !highlight && !error && 'bg-mono-100 dark:bg-mono-800'
        )}
      >
        <span
          className={cn(
            'flex-1 truncate',
            highlight && 'text-emerald-700 dark:text-emerald-300',
            error && 'text-red-700 dark:text-red-300',
            !highlight && !error && 'text-mono-700 dark:text-mono-300'
          )}
          title={fullValue}
        >
          {truncated}
        </span>
        <button
          type="button"
          className={cn(
            'flex-shrink-0 p-1 rounded hover:bg-mono-200 dark:hover:bg-mono-700 transition-colors',
            copied && 'text-emerald-600 dark:text-emerald-400'
          )}
          onClick={onCopy}
          aria-label={copied ? 'Copied!' : `Copy ${label}`}
          title={copied ? 'Copied!' : `Copy ${label}`}
        >
          {copied ? (
            <CheckIcon className="w-3.5 h-3.5" />
          ) : (
            <CopyIcon className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

// Simple icon components
function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" opacity="0.75" />
    </svg>
  );
}

export default FairnessVerificationPanel;
