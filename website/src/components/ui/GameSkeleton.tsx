import React from 'react';
import { Skeleton, SkeletonCircle, SkeletonText, SkeletonButton } from './Skeleton';
import { cn } from '../../lib/utils';

interface GameCardSkeletonProps {
  className?: string;
}

export function GameCardSkeleton({ className = '' }: GameCardSkeletonProps) {
  return (
    <div
      className={cn(
        'liquid-card overflow-hidden',
        className
      )}
    >
      {/* Game preview area */}
      <Skeleton width="100%" height={140} />
      <div className="p-4 space-y-3">
        {/* Game title */}
        <SkeletonText variant="heading" width="70%" />
        {/* Stats row */}
        <div className="flex justify-between items-center">
          <SkeletonText variant="label" width={60} />
          <SkeletonText variant="label" width={40} />
        </div>
      </div>
    </div>
  );
}

interface LobbySkeletonProps {
  cardCount?: number;
  className?: string;
}

export function LobbySkeleton({ cardCount = 6, className = '' }: LobbySkeletonProps) {
  return (
    <div className={cn('grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4', className)}>
      {Array.from({ length: cardCount }).map((_, i) => (
        <GameCardSkeleton key={i} />
      ))}
    </div>
  );
}

interface CardSkeletonProps {
  faceDown?: boolean;
  className?: string;
}

export function CardSkeleton({ faceDown = false, className = '' }: CardSkeletonProps) {
  return (
    <div
      className={cn(
        'w-16 h-24 rounded-lg shadow-md flex items-center justify-center',
        faceDown
          ? 'bg-black/30 dark:bg-white/10'
          : 'bg-white/70 dark:bg-white/5',
        className
      )}
    >
      {!faceDown && (
        <div className="space-y-2 p-2">
          <Skeleton width={20} height={16} radius={2} />
          <Skeleton width={28} height={28} radius={2} />
        </div>
      )}
    </div>
  );
}

export function BlackjackSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={cn('space-y-8 p-6', className)}>
      {/* Dealer area */}
      <div className="flex flex-col items-center space-y-4">
        <SkeletonText variant="label" width={80} />
        <div className="flex gap-2">
          <CardSkeleton faceDown />
          <CardSkeleton />
        </div>
      </div>

      {/* Player area */}
      <div className="flex flex-col items-center space-y-4">
        <div className="flex gap-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <SkeletonText variant="label" width={80} />
      </div>

      {/* Controls */}
      <div className="flex justify-center gap-3">
        <SkeletonButton size="lg" width={100} />
        <SkeletonButton size="lg" width={100} />
      </div>
    </div>
  );
}

export function RouletteSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={cn('space-y-6 p-6', className)}>
      {/* Wheel area */}
      <div className="flex justify-center">
        <SkeletonCircle size={200} />
      </div>

      {/* Betting grid */}
      <div className="grid grid-cols-12 gap-1">
        {Array.from({ length: 36 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={32} radius={4} />
        ))}
      </div>

      {/* Chip tray */}
      <div className="flex justify-center gap-2">
        {[1, 5, 10, 25, 100].map((val) => (
          <SkeletonCircle key={val} size={48} />
        ))}
      </div>
    </div>
  );
}

interface ChipStackSkeletonProps {
  count?: number;
  className?: string;
}

export function ChipStackSkeleton({ count = 5, className = '' }: ChipStackSkeletonProps) {
  return (
    <div className={cn('flex gap-2', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCircle key={i} size={40} />
      ))}
    </div>
  );
}

export function DiceSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={cn(
        'w-12 h-12 rounded-lg bg-black/10 dark:bg-white/10 skeleton-shimmer flex items-center justify-center',
        className
      )}
    >
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              [0, 2, 4, 6, 8].includes(i) ? 'bg-black/30 dark:bg-white/40' : 'bg-transparent'
            )}
          />
        ))}
      </div>
    </div>
  );
}

export function CrapsSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={cn('space-y-6 p-6', className)}>
      {/* Dice area */}
      <div className="flex justify-center gap-4">
        <DiceSkeleton />
        <DiceSkeleton />
      </div>

      {/* Betting areas */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <Skeleton width="100%" height={48} radius={8} />
          <Skeleton width="100%" height={48} radius={8} />
        </div>
        <Skeleton width="100%" height={64} radius={8} />
      </div>

      {/* Chip tray */}
      <ChipStackSkeleton />
    </div>
  );
}

export function BalanceSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <SkeletonCircle size={24} />
      <Skeleton width={80} height={20} radius={4} />
    </div>
  );
}

export function TransactionSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 py-3 border-b border-black/5 dark:border-white/10', className)}>
      <SkeletonCircle size={36} />
      <div className="flex-1 space-y-1">
        <SkeletonText width="40%" variant="label" />
        <SkeletonText width="25%" variant="micro" />
      </div>
      <div className="text-right space-y-1">
        <SkeletonText width={60} variant="body" />
        <SkeletonText width={40} variant="micro" />
      </div>
    </div>
  );
}

interface TransactionListSkeletonProps {
  count?: number;
  className?: string;
}

export function TransactionListSkeleton({
  count = 5,
  className = '',
}: TransactionListSkeletonProps) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <TransactionSkeleton key={i} />
      ))}
    </div>
  );
}

export function GameControlBarSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={cn(
        'fixed bottom-8 left-1/2 -translate-x-1/2 h-16 liquid-card flex items-center justify-between px-4 min-w-[320px] shadow-card',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton width={60} height={12} radius={4} />
        <Skeleton width={80} height={16} radius={4} />
      </div>
      <SkeletonCircle size={64} />
      <SkeletonCircle size={40} />
    </div>
  );
}

export default GameCardSkeleton;
