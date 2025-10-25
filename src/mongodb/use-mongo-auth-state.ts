/**
 * @baileys-store/core - MongoDB Auth State Hook
 *
 * Baileys-compatible hook for MongoDB-based authentication state
 * Similar to useMultiFileAuthState but using MongoDB for persistence
 */

import type { AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { initAuthCreds, proto } from '@whiskeysockets/baileys';
import type { UseMongoAuthStateOptions } from '../types/config.js';
import { createMongoStore, type MongoAuthStore } from './store.js';
import { createCryptoService } from '../crypto/index.js';
import { createCodecService } from '../crypto/codec.js';
import { DEFAULT_SECURITY_CONFIG } from '../types/index.js';

/**
 * MongoDB-based auth state hook
 * Compatible with useMultiFileAuthState signature
 */
export async function useMongoAuthState(options: UseMongoAuthStateOptions): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  store: MongoAuthStore;
}> {
  // Create crypto and codec services
  const cryptoService = await createCryptoService(
    {
      ...DEFAULT_SECURITY_CONFIG,
      enableEncryption: options.enableEncryption ?? false,
      enableCompression: options.enableCompression ?? false,
    },
    options.masterKey,
  );

  const codecService = createCodecService({
    ...DEFAULT_SECURITY_CONFIG,
    enableCompression: options.enableCompression ?? false,
  });

  // Create MongoDB store
  const store = await createMongoStore(options.mongodb, cryptoService, codecService);

  // Initialize auth state
  const authState: AuthenticationState = {
    creds: initAuthCreds(),
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const snapshot = await store.get(options.sessionId);
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
        const snapshot = await store.get(options.sessionId);
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

        await store.set(options.sessionId, { keys: mergedKeys }, currentVersion);
      },
    },
  };

  // Load existing credentials if available
  const existingSnapshot = await store.get(options.sessionId);
  if (existingSnapshot?.data.creds) {
    authState.creds = existingSnapshot.data.creds;
  }

  // Save credentials function
  const saveCreds = async (): Promise<void> => {
    const snapshot = await store.get(options.sessionId);
    const currentVersion = snapshot?.version ?? 0;

    await store.set(options.sessionId, { creds: authState.creds }, currentVersion);
  };

  return {
    state: authState,
    saveCreds,
    store, // Expose store for advanced usage (cleanup, health checks, etc)
  };
}
