import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { animated, useSpring, useTransition, config } from '@react-spring/web';
import { useSharedCasinoConnection } from '../chain/CasinoConnectionContext';
import { useReducedMotion } from '../hooks/useReducedMotion';

type ConnectionStatusProps = {
  className?: string;
};

type ConnectionStatusType =
  | 'connected'
  | 'connecting'
  | 'offline'
  | 'vault_locked'
  | 'missing_identity'
  | 'error';

/**
 * LUX-024: Action-oriented status messages
 * Every message tells users what happened + what to do
 */
const statusLabel = (status: string, vaultMissing: boolean) => {
  switch (status) {
    case 'connected':
      return 'Online';
    case 'connecting':
      return 'Connecting...';
    case 'offline':
      return 'Reconnecting...';
    case 'vault_locked':
      return vaultMissing ? 'Create vault' : 'Tap to unlock';
    case 'missing_identity':
      return 'Complete setup';
    case 'error':
      return 'Connection lost. Tap retry';
    default:
      return 'Connecting...';
  }
};

/**
 * LUX-024: Status colors
 * - Amber for recoverable states (offline, reconnecting)
 * - Red only for true errors
 * - Green for success
 */
const STATUS_COLORS: Record<string, string> = {
  connected: '#34C759', // success green
  connecting: '#9CA3AF', // gray-400
  offline: '#F59E0B', // amber-500 (recoverable, auto-reconnecting)
  error: '#FF3B30', // destructive red (user action needed)
  vault_locked: '#5E5CE6', // action-primary (indigo)
  missing_identity: '#5E5CE6',
  default: '#9CA3AF',
};

const getStatusColor = (status: string): string =>
  STATUS_COLORS[status] || STATUS_COLORS.default;

