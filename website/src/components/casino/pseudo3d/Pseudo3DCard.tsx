import React, { useEffect, useState } from 'react';
import { useSpring, animated } from '@react-spring/web';

interface Pseudo3DCardProps {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades' | string;
  rank: string;
  faceUp?: boolean;
  index?: number;
  style?: React.CSSProperties;
  className?: string;
}

const suitColors: Record<string, string> = {
  hearts: '#FF3B30',
  diamonds: '#FF3B30',
  clubs: '#1C1C1E',
  spades: '#1C1C1E',
};

const suitIcons: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

// Different sizes for each suit to ensure visual balance
const suitSizes: Record<string, string> = {
  hearts: '5rem',
  diamonds: '5rem',
  clubs: '4rem',    // Clubs slightly smaller
  spades: '4.5rem',
};

export const Pseudo3DCard: React.FC<Pseudo3DCardProps> = ({
  suit,
  rank,
  faceUp = true,
  index = 0,
  style,
  className = '',
}) => {
  const [isFlipped, setFlipped] = useState(!faceUp);

  useEffect(() => {
    setFlipped(!faceUp);
  }, [faceUp]);

  const { transform, opacity } = useSpring({
    opacity: 1,
    transform: `perspective(1200px) rotateY(${isFlipped ? 180 : 0}deg) translateY(0px)`,
    from: { opacity: 0, transform: `perspective(1200px) rotateY(180deg) translateY(-100px)` },
    // Overshoot config for "snap" feel
    config: { mass: 1.2, tension: 280, friction: 22 },
    delay: index * 80,
  });

  const color = suitColors[suit.toLowerCase()] || '#1C1C1E';
  const icon = suitIcons[suit.toLowerCase()] || suit;
  const iconSize = suitSizes[suit.toLowerCase()] || '4.5rem';

  return (
    <div className={`relative w-24 h-36 ${className}`} style={style}>
      <animated.div
        className="w-full h-full relative preserve-3d cursor-pointer shadow-soft hover:shadow-float active:scale-95 transition-all duration-300"
        style={{ transform, opacity }}
      >
        {/* Front Face */}
        <div
          className="absolute inset-0 w-full h-full rounded-xl backface-hidden flex items-center justify-center border border-titanium-200 overflow-hidden"
          style={{ transform: 'rotateY(0deg)', backgroundColor: color }}
        >
          {/* Large solid suit - centered with suit-specific sizing */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
            <span
              className="leading-none"
              style={{
                color: 'white',
                fontSize: iconSize,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {icon}
            </span>
          </div>

          {/* Single centered rank in white */}
          <span
            className="font-extrabold text-3xl tracking-tighter relative z-10 text-white"
            style={{ fontFamily: 'Outfit' }}
          >
            {rank}
          </span>
        </div>

        {/* Back Face */}
        <div
          className="absolute inset-0 w-full h-full bg-titanium-900 rounded-xl backface-hidden border-2 border-white/10 overflow-hidden shadow-inner"
          style={{ transform: 'rotateY(180deg)' }}
        >
            <div 
                className="w-full h-full opacity-20"
                style={{
                    backgroundImage: `linear-gradient(45deg, #fff 25%, transparent 25%), linear-gradient(-45deg, #fff 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #fff 75%), linear-gradient(-45deg, transparent 75%, #fff 75%)`,
                    backgroundSize: '16px 16px',
                    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px'
                }}
            />
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-12 h-20 border border-white/20 rounded-lg flex items-center justify-center">
                    <div className="w-8 h-14 border border-white/10 rounded-md bg-white/5" />
                </div>
            </div>
        </div>
      </animated.div>
    </div>
  );
};
