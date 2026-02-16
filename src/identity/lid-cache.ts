/**
 * @baileys-store/core - LID Mapping Cache
 *
 * Redis-backed cache for LID (Local Identifier) to PN (Phone Number) mappings.
 * Provides reliable identity resolution when Baileys lid-mapping.update event is unreliable.
 *
 * @see https://github.com/WhiskeySockets/Baileys/issues/2263
 * @see https://baileys.wiki/docs/migration/to-v7.0.0/
 * @since 1.1.0
 */

import type { Redis } from 'ioredis';

/**
 * LID to PN mapping entry.
 */
export interface LIDMapping {
  /** Local Identifier (LID) */
  lid: string;
  /** Phone Number (PN) in format: number@s.whatsapp.net */
  pn: string;
  /** When this mapping was stored */
  storedAt: Date;
}

/**
 * Configuration for the LID mapping cache.
 */
export interface LIDCacheConfig {
  /** Key prefix for LID->PN mappings */
  lidKeyPrefix?: string;
  /** Key prefix for PN->LID mappings */
  pnKeyPrefix?: string;
  /** TTL for mappings in seconds (0 = no expiration) */
  ttlSeconds?: number;
  /** Enable timestamps in stored values */
  enableTimestamps?: boolean;
}

/**
 * Cache statistics.
 */
export interface LIDCacheStats {
  /** Total LID->PN mappings stored */
  lidMappings: number;
  /** Total PN->LID mappings stored */
  pnMappings: number;
}

/**
 * Default LID cache configuration.
 */
export const DEFAULT_LID_CACHE_CONFIG: Required<LIDCacheConfig> = {
  lidKeyPrefix: 'baileys:lid-mapping:',
  pnKeyPrefix: 'baileys:pn-mapping:',
  ttlSeconds: 0,
  enableTimestamps: true,
};

/**
 * Redis-backed cache for LID to PN mappings.
 *
 * Baileys v7 uses LID (Local Identifier) by default, but the lid-mapping.update
 * event doesn't fire consistently. This cache provides a reliable way to resolve
 * identities by storing bidirectional mappings.
 *
 * @example
 * ```typescript
 * const cache = new LIDMappingCache(redis);
 *
 * // Store mappings from Baileys signalRepository
 * await cache.storeMappings([
 *   { lid: 'ABC123...', pn: '5511999999999@s.whatsapp.net' }
 * ]);
 *
 * // Resolve LID to phone number
 * const pn = await cache.getPNForLID('ABC123...');
 *
 * // Resolve phone number to LID
 * const lid = await cache.getLIDForPN('5511999999999@s.whatsapp.net');
 * ```
 */
export class LIDMappingCache {
  private readonly redis: Redis;
  private readonly config: Required<LIDCacheConfig>;

  constructor(redis: Redis, config: Partial<LIDCacheConfig> = {}) {
    this.redis = redis;
    this.config = { ...DEFAULT_LID_CACHE_CONFIG, ...config };
  }

  /**
   * Stores multiple LID-PN mappings atomically using Redis pipeline.
   *
   * @param mappings - Array of LID/PN pairs to store
   */
  async storeMappings(mappings: { lid: string; pn: string }[]): Promise<void> {
    if (mappings.length === 0) {
      return;
    }

    const pipeline = this.redis.pipeline();
    const timestamp = this.config.enableTimestamps ? Date.now().toString() : null;

    for (const { lid, pn } of mappings) {
      const lidKey = `${this.config.lidKeyPrefix}${lid}`;
      const pnKey = `${this.config.pnKeyPrefix}${pn}`;

      const value = timestamp ? JSON.stringify({ value: pn, storedAt: timestamp }) : pn;
      const reverseValue = timestamp ? JSON.stringify({ value: lid, storedAt: timestamp }) : lid;

      if (this.config.ttlSeconds > 0) {
        pipeline.setex(lidKey, this.config.ttlSeconds, value);
        pipeline.setex(pnKey, this.config.ttlSeconds, reverseValue);
      } else {
        pipeline.set(lidKey, value);
        pipeline.set(pnKey, reverseValue);
      }
    }

    await pipeline.exec();
  }

  /**
   * Stores a single LID-PN mapping.
   *
   * @param lid - Local Identifier
   * @param pn - Phone Number
   */
  async storeMapping(lid: string, pn: string): Promise<void> {
    await this.storeMappings([{ lid, pn }]);
  }

  /**
   * Resolves a LID to its corresponding phone number.
   *
   * @param lid - Local Identifier
   * @returns Phone number or null if not found
   */
  async getPNForLID(lid: string): Promise<string | null> {
    const key = `${this.config.lidKeyPrefix}${lid}`;
    const value = await this.redis.get(key);

    if (!value) {
      return null;
    }

    if (this.config.enableTimestamps) {
      try {
        const parsed = JSON.parse(value) as { value: string };
        return parsed.value;
      } catch {
        return value;
      }
    }

    return value;
  }

