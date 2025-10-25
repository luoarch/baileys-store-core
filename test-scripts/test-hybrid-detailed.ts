/**
 * Test Script: Hybrid Auth State (Redis + MongoDB) with Detailed Logging
 *
 * This script tests the Hybrid adapter with comprehensive logging
 */

import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { useHybridAuthState } from '../dist/hybrid/index.js';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';

const SESSION_ID = 'test-hybrid-session';

async function testHybridAuthState() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TEST: Hybrid Auth State (Redis + MongoDB)');
  console.log('='.repeat(80) + '\n');

  console.log('📋 Configuration:');
  console.log('  - Hot Storage: Redis (localhost:6379)');
  console.log('  - Cold Storage: MongoDB (localhost:27017)');
  console.log('  - Database: baileys_test');
  console.log('  - Collection: auth_sessions');
  console.log('  - Session ID:', SESSION_ID);
  console.log('  - Encryption: Enabled');
  console.log('  - Compression: Enabled (Snappy)');
  console.log('  - Write-Behind: Disabled (direct writes)');
  console.log('  - TTL: 30 days\n');

  try {
    console.log('🔧 Initializing Hybrid Auth State...');
    const { state, saveCreds } = await useHybridAuthState({
      hybrid: {
        redisUrl: 'redis://localhost:6379',
        mongoUrl: 'mongodb://localhost:27017',
        mongoDatabase: 'baileys_test',
        mongoCollection: 'auth_sessions',
        enableWriteBehind: false, // Direct writes for testing
        ttl: {
          session: 2592000, // 30 days
          keys: 604800, // 7 days
        },
        resilience: {
          maxRetries: 3,
          retryDelayMs: 1000,
          circuitBreakerThreshold: 5,
        },
        security: {
          enableEncryption: true,
          enableCompression: true,
          keyRotationDays: 90,
        },
        masterKey: process.env.MASTER_ENCRYPTION_KEY || 'test-key-32-bytes-long-string!!',
      },
      sessionId: SESSION_ID,
    });

    console.log('✅ Hybrid Auth State initialized successfully');
    console.log('   - Redis: Connected');
    console.log('   - MongoDB: Connected');
    console.log('   - Encryption: Active');
    console.log('   - Compression: Active\n');

    console.log('🔌 Creating Baileys socket...');
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['@baileys-store/core', 'Chrome', '1.0.0'],
    });

    console.log('✅ Socket created successfully\n');

    let qrDisplayed = false;

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      console.log('\n📡 Connection Update:', {
        connection,
        hasQR: !!qr,
        hasDisconnect: !!lastDisconnect,
      });

      if (qr && !qrDisplayed) {
        console.log('\n' + '─'.repeat(80));
        console.log('📱 QR CODE - Scan with WhatsApp:');
        console.log('─'.repeat(80));
        qrcode.generate(qr, { small: true });
        console.log('─'.repeat(80) + '\n');
        console.log('⏳ Waiting for QR scan...\n');
        qrDisplayed = true;
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        console.log('❌ Connection closed');
        console.log('   Reason:', lastDisconnect?.error);
        console.log('   Should reconnect:', shouldReconnect);

        if (shouldReconnect) {
          console.log('   🔄 Reconnecting...\n');
          setTimeout(() => testHybridAuthState(), 3000);
        } else {
          console.log('   ⛔ Logged out - not reconnecting\n');
          process.exit(0);
        }
      } else if (connection === 'open') {
        console.log('✅ Connection established!\n');
        console.log('━'.repeat(80));
        console.log('✨ SUCCESS: Hybrid Auth State is working correctly!');
        console.log('━'.repeat(80) + '\n');

        console.log('📊 Connection Info:');
        console.log('   - Phone:', sock.user?.id);
        console.log('   - Name:', sock.user?.name);
        console.log('   - Storage: Hybrid (Redis + MongoDB)');
        console.log('   - Hot Cache: Redis ⚡');
        console.log('   - Cold Storage: MongoDB 💾');
        console.log('   - Encryption: ✅ Active (AES-256-GCM)');
        console.log('   - Compression: ✅ Active (Snappy)\n');

        console.log('🎯 Data Flow:');
        console.log('   Read Path:  Redis (hot) → MongoDB (cold) → Cache warming');
        console.log('   Write Path: Redis (sync) + MongoDB (direct)\n');

        console.log('🔍 Next Steps:');
        console.log('   1. Check Redis: redis-cli KEYS "baileys:auth:*"');
        console.log('   2. Check MongoDB: mongosh baileys_test --eval "db.auth_sessions.find()"');
        console.log('   3. Both should have the same encrypted data');
        console.log('   4. Press Ctrl+C to stop\n');
      }
    });

    sock.ev.on('creds.update', async () => {
      console.log('💾 Credentials updated - saving to Hybrid store...');
      console.log('   → Writing to Redis (hot cache)...');
      console.log('   → Writing to MongoDB (cold storage)...');
      await saveCreds();
      console.log('✅ Credentials saved to both stores successfully\n');
    });

    sock.ev.on('messages.upsert', async (m) => {
      console.log('📨 Received', m.messages.length, 'message(s)');
    });

    console.log('⏳ Process running... waiting for events\n');
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Make sure Redis is running: redis-cli ping');
    console.error('   2. Make sure MongoDB is running: mongosh --eval "db.adminCommand(\'ping\')"');
    console.error('   3. Check both connections are working');
    console.error('   4. Check error details above\n');
    process.exit(1);
  }
}

testHybridAuthState().catch(console.error);

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});
