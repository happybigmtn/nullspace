/**
 * Slingshot Fling Component (Mobile)
 *
 * Angry Birds / Golf Clash style interaction:
 * - Touch and drag backward on the dice
 * - Pull distance = power (further = stronger)
 * - Pull direction = throw direction (opposite)
 * - Visual trajectory arc preview
 * - Haptic feedback on release
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { animated, useSpring } from '@react-spring/web';

interface SlingshotProps {
  /** Whether the slingshot is active */
  active: boolean;
  /** Callback when flung */
  onFling: (power: number, direction: { x: number; z: number }) => void;
  /** Size of the interaction area */
  size?: number;
}

interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

// Max drag distance in pixels
const MAX_DRAG = 120;
// Minimum drag to register as throw
const MIN_DRAG = 20;

export const Slingshot: React.FC<SlingshotProps> = ({ active, onFling, size = 200 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });

  // Calculate pull vector (from current to start = opposite direction of throw)
  const pullX = drag.isDragging ? drag.startX - drag.currentX : 0;
  const pullY = drag.isDragging ? drag.startY - drag.currentY : 0;
  const pullDistance = Math.sqrt(pullX * pullX + pullY * pullY);
  const clampedDistance = Math.min(pullDistance, MAX_DRAG);
  const power = clampedDistance / MAX_DRAG;

  // Throw direction is opposite of pull (normalized)
  const throwDirX = pullDistance > 0 ? pullX / pullDistance : 0;
  const throwDirY = pullDistance > 0 ? pullY / pullDistance : 0;

  // Spring for the dice position when dragging
  const diceSpring = useSpring({
    x: drag.isDragging ? -pullX * 0.5 : 0, // Dice moves opposite to pull
    y: drag.isDragging ? -pullY * 0.5 : 0,
    scale: drag.isDragging ? 1.1 : 1,
    config: { tension: 300, friction: 20 },
  });

  // Spring for rubber band stretch effect
  const bandSpring = useSpring({
    opacity: drag.isDragging ? 0.8 : 0,
    config: { tension: 400, friction: 30 },
  });

  // Power indicator color
  const getPowerColor = (p: number) => {
    if (p < 0.3) return '#00ff41'; // Green
    if (p < 0.7) return '#ffdd00'; // Yellow
    return '#ff4444'; // Red
  };

  const handleStart = useCallback(
    (clientX: number, clientY: number) => {
      if (!active || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      setDrag({
        isDragging: true,
        startX: centerX,
        startY: centerY,
        currentX: clientX,
        currentY: clientY,
      });

      // Haptic feedback on start (if available)
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }
    },
    [active]
  );

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!drag.isDragging) return;

      setDrag((prev) => ({
        ...prev,
        currentX: clientX,
        currentY: clientY,
      }));
    },
    [drag.isDragging]
  );

  const handleEnd = useCallback(() => {
    if (!drag.isDragging) return;

    if (pullDistance >= MIN_DRAG) {
      // Haptic feedback on release
      if (navigator.vibrate) {
        navigator.vibrate([20, 30, 40]);
      }

      // Convert screen Y to world Z (up on screen = forward in 3D)
      onFling(power, { x: throwDirX, z: -throwDirY });
    }

    setDrag({
      isDragging: false,
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
    });
  }, [drag.isDragging, pullDistance, power, throwDirX, throwDirY, onFling]);

  // Touch event handlers
  const onTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleStart(touch.clientX, touch.clientY);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
  };

  const onTouchEnd = () => handleEnd();

  // Mouse event handlers (for testing on desktop)
  const onMouseDown = (e: React.MouseEvent) => {
    handleStart(e.clientX, e.clientY);
  };

  // Global mouse move/up handlers
  useEffect(() => {
    if (!drag.isDragging) return;

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const handleMouseUp = () => handleEnd();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [drag.isDragging, handleMove, handleEnd]);

  if (!active) return null;

  return (
    <div
      ref={containerRef}
      className="relative touch-none select-none"
      style={{ width: size, height: size }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
    >
      {/* Background target circle */}
      <div
        className="absolute inset-0 rounded-full border-2 border-dashed border-terminal-green/30
                   flex items-center justify-center"
      >
        <div className="w-1/2 h-1/2 rounded-full border border-terminal-green/20" />
      </div>

      {/* Rubber band lines */}
      {drag.isDragging && (
        <animated.svg
          className="absolute inset-0 pointer-events-none"
          style={{ opacity: bandSpring.opacity }}
          viewBox={`0 0 ${size} ${size}`}
        >
          {/* Left band */}
          <line
            x1={size / 2 - 30}
            y1={size / 2}
            x2={size / 2 - pullX * 0.5}
            y2={size / 2 - pullY * 0.5}
            stroke={getPowerColor(power)}
            strokeWidth={3}
            strokeLinecap="round"
          />
          {/* Right band */}
          <line
            x1={size / 2 + 30}
            y1={size / 2}
            x2={size / 2 - pullX * 0.5}
            y2={size / 2 - pullY * 0.5}
            stroke={getPowerColor(power)}
            strokeWidth={3}
            strokeLinecap="round"
          />
        </animated.svg>
      )}

      {/* Trajectory preview arc */}
      {drag.isDragging && pullDistance > MIN_DRAG && (
        <svg
          className="absolute inset-0 pointer-events-none overflow-visible"
          viewBox={`0 0 ${size} ${size}`}
        >
          {/* Dotted trajectory arc */}
          {[...Array(8)].map((_, i) => {
            const t = (i + 1) / 8;
            // Parabolic arc in throw direction
            const arcX = size / 2 + throwDirX * t * power * 80;
            const arcY = size / 2 + throwDirY * t * power * 80 - t * t * power * 40;
            const dotOpacity = 1 - t * 0.7;
            return (
              <circle
                key={i}
                cx={arcX}
                cy={arcY}
                r={3 - t * 2}
                fill={getPowerColor(power)}
                opacity={dotOpacity}
              />
            );
          })}
        </svg>
      )}

      {/* Dice representation (draggable) */}
      <animated.div
        className="absolute flex items-center justify-center cursor-grab active:cursor-grabbing"
        style={{
          left: size / 2 - 30,
          top: size / 2 - 30,
          width: 60,
          height: 60,
          transform: diceSpring.x.to(
            (x) =>
              `translate(${diceSpring.x.get()}px, ${diceSpring.y.get()}px) scale(${diceSpring.scale.get()})`
          ),
        }}
      >
        {/* Dice visual */}
        <div
          className="w-14 h-14 rounded-lg border-2 flex items-center justify-center
                     bg-terminal-black shadow-lg transition-colors"
          style={{
            borderColor: drag.isDragging ? getPowerColor(power) : '#00ff41',
            boxShadow: drag.isDragging
              ? `0 0 ${power * 20}px ${getPowerColor(power)}`
              : '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          <span className="text-2xl">🎲</span>
        </div>
      </animated.div>

      {/* Power indicator */}
      {drag.isDragging && (
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-center">
          <div className="text-xs font-mono tracking-wider" style={{ color: getPowerColor(power) }}>
            {Math.round(power * 100)}% POWER
          </div>
        </div>
      )}

      {/* Instructions */}
      {!drag.isDragging && (
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-center">
          <div className="text-xs text-gray-500 font-mono tracking-wider whitespace-nowrap">
            PULL BACK TO FLING
          </div>
        </div>
      )}
    </div>
  );
};

export default Slingshot;
