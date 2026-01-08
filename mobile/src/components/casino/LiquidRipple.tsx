/**
 * LiquidRipple - GPU-accelerated liquid ether effect for chip placement (DS-054)
 *
 * Renders organic, fluid ripples using Skia shaders when chips land.
 * Inspired by WebGL fluid dynamics, optimized for mobile performance.
 *
 * Features:
 * - Multiple concurrent ripples with staggered timing
 * - Radial gradient with color palette blending
 * - Spring physics for organic motion (SPRING_LIQUID.liquidSplash)
 * - Automatic cleanup of completed ripples
 */
import React, { useCallback, useImperativeHandle, forwardRef, useRef } from 'react';
import { StyleSheet, View, LayoutChangeEvent } from 'react-native';
import {
  Canvas,
  Circle,
  RadialGradient,
  vec,
  Group,
  Blur,
  Paint,
  BlendMode,
} from '@shopify/react-native-skia';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
  runOnJS,
  useAnimatedReaction,
  SharedValue,
} from 'react-native-reanimated';
import { SPRING_LIQUID, DURATION } from '@nullspace/design-tokens';

/**
 * Liquid ether color palette
 * Matches the premium casino aesthetic with indigo/purple/gold tones
 */
const LIQUID_COLORS = {
  primary: '#5227FF',    // Deep indigo
  secondary: '#FF9FFC',  // Pink highlight
  tertiary: '#B19EEF',   // Lavender
  gold: '#FFCC00',       // Jackpot gold accent
};

/**
 * Single ripple state for tracking animation
 */
interface RippleState {
  id: string;
  x: number;
  y: number;
  color: string;
  startTime: number;
}

/**
 * Individual animated ripple component
 * Uses Skia for GPU-accelerated radial gradients
 */
interface AnimatedRippleProps {
  x: number;
  y: number;
  color: string;
  onComplete: () => void;
  index: number;
}

const AnimatedRipple = React.memo(function AnimatedRipple({
  x,
  y,
  color,
  onComplete,
  index,
}: AnimatedRippleProps) {
  const radius = useSharedValue(0);
  const opacity = useSharedValue(0.8);

  React.useEffect(() => {
    // Stagger start based on index for overlapping ripples
    const delay = index * 40;

    // Expand with liquid spring physics
    radius.value = withDelay(
      delay,
      withSpring(120, {
        ...SPRING_LIQUID.liquidSplash,
        // Slightly reduce damping for more fluid expansion
        damping: SPRING_LIQUID.liquidSplash.damping - 2,
      })
    );

    // Fade out as ripple expands
    opacity.value = withDelay(
      delay,
      withSequence(
        withTiming(0.6, { duration: 100 }),
        withTiming(0, { duration: DURATION.slow })
      )
    );

    // Cleanup after animation completes
    const timeoutId = setTimeout(() => {
      runOnJS(onComplete)();
    }, DURATION.slow + delay + 200);

    return () => clearTimeout(timeoutId);
  }, [radius, opacity, onComplete, index]);

  // Track animation progress for Skia
  const [animState, setAnimState] = React.useState({ r: 0, o: 0.8 });

  useAnimatedReaction(
    () => ({ r: radius.value, o: opacity.value }),
    (result) => {
      runOnJS(setAnimState)(result);
    },
    [radius, opacity]
  );

  if (animState.o <= 0.01) return null;

  return (
    <Group opacity={animState.o}>
      <Circle cx={x} cy={y} r={animState.r}>
        <RadialGradient
          c={vec(x, y)}
          r={animState.r || 1}
          colors={[
            color,
            `${color}80`, // 50% alpha
            `${color}40`, // 25% alpha
            'transparent',
          ]}
          positions={[0, 0.3, 0.6, 1]}
        />
      </Circle>
      {/* Inner bright core for liquid depth */}
      <Circle cx={x} cy={y} r={animState.r * 0.4}>
        <RadialGradient
          c={vec(x, y)}
          r={(animState.r * 0.4) || 1}
          colors={[
            '#FFFFFF60',
            `${color}60`,
            'transparent',
          ]}
          positions={[0, 0.5, 1]}
        />
      </Circle>
    </Group>
  );
});

