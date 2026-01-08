/**
 * useLayoutAnimation - FLIP-based layout animation hook
 *
 * DS-054: Layout animation system for list reordering and content changes
 *
 * FLIP = First, Last, Invert, Play
 * 1. First - Record element positions before change
 * 2. Last - Let DOM update, record new positions
 * 3. Invert - Apply transforms to put elements back at old positions
 * 4. Play - Animate transforms back to zero (with spring physics)
 *
 * Features:
 * - Elements animate position when layout changes
 * - Works with add/remove list items
 * - Stagger delays for multiple moving elements
 * - Spring physics for natural settling
 * - No layout thrashing (uses transforms, not position)
 * - Respects prefers-reduced-motion
 */
import {
  useRef,
  useLayoutEffect,
  useCallback,
  type RefObject,
  type MutableRefObject,
} from 'react';
import { useSpring, useSprings, config, to } from '@react-spring/web';
import { useReducedMotion } from './useReducedMotion';
import { SPRING_LIQUID_CONFIGS } from '../utils/motion';

// Instant config for reduced motion
const INSTANT_CONFIG = { duration: 0 };

// Default stagger delay between elements (ms)
const DEFAULT_STAGGER = 30;

interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutState {
  rect: ElementRect;
  key: string;
}

/**
 * Single element layout animation hook
 *
 * Use when you have a single element that may move position.
 *
 * @example
 * ```tsx
 * function MovingCard({ position }) {
 *   const { ref, style } = useLayoutAnimation(position);
 *
 *   return (
 *     <animated.div ref={ref} style={style} className="card">
 *       Card content
 *     </animated.div>
 *   );
 * }
 * ```
 */
export function useLayoutAnimation<T = unknown>(
  /** Dependency that triggers layout change (e.g., position, index) */
  dependency: T
) {
  const prefersReducedMotion = useReducedMotion();
  const elementRef = useRef<HTMLElement>(null);
  const previousRect = useRef<ElementRect | null>(null);
  const isFirstRender = useRef(true);

  const springConfig = prefersReducedMotion
    ? INSTANT_CONFIG
    : SPRING_LIQUID_CONFIGS?.liquidSettle ?? config.gentle;

  const [spring, api] = useSpring(() => ({
    x: 0,
    y: 0,
    config: springConfig,
  }));

  // Capture position before DOM update
  useLayoutEffect(() => {
    if (elementRef.current) {
      previousRect.current = getRect(elementRef.current);
    }
  });

  // Calculate delta and animate after DOM update
  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (!elementRef.current || !previousRect.current) return;

    const currentRect = getRect(elementRef.current);
    const deltaX = previousRect.current.x - currentRect.x;
    const deltaY = previousRect.current.y - currentRect.y;

    // Skip if no movement
    if (deltaX === 0 && deltaY === 0) return;

    // Skip animation for reduced motion
    if (prefersReducedMotion) return;

    // FLIP: Start at old position, animate to new
    api.start({
      from: { x: deltaX, y: deltaY },
      to: { x: 0, y: 0 },
    });
  }, [dependency, api, prefersReducedMotion]);

  return {
    ref: elementRef as RefObject<HTMLElement>,
    style: prefersReducedMotion
      ? {}
      : {
          transform: to(
            [spring.x, spring.y],
            (x, y) => `translate3d(${x}px, ${y}px, 0)`
          ),
        },
  };
}

/**
 * List layout animation hook
 *
 * Use when you have multiple elements that may reorder.
 * Each item needs a unique key for tracking.
 *
 * @example
 * ```tsx
 * function SortableList({ items }) {
 *   const { getProps } = useListLayoutAnimation(items.map(i => i.id));
 *
 *   return (
 *     <div>
 *       {items.map((item, index) => {
 *         const { ref, style } = getProps(item.id, index);
 *         return (
 *           <animated.div key={item.id} ref={ref} style={style}>
 *             {item.content}
 *           </animated.div>
 *         );
 *       })}
 *     </div>
 *   );
 * }
 * ```
 */
