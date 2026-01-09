import React, { useEffect, useMemo } from 'react';
import { useSpring, animated } from '@react-spring/web';
import { springConfig } from '../../../utils/motion';

interface Pseudo3DChipProps {
  value: number;
  color?: string;
  count?: number;
  style?: React.CSSProperties;
  className?: string;
  onClick?: () => void;
}

const chipColors: Record<number, { main: string; border: string; accent: string }> = {
  1: { main: '#FFFFFF', border: '#E5E5E5', accent: '#007AFF' },
  5: { main: '#FF3B30', border: '#DC2626', accent: '#FFFFFF' },
  25: { main: '#34C759', border: '#248A3D', accent: '#FFFFFF' },
  100: { main: '#1C1C1E', border: '#000000', accent: '#FFFFFF' },
  500: { main: '#AF52DE', border: '#8941AD', accent: '#FFFFFF' },
  1000: { main: '#FFCC00', border: '#D9AD00', accent: '#1C1C1E' },
};

export const Pseudo3DChip: React.FC<Pseudo3DChipProps> = ({
  value,
  color,
  count = 1,
  style,
  className = '',
  onClick,
}) => {
  const config = chipColors[value] || chipColors[1];
  const size = 48;
  const chipScaleConfig = useMemo(() => springConfig('chipStack'), []);
  const [{ scale }, api] = useSpring(() => ({
    scale: 1,
    config: chipScaleConfig,
  }));

  useEffect(() => {
    api.start({
      from: { scale: 0.96 },
      to: { scale: 1 },
      reset: true,
    });
  }, [count, api]);

  const renderStack = () => {
    const chips = [];
    const maxVisible = Math.min(count, 5);

    for (let i = 0; i < maxVisible; i++) {
        const isTop = i === maxVisible - 1;
        chips.push(
            <div
                key={i}
                className="absolute rounded-full flex items-center justify-center border shadow-sm transition-all duration-200"
                style={{
                    width: size,
                    height: size,
                    backgroundColor: config.main,
                    borderColor: config.border,
                    bottom: i * 3,
                    zIndex: i,
                    boxShadow: isTop ? 'inset 0 2px 4px rgba(255,255,255,0.3), 0 4px 12px rgba(0,0,0,0.15)' : 'none'
                }}
            >
                <div 
                    className="absolute inset-0 rounded-full opacity-40" 
                    style={{
                        background: `repeating-conic-gradient(${config.accent} 0deg 15deg, transparent 15deg 30deg)`,
                        maskImage: 'radial-gradient(transparent 58%, black 59%, black 68%, transparent 69%)'
                    }}
                />
                
                {isTop && (
                    <div className="w-3/4 h-3/4 bg-white/95 rounded-full flex items-center justify-center border border-black/5 shadow-inner z-10">
                         <span className="text-[11px] font-black text-titanium-900 tabular-nums" style={{ fontFamily: 'Space Grotesk' }}>
                            {value >= 1000 ? `${value/1000}k` : value}
                         </span>
                    </div>
                )}
            </div>
        );
    }
    return chips;
  };

  return (
    <div 
        className={`relative cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mono-0 dark:focus-visible:ring-mono-1000 rounded-full transition-transform active:scale-90 hover:scale-110 ${className}`} 
        style={{ width: size, height: size + (Math.min(count, 5) * 3), ...style }}
        onClick={onClick}
        tabIndex={onClick ? 0 : -1}
        role={onClick ? "button" : undefined}
    >
        <animated.div style={{ transform: scale.to((s) => `scale(${s})`) }}>
            {renderStack()}
        </animated.div>
        
        {count > 1 && (
            <div className="absolute -top-3 -right-3 bg-titanium-900 text-white text-[9px] font-black px-2 py-0.5 rounded-full z-50 shadow-sm border border-white/20 tabular-nums">
                {count}
            </div>
        )}
    </div>
  );
};
