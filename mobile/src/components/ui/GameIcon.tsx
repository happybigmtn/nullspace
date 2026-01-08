/**
 * GameIcon - Monochrome icon set for all casino games
 *
 * Design principles:
 * - Consistent 2px stroke weight across all icons
 * - 24x24 default viewport (scales proportionally)
 * - Single color fills for light/dark mode compatibility
 * - Pure React Native Views - no SVG dependency required
 *
 * Icons are designed to convey game essence at small sizes
 * while maintaining visual hierarchy in the lobby grid.
 */
import { View, StyleSheet } from 'react-native';
import type { GameId } from '../../types';
import { COLORS } from '../../constants/theme';

interface GameIconProps {
  /** Game identifier determines which icon to render */
  gameId: GameId;
  /** Icon color - defaults to textPrimary for universal use */
  color?: string;
  /** Icon size in dp - icons scale proportionally */
  size?: number;
}

/**
 * Renders a game-specific icon using pure React Native Views
 * All icons use consistent 2dp stroke weight scaled to size
 */
export function GameIcon({ gameId, color = COLORS.textPrimary, size = 24 }: GameIconProps) {
  const scale = size / 24;
  const stroke = 2 * scale;

  switch (gameId) {
    case 'hi_lo':
      return <DiceIcon color={color} scale={scale} stroke={stroke} />;
    case 'blackjack':
      return <CardsIcon color={color} scale={scale} stroke={stroke} />;
    case 'roulette':
      return <WheelIcon color={color} scale={scale} stroke={stroke} />;
    case 'craps':
      return <DicePairIcon color={color} scale={scale} stroke={stroke} />;
    case 'baccarat':
      return <CrownIcon color={color} scale={scale} stroke={stroke} />;
    case 'casino_war':
      return <SwordsIcon color={color} scale={scale} stroke={stroke} />;
    case 'video_poker':
      return <SlotsIcon color={color} scale={scale} stroke={stroke} />;
    case 'sic_bo':
      return <ThreeDiceIcon color={color} scale={scale} stroke={stroke} />;
    case 'three_card_poker':
      return <TripleCardIcon color={color} scale={scale} stroke={stroke} />;
    case 'ultimate_texas_holdem':
      return <ChipStackIcon color={color} scale={scale} stroke={stroke} />;
    default:
      return <DefaultIcon color={color} scale={scale} stroke={stroke} />;
  }
}

interface IconComponentProps {
  color: string;
  scale: number;
  stroke: number;
}

/** Hi-Lo: Single die showing pip pattern */
function DiceIcon({ color, scale, stroke }: IconComponentProps) {
  const boxSize = 20 * scale;
  const pipSize = 3 * scale;
  const offset = 4 * scale;

  return (
    <View style={[styles.iconContainer, { width: 24 * scale, height: 24 * scale }]}>
      <View
        style={[
          styles.diceBox,
          {
            width: boxSize,
            height: boxSize,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: 3 * scale,
          },
        ]}
      >
        {/* 5-pip pattern */}
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, top: offset, left: offset }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, top: offset, right: offset }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, top: '50%', left: '50%', transform: [{ translateX: -pipSize / 2 }, { translateY: -pipSize / 2 }] }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, bottom: offset, left: offset }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, bottom: offset, right: offset }]} />
      </View>
    </View>
  );
}

/** Blackjack: Two overlapping playing cards */
function CardsIcon({ color, scale, stroke }: IconComponentProps) {
  const cardW = 12 * scale;
  const cardH = 16 * scale;

  return (
    <View style={[styles.iconContainer, { width: 24 * scale, height: 24 * scale }]}>
      {/* Back card */}
      <View
        style={[
          styles.card,
          {
            width: cardW,
            height: cardH,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: 2 * scale,
            position: 'absolute',
            top: 2 * scale,
            left: 4 * scale,
            transform: [{ rotate: '-10deg' }],
          },
        ]}
      />
      {/* Front card */}
      <View
        style={[
          styles.card,
          {
            width: cardW,
            height: cardH,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: 2 * scale,
            position: 'absolute',
            top: 4 * scale,
            right: 4 * scale,
            transform: [{ rotate: '10deg' }],
          },
        ]}
      >
        {/* Spade symbol approximation */}
        <View style={[styles.cardSymbol, { borderColor: color, borderWidth: stroke * 0.75, transform: [{ rotate: '180deg' }] }]} />
      </View>
    </View>
  );
}

