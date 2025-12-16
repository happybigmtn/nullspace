import React, { useState } from 'react';

interface MobileChipSelectorProps {
    currentBet: number;
    onSelectBet: (amount: number) => void;
    isCustom?: boolean;
}

const CHIPS = [1, 5, 25, 100, 500, 1000, 5000, 10000];

export const MobileChipSelector: React.FC<MobileChipSelectorProps> = ({ currentBet, onSelectBet, isCustom }) => {
    const [isOpen, setIsOpen] = useState(false);

    const handleSelect = (amount: number) => {
        onSelectBet(amount);
        setIsOpen(false);
    };

    return (
        <>
            {/* Main Toggle Button */}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="fixed left-4 bottom-24 sm:hidden z-40 flex items-center justify-center w-14 h-14 rounded-full border-2 border-terminal-gold bg-terminal-black/90 shadow-lg backdrop-blur-sm"
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
                    <div className="fixed left-4 bottom-40 z-50 flex flex-col-reverse gap-3 animate-slide-up origin-bottom">
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
                        {/* Custom Bet Trigger could go here if needed, but keeping it simple for now */}
                    </div>
                </>
            )}
        </>
    );
};
