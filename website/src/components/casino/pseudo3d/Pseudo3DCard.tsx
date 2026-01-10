import React, { useEffect, useState, useMemo } from 'react';
import { useSpring, animated } from '@react-spring/web';
import { springConfig } from '../../../utils/motion';

interface Pseudo3DCardProps {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades' | string;
  rank: string;
  faceUp?: boolean;
  index?: number;
  style?: React.CSSProperties;
  className?: string;
}

const suitColors: Record<string, string> = {
  hearts: '#D92D20',
  diamonds: '#D92D20',
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
  hearts: '4.6rem',
  diamonds: '4.6rem',
  clubs: '4rem',
  spades: '4.2rem',
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

  const cardFlipConfig = useMemo(() => springConfig('cardFlip'), []);

  const { transform, opacity } = useSpring({
    opacity: 1,
    transform: `perspective(1200px) rotateY(${isFlipped ? 180 : 0}deg) translateY(0px)`,
    from: { opacity: 0, transform: `perspective(1200px) rotateY(180deg) translateY(-40px)` },
    config: cardFlipConfig,
    delay: index * 80,
  });

  const color = suitColors[suit.toLowerCase()] || '#1C1C1E';
  const icon = suitIcons[suit.toLowerCase()] || suit;
  const iconSize = suitSizes[suit.toLowerCase()] || '4.4rem';
  const isRed = suit.toLowerCase() === 'hearts' || suit.toLowerCase() === 'diamonds';

  return (
    <div className={`relative w-24 h-36 ${className}`} style={style}>
      <animated.div
        className="w-full h-full relative preserve-3d cursor-pointer shadow-soft hover:shadow-float active:scale-95 transition-all duration-300"
        style={{ transform, opacity }}
      >
        {/* Front Face */}
        <div
          className="absolute inset-0 w-full h-full rounded-xl backface-hidden overflow-hidden border border-ns"
          style={{
            transform: 'rotateY(0deg)',
            background: 'linear-gradient(145deg, #ffffff 0%, #f6f6f8 60%, #ededf0 100%)',
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#ffffff_0%,#f1f1f4_45%,#e6e6ea_100%)] opacity-80" />

          {/* Corner rank + suit */}
          <div
            className="absolute left-2 top-2 flex flex-col items-center text-xs font-semibold"
            style={{ color }}
          >
            <span className="text-sm font-bold leading-none">{rank}</span>
            <span className="text-sm leading-none">{icon}</span>
          </div>
          <div
            className="absolute right-2 bottom-2 flex flex-col items-center text-xs font-semibold rotate-180"
            style={{ color }}
          >
            <span className="text-sm font-bold leading-none">{rank}</span>
            <span className="text-sm leading-none">{icon}</span>
          </div>

          {/* Center pip watermark */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span
              className="leading-none"
              style={{
                color: isRed ? 'rgba(217,45,32,0.18)' : 'rgba(28,28,30,0.16)',
                fontSize: iconSize,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {icon}
            </span>
          </div>
        </div>

        {/* Back Face */}
        <div
          className="absolute inset-0 w-full h-full rounded-xl backface-hidden overflow-hidden border border-ns shadow-inner"
          style={{
            transform: 'rotateY(180deg)',
            background: 'linear-gradient(145deg, #1c1c1e 0%, #0f0f12 100%)',
          }}
        >
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.12) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.1) 0%, transparent 45%)',
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-20 rounded-lg border border-white/15 bg-white/5" />
          </div>
        </div>
      </animated.div>
    </div>
  );
};