/** Icons for each status */
const StatusIcon = ({ status }: { status: string }) => {
  const iconMap: Record<string, JSX.Element> = {
    connected: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
    ),
    connecting: (
      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 20 20">
        <circle
          className="opacity-25"
          cx="10"
          cy="10"
          r="8"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 10a6 6 0 016-6V2a8 8 0 00-8 8h2z"
        />
      </svg>
    ),
    offline: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
          clipRule="evenodd"
        />
      </svg>
    ),
    error: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
    ),
    vault_locked: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
          clipRule="evenodd"
        />
      </svg>
    ),
    missing_identity: (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
          clipRule="evenodd"
        />
      </svg>
    ),
  };
  return iconMap[status] || iconMap.connecting;
};

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ className }) => {
  const { status, statusDetail, error, refreshOnce, vaultMode } = useSharedCasinoConnection();
  const prefersReducedMotion = useReducedMotion();

  // Track previous status for transition detection
  const prevStatusRef = useRef(status);
  const [showReconnectFlash, setShowReconnectFlash] = useState(false);
  const [showErrorShake, setShowErrorShake] = useState(false);

  const vaultMissing = status === 'vault_locked' && vaultMode === 'missing';
  const label = statusLabel(status, vaultMissing);
  const detail = statusDetail ?? error;
  const display = detail ?? label;
  const title = detail && detail !== label ? detail : undefined;
  const showRetry = status === 'offline' || status === 'error';
  const showUnlock = status === 'vault_locked';
  const isConnecting = status === 'connecting';
  const isError = status === 'error' || status === 'offline';

  // Detect reconnection success - show brief celebration
  useEffect(() => {
    const wasDisconnected =
      prevStatusRef.current === 'offline' ||
      prevStatusRef.current === 'error' ||
      prevStatusRef.current === 'connecting';

    if (wasDisconnected && status === 'connected' && !prefersReducedMotion) {
      setShowReconnectFlash(true);
      const timer = setTimeout(() => setShowReconnectFlash(false), 800);
      return () => clearTimeout(timer);
    }
    prevStatusRef.current = status;
  }, [status, prefersReducedMotion]);

  // Show error shake when entering error state
  useEffect(() => {
    const wasNotError =
      prevStatusRef.current !== 'error' && prevStatusRef.current !== 'offline';

    if (wasNotError && isError && !prefersReducedMotion) {
      setShowErrorShake(true);
      const timer = setTimeout(() => setShowErrorShake(false), 400);
      return () => clearTimeout(timer);
    }
  }, [isError, prefersReducedMotion]);

  // Animated color spring - morphs smoothly between status colors
  const colorSpring = useSpring({
    color: getStatusColor(status),
    config: { tension: 120, friction: 14 },
    immediate: prefersReducedMotion,
  });

  // Reconnect flash animation
  const flashSpring = useSpring({
    scale: showReconnectFlash ? 1.1 : 1,
    opacity: showReconnectFlash ? 1 : 0,
    config: { tension: 300, friction: 20 },
    immediate: prefersReducedMotion,
  });

  // Error shake animation
  const shakeSpring = useSpring({
    x: showErrorShake ? [0, -3, 3, -2, 2, 0][Math.floor(Date.now() / 50) % 6] : 0,
    config: config.wobbly,
    immediate: prefersReducedMotion,
  });

  // Pulse animation for connecting state
  const pulseSpring = useSpring({
    scale: isConnecting ? [1, 1.2, 1][Math.floor(Date.now() / 500) % 3] : 1,
    opacity: isConnecting ? [1, 0.5, 1][Math.floor(Date.now() / 500) % 3] : 1,
    config: { duration: 1000 },
    loop: isConnecting,
    immediate: prefersReducedMotion,
  });

  // Icon transition for smooth crossfade
  const iconTransitions = useTransition(status, {
    from: { opacity: 0, scale: 0.8 },
    enter: { opacity: 1, scale: 1 },
    leave: { opacity: 0, scale: 0.8 },
    config: { tension: 200, friction: 20 },
    immediate: prefersReducedMotion,
  });

  return (
    <animated.div
      className={[
        // LUX-024: Updated to luxury aesthetic
        'flex items-center gap-2 liquid-chip px-3 py-1.5 relative overflow-hidden shadow-soft',
        className ?? '',
      ]
        .join(' ')
        .trim()}
      style={{
        transform: shakeSpring.x.to((x) => `translateX(${x}px)`),
      }}
      role="status"
      aria-live="polite"
    >
      {/* Reconnect success flash overlay */}
      <animated.div
        className="absolute inset-0 bg-action-success/20 rounded pointer-events-none"
        style={{
          opacity: flashSpring.opacity,
          transform: flashSpring.scale.to((s) => `scale(${s})`),
        }}
      />

      {/* Status indicator dot with pulse */}
      <animated.div
        className="relative w-2 h-2 rounded-full"
        style={{
          backgroundColor: colorSpring.color,
          transform: pulseSpring.scale.to((s) => `scale(${s})`),
          opacity: pulseSpring.opacity,
        }}
      >
        {/* Pulse ring for connecting state */}
        {isConnecting && !prefersReducedMotion && (
          <span className="absolute inset-0 rounded-full animate-ping bg-current opacity-30" />
        )}
      </animated.div>

      {/* Icon with crossfade transition */}
      <div className="relative w-3 h-3">
        {iconTransitions((style, item) => (
          <animated.div
            className="absolute inset-0"
            style={{
              ...style,
              color: colorSpring.color,
            }}
          >
            <StatusIcon status={item} />
          </animated.div>
        ))}
      </div>

      {/* Status text with color animation */}
      <animated.span
        className="text-micro font-medium tracking-wider max-w-[220px] truncate"
        style={{ color: colorSpring.color }}
        title={title}
      >
        {display}
      </animated.span>

      {showUnlock ? (
        <Link
          to="/security"
          className="text-[10px] uppercase tracking-[0.3em] text-ns hover:text-ns-muted"
        >
          {vaultMissing ? 'Create' : 'Unlock'}
        </Link>
      ) : null}
      {showRetry ? (
        <button
          type="button"
          onClick={() => void refreshOnce()}
          className="text-[10px] uppercase tracking-[0.28em] font-semibold liquid-chip px-3 py-1 text-ns hover:shadow-soft transition-colors"
        >
          Retry
        </button>
      ) : null}
    </animated.div>
  );
};
