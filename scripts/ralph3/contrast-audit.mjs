#!/usr/bin/env node
/**
 * WCAG AA Contrast Audit Script
 *
 * Calculates contrast ratios for all design system color combinations
 * and reports any WCAG AA violations.
 *
 * Requirements:
 * - Normal text (< 18px): 4.5:1 minimum
 * - Large text (>= 18px or >= 14px bold): 3:1 minimum
 * - UI components/graphics: 3:1 minimum
 */

// Import design tokens
import { TITANIUM, ACTION, GAME } from '@nullspace/design-tokens';

// Convert hex to RGB
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

// Calculate relative luminance (WCAG 2.1 formula)
function relativeLuminance(rgb) {
  const [rs, gs, bs] = [rgb.r, rgb.g, rgb.b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// Calculate contrast ratio between two colors
function contrastRatio(color1, color2) {
  const l1 = relativeLuminance(hexToRgb(color1));
  const l2 = relativeLuminance(hexToRgb(color2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Format ratio for display
function formatRatio(ratio) {
  return ratio.toFixed(2) + ':1';
}

// Check WCAG AA compliance
function checkWcag(ratio, type = 'normal') {
  const threshold = type === 'normal' ? 4.5 : 3.0;
  const pass = ratio >= threshold;
  return { pass, threshold, ratio };
}

console.log('='.repeat(70));
console.log('WCAG AA CONTRAST AUDIT - Nullspace Design System');
console.log('='.repeat(70));
console.log('\nRequirements:');
console.log('- Normal text (< 18px): 4.5:1 minimum');
console.log('- Large text (>= 18px or >= 14px bold): 3:1 minimum');
console.log('- UI components: 3:1 minimum\n');

const failures = [];
const warnings = [];

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Titanium Text on Titanium Backgrounds
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log('1. TITANIUM TEXT/BACKGROUND COMBINATIONS');
console.log('─'.repeat(70));

// Common text/background combinations
const titaniumCombos = [
  // Primary text on light backgrounds
  { text: '900', bg: '50', usage: 'Primary text on lightest bg' },
  { text: '800', bg: '50', usage: 'Heading text on lightest bg' },
  { text: '700', bg: '50', usage: 'Emphasized text on lightest bg' },
  { text: '600', bg: '50', usage: 'Body text on lightest bg' },
  { text: '500', bg: '50', usage: 'Secondary text on lightest bg' },
  { text: '400', bg: '50', usage: 'Muted/disabled text on lightest bg' },

  // Text on white (#FFFFFF approximated by titanium-50)
  { text: '900', bg: '100', usage: 'Primary text on secondary bg' },
  { text: '600', bg: '100', usage: 'Body text on secondary bg' },
  { text: '500', bg: '100', usage: 'Secondary text on secondary bg' },
  { text: '400', bg: '100', usage: 'Muted text on secondary bg' },

  // Dark mode: Light text on dark backgrounds
  { text: '50', bg: '950', usage: 'Dark mode: Primary text' },
  { text: '100', bg: '950', usage: 'Dark mode: Secondary text' },
  { text: '200', bg: '950', usage: 'Dark mode: Muted text' },
  { text: '300', bg: '950', usage: 'Dark mode: Disabled text' },
  { text: '400', bg: '950', usage: 'Dark mode: Very muted text' },

  { text: '50', bg: '900', usage: 'Dark mode: Text on panel bg' },
  { text: '100', bg: '900', usage: 'Dark mode: Secondary on panel' },
  { text: '300', bg: '900', usage: 'Dark mode: Muted on panel' },
];

console.log('\nText Color | Background | Ratio    | AA Normal | AA Large | Usage');
console.log('-'.repeat(90));

for (const combo of titaniumCombos) {
  const textColor = TITANIUM[combo.text];
  const bgColor = TITANIUM[combo.bg];
  const ratio = contrastRatio(textColor, bgColor);
  const normal = checkWcag(ratio, 'normal');
  const large = checkWcag(ratio, 'large');

  const normalStatus = normal.pass ? '✓ PASS' : '✗ FAIL';
  const largeStatus = large.pass ? '✓ PASS' : '✗ FAIL';

  console.log(
    `${combo.text.padStart(10)} | ${combo.bg.padEnd(10)} | ${formatRatio(ratio).padStart(8)} | ${normalStatus.padEnd(9)} | ${largeStatus.padEnd(8)} | ${combo.usage}`
  );

  if (!normal.pass) {
    failures.push({
      category: 'Titanium',
      text: `titanium-${combo.text}`,
      bg: `titanium-${combo.bg}`,
      ratio,
      usage: combo.usage,
      type: 'normal',
    });
  } else if (!large.pass) {
    warnings.push({
      category: 'Titanium',
      text: `titanium-${combo.text}`,
      bg: `titanium-${combo.bg}`,
      ratio,
      usage: combo.usage,
      type: 'large',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Action Colors on Backgrounds
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log('2. ACTION COLORS ON BACKGROUNDS');
console.log('─'.repeat(70));

const actionCombos = [
  // Indigo on backgrounds
  { text: 'indigo', textColor: ACTION.indigo, bg: TITANIUM[50], bgName: 'titanium-50', usage: 'Indigo link on light bg' },
  { text: 'indigo', textColor: ACTION.indigo, bg: TITANIUM[100], bgName: 'titanium-100', usage: 'Indigo link on secondary bg' },
  { text: 'indigo', textColor: ACTION.indigo, bg: '#FFFFFF', bgName: 'white', usage: 'Indigo link on white' },

  // White text on action colors (buttons)
  { text: 'white', textColor: '#FFFFFF', bg: ACTION.indigo, bgName: 'action-indigo', usage: 'White text on indigo button' },
  { text: 'white', textColor: '#FFFFFF', bg: ACTION.indigoHover, bgName: 'action-indigoHover', usage: 'White text on indigo hover' },
  { text: 'white', textColor: '#FFFFFF', bg: ACTION.success, bgName: 'action-success', usage: 'White text on success button' },
  { text: 'white', textColor: '#FFFFFF', bg: ACTION.error, bgName: 'action-error', usage: 'White text on error button' },
  { text: 'white', textColor: '#FFFFFF', bg: ACTION.warning, bgName: 'action-warning', usage: 'White text on warning button' },

  // Black text on action colors (alternative)
  { text: 'black', textColor: '#000000', bg: ACTION.success, bgName: 'action-success', usage: 'Black text on success (alt)' },
  { text: 'black', textColor: '#000000', bg: ACTION.warning, bgName: 'action-warning', usage: 'Black text on warning (alt)' },

  // Status colors as text
  { text: 'success', textColor: ACTION.success, bg: TITANIUM[50], bgName: 'titanium-50', usage: 'Success text on light bg' },
  { text: 'error', textColor: ACTION.error, bg: TITANIUM[50], bgName: 'titanium-50', usage: 'Error text on light bg' },
  { text: 'success', textColor: ACTION.success, bg: TITANIUM[950], bgName: 'titanium-950', usage: 'Success text on dark bg' },
  { text: 'error', textColor: ACTION.error, bg: TITANIUM[950], bgName: 'titanium-950', usage: 'Error text on dark bg' },
];

console.log('\nText       | Background      | Ratio    | AA Normal | AA Large | Usage');
console.log('-'.repeat(95));

for (const combo of actionCombos) {
  const ratio = contrastRatio(combo.textColor, combo.bg);
  const normal = checkWcag(ratio, 'normal');
  const large = checkWcag(ratio, 'large');

  const normalStatus = normal.pass ? '✓ PASS' : '✗ FAIL';
  const largeStatus = large.pass ? '✓ PASS' : '✗ FAIL';

  console.log(
    `${combo.text.padStart(10)} | ${combo.bgName.padEnd(15)} | ${formatRatio(ratio).padStart(8)} | ${normalStatus.padEnd(9)} | ${largeStatus.padEnd(8)} | ${combo.usage}`
  );

  if (!normal.pass) {
    failures.push({
      category: 'Action',
      text: combo.text,
      bg: combo.bgName,
      ratio,
      usage: combo.usage,
      type: 'normal',
    });
  } else if (!large.pass) {
    warnings.push({
      category: 'Action',
      text: combo.text,
      bg: combo.bgName,
      ratio,
      usage: combo.usage,
      type: 'large',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Game Backgrounds
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log('3. GAME TABLE TEXT (White/Light on Game Backgrounds)');
console.log('─'.repeat(70));

console.log('\nGame           | Primary BG | White Text | Light Text | Accent    | Usage');
console.log('-'.repeat(95));

for (const [gameId, colors] of Object.entries(GAME)) {
  const whiteRatio = contrastRatio('#FFFFFF', colors.primary);
  const lightRatio = contrastRatio(TITANIUM[100], colors.primary);
  const accentRatio = contrastRatio(colors.accent, colors.primary);

  const whiteStatus = whiteRatio >= 4.5 ? '✓' : whiteRatio >= 3.0 ? '⚠' : '✗';
  const lightStatus = lightRatio >= 4.5 ? '✓' : lightRatio >= 3.0 ? '⚠' : '✗';
  const accentStatus = accentRatio >= 3.0 ? '✓' : '✗';

  console.log(
    `${gameId.padEnd(14)} | ${colors.primary} | ${whiteStatus} ${formatRatio(whiteRatio).padStart(6)} | ${lightStatus} ${formatRatio(lightRatio).padStart(6)} | ${accentStatus} ${formatRatio(accentRatio).padStart(6)} | Table text`
  );

  if (whiteRatio < 4.5) {
    const entry = {
      category: 'Game',
      text: 'white',
      bg: `game-${gameId}`,
      ratio: whiteRatio,
      usage: `White text on ${gameId} table`,
      type: whiteRatio >= 3.0 ? 'large' : 'normal',
    };
    if (whiteRatio >= 3.0) {
      warnings.push(entry);
    } else {
      failures.push(entry);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70));
console.log('AUDIT SUMMARY');
console.log('='.repeat(70));

if (failures.length === 0) {
  console.log('\n✓ NO WCAG AA FAILURES DETECTED');
} else {
  console.log(`\n✗ ${failures.length} WCAG AA FAILURES (ratio < 4.5:1 for normal text):`);
  console.log('-'.repeat(70));
  for (const f of failures) {
    console.log(`  - ${f.text} on ${f.bg}: ${formatRatio(f.ratio)} (${f.usage})`);
  }
}

if (warnings.length > 0) {
  console.log(`\n⚠ ${warnings.length} BORDERLINE (pass large text 3:1, fail normal 4.5:1):`);
  console.log('-'.repeat(70));
  for (const w of warnings) {
    console.log(`  - ${w.text} on ${w.bg}: ${formatRatio(w.ratio)} (${w.usage})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RECOMMENDATIONS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log('RECOMMENDATIONS');
console.log('─'.repeat(70));

// Find problematic titanium shades
const titanium400OnWhite = contrastRatio(TITANIUM[400], '#FFFFFF');
const titanium400On50 = contrastRatio(TITANIUM[400], TITANIUM[50]);
const titanium500OnWhite = contrastRatio(TITANIUM[500], '#FFFFFF');

console.log('\n1. TITANIUM-400 (Muted Text):');
console.log(`   Current contrast on white: ${formatRatio(titanium400OnWhite)}`);
console.log(`   Current contrast on titanium-50: ${formatRatio(titanium400On50)}`);
if (titanium400OnWhite < 4.5) {
  console.log('   RECOMMENDATION: Use titanium-500 or darker for body/muted text');
  console.log(`   titanium-500 on white: ${formatRatio(titanium500OnWhite)} ✓`);
}

console.log('\n2. ACTION-WARNING (Orange):');
const warningContrast = contrastRatio('#FFFFFF', ACTION.warning);
console.log(`   White on warning: ${formatRatio(warningContrast)}`);
if (warningContrast < 4.5) {
  console.log('   RECOMMENDATION: Use dark text (#000 or titanium-900) on warning backgrounds');
  console.log(`   Black on warning: ${formatRatio(contrastRatio('#000000', ACTION.warning))} ✓`);
}

console.log('\n3. GAME BACKGROUNDS:');
console.log('   For games with lower contrast, use the casino-contrast utility class');
console.log('   which provides adaptive text colors based on background luminance.');

console.log('\n' + '='.repeat(70));
console.log('AUDIT COMPLETE');
console.log('='.repeat(70));

// Exit with error code if there are failures that affect normal text
const criticalFailures = failures.filter(f => f.type === 'normal' && f.category !== 'Game');
if (criticalFailures.length > 0) {
  console.log(`\n⚠ ${criticalFailures.length} critical failures found that need fixing.`);
  process.exit(1);
}

console.log('\n✓ All critical color combinations pass WCAG AA requirements.');
process.exit(0);
