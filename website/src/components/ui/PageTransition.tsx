import { useLocation } from 'react-router-dom';
import {
  useRef,
  useEffect,
  useState,
  type ReactNode,
  createContext,
  useContext,
} from 'react';
import { animated, useTransition, useSpring, to } from '@react-spring/web';
import { SPRING_LIQUID_CONFIGS, SPRING_CONFIGS } from '../../utils/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

// Route hierarchy for direction detection
const ROUTE_ORDER: Record<string, number> = {
  '/': 0,
  '/swap': 1,
  '/borrow': 1.1,
  '/liquidity': 1.2,
  '/stake': 2,
  '/bridge': 3,
  '/security': 4,
};

// Instant config for reduced motion
const INSTANT_CONFIG = { duration: 0 };

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Direction-aware page transitions with spring physics
 *
 * Features:
 * - Outgoing page fades and scales down
 * - Incoming page fades and scales up from 0.95
 * - Direction-aware (slide left vs right based on navigation)
 * - Uses SPRING_LIQUID.liquidMorph for smooth transitions
 * - Respects prefers-reduced-motion
 */
export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const prevPathRef = useRef(location.pathname);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');

  // Detect navigation direction based on route order
  useEffect(() => {
    if (location.pathname !== prevPathRef.current) {
      const prevOrder = getRouteOrder(prevPathRef.current);
      const currOrder = getRouteOrder(location.pathname);
      setDirection(currOrder >= prevOrder ? 'forward' : 'backward');
      prevPathRef.current = location.pathname;
    }
  }, [location.pathname]);

  // Spring transition for page content
  const transitions = useTransition(location.pathname, {
    keys: location.pathname,
    from: prefersReducedMotion
      ? { opacity: 0 }
      : {
          opacity: 0,
          scale: 0.98,
          x: direction === 'forward' ? 20 : -20,
        },
    enter: prefersReducedMotion
      ? { opacity: 1 }
      : { opacity: 1, scale: 1, x: 0 },
    leave: prefersReducedMotion
      ? { opacity: 0 }
      : {
          opacity: 0,
          scale: 0.98,
          x: direction === 'forward' ? -20 : 20,
        },
    config: prefersReducedMotion
      ? INSTANT_CONFIG
      : SPRING_LIQUID_CONFIGS.liquidMorph,
    exitBeforeEnter: true,
  });

  return (
    <>
      {transitions((style, pathname) =>
        pathname === location.pathname ? (
          <animated.div
            style={
              prefersReducedMotion
                ? { opacity: style.opacity }
                : {
                    opacity: style.opacity,
                    transform: to(
                      [style.scale, style.x],
                      (s, x) => `scale(${s}) translateX(${x}px)`
                    ),
                  }
            }
            className="page-transition-wrapper"
          >
            {children}
          </animated.div>
        ) : null
      )}
    </>
  );
}

/**
 * Get route order for direction detection
 */
function getRouteOrder(pathname: string): number {
  // Direct match
  if (ROUTE_ORDER[pathname] !== undefined) {
    return ROUTE_ORDER[pathname];
  }

  // Check for nested routes
  for (const [route, order] of Object.entries(ROUTE_ORDER)) {
    if (pathname.startsWith(route) && route !== '/') {
      return order;
    }
  }

  // Default to end of list for unknown routes
  return 100;
}

/**
 * StaggerChildren - Wrapper that staggers children reveal
 *
 * @example
 * ```tsx
 * <StaggerChildren>
 *   <Card>First</Card>
 *   <Card>Second</Card>
 *   <Card>Third</Card>
 * </StaggerChildren>
 * ```
 */
interface StaggerChildrenProps {
  children: ReactNode[];
  /** Delay between each child in ms (default: 50) */
  delay?: number;
  /** Spring preset to use */
  preset?: 'button' | 'modal' | 'dropdown' | 'tooltip';
}

export function StaggerChildren({
  children,
  delay = 50,
  preset = 'dropdown',
}: StaggerChildrenProps) {
  const prefersReducedMotion = useReducedMotion();

  const transitions = useTransition(children, {
    keys: (_, index) => index,
    from: prefersReducedMotion
      ? { opacity: 0 }
      : { opacity: 0, y: 10, scale: 0.98 },
    enter: (_, index) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      delay: index * delay,
    }),
    trail: delay,
    config: prefersReducedMotion ? INSTANT_CONFIG : SPRING_CONFIGS[preset],
  });

  return (
    <>
      {transitions((style, child) => (
        <animated.div
          style={
            prefersReducedMotion
              ? { opacity: style.opacity }
              : {
                  opacity: style.opacity,
                  transform: to(
                    [style.y, style.scale],
                    (y, scale) => `translateY(${y}px) scale(${scale})`
                  ),
                }
          }
        >
          {child}
        </animated.div>
      ))}
    </>
  );
}

/**
 * SharedElement context for FLIP animations
 * Allows elements to "morph" between pages
 */
interface SharedElementPosition {
  id: string;
  rect: DOMRect;
}

interface SharedElementContextValue {
  register: (id: string, element: HTMLElement) => void;
  unregister: (id: string) => void;
  getPosition: (id: string) => DOMRect | null;
}

const SharedElementContext = createContext<SharedElementContextValue | null>(
  null
);

export function SharedElementProvider({ children }: { children: ReactNode }) {
  const positionsRef = useRef<Map<string, DOMRect>>(new Map());

  const value: SharedElementContextValue = {
    register: (id, element) => {
      positionsRef.current.set(id, element.getBoundingClientRect());
    },
    unregister: (id) => {
      positionsRef.current.delete(id);
    },
    getPosition: (id) => positionsRef.current.get(id) ?? null,
  };

  return (
    <SharedElementContext.Provider value={value}>
      {children}
    </SharedElementContext.Provider>
  );
}

/**
 * Mark an element as shared across page transitions
 * The element will morph its position when navigating
 */
export function useSharedElement(id: string) {
  const context = useContext(SharedElementContext);
  const elementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !context) return;

    context.register(id, element);
    return () => context.unregister(id);
  }, [id, context]);

  return {
    ref: (el: HTMLElement | null) => {
      elementRef.current = el;
    },
  };
}

export default PageTransition;
