/**
 * TiltableCard - 3D parallax card wrapper component (DS-055)
 *
 * Wraps any card component with interactive 3D tilt effect.
 * Touch and drag to rotate card in 3D space with physics-based motion.
 *
 * Features:
 * - Touch-based 3D rotation tracking
 * - Spring physics for organic tilt/return
 * - Configurable rotation amplitude and scale
 * - Works with Card, HiddenCard, or any child component
 * - Optional shine/reflection overlay for premium feel
 *
 * @example
 * <TiltableCard rotateAmplitude={12} scaleOnTouch={1.08}>
 *   <Card suit="hearts" rank="A" faceUp={true} />
 * </TiltableCard>
 */
import React, { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { useParallaxTilt, ParallaxTiltOptions } from '../../hooks/useParallaxTilt';

export interface TiltableCardProps extends ParallaxTiltOptions {
  /** Card or content to make tiltable */
  children: ReactNode;
  /** Show shine/reflection overlay that moves with tilt */
  showShine?: boolean;
  /** Test ID for testing */
  testID?: string;
}

/**
 * Shine overlay that creates premium glass-like reflection effect
 * Uses a simple gradient simulation via opacity layers
 */
const ShineOverlay = React.memo(function ShineOverlay() {
  return (
    <View style={styles.shineOverlay} pointerEvents="none">
      <View style={styles.shineHighlight} />
    </View>
  );
});

/**
 * TiltableCard - Adds 3D parallax tilt to any card component
 *
 * Usage:
 * ```tsx
 * // Basic usage
 * <TiltableCard>
 *   <Card suit="spades" rank="K" faceUp={true} />
 * </TiltableCard>
 *
 * // With custom settings
 * <TiltableCard
 *   rotateAmplitude={16}
 *   scaleOnTouch={1.1}
 *   showShine={true}
 * >
 *   <Card suit="hearts" rank="A" faceUp={true} />
 * </TiltableCard>
 *
 * // Disabled (for dealing animation)
 * <TiltableCard enabled={false}>
 *   <Card ... />
 * </TiltableCard>
 * ```
 */
export function TiltableCard({
  children,
  showShine = false,
  testID,
  ...tiltOptions
}: TiltableCardProps) {
  const { animatedStyle, gesture, onLayout } = useParallaxTilt(tiltOptions);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.container, animatedStyle]}
        onLayout={onLayout}
        testID={testID}
      >
        {children}
        {showShine && <ShineOverlay />}
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * HOC to wrap existing card components with tilt functionality
 * Useful for wrapping Card or HiddenCard directly
 */
export function withParallaxTilt<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  defaultTiltOptions?: ParallaxTiltOptions
) {
  return function TiltableWrappedComponent(props: P & Partial<TiltableCardProps>) {
    const { showShine, enabled, rotateAmplitude, scaleOnTouch, ...cardProps } = props;

    return (
      <TiltableCard
        showShine={showShine}
        enabled={enabled ?? defaultTiltOptions?.enabled}
        rotateAmplitude={rotateAmplitude ?? defaultTiltOptions?.rotateAmplitude}
        scaleOnTouch={scaleOnTouch ?? defaultTiltOptions?.scaleOnTouch}
      >
        <WrappedComponent {...(cardProps as P)} />
      </TiltableCard>
    );
  };
}

const styles = StyleSheet.create({
  container: {
    // Note: React Native doesn't support preserve-3d, but
    // the perspective transform on animated style handles depth
  },
  shineOverlay: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    borderRadius: 8,
  },
  shineHighlight: {
    position: 'absolute',
    top: -20,
    left: -20,
    width: 60,
    height: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 30,
    // Blur effect simulation
    opacity: 0.4,
  },
});

export default TiltableCard;
