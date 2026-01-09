#!/usr/bin/env node

/**
 * Validates OpenAPI specifications in docs/api/
 *
 * Usage:
 *   node scripts/validate-openapi.mjs
 *
 * Requires: @redocly/cli (npx will auto-install)
 */

import { execSync } from 'child_process';
import { readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const apiDir = resolve(__dirname, '../docs/api');

async function main() {
  console.log('Validating OpenAPI specifications...\n');

  const files = await readdir(apiDir);
  const specs = files.filter((f) => f.endsWith('.openapi.yaml'));

  if (specs.length === 0) {
    console.log('No OpenAPI specifications found in docs/api/');
    process.exit(0);
  }

  console.log(`Found ${specs.length} specification(s):\n`);

  let failed = false;

  for (const spec of specs) {
    const specPath = join(apiDir, spec);
    console.log(`\n--- Validating: ${spec} ---\n`);

    try {
      // Use config file for lint rules
      execSync(
        `npx @redocly/cli lint "${specPath}" --config "${join(apiDir, 'redocly.yaml')}"`,
        { stdio: 'inherit', cwd: apiDir }
      );
      console.log(`\n✓ ${spec} is valid`);
    } catch (error) {
      console.error(`\n✗ ${spec} has errors`);
      failed = true;
    }
  }

  console.log('\n');

  if (failed) {
    console.error('Some specifications have errors.');
    process.exit(1);
  }

  console.log('All specifications are valid.');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
