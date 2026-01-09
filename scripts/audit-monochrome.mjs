#!/usr/bin/env node
/**
 * Monochrome Color Audit Script (US-264)
 *
 * Scans source files for non-token hex colors to prevent color drift
 * after the monochrome design system rollout.
 *
 * Usage:
 *   node scripts/audit-monochrome.mjs [--fix] [--strict]
 *
 * Options:
 *   --fix     Print suggested replacements (does not auto-fix)
 *   --strict  Exit with code 1 if any violations found (for CI)
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// Valid monochrome palette from design tokens
const MONO_PALETTE = new Set([
  '#000000', '#0a0a0a', '#141414', '#1a1a1a',
  '#262626', '#404040', '#525252', '#737373',
  '#a3a3a3', '#d4d4d4', '#e5e5e5', '#f5f5f5',
  '#fafafa', '#ffffff',
]);

// Common shorthand equivalents
const MONO_SHORTHANDS = new Set([
  '#000', '#fff',
]);

// rgba variants that are valid (from EDGE tokens and common patterns)
const VALID_RGBA_PATTERNS = [
  /rgba\s*\(\s*0\s*,\s*0\s*,\s*0\s*,/i,           // rgba(0, 0, 0, ...)  - black
  /rgba\s*\(\s*255\s*,\s*255\s*,\s*255\s*,/i,     // rgba(255, 255, 255, ...) - white
];

// Directories to scan
const SCAN_DIRS = [
  'website/src',
  'mobile/src',
  'packages/design-tokens/src',
];

// File extensions to check
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.css'];

// Files/patterns to skip (test files, design token definitions, etc.)
const SKIP_PATTERNS = [
  /__tests__\//,
  /\.test\./,
  /\.spec\./,
  /test-utils/,
  /jest/,
  /design-tokens\/src\/colors\.ts$/,  // The source of truth
];

// Regex to find hex colors
const HEX_COLOR_REGEX = /#([0-9a-fA-F]{3}){1,2}\b/g;

// Regex to find rgb/rgba
const RGBA_REGEX = /rgba?\s*\([^)]+\)/gi;

function isValidMonochrome(hex) {
  const normalized = hex.toLowerCase();
  return MONO_PALETTE.has(normalized) || MONO_SHORTHANDS.has(normalized);
}

function isValidRgba(rgba) {
  return VALID_RGBA_PATTERNS.some(pattern => pattern.test(rgba));
}

function shouldSkip(filepath) {
  return SKIP_PATTERNS.some(pattern => pattern.test(filepath));
}

function findClosestMono(hex) {
  // Convert hex to RGB
  const normalized = hex.toLowerCase().replace('#', '');
  const r = parseInt(normalized.length === 3 ? normalized[0] + normalized[0] : normalized.slice(0, 2), 16);
  const g = parseInt(normalized.length === 3 ? normalized[1] + normalized[1] : normalized.slice(2, 4), 16);
  const b = parseInt(normalized.length === 3 ? normalized[2] + normalized[2] : normalized.slice(4, 6), 16);

  // Check if it's already grayscale-ish
  const isGrayscale = Math.abs(r - g) <= 10 && Math.abs(g - b) <= 10 && Math.abs(r - b) <= 10;
  const luminance = Math.round((r + g + b) / 3);

  let closest = '#000000';
  let closestDist = 255;

  for (const mono of MONO_PALETTE) {
    const monoVal = parseInt(mono.slice(1, 3), 16);
    const dist = Math.abs(luminance - monoVal);
    if (dist < closestDist) {
      closestDist = dist;
      closest = mono;
    }
  }

  return { closest, isGrayscale, luminance };
}

function scanFile(filepath) {
  const content = readFileSync(filepath, 'utf-8');
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, index) => {
    // Find hex colors
    const hexMatches = line.matchAll(HEX_COLOR_REGEX);
    for (const match of hexMatches) {
      const hex = match[0];
      if (!isValidMonochrome(hex)) {
        const { closest, isGrayscale, luminance } = findClosestMono(hex);
        violations.push({
          line: index + 1,
          column: match.index + 1,
          color: hex,
          type: 'hex',
          suggestion: closest,
          isGrayscale,
          luminance,
          context: line.trim().slice(0, 80),
        });
      }
    }

    // Find rgba colors (only flag non-black/white)
    const rgbaMatches = line.matchAll(RGBA_REGEX);
    for (const match of rgbaMatches) {
      const rgba = match[0];
      if (!isValidRgba(rgba)) {
        violations.push({
          line: index + 1,
          column: match.index + 1,
          color: rgba,
          type: 'rgba',
          context: line.trim().slice(0, 80),
        });
      }
    }
  });

  return violations;
}

function scanDirectory(dir) {
  const results = [];
  const fullPath = join(ROOT, dir);

  function walk(currentPath) {
    let entries;
    try {
      entries = readdirSync(currentPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = join(currentPath, entry);
      const stat = statSync(entryPath);

      if (stat.isDirectory()) {
        if (!entry.startsWith('.') && entry !== 'node_modules') {
          walk(entryPath);
        }
      } else if (stat.isFile()) {
        const ext = entry.slice(entry.lastIndexOf('.'));
        if (EXTENSIONS.includes(ext)) {
          const relativePath = relative(ROOT, entryPath);
          if (!shouldSkip(relativePath)) {
            const violations = scanFile(entryPath);
            if (violations.length > 0) {
              results.push({ file: relativePath, violations });
            }
          }
        }
      }
    }
  }

  walk(fullPath);
  return results;
}

function main() {
  const args = process.argv.slice(2);
  const showFix = args.includes('--fix');
  const strictMode = args.includes('--strict');

  console.log('Monochrome Design System Audit (US-264)');
  console.log('═'.repeat(50));
  console.log();

  let totalViolations = 0;
  let totalFiles = 0;

  for (const dir of SCAN_DIRS) {
    const results = scanDirectory(dir);
    for (const { file, violations } of results) {
      totalFiles++;
      totalViolations += violations.length;

      console.log(`\x1b[33m${file}\x1b[0m`);
      for (const v of violations) {
        const colorTag = v.type === 'hex'
          ? (v.isGrayscale ? '\x1b[37m' : '\x1b[31m')  // White for grayscale, red for colored
          : '\x1b[35m';  // Magenta for rgba

        console.log(`  Line ${v.line}:${v.column} ${colorTag}${v.color}\x1b[0m`);
        console.log(`    ${v.context}`);

        if (showFix && v.suggestion) {
          console.log(`    \x1b[32m→ Suggestion: ${v.suggestion}\x1b[0m`);
        }
      }
      console.log();
    }
  }

  // Summary
  console.log('═'.repeat(50));
  if (totalViolations === 0) {
    console.log('\x1b[32m✓ No monochrome violations found!\x1b[0m');
  } else {
    console.log(`\x1b[33mFound ${totalViolations} violation(s) in ${totalFiles} file(s)\x1b[0m`);
    console.log();
    console.log('Legend:');
    console.log('  \x1b[37m#xxxxxx\x1b[0m - Grayscale value (closest mono token suggested)');
    console.log('  \x1b[31m#xxxxxx\x1b[0m - Colored value (needs replacement or pattern)');
    console.log('  \x1b[35mrgba(...)\x1b[0m - Non-black/white rgba');
    console.log();
    console.log('Valid monochrome palette:');
    console.log('  ', [...MONO_PALETTE].join(' '));
  }

  if (strictMode && totalViolations > 0) {
    process.exit(1);
  }
}

main();
