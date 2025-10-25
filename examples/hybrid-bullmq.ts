/**
 * @baileys-store/core - Hybrid + BullMQ Example
 *
 * Example using Hybrid storage with BullMQ for write-behind
 * - Redis as hot cache for low latency
 * - MongoDB as cold storage for durability
 * - BullMQ for async write-behind processing
 * - QueueAdapter implementation for BullMQ
 */

import { makeWASocket, DisconnectReason } from '@whiskeysockets/baileys';
import { useHybridAuthState } from '@baileys-store/core/hybrid';
import { createRedisStore } from '@baileys-store/core/redis';
import { createMongoStore } from '@baileys-store/core/mongodb';
import { createHybridStore } from '@baileys-store/core/hybrid';
import { createCryptoService } from '@baileys-store/core/crypto';
import { createCodecService } from '@baileys-store/core/crypto';
import type { QueueAdapter } from '@baileys-store/core/types';
import { Queue, Worker } from 'bullmq';
import qrcode from 'qrcode-terminal';

// BullMQ QueueAdapter implementation
class BullMQAdapter implements QueueAdapter {
  constructor(private queue: Queue) {}

  async add(jobName: string, data: any, options?: any): Promise<void> {
    await this.queue.add(jobName, data, options);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

async function main() {
  console.log('🚀 Starting WhatsApp with Hybrid auth state + BullMQ write-behind...');

  // Create BullMQ queue for write-behind
  const queue = new Queue('auth-persist', {
    connection: {
      host: 'localhost',
      port: 6379,
    },
  });

  const queueAdapter = new BullMQAdapter(queue);

  // Create crypto and codec services
  const cryptoService = await createCryptoService({
    enableEncryption: false,
    encryptionAlgorithm: 'secretbox',
    keyRotationDays: 90,
    enableCompression: false,
    compressionAlgorithm: 'snappy',
  });

  const codecService = createCodecService({
    enableCompression: false,
    compressionAlgorithm: 'snappy',
  });

  // Create stores
  const redisStore = await createRedisStore(
    {
      redisUrl: 'redis://localhost:6379',
      ttl: {
        defaultTtl: 86400,
        credsTtl: 86400,
        keysTtl: 86400,
        lockTtl: 5,
      },
      resilience: {
        operationTimeout: 5000,
        maxRetries: 3,
        retryBaseDelay: 100,
        retryMultiplier: 2,
      },
    },
    cryptoService,
    codecService,
  );

  const mongoStore = await createMongoStore(
    {
      mongoUrl: 'mongodb://localhost:27017',
      databaseName: 'whatsapp',
      collectionName: 'auth',
      ttl: {
        defaultTtl: 86400,
        credsTtl: 86400,
        keysTtl: 86400,
        lockTtl: 5,
      },
      resilience: {
        operationTimeout: 5000,
        maxRetries: 3,
        retryBaseDelay: 100,
        retryMultiplier: 2,
      },
    },
    cryptoService,
    codecService,
  );

  // Create hybrid store with queue
  const hybridStore = await createHybridStore(redisStore, mongoStore, {
    redisUrl: 'redis://localhost:6379',
    mongoUrl: 'mongodb://localhost:27017',
    mongoDatabase: 'whatsapp',
    mongoCollection: 'auth',
    ttl: {
      defaultTtl: 86400,
      credsTtl: 86400,
      keysTtl: 86400,
      lockTtl: 5,
    },
    resilience: {
      operationTimeout: 5000,
      maxRetries: 3,
      retryBaseDelay: 100,
      retryMultiplier: 2,
    },
    observability: {
      enableMetrics: true,
      enableTracing: false,
      enableDetailedLogs: false,
      metricsInterval: 60000,
    },
    security: {
      enableEncryption: false,
      encryptionAlgorithm: 'secretbox',
      keyRotationDays: 90,
      enableCompression: false,
      compressionAlgorithm: 'snappy',
    },
    queue: queueAdapter,
    enableWriteBehind: true,
    writeBehindFlushInterval: 1000,
    writeBehindQueueSize: 1000,
  });

  // Create BullMQ worker to process write-behind jobs
  const worker = new Worker(
    'auth-persist',
    async (job) => {
      const { sessionId, patch, version, fencingToken } = job.data;

      console.log('📝 Processing write-behind job:', {
        sessionId,
        version,
        jobId: job.id,
      });

      try {
        // Persist to MongoDB
        await mongoStore.set(sessionId, patch, version, fencingToken);
        console.log('✅ Write-behind job completed:', job.id);
      } catch (error) {
        console.error('❌ Write-behind job failed:', job.id, error);
        throw error; // This will trigger retry
      }
    },
    {
      connection: {
        host: 'localhost',
        port: 6379,
      },
      concurrency: 5,
    },
  );

  // Worker event handlers
  worker.on('completed', (job) => {
    console.log('✅ Worker completed job:', job.id);
  });

  worker.on('failed', (job, err) => {
    console.error('❌ Worker failed job:', job?.id, err);
  });

  // Create auth state using hybrid store
  const authState = {
    creds: await initAuthCreds(),
    keys: {
      get: async (type: string, ids: string[]) => {
        const snapshot = await hybridStore.get('my-hybrid-bullmq-session');
        if (!snapshot) return {};

        const keysOfType = snapshot.data.keys[type] || {};
        const result: Record<string, unknown> = {};

        for (const id of ids) {
          if (keysOfType[id]) {
            result[id] = keysOfType[id];
          }
        }

        return result;
      },
      set: async (data: Record<string, Record<string, unknown>>) => {
        const snapshot = await hybridStore.get('my-hybrid-bullmq-session');
        const currentVersion = snapshot?.version || 0;

        // Merge keys incrementally
        const mergedKeys: Record<string, Record<string, unknown>> = {
          ...(snapshot?.data.keys || {}),
        };

        for (const [type, keys] of Object.entries(data)) {
          if (!mergedKeys[type]) {
            mergedKeys[type] = {};
          }
          for (const [id, value] of Object.entries(keys)) {
            if (value === null || value === undefined) {
              delete mergedKeys[type][id];
            } else {
              mergedKeys[type][id] = value;
            }
          }
        }

        await hybridStore.set('my-hybrid-bullmq-session', { keys: mergedKeys }, currentVersion);
      },
    },
  };

  // Create WhatsApp socket
  const socket = makeWASocket({
    auth: authState,
    printQRInTerminal: true,
    logger: console,
  });

  // Event handlers
  socket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('📱 QR Code generated');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(
        'Connection closed due to ',
        lastDisconnect?.error,
        ', reconnecting ',
        shouldReconnect,
      );

      if (shouldReconnect) {
        console.log('Reconnecting...');
        setTimeout(() => main(), 3000);
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connected successfully with Hybrid + BullMQ!');
      console.log('📊 Write-behind processing is active');
    }
  });

