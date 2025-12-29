import React, { useEffect, useRef, useMemo } from 'react';
import { useSpring, animated, config, to } from '@react-spring/web';

interface Pseudo3DWheelProps {
    lastNumber: number | null;
    isSpinning: boolean;
    className?: string;
    style?: React.CSSProperties;
    onSpinComplete?: () => void;
}

const ROULETTE_NUMBERS = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const getNumberColor = (num: number) => {
    if (num === 0) return '#34C759';
    const redNums = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    return redNums.includes(num) ? '#FF3B30' : '#1C1C1E';
};

// Calculate the angle for a number on the wheel
const getNumberAngle = (num: number): number => {
    const index = ROULETTE_NUMBERS.indexOf(num);
    if (index === -1) return 0;
    return (index * 360 / 37);
};

export const Pseudo3DWheel: React.FC<Pseudo3DWheelProps> = ({
    lastNumber,
    isSpinning,
    className = '',
    style,
    onSpinComplete
}) => {
    // Use refs to track state without causing re-renders
    const totalRotationRef = useRef(0);
    const spinIdRef = useRef(0);

    // Calculate target rotation when lastNumber changes
    // The wheel rotates so the winning number aligns with the pointer at top
    const targetRotation = useMemo(() => {
        if (lastNumber === null) return 0;

        const numberAngle = getNumberAngle(lastNumber);
        // Add extra spins for visual effect (only when starting a new spin)
        const extraSpins = (6 + Math.floor(Math.random() * 4)) * 360;

        // Negative rotation to bring the number to the top (clockwise spin)
        const newTarget = -(numberAngle + extraSpins);

        // Store this as the new base rotation
        totalRotationRef.current = newTarget;
        spinIdRef.current += 1;

        return newTarget;
    }, [lastNumber]);

    // Final resting position (normalized to show correct number at top)
    const restingRotation = useMemo(() => {
        if (lastNumber === null) return 0;
        const numberAngle = getNumberAngle(lastNumber);
        // Normalize to position the winning number at top
        return -(numberAngle % 360);
    }, [lastNumber]);

    const { rotate } = useSpring({
        rotate: isSpinning ? targetRotation : restingRotation,
        config: isSpinning
            ? { mass: 4, tension: 100, friction: 40 }
            : { mass: 1, tension: 200, friction: 30 },
        onRest: () => {
            if (isSpinning && onSpinComplete) {
                onSpinComplete();
            }
        }
    });

    // Ball animation - lands at top (0 degrees) where the pointer is
    const { ballRotate, ballRadius } = useSpring({
        ballRotate: isSpinning ? 1440 + Math.random() * 720 : 0,
        ballRadius: isSpinning ? 135 : 118,
        config: isSpinning
            ? { duration: 3500, easing: (t: number) => t * t * (3 - 2 * t) }
            : { mass: 3, tension: 120, friction: 14 }
    });

    return (
        <div className={`relative aspect-square ${className}`} style={{ width: 320, height: 320, ...style }}>
            <div className="absolute inset-4 rounded-full aspect-square bg-black/20 blur-2xl" />

            <div className="absolute inset-0 rounded-full aspect-square border-[12px] border-titanium-200 shadow-float flex items-center justify-center bg-titanium-100 overflow-hidden">
                
                <animated.div 
                    className="w-full h-full rounded-full relative shadow-inner"
                    style={{ transform: rotate.to(r => `rotate(${r}deg)`) }}
                >
                    <svg viewBox="0 0 320 320" className="w-full h-full transform -rotate-90">
                        {ROULETTE_NUMBERS.map((num, i) => {
                            const angle = 360 / 37;
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
                                        {num}
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
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-8 bg-action-primary z-20 shadow-lg" 
                    style={{ clipPath: 'polygon(0% 0%, 100% 0%, 50% 100%)' }} 
                />
                
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/20 via-transparent to-black/5 pointer-events-none" />
            </div>
        </div>
    );
};
