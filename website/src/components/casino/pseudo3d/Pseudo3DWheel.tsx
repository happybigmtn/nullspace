import React, { useEffect, useState } from 'react';
import { useSpring, animated, config } from '@react-spring/web';

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
    if (num === 0) return '#00ff41'; // Terminal Green
    const redNums = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    return redNums.includes(num) ? '#ff003c' : '#111111';
};

export const Pseudo3DWheel: React.FC<Pseudo3DWheelProps> = ({
    lastNumber,
    isSpinning,
    className = '',
    style,
    onSpinComplete
}) => {
    // Wheel rotation state
    const [rotation, setRotation] = useState(0);

    // Calculate target rotation based on number
    const getTargetRotation = (target: number) => {
        const index = ROULETTE_NUMBERS.indexOf(target);
        if (index === -1) return 0;
        const segmentAngle = 360 / 37;
        // Adjust for index position + random spins (5-10 full spins)
        const baseRotation = index * segmentAngle;
        const extraSpins = (5 + Math.floor(Math.random() * 5)) * 360; 
        return -(baseRotation + extraSpins); // Negative for clockwise spin visual
    };

    const { rotate } = useSpring({
        rotate: isSpinning && lastNumber !== null 
            ? getTargetRotation(lastNumber) 
            : rotation,
        config: { mass: 5, tension: 80, friction: 30, clamp: true },
        onRest: () => {
            if (isSpinning && onSpinComplete) {
                onSpinComplete();
            }
            // Normalize rotation for next spin to prevent huge numbers
            if (!isSpinning) {
                 const currentRot = rotation % 360;
                 setRotation(currentRot); 
            }
        }
    });
    
    // Ball Animation (Orbit)
    // Simplified: Ball stays at top (12 o'clock) while wheel spins? 
    // Or ball spins opposite?
    // Let's make the ball spin counter-clockwise relative to wheel
    const { ballRotate, ballRadius } = useSpring({
        ballRotate: isSpinning ? 720 + Math.random() * 360 : 0,
        ballRadius: isSpinning ? 130 : 110, // Ball drops in
        config: isSpinning ? { duration: 3000, easing: t => t * (2-t) } : { duration: 500 }
    });

    return (
        <div className={`relative ${className}`} style={{ width: 320, height: 320, ...style }}>
            {/* Outer Static Ring */}
            <div className="absolute inset-0 rounded-full border-[16px] border-[#1a1a1a] shadow-2xl flex items-center justify-center bg-[#0a0a0a]">
                
                {/* Spinning Wheel */}
                <animated.div 
                    className="w-full h-full rounded-full relative"
                    style={{ transform: rotate.to(r => `rotate(${r}deg)`) }}
                >
                    {/* Render Segments via Conic Gradient or SVG? SVG is cleaner for numbers */}
                    <svg viewBox="0 0 320 320" className="w-full h-full transform -rotate-90">
                        {ROULETTE_NUMBERS.map((num, i) => {
                            const angle = 360 / 37;
                            const rotation = i * angle;
                            const color = getNumberColor(num);
                            
                            // Calculate SVG path for wedge
                            // Center is 160,160. Radius 140 (leave border).
                            const r = 140;
                            const startA = (rotation - angle/2) * Math.PI / 180;
                            const endA = (rotation + angle/2) * Math.PI / 180;
                            const x1 = 160 + r * Math.cos(startA);
                            const y1 = 160 + r * Math.sin(startA);
                            const x2 = 160 + r * Math.cos(endA);
                            const y2 = 160 + r * Math.sin(endA);

                            // Text position (closer to edge)
                            const textR = 120;
                            const textA = rotation * Math.PI / 180;
                            const tx = 160 + textR * Math.cos(textA);
                            const ty = 160 + textR * Math.sin(textA);

                            return (
                                <g key={num}>
                                    <path 
                                        d={`M160,160 L${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2} Z`} 
                                        fill={color}
                                        stroke="#1a1a1a"
                                        strokeWidth="1"
                                    />
                                    <text 
                                        x={tx} 
                                        y={ty} 
                                        fill="white" 
                                        fontSize="12" 
                                        fontWeight="bold"
                                        textAnchor="middle" 
                                        dominantBaseline="middle"
                                        transform={`rotate(${rotation + 90}, ${tx}, ${ty})`}
                                    >
                                        {num}
                                    </text>
                                </g>
                            );
                        })}
                        {/* Center Hub */}
                        <circle cx="160" cy="160" r="40" fill="#1a1a1a" stroke="#333" strokeWidth="2" />
                    </svg>
                </animated.div>

                {/* Ball */}
                <animated.div 
                    className="absolute w-4 h-4 bg-white rounded-full shadow-[0_0_10px_white] z-10"
                    style={{
                        transform: ballRotate.to(r => `rotate(${-r}deg) translateY(-${115}px)`), // Simple orbit for now
                        opacity: isSpinning ? 1 : 0 // Hide ball when not spinning for clean look, or keep it on winning number
                    }}
                />
                
                {/* Pointer / Flapper */}
                <div className="absolute top-[-10px] left-1/2 -translate-x-1/2 w-4 h-8 bg-action-primary z-20 shadow-lg" style={{ clipPath: 'polygon(0% 0%, 100% 0%, 50% 100%)' }} />
                
                {/* Gloss Overlay */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/5 to-transparent pointer-events-none" />
            </div>
        </div>
    );
};
