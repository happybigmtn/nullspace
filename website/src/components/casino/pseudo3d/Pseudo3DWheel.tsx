import React, { useEffect, useRef, useMemo } from 'react';
import { animated, easings, to, useSpring } from '@react-spring/web';
import { springConfig } from '../../../utils/motion';
import { formatRouletteNumber, ROULETTE_DOUBLE_ZERO } from '../../../utils/gameUtils';

interface Pseudo3DWheelProps {
    lastNumber: number | null;
    isSpinning: boolean;
    isAmerican?: boolean;
    className?: string;
    style?: React.CSSProperties;
    onSpinComplete?: () => void;
}

const ROULETTE_NUMBERS_EURO = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const ROULETTE_NUMBERS_AMERICAN = [
    0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1,
    ROULETTE_DOUBLE_ZERO, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2
];

const getNumberColor = (num: number) => {
    if (num === 0 || num === ROULETTE_DOUBLE_ZERO) return '#34C759';
    const redNums = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    return redNums.includes(num) ? '#FF3B30' : '#1C1C1E';
};

// Calculate the angle for a number on the wheel
const getNumberAngle = (num: number, sequence: number[]): number => {
    const index = sequence.indexOf(num);
    if (index === -1) return 0;
    return (index * 360 / sequence.length);
};

