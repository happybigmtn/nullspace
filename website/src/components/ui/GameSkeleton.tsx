import React from 'react';
import { Skeleton, SkeletonCircle, SkeletonText, SkeletonButton } from './Skeleton';
import { cn } from '../../lib/utils';

/**
 * Game-specific skeleton components matching casino game layouts
 */

/**
 * Game card skeleton for lobby grid
 */
interface GameCardSkeletonProps {
  className?: string;
}

export function GameCardSkeleton({ className = '' }: GameCardSkeletonProps) {
  return (
    <div
      className={cn(
        'bg-white dark:bg-titanium-800 rounded-xl overflow-hidden shadow-card',
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

/**
 * Lobby grid skeleton - multiple game cards
 */
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

/**
 * Playing card skeleton for card games
 */
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
          ? 'bg-titanium-800 dark:bg-titanium-900'
          : 'bg-white dark:bg-titanium-100',
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

/**
 * Blackjack table skeleton
 */
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

/**
 * Roulette table skeleton
 */
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

/**
 * Chip stack skeleton
 */
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

/**
 * Dice skeleton for craps/sic bo
 */
export function DiceSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={cn(
        'w-12 h-12 rounded-lg bg-titanium-200 dark:bg-titanium-700 skeleton-shimmer flex items-center justify-center',
        className
      )}
    >
      <div className="grid grid-cols-3 gap-1">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              [0, 2, 4, 6, 8].includes(i) ? 'bg-titanium-400' : 'bg-transparent'
            )}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Craps table skeleton
 */
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

/**
 * Balance display skeleton
 */
export function BalanceSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <SkeletonCircle size={24} />
      <Skeleton width={80} height={20} radius={4} />
    </div>
  );
}

/**
 * Transaction list item skeleton
 */
export function TransactionSkeleton({ className = '' }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 py-3 border-b border-titanium-100', className)}>
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

/**
 * Transaction list skeleton
 */
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

/**
 * Game control bar skeleton
 */
export function GameControlBarSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={cn(
        'fixed bottom-8 left-1/2 -translate-x-1/2 h-16 bg-titanium-100 dark:bg-titanium-800 rounded-full flex items-center justify-between px-4 min-w-[320px] shadow-card',
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
