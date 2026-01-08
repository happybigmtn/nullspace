import React, { useState, useRef, useEffect } from 'react';
import { Grid, X, ChevronUp, Layers } from 'lucide-react';
import { animated, useSpring } from '@react-spring/web';
import { Label } from './ui/Label';
import { InlineBetSelector } from './InlineBetSelector';
import { ModifiersAccordion } from './ModifiersAccordion';
import { useMagneticCursor } from '../../hooks/useMagneticCursor';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPRING_LIQUID_CONFIGS } from '../../utils/motion';

/**
 * Breathing animation constants for idle CTA
 * DS-056: Idle state breathing animations
 */
const BREATHING = {
  /** Min scale (1.0 = no change) */
  min: 1.0,
  /** Max scale (subtle 2% increase) */
  max: 1.02,
  /** Full cycle duration in ms (8 seconds) */
  duration: 8000,
  /** Idle timeout before breathing starts (ms) */
  idleTimeout: 5000,
};

interface Action {
    type?: 'button' | 'divider';
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
    className?: string;
}

/** LUX-012: Modifier configuration for accordion */
interface ModifierConfig {
    active: boolean;
    available: boolean;
    onToggle: () => void;
}

interface GameControlBarProps {
    children?: React.ReactNode;
    primaryAction?: Action;
    secondaryActions?: Action[];
    className?: string;
    variant?: 'row' | 'stack';
    ariaLabel?: string;
    mobileMenuLabel?: string;
    balance?: string;
    /** LUX-010: Inline bet selector props */
    currentBet?: number;
    onBetChange?: (amount: number) => void;
    /** Numeric balance for bet calculations (separate from display string) */
    balanceAmount?: number;
    /** Show inline bet selector instead of static balance */
    showBetSelector?: boolean;
    /** Whether betting is disabled (e.g., during play) */
    bettingDisabled?: boolean;
    /** LUX-012: Modifiers accordion - replaces inline modifier buttons */
    modifiers?: {
        shield?: ModifierConfig;
        double?: ModifierConfig;
        super?: ModifierConfig;
    };
}

