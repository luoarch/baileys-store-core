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
🔍 Baileys Store - Debug Serialization RC.6
================================================================================

This debug script will:
1. Add deep serialization logs
2. Monitor binary reads performance
3. Track App State Sync issues
4. Monitor History Sync problems
5. Generate QR Code for real testing

⚠️  IMPORTANT: This will help identify RC.6 serialization issues
================================================================================
`);

// Performance monitoring
const performanceMonitor = {
  binaryReads: { count: 0, startTime: Date.now() },
  serializationErrors: 0,
  appStateSyncErrors: 0,
  historySyncErrors: 0,
};

// Deep serialization debug
function debugSerialization(data: any, context: string) {
  console.log(`🔍 SERIALIZATION DEBUG [${context}]:`, {
    dataType: typeof data,
    isBuffer: Buffer.isBuffer(data),
    isObject: typeof data === 'object' && data !== null,
    isArray: Array.isArray(data),
    dataKeys: typeof data === 'object' && data !== null ? Object.keys(data) : 'N/A',
    dataStringified:
      typeof data === 'object' && data !== null
        ? JSON.stringify(data).substring(0, 100) + '...'
        : String(data).substring(0, 100),
    dataLength:
      typeof data === 'string' ? data.length : Buffer.isBuffer(data) ? data.length : 'N/A',
    timestamp: new Date().toISOString(),
  });
}

// Binary reads monitor
function monitorBinaryReads() {
  performanceMonitor.binaryReads.count++;
  if (performanceMonitor.binaryReads.count % 10 === 0) {
    const elapsed = Date.now() - performanceMonitor.binaryReads.startTime;
    const rate = performanceMonitor.binaryReads.count / (elapsed / 1000);
    console.log('📊 BINARY READS MONITOR:', {
      count: performanceMonitor.binaryReads.count,
      elapsed: elapsed,
      rate: rate.toFixed(2) + ' reads/sec',
      warning: rate > 100 ? '⚠️ HIGH RATE DETECTED' : '✅ Normal',
    });
  }
}

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
    console.log('🔧 Initializing Hybrid Auth State with Deep Debug...\n');

    // Generate a consistent 32-byte hex key for testing
    const masterKey =
      process.env.BAILEYS_MASTER_KEY ||
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    console.log('🔑 Using master key:', masterKey.substring(0, 10) + '...');

    // Debug the master key serialization
    debugSerialization(masterKey, 'MASTER_KEY');

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
          enableDetailedLogs: true, // Enable detailed logs for debugging
          metricsInterval: 60000,
        },
      },
      sessionId: 'debug-serialization-session',
    });

    console.log('✅ Hybrid Store ready!\n');
    console.log('🔌 Creating Baileys socket with debug monitoring...\n');

    currentSocket = makeWASocket({
      auth: state,
      printQRInTerminal: false, // We'll handle QR display ourselves
      browser: ['@baileys-store/core', 'Chrome', '1.0.0'],
      connectTimeoutMs: 90_000,
      qrTimeout: 90_000,
      markOnlineOnConnect: false,
    });

    // Add deep debug monitoring
    currentSocket.ev.on('connection.update', async (update) => {
      console.log('🔍 CONNECTION UPDATE DEBUG:', {
        connection: update.connection,
        lastDisconnect: update.lastDisconnect
          ? {
              error: update.lastDisconnect.error?.message,
              statusCode: (update.lastDisconnect.error as Boom)?.output?.statusCode,
            }
          : null,
        qr: update.qr ? 'QR_CODE_PRESENT' : null,
        timestamp: new Date().toISOString(),
      });

      if (update.qr) {
        console.log('\n');
        console.log('='.repeat(80));
        console.log('📱 QR CODE - Scan with WhatsApp');
        console.log('='.repeat(80));
        console.log('\n');

        // Debug QR code data
        debugSerialization(update.qr, 'QR_CODE');

        // Generate QR code in terminal (smaller size)
        qrcode.generate(update.qr, { small: true }, (qrcode) => {
          console.log(qrcode);
        });

        console.log('\n');
        console.log('='.repeat(80));
        console.log('⏳ Waiting for scan... (90 seconds timeout)');
        console.log('='.repeat(80));
        console.log('\n');
      }

      if (update.connection === 'open') {
        clearTimeout(timeoutId);
        console.log('\n🎉 CONNECTED SUCCESSFULLY!\n');
        console.log('✅ Credentials saved to:');
        console.log('   - Redis (hot cache)');
        console.log('   - MongoDB (cold storage)\n');

        // Log performance summary
        console.log('📊 PERFORMANCE SUMMARY:', {
          binaryReads: performanceMonitor.binaryReads.count,
          serializationErrors: performanceMonitor.serializationErrors,
          appStateSyncErrors: performanceMonitor.appStateSyncErrors,
          historySyncErrors: performanceMonitor.historySyncErrors,
        });

        reconnectAttempts = 0;

        // Wait 5 seconds then logout
        await new Promise((resolve) => setTimeout(resolve, 5000));
        console.log('🔌 Disconnecting...\n');

        cleanup();
        process.exit(0);
      }

      if (update.connection === 'close') {
        clearTimeout(timeoutId);

        const statusCode = (update.lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        const errorMessage = update.lastDisconnect?.error?.message || 'Unknown';

        console.log('\n❌ Connection closed');
        console.log(`   Status Code: ${statusCode}`);
        console.log(`   Reason: ${errorMessage}`);
        console.log(`   Disconnect Reason: ${DisconnectReason[statusCode as number] || 'N/A'}`);

        // Debug the error in detail
        if (update.lastDisconnect?.error) {
          debugSerialization(update.lastDisconnect.error, 'DISCONNECT_ERROR');
        }

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

    // Monitor App State Sync
    currentSocket.ev.on('app-state-sync.update', (update) => {
      console.log('🔄 APP STATE SYNC DEBUG:', {
        updateType: update.type,
        dataSize: JSON.stringify(update.data).length,
        timestamp: new Date().toISOString(),
      });

      // Debug the update data
      debugSerialization(update.data, 'APP_STATE_SYNC');
    });

    // Monitor History Sync
    currentSocket.ev.on('history-sync', (sync) => {
      console.log('📚 HISTORY SYNC DEBUG:', {
        syncType: sync.type,
        messagesCount: sync.data?.messages?.length || 0,
        contactsCount: sync.data?.contacts?.length || 0,
        chatsCount: sync.data?.chats?.length || 0,
        timestamp: new Date().toISOString(),
      });

      // Debug the sync data
      debugSerialization(sync.data, 'HISTORY_SYNC');
    });

    // Monitor any serialization errors
    currentSocket.ev.on('error', (error) => {
      console.log('❌ SOCKET ERROR DEBUG:', {
        errorType: error.type,
        errorMessage: error.message,
        timestamp: new Date().toISOString(),
      });

      debugSerialization(error, 'SOCKET_ERROR');

      if (error.message.includes('ERR_INVALID_ARG_TYPE')) {
        performanceMonitor.serializationErrors++;
        console.log('🚨 SERIALIZATION ERROR DETECTED!');
      }
    });

    // Save credentials on update
    currentSocket.ev.on('creds.update', (creds) => {
      console.log('🔐 CREDS UPDATE DEBUG:', {
        credsKeys: Object.keys(creds),
        timestamp: new Date().toISOString(),
      });

      debugSerialization(creds, 'CREDS_UPDATE');
      saveCreds();
    });

    // Timeout handler
    timeoutId = setTimeout(() => {
      console.log('\n⏰ Timeout: QR code not scanned in 90 seconds\n');
      cleanup();
      process.exit(1);
    }, 90_000);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    debugSerialization(error, 'FATAL_ERROR');
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
      currentSocket.ev.removeAllListeners('app-state-sync.update');
      currentSocket.ev.removeAllListeners('history-sync');
      currentSocket.ev.removeAllListeners('error');

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

  if (exit) {
    // Final performance report
    console.log('\n📊 FINAL PERFORMANCE REPORT:', {
      binaryReads: performanceMonitor.binaryReads.count,
      serializationErrors: performanceMonitor.serializationErrors,
      appStateSyncErrors: performanceMonitor.appStateSyncErrors,
      historySyncErrors: performanceMonitor.historySyncErrors,
      totalErrors:
        performanceMonitor.serializationErrors +
        performanceMonitor.appStateSyncErrors +
        performanceMonitor.historySyncErrors,
    });
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
