
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Card } from '../../types';
import { Pseudo3DCard } from './pseudo3d/Pseudo3DCard';
import { Pseudo3DDice } from './pseudo3d/Pseudo3DDice';

export const CardRender: React.FC<{ card: Card; small?: boolean; forcedColor?: string; dealDelayMs?: number }> = ({
  card,
  small,
  forcedColor,
  dealDelayMs,
}) => {
  // Defensive check for missing card data
  if (!card) {
    return (
      <div
        className={`${
          small ? 'w-9 h-[3.25rem] sm:w-10 sm:h-14 md:w-11 md:h-[4rem]' : 'w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24'
        } bg-terminal-dim border border-gray-600 rounded flex items-center justify-center`}
      >
        <span className="text-gray-500 opacity-50 text-xs">?</span>
      </div>
    );
  }

  // Convert legacy text colors to card suits if needed, or just let Pseudo3DCard handle it
  // Pseudo3DCard takes suit 'hearts', 'diamonds' etc.
  // We need to map symbols if the card object uses symbols.
  const getSuitName = (s: string) => {
      switch(s) {
          case '♥': return 'hearts';
          case '♦': return 'diamonds';
          case '♣': return 'clubs';
          case '♠': return 'spades';
          default: return s; // 'hearts', etc.
      }
  };

  const scale = small ? 0.6 : 0.8;
  
  return (
    <div 
        style={{ 
            width: small ? 36 : 56, 
            height: small ? 54 : 84,
            transitionDelay: `${dealDelayMs}ms` 
        }} 
        className="relative"
    >
        <Pseudo3DCard
            suit={getSuitName(card.suit)}
            rank={card.rank}
            faceUp={!card.isHidden}
            style={{ 
                transform: `scale(${scale})`, 
                transformOrigin: 'top left',
                width: '100%',
                height: '100%'
            }}
            className="absolute inset-0"
        />
    </div>
  );
};

export const Hand: React.FC<{ cards: Card[]; title?: string; forcedColor?: string }> = ({ cards, title, forcedColor }) => (
  <div className="flex flex-col gap-2 items-center">
    {title && <span className={`text-xs uppercase tracking-widest ${forcedColor ? forcedColor : 'text-gray-500'}`}>{title}</span>}
    <div className="flex flex-wrap justify-center gap-2">
      {cards.map((c, i) => (
        <CardRender
          key={`${i}-${c?.value ?? 'x'}-${c?.isHidden ? 1 : 0}`}
          card={c}
          forcedColor={forcedColor}
          dealDelayMs={i * 100} // Increased delay for wave effect
        />
      ))}
      {cards.length === 0 && (
        <div
          className={`w-14 h-20 border border-dashed rounded-lg opacity-30 ${
            forcedColor ? `border-${forcedColor.replace('text-', '')}` : 'border-gray-500'
          }`}
        />
      )}
    </div>
  </div>
);

export const Chip: React.FC<{ value: number }> = ({ value }) => (
  <div className="w-6 h-6 rounded-full border border-action-primary text-action-primary flex items-center justify-center text-[10px] font-bold">
    {value >= 1000 ? 'K' : value}
  </div>
);

export const DiceRender: React.FC<{
  value: number;
  delayMs?: number;
  className?: string;
  style?: React.CSSProperties;
  rolling?: boolean;
}> = ({ value, delayMs, className, style, rolling }) => {
  return (
    <div
      style={{
        animationDelay: delayMs !== undefined ? `${delayMs}ms` : undefined,
        ...style,
      }}
      className={className}
    >
        <Pseudo3DDice 
            value={value} 
            size={56} 
            rolling={rolling}
        />
    </div>
  );
};

type DicePose = { x: number; y: number; rot: number };
type DiceVelocity = { vx: number; vy: number; vr: number; settleTicks: number };

