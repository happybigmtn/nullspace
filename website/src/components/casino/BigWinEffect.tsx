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
            setVisible(true);
            const timer = setTimeout(() => setVisible(false), durationMs ?? 1000);
            return () => clearTimeout(timer);
        } else {
            setVisible(false);
        }
    }, [show, amount, durationMs]);

    if (!visible) return null;

    return (
        <div className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-none overflow-hidden">
            <div className="absolute inset-0 bg-white/40 backdrop-blur-md"></div>
            
            <div className={`relative flex flex-col items-center gap-4 ${reducedMotion ? '' : 'animate-scale-in'}`}>
                <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] font-bold text-action-success tracking-[0.4em] uppercase">Victory</span>
                    <h2 className="text-8xl font-light text-titanium-900 tracking-tighter leading-none mb-2">Winner</h2>
                </div>
                <div className="bg-white border border-titanium-200 rounded-3xl px-10 py-4 shadow-float">
                    <span className="text-5xl font-bold text-titanium-900 tabular-nums">
                        +${amount.toLocaleString()}
                    </span>
                </div>
            </div>
        </div>
    );
};
