/**
 * GamePattern - Monochrome geometric pattern renderer for game differentiation
 *
 * US-263: Game differentiation via texture/geometry instead of color
 *
 * Each game has a unique pattern type and density from GAME_PATTERN tokens:
 * - blackjack: diagonal-stripes (sparse)
 * - roulette: radial-segments (dense)
 * - craps: dot-grid (medium)
 * - baccarat: horizontal-lines (sparse)
 * - videoPoker: vertical-bars (medium)
 * - hiLo: chevron (sparse)
 * - sicBo: honeycomb (dense)
 * - threeCard: triangle-mesh (medium)
 * - ultimateHoldem: crosshatch (sparse)
 * - casinoWar: diagonal-grid (medium)
 *
 * All patterns are monochrome using MONO scale for accessibility.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Canvas, Path, Group, Skia, vec, Circle, Line } from '@shopify/react-native-skia';
import { GAME_PATTERN, MONO, type GamePatternId } from '@nullspace/design-tokens';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * Pattern density to opacity mapping
 * Sparse patterns are more subtle, dense patterns more visible
 */
const DENSITY_OPACITY = {
  sparse: 0.03,
  medium: 0.05,
  dense: 0.07,
} as const;

/**
 * Pattern density to stroke width mapping
 */
const DENSITY_STROKE = {
  sparse: 0.5,
  medium: 1,
  dense: 1.5,
} as const;

/**
 * Pattern density to spacing mapping (in pixels)
 */
const DENSITY_SPACING = {
  sparse: 40,
  medium: 24,
  dense: 16,
} as const;

interface GamePatternProps {
  /** Game ID to determine pattern type */
  gameId: GamePatternId;
  /** Width of the pattern area (defaults to screen width) */
  width?: number;
  /** Height of the pattern area (defaults to screen height) */
  height?: number;
  /** Override opacity (0-1) */
  opacity?: number;
}

/**
 * Diagonal stripes pattern - Blackjack
 * Classic casino felt pattern with 45° stripes
 */
function DiagonalStripesPattern({ width, height, density, color }: PatternRenderProps) {
  const spacing = DENSITY_SPACING[density];
  const strokeWidth = DENSITY_STROKE[density];
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];

  // Generate diagonal lines from top-left to bottom-right
  const diagonal = Math.sqrt(width * width + height * height);
  const numLines = Math.ceil(diagonal / spacing) * 2;

  for (let i = -numLines / 2; i < numLines / 2; i++) {
    const offset = i * spacing;
    lines.push({
      x1: offset,
      y1: 0,
      x2: offset + height,
      y2: height,
    });
  }

  return (
    <Canvas style={[styles.canvas, { width, height }]}>
      <Group>
        {lines.map((line, i) => (
          <Line
            key={i}
            p1={vec(line.x1, line.y1)}
            p2={vec(line.x2, line.y2)}
            color={color}
            strokeWidth={strokeWidth}
          />
        ))}
      </Group>
    </Canvas>
  );
}

/**
 * Radial segments pattern - Roulette
 * Concentric circles with radial divisions like a roulette wheel
 */
