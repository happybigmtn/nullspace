import React, { type CSSProperties, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Skeleton base component for loading states
 *
 * Features:
 * - Pulse animation with shimmer highlight
 * - Respects prefers-reduced-motion
 * - Composable variants: rectangle, circle, text
 * - Configurable width, height, and border radius
 */

interface SkeletonProps {
  /** Width of the skeleton. Can be number (px) or string (e.g., '100%') */
  width?: number | string;
  /** Height of the skeleton. Can be number (px) or string */
  height?: number | string;
  /** Border radius. Can be number (px), string, or 'full' for circle */
  radius?: number | string;
  /** Additional className */
  className?: string;
  /** Inline styles */
  style?: CSSProperties;
  /** Whether to show shimmer animation. Default true */
  shimmer?: boolean;
}

/**
 * Base Skeleton component with shimmer animation
 */
export function Skeleton({
  width,
  height,
  radius,
  className = '',
  style,
  shimmer = true,
}: SkeletonProps) {
  const baseClasses = cn(
    'bg-titanium-200 dark:bg-titanium-700',
    shimmer && 'skeleton-shimmer',
    className
  );

  const computedStyle: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius:
      radius === 'full'
        ? '9999px'
        : typeof radius === 'number'
        ? `${radius}px`
        : radius,
    ...style,
  };

  return <div className={baseClasses} style={computedStyle} aria-hidden="true" />;
}

/**
 * Circle skeleton for avatars and icons
 */
interface SkeletonCircleProps {
  size?: number;
  className?: string;
  shimmer?: boolean;
}

export function SkeletonCircle({ size = 40, className = '', shimmer = true }: SkeletonCircleProps) {
  return (
    <Skeleton
      width={size}
      height={size}
      radius="full"
      className={className}
      shimmer={shimmer}
    />
  );
}

/**
 * Text line skeleton
 */
interface SkeletonTextProps {
  /** Width of the text line. Default '100%' */
  width?: number | string;
  /** Line height variant. Default 'body' */
  variant?: 'micro' | 'label' | 'body' | 'heading' | 'display';
  className?: string;
  shimmer?: boolean;
}

const TEXT_HEIGHTS: Record<string, number> = {
  micro: 10,
  label: 12,
  body: 14,
  heading: 20,
  display: 32,
};

export function SkeletonText({
  width = '100%',
  variant = 'body',
  className = '',
  shimmer = true,
}: SkeletonTextProps) {
  return (
    <Skeleton
      width={width}
      height={TEXT_HEIGHTS[variant]}
      radius={4}
      className={className}
      shimmer={shimmer}
    />
  );
}

/**
 * Paragraph skeleton with multiple lines
 */
interface SkeletonParagraphProps {
  /** Number of lines. Default 3 */
  lines?: number;
  /** Gap between lines in px. Default 8 */
  gap?: number;
  /** Whether last line should be shorter. Default true */
  shortLastLine?: boolean;
  className?: string;
  shimmer?: boolean;
}

export function SkeletonParagraph({
  lines = 3,
  gap = 8,
  shortLastLine = true,
  className = '',
  shimmer = true,
}: SkeletonParagraphProps) {
  return (
    <div className={cn('flex flex-col', className)} style={{ gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonText
          key={i}
          width={shortLastLine && i === lines - 1 ? '70%' : '100%'}
          shimmer={shimmer}
        />
      ))}
    </div>
  );
}

/**
 * Card skeleton with image and text
 */
interface SkeletonCardProps {
  /** Card width. Default 280 */
  width?: number | string;
  /** Image height. Default 160 */
  imageHeight?: number;
  /** Number of text lines. Default 2 */
  textLines?: number;
  className?: string;
  shimmer?: boolean;
}

export function SkeletonCard({
  width = 280,
  imageHeight = 160,
  textLines = 2,
  className = '',
  shimmer = true,
}: SkeletonCardProps) {
  return (
    <div
      className={cn('bg-white dark:bg-titanium-800 rounded-lg overflow-hidden', className)}
      style={{ width: typeof width === 'number' ? `${width}px` : width }}
    >
      <Skeleton width="100%" height={imageHeight} shimmer={shimmer} />
      <div className="p-4 space-y-3">
        <SkeletonText variant="heading" width="60%" shimmer={shimmer} />
        <SkeletonParagraph lines={textLines} shimmer={shimmer} />
      </div>
    </div>
  );
}

/**
 * Button skeleton
 */
interface SkeletonButtonProps {
  size?: 'sm' | 'md' | 'lg';
  width?: number | string;
  className?: string;
  shimmer?: boolean;
}

const BUTTON_SIZES = {
  sm: { height: 32, width: 80 },
  md: { height: 40, width: 100 },
  lg: { height: 48, width: 120 },
};

export function SkeletonButton({
  size = 'md',
  width,
  className = '',
  shimmer = true,
}: SkeletonButtonProps) {
  const sizeConfig = BUTTON_SIZES[size];
  return (
    <Skeleton
      width={width ?? sizeConfig.width}
      height={sizeConfig.height}
      radius={8}
      className={className}
      shimmer={shimmer}
    />
  );
}

/**
 * Avatar with text skeleton (common pattern)
 */
interface SkeletonAvatarWithTextProps {
  avatarSize?: number;
  textLines?: number;
  className?: string;
  shimmer?: boolean;
}

export function SkeletonAvatarWithText({
  avatarSize = 40,
  textLines = 2,
  className = '',
  shimmer = true,
}: SkeletonAvatarWithTextProps) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <SkeletonCircle size={avatarSize} shimmer={shimmer} />
      <div className="flex-1 space-y-2 pt-1">
        <SkeletonText width="40%" variant="label" shimmer={shimmer} />
        {textLines > 1 && <SkeletonText width="80%" shimmer={shimmer} />}
      </div>
    </div>
  );
}

/**
 * List item skeleton
 */
export function SkeletonListItem({ className = '', shimmer = true }) {
  return (
    <div className={cn('flex items-center gap-3 py-3', className)}>
      <SkeletonCircle size={36} shimmer={shimmer} />
      <div className="flex-1 space-y-2">
        <SkeletonText width="50%" variant="label" shimmer={shimmer} />
        <SkeletonText width="30%" variant="micro" shimmer={shimmer} />
      </div>
      <SkeletonText width={60} variant="body" shimmer={shimmer} />
    </div>
  );
}

/**
 * Wrapper component that shows skeleton while loading, then fades to content
 */
interface SkeletonWrapperProps {
  /** Whether content is loading */
  loading: boolean;
  /** Skeleton to show while loading */
  skeleton: ReactNode;
  /** Content to show when loaded */
  children: ReactNode;
  /** Fade transition duration in ms. Default 200 */
  fadeDuration?: number;
  className?: string;
}

export function SkeletonWrapper({
  loading,
  skeleton,
  children,
  fadeDuration = 200,
  className = '',
}: SkeletonWrapperProps) {
  return (
    <div className={cn('relative', className)}>
      {/* Skeleton */}
      <div
        className={cn(
          'transition-opacity',
          loading ? 'opacity-100' : 'opacity-0 pointer-events-none absolute inset-0'
        )}
        style={{ transitionDuration: `${fadeDuration}ms` }}
      >
        {skeleton}
      </div>
      {/* Content */}
      <div
        className={cn('transition-opacity', loading ? 'opacity-0' : 'opacity-100')}
        style={{ transitionDuration: `${fadeDuration}ms` }}
      >
        {children}
      </div>
    </div>
  );
}

export default Skeleton;
