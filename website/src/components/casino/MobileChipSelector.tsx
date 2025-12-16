import React, { useState } from 'react';

interface MobileChipSelectorProps {
    currentBet: number;
    onSelectBet: (amount: number) => void;
    isCustom?: boolean;
}

const CHIPS = [1, 5, 25, 100, 500, 1000, 5000, 10000];

export const MobileChipSelector: React.FC<MobileChipSelectorProps> = ({ currentBet, onSelectBet, isCustom }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [pos, setPos] = useState({ x: typeof window !== 'undefined' ? window.innerWidth - 72 : 300, y: 80 }); // Default right side
    const isDragging = React.useRef(false);
    const dragStart = React.useRef({ x: 0, y: 0 });
    const initialPos = React.useRef({ x: 0, y: 0 });

    const handleSelect = (amount: number) => {
        onSelectBet(amount);
        setIsOpen(false);
    };

    const onTouchStart = (e: React.TouchEvent) => {
        isDragging.current = false;
        const touch = e.touches[0];
        dragStart.current = { x: touch.clientX, y: touch.clientY };
        initialPos.current = { ...pos };
    };

    const onTouchMove = (e: React.TouchEvent) => {
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

    return (
        <>
            {/* Main Toggle Button */}
            <button
                type="button"
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onClick={onClick}
                style={{ left: pos.x, top: pos.y }}
                className="fixed sm:hidden z-50 flex items-center justify-center w-14 h-14 rounded-full border-2 border-terminal-gold bg-terminal-black/90 shadow-lg backdrop-blur-sm touch-none"
            >
                <div className="flex flex-col items-center leading-none">
                    <span className="text-[8px] text-terminal-gold uppercase tracking-widest mb-0.5">BET</span>
                    <span className="text-xs font-bold text-white">
                        {currentBet >= 1000 ? `${currentBet / 1000}k` : currentBet}
                    </span>
                </div>
            </button>

            {/* Chip Selection Menu */}
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
                    <div 
                        className="fixed z-50 flex flex-col gap-3 animate-slide-down origin-top"
                        style={{ left: pos.x, top: pos.y + 64 }}
                    >
                        {CHIPS.map((chip) => (
                            <button
                                key={chip}
                                type="button"
                                onClick={() => handleSelect(chip)}
                                className={`w-12 h-12 rounded-full border flex items-center justify-center shadow-lg transition-transform active:scale-95 ${
                                    currentBet === chip
                                        ? 'border-terminal-green bg-terminal-green text-black scale-110'
                                        : 'border-gray-600 bg-gray-900 text-gray-300'
                                }`}
                            >
                                <span className="text-[10px] font-bold">
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