  /**
   * Resolves a phone number to its corresponding LID.
   *
   * @param pn - Phone Number
   * @returns LID or null if not found
   */
  async getLIDForPN(pn: string): Promise<string | null> {
    const key = `${this.config.pnKeyPrefix}${pn}`;
    const value = await this.redis.get(key);

    if (!value) {
      return null;
    }

    if (this.config.enableTimestamps) {
      try {
        const parsed = JSON.parse(value) as { value: string };
        return parsed.value;
      } catch {
        return value;
      }
    }

    return value;
  }

  /**
   * Gets the full mapping entry including metadata.
   *
   * @param lid - Local Identifier
   * @returns Full mapping entry or null if not found
   */
  async getMapping(lid: string): Promise<LIDMapping | null> {
    const key = `${this.config.lidKeyPrefix}${lid}`;
    const value = await this.redis.get(key);

    if (!value) {
      return null;
    }

    if (this.config.enableTimestamps) {
      try {
        const parsed = JSON.parse(value) as { value: string; storedAt: string };
        return {
          lid,
          pn: parsed.value,
          storedAt: new Date(parseInt(parsed.storedAt, 10)),
        };
      } catch {
        return { lid, pn: value, storedAt: new Date(0) };
      }
    }

    return { lid, pn: value, storedAt: new Date(0) };
  }

  /**
   * Checks if a LID mapping exists.
   *
   * @param lid - Local Identifier
   * @returns true if mapping exists
   */
  async hasLID(lid: string): Promise<boolean> {
    const key = `${this.config.lidKeyPrefix}${lid}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Checks if a PN mapping exists.
   *
   * @param pn - Phone Number
   * @returns true if mapping exists
   */
  async hasPN(pn: string): Promise<boolean> {
    const key = `${this.config.pnKeyPrefix}${pn}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Deletes a LID-PN mapping.
   *
   * @param lid - Local Identifier
   */
  async deleteMapping(lid: string): Promise<void> {
    const pn = await this.getPNForLID(lid);

    const pipeline = this.redis.pipeline();
    pipeline.del(`${this.config.lidKeyPrefix}${lid}`);

    if (pn) {
      pipeline.del(`${this.config.pnKeyPrefix}${pn}`);
    }

    await pipeline.exec();
  }

  /**
   * Bulk resolves multiple LIDs to phone numbers.
   *
   * @param lids - Array of Local Identifiers
   * @returns Map of LID to phone number (null if not found)
   */
  async batchGetPNForLIDs(lids: string[]): Promise<Map<string, string | null>> {
    if (lids.length === 0) {
      return new Map();
    }

    const pipeline = this.redis.pipeline();
    const keys = lids.map((lid) => `${this.config.lidKeyPrefix}${lid}`);

    for (const key of keys) {
      pipeline.get(key);
    }

    const results = await pipeline.exec();
    const mapping = new Map<string, string | null>();

    for (let i = 0; i < lids.length; i++) {
      const lid = lids[i];
      if (!lid) continue;

      const result = results?.[i];
      const value = result?.[1] as string | null;

      if (!value) {
        mapping.set(lid, null);
        continue;
      }

      if (this.config.enableTimestamps) {
        try {
          const parsed = JSON.parse(value) as { value: string };
          mapping.set(lid, parsed.value);
        } catch {
          mapping.set(lid, value);
        }
      } else {
        mapping.set(lid, value);
      }
    }

    return mapping;
  }

  /**
   * Gets cache statistics using Redis SCAN.
   * Note: This operation may be slow on large datasets.
   */
  async getStats(): Promise<LIDCacheStats> {
    let lidCount = 0;
    let pnCount = 0;
    let cursor = '0';

    do {
      const [newCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.config.lidKeyPrefix}*`,
        'COUNT',
        1000,
      );
      cursor = newCursor;
      lidCount += keys.length;
    } while (cursor !== '0');

    cursor = '0';
    do {
      const [newCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.config.pnKeyPrefix}*`,
        'COUNT',
        1000,
      );
      cursor = newCursor;
      pnCount += keys.length;
    } while (cursor !== '0');

    return {
      lidMappings: lidCount,
      pnMappings: pnCount,
    };
  }

  /**
   * Clears all LID mappings.
   * Warning: This operation deletes all cached mappings.
   */
  async clear(): Promise<void> {
    let cursor = '0';
    const keysToDelete: string[] = [];

    do {
      const [newCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.config.lidKeyPrefix}*`,
        'COUNT',
        1000,
      );
      cursor = newCursor;
      keysToDelete.push(...keys);
    } while (cursor !== '0');

    cursor = '0';
    do {
      const [newCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.config.pnKeyPrefix}*`,
        'COUNT',
        1000,
      );
      cursor = newCursor;
      keysToDelete.push(...keys);
    } while (cursor !== '0');

    if (keysToDelete.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const key of keysToDelete) {
        pipeline.del(key);
      }
      await pipeline.exec();
    }
  }

  /**
   * Returns the current configuration.
   */
  getConfig(): Readonly<Required<LIDCacheConfig>> {
    return { ...this.config };
  }
}
