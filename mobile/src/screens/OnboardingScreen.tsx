/**
 * Onboarding Screen - First-time user welcome experience
 *
 * Features:
 * - Animated dealer avatar introduction
 * - 3-4 teaser animations showcasing core games
 * - Staggered button reveals (Start Playing, Learn More)
 * - Pre-game ceremony: dealer animation, chip stack reveal
 *
 * US-124: First-time user onboarding sequence
 */
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { useCallback, useState, useEffect } from 'react';
import Animated, {
  FadeIn,
  FadeInUp,
  FadeInDown,
  SlideInRight,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  withSpring,
  Easing,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, GAME_COLORS } from '../constants/theme';
import { GameIcon } from '../components/ui';
import { haptics } from '../services/haptics';
import { markOnboardingCompleted } from '../services';
import type { OnboardingScreenProps } from '../navigation/types';
import type { GameId } from '../types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Featured games to showcase in the onboarding carousel
const FEATURED_GAMES: { id: GameId; name: string; tagline: string; color: string }[] = [
  { id: 'blackjack', name: 'Blackjack', tagline: 'Beat the dealer to 21', color: GAME_COLORS.blackjack },
  { id: 'roulette', name: 'Roulette', tagline: 'Spin the wheel of fortune', color: GAME_COLORS.roulette },
  { id: 'video_poker', name: 'Video Poker', tagline: 'Jacks or Better', color: GAME_COLORS.video_poker },
  { id: 'hi_lo', name: 'Hi-Lo', tagline: 'Higher or lower?', color: GAME_COLORS.hi_lo },
];

/**
 * Dealer Avatar - Animated casino dealer representation
 * Uses simple geometric shapes to create a friendly dealer character
 */
