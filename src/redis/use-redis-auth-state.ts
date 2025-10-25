/**
 * @baileys-store/core/redis - useRedisAuthState
 *
 * Hook compatível com Baileys v7.0+ usando Redis como storage
 *
 * Drop-in replacement para useMultiFileAuthState
 *
 * @example
 * ```typescript
 * import { useRedisAuthState } from '@baileys-store/core/redis';
 * import { makeWASocket } from '@whiskeysockets/baileys';
 *
 * const { state, saveCreds } = await useRedisAuthState({
 *   redis: { host: 'localhost', port: 6379 },
 *   sessionId: 'my-session',
 * });
 *
 * const socket = makeWASocket({ auth: state });
 * socket.ev.process(async (events) => {
 *   if (events['creds.update']) {
 *     await saveCreds();
 *   }
 * });
 * ```
 */

import type {
  AuthenticationState,
  AuthenticationCreds,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { initAuthCreds, proto } from '@whiskeysockets/baileys';
import type { RedisStoreConfig } from './store.js';
import { createRedisStore, type RedisAuthStore } from './store.js';
import type { SecurityConfig } from '../types/index.js';
import {
  DEFAULT_TTL_CONFIG,
  DEFAULT_RESILIENCE_CONFIG,
  DEFAULT_SECURITY_CONFIG,
} from '../types/index.js';
import { createCryptoService } from '../crypto/index.js';
import { createCodecService } from '../crypto/codec.js';

/**
 * Opções para useRedisAuthState
 */
export interface UseRedisAuthStateOptions {
  /** Configuração do Redis */
  redis: Partial<RedisStoreConfig>;
  /** ID da sessão (será usado como prefixo das keys) */
  sessionId: string;
  /** Habilitar criptografia (requer masterKey) */
  enableEncryption?: boolean;
  /** Master key para criptografia (64 hex chars) */
  masterKey?: string;
  /** Habilitar compressão */
  enableCompression?: boolean;
  /** TTL da sessão em segundos (default: 86400 = 24h) */
  ttl?: number;
}

/**
 * Cria um authentication state usando Redis
 *
 * Compatível 100% com interface do Baileys:
 * - Retorna { state, saveCreds }
 * - state.creds: AuthenticationCreds
 * - state.keys.get(type, ids): Promise<{ [id]: value }>
 * - state.keys.set(data): Promise<void>
 * - saveCreds(): Promise<void>
 *
 * @param options Configuração do Redis auth state
 * @returns Promise com { state, saveCreds }
 */
export async function useRedisAuthState(options: UseRedisAuthStateOptions): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  store: RedisAuthStore;
}> {
  const {
    redis: redisConfig,
    sessionId,
    enableEncryption = false,
    masterKey,
    enableCompression = false,
  } = options;

  // Merge configs com defaults
  const fullRedisConfig: RedisStoreConfig = {
    ...redisConfig,
    ttl: redisConfig.ttl ?? DEFAULT_TTL_CONFIG,
    resilience: redisConfig.resilience ?? DEFAULT_RESILIENCE_CONFIG,
  };

  // Security config
  const securityConfig: SecurityConfig = {
    ...DEFAULT_SECURITY_CONFIG,
    enableEncryption,
    enableCompression,
  };

  // Criar serviços
  const crypto = await createCryptoService(securityConfig, masterKey);
  const codec = createCodecService(securityConfig);

  // Criar Redis store
  const store = await createRedisStore(fullRedisConfig, crypto, codec);

  // Carregar ou inicializar creds
  const versioned = await store.get(sessionId);
  const creds: AuthenticationCreds = versioned?.data.creds ?? initAuthCreds();

  // Implementar AuthenticationState compatível com Baileys
  const state: AuthenticationState = {
    creds,
    keys: {
      /**
       * Busca keys por tipo e IDs
       * Compatível 100% com Baileys SignalKeyStore.get()
       */
      get: async <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[],
      ): Promise<Record<string, SignalDataTypeMap[T]>> => {
        try {
          console.debug('🔍 KEYS GET DEBUG:', {
            type,
            ids,
            sessionId,
            timestamp: new Date().toISOString(),
          });

          // Buscar todas as keys do storage
          const versioned = await store.get(sessionId);
          if (!versioned) {
            console.debug('🔍 KEYS GET: No versioned data found');
            return {} as Record<string, SignalDataTypeMap[T]>;
          }

          const allKeys = versioned.data.keys;
          const keysOfType = allKeys[type] ?? {};
          const result: Record<string, SignalDataTypeMap[T]> = {};

          console.debug('🔍 KEYS GET DEBUG - Data structure:', {
            allKeysTypes: Object.keys(allKeys),
            keysOfTypeCount: Object.keys(keysOfType).length,
            requestedIds: ids,
          });

          // Retornar apenas os IDs solicitados
          for (const id of ids) {
            if (keysOfType[id]) {
              console.debug('🔍 KEYS GET DEBUG - Processing key:', {
                id,
                type,
                keyDataType: typeof keysOfType[id],
                isObject: typeof keysOfType[id] === 'object',
                isBuffer: Buffer.isBuffer(keysOfType[id]),
              });

              // Para app-state-sync-key, criar proto object
              if (type === 'app-state-sync-key') {
                const protoData = proto.Message.AppStateSyncKeyData.create(
                  keysOfType[id],
                ) as unknown as SignalDataTypeMap[T];

                console.debug('🔍 KEYS GET DEBUG - Proto object created:', {
                  id,
                  protoDataType: typeof protoData,
                  isBuffer: Buffer.isBuffer(protoData),
                });

                result[id] = protoData;
              } else {
                result[id] = keysOfType[id] as SignalDataTypeMap[T];
              }
            }
          }

          console.debug('🔍 KEYS GET DEBUG - Result:', {
            resultKeys: Object.keys(result),
            resultCount: Object.keys(result).length,
          });

          return result;
        } catch (error) {
          console.error('❌ KEYS GET ERROR:', {
            error: error instanceof Error ? error.message : String(error),
            type,
            ids,
            sessionId,
          });
          return {} as Record<string, SignalDataTypeMap[T]>;
        }
      },

      /**
       * Salva keys no storage
       * Compatível 100% com Baileys SignalKeyStore.set()
       */
      set: async (data) => {
        try {
          // Buscar versão atual
          const versioned = await store.get(sessionId);
          const currentVersion = versioned?.version;

          // Fazer update incremental (key merging!)
          await store.set(
            sessionId,
            {
              keys: data,
            },
            currentVersion,
          );
        } catch (error) {
          console.error('❌ KEYS SET ERROR:', {
            error: error instanceof Error ? error.message : String(error),
            dataKeys: Object.keys(data),
            sessionId,
          });
          throw error;
        }
      },
    },
  };

  /**
   * Salva credenciais
   * Compatível 100% com Baileys saveCreds()
   */
  const saveCreds = async (): Promise<void> => {
    try {
      console.debug('🔍 SAVE CREDS DEBUG:', {
        credsKeys: Object.keys(state.creds),
        sessionId,
        timestamp: new Date().toISOString(),
      });

      // Debug creds structure
      for (const [key, value] of Object.entries(state.creds)) {
        console.debug('🔍 SAVE CREDS DEBUG - Cred:', {
          key,
          valueType: typeof value,
          isObject: typeof value === 'object',
          isBuffer: Buffer.isBuffer(value),
          valueKeys:
            typeof value === 'object' ? Object.keys(value as Record<string, unknown>) : 'N/A',
        });
      }

      // Buscar versão atual
      const versioned = await store.get(sessionId);
      const currentVersion = versioned?.version;

      console.debug('🔍 SAVE CREDS DEBUG - Current version:', {
        currentVersion,
        hasVersioned: !!versioned,
      });

      // Salvar creds atualizadas
      await store.set(
        sessionId,
        {
          creds: state.creds,
        },
        currentVersion,
      );

      console.debug('🔍 SAVE CREDS DEBUG - Saved successfully');
    } catch (error) {
      console.error('❌ SAVE CREDS ERROR:', {
        error: error instanceof Error ? error.message : String(error),
        credsKeys: Object.keys(state.creds),
        sessionId,
      });
      throw error;
    }
  };

  return {
    state,
    saveCreds,
    store, // Expose store for advanced usage (cleanup, health checks, etc)
  };
}
