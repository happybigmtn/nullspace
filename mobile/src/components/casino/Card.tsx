/**
 * Playing card component with flip animation
 *
 * Premium design features:
 * - Linen texture on card face for tactile realism
 * - Multi-layered shadows (contact + diffuse) for depth
 * - Gold/silver metallic rim on card edges
 * - Damask-inspired geometric pattern on card back
 * - Scale pop at flip midpoint for weight perception
 */
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  interpolate,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { haptics } from '../../services/haptics';
import { COLORS, RADIUS, SPRING } from '../../constants/theme';
import type { Suit, Rank } from '../../types';

interface CardProps {
  suit: Suit;
  rank: Rank;
  faceUp: boolean;
  size?: 'small' | 'normal' | 'large';
  onFlipComplete?: () => void;
}

const SUIT_SYMBOLS: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const SUIT_COLORS: Record<Suit, string> = {
  hearts: COLORS.suitRed,
  diamonds: COLORS.suitRed,
  clubs: COLORS.suitBlack,
  spades: COLORS.suitBlack,
};

const SIZE_STYLES = {
  small: { width: 56, height: 84 },
  normal: { width: 80, height: 120 },
  large: { width: 100, height: 150 },
} as const;

/**
 * Premium card colors
 * Gold rim for light suits (diamonds, hearts), silver for dark (spades, clubs)
 */
const CARD_PREMIUM = {
  /** Linen texture base - subtle off-white */
  linenBase: '#FAFAF8',
  /** Linen texture overlay lines */
  linenLine: 'rgba(0, 0, 0, 0.02)',
  /** Gold rim for red suits */
  rimGold: '#D4AF37',
  /** Silver rim for black suits */
  rimSilver: '#C0C0C0',
  /** Card back primary - deep casino blue */
  backPrimary: '#0F1E4A',
  /** Card back secondary - accent blue */
  backSecondary: '#1E3A7B',
  /** Card back pattern - gold thread */
  backPattern: '#B8860B',
  /** Card back pattern border */
  backPatternBorder: 'rgba(184, 134, 11, 0.4)',
} as const;

interface CardFaceProps {
  suit: Suit;
  rank: Rank;
  size: 'small' | 'normal' | 'large';
}

/**
 * Linen texture overlay - creates subtle woven pattern
 * Uses semi-transparent lines at 45° angles
 */
const LinenTexture = React.memo(function LinenTexture() {
  return (
    <View style={styles.linenTexture} pointerEvents="none">
      {/* Horizontal lines */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((i) => (
        <View
          key={`h${i}`}
          style={[
            styles.linenLineH,
            { top: `${i * 7}%` },
          ]}
        />
      ))}
      {/* Vertical lines */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
        <View
          key={`v${i}`}
          style={[
            styles.linenLineV,
            { left: `${i * 11}%` },
          ]}
        />
      ))}
    </View>
  );
});

const CardFace = React.memo(function CardFace({ suit, rank, size }: CardFaceProps) {
  const sizeMultiplier = size === 'small' ? 0.7 : size === 'large' ? 1.3 : 1;
  const color = SUIT_COLORS[suit];
  const isRedSuit = suit === 'hearts' || suit === 'diamonds';
  const rimColor = isRedSuit ? CARD_PREMIUM.rimGold : CARD_PREMIUM.rimSilver;

  return (
    <View style={[styles.cardFace, styles.cardFacePremium]}>
      {/* Linen texture background */}
      <LinenTexture />
      {/* Metallic rim - 1px border with gold/silver */}
      <View style={[styles.metallicRim, { borderColor: rimColor }]} />
      {/* Card content */}
      <Text
        style={[
          styles.rank,
          { color, fontSize: 24 * sizeMultiplier },
        ]}
      >
        {rank}
      </Text>
      <Text
        style={[
          styles.suit,
          { color, fontSize: 32 * sizeMultiplier },
        ]}
      >
        {SUIT_SYMBOLS[suit]}
      </Text>
    </View>
  );
});

/**
 * Premium card back with damask-inspired geometric pattern
 * Creates a casino-quality repeating diamond lattice design
 */
