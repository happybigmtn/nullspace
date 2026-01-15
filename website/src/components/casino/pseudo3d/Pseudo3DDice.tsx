import React, { useRef, useEffect, useMemo } from 'react';
import { useSpring, animated } from '@react-spring/web';
import { springConfig } from '../../../utils/motion';

interface Pseudo3DDiceProps {
  value: number;
  rolling?: boolean;
  rollRotation?: number; // Rotation from horizontal movement (degrees)
  flatOnSettle?: boolean;
  size?: number;
  className?: string;
  color?: string;
}

export const Pseudo3DDice: React.FC<Pseudo3DDiceProps> = ({
  value,
  rolling = false,
  rollRotation = 0,
  flatOnSettle = false,
  size = 64,
  className = '',
  color = 'white',
}) => {
  const prevRollingRef = useRef(false);
  const isMountedRef = useRef(false);
  const diceConfig = useMemo(() => springConfig('diceTumble'), []);
  const successConfig = useMemo(() => springConfig('success'), []);

  // Animation spring for rotation and scale during rolling
  const [{ rotation, scale, blur }, api] = useSpring(() => ({
    rotation: 0,
    scale: 1,
    blur: 0,
    config: diceConfig,
  }));

  // Dot visibility - reduced during roll, fully visible on settle
  // Changed from hiding completely (0) to showing faintly (0.3) for better visual feedback
  const { dotOpacity } = useSpring({
    dotOpacity: rolling ? 0.3 : 1,
    config: successConfig,
    delay: rolling ? 0 : 200,
  });

  useEffect(() => {
    const justStoppedRolling = !rolling && prevRollingRef.current;

    if (rolling) {
      // During rolling: spin based on horizontal movement
      api.start({
        rotation: rollRotation,
        scale: 1.05,
        blur: 2,
        immediate: true,
      });
    } else if (justStoppedRolling || !isMountedRef.current) {
      // Settling: snap to flat, show value
      const rotationTarget = flatOnSettle ? 0 : rollRotation;
      api.start({
        rotation: rotationTarget,
        scale: 1,
        blur: 0,
        config: diceConfig,
      });
    }

    prevRollingRef.current = rolling;
    isMountedRef.current = true;
  }, [rolling, rollRotation, flatOnSettle, api, diceConfig]);

  const faceStyle: React.CSSProperties = {
    width: size,
    height: size,
    backgroundColor: color === 'red' ? '#DC2626' : '#FAFAFA',
    border: `2px solid ${color === 'red' ? '#B91C1C' : '#D4D4D4'}`,
    borderRadius: size * 0.15,
    position: 'relative',
    boxShadow: rolling
      ? '0 4px 12px rgba(0,0,0,0.3)'
      : '0 2px 8px rgba(0,0,0,0.15), inset 0 0 10px rgba(0,0,0,0.05)',
  };

  const dotStyle: React.CSSProperties = {
    width: size * 0.18,
    height: size * 0.18,
    borderRadius: '50%',
    backgroundColor: color === 'red' ? 'white' : '#1a1a1a',
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)',
    position: 'absolute',
  };

  // Dot positions for each dice value (1-6)
  const dotPositions: Record<number, React.CSSProperties[]> = {
    1: [{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }],
    2: [
      { top: '25%', left: '25%', transform: 'translate(-50%, -50%)' },
      { top: '75%', left: '75%', transform: 'translate(-50%, -50%)' },
    ],
    3: [
      { top: '25%', left: '25%', transform: 'translate(-50%, -50%)' },
      { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
      { top: '75%', left: '75%', transform: 'translate(-50%, -50%)' },
    ],
    4: [
      { top: '25%', left: '25%', transform: 'translate(-50%, -50%)' },
      { top: '25%', left: '75%', transform: 'translate(-50%, -50%)' },
      { top: '75%', left: '25%', transform: 'translate(-50%, -50%)' },
      { top: '75%', left: '75%', transform: 'translate(-50%, -50%)' },
    ],
    5: [
      { top: '25%', left: '25%', transform: 'translate(-50%, -50%)' },
      { top: '25%', left: '75%', transform: 'translate(-50%, -50%)' },
      { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
      { top: '75%', left: '25%', transform: 'translate(-50%, -50%)' },
      { top: '75%', left: '75%', transform: 'translate(-50%, -50%)' },
    ],
    6: [
      { top: '25%', left: '25%', transform: 'translate(-50%, -50%)' },
      { top: '25%', left: '75%', transform: 'translate(-50%, -50%)' },
      { top: '50%', left: '25%', transform: 'translate(-50%, -50%)' },
      { top: '50%', left: '75%', transform: 'translate(-50%, -50%)' },
      { top: '75%', left: '25%', transform: 'translate(-50%, -50%)' },
      { top: '75%', left: '75%', transform: 'translate(-50%, -50%)' },
    ],
  };

  const clampedValue = Math.max(1, Math.min(6, value));

  return (
    <div
      className={`relative ${className}`}
      style={{ width: size, height: size * 1.1 }}
    >
      {/* Animated dice face */}
      <animated.div
        style={{
          ...faceStyle,
          transform: rotation.to(r => `rotate(${r % 360}deg)`),
          scale,
          filter: blur.to(b => `blur(${b}px)`),
        }}
      >
        {/* Dots - only show the final value */}
        <animated.div style={{ opacity: dotOpacity }}>
          {dotPositions[clampedValue]?.map((pos, i) => (
            <div key={i} style={{ ...dotStyle, ...pos }} />
          ))}
        </animated.div>

        {/* Rolling indicator - subtle motion effect during roll */}
        {rolling && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: size * 0.15,
              background: color === 'red'
                ? 'radial-gradient(circle, rgba(220,38,38,0.4) 0%, rgba(185,28,28,0.6) 100%)'
                : 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, rgba(229,229,229,0.5) 100%)',
            }}
          />
        )}
      </animated.div>

      {/* Shadow */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: '10%',
          width: '80%',
          height: size / 4,
          background: 'black',
          borderRadius: '50%',
          filter: 'blur(8px)',
          opacity: rolling ? 0.2 : 0.3,
          zIndex: -1,
        }}
      />
    </div>
  );
};