  // Save credentials on update
  socket.ev.on('creds.update', async () => {
    const snapshot = await hybridStore.get('my-hybrid-bullmq-session');
    const currentVersion = snapshot?.version || 0;
    await hybridStore.set('my-hybrid-bullmq-session', { creds: authState.creds }, currentVersion);
  });

  // Handle incoming messages
  socket.ev.on('messages.upsert', async (m) => {
    console.log('📨 New message received:', m.messages.length);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('👋 Shutting down gracefully...');

    await worker.close();
    await queue.close();
    await hybridStore.disconnect();

    socket.end();
    process.exit(0);
  });
}

// Initialize auth credentials
function initAuthCreds() {
  return {
    noiseKey: undefined,
    pairingEphemeralKeyPair: undefined,
    signedIdentityKey: undefined,
    signedPreKey: undefined,
    registrationId: undefined,
    advSecretKey: undefined,
    processedHistoryMessages: [],
    nextPreKeyId: undefined,
    firstUnuploadedPreKeyId: undefined,
    accountSyncCounter: undefined,
    accountSettings: undefined,
    deviceId: undefined,
    phoneId: undefined,
    identityId: undefined,
    registered: undefined,
    backupToken: undefined,
    registration: undefined,
    pairingCode: undefined,
    lastAccountSyncTimestamp: undefined,
    myAppStateKeyId: undefined,
    platform: undefined,
    me: undefined,
    account: undefined,
    signalIdentities: undefined,
    myAppStateKey: undefined,
  };
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the application
main().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
