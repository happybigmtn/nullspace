import React, { useCallback, useEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';

/**
 * LUX-010: Inline Bet Selector
 *
 * Replaces popup chip selector with inline controls:
 * - +/- stepper buttons for fine control
 * - Preset buttons (MIN, 1/4, 1/2, MAX) relative to balance
 * - Keyboard: Arrow keys to adjust, Shift+Arrow for 10x
 */

const CHIP_VALUES = [1, 5, 25, 100, 500, 1000, 5000, 10000];

interface InlineBetSelectorProps {
    currentBet: number;
    balance: number;
    onBetChange: (amount: number) => void;
    minBet?: number;
    maxBet?: number;
    disabled?: boolean;
    className?: string;
    /** Compact mode for mobile - hides presets */
    compact?: boolean;
}

export const InlineBetSelector: React.FC<InlineBetSelectorProps> = ({
    currentBet,
    balance,
    onBetChange,
    minBet = 1,
    maxBet,
    disabled = false,
    className = '',
    compact = false,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const effectiveMax = maxBet ?? balance;

    // Find the next higher/lower chip value
    const getNextChipValue = useCallback((current: number, direction: 'up' | 'down', multiplier = 1): number => {
        const currentIndex = CHIP_VALUES.findIndex(v => v >= current);

        if (direction === 'up') {
            // Find the next chip value that's higher
            const nextIndex = currentIndex === -1
                ? CHIP_VALUES.length - 1
                : Math.min(currentIndex + multiplier, CHIP_VALUES.length - 1);
            const nextValue = CHIP_VALUES[nextIndex];
            return Math.min(nextValue, effectiveMax);
        } else {
            // Find the next chip value that's lower
            const prevIndex = currentIndex <= 0
                ? 0
                : Math.max(currentIndex - multiplier, 0);
            const prevValue = CHIP_VALUES[prevIndex];
            return Math.max(prevValue, minBet);
        }
    }, [effectiveMax, minBet]);

    // Increment bet to next chip value
    const increment = useCallback((multiplier = 1) => {
        if (disabled) return;
        const nextValue = getNextChipValue(currentBet, 'up', multiplier);
        if (nextValue !== currentBet) {
            onBetChange(nextValue);
        }
    }, [currentBet, disabled, getNextChipValue, onBetChange]);

    // Decrement bet to previous chip value
    const decrement = useCallback((multiplier = 1) => {
        if (disabled) return;
        const prevValue = getNextChipValue(currentBet, 'down', multiplier);
        if (prevValue !== currentBet) {
            onBetChange(prevValue);
        }
    }, [currentBet, disabled, getNextChipValue, onBetChange]);

    // Preset handlers
    const setMin = useCallback(() => {
        if (disabled) return;
        onBetChange(minBet);
    }, [disabled, minBet, onBetChange]);

    const setQuarter = useCallback(() => {
        if (disabled) return;
        const quarter = Math.floor(effectiveMax / 4);
        // Snap to nearest chip value
        const snapped = CHIP_VALUES.reduce((prev, curr) =>
            Math.abs(curr - quarter) < Math.abs(prev - quarter) ? curr : prev
        );
        onBetChange(Math.max(minBet, Math.min(snapped, effectiveMax)));
    }, [disabled, effectiveMax, minBet, onBetChange]);

    const setHalf = useCallback(() => {
        if (disabled) return;
        const half = Math.floor(effectiveMax / 2);
        // Snap to nearest chip value
        const snapped = CHIP_VALUES.reduce((prev, curr) =>
            Math.abs(curr - half) < Math.abs(prev - half) ? curr : prev
        );
        onBetChange(Math.max(minBet, Math.min(snapped, effectiveMax)));
    }, [disabled, effectiveMax, minBet, onBetChange]);

    const setMax = useCallback(() => {
        if (disabled) return;
        // Snap to highest chip value that doesn't exceed balance
        const maxChip = CHIP_VALUES.filter(v => v <= effectiveMax).pop() || minBet;
        onBetChange(maxChip);
    }, [disabled, effectiveMax, minBet, onBetChange]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle when focused or when no input is focused
            const activeElement = document.activeElement;
            const isInputFocused = activeElement instanceof HTMLInputElement ||
                                   activeElement instanceof HTMLTextAreaElement;
            if (isInputFocused) return;

            const multiplier = e.shiftKey ? 3 : 1; // Shift = jump 3 chip values

            switch (e.key) {
                case 'ArrowUp':
                case 'ArrowRight':
                    e.preventDefault();
                    increment(multiplier);
                    break;
                case 'ArrowDown':
                case 'ArrowLeft':
                    e.preventDefault();
                    decrement(multiplier);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [increment, decrement]);

    const formatBet = (value: number): string => {
        if (value >= 10000) return `${(value / 1000).toFixed(0)}k`;
        if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
        return value.toString();
    };

    const canDecrement = currentBet > minBet;
    const canIncrement = currentBet < effectiveMax;

    return (
        <div
            ref={containerRef}
            className={`flex flex-col gap-2 ${className}`}
            role="group"
            aria-label="Bet amount selector"
        >
            {/* Stepper: [- ] $25 [ +] */}
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => decrement()}
                    disabled={disabled || !canDecrement}
                    className={`w-9 h-9 rounded-full flex items-center justify-center border transition-all motion-interaction
                        ${disabled || !canDecrement
                            ? 'bg-ns-surface border-ns text-ns-muted cursor-not-allowed'
                            : 'bg-ns-surface border-ns text-ns hover:border-ns active:scale-95'
                        }`}
                    aria-label="Decrease bet"
                >
                    <Minus className="w-4 h-4" strokeWidth={2.5} />
                </button>

                <div className="flex-1 min-w-[80px] text-center">
                    <span className="text-display-mono text-lg font-semibold text-ns tabular-nums">
                        ${formatBet(currentBet)}
                    </span>
                </div>

                <button
                    type="button"
                    onClick={() => increment()}
                    disabled={disabled || !canIncrement}
                    className={`w-9 h-9 rounded-full flex items-center justify-center border transition-all motion-interaction
                        ${disabled || !canIncrement
                            ? 'bg-ns-surface border-ns text-ns-muted cursor-not-allowed'
                            : 'bg-ns-surface border-ns text-ns hover:border-ns active:scale-95'
                        }`}
                    aria-label="Increase bet"
                >
                    <Plus className="w-4 h-4" strokeWidth={2.5} />
                </button>
            </div>

            {/* Preset buttons: MIN | 1/4 | 1/2 | MAX */}
            {!compact && (
                <div className="flex items-center gap-1">
                    {[
                        { label: 'MIN', onClick: setMin },
                        { label: '1/4', onClick: setQuarter },
                        { label: '1/2', onClick: setHalf },
                        { label: 'MAX', onClick: setMax },
                    ].map(({ label, onClick }) => (
                        <button
                            key={label}
                            type="button"
                            onClick={onClick}
                            disabled={disabled}
                            className={`flex-1 h-7 rounded-full text-[10px] font-semibold tracking-wider uppercase transition-all motion-interaction
                                ${disabled
                                    ? 'bg-ns-surface text-ns-muted cursor-not-allowed'
                                    : 'bg-ns-surface text-ns-muted hover:text-ns active:scale-95'
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
