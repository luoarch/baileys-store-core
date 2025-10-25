#!/usr/bin/env tsx

// Load .env file
import { config } from 'dotenv';
config();

import { makeWASocket, DisconnectReason, type WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { useHybridAuthState } from '../dist/hybrid/index.js';

console.log(`
================================================================================
🧪 Baileys Store - QR Code Test
================================================================================

This test will:
1. Clean existing data (Redis + MongoDB)
2. Initialize Hybrid Storage (Redis + MongoDB)
3. Generate QR Code in terminal
4. Wait for WhatsApp scan
5. Save credentials automatically

⚠️  IMPORTANT: Scan QR code within 90 seconds
================================================================================
`);

// Auto-cleanup before test
async function cleanupDatabases() {
  let mongoClient: any = null;
  let redisClient: any = null;

  try {
    console.log('🧹 Auto-cleaning databases...\n');

    // Connect to MongoDB
    const { MongoClient } = await import('mongodb');
    mongoClient = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
    await mongoClient.connect();

    const db = mongoClient.db('baileys_test');
    const collection = db.collection('auth_sessions');

    // Clear all documents
    const mongoResult = await collection.deleteMany({});
    console.log(`✅ MongoDB: Deleted ${mongoResult.deletedCount} documents`);

    // Connect to Redis
    const Redis = (await import('ioredis')).default;
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

    // Get all keys matching our pattern
    const keys = await redisClient.keys('*qr-test-session*');
    if (keys.length > 0) {
      await redisClient.del(...keys);
      console.log(`✅ Redis: Deleted ${keys.length} keys`);
    } else {
      console.log('✅ Redis: No keys to delete');
    }

    console.log('✅ Database cleanup completed!\n');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    // Continue anyway
  } finally {
    // Close connections
    if (mongoClient) {
      await mongoClient.close();
    }
    if (redisClient) {
      await redisClient.quit();
    }
  }
}

// Run cleanup first
await cleanupDatabases();

let currentSocket: WASocket | null = null;
let reconnectAttempts = 0;
let isConnecting = false;
const MAX_RECONNECTS = 3;
let timeoutId: NodeJS.Timeout;

async function createConnection() {
  if (isConnecting) {
    console.log('⚠️  Connection already in progress, skipping...\n');
    return;
  }

  isConnecting = true;

  try {
    console.log('🔧 Initializing Hybrid Auth State...\n');

    // Generate a consistent 32-byte hex key for testing
    const masterKey =
      process.env.BAILEYS_MASTER_KEY ||
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    console.log('🔑 Using master key:', masterKey.substring(0, 10) + '...');

    const { state, saveCreds } = await useHybridAuthState({
      hybrid: {
        redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
        mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
        mongoDatabase: 'baileys_test',
        mongoCollection: 'auth_sessions',
        ttl: {
          defaultTtl: 30 * 24 * 60 * 60, // 30 days in seconds
          credsTtl: 30 * 24 * 60 * 60,
          keysTtl: 30 * 24 * 60 * 60,
          lockTtl: 5,
        },
        masterKey: masterKey, // Pass hex string directly
        security: {
          enableEncryption: false, // Temporarily disable encryption for testing
          enableCompression: false,
          encryptionAlgorithm: 'secretbox',
          keyRotationDays: 90,
          compressionAlgorithm: 'snappy',
        },
        resilience: {
          operationTimeout: 5000,
          maxRetries: 3,
          retryBaseDelay: 100,
          retryMultiplier: 2,
        },
        observability: {
          enableMetrics: false,
          enableTracing: false,
          enableDetailedLogs: false,
          metricsInterval: 60000,
        },
      },
      sessionId: 'qr-test-session',
    });

    console.log('✅ Hybrid Store ready!\n');
    console.log('🔌 Creating Baileys socket...\n');

    currentSocket = makeWASocket({
      auth: state,
      printQRInTerminal: false, // We'll handle QR display ourselves
      browser: ['@baileys-store/core', 'Chrome', '1.0.0'],
      connectTimeoutMs: 90_000,
      qrTimeout: 90_000,
      markOnlineOnConnect: false,
    });

    // Add deep debug monitoring for serialization issues
    console.log('🔍 DEBUG: Monitoring socket events for serialization issues...\n');

    // Timeout handler
    timeoutId = setTimeout(() => {
      console.log('\n⏰ Timeout: QR code not scanned in 90 seconds\n');
      cleanup();
      process.exit(1);
    }, 90_000);

    // Connection updates
    currentSocket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Debug connection update
      console.log('🔍 CONNECTION UPDATE DEBUG:', {
        connection,
        lastDisconnect: lastDisconnect
          ? {
              error: lastDisconnect.error?.message,
              statusCode: (lastDisconnect.error as Boom)?.output?.statusCode,
            }
          : null,
        qr: qr ? 'QR_CODE_PRESENT' : null,
        timestamp: new Date().toISOString(),
      });

      // Debug auth state on errors
      if (connection === 'close' && lastDisconnect?.error) {
        console.log('🔍 AUTH STATE DEBUG:', {
          credsKeys: Object.keys(state.creds),
          keysStructure: Object.keys(state.keys),
          errorMessage: lastDisconnect.error.message,
          timestamp: new Date().toISOString(),
        });

        if (lastDisconnect.error.message.includes('ERR_INVALID_ARG_TYPE')) {
          console.log('🚨 SERIALIZATION ERROR DETECTED!');
          console.log(
            '🔍 This is the RC.6 serialization bug - objects being passed where Buffer expected',
          );
        }
      }

      if (qr) {
        console.log('\n');
        console.log('='.repeat(80));
        console.log('📱 QR CODE - Scan with WhatsApp');
        console.log('='.repeat(80));
        console.log('\n');

        // Generate QR code in terminal (smaller size)
        qrcode.generate(qr, { small: true }, (qrcode) => {
          console.log(qrcode);
        });

        console.log('\n');
        console.log('='.repeat(80));
        console.log('⏳ Waiting for scan... (90 seconds timeout)');
        console.log('='.repeat(80));
        console.log('\n');
      }

      if (connection === 'open') {
        clearTimeout(timeoutId);
        console.log('\n🎉 CONNECTED SUCCESSFULLY!\n');
        console.log('✅ Credentials saved to:');
        console.log('   - Redis (hot cache)');
        console.log('   - MongoDB (cold storage)\n');

        reconnectAttempts = 0;

        // Wait 5 seconds then logout
        await new Promise((resolve) => setTimeout(resolve, 5000));
        console.log('🔌 Disconnecting...\n');

        cleanup();
        process.exit(0);
      }

      if (connection === 'close') {
        clearTimeout(timeoutId);

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        const errorMessage = lastDisconnect?.error?.message || 'Unknown';

        console.log('\n❌ Connection closed');
        console.log(`   Status Code: ${statusCode}`);
        console.log(`   Reason: ${errorMessage}`);
        console.log(`   Disconnect Reason: ${DisconnectReason[statusCode as number] || 'N/A'}`);

        if (shouldReconnect && reconnectAttempts < MAX_RECONNECTS) {
          reconnectAttempts++;
          console.log(`\n🔄 Reconnecting (${reconnectAttempts}/${MAX_RECONNECTS})...\n`);

          await new Promise((resolve) => setTimeout(resolve, 3000));
          await cleanup(false);
          await new Promise((resolve) => setTimeout(resolve, 500)); // Allow full cleanup
          createConnection();
        } else {
          console.log(
            shouldReconnect
              ? '\n❌ Max reconnection attempts reached\n'
              : '\n✅ Logout completed\n',
          );
          cleanup();
          process.exit(shouldReconnect ? 1 : 0);
        }
      }
    });

    // Save credentials on update
    currentSocket.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    await cleanup();
    process.exit(1);
  } finally {
    isConnecting = false;
  }
}

async function cleanup(exit = true) {
  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  if (currentSocket) {
    try {
      // Remove specific listeners to prevent memory leaks
      currentSocket.ev.removeAllListeners('connection.update');
      currentSocket.ev.removeAllListeners('creds.update');

      // Proper socket termination
      currentSocket.end(undefined);

      // Wait for cleanup to complete
      await new Promise((r) => setTimeout(r, 100));
    } catch (error) {
      console.error('Cleanup error:', error);
    } finally {
      currentSocket = null;
    }
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Process interrupted by user\n');
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n⚠️  Process terminated\n');
  cleanup();
  process.exit(0);
});

createConnection();