/** Roulette: Wheel with segments */
function WheelIcon({ color, scale, stroke }: IconComponentProps) {
  const outerSize = 20 * scale;
  const innerSize = 8 * scale;

  return (
    <View style={[styles.iconContainer, { width: 24 * scale, height: 24 * scale }]}>
      {/* Outer wheel */}
      <View
        style={{
          width: outerSize,
          height: outerSize,
          borderRadius: outerSize / 2,
          borderWidth: stroke,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Inner hub */}
        <View
          style={{
            width: innerSize,
            height: innerSize,
            borderRadius: innerSize / 2,
            borderWidth: stroke,
            borderColor: color,
          }}
        />
        {/* Spokes */}
        <View style={[styles.spoke, { backgroundColor: color, height: stroke, width: outerSize / 2 - innerSize / 2, position: 'absolute', left: outerSize / 2 }]} />
        <View style={[styles.spoke, { backgroundColor: color, height: stroke, width: outerSize / 2 - innerSize / 2, position: 'absolute', right: outerSize / 2 }]} />
        <View style={[styles.spoke, { backgroundColor: color, width: stroke, height: outerSize / 2 - innerSize / 2, position: 'absolute', top: outerSize / 2 }]} />
        <View style={[styles.spoke, { backgroundColor: color, width: stroke, height: outerSize / 2 - innerSize / 2, position: 'absolute', bottom: outerSize / 2 }]} />
      </View>
    </View>
  );
}

/** Craps: Two dice side by side */
function DicePairIcon({ color, scale, stroke }: IconComponentProps) {
  const boxSize = 10 * scale;
  const pipSize = 2 * scale;

  return (
    <View style={[styles.iconContainer, { width: 24 * scale, height: 24 * scale, flexDirection: 'row', gap: 2 * scale }]}>
      {/* Die 1 - showing 3 */}
      <View style={[styles.diceBox, { width: boxSize, height: boxSize, borderWidth: stroke, borderColor: color, borderRadius: 2 * scale }]}>
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, top: 1.5 * scale, left: 1.5 * scale }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, top: '50%', left: '50%', transform: [{ translateX: -pipSize / 2 }, { translateY: -pipSize / 2 }] }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, bottom: 1.5 * scale, right: 1.5 * scale }]} />
      </View>
      {/* Die 2 - showing 4 */}
      <View style={[styles.diceBox, { width: boxSize, height: boxSize, borderWidth: stroke, borderColor: color, borderRadius: 2 * scale }]}>
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, top: 1.5 * scale, left: 1.5 * scale }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, top: 1.5 * scale, right: 1.5 * scale }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, bottom: 1.5 * scale, left: 1.5 * scale }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, bottom: 1.5 * scale, right: 1.5 * scale }]} />
      </View>
    </View>
  );
}

/** Baccarat: Crown symbol */
function CrownIcon({ color, scale, stroke }: IconComponentProps) {
  const width = 20 * scale;
  const height = 14 * scale;

  return (
    <View style={[styles.iconContainer, { width: 24 * scale, height: 24 * scale }]}>
      <View style={{ width, height, position: 'relative' }}>
        {/* Crown base */}
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 4 * scale,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: 1 * scale,
          }}
        />
        {/* Crown points - 3 triangles */}
        <View style={[styles.crownPoint, { left: 0, borderBottomColor: color, borderLeftWidth: 3 * scale, borderRightWidth: 3 * scale, borderBottomWidth: 8 * scale }]} />
        <View style={[styles.crownPoint, { left: width / 2 - 3 * scale, borderBottomColor: color, borderLeftWidth: 3 * scale, borderRightWidth: 3 * scale, borderBottomWidth: 10 * scale, bottom: 4 * scale }]} />
        <View style={[styles.crownPoint, { right: 0, borderBottomColor: color, borderLeftWidth: 3 * scale, borderRightWidth: 3 * scale, borderBottomWidth: 8 * scale }]} />
        {/* Crown gems (circles) */}
        <View style={[styles.crownGem, { backgroundColor: color, width: 2 * scale, height: 2 * scale, bottom: 1 * scale, left: 3 * scale }]} />
        <View style={[styles.crownGem, { backgroundColor: color, width: 2 * scale, height: 2 * scale, bottom: 1 * scale, left: width / 2 - 1 * scale }]} />
        <View style={[styles.crownGem, { backgroundColor: color, width: 2 * scale, height: 2 * scale, bottom: 1 * scale, right: 3 * scale }]} />
      </View>
    </View>
  );
}