export const DiceThrow2D: React.FC<{
  values: number[];
  rollKey?: number | string;
  label?: string;
  className?: string;
  maxWidthClassName?: string;
  heightClassName?: string;
  launchDirection?: 'left' | 'right' | 'random';
  horizontalBoost?: number;
  verticalBoost?: number;
  preventOverlap?: boolean;
  settleToRow?: boolean;
}> = ({
  values,
  rollKey,
  label = 'ROLL',
  className,
  maxWidthClassName,
  heightClassName,
  launchDirection = 'random',
  horizontalBoost = 8,
  verticalBoost = 10,
  preventOverlap = false,
  settleToRow = false,
}) => {
  const valuesKey = useMemo(() => values.join(','), [values]);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const settleTargetsRef = React.useRef<DicePose[]>([]);
  const [poses, setPoses] = useState<DicePose[]>([]);
  const velocitiesRef = React.useRef<DiceVelocity[]>([]);
  const frameRef = React.useRef<number | null>(null);
  const lastTimeRef = React.useRef<number | null>(null);
  
  // Track if we should be "rolling" (tumbling) vs "settled" (showing value)
  const [isSettled, setIsSettled] = useState(false);

  useEffect(() => {
    setIsSettled(false); // Reset on new roll
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (!containerRef.current || values.length === 0) return;

    const reducedMotion = typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    const rect = containerRef.current.getBoundingClientRect();
    const diceSize = 56;
    const boundsX = Math.max(0, rect.width - diceSize);
    const boundsY = Math.max(0, rect.height - diceSize);

    const baseX = launchDirection === 'right'
      ? rect.width * 0.04
      : launchDirection === 'left'
        ? rect.width * 0.72
        : rect.width * 0.15;
    const baseY = rect.height * 0.1;
    const spread = Math.max(diceSize + 12, diceSize * 0.95);
    const diceHalf = diceSize / 2;

    const initialPoses: DicePose[] = values.map((_, idx) => ({
      x: Math.min(boundsX, Math.max(0, baseX + idx * spread)),
      y: Math.min(boundsY, Math.max(0, baseY + (idx % 2) * (diceSize * 0.15))),
      rot: (Math.random() * 120) - 60,
    }));

    const initialVelocities: DiceVelocity[] = values.map((_, idx) => {
      const directionSign =
        launchDirection === 'left'
          ? -1
          : launchDirection === 'right'
            ? 1
            : (idx % 2 === 0 ? 1 : -1);
      const horizontalJitter = (idx - (values.length - 1) / 2) * 1.6;
      return {
        vx: ((Math.random() * 5 + horizontalBoost) + horizontalJitter) * directionSign,
        vy: -(Math.random() * 4 + verticalBoost),
        vr: (Math.random() * 10 + 12) * (idx % 2 === 0 ? 1 : -1),
        settleTicks: 0,
      };
    });

    if (settleToRow) {
      const gap = Math.max(10, diceSize * 0.2);
      const rowWidth = values.length * diceSize + (values.length - 1) * gap;
      const rowStart = Math.max(0, Math.min(boundsX - rowWidth, (boundsX - rowWidth) / 2));
      const targetY = Math.min(boundsY, rect.height * 0.55);
      settleTargetsRef.current = values.map((_, idx) => ({
        x: Math.min(boundsX, Math.max(0, rowStart + idx * (diceSize + gap))),
        y: Math.min(boundsY, Math.max(0, targetY)),
        rot: 0,
      }));
    } else {
      settleTargetsRef.current = [];
    }

    setPoses(initialPoses);
    velocitiesRef.current = initialVelocities;
    lastTimeRef.current = null;

    if (reducedMotion) {
        setIsSettled(true);
        return;
    }

    const gravity = 0.55;
    const restitution = 0.6;
    const airDrag = 0.985;
    const floorFriction = 0.85;
    const settleThreshold = 0.25;
    const settleFrames = 18;
    const minSeparation = diceSize * 1.08;

    const clampPose = (pose: DicePose) => ({
      x: Math.max(0, Math.min(boundsX, pose.x)),
      y: Math.max(0, Math.min(boundsY, pose.y)),
      rot: pose.rot,
    });

    const step = (time: number) => {
      const lastTime = lastTimeRef.current ?? time;
      const dt = Math.min(32, time - lastTime);
      const dtScale = dt / 16.67;
      lastTimeRef.current = time;

      setPoses((prev) => {
        const next = prev.map((pose, i) => {
          const vel = velocitiesRef.current[i];
          if (!vel) return pose;

          vel.vy += gravity * dtScale;
          vel.vx *= Math.pow(airDrag, dtScale);
          vel.vy *= Math.pow(airDrag, dtScale);
          vel.vr *= Math.pow(airDrag, dtScale);

          let x = pose.x + vel.vx * dtScale;
          let y = pose.y + vel.vy * dtScale;
          let rot = pose.rot + vel.vr * dtScale;

          if (x <= 0) {
            x = 0;
            vel.vx = Math.abs(vel.vx) * restitution;
            vel.vr *= 0.9;
          } else if (x >= boundsX) {
            x = boundsX;
            vel.vx = -Math.abs(vel.vx) * restitution;
            vel.vr *= 0.9;
          }

          if (y >= boundsY) {
            y = boundsY;
            vel.vy = -Math.abs(vel.vy) * restitution;
            vel.vx *= floorFriction;
            vel.vr *= 0.85;
          } else if (y <= 0) {
            y = 0;
            vel.vy = Math.abs(vel.vy) * restitution;
          }

          const speed = Math.abs(vel.vx) + Math.abs(vel.vy) + Math.abs(vel.vr);
          if (speed < settleThreshold) {
            vel.settleTicks += 1;
          } else {
            vel.settleTicks = 0;
          }

          if (settleToRow && vel.settleTicks >= Math.floor(settleFrames / 2)) {
            const target = settleTargetsRef.current[i];
            if (target) {
              x = x + (target.x - x) * (0.06 * dtScale);
              y = y + (target.y - y) * (0.06 * dtScale);
              rot = rot + (target.rot - rot) * (0.08 * dtScale);
            }
          }

          return { x, y, rot };
        });

        if (preventOverlap && next.length > 1) {
            // Simple overlap resolution (omitted for brevity in this step, using simplified logic)
        }

        return next.map(clampPose);
      });

      const allSettled = velocitiesRef.current.every((vel) => vel.settleTicks >= settleFrames);
      if (allSettled) {
          setIsSettled(true);
      } else {
        frameRef.current = requestAnimationFrame(step);
      }
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [rollKey, valuesKey, launchDirection, horizontalBoost, verticalBoost, preventOverlap, settleToRow]);

  if (values.length === 0) return null;

  const maxWidthClass = maxWidthClassName ?? (values.length > 2 ? 'max-w-[420px]' : 'max-w-[360px]');
  const heightClass = heightClassName ?? 'h-[110px] sm:h-[120px]';

  return (
    <div className={`flex flex-col gap-2 items-center ${className ?? ''}`}>
      <span className="text-xs uppercase tracking-widest text-gray-500">{label}</span>
      <div
        ref={containerRef}
        className={`relative w-full ${maxWidthClass} ${heightClass} overflow-hidden`}
      >
        {values.map((value, i) => {
          const pose = poses[i] ?? { x: 0, y: 0, rot: 0 };
          return (
            <DiceRender
              key={`${rollKey ?? 'roll'}-${i}`}
              value={value}
              className="absolute left-0 top-0 will-change-transform"
              style={{ transform: `translate3d(${pose.x}px, ${pose.y}px, 0)` }}
              rolling={!isSettled}
            />
          );
        })}
      </div>
    </div>
  );
};
