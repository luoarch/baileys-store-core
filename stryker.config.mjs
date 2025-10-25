/**
 * Stryker Mutator Configuration
 *
 * Mutation testing configuration for @luoarch/baileys-store-core
 * Target: 70%+ mutation score (focando em módulos críticos)
 * 
 * @type {import('@stryker-mutator/core').PartialStrykerOptions}
 */
export default {
  /**
   * Package manager
   */
  packageManager: 'yarn',

  /**
   * Test runner configuration
   */
  testRunner: 'vitest',
  
  /**
   * Vitest runner options
   */
  vitest: {
    configFile: 'vitest.config.ts',
  },

  /**
   * Files to mutate
   * FOCO: Apenas módulos críticos com alta cobertura para RC1
   */
  mutate: [
    // Módulos críticos com >90% coverage
    'src/crypto/**/*.ts',
    'src/mongodb/store.ts',
    'src/redis/use-redis-auth-state.ts',
    'src/hybrid/use-hybrid-auth-state.ts',
    'src/hybrid/store.ts',
    
    // Excluir testes e arquivos de baixa cobertura
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.e2e.test.ts',
    '!src/__tests__/**',
    
    // Excluir módulos utilitários com baixa cobertura
    '!src/errors/hierarchy.ts',
    '!src/health/health-check.ts',
    '!src/validation/reporter.ts',
    '!src/types/**',
    '!src/**/index.ts',
  ],

  /**
   * Coverage analysis
   */
  coverageAnalysis: 'perTest',

  /**
   * Reporter configuration
   */
  reporters: ['progress', 'clear-text', 'html', 'json'],
  
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  
  jsonReporter: {
    fileName: 'reports/mutation/report.json',
  },

  /**
   * Mutation score thresholds
   * RC1: Thresholds realistas para módulos críticos
   */
  thresholds: {
    high: 70, // Warning se score < 70%
    low: 50,  // Fail se score < 50%
    break: 40, // Build falha se score < 40%
  },

  /**
   * Mutator configuration
   * Excluir mutações que geram muitos falsos positivos
   */
  mutator: {
    excludedMutations: [
      'StringLiteral',      // Logs/mensagens não afetam lógica
      'BlockStatement',     // Remove blocos (muito invasivo)
    ],
  },

  /**
   * Log level
   */
  logLevel: 'info',

  /**
   * Concurrency (reduzido para estabilidade)
   */
  concurrency: 2,

  /**
   * Timeout para test run (aumentado para I/O operations)
   */
  timeoutMS: 120000, // 2 minutos

  /**
   * TypeScript checker desabilitado
   * O Vitest já valida TypeScript nativamente, evitar duplicação
   */
  // checkers: ['typescript'],

  /**
   * Incremental mode (cache de mutantes já testados)
   * Acelera re-runs significativamente
   */
  incremental: true,
  incrementalFile: '.stryker-tmp/incremental.json',

  /**
   * Clean up after mutation test run
   */
  cleanTempDir: true,

  /**
   * Ignore patterns
   */
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.stryker-tmp/**',
    '**/examples/**',
    '**/test-scripts/**',
    '**/scripts/**',
    '**/docs/**',
    'eslint.config.mjs',
    'k6-load-test.js',
  ],

  /**
   * Warnings configuration
   */
  warnings: {
    unknownOptions: false,
  },
};
