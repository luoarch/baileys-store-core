/**
 * LID Mapping Cache Tests
 */

import { describe, expect, it, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';

import { LIDMappingCache, DEFAULT_LID_CACHE_CONFIG } from '../../identity/lid-cache.js';

describe('LIDMappingCache', () => {
  let redis: Redis;
  let cache: LIDMappingCache;

  beforeEach(() => {
    redis = new RedisMock() as unknown as Redis;
    cache = new LIDMappingCache(redis);
  });

  describe('constructor', () => {
    it('should use default config', () => {
      const config = cache.getConfig();
      expect(config.lidKeyPrefix).toBe(DEFAULT_LID_CACHE_CONFIG.lidKeyPrefix);
      expect(config.pnKeyPrefix).toBe(DEFAULT_LID_CACHE_CONFIG.pnKeyPrefix);
    });

    it('should accept custom config', () => {
      const customCache = new LIDMappingCache(redis, {
        lidKeyPrefix: 'custom:lid:',
        ttlSeconds: 3600,
      });
      const config = customCache.getConfig();
      expect(config.lidKeyPrefix).toBe('custom:lid:');
      expect(config.ttlSeconds).toBe(3600);
    });
  });

  describe('storeMapping', () => {
    it('should store a single mapping', async () => {
      await cache.storeMapping('lid123', '5511999999999@s.whatsapp.net');

      const pn = await cache.getPNForLID('lid123');
      expect(pn).toBe('5511999999999@s.whatsapp.net');
    });

    it('should store bidirectional mapping', async () => {
      await cache.storeMapping('lid123', '5511999999999@s.whatsapp.net');

      const lid = await cache.getLIDForPN('5511999999999@s.whatsapp.net');
      expect(lid).toBe('lid123');
    });
  });

  describe('storeMappings', () => {
    it('should store multiple mappings atomically', async () => {
      await cache.storeMappings([
        { lid: 'lid1', pn: '5511111111111@s.whatsapp.net' },
        { lid: 'lid2', pn: '5522222222222@s.whatsapp.net' },
        { lid: 'lid3', pn: '5533333333333@s.whatsapp.net' },
      ]);

      expect(await cache.getPNForLID('lid1')).toBe('5511111111111@s.whatsapp.net');
      expect(await cache.getPNForLID('lid2')).toBe('5522222222222@s.whatsapp.net');
      expect(await cache.getPNForLID('lid3')).toBe('5533333333333@s.whatsapp.net');
    });

    it('should handle empty array', async () => {
      await expect(cache.storeMappings([])).resolves.not.toThrow();
    });
  });

  describe('getPNForLID', () => {
    it('should return null for unknown LID', async () => {
      const pn = await cache.getPNForLID('unknown');
      expect(pn).toBeNull();
    });

    it('should return stored PN', async () => {
      await cache.storeMapping('lid123', '5511999999999@s.whatsapp.net');
      const pn = await cache.getPNForLID('lid123');
      expect(pn).toBe('5511999999999@s.whatsapp.net');
    });
  });

  describe('getLIDForPN', () => {
    it('should return null for unknown PN', async () => {
      const lid = await cache.getLIDForPN('unknown@s.whatsapp.net');
      expect(lid).toBeNull();
    });

    it('should return stored LID', async () => {
      await cache.storeMapping('lid123', '5511999999999@s.whatsapp.net');
      const lid = await cache.getLIDForPN('5511999999999@s.whatsapp.net');
      expect(lid).toBe('lid123');
    });
  });

  describe('getMapping', () => {
    it('should return null for unknown LID', async () => {
      const mapping = await cache.getMapping('unknown');
      expect(mapping).toBeNull();
    });

    it('should return full mapping with metadata', async () => {
      await cache.storeMapping('lid123', '5511999999999@s.whatsapp.net');
      const mapping = await cache.getMapping('lid123');

      expect(mapping).not.toBeNull();
      expect(mapping?.lid).toBe('lid123');
      expect(mapping?.pn).toBe('5511999999999@s.whatsapp.net');
      expect(mapping?.storedAt).toBeInstanceOf(Date);
    });
  });

  describe('hasLID', () => {
    it('should return false for unknown LID', async () => {
      expect(await cache.hasLID('unknown')).toBe(false);
    });

    it('should return true for known LID', async () => {
      await cache.storeMapping('lid123', '5511999999999@s.whatsapp.net');
      expect(await cache.hasLID('lid123')).toBe(true);
    });
  });

  describe('hasPN', () => {
    it('should return false for unknown PN', async () => {
      expect(await cache.hasPN('unknown@s.whatsapp.net')).toBe(false);
    });

    it('should return true for known PN', async () => {
      await cache.storeMapping('lid123', '5511999999999@s.whatsapp.net');
      expect(await cache.hasPN('5511999999999@s.whatsapp.net')).toBe(true);
    });
  });

  describe('deleteMapping', () => {
    it('should delete both LID and PN mappings', async () => {
      await cache.storeMapping('lid123', '5511999999999@s.whatsapp.net');

      await cache.deleteMapping('lid123');

      expect(await cache.hasLID('lid123')).toBe(false);
      expect(await cache.hasPN('5511999999999@s.whatsapp.net')).toBe(false);
    });

    it('should handle deleting unknown LID', async () => {
      await expect(cache.deleteMapping('unknown')).resolves.not.toThrow();
    });
  });

  describe('batchGetPNForLIDs', () => {
    it('should return map of LIDs to PNs', async () => {
      const batchRedis = new RedisMock() as unknown as Redis;
      const batchCache = new LIDMappingCache(batchRedis, {
        lidKeyPrefix: 'batch-test:lid:',
        pnKeyPrefix: 'batch-test:pn:',
      });

      await batchCache.storeMappings([
        { lid: 'lid1', pn: '5511111111111@s.whatsapp.net' },
        { lid: 'lid2', pn: '5522222222222@s.whatsapp.net' },
      ]);

      const result = await batchCache.batchGetPNForLIDs(['lid1', 'lid2']);

      expect(result.get('lid1')).toBe('5511111111111@s.whatsapp.net');
      expect(result.get('lid2')).toBe('5522222222222@s.whatsapp.net');
    });

    it('should return null for unknown LIDs', async () => {
      const batchRedis = new RedisMock() as unknown as Redis;
      const batchCache = new LIDMappingCache(batchRedis, {
        lidKeyPrefix: 'batch-null:lid:',
        pnKeyPrefix: 'batch-null:pn:',
      });

      await batchCache.storeMapping('known-lid', '5511111111111@s.whatsapp.net');

      const result = await batchCache.batchGetPNForLIDs(['known-lid', 'unknown-lid']);

      expect(result.get('known-lid')).toBe('5511111111111@s.whatsapp.net');
      expect(result.get('unknown-lid')).toBeNull();
    });

    it('should handle invalid JSON gracefully', async () => {
      const batchRedis = new RedisMock() as unknown as Redis;
      const batchCache = new LIDMappingCache(batchRedis, {
        lidKeyPrefix: 'batch-invalid:lid:',
        pnKeyPrefix: 'batch-invalid:pn:',
        enableTimestamps: true,
      });

      await batchRedis.set('batch-invalid:lid:bad-json', 'not-valid-json');

      const result = await batchCache.batchGetPNForLIDs(['bad-json']);

      expect(result.get('bad-json')).toBe('not-valid-json');
    });

    it('should work with timestamps disabled', async () => {
      const batchRedis = new RedisMock() as unknown as Redis;
      const batchCache = new LIDMappingCache(batchRedis, {
        lidKeyPrefix: 'batch-nots:lid:',
        pnKeyPrefix: 'batch-nots:pn:',
        enableTimestamps: false,
      });

      await batchCache.storeMapping('nots-lid', '5511111111111@s.whatsapp.net');

      const result = await batchCache.batchGetPNForLIDs(['nots-lid']);

      expect(result.get('nots-lid')).toBe('5511111111111@s.whatsapp.net');
    });

    it('should handle empty array', async () => {
      const result = await cache.batchGetPNForLIDs([]);
      expect(result.size).toBe(0);
    });
  });

  describe('TTL support', () => {
    it('should store with TTL when configured', async () => {
      const ttlCache = new LIDMappingCache(redis, { ttlSeconds: 3600 });

      await ttlCache.storeMapping('lid123', '5511999999999@s.whatsapp.net');

      const pn = await ttlCache.getPNForLID('lid123');
      expect(pn).toBe('5511999999999@s.whatsapp.net');
    });
  });

  describe('timestamp parsing edge cases', () => {
    it('should handle invalid JSON in getPNForLID with timestamps enabled', async () => {
      const tsRedis = new RedisMock() as unknown as Redis;
      const tsCache = new LIDMappingCache(tsRedis, {
        lidKeyPrefix: 'ts-invalid:lid:',
        pnKeyPrefix: 'ts-invalid:pn:',
        enableTimestamps: true,
      });

      // Store invalid JSON directly
      await tsRedis.set('ts-invalid:lid:bad-json-lid', 'not-valid-json');

      const pn = await tsCache.getPNForLID('bad-json-lid');
      // Should return raw value when JSON parsing fails
      expect(pn).toBe('not-valid-json');
    });

    it('should handle invalid JSON in getLIDForPN with timestamps enabled', async () => {
      const tsRedis = new RedisMock() as unknown as Redis;
      const tsCache = new LIDMappingCache(tsRedis, {
        lidKeyPrefix: 'ts-pn-invalid:lid:',
        pnKeyPrefix: 'ts-pn-invalid:pn:',
        enableTimestamps: true,
      });

      // Store invalid JSON directly
      await tsRedis.set('ts-pn-invalid:pn:bad-pn@s.whatsapp.net', 'not-valid-json');

      const lid = await tsCache.getLIDForPN('bad-pn@s.whatsapp.net');
      // Should return raw value when JSON parsing fails
      expect(lid).toBe('not-valid-json');
    });

    it('should handle invalid JSON in getMapping with timestamps enabled', async () => {
      const tsRedis = new RedisMock() as unknown as Redis;
      const tsCache = new LIDMappingCache(tsRedis, {
        lidKeyPrefix: 'ts-map-invalid:lid:',
        pnKeyPrefix: 'ts-map-invalid:pn:',
        enableTimestamps: true,
      });

      // Store invalid JSON directly
      await tsRedis.set('ts-map-invalid:lid:bad-map-lid', 'not-valid-json');

      const mapping = await tsCache.getMapping('bad-map-lid');
      expect(mapping).not.toBeNull();
      expect(mapping?.pn).toBe('not-valid-json');
      expect(mapping?.storedAt).toEqual(new Date(0));
    });

    it('should return mapping with timestamps disabled', async () => {
      const noTsRedis = new RedisMock() as unknown as Redis;
      const noTsCache = new LIDMappingCache(noTsRedis, {
        lidKeyPrefix: 'nots-map:lid:',
        pnKeyPrefix: 'nots-map:pn:',
        enableTimestamps: false,
      });

      await noTsCache.storeMapping('nots-lid', '5511111111111@s.whatsapp.net');

      const mapping = await noTsCache.getMapping('nots-lid');
      expect(mapping).not.toBeNull();
      expect(mapping?.lid).toBe('nots-lid');
      expect(mapping?.pn).toBe('5511111111111@s.whatsapp.net');
      expect(mapping?.storedAt).toEqual(new Date(0));
    });

    it('should return LID with timestamps disabled via getLIDForPN', async () => {
      const noTsRedis = new RedisMock() as unknown as Redis;
      const noTsCache = new LIDMappingCache(noTsRedis, {
        lidKeyPrefix: 'nots-lid:lid:',
        pnKeyPrefix: 'nots-lid:pn:',
        enableTimestamps: false,
      });

      await noTsCache.storeMapping('nots-lid2', '5522222222222@s.whatsapp.net');

      const lid = await noTsCache.getLIDForPN('5522222222222@s.whatsapp.net');
      expect(lid).toBe('nots-lid2');
    });
  });

  describe('timestamp disabled', () => {
    it('should store raw values when timestamps disabled', async () => {
      const noTsCache = new LIDMappingCache(redis, { enableTimestamps: false });

      await noTsCache.storeMapping('lid123', '5511999999999@s.whatsapp.net');

      const pn = await noTsCache.getPNForLID('lid123');
      expect(pn).toBe('5511999999999@s.whatsapp.net');
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', async () => {
      const freshRedis = new RedisMock() as unknown as Redis;
      const freshCache = new LIDMappingCache(freshRedis, {
        lidKeyPrefix: 'stats-test:lid:',
        pnKeyPrefix: 'stats-test:pn:',
      });

      await freshCache.storeMappings([
        { lid: 'stat-lid1', pn: '5511111111111@s.whatsapp.net' },
        { lid: 'stat-lid2', pn: '5522222222222@s.whatsapp.net' },
      ]);

      const stats = await freshCache.getStats();
      expect(stats.lidMappings).toBe(2);
      expect(stats.pnMappings).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all mappings', async () => {
      await cache.storeMappings([
        { lid: 'lid1', pn: '5511111111111@s.whatsapp.net' },
        { lid: 'lid2', pn: '5522222222222@s.whatsapp.net' },
      ]);

      await cache.clear();

      const stats = await cache.getStats();
      expect(stats.lidMappings).toBe(0);
      expect(stats.pnMappings).toBe(0);
    });
  });
});
