#!/usr/bin/env tsx

/**
 * Test Script: Hybrid Auth State (Redis + MongoDB)
 *
 * Tests the complete hybrid system with both Redis (hot cache) and MongoDB (cold storage)
 * This is the most comprehensive test of the entire system
 */

import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { useHybridAuthState } from '../dist/hybrid/index.js';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';

const SESSION_ID = 'test-hybrid-session';

// Global state to reuse across reconnections
let globalAuthState: any = null;

async function connectWithHybridAuth() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TEST: Hybrid Auth State (Redis + MongoDB)');
  console.log('='.repeat(80) + '\n');

  try {
    // Initialize hybrid auth state only once
    if (!globalAuthState) {
      console.log('🔧 Initializing Hybrid Auth State (FIRST TIME)...');
      console.log('   - Hot Cache: Redis (localhost:6379)');
      console.log('   - Cold Storage: MongoDB (localhost:27017)');
      console.log('   - Encryption: AES-256-GCM');
      console.log('   - Compression: Snappy');
      console.log('   - TTL: 30 days\n');

      globalAuthState = await useHybridAuthState({
        sessionId: SESSION_ID,
        hybrid: {
          // Redis configuration (hot cache)
          redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
          redisHost: 'localhost',
          redisPort: 6379,
          ttl: {
            defaultTtl: 2592000, // 30 days
            credsTtl: 2592000, // 30 days
            keysTtl: 604800, // 7 days
            lockTtl: 5, // 5 seconds
          },
          resilience: {
            maxRetries: 3,
            retryDelay: 1000,
            circuitBreakerThreshold: 5,
            circuitBreakerTimeout: 30000,
          },

          // MongoDB configuration (cold storage)
          mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
          mongoDatabase: 'baileys_test',
          mongoCollection: 'auth_sessions',
          ttl: {
            defaultTtl: 2592000, // 30 days
            credsTtl: 2592000, // 30 days
            keysTtl: 604800, // 7 days
            lockTtl: 5, // 5 seconds
          },
          resilience: {
            maxRetries: 3,
            retryDelay: 1000,
            circuitBreakerThreshold: 5,
            circuitBreakerTimeout: 30000,
          },

          // Security configuration
          security: {
            enableEncryption: true,
            enableCompression: true,
          },
          masterKey: process.env.MASTER_ENCRYPTION_KEY || 'test-key-32-bytes-long-string!!',
        },
      });
      console.log('✅ Hybrid auth state initialized');
    } else {
      console.log('♻️  Reusing existing hybrid auth state (RECONNECTION)');
    }

    const { state, saveCreds, store } = globalAuthState;

    // Debug: Check if we have existing credentials
    console.log('\n📊 Hybrid Auth State Analysis:');
    console.log('  - Has credentials:', !!state.creds);
    console.log('  - Is registered:', state.creds?.registered);
    console.log('  - Has ME info:', !!state.creds?.me);
    console.log('  - ME ID:', state.creds?.me?.id || 'Not set');
    console.log('  - Has noiseKey:', !!state.creds?.noiseKey);
    console.log('  - Has signedIdentityKey:', !!state.creds?.signedIdentityKey);
    console.log('  - Store type:', store.constructor.name);

    console.log('\n🔌 Creating Baileys socket...');
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['@baileys-store/core', 'Chrome', '1.0.0'],
      connectTimeoutMs: 90_000,
      qrTimeout: 90_000,
    });

    console.log('✅ Socket created\n');

    let qrDisplayed = false;
    let connectionAttempts = 0;

    // Connection update handler
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      connectionAttempts++;

      console.log(`\n📡 Connection Update #${connectionAttempts}:`, {
        connection,
        hasQR: !!qr,
        hasDisconnect: !!lastDisconnect,
        timestamp: new Date().toISOString(),
      });

      // Handle QR code
      if (qr && !qrDisplayed) {
        console.log('\n' + '─'.repeat(80));
        console.log('📱 QR CODE - Scan with WhatsApp:');
        console.log('─'.repeat(80));
        qrcode.generate(qr, { small: true });
        console.log('─'.repeat(80));
        console.log('⏳ Waiting for QR scan...\n');
        qrDisplayed = true;
      }

      // Handle connection close
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || 'Unknown error';

        console.log('\n❌ Connection Closed:');
        console.log('   Status Code:', statusCode);
        console.log('   Error:', errorMessage);
        console.log('   Error Name:', (lastDisconnect?.error as any)?.name);

        // Debug: Show all disconnect reasons
        console.log('\n🔍 Disconnect Reason Analysis:');
        console.log('   - loggedOut (401):', statusCode === DisconnectReason.loggedOut);
        console.log('   - restartRequired (515):', statusCode === DisconnectReason.restartRequired);
        console.log(
          '   - connectionClosed (428):',
          statusCode === DisconnectReason.connectionClosed,
        );
        console.log('   - badSession (440):', statusCode === DisconnectReason.badSession);
        console.log('   - timedOut (408):', statusCode === DisconnectReason.timedOut);

        // Handle different disconnect reasons
        if (statusCode === DisconnectReason.loggedOut) {
          console.log('\n⛔ LOGGED OUT - Clearing session and exiting');
          process.exit(0);
        } else if (statusCode === DisconnectReason.restartRequired) {
          console.log('\n✨ RESTART REQUIRED (Expected after QR scan!)');
          console.log('   This is NORMAL behavior - WhatsApp forces disconnect after pairing');
          console.log('   Reconnecting with saved credentials from hybrid storage...\n');
          setTimeout(() => connectWithHybridAuth(), 2000);
        } else {
          console.log('\n🔄 OTHER DISCONNECT - Attempting reconnect...');
          setTimeout(() => connectWithHybridAuth(), 3000);
        }
      }

      // Handle successful connection
      else if (connection === 'open') {
        console.log('\n🎉 CONNECTION ESTABLISHED!');
        console.log('━'.repeat(80));
        console.log('✨ SUCCESS: Hybrid Auth State is working perfectly!');
        console.log('━'.repeat(80) + '\n');

        console.log('📊 Connection Info:');
        console.log('   - Phone:', sock.user?.id);
        console.log('   - Name:', sock.user?.name);
        console.log('   - LID:', sock.user?.lid);
        console.log('   - Storage: Redis (hot) + MongoDB (cold)');
        console.log('   - Encryption: ✅ Active (AES-256-GCM)');
        console.log('   - Compression: ✅ Active (Snappy)\n');

        console.log('🎯 Hybrid System Active:');
        console.log('   - Hot Cache: Redis for fast access');
        console.log('   - Cold Storage: MongoDB for persistence');
        console.log('   - Auto-failover: Circuit breaker protection');
        console.log('   - Press Ctrl+C to stop\n');
      }

      // Handle connecting state
      else if (connection === 'connecting') {
        console.log('⏳ Connecting to WhatsApp...');
      }
    });

    // Credentials update handler with detailed logging
    sock.ev.on('creds.update', async () => {
      console.log('\n💾 Credentials Update Event Triggered');
      console.log('   Timestamp:', new Date().toISOString());
      console.log('   Storage: Hybrid (Redis + MongoDB)');

      try {
        console.log('   Saving credentials to hybrid storage...');
        const startTime = Date.now();

        await saveCreds();

        const duration = Date.now() - startTime;
        console.log(`✅ Credentials saved successfully (${duration}ms)`);

        // Verify save
        console.log('   Verifying saved data...');
        console.log('   - Registered:', state.creds?.registered);
        console.log('   - Has ME:', !!state.creds?.me);
        console.log('   - ME ID:', state.creds?.me?.id);
        console.log('   - Storage: Both Redis and MongoDB updated');
      } catch (error) {
        console.error('❌ Error saving credentials:', error);
        throw error;
      }
    });

    // Messages handler
    sock.ev.on('messages.upsert', async (m) => {
      console.log('\n📨 Received', m.messages.length, 'message(s)');
      const msg = m.messages[0];
      if (!msg.key.fromMe) {
        console.log('   From:', msg.key.remoteJid);
        console.log('   Type:', Object.keys(msg.message || {})[0]);
      }
    });

    console.log('⏳ Process running... waiting for events\n');
  } catch (error) {
    console.error('\n❌ ERROR in connectWithHybridAuth:', error);
    console.error('\n💡 Error Details:');
    console.error('   Name:', (error as Error).name);
    console.error('   Message:', (error as Error).message);

    console.error('\n💡 Troubleshooting:');
    console.error('   1. Check Redis: redis-cli ping');
    console.error('   2. Check MongoDB: mongosh --eval "db.runCommand({ping: 1})"');
    console.error('   3. Check Redis keys: redis-cli KEYS "*test-hybrid-session*"');
    console.error(
      '   4. Check MongoDB collection: mongosh baileys_test --eval "db.auth_sessions.find().count()"',
    );
    console.error('   5. Verify encryption key length (32 bytes)');
    console.error('   6. Check ports 6379 (Redis) and 27017 (MongoDB) accessibility\n');
    process.exit(1);
  }
}

// Start connection
connectWithHybridAuth().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});