export function useListLayoutAnimation(
  /** Array of unique keys for each list item */
  keys: string[],
  /** Stagger delay between element animations (ms) */
  stagger = DEFAULT_STAGGER
) {
  const prefersReducedMotion = useReducedMotion();
  const elementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const previousRects = useRef<Map<string, ElementRect>>(new Map());
  const isFirstRender = useRef(true);

  const springConfig = prefersReducedMotion
    ? INSTANT_CONFIG
    : SPRING_LIQUID_CONFIGS?.liquidSettle ?? config.gentle;

  // Springs for each element
  const [springs, api] = useSprings(keys.length, () => ({
    x: 0,
    y: 0,
    opacity: 1,
    config: springConfig,
  }));

  // Capture all positions before DOM update
  useLayoutEffect(() => {
    elementsRef.current.forEach((element, key) => {
      previousRects.current.set(key, getRect(element));
    });
  });

  // Calculate deltas and animate after DOM update
  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (prefersReducedMotion) return;

    // Batch all spring updates
    const updates: Array<{
      index: number;
      from: { x: number; y: number };
      delay: number;
    }> = [];

    keys.forEach((key, index) => {
      const element = elementsRef.current.get(key);
      const previousRect = previousRects.current.get(key);

      if (!element || !previousRect) return;

      const currentRect = getRect(element);
      const deltaX = previousRect.x - currentRect.x;
      const deltaY = previousRect.y - currentRect.y;

      // Skip if no movement
      if (deltaX === 0 && deltaY === 0) return;

      updates.push({
        index,
        from: { x: deltaX, y: deltaY },
        delay: index * stagger,
      });
    });

    // Apply all updates
    if (updates.length > 0) {
      api.start((springIndex) => {
        const update = updates.find((u) => u.index === springIndex);
        if (!update) return {};

        return {
          from: { x: update.from.x, y: update.from.y },
          to: { x: 0, y: 0 },
          delay: update.delay,
        };
      });
    }
  }, [keys, api, prefersReducedMotion, stagger]);

  // Get props for a specific item
  const getProps = useCallback(
    (key: string, index: number) => {
      const spring = springs[index];

      return {
        ref: (el: HTMLElement | null) => {
          if (el) {
            elementsRef.current.set(key, el);
          } else {
            elementsRef.current.delete(key);
          }
        },
        style: prefersReducedMotion || !spring
          ? {}
          : {
              transform: to(
                [spring.x, spring.y],
                (x, y) => `translate3d(${x}px, ${y}px, 0)`
              ),
            },
      };
    },
    [springs, prefersReducedMotion]
  );

  return { getProps };
}

/**
 * Enter/exit layout animation hook
 *
 * Animates elements as they're added or removed from a list.
 *
 * @example
 * ```tsx
 * function AnimatedList({ items }) {
 *   const transitions = useEnterExitAnimation(items, item => item.id);
 *
 *   return (
 *     <div>
 *       {transitions((style, item) => (
 *         <animated.div style={style}>
 *           {item.content}
 *         </animated.div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useEnterExitAnimation<T>(
  /** Array of items */
  items: T[],
  /** Function to extract unique key from item */
  getKey: (item: T) => string,
  /** Stagger delay between element animations (ms) */
  stagger = DEFAULT_STAGGER
) {
  const prefersReducedMotion = useReducedMotion();

  const springConfig = prefersReducedMotion
    ? INSTANT_CONFIG
    : SPRING_LIQUID_CONFIGS?.liquidFloat ?? config.gentle;

  // Use react-spring's useTransition for enter/exit
  // Note: This is a simplified version - for full enter/exit,
  // you'd use useTransition from react-spring
  const [springs, api] = useSprings(items.length, (index) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    config: springConfig,
    delay: index * stagger,
  }));

  // Animate new items on mount
  useLayoutEffect(() => {
    if (prefersReducedMotion) return;

    api.start((index) => ({
      from: { opacity: 0, y: 20, scale: 0.95 },
      to: { opacity: 1, y: 0, scale: 1 },
      delay: index * stagger,
    }));
  }, [items.length, api, prefersReducedMotion, stagger]);

  const getProps = useCallback(
    (index: number) => {
      const spring = springs[index];

      return {
        style: prefersReducedMotion || !spring
          ? {}
          : {
              opacity: spring.opacity,
              transform: to(
                [spring.y, spring.scale],
                (y, scale) => `translate3d(0, ${y}px, 0) scale(${scale})`
              ),
            },
      };
    },
    [springs, prefersReducedMotion]
  );

  return { getProps, items };
}

/**
 * Helper: Get element rect without causing layout thrashing
 */
function getRect(element: HTMLElement): ElementRect {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export default useLayoutAnimation;