function DealerAvatar() {
  const breathe = useSharedValue(0);
  const wave = useSharedValue(0);

  useEffect(() => {
    // Gentle breathing animation
    breathe.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    // Welcome wave on mount
    wave.value = withSequence(
      withDelay(500, withSpring(1, { damping: 8, stiffness: 80 })),
      withDelay(800, withSpring(0, { damping: 12 }))
    );
  }, [breathe, wave]);

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: interpolate(breathe.value, [0, 1], [1, 1.02]) }],
  }));

  const armStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(wave.value, [0, 1], [0, -25])}deg` }],
  }));

  return (
    <View style={styles.dealerContainer}>
      {/* Dealer body */}
      <Animated.View style={[styles.dealerBody, bodyStyle]}>
        {/* Vest */}
        <View style={styles.dealerVest} />
        {/* Shirt */}
        <View style={styles.dealerShirt} />
        {/* Bow tie */}
        <View style={styles.dealerBowTie}>
          <View style={styles.bowTieLeft} />
          <View style={styles.bowTieCenter} />
          <View style={styles.bowTieRight} />
        </View>
      </Animated.View>

      {/* Dealer head */}
      <View style={styles.dealerHead}>
        {/* Face */}
        <View style={styles.dealerFace}>
          {/* Eyes */}
          <View style={styles.dealerEyeContainer}>
            <View style={styles.dealerEye}>
              <View style={styles.dealerPupil} />
            </View>
            <View style={styles.dealerEye}>
              <View style={styles.dealerPupil} />
            </View>
          </View>
          {/* Friendly smile */}
          <View style={styles.dealerSmile} />
        </View>
        {/* Hair/Hat */}
        <View style={styles.dealerHat} />
      </View>

      {/* Waving arm */}
      <Animated.View style={[styles.dealerArm, armStyle]}>
        <View style={styles.dealerHand} />
      </Animated.View>
    </View>
  );
}

/**
 * Chip Stack - Animated chip pile reveal
 */
function ChipStackReveal() {
  const chips = [
    { color: COLORS.primary, delay: 0 },
    { color: COLORS.success, delay: 100 },
    { color: COLORS.warning, delay: 200 },
    { color: '#E74C3C', delay: 300 },
    { color: '#9B59B6', delay: 400 },
  ];

  return (
    <View style={styles.chipStackContainer}>
      {chips.map((chip, index) => (
        <Animated.View
          key={index}
          entering={FadeInUp.delay(chip.delay + 800).springify().damping(12)}
          style={[
            styles.chip,
            {
              backgroundColor: chip.color,
              bottom: index * 6,
              transform: [{ rotate: `${(index - 2) * 3}deg` }],
            },
          ]}
        >
          <View style={styles.chipInner} />
          <View style={styles.chipRing} />
        </Animated.View>
      ))}
    </View>
  );
}

/**
 * Game Teaser Card - Showcases a single game with icon and tagline
 */
function GameTeaserCard({
  game,
  index,
  isActive,
}: {
  game: typeof FEATURED_GAMES[0];
  index: number;
  isActive: boolean;
}) {
  const scale = useSharedValue(1);
  const glow = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      scale.value = withSpring(1.05, { damping: 15, stiffness: 150 });
      glow.value = withRepeat(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      scale.value = withSpring(0.95, { damping: 15, stiffness: 150 });
      glow.value = withTiming(0);
    }
  }, [isActive, scale, glow]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: interpolate(scale.value, [0.95, 1.05], [0.7, 1]),
  }));

  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(glow.value, [0, 1], [0.2, 0.5]),
    shadowRadius: interpolate(glow.value, [0, 1], [4, 12]),
  }));

  return (
    <Animated.View
      entering={SlideInRight.delay(index * 150 + 400).springify().damping(14)}
      style={[styles.teaserCard, cardStyle]}
    >
      <Animated.View
        style={[
          styles.teaserCardInner,
          { borderColor: game.color + '40' },
          glowStyle,
          { shadowColor: game.color },
        ]}
      >
        <View style={[styles.teaserIconContainer, { backgroundColor: game.color + '20' }]}>
          <GameIcon gameId={game.id} color={game.color} size={32} />
        </View>
        <Text style={styles.teaserGameName}>{game.name}</Text>
        <Text style={styles.teaserTagline}>{game.tagline}</Text>
      </Animated.View>
    </Animated.View>
  );
}

export function OnboardingScreen({ navigation }: OnboardingScreenProps) {
  const [activeGameIndex, setActiveGameIndex] = useState(0);
  const [showButtons, setShowButtons] = useState(false);

  // Auto-cycle through featured games
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveGameIndex((prev) => (prev + 1) % FEATURED_GAMES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  // Reveal buttons after initial animations
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowButtons(true);
      haptics.roundStart();
    }, 1800);
    return () => clearTimeout(timer);
  }, []);

  const handleStartPlaying = useCallback(() => {
    haptics.jackpot();
    markOnboardingCompleted();
    navigation.replace('Lobby');
  }, [navigation]);

  const handleLearnMore = useCallback(() => {
    haptics.buttonPress();
    // For now, just go to lobby - could link to tutorial or help in future
    markOnboardingCompleted();
    navigation.replace('Lobby');
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* Welcome header with dealer */}
      <Animated.View entering={FadeIn.duration(800)} style={styles.headerSection}>
        <DealerAvatar />
        <Animated.Text
          entering={FadeInDown.delay(200).springify()}
          style={styles.welcomeTitle}
        >
          Welcome to Nullspace
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(400).springify()}
          style={styles.welcomeSubtitle}
        >
          Provably fair casino on the blockchain
        </Animated.Text>
      </Animated.View>

      {/* Game teasers carousel */}
      <View style={styles.teaserSection}>
        <Animated.Text
          entering={FadeIn.delay(600)}
          style={styles.sectionLabel}
        >
          Featured Games
        </Animated.Text>
        <View style={styles.teaserCarousel}>
          {FEATURED_GAMES.map((game, index) => (
            <GameTeaserCard
              key={game.id}
              game={game}
              index={index}
              isActive={index === activeGameIndex}
            />
          ))}
        </View>
        {/* Carousel dots */}
        <View style={styles.carouselDots}>
          {FEATURED_GAMES.map((_, index) => (
            <Animated.View
              key={index}
              entering={FadeIn.delay(800 + index * 50)}
              style={[
                styles.carouselDot,
                index === activeGameIndex && styles.carouselDotActive,
              ]}
            />
          ))}
        </View>
      </View>

      {/* Chip stack reveal */}
      <ChipStackReveal />

      {/* Staggered button reveals */}
      {showButtons && (
        <Animated.View entering={FadeInUp.springify().damping(12)} style={styles.buttonSection}>
          <Animated.View entering={FadeInUp.delay(100).springify()}>
            <Pressable
              onPress={handleStartPlaying}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>Start Playing</Text>
            </Pressable>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(200).springify()}>
            <Pressable
              onPress={handleLearnMore}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>Learn More</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      )}

      {/* Provably fair badge */}
      <Animated.View entering={FadeIn.delay(2000)} style={styles.footer}>
        <View style={styles.provablyFairBadge}>
          <View style={styles.checkmark}>
            <View style={styles.checkmarkShort} />
            <View style={styles.checkmarkLong} />
          </View>
          <Text style={styles.provablyFairText}>Provably Fair</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: 60,
    alignItems: 'center',
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  welcomeTitle: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.displayLarge,
    marginTop: SPACING.lg,
    textAlign: 'center',
  },
  welcomeSubtitle: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.body,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },

  // Dealer Avatar styles
  dealerContainer: {
    width: 100,
    height: 120,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  dealerHead: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
  },
  dealerFace: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F5DEB3', // Wheat skin tone
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#DEB887',
  },
  dealerEyeContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  dealerEye: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dealerPupil: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#2C3E50',
  },
  dealerSmile: {
    width: 16,
    height: 8,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderWidth: 2,
    borderTopWidth: 0,
    borderColor: '#8B4513',
    marginTop: 2,
  },
  dealerHat: {
    position: 'absolute',
    top: -8,
    width: 54,
    height: 12,
    backgroundColor: '#1A1A2E',
    borderRadius: 4,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  dealerBody: {
    width: 80,
    height: 60,
    alignItems: 'center',
    position: 'absolute',
    bottom: 0,
  },
  dealerVest: {
    width: 60,
    height: 50,
    backgroundColor: '#1A1A2E',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  dealerShirt: {
    position: 'absolute',
    top: 0,
    width: 30,
    height: 45,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  dealerBowTie: {
    position: 'absolute',
    top: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bowTieLeft: {
    width: 10,
    height: 8,
    backgroundColor: COLORS.primary,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
    transform: [{ skewY: '10deg' }],
  },
  bowTieCenter: {
    width: 6,
    height: 6,
    backgroundColor: COLORS.primary,
    borderRadius: 3,
    marginHorizontal: -2,
    zIndex: 1,
  },
  bowTieRight: {
    width: 10,
    height: 8,
    backgroundColor: COLORS.primary,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    transform: [{ skewY: '-10deg' }],
  },
  dealerArm: {
    position: 'absolute',
    right: -10,
    bottom: 20,
    transformOrigin: 'bottom center',
  },
  dealerHand: {
    width: 16,
    height: 20,
    backgroundColor: '#F5DEB3',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DEB887',
  },

  // Teaser section styles
  teaserSection: {
    width: '100%',
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.xl,
  },
  sectionLabel: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  teaserCarousel: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  teaserCard: {
    width: (SCREEN_WIDTH - SPACING.lg * 2 - SPACING.sm) / 2,
  },
  teaserCardInner: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 2 },
  },
  teaserIconContainer: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
  },
  teaserGameName: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.h3,
    marginBottom: 2,
  },
  teaserTagline: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
    textAlign: 'center',
  },
  carouselDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  carouselDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.border,
  },
  carouselDotActive: {
    backgroundColor: COLORS.primary,
    width: 18,
  },

  // Chip stack styles
  chipStackContainer: {
    width: 80,
    height: 50,
    marginBottom: SPACING.xl,
    alignItems: 'center',
  },
  chip: {
    position: 'absolute',
    width: 48,
    height: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipInner: {
    width: 24,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
  },
  chipRing: {
    position: 'absolute',
    width: 40,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },

  // Button styles
  buttonSection: {
    width: '100%',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    ...TYPOGRAPHY.label,
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  secondaryButtonText: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.label,
    fontSize: 16,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },

  // Footer styles
  footer: {
    position: 'absolute',
    bottom: 40,
  },
  provablyFairBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.success + '40',
  },
  checkmark: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkShort: {
    position: 'absolute',
    width: 2,
    height: 6,
    backgroundColor: COLORS.success,
    transform: [{ rotate: '-45deg' }, { translateX: -3 }, { translateY: 1 }],
    borderRadius: 1,
  },
  checkmarkLong: {
    position: 'absolute',
    width: 2,
    height: 10,
    backgroundColor: COLORS.success,
    transform: [{ rotate: '45deg' }, { translateX: 2 }, { translateY: -1 }],
    borderRadius: 1,
  },
  provablyFairText: {
    color: COLORS.success,
    ...TYPOGRAPHY.caption,
  },
});
