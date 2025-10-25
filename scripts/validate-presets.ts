#!/usr/bin/env tsx

/**
 * Preset Validation Script
 *
 * Validates configuration presets against schemas and business rules.
 * Exits with code 0 if all presets are valid, 1 otherwise.
 */

import { DEVELOPMENT, PRODUCTION, TESTING, validatePreset } from '../src/config/presets.js';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

/**
 * Validate a preset
 */
function validatePresetWithName(presetName: string, preset: unknown) {
  console.log(`\n${colors.blue}Validating ${presetName} preset...${colors.reset}`);
  
  const errors = validatePreset(preset as Parameters<typeof validatePreset>[0]);
  
  if (errors.length === 0) {
    console.log(`${colors.green}✅ ${presetName} preset is valid${colors.reset}`);
    return true;
  }
  
  console.log(`${colors.red}❌ ${presetName} preset has validation errors:${colors.reset}`);
  for (const error of errors) {
    console.log(`  - ${error}`);
  }
  return false;
}

/**
 * Main execution
 */
function main() {
  console.log(`${colors.blue}Validating configuration presets...${colors.reset}\n`);

  const results = [
    validatePresetWithName('DEVELOPMENT', DEVELOPMENT),
    validatePresetWithName('PRODUCTION', PRODUCTION),
    validatePresetWithName('TESTING', TESTING),
  ];

  const allPassed = results.every((result) => result);

  console.log('');
  
  if (allPassed) {
    console.log(`${colors.green}✅ All presets are valid!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.red}❌ Some presets failed validation${colors.reset}\n`);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
