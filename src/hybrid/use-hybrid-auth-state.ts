/**
 * @baileys-store/core - Hybrid Auth State Hook
 *
 * Baileys-compatible hook for hybrid Redis+MongoDB authentication state
 * Combines hot cache (Redis) with cold storage (MongoDB) and optional queue integration
 */

import type { AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { initAuthCreds, proto } from '@whiskeysockets/baileys';
import type { UseHybridAuthStateOptions } from '../types/config.js';
import { createHybridStore, type HybridAuthStore } from './store.js';
import { createRedisStore } from '../redis/store.js';
import { createMongoStore } from '../mongodb/store.js';
import { createCryptoService } from '../crypto/index.js';
import { createCodecService } from '../crypto/codec.js';
import { DEFAULT_SECURITY_CONFIG } from '../types/index.js';

/**
 * Hybrid-based auth state hook
 * Compatible with useMultiFileAuthState signature
 */
export async function useHybridAuthState(options: UseHybridAuthStateOptions): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  store: HybridAuthStore;
}> {
  // Create crypto and codec services
  const cryptoService = await createCryptoService(
    {
      ...DEFAULT_SECURITY_CONFIG,
      enableEncryption: options.hybrid.security.enableEncryption,
      enableCompression: options.hybrid.security.enableCompression,
    },
    options.hybrid.masterKey,
  );

  const codecService = createCodecService({
    ...DEFAULT_SECURITY_CONFIG,
    enableCompression: options.hybrid.security.enableCompression,
  });

  // Create Redis store
  const redisStore = await createRedisStore(
    {
      redisUrl: options.hybrid.redisUrl,
      host: options.hybrid.redisHost,
      port: options.hybrid.redisPort,
      ttl: options.hybrid.ttl,
      resilience: options.hybrid.resilience,
      enableTls: false,
    },
    cryptoService,
    codecService,
  );

  // Create MongoDB store
  const mongoStore = await createMongoStore(
    {
      mongoUrl: options.hybrid.mongoUrl,
      databaseName: options.hybrid.mongoDatabase,
      collectionName: options.hybrid.mongoCollection,
      ttl: options.hybrid.ttl,
      resilience: options.hybrid.resilience,
      enableTls: false,
    },
    cryptoService,
    codecService,
  );

  // Create hybrid store
  const hybridStore = await createHybridStore(redisStore, mongoStore, options.hybrid);

  // Initialize auth state
  const authState: AuthenticationState = {
    creds: initAuthCreds(),
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const snapshot = await hybridStore.get(options.sessionId);
        if (!snapshot) return {} as Record<string, SignalDataTypeMap[T]>;

        const keysOfType = snapshot.data.keys[type] ?? {};
        const result: Record<string, SignalDataTypeMap[T]> = {};

        for (const id of ids) {
          if (keysOfType[id]) {
            try {
              if (type === 'app-state-sync-key') {
                result[id] = proto.Message.AppStateSyncKeyData.create(
                  keysOfType[id],
                ) as unknown as SignalDataTypeMap[T];
              } else {
                result[id] = keysOfType[id] as SignalDataTypeMap[T];
              }
            } catch (error) {
              console.warn(`Failed to deserialize key ${type}:${id}`, error);
            }
          }
        }

        return result;
      },
      set: async (data) => {
        const snapshot = await hybridStore.get(options.sessionId);
        const currentVersion = snapshot?.version ?? 0;

        // Merge keys incrementally (CRITICAL for preventing data loss)
        const mergedKeys: Record<string, Record<string, unknown>> = {
          ...(snapshot?.data.keys ?? {}),
        };

        for (const [type, keys] of Object.entries(data)) {
          mergedKeys[type] ??= {};
          for (const [id, value] of Object.entries(keys)) {
            if (value === null || value === undefined) {
              // delete mergedKeys[type][id];
              const { [id]: _unused, ...rest } = mergedKeys[type];
              void _unused; // Suppress unused variable warning
              mergedKeys[type] = rest;
            } else {
              mergedKeys[type][id] = value;
            }
          }
        }

        await hybridStore.set(options.sessionId, { keys: mergedKeys }, currentVersion);
      },
    },
  };

  // Load existing credentials if available
  const existingSnapshot = await hybridStore.get(options.sessionId);
  if (existingSnapshot?.data.creds) {
    authState.creds = existingSnapshot.data.creds;
  }

  // Save credentials function
  const saveCreds = async (): Promise<void> => {
    const snapshot = await hybridStore.get(options.sessionId);
    const currentVersion = snapshot?.version ?? 0;

    await hybridStore.set(options.sessionId, { creds: authState.creds }, currentVersion);
  };

  return {
    state: authState,
    saveCreds,
    store: hybridStore, // Expose store for advanced usage (cleanup, health checks, metrics, etc)
  };
}
