/**
 * @baileys-store/core - Hybrid Basic Example
 *
 * Example using Hybrid storage (Redis + MongoDB) without queue
 * - Redis as hot cache for low latency
 * - MongoDB as cold storage for durability
 * - Read-through and write-through patterns
 */

import { makeWASocket, DisconnectReason } from '@whiskeysockets/baileys';
import { useHybridAuthState } from '@baileys-store/core/hybrid';
import qrcode from 'qrcode-terminal';

async function main() {
  console.log('🚀 Starting WhatsApp with Hybrid auth state (Redis + MongoDB)...');

  // Create auth state using Hybrid storage
  const { state, saveCreds } = await useHybridAuthState({
    hybrid: {
      redisUrl: 'redis://localhost:6379',
      mongoUrl: 'mongodb://localhost:27017',
      mongoDatabase: 'whatsapp',
      mongoCollection: 'auth',
      ttl: {
        defaultTtl: 86400, // 24 hours
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
        enableEncryption: false, // Set to true for production
        encryptionAlgorithm: 'secretbox',
        keyRotationDays: 90,
        enableCompression: false, // Set to true for production
        compressionAlgorithm: 'snappy',
      },
      enableWriteBehind: false, // No queue, direct writes
      writeBehindFlushInterval: 1000,
      writeBehindQueueSize: 1000,
      masterKey: undefined, // Set in production
    },
    sessionId: 'my-hybrid-session',
    fencingToken: Date.now(),
  });

  // Create WhatsApp socket
  const socket = makeWASocket({
    auth: state,
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
      console.log('✅ WhatsApp connected successfully with Hybrid storage!');
      console.log('📊 Cache hit ratio and performance metrics will be available');
    }
  });

  // Save credentials on update
  socket.ev.on('creds.update', saveCreds);

  // Handle incoming messages
  socket.ev.on('messages.upsert', async (m) => {
    console.log('📨 New message received:', m.messages.length);
  });

  // Keep the process alive
  process.on('SIGINT', () => {
    console.log('👋 Shutting down gracefully...');
    socket.end();
    process.exit(0);
  });
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
