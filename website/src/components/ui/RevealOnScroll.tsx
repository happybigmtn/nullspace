import React, { useRef, useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import { useSpring, animated, type SpringConfig } from '@react-spring/web';
import { SPRING_LIQUID_CONFIGS, type SpringLiquidPreset } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

type RevealDirection = 'up' | 'down' | 'left' | 'right' | 'none';

interface RevealOnScrollProps {
  children: ReactNode;
  /** Direction content enters from. Default 'up' */
  direction?: RevealDirection;
  /** Spring preset for animation. Default 'liquidFloat' */
  spring?: SpringLiquidPreset;
  /** Custom spring config (overrides spring preset) */
  springConfig?: SpringConfig;
  /** Threshold for intersection (0-1). Default 0.1 */
  threshold?: number;
  /** Root margin for early/late triggering. Default '0px 0px -50px 0px' */
  rootMargin?: string;
  /** Stagger index for sequential reveals (0-based). Adds delay based on index */
  staggerIndex?: number;
  /** Stagger delay in ms between items. Default 50 */
  staggerDelay?: number;
  /** Additional className for the wrapper */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Disable animation entirely (useful for conditional reveals) */
  disabled?: boolean;
  /** Callback when reveal animation completes */
  onReveal?: () => void;
}

/**
 * Get the initial transform offset based on direction
 */
function getDirectionOffset(direction: RevealDirection) {
  switch (direction) {
    case 'up':
      return { x: 0, y: 30 };
    case 'down':
      return { x: 0, y: -30 };
    case 'left':
      return { x: 30, y: 0 };
    case 'right':
      return { x: -30, y: 0 };
    case 'none':
      return { x: 0, y: 0 };
  }
}

/**
 * RevealOnScroll - Wrapper component for scroll-triggered reveal animations
 *
 * Content fades in and translates from the specified direction using spring physics
 * when it enters the viewport. Once revealed, content stays visible.
 *
 * @example
 * // Basic usage
 * <RevealOnScroll>
 *   <Card>Content</Card>
 * </RevealOnScroll>
 *
 * @example
 * // With stagger for list items
 * {items.map((item, index) => (
 *   <RevealOnScroll key={item.id} staggerIndex={index} direction="up">
 *     <ListItem>{item.name}</ListItem>
 *   </RevealOnScroll>
 * ))}
 *
 * @example
 * // Coming from left with custom spring
 * <RevealOnScroll direction="left" spring="liquidMorph">
 *   <Sidebar />
 * </RevealOnScroll>
 */
export function RevealOnScroll({
  children,
  direction = 'up',
  spring = 'liquidFloat',
  springConfig: customSpringConfig,
  threshold = 0.1,
  rootMargin = '0px 0px -50px 0px',
  staggerIndex = 0,
  staggerDelay = 50,
  className = '',
  style,
  disabled = false,
  onReveal,
}: RevealOnScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const hasRevealedRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();

  // Calculate stagger delay
  const delay = staggerIndex * staggerDelay;

  // Get direction offsets
  const { x: initialX, y: initialY } = getDirectionOffset(direction);

  // Determine spring config
  const config = customSpringConfig ?? SPRING_LIQUID_CONFIGS[spring];

  // Spring animation
  const springStyles = useSpring({
    opacity: isRevealed || disabled ? 1 : 0,
    x: isRevealed || disabled ? 0 : initialX,
    y: isRevealed || disabled ? 0 : initialY,
    scale: isRevealed || disabled ? 1 : 0.95,
    config: prefersReducedMotion ? { duration: 0 } : config,
    delay: prefersReducedMotion ? 0 : delay,
    onRest: () => {
      if (isRevealed && onReveal) {
        onReveal();
      }
    },
  });

  // Intersection Observer setup
  useEffect(() => {
    if (disabled) return;

    const element = ref.current;
    if (!element) return;

    // Skip if already revealed
    if (hasRevealedRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasRevealedRef.current) {
          hasRevealedRef.current = true;
          setIsRevealed(true);
          observer.unobserve(element);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [threshold, rootMargin, disabled]);

  // For reduced motion, skip animation entirely and show content immediately
  if (prefersReducedMotion) {
    return (
      <div ref={ref} className={className} style={style}>
        {children}
      </div>
    );
  }

  return (
    <animated.div
      ref={ref}
      className={className}
      style={{
        ...style,
        opacity: springStyles.opacity,
        transform: springStyles.x.to(
          (x) =>
            `translate3d(${x}px, ${springStyles.y.get()}px, 0) scale(${springStyles.scale.get()})`
        ),
        willChange: isRevealed ? 'auto' : 'opacity, transform',
      }}
    >
      {children}
    </animated.div>
  );
}

/**
 * RevealGroup - Container for coordinated reveal animations
 *
 * Automatically assigns stagger indices to direct children wrapped in RevealOnScroll
 * Note: This is a convenience component - you can also manually set staggerIndex
 */
interface RevealGroupProps {
  children: ReactNode;
  /** Base stagger delay in ms. Default 50 */
  staggerDelay?: number;
  /** Direction for all children. Default 'up' */
  direction?: RevealDirection;
  /** Spring preset for all children. Default 'liquidFloat' */
  spring?: SpringLiquidPreset;
  /** Additional className */
  className?: string;
}

export function RevealGroup({
  children,
  staggerDelay = 50,
  direction = 'up',
  spring = 'liquidFloat',
  className = '',
}: RevealGroupProps) {
  const childArray = React.Children.toArray(children);

  return (
    <div className={className}>
      {childArray.map((child, index) => (
        <RevealOnScroll
          key={index}
          direction={direction}
          spring={spring}
          staggerIndex={index}
          staggerDelay={staggerDelay}
        >
          {child}
        </RevealOnScroll>
      ))}
    </div>
  );
}

export default RevealOnScroll;
