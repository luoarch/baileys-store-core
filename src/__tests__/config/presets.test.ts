/**
 * @baileys-store/core - Config Presets Tests
 *
 * Unit tests for configuration presets
 */

import { describe, it, expect } from 'vitest';
import {
  DEVELOPMENT,
  PRODUCTION,
  TESTING,
  validatePreset,
  getPreset,
  PRESETS,
  createHybridConfigFromPreset,
} from '../../config/presets.js';

describe('Config Presets', () => {
  describe('DEVELOPMENT preset', () => {
    it('should have valid configuration values', () => {
      const errors = validatePreset(DEVELOPMENT);
      expect(errors).toHaveLength(0);
    });

    it('should have short TTLs for rapid iteration', () => {
      expect(DEVELOPMENT.ttl.defaultTtl).toBe(300); // 5 minutes
      expect(DEVELOPMENT.ttl.credsTtl).toBe(3600); // 1 hour
      expect(DEVELOPMENT.ttl.keysTtl).toBe(3600); // 1 hour
    });

    it('should have encryption disabled for debugging', () => {
      expect(DEVELOPMENT.security.enableEncryption).toBe(false);
      expect(DEVELOPMENT.security.enableCompression).toBe(false);
    });

    it('should have detailed logging enabled', () => {
      expect(DEVELOPMENT.observability.enableDetailedLogs).toBe(true);
      expect(DEVELOPMENT.security.enableDebugLogging).toBe(true);
    });

    it('should have longer timeouts for debugging', () => {
      expect(DEVELOPMENT.resilience.operationTimeout).toBe(10000); // 10s
    });
  });

  describe('PRODUCTION preset', () => {
    it('should have valid configuration values', () => {
      const errors = validatePreset(PRODUCTION);
      expect(errors).toHaveLength(0);
    });

    it('should have longer TTLs to minimize database load', () => {
      expect(PRODUCTION.ttl.defaultTtl).toBe(3600); // 1 hour
      expect(PRODUCTION.ttl.credsTtl).toBe(604800); // 7 days
      expect(PRODUCTION.ttl.keysTtl).toBe(604800); // 7 days
    });

    it('should have encryption enabled for security', () => {
      expect(PRODUCTION.security.enableEncryption).toBe(true);
      expect(PRODUCTION.security.enableCompression).toBe(true);
      expect(PRODUCTION.security.encryptionAlgorithm).toBe('aes-256-gcm');
    });

    it('should have minimal logging to reduce I/O', () => {
      expect(PRODUCTION.observability.enableDetailedLogs).toBe(false);
      expect(PRODUCTION.security.enableDebugLogging).toBe(false);
    });

    it('should have aggressive timeouts for fast failures', () => {
      expect(PRODUCTION.resilience.operationTimeout).toBe(5000); // 5s
      expect(PRODUCTION.resilience.maxRetries).toBe(3);
    });

    it('should have metrics enabled for monitoring', () => {
      expect(PRODUCTION.observability.enableMetrics).toBe(true);
    });
  });

  describe('TESTING preset', () => {
    it('should have valid configuration values', () => {
      const errors = validatePreset(TESTING);
      expect(errors).toHaveLength(0);
    });

    it('should have very short TTLs for quick test execution', () => {
      expect(TESTING.ttl.defaultTtl).toBe(30); // 30 seconds
      expect(TESTING.ttl.credsTtl).toBe(60); // 1 minute
      expect(TESTING.ttl.keysTtl).toBe(60); // 1 minute
      expect(TESTING.ttl.lockTtl).toBe(1); // 1 second
    });

    it('should have encryption disabled for test speed', () => {
      expect(TESTING.security.enableEncryption).toBe(false);
      expect(TESTING.security.enableCompression).toBe(false);
    });

    it('should have minimal logging for quiet tests', () => {
      expect(TESTING.observability.enableDetailedLogs).toBe(false);
      expect(TESTING.security.enableDebugLogging).toBe(false);
    });

    it('should have fast timeouts for fail-fast', () => {
      expect(TESTING.resilience.operationTimeout).toBe(2000); // 2s
      expect(TESTING.resilience.maxRetries).toBe(1); // Single retry
    });

    it('should have metrics disabled to reduce overhead', () => {
      expect(TESTING.observability.enableMetrics).toBe(false);
    });
  });

  describe('Preset Registry', () => {
    it('should have all three presets registered', () => {
      expect(PRESETS.DEVELOPMENT).toBeDefined();
      expect(PRESETS.PRODUCTION).toBeDefined();
      expect(PRESETS.TESTING).toBeDefined();
    });

    it('should allow getting presets by name', () => {
      expect(getPreset('DEVELOPMENT')).toBe(DEVELOPMENT);
      expect(getPreset('PRODUCTION')).toBe(PRODUCTION);
      expect(getPreset('TESTING')).toBe(TESTING);
    });
  });

  describe('validatePreset', () => {
    it('should reject negative TTLs', () => {
      const invalidPreset = {
        ...DEVELOPMENT,
        ttl: {
          ...DEVELOPMENT.ttl,
          defaultTtl: -1,
        },
      };
      const errors = validatePreset(invalidPreset);
      expect(errors).toContain('defaultTtl must be at least 1 second');
    });

    it('should reject operation timeout less than 100ms', () => {
      const invalidPreset = {
        ...DEVELOPMENT,
        resilience: {
          ...DEVELOPMENT.resilience,
          operationTimeout: 50,
        },
      };
      const errors = validatePreset(invalidPreset);
      expect(errors).toContain('operationTimeout must be at least 100ms');
    });

    it('should reject maxRetries greater than 10', () => {
      const invalidPreset = {
        ...DEVELOPMENT,
        resilience: {
          ...DEVELOPMENT.resilience,
          maxRetries: 15,
        },
      };
      const errors = validatePreset(invalidPreset);
      expect(errors).toContain('maxRetries must be between 0 and 10');
    });

    it('should reject negative retryBaseDelay', () => {
      const invalidPreset = {
        ...DEVELOPMENT,
        resilience: {
          ...DEVELOPMENT.resilience,
          retryBaseDelay: -10,
        },
      };
      const errors = validatePreset(invalidPreset);
      expect(errors).toContain('retryBaseDelay must be non-negative');
    });

    it('should reject retryMultiplier less than 1', () => {
      const invalidPreset = {
        ...DEVELOPMENT,
        resilience: {
          ...DEVELOPMENT.resilience,
          retryMultiplier: 0.5,
        },
      };
      const errors = validatePreset(invalidPreset);
      expect(errors).toContain('retryMultiplier must be at least 1');
    });

    it('should reject keyRotationDays less than 1 when encryption enabled', () => {
      const invalidPreset = {
        ...PRODUCTION,
        security: {
          ...PRODUCTION.security,
          enableEncryption: true,
          keyRotationDays: 0,
        },
      };
      const errors = validatePreset(invalidPreset);
      expect(errors).toContain('keyRotationDays must be at least 1 day when encryption is enabled');
    });

    it('should accept keyRotationDays less than 1 when encryption disabled', () => {
      const validPreset = {
        ...DEVELOPMENT,
        security: {
          ...DEVELOPMENT.security,
          enableEncryption: false,
          keyRotationDays: 0,
        },
      };
      const errors = validatePreset(validPreset);
      expect(errors).not.toContain(
        'keyRotationDays must be at least 1 day when encryption is enabled',
      );
    });

    it('should reject credsTtl less than 1', () => {
      const invalidPreset = {
        ...DEVELOPMENT,
        ttl: {
          ...DEVELOPMENT.ttl,
          credsTtl: 0,
        },
      };
      const errors = validatePreset(invalidPreset);
      expect(errors).toContain('credsTtl must be at least 1 second');
    });

    it('should reject keysTtl less than 1', () => {
      const invalidPreset = {
        ...DEVELOPMENT,
        ttl: {
          ...DEVELOPMENT.ttl,
          keysTtl: 0,
        },
      };
      const errors = validatePreset(invalidPreset);
      expect(errors).toContain('keysTtl must be at least 1 second');
    });

    it('should reject lockTtl less than 1', () => {
      const invalidPreset = {
        ...DEVELOPMENT,
        ttl: {
          ...DEVELOPMENT.ttl,
          lockTtl: 0,
        },
      };
      const errors = validatePreset(invalidPreset);
      expect(errors).toContain('lockTtl must be at least 1 second');
    });
  });

  describe('createHybridConfigFromPreset', () => {
    it('should create config from PRODUCTION preset', () => {
      const config = createHybridConfigFromPreset('PRODUCTION', {
        mongoUrl: 'mongodb://localhost:27017',
        mongoDatabase: 'test_db',
        mongoCollection: 'sessions',
        redisUrl: 'redis://localhost:6379',
        masterKey: 'test-master-key',
      });

      expect(config.mongoUrl).toBe('mongodb://localhost:27017');
      expect(config.mongoDatabase).toBe('test_db');
      expect(config.mongoCollection).toBe('sessions');
      expect(config.redisUrl).toBe('redis://localhost:6379');
      expect(config.masterKey).toBe('test-master-key');
      expect(config.ttl).toEqual(PRODUCTION.ttl);
      expect(config.resilience).toEqual(PRODUCTION.resilience);
      expect(config.security).toEqual(PRODUCTION.security);
      expect(config.observability).toEqual(PRODUCTION.observability);
    });

    it('should use default values when overrides are empty', () => {
      const config = createHybridConfigFromPreset('DEVELOPMENT', {});

      expect(config.mongoUrl).toBe('');
      expect(config.mongoDatabase).toBe('baileys_store');
      expect(config.mongoCollection).toBe('sessions');
      expect(config.redisUrl).toBeUndefined();
      expect(config.masterKey).toBeUndefined();
    });

    it('should set default writeBehind settings', () => {
      const config = createHybridConfigFromPreset('TESTING', {});

      expect(config.enableWriteBehind).toBe(false);
      expect(config.writeBehindFlushInterval).toBe(1000);
      expect(config.writeBehindQueueSize).toBe(1000);
    });

    it('should create config from each preset type', () => {
      const presetNames: ('DEVELOPMENT' | 'PRODUCTION' | 'TESTING')[] = [
        'DEVELOPMENT',
        'PRODUCTION',
        'TESTING',
      ];

      for (const presetName of presetNames) {
        const config = createHybridConfigFromPreset(presetName, {
          mongoUrl: 'mongodb://test',
        });

        expect(config.ttl).toEqual(PRESETS[presetName].ttl);
        expect(config.resilience).toEqual(PRESETS[presetName].resilience);
      }
    });
  });
});