/**
 * Props for LiquidRipple container
 */
export interface LiquidRippleProps {
  /** Custom color palette (optional) */
  colors?: string[];
  /** Enable blur effect for extra fluidity (performance cost) */
  enableBlur?: boolean;
  /** Blur intensity (default 4) */
  blurAmount?: number;
  /** Max concurrent ripples before oldest is removed */
  maxRipples?: number;
  /** Container style */
  style?: object;
}

/**
 * Ref handle for triggering ripples from parent
 */
export interface LiquidRippleRef {
  /** Trigger a ripple at normalized coordinates (0-1) */
  triggerRipple: (normalizedX?: number, normalizedY?: number, colorIndex?: number) => void;
  /** Trigger ripple at center */
  triggerCenterRipple: (colorIndex?: number) => void;
  /** Clear all active ripples */
  clearRipples: () => void;
}

/**
 * LiquidRipple component - creates fluid ether effect on chip placement
 *
 * Usage:
 * ```tsx
 * const rippleRef = useRef<LiquidRippleRef>(null);
 *
 * // In chip landing callback:
 * rippleRef.current?.triggerRipple(0.5, 0.5, 0);
 *
 * return (
 *   <View>
 *     <LiquidRipple ref={rippleRef} />
 *     <ChipPile ... />
 *   </View>
 * );
 * ```
 */
export const LiquidRipple = forwardRef<LiquidRippleRef, LiquidRippleProps>(
  function LiquidRipple(
    {
      colors = [LIQUID_COLORS.primary, LIQUID_COLORS.secondary, LIQUID_COLORS.tertiary],
      enableBlur = false,
      blurAmount = 4,
      maxRipples = 5,
      style,
    },
    ref
  ) {
    const [ripples, setRipples] = React.useState<RippleState[]>([]);
    const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });
    const rippleIdRef = useRef(0);

    const handleLayout = useCallback((event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setDimensions({ width, height });
    }, []);

    const removeRipple = useCallback((id: string) => {
      setRipples((prev) => prev.filter((r) => r.id !== id));
    }, []);

    const triggerRipple = useCallback(
      (normalizedX = 0.5, normalizedY = 0.5, colorIndex = 0) => {
        if (dimensions.width === 0 || dimensions.height === 0) return;

        const x = normalizedX * dimensions.width;
        const y = normalizedY * dimensions.height;
        const color = colors[colorIndex % colors.length] ?? LIQUID_COLORS.primary;
        const id = `ripple-${rippleIdRef.current++}`;

        setRipples((prev) => {
          // Remove oldest if at max
          const updated = prev.length >= maxRipples ? prev.slice(1) : prev;
          return [...updated, { id, x, y, color, startTime: Date.now() }];
        });
      },
      [dimensions, colors, maxRipples]
    );

    const triggerCenterRipple = useCallback(
      (colorIndex = 0) => {
        triggerRipple(0.5, 0.5, colorIndex);
      },
      [triggerRipple]
    );

    const clearRipples = useCallback(() => {
      setRipples([]);
    }, []);

    // Expose methods to parent via ref
    useImperativeHandle(
      ref,
      () => ({
        triggerRipple,
        triggerCenterRipple,
        clearRipples,
      }),
      [triggerRipple, triggerCenterRipple, clearRipples]
    );

    return (
      <View style={[styles.container, style]} onLayout={handleLayout} pointerEvents="none">
        <Canvas style={styles.canvas}>
          {enableBlur && (
            <Paint>
              <Blur blur={blurAmount} />
            </Paint>
          )}
          {ripples.map((ripple, index) => (
            <AnimatedRipple
              key={ripple.id}
              x={ripple.x}
              y={ripple.y}
              color={ripple.color}
              onComplete={() => removeRipple(ripple.id)}
              index={index}
            />
          ))}
        </Canvas>
      </View>
    );
  }
);