function RadialSegmentsPattern({ width, height, density, color }: PatternRenderProps) {
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.max(width, height) * 0.75;
  const spacing = DENSITY_SPACING[density];
  const strokeWidth = DENSITY_STROKE[density];

  // Concentric circles
  const numCircles = Math.ceil(maxRadius / spacing);
  const circles: { cx: number; cy: number; r: number }[] = [];
  for (let i = 1; i <= numCircles; i++) {
    circles.push({ cx: centerX, cy: centerY, r: i * spacing });
  }

  // Radial lines (36 segments like a roulette wheel)
  const numSegments = density === 'dense' ? 36 : density === 'medium' ? 24 : 12;
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < numSegments; i++) {
    const angle = (i / numSegments) * Math.PI * 2;
    lines.push({
      x1: centerX,
      y1: centerY,
      x2: centerX + Math.cos(angle) * maxRadius,
      y2: centerY + Math.sin(angle) * maxRadius,
    });
  }

  return (
    <Canvas style={[styles.canvas, { width, height }]}>
      <Group>
        {circles.map((circle, i) => (
          <Circle
            key={`circle-${i}`}
            cx={circle.cx}
            cy={circle.cy}
            r={circle.r}
            color="transparent"
            style="stroke"
            strokeWidth={strokeWidth}
          >
            <Line p1={vec(0, 0)} p2={vec(0, 0)} color={color} strokeWidth={strokeWidth} />
          </Circle>
        ))}
        {lines.map((line, i) => (
          <Line
            key={`line-${i}`}
            p1={vec(line.x1, line.y1)}
            p2={vec(line.x2, line.y2)}
            color={color}
            strokeWidth={strokeWidth}
          />
        ))}
      </Group>
    </Canvas>
  );
}

/**
 * Dot grid pattern - Craps
 * Regular grid of dots like dice pips
 */
function DotGridPattern({ width, height, density, color }: PatternRenderProps) {
  const spacing = DENSITY_SPACING[density];
  const dotRadius = density === 'dense' ? 2 : density === 'medium' ? 1.5 : 1;

  const cols = Math.ceil(width / spacing);
  const rows = Math.ceil(height / spacing);
  const dots: { x: number; y: number }[] = [];

  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      dots.push({
        x: col * spacing,
        y: row * spacing,
      });
    }
  }

  return (
    <Canvas style={[styles.canvas, { width, height }]}>
      <Group>
        {dots.map((dot, i) => (
          <Circle key={i} cx={dot.x} cy={dot.y} r={dotRadius} color={color} />
        ))}
      </Group>
    </Canvas>
  );
}

/**
 * Horizontal lines pattern - Baccarat
 * Clean horizontal lines for elegant card game
 */
function HorizontalLinesPattern({ width, height, density, color }: PatternRenderProps) {
  const spacing = DENSITY_SPACING[density];
  const strokeWidth = DENSITY_STROKE[density];
  const numLines = Math.ceil(height / spacing);

  return (
    <Canvas style={[styles.canvas, { width, height }]}>
      <Group>
        {Array.from({ length: numLines }, (_, i) => (
          <Line
            key={i}
            p1={vec(0, i * spacing)}
            p2={vec(width, i * spacing)}
            color={color}
            strokeWidth={strokeWidth}
          />
        ))}
      </Group>
    </Canvas>
  );
}

/**
 * Vertical bars pattern - Video Poker
 * Vertical bars reminiscent of slot machine reels
 */
function VerticalBarsPattern({ width, height, density, color }: PatternRenderProps) {
  const spacing = DENSITY_SPACING[density];
  const strokeWidth = DENSITY_STROKE[density];
  const numBars = Math.ceil(width / spacing);

  return (
    <Canvas style={[styles.canvas, { width, height }]}>
      <Group>
        {Array.from({ length: numBars }, (_, i) => (
          <Line
            key={i}
            p1={vec(i * spacing, 0)}
            p2={vec(i * spacing, height)}
            color={color}
            strokeWidth={strokeWidth}
          />
        ))}
      </Group>
    </Canvas>
  );
}

/**
 * Chevron pattern - Hi-Lo
 * Arrow-like chevrons pointing up/down for high/low theme
 */