const CardBack = React.memo(function CardBack() {
  return (
    <View style={[styles.cardFace, styles.cardBackPremium]}>
      {/* Outer border - gold thread */}
      <View style={styles.backBorderOuter}>
        {/* Inner border */}
        <View style={styles.backBorderInner}>
          {/* Central pattern area */}
          <View style={styles.backPatternArea}>
            {/* Diamond lattice pattern - 3x5 grid */}
            {[0, 1, 2, 3, 4].map((row) => (
              <View key={row} style={styles.backPatternRow}>
                {[0, 1, 2].map((col) => (
                  <View key={`${row}-${col}`} style={styles.backDiamond}>
                    <View style={styles.backDiamondInner} />
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>
      </View>
      {/* Corner flourishes */}
      <View style={[styles.cornerFlourish, styles.cornerTL]} />
      <View style={[styles.cornerFlourish, styles.cornerTR]} />
      <View style={[styles.cornerFlourish, styles.cornerBL]} />
      <View style={[styles.cornerFlourish, styles.cornerBR]} />
    </View>
  );
});

export function Card({
  suit,
  rank,
  faceUp,
  size = 'normal',
  onFlipComplete,
}: CardProps) {
  const flip = useSharedValue(faceUp ? 180 : 0);
  const scale = useSharedValue(1);

  // Use ref to avoid re-triggering effect when callback identity changes
  const onFlipCompleteRef = useRef(onFlipComplete);
  onFlipCompleteRef.current = onFlipComplete;

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return;

    // Scale pop animation - peaks at flip midpoint for weight perception
    scale.value = withSequence(
      withTiming(1.05, { duration: 150, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 150, easing: Easing.in(Easing.quad) })
    );

    flip.value = withSpring(
      faceUp ? 180 : 0,
      SPRING.cardFlip,
      (finished) => {
        'worklet';
        if (finished && faceUp) {
          runOnJS(() => haptics.cardDeal())();
          runOnJS(() => {
            onFlipCompleteRef.current?.();
          })();
        }
      }
    );
  }, [faceUp, flip, scale]);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1000 },
      { rotateY: `${flip.value}deg` },
      { scale: scale.value },
    ],
    backfaceVisibility: 'hidden',
    opacity: flip.value > 90 ? 1 : 0,
  }));

  const backStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1000 },
      { rotateY: `${flip.value - 180}deg` },
      { scale: scale.value },
    ],
    backfaceVisibility: 'hidden',
    position: 'absolute',
    opacity: flip.value < 90 ? 1 : 0,
  }));

  const cardSize = SIZE_STYLES[size];

  return (
    <View style={[styles.cardContainer, cardSize]}>
      {/* Diffuse shadow layer (spread, soft) */}
      <View style={[styles.shadowDiffuse, cardSize]} />
      {/* Contact shadow layer (tight, dark) */}
      <View style={[styles.shadowContact, cardSize]} />
      <Animated.View style={[styles.card, cardSize, frontStyle]}>
        <CardFace suit={suit} rank={rank} size={size} />
      </Animated.View>
      <Animated.View style={[styles.card, cardSize, backStyle]}>
        <CardBack />
      </Animated.View>
    </View>
  );
}

/**
 * Hidden card placeholder with premium back design
 */
export function HiddenCard({ size = 'normal' }: { size?: 'small' | 'normal' | 'large' }) {
  const cardSize = SIZE_STYLES[size];
  return (
    <View style={[styles.cardContainer, cardSize]}>
      {/* Diffuse shadow layer */}
      <View style={[styles.shadowDiffuse, cardSize]} />
      {/* Contact shadow layer */}
      <View style={[styles.shadowContact, cardSize]} />
      <View style={[styles.card, cardSize]}>
        <CardBack />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    position: 'relative',
  },
  card: {
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  // Multi-layered shadows for depth perception
  shadowDiffuse: {
    position: 'absolute',
    borderRadius: RADIUS.md,
    backgroundColor: 'transparent',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  shadowContact: {
    position: 'absolute',
    borderRadius: RADIUS.md,
    backgroundColor: 'transparent',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  cardFace: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  // Premium card face with linen texture background
  cardFacePremium: {
    backgroundColor: CARD_PREMIUM.linenBase,
    overflow: 'hidden',
  },
  // Linen texture overlay
  linenTexture: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  linenLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: CARD_PREMIUM.linenLine,
  },
  linenLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: CARD_PREMIUM.linenLine,
  },
  // Metallic rim overlay
  metallicRim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADIUS.md - 1,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  // Premium card back styles
  cardBackPremium: {
    backgroundColor: CARD_PREMIUM.backPrimary,
    borderWidth: 0,
    padding: 4,
  },
  backBorderOuter: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: CARD_PREMIUM.backPattern,
    borderRadius: RADIUS.sm,
    padding: 3,
  },
  backBorderInner: {
    flex: 1,
    borderWidth: 1,
    borderColor: CARD_PREMIUM.backPatternBorder,
    borderRadius: RADIUS.sm - 2,
    overflow: 'hidden',
  },
  backPatternArea: {
    flex: 1,
    backgroundColor: CARD_PREMIUM.backSecondary,
    justifyContent: 'space-evenly',
    alignItems: 'center',
    padding: 2,
  },
  backPatternRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    width: '100%',
  },
  backDiamond: {
    width: 12,
    height: 12,
    transform: [{ rotate: '45deg' }],
    borderWidth: 1,
    borderColor: CARD_PREMIUM.backPatternBorder,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  backDiamondInner: {
    width: 4,
    height: 4,
    backgroundColor: CARD_PREMIUM.backPattern,
    transform: [{ rotate: '0deg' }],
  },
  // Corner flourishes
  cornerFlourish: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderColor: CARD_PREMIUM.backPattern,
  },
  cornerTL: {
    top: 6,
    left: 6,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderTopLeftRadius: 4,
  },
  cornerTR: {
    top: 6,
    right: 6,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderTopRightRadius: 4,
  },
  cornerBL: {
    bottom: 6,
    left: 6,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderBottomLeftRadius: 4,
  },
  cornerBR: {
    bottom: 6,
    right: 6,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomRightRadius: 4,
  },
  rank: {
    fontWeight: 'bold',
    zIndex: 1,
  },
  suit: {
    marginTop: -4,
    zIndex: 1,
  },
});
