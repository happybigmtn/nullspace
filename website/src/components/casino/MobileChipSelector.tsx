import React, { useState } from 'react';

interface MobileChipSelectorProps {
    currentBet: number;
    onSelectBet: (amount: number) => void;
    isCustom?: boolean;
    fixedMode?: boolean;
    className?: string;
}

const CHIPS = [1, 5, 25, 100, 500, 1000, 5000, 10000];

export const MobileChipSelector: React.FC<MobileChipSelectorProps> = ({ currentBet, onSelectBet, isCustom, fixedMode, className }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [pos, setPos] = useState({ x: typeof window !== 'undefined' ? window.innerWidth - 72 : 300, y: 80 });
    const isDragging = React.useRef(false);
    const dragStart = React.useRef({ x: 0, y: 0 });
    const initialPos = React.useRef({ x: 0, y: 0 });

    const handleSelect = (amount: number) => {
        onSelectBet(amount);
        setIsOpen(false);
    };

    const onTouchStart = (e: React.TouchEvent) => {
        if (fixedMode) return;
        isDragging.current = false;
        const touch = e.touches[0];
        dragStart.current = { x: touch.clientX, y: touch.clientY };
        initialPos.current = { ...pos };
    };

    const onTouchMove = (e: React.TouchEvent) => {
        if (fixedMode) return;
        const touch = e.touches[0];
        const dx = touch.clientX - dragStart.current.x;
        const dy = touch.clientY - dragStart.current.y;
        
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            isDragging.current = true;
            setPos({
                x: Math.max(8, Math.min(window.innerWidth - 64, initialPos.current.x + dx)),
                y: Math.max(8, Math.min(window.innerHeight - 64, initialPos.current.y + dy))
            });
        }
    };

    const onClick = () => {
        if (!isDragging.current) {
            setIsOpen(!isOpen);
        }
    };

    const buttonStyle = fixedMode ? {} : { left: pos.x, top: pos.y };
    const buttonClass = fixedMode
        ? `relative flex items-center justify-center w-10 h-10 rounded-full border border-titanium-200 bg-white shadow-soft transition-shadow active:shadow-md ${className || ''}`
        : `fixed sm:hidden z-50 flex items-center justify-center w-14 h-14 rounded-full border border-titanium-200 bg-white/80 backdrop-blur-xl shadow-float transition-all active:scale-95 touch-none ${className || ''}`;

    const menuStyle = fixedMode
        ? { top: '3.5rem', right: '0.5rem' }
        : { left: pos.x, top: pos.y + 64 };

    return (
        <>
            {/* Main Toggle Button */}
            <button
                type="button"
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onClick={onClick}
                style={buttonStyle}
                className={buttonClass}
            >
                <div className="flex flex-col items-center leading-none">
                    <span className={`${fixedMode ? 'text-[6px]' : 'text-[8px]'} text-titanium-400 font-bold uppercase tracking-[0.2em] mb-0.5`}>Bet</span>
                    <span className={`${fixedMode ? 'text-[10px]' : 'text-sm'} font-bold text-titanium-900 tabular-nums`}>
                        {currentBet >= 1000 ? `${currentBet / 1000}k` : currentBet}
                    </span>
                </div>
            </button>

            {/* Chip Selection Menu */}
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40 bg-titanium-900/10 backdrop-blur-md" onClick={() => setIsOpen(false)} />
                    <div
                        className="fixed z-50 flex flex-col gap-3 p-3 bg-white/90 border border-titanium-200 rounded-[32px] shadow-float backdrop-blur-xl animate-scale-in origin-top overflow-y-auto max-h-[60vh] scrollbar-hide"
                        style={menuStyle}
                    >
                        {CHIPS.map((chip) => (
                            <button
                                key={chip}
                                type="button"
                                onClick={() => handleSelect(chip)}
                                className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all duration-200 flex-shrink-0 font-bold text-xs tabular-nums ${
                                    currentBet === chip
                                        ? 'bg-titanium-900 text-white border-titanium-900 shadow-md scale-110'
                                        : 'bg-white text-titanium-800 border-titanium-200 hover:border-titanium-400'
                                }`}
                            >
                                <span>
                                    {chip >= 1000 ? `${chip / 1000}k` : chip}
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </>
    );
};
