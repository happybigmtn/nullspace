import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';

interface ScrollRevealOptions {
  /** Threshold for intersection (0-1). Default 0.1 (10% visible) */
  threshold?: number;
  /** Root margin for early/late triggering. Default '0px' */
  rootMargin?: string;
  /** Whether animation should only trigger once. Default true */
  once?: boolean;
  /** Delay before marking as revealed (ms). Default 0 */
  delay?: number;
}

/**
 * Hook for scroll-triggered reveal animations using Intersection Observer.
 * Returns a ref to attach to the element and a boolean indicating visibility.
 *
 * @example
 * const [ref, isRevealed] = useScrollReveal({ threshold: 0.2 });
 * return <div ref={ref} className={isRevealed ? 'scroll-revealed' : 'scroll-hidden'}>...</div>
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  options: ScrollRevealOptions = {}
): [RefObject<T | null>, boolean] {
  const { threshold = 0.1, rootMargin = '0px', once = true, delay = 0 } = options;
  const ref = useRef<T>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const hasRevealedRef = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Skip if already revealed and once mode is enabled
    if (once && hasRevealedRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (delay > 0) {
            setTimeout(() => {
              setIsRevealed(true);
              hasRevealedRef.current = true;
            }, delay);
          } else {
            setIsRevealed(true);
            hasRevealedRef.current = true;
          }
          if (once) {
            observer.unobserve(element);
          }
        } else if (!once) {
          setIsRevealed(false);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [threshold, rootMargin, once, delay]);

  return [ref, isRevealed];
}

/**
 * Hook for applying staggered scroll reveal to a list of items.
 * Returns refs and reveal states for each item.
 *
 * @example
 * const items = ['a', 'b', 'c'];
 * const { getItemProps } = useStaggeredScrollReveal(items.length, { staggerDelay: 50 });
 * return items.map((item, i) => <div {...getItemProps(i)}>{item}</div>);
 */
export function useStaggeredScrollReveal(
  count: number,
  options: ScrollRevealOptions & { staggerDelay?: number } = {}
): {
  getItemProps: (index: number) => { ref: RefObject<HTMLDivElement | null>; className: string };
} {
  const { staggerDelay = 50, ...revealOptions } = options;
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const [revealedStates, setRevealedStates] = useState<boolean[]>(() => Array(count).fill(false));

  useEffect(() => {
    // Resize refs array if count changes
    refs.current = refs.current.slice(0, count);
    while (refs.current.length < count) {
      refs.current.push(null);
    }
  }, [count]);

  useEffect(() => {
    const { threshold = 0.1, rootMargin = '0px', once = true } = revealOptions;
    const observers: IntersectionObserver[] = [];

    refs.current.forEach((element, index) => {
      if (!element) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setTimeout(() => {
              setRevealedStates((prev) => {
                const next = [...prev];
                next[index] = true;
                return next;
              });
            }, index * staggerDelay);
            if (once) {
              observer.unobserve(element);
            }
          } else if (!once) {
            setRevealedStates((prev) => {
              const next = [...prev];
              next[index] = false;
              return next;
            });
          }
        },
        { threshold, rootMargin }
      );

      observer.observe(element);
      observers.push(observer);
    });

    return () => {
      observers.forEach((o) => o.disconnect());
    };
  }, [count, staggerDelay, revealOptions]);

  const getItemProps = useCallback(
    (index: number) => ({
      ref: { current: refs.current[index] } as RefObject<HTMLDivElement | null>,
      className: revealedStates[index] ? 'scroll-revealed' : 'scroll-hidden',
      // Allow setting ref
      setRef: (el: HTMLDivElement | null) => {
        refs.current[index] = el;
      },
    }),
    [revealedStates]
  );

  return {
    getItemProps: (index: number) => {
      const isRevealed = revealedStates[index] ?? false;
      return {
        ref: {
          get current() {
            return refs.current[index] ?? null;
          },
          set current(el: HTMLDivElement | null) {
            refs.current[index] = el;
          },
        } as RefObject<HTMLDivElement | null>,
        className: isRevealed ? 'scroll-revealed' : 'scroll-hidden',
      };
    },
  };
}

/**
 * Hook for parallax scroll effect on a background element.
 * Returns current Y offset based on scroll position.
 *
 * @example
 * const [ref, offsetY] = useParallax({ speed: 0.5 });
 * return <div ref={ref} style={{ transform: `translateY(${offsetY}px)` }}>...</div>
 */
export function useParallax<T extends HTMLElement = HTMLDivElement>(
  options: { speed?: number } = {}
): [RefObject<T | null>, number] {
  const { speed = 0.5 } = options;
  const ref = useRef<T>(null);
  const [offsetY, setOffsetY] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleScroll = () => {
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      // Calculate how far through the viewport the element is
      // Range: -1 (fully below) to 1 (fully above)
      const progress = (viewportHeight - rect.top) / (viewportHeight + rect.height);

      // Only apply effect when element is partially visible
      if (progress > 0 && progress < 1) {
        // Center the effect (0 when element is centered in viewport)
        const centered = (progress - 0.5) * 2;
        setOffsetY(centered * 100 * speed);
      }
    };

    handleScroll(); // Initial calculation
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [speed]);

  return [ref, offsetY];
}
