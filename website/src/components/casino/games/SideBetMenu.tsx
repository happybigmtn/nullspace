import React, { useMemo, useState } from 'react';

export interface SideBetOption {
    key: string;
    action: string;
    label: string;
    disabled?: boolean;
}

interface SideBetMenuProps {
    bets: SideBetOption[];
    isActive: (action: string) => boolean;
    onSelect: (action: string) => void;
    label?: string;
    shortcutHint?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    show?: boolean;
    className?: string;
}

export const SideBetMenu: React.FC<SideBetMenuProps> = ({
    bets,
    isActive,
    onSelect,
    label = 'BONUS',
    shortcutHint,
    open,
    onOpenChange,
    show = true,
    className,
}) => {
    const [internalOpen, setInternalOpen] = useState(false);
    const isOpen = open ?? internalOpen;
    const setOpen = onOpenChange ?? setInternalOpen;

    const anyActive = useMemo(
        () => bets.some((bet) => isActive(bet.action)),
        [bets, isActive]
    );

    if (!show) return null;

    const handleSelect = (action: string) => {
        onSelect(action);
        setOpen(false);
    };

    const BetButton: React.FC<{ bet: SideBetOption }> = ({ bet }) => {
        const isBetActive = isActive(bet.action);
        const isDisabled = Boolean(bet.disabled);

        return (
            <button
                type="button"
                onClick={() => !isDisabled && handleSelect(bet.action)}
                disabled={isDisabled}
                className={`
                    relative flex flex-col items-center justify-center
                    h-14 px-3 min-w-[60px]
                    border rounded transition-all duration-150
                    font-mono text-xs tracking-wider
                    ${isBetActive
                        ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.3)]'
                        : isDisabled
                            ? 'border-gray-800 bg-black/50 text-gray-700 cursor-not-allowed'
                            : 'border-gray-700 bg-gray-900/80 text-gray-300 hover:border-amber-600 hover:text-amber-400 hover:bg-amber-900/20'
                    }
                `}
            >
                <span className="font-bold">{bet.label}</span>
                <span className={`text-[9px] mt-0.5 ${isBetActive ? 'text-amber-500' : 'text-gray-600'}`}>
                    [{bet.key.toUpperCase()}]
                </span>
            </button>
        );
    };

    return (
        <div className={`relative ${className ?? ''}`}>
            <button
                type="button"
                onClick={() => setOpen(!isOpen)}
                className={`
                    h-12 px-4 border rounded font-mono text-sm font-bold tracking-wider transition-all
                    ${isOpen
                        ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-[0_0_15px_rgba(251,191,36,0.3)]'
                        : anyActive
                            ? 'border-amber-600/50 bg-amber-900/20 text-amber-400 hover:border-amber-500 animate-pulse'
                            : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-amber-600 hover:text-amber-400'
                    }
                `}
            >
                {label}
                {shortcutHint && (
                    <span className="ml-1 text-[10px] text-gray-600">[{shortcutHint}]</span>
                )}
                {anyActive && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                )}
            </button>

            {isOpen && (
                <div className="absolute bottom-full left-0 mb-2 flex gap-1 p-2 bg-black/95 border border-amber-900/50 rounded-lg backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-150 z-50">
                    {bets.map((bet) => (
                        <BetButton key={`${bet.action}-${bet.key}`} bet={bet} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default SideBetMenu;