/** Casino War: Crossed swords */
function SwordsIcon({ color, scale, stroke }: IconComponentProps) {
  return (
    <View style={[styles.iconContainer, { width: 24 * scale, height: 24 * scale }]}>
      {/* Sword 1 - diagonal */}
      <View
        style={{
          position: 'absolute',
          width: stroke,
          height: 20 * scale,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      {/* Sword 1 hilt */}
      <View
        style={{
          position: 'absolute',
          width: 6 * scale,
          height: stroke,
          backgroundColor: color,
          bottom: 4 * scale,
          left: 4 * scale,
          transform: [{ rotate: '45deg' }],
        }}
      />
      {/* Sword 2 - diagonal opposite */}
      <View
        style={{
          position: 'absolute',
          width: stroke,
          height: 20 * scale,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
        }}
      />
      {/* Sword 2 hilt */}
      <View
        style={{
          position: 'absolute',
          width: 6 * scale,
          height: stroke,
          backgroundColor: color,
          bottom: 4 * scale,
          right: 4 * scale,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  );
}

/** Video Poker: Slot machine reels */
function SlotsIcon({ color, scale, stroke }: IconComponentProps) {
  const reelW = 5 * scale;
  const reelH = 16 * scale;
  const gap = 2 * scale;

  return (
    <View style={[styles.iconContainer, { width: 24 * scale, height: 24 * scale }]}>
      {/* Machine frame */}
      <View
        style={{
          width: 20 * scale,
          height: 18 * scale,
          borderWidth: stroke,
          borderColor: color,
          borderRadius: 2 * scale,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap,
        }}
      >
        {/* 3 reels */}
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: reelW,
              height: reelH - 4 * scale,
              borderWidth: stroke * 0.75,
              borderColor: color,
              borderRadius: 1 * scale,
            }}
          />
        ))}
      </View>
      {/* Lever */}
      <View
        style={{
          position: 'absolute',
          right: 0,
          top: 4 * scale,
          width: stroke,
          height: 8 * scale,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: -1 * scale,
          top: 3 * scale,
          width: 4 * scale,
          height: 4 * scale,
          borderRadius: 2 * scale,
          borderWidth: stroke,
          borderColor: color,
        }}
      />
    </View>
  );
}

/** Sic Bo: Three stacked dice */
function ThreeDiceIcon({ color, scale, stroke }: IconComponentProps) {
  const boxSize = 8 * scale;
  const pipSize = 1.5 * scale;

  return (
    <View style={[styles.iconContainer, { width: 24 * scale, height: 24 * scale }]}>
      {/* Dice arranged in triangle */}
      {/* Top die */}
      <View
        style={[
          styles.diceBox,
          {
            width: boxSize,
            height: boxSize,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: 1.5 * scale,
            position: 'absolute',
            top: 2 * scale,
            left: '50%',
            transform: [{ translateX: -boxSize / 2 }],
          },
        ]}
      >
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, top: '50%', left: '50%', transform: [{ translateX: -pipSize / 2 }, { translateY: -pipSize / 2 }] }]} />
      </View>
      {/* Bottom left die */}
      <View
        style={[
          styles.diceBox,
          {
            width: boxSize,
            height: boxSize,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: 1.5 * scale,
            position: 'absolute',
            bottom: 2 * scale,
            left: 2 * scale,
          },
        ]}
      >
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, top: 1.5 * scale, left: 1.5 * scale }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, bottom: 1.5 * scale, right: 1.5 * scale }]} />
      </View>
      {/* Bottom right die */}
      <View
        style={[
          styles.diceBox,
          {
            width: boxSize,
            height: boxSize,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: 1.5 * scale,
            position: 'absolute',
            bottom: 2 * scale,
            right: 2 * scale,
          },
        ]}
      >
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, top: 1.5 * scale, left: 1.5 * scale }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, top: 1.5 * scale, right: 1.5 * scale }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, bottom: 1.5 * scale, left: 1.5 * scale }]} />
        <View style={[styles.pip, { width: pipSize, height: pipSize, backgroundColor: color, bottom: 1.5 * scale, right: 1.5 * scale }]} />
      </View>
    </View>
  );
}

/** 3 Card Poker: Three cards fanned */
function TripleCardIcon({ color, scale, stroke }: IconComponentProps) {
  const cardW = 8 * scale;
  const cardH = 12 * scale;

  return (
    <View style={[styles.iconContainer, { width: 24 * scale, height: 24 * scale }]}>
      {/* Left card */}
      <View
        style={[
          styles.card,
          {
            width: cardW,
            height: cardH,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: 1.5 * scale,
            position: 'absolute',
            top: 6 * scale,
            left: 2 * scale,
            transform: [{ rotate: '-15deg' }],
          },
        ]}
      />
      {/* Center card */}
      <View
        style={[
          styles.card,
          {
            width: cardW,
            height: cardH,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: 1.5 * scale,
            position: 'absolute',
            top: 4 * scale,
            left: '50%',
            transform: [{ translateX: -cardW / 2 }],
          },
        ]}
      />
      {/* Right card */}
      <View
        style={[
          styles.card,
          {
            width: cardW,
            height: cardH,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: 1.5 * scale,
            position: 'absolute',
            top: 6 * scale,
            right: 2 * scale,
            transform: [{ rotate: '15deg' }],
          },
        ]}
      />
    </View>
  );
}

