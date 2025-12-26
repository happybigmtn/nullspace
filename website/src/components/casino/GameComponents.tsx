
import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../../types';

export const CardRender: React.FC<{ card: Card; small?: boolean; forcedColor?: string; dealDelayMs?: number }> = ({
  card,
  small,
  forcedColor,
  dealDelayMs,
}) => {
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    setAnimKey((k) => k + 1);
  }, [card?.value, card?.isHidden]);

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

  const sizeClass = useMemo(
    () =>
      small
        ? 'w-9 h-[3.25rem] sm:w-10 sm:h-14 md:w-11 md:h-[4rem] text-sm md:text-base'
        : 'w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 text-base sm:text-lg md:text-xl',
    [small]
  );

  if (card.isHidden) {
    return (
      <div
        key={animKey}
        style={dealDelayMs !== undefined ? ({ animationDelay: `${dealDelayMs}ms` } as React.CSSProperties) : undefined}
        className={`${sizeClass} card-back border border-gray-700 rounded flex items-center justify-center relative overflow-hidden animate-card-deal`}
      >
        <div className="absolute inset-0 card-shimmer opacity-20" />
        <span className="relative text-gray-500/70 text-xs tracking-[0.35em]">///</span>
      </div>
    );
  }

  const isRed = card.suit === '♥' || card.suit === '♦';
  let colorClass = isRed ? 'text-terminal-accent' : 'text-terminal-green';
  if (forcedColor) colorClass = forcedColor;

  return (
    <div
      key={animKey}
      style={dealDelayMs !== undefined ? ({ animationDelay: `${dealDelayMs}ms` } as React.CSSProperties) : undefined}
      className={`${sizeClass} bg-terminal-black border border-current rounded flex flex-col items-center justify-between p-1 ${colorClass} shadow-[0_0_10px_rgba(0,0,0,0.5)] animate-card-deal ${
        card.isHeld ? 'ring-2 ring-[rgba(0,255,65,0.35)]' : ''
      }`}
    >
      <div className="self-start leading-none font-bold">{card.rank || '?'}</div>
      <div className={`${small ? 'text-lg' : 'text-xl sm:text-2xl'} leading-none`}>{card.suit || '?'}</div>
      <div className="self-end leading-none rotate-180 font-bold">{card.rank || '?'}</div>
    </div>
  );
};

export const Hand: React.FC<{ cards: Card[]; title?: string; forcedColor?: string }> = ({ cards, title, forcedColor }) => (
  <div className="flex flex-col gap-2 items-center">
    {title && <span className={`text-xs uppercase tracking-widest ${forcedColor ? forcedColor : 'text-gray-500'}`}>{title}</span>}
    <div className="flex flex-wrap justify-center gap-1 sm:gap-1.5 md:gap-2">
      {cards.map((c, i) => (
        <CardRender
          key={`${i}-${c?.value ?? 'x'}-${c?.isHidden ? 1 : 0}`}
          card={c}
          forcedColor={forcedColor}
          dealDelayMs={i * 45}
        />
      ))}
      {cards.length === 0 && (
        <div
          className={`w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24 border border-dashed rounded ${
            forcedColor ? `border-${forcedColor.replace('text-', '')}` : 'border-gray-800'
          }`}
        />
      )}
    </div>
  </div>
);

export const Chip: React.FC<{ value: number }> = ({ value }) => (
  <div className="w-6 h-6 rounded-full border border-terminal-gold text-terminal-gold flex items-center justify-center text-[10px] font-bold">
    {value >= 1000 ? 'K' : value}
  </div>
);

const DICE_PIP_POSITIONS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-0.2, 0.2], [0.2, -0.2]],
  3: [[-0.2, 0.2], [0, 0], [0.2, -0.2]],
  4: [[-0.2, 0.2], [0.2, 0.2], [-0.2, -0.2], [0.2, -0.2]],
  5: [[-0.2, 0.2], [0.2, 0.2], [0, 0], [-0.2, -0.2], [0.2, -0.2]],
  6: [[-0.2, 0.25], [0.2, 0.25], [-0.2, 0], [0.2, 0], [-0.2, -0.25], [0.2, -0.25]],
};

export const DiceRender: React.FC<{
  value: number;
  delayMs?: number;
  className?: string;
  style?: React.CSSProperties;
}> = ({ value, delayMs, className, style }) => {
  const [animKey, setAnimKey] = useState(0);
  const pips = DICE_PIP_POSITIONS[value] || [];

  useEffect(() => {
    setAnimKey((k) => k + 1);
  }, [value]);

  return (
    <div
      key={animKey}
      style={{
        animationDelay: delayMs !== undefined ? `${delayMs}ms` : undefined,
        ...style,
      }}
      className={`w-14 h-14 sm:w-16 sm:h-16 border border-terminal-green rounded-lg bg-terminal-black shadow-[0_0_10px_rgba(0,0,0,0.6)] flex items-center justify-center ${className ?? ''}`}
    >
      {pips.length > 0 ? (
        <div className="relative w-full h-full">
          {pips.map(([px, py], i) => (
            <span
              key={i}
              className="absolute w-2 h-2 rounded-full bg-terminal-green shadow-[0_0_6px_rgba(0,255,65,0.55)]"
              style={{
                left: `calc(50% + ${px * 100}%)`,
                top: `calc(50% - ${py * 100}%)`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          ))}
        </div>
      ) : (
        <span className="text-2xl sm:text-3xl font-black text-terminal-green tabular-nums">{value}</span>
      )}
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

  useEffect(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (!containerRef.current || values.length === 0) return;

    const reducedMotion = typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    const rect = containerRef.current.getBoundingClientRect();
    const diceSize = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches ? 64 : 56;
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

    if (reducedMotion) return;

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
          for (let i = 0; i < next.length; i += 1) {
            for (let j = i + 1; j < next.length; j += 1) {
              const a = next[i];
              const b = next[j];
              const ax = a.x + diceHalf;
              const ay = a.y + diceHalf;
              const bx = b.x + diceHalf;
              const by = b.y + diceHalf;
              const dx = bx - ax;
              const dy = by - ay;
              const dist = Math.hypot(dx, dy);
              if (dist > 0 && dist < minSeparation) {
                const overlap = (minSeparation - dist) / 2;
                const nx = dx / dist;
                const ny = dy / dist;
                a.x -= nx * overlap;
                a.y -= ny * overlap;
                b.x += nx * overlap;
                b.y += ny * overlap;

                const velA = velocitiesRef.current[i];
                const velB = velocitiesRef.current[j];
                if (velA && velB) {
                  const relVel = (velB.vx - velA.vx) * nx + (velB.vy - velA.vy) * ny;
                  if (relVel < 0) {
                    const impulse = -(1 + restitution) * relVel / 2;
                    velA.vx -= impulse * nx;
                    velA.vy -= impulse * ny;
                    velB.vx += impulse * nx;
                    velB.vy += impulse * ny;
                  }
                }
              }
            }
          }
        }

        return next.map(clampPose);
      });

      const allSettled = velocitiesRef.current.every((vel) => vel.settleTicks >= settleFrames);
      if (!allSettled) {
        frameRef.current = requestAnimationFrame(step);
      }
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [
    rollKey,
    valuesKey,
    launchDirection,
    horizontalBoost,
    verticalBoost,
    preventOverlap,
    settleToRow,
  ]);

  if (values.length === 0) {
    return null;
  }

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
              className="absolute left-0 top-0"
              style={{ transform: `translate3d(${pose.x}px, ${pose.y}px, 0) rotate(${pose.rot}deg)` }}
            />
          );
        })}
      </div>
    </div>
  );
};
