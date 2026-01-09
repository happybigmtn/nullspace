import React, { useEffect, useState } from 'react';
import { playSfx } from '../../services/sfx';

interface BigWinEffectProps {
    amount: number;
    show: boolean;
    durationMs?: number;
    reducedMotion?: boolean;
}

export const BigWinEffect: React.FC<BigWinEffectProps> = ({ amount, show, durationMs, reducedMotion = false }) => {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (show && amount > 0) {
            void playSfx('win');
            if ('vibrate' in navigator) {
                navigator.vibrate([100, 50, 100]);
            }
            setVisible(true);
            const timer = setTimeout(() => setVisible(false), durationMs ?? 2500);
            return () => clearTimeout(timer);
        } else {
            setVisible(false);
        }
    }, [show, amount, durationMs]);

    if (!visible) return null;

    const colors = ['#007AFF', '#34C759', '#FFD700', '#FF3B30'];

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
                        className="text-9xl font-extrabold text-titanium-900 tracking-tighter leading-none mb-4"
                        style={{ fontFamily: 'Outfit' }}
                    >
                        ${amount.toLocaleString()}
                    </h2>
                </div>
                <div className="bg-titanium-900 text-white rounded-full px-8 py-2 shadow-lg scale-110">
                    <span className="text-xs font-bold uppercase tracking-[0.3em]">Balance Credited</span>
                </div>
            </div>
        </div>
    );
};