export const GameControlBar: React.FC<GameControlBarProps> = ({
    children,
    primaryAction,
    secondaryActions = [],
    className = '',
    ariaLabel = 'Game controls',
    mobileMenuLabel = 'BETTING',
    balance = '$1,000.00',
    currentBet,
    onBetChange,
    balanceAmount = 1000,
    showBetSelector = false,
    bettingDisabled = false,
    modifiers,
}) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const prefersReducedMotion = useReducedMotion();

    // Breathing animation state (DS-056)
    const [isIdle, setIsIdle] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Breathing spring animation
    const [breatheSpring, breatheApi] = useSpring(() => ({
        breathe: 1,
        config: { duration: BREATHING.duration / 2 },
    }));

    // Magnetic cursor effect for the FAB button
    const { ref: fabRef, style: fabMagneticStyle } = useMagneticCursor<HTMLButtonElement>({
        threshold: 120,
        maxTranslation: 6,
        spring: 'liquidFloat',
        disabled: primaryAction?.disabled,
    });

    // Reset idle timer on interaction
    const resetIdleTimer = () => {
        setIsIdle(false);
        if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
        }
        if (!prefersReducedMotion && !primaryAction?.disabled) {
            idleTimerRef.current = setTimeout(() => {
                setIsIdle(true);
            }, BREATHING.idleTimeout);
        }
    };

    // Start breathing animation when idle (DS-056)
    useEffect(() => {
        if (prefersReducedMotion || primaryAction?.disabled || isHovered) {
            breatheApi.start({ breathe: 1 });
            return;
        }

        if (isIdle) {
            // Smooth oscillation between 1.0 and 1.02
            const breatheCycle = () => {
                breatheApi.start({
                    breathe: BREATHING.max,
                    config: { duration: BREATHING.duration / 2 },
                    onRest: () => {
                        breatheApi.start({
                            breathe: BREATHING.min,
                            config: { duration: BREATHING.duration / 2 },
                            onRest: breatheCycle,
                        });
                    },
                });
            };
            breatheCycle();
        }

        return () => {
            breatheApi.stop();
        };
    }, [isIdle, prefersReducedMotion, primaryAction?.disabled, isHovered, breatheApi]);

    // Initialize idle timer on mount
    useEffect(() => {
        if (!prefersReducedMotion && !primaryAction?.disabled) {
            resetIdleTimer();
        }
        return () => {
            if (idleTimerRef.current) {
                clearTimeout(idleTimerRef.current);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prefersReducedMotion, primaryAction?.disabled]);

    const baseContainer = "fixed bottom-8 left-1/2 -translate-x-1/2 h-16 bg-white/80 backdrop-blur-2xl rounded-full border border-titanium-200 shadow-float flex items-center justify-between px-2 z-50 min-w-[320px] max-w-[95vw] transition-all motion-state animate-scale-in";

    if (!primaryAction && secondaryActions.length === 0 && children) {
        return (
             <div className={baseContainer}>
                {children}
            </div>
        );
    }

    return (
        <>
            {/* Main Floating Island */}
            <div role="group" aria-label={ariaLabel} className={`${baseContainer} ${className}`}>
                {/* Left: Balance/Bet Info - LUX-010: Inline bet selector */}
                <div className="flex flex-col pl-4 pr-3 border-r border-titanium-100">
                    {showBetSelector && currentBet !== undefined && onBetChange ? (
                        <InlineBetSelector
                            currentBet={currentBet}
                            balance={balanceAmount}
                            onBetChange={onBetChange}
                            disabled={bettingDisabled}
                            compact
                        />
                    ) : (
                        <>
                            <Label className="mb-0.5">Balance</Label>
                            <span className="text-titanium-900 font-bold text-sm tabular-nums tracking-tight">{balance}</span>
                        </>
                    )}
                </div>

                {/* Center: Primary Action (Elevated FAB) - LUX-011: Unmissably prominent */}
                {primaryAction && (
                    <div className="absolute -top-12 left-1/2 -translate-x-1/2">
                        <animated.button
                            ref={fabRef}
                            type="button"
                            onClick={() => {
                                resetIdleTimer();
                                primaryAction.onClick?.();
                            }}
                            disabled={primaryAction.disabled}
                            onMouseEnter={() => {
                                setIsHovered(true);
                                resetIdleTimer();
                            }}
                            onMouseLeave={() => {
                                setIsHovered(false);
                                resetIdleTimer();
                            }}
                            onFocus={() => {
                                setIsHovered(true);
                                resetIdleTimer();
                            }}
                            onBlur={() => {
                                setIsHovered(false);
                                resetIdleTimer();
                            }}
                            style={{
                                // DS-056: Use magnetic transform when available, otherwise apply breathing
                                // Note: magnetic transform already includes translate3d from useMagneticCursor
                                transform: fabMagneticStyle?.transform
                                    ? fabMagneticStyle.transform
                                    : breatheSpring.breathe.to((b) => `scale(${b})`),
                            }}
                            className={`w-24 h-24 rounded-full flex items-center justify-center text-white font-semibold tracking-[0.15em] text-sm transition-all motion-interaction
                            ${primaryAction.disabled
                                ? 'bg-titanium-300 text-titanium-500 cursor-not-allowed opacity-50'
                                : 'bg-titanium-900 hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl ring-4 ring-titanium-900/20'
                            } ${primaryAction.className || ''}`}
                        >
                            {primaryAction.label}
                        </animated.button>
                        {/* Shadow accent for FAB */}
                        {!primaryAction.disabled && <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-12 h-4 bg-black/10 blur-xl rounded-full -z-10" />}
                    </div>
                )}

                {/* Right: Menu Toggle */}
                <div className="flex items-center gap-1 pr-2">
                    {children && <div className="hidden sm:flex">{children}</div>}
                    <button
                        onClick={() => setMenuOpen(true)}
                        className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-titanium-100 active:scale-95 transition-all motion-interaction group"
                        aria-label="Open menu"
                    >
                        <Grid className="text-titanium-400 group-hover:text-titanium-900 w-5 h-5" strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            {/* Bottom Sheet / Menu Overlay */}
            <div 
                className={`fixed inset-0 z-[60] bg-titanium-900/20 backdrop-blur-sm transition-opacity motion-state ${
                    menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
                onClick={() => setMenuOpen(false)}
            >
                <div 
                    className={`absolute bottom-0 left-0 right-0 bg-white rounded-t-[40px] p-8 pb-12 shadow-float border-t border-titanium-200 transition-transform motion-state ${
                        menuOpen ? 'translate-y-0' : 'translate-y-full'
                    }`}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Sheet Handle */}
                    <div className="w-12 h-1 bg-titanium-200 rounded-full mx-auto mb-8" />

                    {/* Header */}
                    <div className="flex justify-between items-center mb-8">
                        <div className="flex flex-col">
                            <Label>{mobileMenuLabel}</Label>
                            <h3 className="text-2xl font-bold text-titanium-900 tracking-tight mt-1">Actions</h3>
                        </div>
                        <button
                            onClick={() => setMenuOpen(false)}
                            className="w-11 h-11 bg-titanium-100 rounded-full flex items-center justify-center text-titanium-400 hover:text-titanium-900 transition-colors"
                            aria-label="Close menu"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Actions Grid */}
                    <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto scrollbar-hide">
                         {children && <div className="p-4 bg-titanium-50 rounded-3xl border border-titanium-100">{children}</div>}

                        {/* LUX-012: Modifiers Accordion - collapsed by default */}
                        {modifiers && (
                            <ModifiersAccordion modifiers={modifiers} />
                        )}

                        {/* Secondary Actions Grid */}
                        {secondaryActions.length > 0 && (
                            <div className="grid grid-cols-2 gap-4">
                                {secondaryActions.map((action, i) =>
                                    action.type === 'divider' ? (
                                        <div key={i} className="col-span-2 mt-2">
                                            <Label>{action.label}</Label>
                                            <div className="h-px bg-titanium-100 w-full mt-2" />
                                        </div>
                                    ) : (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => {
                                                action.onClick?.();
                                            }}
                                            disabled={action.disabled}
                                            className={`h-16 rounded-[24px] flex flex-col items-center justify-center gap-1 transition-all motion-interaction shadow-soft border ${
                                                action.active
                                                    ? 'bg-titanium-900 text-white border-titanium-900 shadow-lg'
                                                    : 'bg-white text-titanium-800 border-titanium-200 hover:border-titanium-400'
                                            } ${action.disabled ? 'opacity-40 cursor-not-allowed' : 'active:scale-95'}`}
                                        >
                                            <span className="font-bold text-sm tracking-tight">{action.label}</span>
                                        </button>
                                    )
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};
