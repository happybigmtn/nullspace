import { useLocation } from 'react-router-dom';
import { useRef, useEffect, useState, type ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Wraps page content with entrance animations on route change.
 * Uses CSS animations from index.css (fadeInUp with --motion-state timing).
 * Re-triggers animation when pathname changes by toggling a key.
 */
export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const [animationKey, setAnimationKey] = useState(0);
  const prevPathRef = useRef(location.pathname);

  useEffect(() => {
    if (location.pathname !== prevPathRef.current) {
      prevPathRef.current = location.pathname;
      setAnimationKey((k) => k + 1);
    }
  }, [location.pathname]);

  return (
    <div key={animationKey} className="page-transition-enter">
      {children}
    </div>
  );
}