/** Ultimate Texas Hold'em: Stacked chips */
function ChipStackIcon({ color, scale, stroke }: IconComponentProps) {
  const chipW = 14 * scale;
  const chipH = 4 * scale;

  return (
    <View style={[styles.iconContainer, { width: 24 * scale, height: 24 * scale }]}>
      {/* Stack of 4 chips */}
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            width: chipW,
            height: chipH,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: chipH / 2,
            bottom: (3 - i) * 3.5 * scale + 2 * scale,
          }}
        />
      ))}
    </View>
  );
}

/** Default: Question mark */
function DefaultIcon({ color, scale, stroke }: IconComponentProps) {
  return (
    <View style={[styles.iconContainer, { width: 24 * scale, height: 24 * scale }]}>
      <View
        style={{
          width: 20 * scale,
          height: 20 * scale,
          borderRadius: 10 * scale,
          borderWidth: stroke,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: stroke * 2,
            height: 8 * scale,
            backgroundColor: color,
            borderRadius: stroke,
            marginTop: -2 * scale,
          }}
        />
        <View
          style={{
            width: stroke * 2,
            height: stroke * 2,
            backgroundColor: color,
            borderRadius: stroke,
            marginTop: 2 * scale,
          }}
        />
      </View>
    </View>
  );
}

/** Profile icon - monochrome user silhouette */
export function ProfileIcon({ color = COLORS.textPrimary, size = 20 }: { color?: string; size?: number }) {
  const scale = size / 20;
  const stroke = 2 * scale;

  return (
    <View style={[styles.iconContainer, { width: 20 * scale, height: 20 * scale }]}>
      {/* Head */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          width: 8 * scale,
          height: 8 * scale,
          borderRadius: 4 * scale,
          borderWidth: stroke,
          borderColor: color,
        }}
      />
      {/* Body/shoulders */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          width: 16 * scale,
          height: 8 * scale,
          borderTopLeftRadius: 8 * scale,
          borderTopRightRadius: 8 * scale,
          borderWidth: stroke,
          borderBottomWidth: 0,
          borderColor: color,
        }}
      />
    </View>
  );
}

/** History icon - clock with hands (US-165) */
export function HistoryIcon({ color = COLORS.textPrimary, size = 20 }: { color?: string; size?: number }) {
  const scale = size / 20;
  const stroke = 2 * scale;
  const outerSize = 18 * scale;

  return (
    <View style={[styles.iconContainer, { width: 20 * scale, height: 20 * scale }]}>
      {/* Clock face */}
      <View
        style={{
          width: outerSize,
          height: outerSize,
          borderRadius: outerSize / 2,
          borderWidth: stroke,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Hour hand */}
        <View
          style={{
            position: 'absolute',
            width: stroke,
            height: 5 * scale,
            backgroundColor: color,
            bottom: outerSize / 2 - stroke / 2,
            borderRadius: stroke / 2,
            transform: [{ rotate: '-45deg' }, { translateY: -2.5 * scale }],
          }}
        />
        {/* Minute hand */}
        <View
          style={{
            position: 'absolute',
            width: stroke,
            height: 7 * scale,
            backgroundColor: color,
            bottom: outerSize / 2 - stroke / 2,
            borderRadius: stroke / 2,
            transform: [{ rotate: '60deg' }, { translateY: -3.5 * scale }],
          }}
        />
        {/* Center dot */}
        <View
          style={{
            width: 3 * scale,
            height: 3 * scale,
            borderRadius: 1.5 * scale,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  diceBox: {
    position: 'relative',
  },
  pip: {
    position: 'absolute',
    borderRadius: 999,
  },
  card: {
    backgroundColor: 'transparent',
  },
  cardSymbol: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 0,
    height: 0,
    borderLeftWidth: 3,
    borderRightWidth: 3,
    borderBottomWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    transform: [{ translateX: -3 }, { translateY: -2.5 }],
  },
  spoke: {},
  crownPoint: {
    position: 'absolute',
    bottom: 4,
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  crownGem: {
    position: 'absolute',
    borderRadius: 999,
  },
});
