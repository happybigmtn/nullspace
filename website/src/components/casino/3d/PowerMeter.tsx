/**
 * Power Meter Component (Desktop)
 *
 * Hold-to-charge interaction:
 * - Hold spacebar or button to fill meter
 * - Release to throw with accumulated power
 * - Spring-based fill animation for satisfying feel
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { animated, useSpring } from '@react-spring/web';

interface PowerMeterProps {
  /** Whether the meter is active/visible */
  active: boolean;
  /** Callback when power is released */
  onRelease: (power: number) => void;
  /** Optional key to trigger (default: Space) */
  triggerKey?: string;
  /** Disable keyboard control (for mobile) */
  disableKeyboard?: boolean;
}

export const PowerMeter: React.FC<PowerMeterProps> = ({
  active,
  onRelease,
  triggerKey = ' ',
  disableKeyboard = false,
}) => {
  const [isCharging, setIsCharging] = useState(false);
  const [power, setPower] = useState(0);
  const chargeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  // Spring animation for the meter fill
  const springProps = useSpring({
    width: `${power * 100}%`,
    backgroundColor: power < 0.3 ? '#00ff41' : power < 0.7 ? '#ffdd00' : '#ff4444',
    config: { tension: 300, friction: 20 },
  });

  // Glow intensity based on power
  const glowSpring = useSpring({
    boxShadow: `0 0 ${power * 20}px ${power * 10}px ${
      power < 0.3 ? 'rgba(0,255,65,0.5)' : power < 0.7 ? 'rgba(255,221,0,0.5)' : 'rgba(255,68,68,0.5)'
    }`,
    config: { tension: 200, friction: 25 },
  });

  // Start charging
  const startCharge = useCallback(() => {
    if (!active) return;
    setIsCharging(true);
    startTimeRef.current = Date.now();

    // Charge up over ~1.5 seconds
    chargeIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const newPower = Math.min(1, elapsed / 1500);
      setPower(newPower);
    }, 16);
  }, [active]);

  // Release and throw
  const releaseCharge = useCallback(() => {
    if (!isCharging) return;

    setIsCharging(false);
    if (chargeIntervalRef.current) {
      clearInterval(chargeIntervalRef.current);
    }

    // Call back with current power, then reset
    onRelease(power);
    setPower(0);
  }, [isCharging, power, onRelease]);

  // Keyboard handlers
  useEffect(() => {
    if (disableKeyboard || !active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === triggerKey && !e.repeat) {
        e.preventDefault();
        startCharge();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === triggerKey) {
        e.preventDefault();
        releaseCharge();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [active, disableKeyboard, triggerKey, startCharge, releaseCharge]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (chargeIntervalRef.current) {
        clearInterval(chargeIntervalRef.current);
      }
    };
  }, []);

  if (!active) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Power meter bar */}
      <div className="relative w-48 h-6 bg-terminal-dim border border-terminal-green/50 rounded-full overflow-hidden">
        <animated.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ ...springProps, ...glowSpring }}
        />
        {/* Tick marks */}
        <div className="absolute inset-0 flex justify-between px-1 pointer-events-none">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="w-px h-full bg-terminal-green/20" />
          ))}
        </div>
      </div>

      {/* Instructions */}
      <div className="text-xs text-gray-500 font-mono tracking-wider">
        {isCharging ? (
          <span className="text-terminal-green animate-pulse">CHARGING...</span>
        ) : (
          <span>HOLD [SPACE] TO CHARGE</span>
        )}
      </div>

      {/* Touch/click button for hybrid use */}
      <button
        type="button"
        onMouseDown={startCharge}
        onMouseUp={releaseCharge}
        onMouseLeave={() => isCharging && releaseCharge()}
        onTouchStart={startCharge}
        onTouchEnd={releaseCharge}
        className="px-6 py-2 bg-terminal-dim border border-terminal-green text-terminal-green
                   rounded font-mono text-sm uppercase tracking-wider
                   hover:bg-terminal-green/10 active:bg-terminal-green/20
                   transition-colors select-none touch-none"
      >
        {isCharging ? 'RELEASE TO THROW' : 'HOLD TO CHARGE'}
      </button>
    </div>
  );
};

export default PowerMeter;
