/**
 * Tutorial spotlight component for progressive disclosure of UI elements
 *
 * Features (DS-052):
 * - Circular reveal that expands from target element
 * - Background dims with animated blur
 * - Spotlight follows element if it moves
 * - Smooth spring transitions between tutorial steps
 * - Animated gesture hints (tap/swipe icons)
 */
import React, { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { animated, useSpring, useTransition, config } from '@react-spring/web';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export interface TutorialStep {
  /** CSS selector or ref to target element */
  target: string;
  /** Step title */
  title: string;
  /** Step description */
  description: string;
  /** Gesture hint type */
  gesture?: 'tap' | 'swipe-left' | 'swipe-right' | 'swipe-up' | 'swipe-down';
  /** Placement of tooltip relative to spotlight */
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

export interface TutorialSpotlightProps {
  /** Tutorial steps */
  steps: TutorialStep[];
  /** Whether the tutorial is visible */
  isOpen: boolean;
  /** Called when tutorial is completed or skipped */
  onComplete: () => void;
  /** Called when step changes */
  onStepChange?: (step: number) => void;
  /** Initial step index */
  initialStep?: number;
  /** Padding around spotlight circle */
  spotlightPadding?: number;
  /** Custom z-index for overlay */
  zIndex?: number;
}

/** Gesture hint icons */
const GestureIcon = ({ gesture }: { gesture?: TutorialStep['gesture'] }) => {
  if (!gesture) return null;

  const gestureClass =
    gesture === 'tap'
      ? 'animate-pulse'
      : gesture.startsWith('swipe')
        ? 'animate-bounce'
        : '';

  const icons: Record<string, ReactNode> = {
    tap: (
      <svg className={`w-8 h-8 text-white ${gestureClass}`} fill="currentColor" viewBox="0 0 24 24">
        <path d="M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74c-1.21-.81-2-2.18-2-3.74 0-2.49 2.01-4.5 4.5-4.5s4.5 2.01 4.5 4.5c0 .56-.1 1.09-.28 1.58l1.46.73c.5.25.78.77.78 1.3 0 .82-.67 1.49-1.49 1.49-.2 0-.4-.04-.63-.17z" />
      </svg>
    ),
    'swipe-left': (
      <svg className={`w-8 h-8 text-white ${gestureClass}`} fill="currentColor" viewBox="0 0 24 24">
        <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" />
      </svg>
    ),
    'swipe-right': (
      <svg className={`w-8 h-8 text-white ${gestureClass}`} fill="currentColor" viewBox="0 0 24 24">
        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
      </svg>
    ),
    'swipe-up': (
      <svg className={`w-8 h-8 text-white ${gestureClass}`} fill="currentColor" viewBox="0 0 24 24">
        <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z" />
      </svg>
    ),
    'swipe-down': (
      <svg className={`w-8 h-8 text-white ${gestureClass}`} fill="currentColor" viewBox="0 0 24 24">
        <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41 1.41z" />
      </svg>
    ),
  };

  return <div className="mt-2">{icons[gesture]}</div>;
};

export function TutorialSpotlight({
  steps,
  isOpen,
  onComplete,
  onStepChange,
  initialStep = 0,
  spotlightPadding = 16,
  zIndex = 9999,
}: TutorialSpotlightProps) {
  const prefersReducedMotion = useReducedMotion();
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const step = steps[currentStep];

  // Measure target element
  const measureTarget = useCallback(() => {
    if (!step?.target) return;
    const element = document.querySelector(step.target);
    if (element) {
      setTargetRect(element.getBoundingClientRect());
    }
  }, [step?.target]);

  // Update measurements on step change or scroll
  useEffect(() => {
    if (!isOpen) return;
    measureTarget();

    const handleScroll = () => measureTarget();
    const handleResize = () => measureTarget();

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, measureTarget]);

  // Spotlight animation
  const spotlightSpring = useSpring({
    x: targetRect ? targetRect.left + targetRect.width / 2 : window.innerWidth / 2,
    y: targetRect ? targetRect.top + targetRect.height / 2 : window.innerHeight / 2,
    size: targetRect
      ? Math.max(targetRect.width, targetRect.height) + spotlightPadding * 2
      : 100,
    opacity: isOpen ? 1 : 0,
    config: prefersReducedMotion ? { duration: 0 } : config.gentle,
  });

  // Tooltip transition
  const tooltipTransitions = useTransition(isOpen ? currentStep : null, {
    from: { opacity: 0, scale: 0.9, y: 20 },
    enter: { opacity: 1, scale: 1, y: 0 },
    leave: { opacity: 0, scale: 0.9, y: -20 },
    config: prefersReducedMotion ? { duration: 0 } : { tension: 200, friction: 20 },
  });

  // Navigation handlers
  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      const nextStep = currentStep + 1;
      setCurrentStep(nextStep);
      onStepChange?.(nextStep);
    } else {
      onComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      onStepChange?.(prevStep);
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  // Calculate tooltip position
  const getTooltipPosition = () => {
    if (!targetRect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

    const placement = step?.placement || 'bottom';
    const centerX = targetRect.left + targetRect.width / 2;
    const centerY = targetRect.top + targetRect.height / 2;
    const spotlightRadius = Math.max(targetRect.width, targetRect.height) / 2 + spotlightPadding;

    switch (placement) {
      case 'top':
        return {
          top: centerY - spotlightRadius - 16,
          left: centerX,
          transform: 'translate(-50%, -100%)',
        };
      case 'bottom':
        return {
          top: centerY + spotlightRadius + 16,
          left: centerX,
          transform: 'translate(-50%, 0)',
        };
      case 'left':
        return {
          top: centerY,
          left: centerX - spotlightRadius - 16,
          transform: 'translate(-100%, -50%)',
        };
      case 'right':
        return {
          top: centerY + spotlightRadius + 16,
          left: centerX,
          transform: 'translate(0, -50%)',
        };
      default:
        return {
          top: centerY + spotlightRadius + 16,
          left: centerX,
          transform: 'translate(-50%, 0)',
        };
    }
  };

  if (!isOpen || !step) return null;

  const tooltipPos = getTooltipPosition();

  return createPortal(
    <animated.div
      ref={overlayRef}
      className="fixed inset-0"
      style={{
        zIndex,
        opacity: spotlightSpring.opacity,
        pointerEvents: isOpen ? 'auto' : 'none',
      }}
    >
      {/* Dark overlay with spotlight hole using radial gradient mask */}
      <animated.div
        className="absolute inset-0"
        style={{
          background: spotlightSpring.x.to(
            (x) =>
              `radial-gradient(circle ${spotlightSpring.size.get()}px at ${x}px ${spotlightSpring.y.get()}px, transparent 0%, rgba(0,0,0,0.85) 100%)`
          ),
          backdropFilter: 'blur(2px)',
        }}
        onClick={handleSkip}
      />

      {/* Tooltip card */}
      {tooltipTransitions((style, item) =>
        item !== null ? (
          <animated.div
            className="absolute max-w-sm bg-titanium-900 rounded-xl p-4 shadow-2xl border border-titanium-700"
            style={{
              ...style,
              top: tooltipPos.top,
              left: tooltipPos.left,
              transform: tooltipPos.transform,
            }}
          >
            {/* Step indicator */}
            <div className="flex items-center justify-center gap-1.5 mb-3">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === currentStep
                      ? 'w-6 bg-action-indigo'
                      : i < currentStep
                        ? 'w-1.5 bg-action-indigo/50'
                        : 'w-1.5 bg-titanium-600'
                  }`}
                />
              ))}
            </div>

            {/* Content */}
            <h3 className="text-sm font-semibold text-white text-center uppercase tracking-widest mb-2">
              {step.title}
            </h3>
            <p className="text-sm text-titanium-300 text-center mb-4">{step.description}</p>

            {/* Gesture hint */}
            <div className="flex justify-center">
              <GestureIcon gesture={step.gesture} />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={handleSkip}
                className="text-xs text-titanium-400 hover:text-white transition-colors uppercase"
              >
                Skip
              </button>
              <div className="flex gap-2">
                {currentStep > 0 && (
                  <button
                    onClick={handlePrev}
                    className="px-3 py-1.5 text-xs border border-titanium-600 rounded-md text-titanium-300 hover:border-titanium-400 hover:text-white transition-colors"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={handleNext}
                  className="px-4 py-1.5 text-xs bg-action-indigo rounded-md text-white hover:bg-action-indigoHover transition-colors font-medium"
                >
                  {currentStep === steps.length - 1 ? 'Got it!' : 'Next'}
                </button>
              </div>
            </div>
          </animated.div>
        ) : null
      )}
    </animated.div>,
    document.body
  );
}

export default TutorialSpotlight;
