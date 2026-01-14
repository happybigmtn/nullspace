import React, { useState, useRef, useEffect } from 'react';
import { Grid, X, ChevronUp, Layers } from 'lucide-react';
import { animated, useSpring } from '@react-spring/web';
import { Label } from './ui/Label';
import { InlineBetSelector } from './InlineBetSelector';
import { ModifiersAccordion } from './ModifiersAccordion';
import { useMagneticCursor } from '../../hooks/useMagneticCursor';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPRING_LIQUID_CONFIGS } from '../../utils/motion';
import { GlassSurface } from '../ui';
import { USE_CLASSIC_CASINO_UI } from '../../config/casinoUI';

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
    /**
     * Classic (simplified) UI path.
     * Drops glass/magnetic/accordion flourishes in favor of the lightweight
     * floating island used right after we removed React Three Fiber.
     */
    if (USE_CLASSIC_CASINO_UI) {
        return (
            <>
                <div
                    role="group"
                    aria-label={ariaLabel}
                    className={`fixed bottom-6 left-4 right-4 h-16 bg-black/80 backdrop-blur-xl rounded-full border border-white/10 shadow-lg flex items-center justify-between px-3 z-50 ${className}`}
                >
                    <div className="flex flex-col pl-2">
                        <span className="text-[10px] text-gray-400 tracking-widest font-medium">
                            {showBetSelector ? 'BET' : 'BALANCE'}
                        </span>
                        <span className="text-white font-semibold text-sm tabular-nums tracking-wide">
                            {showBetSelector && currentBet !== undefined ? `$${currentBet}` : balance}
                        </span>
                    </div>

                    {primaryAction && (
                        <button
                            type="button"
                            onClick={primaryAction.onClick}
                            disabled={primaryAction.disabled}
                            className={`absolute -top-6 left-1/2 -translate-x-1/2 w-20 h-20 rounded-full shadow-xl flex items-center justify-center text-white font-bold tracking-widest text-sm transition-all
                                ${primaryAction.disabled ? 'bg-gray-700 cursor-not-allowed' : 'bg-action-primary hover:scale-105 active:scale-95'} ${primaryAction.className || ''}`}
                        >
                            {primaryAction.label}
                        </button>
                    )}

                    <button
                        onClick={() => setMenuOpen(true)}
                        className="p-3 rounded-full hover:bg-white/10 active:scale-95 transition-colors"
                        aria-label="Open menu"
                    >
                        <Grid className="text-white w-6 h-6" />
                    </button>
                </div>

                <div
                    className={`fixed inset-0 z-[60] transition-opacity duration-200 ${
                        menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                    }`}
                >
                    <button
                        type="button"
                        aria-label="Close menu"
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
                        onClick={() => setMenuOpen(false)}
                    />
                    <div
                        className={`absolute bottom-0 left-0 right-0 bg-white dark:bg-zinc-900 rounded-t-3xl p-6 pb-10 transition-transform duration-200 ${
                            menuOpen ? 'translate-y-0' : 'translate-y-full'
                        }`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="w-12 h-1 bg-gray-300 dark:bg-gray-700 rounded-full mx-auto mb-6" />
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
                                {mobileMenuLabel}
                            </h3>
                            <button
                                onClick={() => setMenuOpen(false)}
                                aria-label="Close menu"
                                className="p-2 bg-gray-100 dark:bg-gray-800 rounded-full focus-visible:ring-2 focus-visible:ring-action-primary/50"
                            >
                                <X className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                            </button>
                        </div>

                        {children && <div className="mb-4">{children}</div>}

                        {modifiers && (
                            <div className="grid grid-cols-3 gap-2 mb-4">
                                {(['shield', 'double', 'super'] as const).map((key) => {
                                    const mod = modifiers[key];
                                    if (!mod || !mod.available) return null;
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={mod.onToggle}
                                            className={`h-12 rounded-xl border text-sm font-semibold focus-visible:ring-2 focus-visible:ring-action-primary/50 ${
                                                mod.active ? 'bg-action-primary text-white border-action-primary' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'
                                            }`}
                                        >
                                            {key.toUpperCase()}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
                            {secondaryActions.map((action, i) =>
                                action.type === 'divider' ? (
                                    <div key={i} className="col-span-2 text-gray-400 text-xs font-medium tracking-widest text-center py-2 uppercase">
                                        {action.label}
                                    </div>
                                ) : (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => {
                                            action.onClick?.();
                                        }}
                                        disabled={action.disabled}
                                        className={`h-14 rounded-xl flex flex-col items-center justify-center gap-1 transition-all ${
                                            action.active
                                                ? 'bg-action-primary text-white shadow-lg shadow-blue-500/20'
                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        } ${action.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <span className="font-semibold text-sm">{action.label}</span>
                                    </button>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </>
        );
    }
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

    // US-266: Base container now uses GlassSurface with float depth
    const baseContainerClasses = "fixed bottom-8 left-1/2 -translate-x-1/2 h-16 rounded-full flex items-center justify-between px-2 z-50 min-w-[320px] max-w-[95vw] transition-all motion-state animate-scale-in";

    if (!primaryAction && secondaryActions.length === 0 && children) {
        return (
             <GlassSurface depth="float" className={baseContainerClasses}>
                {children}
            </GlassSurface>
        );
    }

    return (
        <>
            {/* Main Floating Island - US-266: Using GlassSurface for consistent glass effect */}
            <GlassSurface depth="float" as="div" className={`${baseContainerClasses} ${className}`}>
                {/* Left: Balance/Bet Info - LUX-010: Inline bet selector */}
                <div className="flex flex-col pl-4 pr-3 border-r border-ns-border/60">
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
                            <span className="text-ns font-bold text-sm tabular-nums tracking-tight">{balance}</span>
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
                                ? 'bg-ns-border/60 text-ns-muted cursor-not-allowed opacity-60'
                                : 'bg-action-primary hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl ring-4 ring-action-primary/20'
                            } ${primaryAction.className || ''}`}
                        >
                            {primaryAction.label}
                        </animated.button>
                        {/* Shadow accent for FAB */}
                        {!primaryAction.disabled && <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-12 h-4 bg-black/5 blur-xl rounded-full -z-10" />}
                    </div>
                )}

                {/* Right: Menu Toggle */}
                <div className="flex items-center gap-1 pr-2">
                    {children && <div className="hidden sm:flex">{children}</div>}
                    <button
                        onClick={() => setMenuOpen(true)}
                        className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-white/60 active:scale-95 transition-all motion-interaction group"
                        aria-label="Open menu"
                    >
                        <Grid className="text-ns-muted group-hover:text-ns w-5 h-5" strokeWidth={2.5} />
                    </button>
                </div>
            </GlassSurface>

            {/* Bottom Sheet / Menu Overlay - US-266: Using consistent backdrop */}
            <div
                className={`fixed inset-0 z-[60] transition-opacity motion-state ${
                    menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
            >
                <button
                    type="button"
                    aria-label="Close menu"
                    className="absolute inset-0 bg-mono-0/20 dark:bg-mono-0/40 backdrop-blur-sm cursor-default"
                    onClick={() => setMenuOpen(false)}
                />
                <GlassSurface
                    depth="overlay"
                    className={`absolute bottom-0 left-0 right-0 rounded-t-[40px] p-8 pb-12 transition-transform motion-state ${
                        menuOpen ? 'translate-y-0' : 'translate-y-full'
                    }`}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                >
                    {/* Sheet Handle */}
                    <div className="w-12 h-1 bg-ns-border/60 rounded-full mx-auto mb-8" />

                    {/* Header */}
                    <div className="flex justify-between items-center mb-8">
                        <div className="flex flex-col">
                            <Label>{mobileMenuLabel}</Label>
                            <h3 className="text-2xl font-bold text-ns tracking-tight mt-1">Actions</h3>
                        </div>
                        <button
                            onClick={() => setMenuOpen(false)}
                            className="w-11 h-11 liquid-chip flex items-center justify-center text-ns-muted hover:text-ns transition-colors focus-visible:ring-2 focus-visible:ring-action-primary/50"
                            aria-label="Close menu"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Actions Grid */}
                    <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto scrollbar-hide">
                         {children && <div className="p-4 liquid-panel rounded-3xl border border-ns-border/60">{children}</div>}

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
                                            <div className="h-px bg-ns-border/60 w-full mt-2" />
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
                                                    ? 'bg-action-primary text-white border-action-primary shadow-lg'
                                                    : 'bg-white/70 text-ns border-ns-border/60 hover:border-ns-border'
                                            } ${action.disabled ? 'opacity-40 cursor-not-allowed' : 'active:scale-95'}`}
                                        >
                                            <span className="font-bold text-sm tracking-tight">{action.label}</span>
                                        </button>
                                    )
                                )}
                            </div>
                        )}
                    </div>
                </GlassSurface>
            </div>
        </>
    );
};
