#!/usr/bin/env node
/**
 * US-145: Bundle size check for CI
 *
 * Ensures JavaScript bundle sizes stay under limits:
 * - Main entry bundle: 50KB (should be minimal with lazy loading)
 * - Largest route chunk: 600KB (CasinoApp, etc.)
 * - Vendor chunks: 350KB each
 *
 * Run after build: node scripts/check-bundle-sizes.mjs
 */

import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const DIST_ASSETS = './dist/assets';

// Size limits in bytes
const LIMITS = {
  // Main entry point should be tiny with all routes lazy-loaded
  mainBundle: 50 * 1024, // 50KB
  // Route chunks can be larger but still reasonable
  routeChunk: 600 * 1024, // 600KB
  // Vendor chunks
  vendorChunk: 350 * 1024, // 350KB
};

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function checkBundleSizes() {
  const files = readdirSync(DIST_ASSETS);
  const jsFiles = files.filter(f => f.endsWith('.js'));

  let hasErrors = false;
  const results = [];

  for (const file of jsFiles) {
    const filePath = join(DIST_ASSETS, file);
    const stats = statSync(filePath);
    const size = stats.size;

    let limit;
    let category;

    if (file.startsWith('index-')) {
      limit = LIMITS.mainBundle;
      category = 'Main bundle';
    } else if (file.startsWith('vendor-')) {
      limit = LIMITS.vendorChunk;
      category = 'Vendor chunk';
    } else {
      limit = LIMITS.routeChunk;
      category = 'Route chunk';
    }

    const overLimit = size > limit;
    const status = overLimit ? '❌' : '✓';

    results.push({
      file,
      size,
      limit,
      category,
      overLimit,
      status
    });

    if (overLimit) {
      hasErrors = true;
    }
  }

  // Sort by size descending
  results.sort((a, b) => b.size - a.size);

  console.log('\n📦 Bundle Size Report\n');
  console.log('─'.repeat(70));

  for (const r of results) {
    const sizeStr = formatBytes(r.size).padStart(8);
    const limitStr = formatBytes(r.limit).padStart(8);
    const pct = ((r.size / r.limit) * 100).toFixed(0).padStart(3);
    console.log(`${r.status} ${sizeStr} / ${limitStr} (${pct}%) ${r.file}`);
  }

  console.log('─'.repeat(70));

  if (hasErrors) {
    console.log('\n❌ Some bundles exceed size limits!\n');
    console.log('Suggestions:');
    console.log('  - Use React.lazy() for additional route components');
    console.log('  - Check for large dependencies with: ANALYZE=true pnpm build');
    console.log('  - Split vendor chunks in vite.config.js manualChunks');
    process.exit(1);
  } else {
    console.log('\n✓ All bundles within size limits\n');
    process.exit(0);
  }
}

checkBundleSizes();