function ChevronPattern({ width, height, density, color }: PatternRenderProps) {
  const spacing = DENSITY_SPACING[density] * 1.5;
  const strokeWidth = DENSITY_STROKE[density];
  const chevronHeight = spacing * 0.6;

  const cols = Math.ceil(width / spacing);
  const rows = Math.ceil(height / (chevronHeight * 2));
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];

  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const x = col * spacing;
      const y = row * chevronHeight * 2;
      // Chevron pointing up
      lines.push({ x1: x, y1: y + chevronHeight, x2: x + spacing / 2, y2: y });
      lines.push({ x1: x + spacing / 2, y1: y, x2: x + spacing, y2: y + chevronHeight });
    }
  }

  return (
    <Canvas style={[styles.canvas, { width, height }]}>
      <Group>
        {lines.map((line, i) => (
          <Line
            key={i}
            p1={vec(line.x1, line.y1)}
            p2={vec(line.x2, line.y2)}
            color={color}
            strokeWidth={strokeWidth}
          />
        ))}
      </Group>
    </Canvas>
  );
}

/**
 * Honeycomb pattern - Sic Bo
 * Hexagonal grid representing dice combinations
 */
function HoneycombPattern({ width, height, density, color }: PatternRenderProps) {
  const size = DENSITY_SPACING[density] * 0.8;
  const strokeWidth = DENSITY_STROKE[density];

  // Hexagon geometry
  const h = size * Math.sqrt(3);
  const cols = Math.ceil(width / (size * 1.5)) + 1;
  const rows = Math.ceil(height / h) + 1;

  const hexagonPath = (cx: number, cy: number): string => {
    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const x = cx + size * Math.cos(angle);
      const y = cy + size * Math.sin(angle);
      points.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
    }
    points.push('Z');
    return points.join(' ');
  };

  const paths: string[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = col * size * 1.5;
      const cy = row * h + (col % 2 === 1 ? h / 2 : 0);
      paths.push(hexagonPath(cx, cy));
    }
  }

  return (
    <Canvas style={[styles.canvas, { width, height }]}>
      <Group>
        {paths.map((pathString, i) => (
          <Path
            key={i}
            path={Skia.Path.MakeFromSVGString(pathString)!}
            color={color}
            style="stroke"
            strokeWidth={strokeWidth}
          />
        ))}
      </Group>
    </Canvas>
  );
}

/**
 * Triangle mesh pattern - Three Card Poker
 * Triangular tessellation for three-card theme
 */
function TriangleMeshPattern({ width, height, density, color }: PatternRenderProps) {
  const spacing = DENSITY_SPACING[density];
  const strokeWidth = DENSITY_STROKE[density];
  const triangleHeight = spacing * Math.sqrt(3) / 2;

  const cols = Math.ceil(width / spacing) + 1;
  const rows = Math.ceil(height / triangleHeight) + 1;
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];

  // Horizontal lines
  for (let row = 0; row <= rows; row++) {
    const y = row * triangleHeight;
    lines.push({ x1: 0, y1: y, x2: width, y2: y });
  }

  // Diagonal lines (both directions)
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const x = col * spacing + (row % 2 === 1 ? spacing / 2 : 0);
      const y = row * triangleHeight;
      // Down-right
      lines.push({ x1: x, y1: y, x2: x + spacing / 2, y2: y + triangleHeight });
      // Down-left
      lines.push({ x1: x, y1: y, x2: x - spacing / 2, y2: y + triangleHeight });
    }
  }

  return (
    <Canvas style={[styles.canvas, { width, height }]}>
      <Group>
        {lines.map((line, i) => (
          <Line
            key={i}
            p1={vec(line.x1, line.y1)}
            p2={vec(line.x2, line.y2)}
            color={color}
            strokeWidth={strokeWidth}
          />
        ))}
      </Group>
    </Canvas>
  );
}

/**
 * Crosshatch pattern - Ultimate Texas Hold'em
 * Cross-hatched lines for complex strategy game
 */
