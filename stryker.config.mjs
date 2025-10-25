/**
 * Stryker Mutator Configuration
 *
 * Mutation testing configuration for @luoarch/baileys-store-core
 * Target: 70%+ mutation score
 */

export default {
  /**
   * Files to mutate
   * Excludes tests, types, and generated code
   */
  mutate: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/types/**',
    '!src/**/index.ts',
  ],

  /**
   * Test runner
   */
  testRunner: 'vitest',
  testRunnerNodeArgs: ['--no-warnings'],

  /**
   * Coverage analysis
   */
  coverageAnalysis: 'perTest',

  /**
   * Reporter configuration
   */
  reporters: ['html', 'clear-text', 'progress', 'dashboard'],
  htmlReporter: {
    baseDir: 'coverage/mutation',
  },

  /**
   * Dashboard reporting (optional)
   */
  dashboard: {
    project: 'github.com/luoarch/baileys-store-core',
    version: 'main',
    module: 'baileys-store-core',
    reportType: 'full',
  },

  /**
   * Mutation score thresholds
   */
  thresholds: {
    high: 80, // Warning if score drops below 80%
    low: 60,  // Fail if score drops below 60%
    break: 70, // Build fails if score < 70%
  },

  /**
   * Ignore specific mutations (false positives)
   */
  ignoreMutations: [
    // Ignore arrow function mutations (causes too many false positives)
    'ArrowFunction',
    // Ignore conditional compilation mutations
    'ConditionalExpression',
  ],

  /**
   * Log level
   */
  logLevel: 'info',

  /**
   * Concurrency (parallel test runs)
   */
  concurrency: 2,

  /**
   * Timeout for test run
   */
  timeoutMS: 30000,

  /**
   * Clean up after mutation test run
   */
  cleanTempDir: true,

  /**
   * CI mode (disable dashboard and other non-essential features)
   */
  ci: false,

  /**
   * Incremental mode (speed up subsequent runs)
   */
  incremental: true,
  incrementalFile: '.stryker-tmp/incremental.json',

  /**
   * Files to include in sandbox
   */
  files: [
    'src/**/*.ts',
    'src/**/*.js',
    'package.json',
    'tsconfig.json',
    'vitest.config.ts',
  ],

  /**
   * Exclude files from sandbox
   */
  exclude: [
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
  ],
};