/**
 * Hook for easy ripple integration with ChipPile
 * Returns a ref and trigger function
 */
export function useLiquidRipple() {
  const rippleRef = useRef<LiquidRippleRef>(null);

  const triggerOnChipLand = useCallback((colorIndex?: number) => {
    // Slight random offset from center for organic feel
    const offsetX = 0.5 + (Math.random() - 0.5) * 0.2;
    const offsetY = 0.5 + (Math.random() - 0.5) * 0.2;
    rippleRef.current?.triggerRipple(offsetX, offsetY, colorIndex);
  }, []);

  return { rippleRef, triggerOnChipLand };
}

/**
 * Chip value to color index mapping for coordinated ripple colors
 * Maps chip denominations to liquid color palette indices
 */
const CHIP_COLOR_MAP: Record<number, number> = {
  1: 2,     // White chip -> Lavender
  5: 0,     // Red chip -> Indigo
  25: 1,    // Green chip -> Pink
  100: 0,   // Black chip -> Indigo
  500: 1,   // Purple chip -> Pink
  1000: 0,  // Gold chip -> Indigo (special gold handled separately)
};

/**
 * ChipPileWithRipple Props - Extends ChipPile with liquid effect
 */
export interface ChipPileWithRippleProps {
  /** Array of placed chips */
  chips: Array<{
    id: string;
    value: number;
    rotation: number;
    placedAt: number;
    scatterX?: number;
    scatterY?: number;
  }>;
  /** Total bet amount */
  totalBet: number;
  /** Show the counter overlay */
  showCounter?: boolean;
  /** Test ID for testing */
  testID?: string;
  /** Custom liquid colors (optional) */
  liquidColors?: string[];
  /** Enable blur effect for extra fluidity */
  enableBlur?: boolean;
  /** Whether to show the liquid effect */
  showLiquidEffect?: boolean;
}

/**
 * ChipPileWithRipple - ChipPile with integrated liquid ether effect
 *
 * Drop-in replacement for ChipPile that automatically triggers
 * liquid ripples when chips land.
 *
 * Usage:
 * ```tsx
 * <ChipPileWithRipple
 *   chips={placedChips}
 *   totalBet={totalBet}
 *   showLiquidEffect={true}
 * />
 * ```
 */
export const ChipPileWithRipple = React.memo(function ChipPileWithRipple({
  chips,
  totalBet,
  showCounter = true,
  testID,
  liquidColors,
  enableBlur = false,
  showLiquidEffect = true,
}: ChipPileWithRippleProps) {
  const { rippleRef, triggerOnChipLand } = useLiquidRipple();

  const handleChipLand = useCallback(
    (chipValue: number) => {
      if (!showLiquidEffect) return;

      // Map chip value to color index
      const colorIndex = CHIP_COLOR_MAP[chipValue] ?? 0;
      triggerOnChipLand(colorIndex);
    },
    [triggerOnChipLand, showLiquidEffect]
  );

  // Import ChipPile dynamically to avoid circular deps
  // Since this file is in the same directory, we use the re-export pattern
  const ChipPile = require('./ChipPile').ChipPile;

  return (
    <View style={wrapperStyles.container}>
      {showLiquidEffect && (
        <LiquidRipple
          ref={rippleRef}
          colors={liquidColors}
          enableBlur={enableBlur}
          style={wrapperStyles.ripple}
        />
      )}
      <ChipPile
        chips={chips}
        totalBet={totalBet}
        showCounter={showCounter}
        testID={testID}
        onChipLand={handleChipLand}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  canvas: {
    flex: 1,
  },
});

const wrapperStyles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  ripple: {
    position: 'absolute',
    top: -40,
    left: -40,
    right: -40,
    bottom: -40,
  },
});

export default LiquidRipple;