function CrosshatchPattern({ width, height, density, color }: PatternRenderProps) {
  const spacing = DENSITY_SPACING[density];
  const strokeWidth = DENSITY_STROKE[density];
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];

  // Horizontal lines
  const numHorizontal = Math.ceil(height / spacing);
  for (let i = 0; i <= numHorizontal; i++) {
    lines.push({ x1: 0, y1: i * spacing, x2: width, y2: i * spacing });
  }

  // Vertical lines
  const numVertical = Math.ceil(width / spacing);
  for (let i = 0; i <= numVertical; i++) {
    lines.push({ x1: i * spacing, y1: 0, x2: i * spacing, y2: height });
  }

  return (
    <Canvas style={[styles.canvas, { width, height }]}>
      <Group>
        {lines.map((line, i) => (
          <Line
            key={i}
            p1={vec(line.x1, line.y1)}
            p2={vec(line.x2, line.y2)}
            color={color}
            strokeWidth={strokeWidth}
          />
        ))}
      </Group>
    </Canvas>
  );
}

/**
 * Diagonal grid pattern - Casino War
 * Diamond grid for competitive card game
 */
function DiagonalGridPattern({ width, height, density, color }: PatternRenderProps) {
  const spacing = DENSITY_SPACING[density];
  const strokeWidth = DENSITY_STROKE[density];
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];

  const diagonal = Math.sqrt(width * width + height * height);
  const numLines = Math.ceil(diagonal / spacing) * 2;

  // Diagonal lines from top-left to bottom-right
  for (let i = -numLines / 2; i < numLines / 2; i++) {
    const offset = i * spacing;
    lines.push({
      x1: offset,
      y1: 0,
      x2: offset + height,
      y2: height,
    });
  }

  // Diagonal lines from top-right to bottom-left
  for (let i = -numLines / 2; i < numLines / 2; i++) {
    const offset = i * spacing;
    lines.push({
      x1: width - offset,
      y1: 0,
      x2: width - offset - height,
      y2: height,
    });
  }

  return (
    <Canvas style={[styles.canvas, { width, height }]}>
      <Group>
        {lines.map((line, i) => (
          <Line
            key={i}
            p1={vec(line.x1, line.y1)}
            p2={vec(line.x2, line.y2)}
            color={color}
            strokeWidth={strokeWidth}
          />
        ))}
      </Group>
    </Canvas>
  );
}

/**
 * Pattern renderer props (internal)
 */
interface PatternRenderProps {
  width: number;
  height: number;
  density: 'sparse' | 'medium' | 'dense';
  color: string;
}

/**
 * Pattern type to renderer mapping
 */
const PATTERN_RENDERERS: Record<string, React.FC<PatternRenderProps>> = {
  'diagonal-stripes': DiagonalStripesPattern,
  'radial-segments': RadialSegmentsPattern,
  'dot-grid': DotGridPattern,
  'horizontal-lines': HorizontalLinesPattern,
  'vertical-bars': VerticalBarsPattern,
  'chevron': ChevronPattern,
  'honeycomb': HoneycombPattern,
  'triangle-mesh': TriangleMeshPattern,
  'crosshatch': CrosshatchPattern,
  'diagonal-grid': DiagonalGridPattern,
};

/**
 * GamePattern - Renders monochrome geometric pattern for game differentiation
 */
export function GamePattern({
  gameId,
  width = SCREEN_WIDTH,
  height = SCREEN_HEIGHT,
  opacity,
}: GamePatternProps) {
  const patternConfig = GAME_PATTERN[gameId];
  const density = patternConfig.density as 'sparse' | 'medium' | 'dense';
  const PatternRenderer = PATTERN_RENDERERS[patternConfig.pattern];

  // Use MONO.500 (mid-gray) with density-based opacity for subtle pattern
  const patternOpacity = opacity ?? DENSITY_OPACITY[density];
  const color = `rgba(255, 255, 255, ${patternOpacity})`;

  if (!PatternRenderer) {
    console.warn(`Unknown pattern type: ${patternConfig.pattern}`);
    return null;
  }

  return (
    <View style={styles.container} pointerEvents="none">
      <PatternRenderer width={width} height={height} density={density} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  canvas: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});

export type { GamePatternProps };
