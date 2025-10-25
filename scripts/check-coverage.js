#!/usr/bin/env node

/**
 * Coverage Threshold Enforcer
 *
 * Validates test coverage thresholds:
 * - Lines: >= 85%
 * - Branches: >= 80%
 * - Functions: >= 80%
 * - Statements: >= 85%
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Thresholds
const THRESHOLDS = {
  lines: 85,
  branches: 80,
  functions: 80,
  statements: 85,
};

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

/**
 * Read and parse coverage summary
 */
function readCoverageSummary() {
  try {
    const coveragePath = join(__dirname, '..', 'coverage', 'coverage-summary.json');
    const content = readFileSync(coveragePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`${colors.red}❌ Failed to read coverage-summary.json${colors.reset}`);
    console.error(`Error: ${error.message}`);
    console.error(`\nMake sure to run tests with coverage first:`);
    console.error(`  yarn test:coverage`);
    process.exit(1);
  }
}

/**
 * Check if coverage meets thresholds
 */
function checkCoverage(coverage, thresholds) {
  const results = [];
  let allPassed = true;

  for (const [metric, threshold] of Object.entries(thresholds)) {
    const percent = coverage.total[metric]?.pct ?? 0;
    const passed = percent >= threshold;

    results.push({
      metric,
      percent: percent.toFixed(2),
      threshold,
      passed,
    });

    if (!passed) {
      allPassed = false;
    }
  }

  return { results, allPassed };
}

/**
 * Print coverage report
 */
function printReport({ results, allPassed }) {
  console.log(`\n${colors.blue}Coverage Report${colors.reset}\n`);
  console.log('┌──────────────┬──────────┬──────────┐');
  console.log('│ Metric       │ Actual   │ Target   │');
  console.log('├──────────────┼──────────┼──────────┤');

  for (const result of results) {
    const icon = result.passed ? `${colors.green}✅${colors.reset}` : `${colors.red}❌${colors.reset}`;
    const status = result.passed ? colors.green : colors.red;
    const reset = colors.reset;

    console.log(
      `│ ${result.metric.padEnd(12)} │ ${status}${result.percent.padStart(6)}%${reset}  │ ${result.threshold.padStart(6)}%  │ ${icon}`,
    );
  }

  console.log('└──────────────┴──────────┴──────────┘\n');

  if (allPassed) {
    console.log(`${colors.green}✅ All coverage thresholds met!${colors.reset}\n`);
  } else {
    console.log(`${colors.red}❌ Some coverage thresholds not met!${colors.reset}\n`);
    console.log(`To improve coverage:`);
    console.log(`  1. Add unit tests for uncovered code`);
    console.log(`  2. Add integration tests for edge cases`);
    console.log(`  3. Use 'describe.skip' / 'it.skip' to exclude valid uncovered code\n`);
  }
}

/**
 * Main execution
 */
function main() {
  console.log(`${colors.blue}Checking coverage thresholds...${colors.reset}\n`);

  // Read coverage summary
  const coverage = readCoverageSummary();

  // Check thresholds
  const { results, allPassed } = checkCoverage(coverage, THRESHOLDS);

  // Print report
  printReport({ results, allPassed });

  // Exit with appropriate code
  process.exit(allPassed ? 0 : 1);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