export const Pseudo3DWheel: React.FC<Pseudo3DWheelProps> = ({
    lastNumber,
    isSpinning,
    isAmerican = false,
    className = '',
    style,
    onSpinComplete
}) => {
    const pendingSpinRef = useRef(false);
    const settlingRef = useRef(false);
    const lastNumberRef = useRef<number | null>(lastNumber);
    const spinSeedRef = useRef({ extraSpins: 6, durationMs: 2800 });
    const wheelSpinConfig = useMemo(() => springConfig('wheelSpin'), []);
    const wheelNumbers = useMemo(
        () => (isAmerican ? ROULETTE_NUMBERS_AMERICAN : ROULETTE_NUMBERS_EURO),
        [isAmerican],
    );

    const [{ rotate }, api] = useSpring(() => ({ rotate: 0 }));
    const [{ ballRotate, ballRadius }, ballApi] = useSpring(() => ({
        ballRotate: 0,
        ballRadius: 118,
    }));

    useEffect(() => {
        if (!isSpinning) return;
        pendingSpinRef.current = true;
        settlingRef.current = false;
        spinSeedRef.current = {
            extraSpins: 6 + Math.floor(Math.random() * 4),
            durationMs: 2600 + Math.floor(Math.random() * 600),
        };

        api.start({
            from: { rotate: rotate.get() },
            to: { rotate: rotate.get() - 360 },
            loop: true,
            config: { duration: 900, easing: easings.linear },
        });
        ballApi.start({
            from: { ballRotate: 0 },
            to: { ballRotate: -360 },
            loop: true,
            config: { duration: 700, easing: easings.linear },
        });
        ballApi.start({ ballRadius: 135 });
        return () => {
            api.stop();
            ballApi.stop();
        };
    }, [isSpinning, api, ballApi, rotate]);

    useEffect(() => {
        if (lastNumber === null) return;
        if (lastNumberRef.current === null) {
            lastNumberRef.current = lastNumber;
            return;
        }
        if (lastNumber === lastNumberRef.current) return;
        lastNumberRef.current = lastNumber;

        if (!pendingSpinRef.current) {
            const restingRotation = -(getNumberAngle(lastNumber, wheelNumbers) % 360);
            api.start({ to: { rotate: restingRotation }, config: wheelSpinConfig });
            ballApi.start({ to: { ballRotate: 0, ballRadius: 118 }, config: wheelSpinConfig });
            return;
        }

        api.stop();
        ballApi.stop();
        settlingRef.current = true;
        const { extraSpins, durationMs } = spinSeedRef.current;
        const numberAngle = getNumberAngle(lastNumber, wheelNumbers);
        const targetRotation = -(numberAngle + extraSpins * 360);
        const settleConfig = { duration: durationMs, easing: easings.easeOutCubic };

        api.start({
            to: { rotate: targetRotation },
            config: settleConfig,
            onRest: () => {
                pendingSpinRef.current = false;
                settlingRef.current = false;
                onSpinComplete?.();
            },
        });
        ballApi.start({
            to: { ballRotate: 0, ballRadius: 118 },
            config: settleConfig,
        });
    }, [lastNumber, api, ballApi, onSpinComplete, wheelSpinConfig, wheelNumbers]);

    useEffect(() => {
        if (isSpinning || settlingRef.current) return;
        if (pendingSpinRef.current) {
            pendingSpinRef.current = false;
        }
        const restingRotation = lastNumber === null ? 0 : -(getNumberAngle(lastNumber, wheelNumbers) % 360);
        api.stop();
        ballApi.stop();
        api.start({ to: { rotate: restingRotation }, config: wheelSpinConfig });
        ballApi.start({ to: { ballRotate: 0, ballRadius: 118 }, config: wheelSpinConfig });
    }, [isSpinning, lastNumber, api, ballApi, wheelSpinConfig, wheelNumbers]);

    return (
        <div className={`relative aspect-square ${className}`} style={{ width: 320, height: 320, ...style }}>
            <div className="absolute inset-4 rounded-full aspect-square bg-black/20 blur-2xl" />

            <div className="absolute inset-0 rounded-full aspect-square border-[12px] border-titanium-200 shadow-float flex items-center justify-center bg-titanium-100 overflow-hidden">
                
                <animated.div 
                    className="w-full h-full rounded-full relative shadow-inner"
                    style={{ transform: rotate.to(r => `rotate(${r}deg)`) }}
                >
                    <svg viewBox="0 0 320 320" className="w-full h-full transform -rotate-90">
                        {wheelNumbers.map((num, i) => {
                            const angle = 360 / wheelNumbers.length;
                            const rotation = i * angle;
                            const color = getNumberColor(num);
                            
                            const r = 148;
                            const startA = (rotation - angle/2) * Math.PI / 180;
                            const endA = (rotation + angle/2) * Math.PI / 180;
                            const x1 = 160 + r * Math.cos(startA);
                            const y1 = 160 + r * Math.sin(startA);
                            const x2 = 160 + r * Math.cos(endA);
                            const y2 = 160 + r * Math.sin(endA);

                            const textR = 124;
                            const textA = rotation * Math.PI / 180;
                            const tx = 160 + textR * Math.cos(textA);
                            const ty = 160 + textR * Math.sin(textA);

                            return (
                                <g key={num}>
                                    <path 
                                        d={`M160,160 L${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2} Z`} 
                                        fill={color}
                                        stroke="rgba(255,255,255,0.05)"
                                        strokeWidth="0.5"
                                    />
                                    <text 
                                        x={tx} 
                                        y={ty} 
                                        fill="white" 
                                        fontSize="9" 
                                        fontWeight="800"
                                        textAnchor="middle" 
                                        dominantBaseline="middle"
                                        style={{ fontFamily: 'Outfit' }}
                                        transform={`rotate(${rotation + 90}, ${tx}, ${ty})`}
                                    >
                                        {formatRouletteNumber(num)}
                                    </text>
                                </g>
                            );
                        })}
                        <defs>
                            <radialGradient id="hubGradient" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stopColor="#f9f9f9" />
                                <stop offset="100%" stopColor="#d1d1d6" />
                            </radialGradient>
                        </defs>
                        <circle cx="160" cy="160" r="45" fill="url(#hubGradient)" />
                        <circle cx="160" cy="160" r="40" fill="none" stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
                    </svg>
                </animated.div>

                {/* Ball - Corrected transform interpolation */}
                <animated.div 
                    className="absolute w-3.5 h-3.5 bg-white rounded-full shadow-lg z-10"
                    style={{
                        transform: to([ballRotate, ballRadius], (r, rad) => 
                            `rotate(${-r}deg) translateY(-${rad}px) scale(${isSpinning ? 1 : 1.15})`
                        ),
                        opacity: isSpinning || lastNumber !== null ? 1 : 0
                    }}
                />
                
                {/* Substantial Pointer (Triangular style) */}
                <div 
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-8 bg-mono-0 z-20 shadow-lg" 
                    style={{ clipPath: 'polygon(0% 0%, 100% 0%, 50% 100%)' }} 
                />
                
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/20 via-transparent to-black/5 pointer-events-none" />
            </div>
        </div>
    );
};
