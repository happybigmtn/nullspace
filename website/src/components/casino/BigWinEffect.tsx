import React, { useEffect, useState } from 'react';
import { playSfx } from '../../services/sfx';

interface BigWinEffectProps {
    amount: number;
    show: boolean;
    durationMs?: number;
    reducedMotion?: boolean;
    /** Total bet amount - used to determine if this is a "grand win" (10x+) */
    betAmount?: number;
}

export const BigWinEffect: React.FC<BigWinEffectProps> = ({ amount, show, durationMs, reducedMotion = false, betAmount = 0 }) => {
    const [visible, setVisible] = useState(false);

    // Determine if this qualifies as a "grand win" (10x or more multiplier)
    const isGrandWin = betAmount > 0 && amount >= betAmount * 10;
    const displayDuration = durationMs ?? (isGrandWin ? 2500 : 1500);

    useEffect(() => {
        if (show && amount > 0) {
            void playSfx('win');
            if ('vibrate' in navigator) {
                navigator.vibrate(isGrandWin ? [100, 50, 100, 50, 100] : [100]);
            }
            setVisible(true);
            const timer = setTimeout(() => setVisible(false), displayDuration);
            return () => clearTimeout(timer);
        } else {
            setVisible(false);
        }
    }, [show, amount, displayDuration, isGrandWin]);

    if (!visible) return null;

    const colors = ['#007AFF', '#34C759', '#FFD700', '#FF3B30'];

    // Grand Win: Full celebration with confetti
    if (isGrandWin) {
        return (
            <div className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-none overflow-hidden">
                <div className="absolute inset-0 bg-white/60 backdrop-blur-xl animate-scale-in"></div>

                {/* Staggered Confetti Particles */}
                {!reducedMotion && (
                    <div className="absolute inset-0">
                        {[...Array(50)].map((_, i) => (
                            <div
                                key={i}
                                className="confetti"
                                style={{
                                    left: '50%',
                                    top: '50%',
                                    backgroundColor: colors[i % colors.length],
                                    '--x': `${(Math.random() - 0.5) * 1000}px`,
                                    '--y': `${(Math.random() - 0.5) * 1000}px`,
                                    '--duration': `${1.5 + Math.random()}s`,
                                    '--delay': `${Math.random() * 0.3}s`,
                                } as React.CSSProperties}
                            />
                        ))}
                    </div>
                )}

                <div className={`relative flex flex-col items-center gap-2 ${reducedMotion ? '' : 'animate-scale-in'}`}>
                    <div className="flex flex-col items-center">
                        <span className="text-sm font-black text-mono-0 dark:text-mono-1000 tracking-[0.5em] uppercase mb-4">Grand Win</span>
                        <h2
                            className="text-9xl font-extrabold text-ns tracking-tighter leading-none mb-4"
                            style={{ fontFamily: 'Outfit' }}
                        >
                            ${amount.toLocaleString()}
                        </h2>
                    </div>
                    <div className="bg-mono-0 text-white rounded-full px-8 py-2 shadow-lg scale-110">
                        <span className="text-xs font-bold uppercase tracking-[0.3em]">Balance Credited</span>
                    </div>
                </div>
            </div>
        );
    }

    // Standard Win: Simple centered display
    return (
        <div className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-none overflow-hidden">
            <div className={`relative flex flex-col items-center gap-2 ${reducedMotion ? '' : 'animate-scale-in'}`}>
                <div className="flex flex-col items-center bg-white/90 dark:bg-mono-900/90 backdrop-blur-lg rounded-3xl px-12 py-8 shadow-float border border-ns">
                    <span className="text-xs font-bold text-ns-muted tracking-[0.3em] uppercase mb-2">Win</span>
                    <h2
                        className="text-5xl font-extrabold text-ns tracking-tight leading-none"
                        style={{ fontFamily: 'Outfit' }}
                    >
                        +${amount.toLocaleString()}
                    </h2>
                </div>
            </div>
        </div>
    );
};
