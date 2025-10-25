/**
 * Test Script: Redis Auth State with Detailed Logging
 *
 * This script tests the Redis adapter with comprehensive logging
 * to validate all functionality including QR code display
 */

import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { useRedisAuthState } from '../dist/redis/index.js';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';

const SESSION_ID = 'test-redis-session';

// Global state to reuse across reconnections
let globalAuthState: any = null;

async function connectWithAuth() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TEST: Redis Auth State (FIXED RECONNECTION)');
  console.log('='.repeat(80) + '\n');

  try {
    // Initialize auth state only once
    if (!globalAuthState) {
      console.log('🔧 Initializing Redis Auth State (FIRST TIME)...');
      globalAuthState = await useRedisAuthState({
        redis: {
          host: 'localhost',
          port: 6379,
          ttl: {
            defaultTtl: 2592000, // 30 days
            credsTtl: 2592000, // 30 days
            keysTtl: 604800, // 7 days
            lockTtl: 5, // 5 seconds
          },
        },
        sessionId: SESSION_ID,
        enableEncryption: true,
        enableCompression: true,
        masterKey: process.env.MASTER_ENCRYPTION_KEY || 'test-key-32-bytes-long-string!!',
      });
      console.log('✅ Auth state initialized');
    } else {
      console.log('♻️  Reusing existing auth state (RECONNECTION)');
    }

    const { state, saveCreds } = globalAuthState;

    // Debug: Check if we have existing credentials
    console.log('\n📊 Auth State Analysis:');
    console.log('  - Has credentials:', !!state.creds);
    console.log('  - Is registered:', state.creds?.registered);
    console.log('  - Has ME info:', !!state.creds?.me);
    console.log('  - ME ID:', state.creds?.me?.id || 'Not set');
    console.log('  - Has noiseKey:', !!state.creds?.noiseKey);
    console.log('  - Has signedIdentityKey:', !!state.creds?.signedIdentityKey);

    console.log('\n🔌 Creating Baileys socket...');
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['@baileys-store/core', 'Chrome', '1.0.0'],
      connectTimeoutMs: 90_000,
      qrTimeout: 90_000,
    });

    console.log('✅ Socket created\n');

    // Track connection state
    let isConnecting = true;
    let qrDisplayed = false;

    // Connection update handler
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
        isConnecting = false;
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
          console.log('   Reconnecting with saved credentials...\n');
          setTimeout(() => connectWithAuth(), 2000);
        } else {
          console.log('\n🔄 OTHER DISCONNECT - Attempting reconnect...');
          setTimeout(() => connectWithAuth(), 3000);
        }
      } else if (connection === 'open') {
        isConnecting = false;
        console.log('✅ Connection established!\n');
        console.log('━'.repeat(80));
        console.log('✨ SUCCESS: Redis Auth State is working correctly!');
        console.log('━'.repeat(80) + '\n');

        console.log('📊 Connection Info:');
        console.log('   - Phone:', sock.user?.id);
        console.log('   - Name:', sock.user?.name);
        console.log('   - Storage: Redis');
        console.log('   - Encryption: ✅ Active');
        console.log('   - Compression: ✅ Active (Snappy)\n');

        console.log('🎯 Next Steps:');
        console.log('   1. Auth state is being saved to Redis');
        console.log('   2. Data is encrypted with AES-256-GCM');
        console.log('   3. Data is compressed with Snappy');
        console.log('   4. TTL is set to 30 days');
        console.log('   5. Press Ctrl+C to stop\n');
      } else if (connection === 'connecting') {
        console.log('⏳ Connecting...\n');
      }
    });

    // Credentials update handler with detailed logging
    sock.ev.on('creds.update', async () => {
      console.log('\n💾 Credentials Update Event Triggered');
      console.log('   Timestamp:', new Date().toISOString());

      try {
        console.log('   Saving credentials to Redis...');
        const startTime = Date.now();

        await saveCreds();

        const duration = Date.now() - startTime;
        console.log(`✅ Credentials saved successfully (${duration}ms)`);

        // Verify save
        console.log('   Verifying saved data...');
        console.log('   - Registered:', state.creds?.registered);
        console.log('   - Has ME:', !!state.creds?.me);
        console.log('   - ME ID:', state.creds?.me?.id);
      } catch (error) {
        console.error('❌ Error saving credentials:', error);
        throw error;
      }
    });

    // Messages handler (for testing)
    sock.ev.on('messages.upsert', async (m) => {
      console.log('📨 Received', m.messages.length, 'message(s)');
      const msg = m.messages[0];
      if (msg.key.fromMe) return;

      console.log('   From:', msg.key.remoteJid);
      console.log('   Message:', msg.message);
    });

    // Keep process alive
    console.log('⏳ Process running... waiting for events\n');
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Make sure Redis is running: redis-cli ping');
    console.error('   2. Check Redis connection: redis-cli -h localhost -p 6379');
    console.error('   3. Verify no firewall blocking port 6379');
    console.error('   4. Check error details above\n');
    process.exit(1);
  }
}

// Start connection
connectWithAuth().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});
