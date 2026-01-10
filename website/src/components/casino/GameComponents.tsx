
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Card } from '../../types';
import { Pseudo3DCard } from './pseudo3d/Pseudo3DCard';
import { Pseudo3DDice } from './pseudo3d/Pseudo3DDice';

export const CardRender: React.FC<{ card: Card; small?: boolean; forcedColor?: string; dealDelayMs?: number; index?: number }> = ({
  card,
  small,
  forcedColor,
  dealDelayMs,
  index = 0,
}) => {
  // Defensive check for missing card data
  if (!card) {
    return (
      <div
        className={`${
          small ? 'w-9 h-[3.25rem] sm:w-10 sm:h-14 md:w-11 md:h-[4rem]' : 'w-12 h-[4.5rem] sm:w-14 sm:h-20 md:w-16 md:h-24'
        } liquid-panel flex items-center justify-center`}
      >
        <span className="text-ns-muted opacity-60 text-xs">?</span>
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
            index={index}
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
    {title && <span className={`text-xs uppercase tracking-widest ${forcedColor ? forcedColor : 'text-ns-muted'}`}>{title}</span>}
    <div className="flex flex-wrap justify-center gap-2">
      {cards.map((c, i) => (
        <CardRender
          key={`${i}-${c?.value ?? 'x'}-${c?.isHidden ? 1 : 0}`}
          card={c}
          forcedColor={forcedColor}
          dealDelayMs={i * 100} // Increased delay for wave effect
          index={i}
        />
      ))}
      {cards.length === 0 && (
        <div
          className={`w-14 h-20 border border-dashed rounded-lg opacity-30 ${
            forcedColor ? `border-${forcedColor.replace('text-', '')}` : 'border-ns-border/60'
          }`}
        />
      )}
    </div>
  </div>
);

export const Chip: React.FC<{ value: number }> = ({ value }) => (
  <div className="w-6 h-6 rounded-full border border-mono-0 text-mono-0 dark:text-mono-1000 flex items-center justify-center text-[10px] font-bold">
    {value >= 1000 ? 'K' : value}
  </div>
);

export const DiceRender: React.FC<{
  value: number;
  delayMs?: number;
  className?: string;
  style?: React.CSSProperties;
  rolling?: boolean;
  rollRotation?: number; // Rotation based on horizontal movement
  flatOnSettle?: boolean;
}> = ({ value, delayMs, className, style, rolling, rollRotation, flatOnSettle }) => {
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
            rollRotation={rollRotation}
            flatOnSettle={flatOnSettle}
        />
    </div>
  );
};

type DicePose = { x: number; y: number; rot: number; rollRotation: number };
type DiceVelocity = { vx: number; vy: number; vr: number; settleTicks: number; cumulativeX: number };

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
  rightWallInset?: number;
  flatOnSettle?: boolean;
  onSettled?: () => void;
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
  rightWallInset = 0,
  flatOnSettle = false,
  onSettled,
}) => {
  const valuesKey = useMemo(() => values.join(','), [values]);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const settleTargetsRef = React.useRef<DicePose[]>([]);
  const [poses, setPoses] = useState<DicePose[]>([]);
  const posesRef = React.useRef<DicePose[]>([]);
  const velocitiesRef = React.useRef<DiceVelocity[]>([]);
  const frameRef = React.useRef<number | null>(null);
  const lastTimeRef = React.useRef<number | null>(null);
  const startTimeRef = React.useRef<number | null>(null);
  const lastPaintRef = React.useRef<number | null>(null);

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
    const clampedRightInset = Math.max(0, Math.min(rightWallInset, rect.width - diceSize));
    const boundsX = Math.max(0, rect.width - diceSize - clampedRightInset);
    const boundsY = Math.max(0, rect.height - diceSize);

    const clampPose = (pose: DicePose) => ({
      x: Math.max(0, Math.min(boundsX, pose.x)),
      y: Math.max(0, Math.min(boundsY, pose.y)),
      rot: pose.rot,
      rollRotation: pose.rollRotation,
    });

    // Calculate center targets for each die
    const gap = diceSize * 0.25;
    const totalWidth = values.length * diceSize + (values.length - 1) * gap;
    const centerX = rect.width / 2;
    const startTargetX = centerX - totalWidth / 2;
    const targetY = Math.max(0, Math.min(boundsY, (rect.height - diceSize) / 2));

    const targets = values.map((_, idx) => ({
      x: Math.max(0, Math.min(boundsX, startTargetX + idx * (diceSize + gap))),
      y: targetY,
    }));

    // Start position: left side for rightward throw
    const baseX = launchDirection === 'right'
      ? rect.width * 0.02
      : launchDirection === 'left'
        ? rect.width * 0.85
        : rect.width * 0.15;
    const baseY = targetY; // Start at target Y for horizontal throw
    const spread = Math.max(diceSize + 8, diceSize * 0.8);

    const initialPoses: DicePose[] = values.map((_, idx) => ({
      x: Math.min(boundsX, Math.max(0, baseX + idx * spread * 0.3)),
      y: Math.min(boundsY, Math.max(0, baseY)),
      rot: 0,
      rollRotation: 0,
    }));

    // Strong horizontal velocity to hit right wall
    const initialVelocities: DiceVelocity[] = values.map((_, idx) => {
      const directionSign = launchDirection === 'left' ? -1 : 1;
      const jitter = (idx - (values.length - 1) / 2) * 1.5;
      const verticalImpulse = verticalBoost * (Math.random() * 0.6 + 0.4);
      const verticalSign = Math.random() > 0.5 ? 1 : -1;
      return {
        vx: (horizontalBoost + 12 + Math.random() * 4 + jitter) * directionSign,
        vy: verticalBoost > 0 ? verticalImpulse * verticalSign : (Math.random() - 0.5) * 2,
        vr: (Math.random() * 10 + 5) * (idx % 2 === 0 ? 1 : -1),
        settleTicks: 0,
        cumulativeX: 0,
      };
    });

    if (settleToRow) {
      settleTargetsRef.current = targets.map(t => ({
        x: t.x,
        y: t.y,
        rot: 0,
        rollRotation: 0,
      }));
    } else {
      settleTargetsRef.current = [];
    }

    setPoses(initialPoses);
    posesRef.current = initialPoses;
    velocitiesRef.current = initialVelocities;
    lastTimeRef.current = null;
    startTimeRef.current = null;
    lastPaintRef.current = null;

    if (reducedMotion) {
      const finalPoses = settleToRow && settleTargetsRef.current.length > 0
        ? settleTargetsRef.current.map(clampPose)
        : initialPoses;
      posesRef.current = finalPoses;
      setPoses(finalPoses);
      setIsSettled(true);
      onSettled?.();
      return;
    }

    // Physics constants for realistic craps throw
    const restitution = 0.65; // Bounce off walls
    const wallKick = 0.55; // Extra kick when hitting the craps wall
    const floorRestitution = 0.45; // Softer bounce off felt
    const rollingFriction = 0.982; // Gradual slowdown on table
    const centerAttraction = 0.01; // Gentle pull toward center
    const settleThreshold = 0.28; // Velocity threshold to consider settled
    const gravity = 0.14; // Simulated downward force on the table
    const MAX_DURATION_MS = 3200; // Safety timeout

    const step = (time: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = time;
      }
      const elapsed = time - startTimeRef.current;

      const lastTime = lastTimeRef.current ?? time;
      const dt = Math.min(32, time - lastTime);
      const dtScale = dt / 16.67;
      lastTimeRef.current = time;

      // Check if all dice have settled
      let allSettled = true;
      const circumference = diceSize * Math.PI;

      const nextPoses = posesRef.current.map((pose, i) => {
        const vel = velocitiesRef.current[i];
        if (!vel) return pose;

        const target = settleToRow ? targets[i] : null;
        let x = pose.x;
        let y = pose.y;
        let rollRotation = pose.rollRotation;
        let rot = pose.rot;

        // Apply rolling friction
        vel.vx *= Math.pow(rollingFriction, dtScale);
        vel.vy *= Math.pow(rollingFriction, dtScale);
        vel.vr *= Math.pow(rollingFriction, dtScale);

        // Simulated gravity to give weight against the felt
        vel.vy += gravity * dtScale;

        // Center attraction (increases as velocity decreases)
        if (target && settleToRow) {
          const speed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
          const attractionStrength = centerAttraction * (1 + Math.max(0, 5 - speed) * 0.5);
          const dx = target.x - x;
          const dy = target.y - y;
          vel.vx += dx * attractionStrength * dtScale;
          vel.vy += dy * attractionStrength * dtScale;
        }

        // Update position
        const moveX = vel.vx * dtScale;
        x = pose.x + moveX;
        y = pose.y + vel.vy * dtScale;

        // Track cumulative horizontal movement for rotation
        vel.cumulativeX += moveX;
        rot += vel.vr * dtScale;
        rollRotation = rot + (vel.cumulativeX / circumference) * 360;

        // Wall bounces (craps wall on the right)
        if (x <= 0) {
          x = 0;
          vel.vx = Math.abs(vel.vx) * restitution;
        } else if (x >= boundsX) {
          x = boundsX;
          vel.vx = -Math.abs(vel.vx) * restitution;
          vel.vy += (Math.random() - 0.5) * 2.6 * wallKick;
          vel.vr += (Math.random() - 0.5) * 6 * wallKick;
        }

        // Vertical bounds (keep on table)
        if (y >= boundsY) {
          y = boundsY;
          vel.vy = -Math.abs(vel.vy) * floorRestitution;
          vel.vx *= 0.92;
          vel.vr *= 0.85;
        } else if (y <= 0) {
          y = 0;
          vel.vy = Math.abs(vel.vy) * floorRestitution;
        }

        // Check if this die has settled
        const speed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
        const distToTarget = target ? Math.sqrt((x - target.x) ** 2 + (y - target.y) ** 2) : 0;
        if (speed > settleThreshold || (target && distToTarget > 5)) {
          allSettled = false;
        }

        return { ...clampPose({ x, y, rot, rollRotation }), rollRotation };
      });

      if (preventOverlap && nextPoses.length > 1) {
        const minDist = diceSize * 0.85;
        for (let i = 0; i < nextPoses.length; i += 1) {
          for (let j = i + 1; j < nextPoses.length; j += 1) {
            const dx = nextPoses[i].x - nextPoses[j].x;
            const dy = nextPoses[i].y - nextPoses[j].y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0 && dist < minDist) {
              const push = (minDist - dist) / 2;
              const nx = dx / dist;
              const ny = dy / dist;
              nextPoses[i].x += nx * push;
              nextPoses[i].y += ny * push;
              nextPoses[j].x -= nx * push;
              nextPoses[j].y -= ny * push;
              velocitiesRef.current[i].vx += nx * 0.4;
              velocitiesRef.current[i].vy += ny * 0.4;
              velocitiesRef.current[j].vx -= nx * 0.4;
              velocitiesRef.current[j].vy -= ny * 0.4;
            }
          }
        }
      }

      const clampedPoses = nextPoses.map(clampPose);
      posesRef.current = clampedPoses;

      const shouldPaint = lastPaintRef.current === null || time - lastPaintRef.current >= 33;
      if (shouldPaint || allSettled || elapsed >= MAX_DURATION_MS) {
        setPoses(clampedPoses);
        lastPaintRef.current = time;
      }

      // End animation when all dice settled or timeout
      if (allSettled || elapsed >= MAX_DURATION_MS) {
        // Snap to final positions
        if (settleToRow && settleTargetsRef.current.length > 0) {
          const finalPoses = settleTargetsRef.current.map(clampPose);
          posesRef.current = finalPoses;
          setPoses(finalPoses);
        }
        setIsSettled(true);
        onSettled?.();
        return;
      }

      frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [rollKey, valuesKey, launchDirection, horizontalBoost, verticalBoost, preventOverlap, settleToRow, rightWallInset]);

  if (values.length === 0) return null;

  const maxWidthClass = maxWidthClassName ?? (values.length > 2 ? 'max-w-[420px]' : 'max-w-[360px]');
  const heightClass = heightClassName ?? 'h-[110px] sm:h-[120px]';

  // Don't render dice until poses are initialized (prevents flash at top-left)
  const posesReady = poses.length === values.length;

  return (
    <div className={`flex flex-col items-center ${className ?? ''}`}>
      {label && <span className="text-xs uppercase tracking-widest text-ns-muted mb-2">{label}</span>}
      <div
        ref={containerRef}
        className={`relative w-full ${maxWidthClass} ${heightClass} overflow-hidden`}
      >
        {posesReady && values.map((value, i) => {
          const pose = poses[i];
          return (
            <DiceRender
              key={`${rollKey ?? 'roll'}-${i}`}
              value={value}
              className="absolute left-0 top-0 will-change-transform"
              style={{ transform: `translate3d(${pose.x}px, ${pose.y}px, 0)` }}
              rolling={!isSettled}
              rollRotation={pose.rollRotation}
              flatOnSettle={flatOnSettle}
            />
          );
        })}
      </div>
    </div>
  );
};
