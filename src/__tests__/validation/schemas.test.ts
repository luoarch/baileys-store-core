/**
 * @baileys-store/core - Validation Schemas Tests
 *
 * Unit tests for Zod validation schemas
 */

import { describe, it, expect } from 'vitest';
import {
  TtlConfigSchema,
  ResilienceConfigSchema,
  SecurityConfigSchema,
  HybridStoreConfigSchema,
  ConfigPresetSchema,
} from '../../validation/schemas.js';
import { DEVELOPMENT, PRODUCTION, TESTING } from '../../config/presets.js';

describe('Validation Schemas', () => {
  describe('TtlConfigSchema', () => {
    it('should validate valid TTL config', () => {
      const valid = {
        defaultTtl: 3600,
        credsTtl: 604800,
        keysTtl: 604800,
        lockTtl: 5,
      };

      const result = TtlConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject negative TTL values', () => {
      const invalid = {
        defaultTtl: -1,
        credsTtl: 3600,
        keysTtl: 3600,
        lockTtl: 5,
      };

      const result = TtlConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.message).toContain('at least 1 second');
      }
    });

    it('should reject non-integer TTL values', () => {
      const invalid = {
        defaultTtl: 3600.5,
        credsTtl: 604800,
        keysTtl: 604800,
        lockTtl: 5,
      };

      const result = TtlConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('ResilienceConfigSchema', () => {
    it('should validate valid resilience config', () => {
      const valid = {
        operationTimeout: 5000,
        maxRetries: 3,
        retryBaseDelay: 100,
        retryMultiplier: 2,
      };

      const result = ResilienceConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject timeout below 100ms', () => {
      const invalid = {
        operationTimeout: 50,
        maxRetries: 3,
        retryBaseDelay: 100,
        retryMultiplier: 2,
      };

      const result = ResilienceConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject timeout above 60s', () => {
      const invalid = {
        operationTimeout: 61000,
        maxRetries: 3,
        retryBaseDelay: 100,
        retryMultiplier: 2,
      };

      const result = ResilienceConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject maxRetries above 10', () => {
      const invalid = {
        operationTimeout: 5000,
        maxRetries: 11,
        retryBaseDelay: 100,
        retryMultiplier: 2,
      };

      const result = ResilienceConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject retryMultiplier below 1', () => {
      const invalid = {
        operationTimeout: 5000,
        maxRetries: 3,
        retryBaseDelay: 100,
        retryMultiplier: 0.5,
      };

      const result = ResilienceConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('SecurityConfigSchema', () => {
    it('should validate valid security config', () => {
      const valid = {
        enableEncryption: true,
        enableCompression: true,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
        enableDebugLogging: false,
        environment: 'production',
      };

      const result = SecurityConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject invalid encryptionAlgorithm', () => {
      const invalid = {
        enableEncryption: true,
        enableCompression: true,
        encryptionAlgorithm: 'invalid-algo',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 90,
        enableDebugLogging: false,
        environment: 'production',
      };

      const result = SecurityConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should enforce keyRotationDays when encryption is enabled', () => {
      const invalid = {
        enableEncryption: true,
        enableCompression: true,
        encryptionAlgorithm: 'aes-256-gcm',
        compressionAlgorithm: 'snappy',
        keyRotationDays: 0, // Invalid when encryption enabled
        enableDebugLogging: false,
        environment: 'production',
      };

      const result = SecurityConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.some(e => e.message.includes('keyRotationDays'))).toBe(true);
      }
    });
  });

  describe('HybridStoreConfigSchema', () => {
    it('should validate complete config', () => {
      const valid = {
        mongoUrl: 'mongodb://localhost:27017',
        mongoDatabase: 'baileys_store',
        mongoCollection: 'sessions',
        redisUrl: 'redis://localhost:6379',
        ttl: {
          defaultTtl: 3600,
          credsTtl: 604800,
          keysTtl: 604800,
          lockTtl: 5,
        },
        resilience: {
          operationTimeout: 5000,
          maxRetries: 3,
          retryBaseDelay: 100,
          retryMultiplier: 2,
        },
        security: {
          enableEncryption: true,
          enableCompression: true,
          encryptionAlgorithm: 'aes-256-gcm',
          compressionAlgorithm: 'snappy',
          keyRotationDays: 90,
          enableDebugLogging: false,
          environment: 'production',
        },
        observability: {
          enableMetrics: true,
          enableTracing: false,
          enableDetailedLogs: false,
          metricsInterval: 60000,
        },
        masterKey: 'a'.repeat(64),
      };

      const result = HybridStoreConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should require masterKey when encryption is enabled', () => {
      const invalid = {
        mongoUrl: 'mongodb://localhost:27017',
        mongoDatabase: 'baileys_store',
        mongoCollection: 'sessions',
        ttl: {
          defaultTtl: 3600,
          credsTtl: 604800,
          keysTtl: 604800,
          lockTtl: 5,
        },
        resilience: {
          operationTimeout: 5000,
          maxRetries: 3,
          retryBaseDelay: 100,
          retryMultiplier: 2,
        },
        security: {
          enableEncryption: true,
          enableCompression: true,
          encryptionAlgorithm: 'aes-256-gcm',
          compressionAlgorithm: 'snappy',
          keyRotationDays: 90,
          enableDebugLogging: false,
          environment: 'production',
        },
        observability: {
          enableMetrics: true,
          enableTracing: false,
          enableDetailedLogs: false,
          metricsInterval: 60000,
        },
        // Missing masterKey
      };

      const result = HybridStoreConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.some(e => e.message.includes('masterKey'))).toBe(true);
      }
    });

    it('should require mongoUrl', () => {
      const invalid = {
        mongoDatabase: 'baileys_store',
        mongoCollection: 'sessions',
        // Missing required fields...
        ttl: DEVELOPMENT.ttl,
        resilience: DEVELOPMENT.resilience,
        security: DEVELOPMENT.security,
        observability: DEVELOPMENT.observability,
      };

      const result = HybridStoreConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('ConfigPresetSchema', () => {
    it('should validate DEVELOPMENT preset', () => {
      const result = ConfigPresetSchema.safeParse(DEVELOPMENT);
      expect(result.success).toBe(true);
    });

    it('should validate PRODUCTION preset', () => {
      const result = ConfigPresetSchema.safeParse(PRODUCTION);
      expect(result.success).toBe(true);
    });

    it('should validate TESTING preset', () => {
      const result = ConfigPresetSchema.safeParse(TESTING);
      expect(result.success).toBe(true);
    });
  });
});
