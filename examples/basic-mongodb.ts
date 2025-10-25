/**
 * @baileys-store/core - MongoDB Basic Example
 *
 * Example using MongoDB for authentication state storage
 * - Durable persistence with ACID guarantees
 * - Optimistic locking for concurrent access
 * - TTL management and document caching
 */

import { makeWASocket, DisconnectReason } from '@whiskeysockets/baileys';
import { useMongoAuthState } from '@baileys-store/core/mongodb';
import qrcode from 'qrcode-terminal';

async function main() {
  console.log('🚀 Starting WhatsApp with MongoDB auth state...');

  // Create auth state using MongoDB
  const { state, saveCreds } = await useMongoAuthState({
    mongodb: {
      mongoUrl: 'mongodb://localhost:27017',
      databaseName: 'whatsapp',
      collectionName: 'auth',
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
      enableTls: false,
    },
    sessionId: 'my-session',
    enableEncryption: false, // Set to true for production
    enableCompression: false, // Set to true for production
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
      console.log('✅ WhatsApp connected successfully!');
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
