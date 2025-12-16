import React, { useState } from 'react';
import { MobileDrawer } from './MobileDrawer';

interface Action {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
    className?: string; // Optional custom class
}

interface GameControlBarProps {
    children?: React.ReactNode;
    primaryAction?: Action;
    secondaryActions?: Action[];
    className?: string;
    variant?: 'row' | 'stack';
    ariaLabel?: string;
    mobileMenuLabel?: string; // Label for the "Bets/Options" button on mobile
}

export const GameControlBar: React.FC<GameControlBarProps> = ({
    children,
    primaryAction,
    secondaryActions = [],
    className = '',
    variant = 'row',
    ariaLabel = 'Game controls',
    mobileMenuLabel = 'BETS',
}) => {
    const [menuOpen, setMenuOpen] = useState(false);

    // Desktop base: absolute bottom
    // Mobile base: fixed bottom
    const base =
        'ns-controlbar fixed bottom-0 left-0 right-0 sm:sticky sm:bottom-0 bg-terminal-black/95 backdrop-blur border-t-2 border-gray-700 z-50 pb-[env(safe-area-inset-bottom)] sm:pb-0';
    
    // Layout for standard mode
    const layout =
        variant === 'stack'
            ? 'p-2'
            : 'h-16 sm:h-20 flex items-center justify-between sm:justify-center gap-2 p-2 sm:px-4';

    // If no new props are used, render children directly (legacy/custom mode)
    if (!primaryAction && secondaryActions.length === 0) {
        return (
            <div role="group" aria-label={ariaLabel} className={[base, layout, className].filter(Boolean).join(' ')}>
                {children}
            </div>
        );
    }

    const hasSecondary = secondaryActions.length > 0;
    const collapseSecondary = secondaryActions.length > 3;

    return (
        <div role="group" aria-label={ariaLabel} className={[base, layout, className].filter(Boolean).join(' ')}>
            {/* Mobile: Left Actions (Menu or Direct) */}
            <div className="flex sm:hidden flex-1 justify-start gap-2">
                {children} {/* Render custom children (like modifiers) on left */}
                
                {hasSecondary && (
                    collapseSecondary ? (
                        <button
                            type="button"
                            onClick={() => setMenuOpen(true)}
                            className="h-12 px-4 border border-gray-600 rounded bg-gray-900 text-gray-300 font-bold text-xs tracking-widest hover:bg-gray-800"
                        >
                            {mobileMenuLabel}
                        </button>
                    ) : (
                        secondaryActions.map((action, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={action.onClick}
                                disabled={action.disabled}
                                className={`h-12 px-3 border rounded text-xs font-bold tracking-widest ${
                                    action.active
                                        ? 'border-terminal-green bg-terminal-green/20 text-terminal-green'
                                        : 'border-gray-700 bg-gray-900 text-gray-400'
                                } ${action.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-800'} ${action.className || ''}`}
                            >
                                {action.label}
                            </button>
                        ))
                    )
                )}
            </div>

            {/* Desktop: Centered Row */}
            <div className="hidden sm:flex items-center gap-4">
                {children}
                {secondaryActions.map((action, i) => (
                    <button
                        key={i}
                        type="button"
                        onClick={action.onClick}
                        disabled={action.disabled}
                        className={`h-12 px-4 border rounded text-sm font-bold tracking-widest transition-all ${
                            action.active
                                ? 'border-terminal-green bg-terminal-green/20 text-terminal-green shadow-[0_0_10px_rgba(74,222,128,0.2)]'
                                : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500 hover:text-white'
                        } ${action.disabled ? 'opacity-50 cursor-not-allowed' : ''} ${action.className || ''}`}
                    >
                        {action.label}
                    </button>
                ))}
            </div>

            {/* Primary Action (Always Right on Mobile, Right/End on Desktop) */}
            {primaryAction && (
                <button
                    type="button"
                    onClick={primaryAction.onClick}
                    disabled={primaryAction.disabled}
                    className={`h-12 sm:h-14 px-6 sm:px-8 rounded border-2 font-bold text-sm sm:text-base tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,0,0,0.5)] ${
                        primaryAction.disabled
                            ? 'border-gray-800 bg-gray-900 text-gray-600 cursor-not-allowed'
                            : 'border-terminal-green bg-terminal-green text-black hover:bg-white hover:border-white hover:scale-105 active:scale-95'
                    } ${primaryAction.className || ''}`}
                >
                    {primaryAction.label}
                </button>
            )}

            {/* Mobile Bets Menu */}
            {hasSecondary && collapseSecondary && (
                <div
                    className={`fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm transition-opacity duration-200 ${
                        menuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                    }`}
                    onClick={() => setMenuOpen(false)}
                >
                    <div
                        className={`absolute bottom-0 left-0 right-0 bg-terminal-black border-t-2 border-terminal-green p-4 pb-8 transition-transform duration-300 ${
                            menuOpen ? 'translate-y-0' : 'translate-y-full'
                        }`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-2">
                            <span className="text-sm font-bold text-terminal-green tracking-widest">{mobileMenuLabel}</span>
                            <button onClick={() => setMenuOpen(false)} className="text-gray-500 hover:text-white px-2">
                                [CLOSE]
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
                            {secondaryActions.map((action, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => {
                                        action.onClick();
                                        // Optional: keep open for rapid betting? No, user likely wants to bet then deal.
                                        // Actually, for Roulette multiple bets are common. Let's keep it open.
                                    }}
                                    disabled={action.disabled}
                                    className={`h-14 border rounded flex flex-col items-center justify-center gap-1 ${
                                        action.active
                                            ? 'border-terminal-green bg-terminal-green/10 text-terminal-green'
                                            : 'border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800'
                                    } ${action.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <span className="font-bold text-xs tracking-widest">{action.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
