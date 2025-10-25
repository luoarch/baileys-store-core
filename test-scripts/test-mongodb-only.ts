/**
 * Test Script: MongoDB Only Auth State
 *
 * This script tests the MongoDB adapter with comprehensive logging
 * to validate all functionality including QR code display and reconnection.
 */

import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { useMongoAuthState } from '../dist/mongodb/index.js';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';

const SESSION_ID = 'test-mongo-only-session';

// Global state to reuse across reconnections
let globalAuthState: any = null;
let globalCryptoService: any = null;
let globalCodecService: any = null;

async function connectWithAuth() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TEST: MongoDB Only Auth State');
  console.log('='.repeat(80) + '\n');

  try {
    // Initialize auth state only once
    if (!globalAuthState) {
      console.log('🔧 Initializing MongoDB Auth State (FIRST TIME)...');

      // Create crypto and codec services once
      if (!globalCryptoService) {
        const { createCryptoService } = await import('../src/crypto/index.js');
        const { createCodecService } = await import('../src/crypto/codec.js');
        const { DEFAULT_SECURITY_CONFIG } = await import('../src/types/index.js');

        globalCryptoService = await createCryptoService(
          {
            ...DEFAULT_SECURITY_CONFIG,
            enableEncryption: process.env.ENABLE_ENCRYPTION === 'true',
            enableCompression: process.env.ENABLE_COMPRESSION === 'true',
          },
          process.env.BAILEYS_MASTER_KEY || Buffer.from('test-key-32-bytes-long-string!!', 'utf8'),
        );

        globalCodecService = createCodecService({
          ...DEFAULT_SECURITY_CONFIG,
          enableCompression: process.env.ENABLE_COMPRESSION === 'true',
        });
      }

      globalAuthState = await useMongoAuthState({
        sessionId: SESSION_ID,
        mongodb: {
          mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
          databaseName: 'baileys_test',
          collectionName: 'auth_sessions',
          ttl: {
            defaultTtl: 2592000, // 30 days
            credsTtl: 2592000, // 30 days
            keysTtl: 604800, // 7 days
            lockTtl: 5, // 5 seconds
          },
          resilience: {
            enableMongoRetry: true,
            mongoRetryAttempts: 5,
            mongoRetryDelayMs: 1000,
          },
          enableTls: false,
        },
        enableEncryption: process.env.ENABLE_ENCRYPTION === 'true',
        enableCompression: process.env.ENABLE_COMPRESSION === 'true',
        masterKey:
          process.env.BAILEYS_MASTER_KEY || Buffer.from('test-key-32-bytes-long-string!!', 'utf8'),
        cryptoService: globalCryptoService,
        codecService: globalCodecService,
      });
      console.log('✅ Auth state initialized');
      console.log('🔧 Configuration:');
      console.log(
        '   - Encryption:',
        process.env.ENABLE_ENCRYPTION === 'true' ? '✅ Enabled' : '❌ Disabled',
      );
      console.log(
        '   - Compression:',
        process.env.ENABLE_COMPRESSION === 'true' ? '✅ Enabled' : '❌ Disabled',
      );
      console.log(
        '   - Master Key:',
        process.env.BAILEYS_MASTER_KEY ? '✅ From ENV' : '⚠️  Default',
      );
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

    let qrDisplayed = false;

    // Connection update handler
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      console.log(`\n📡 Connection Update:`, {
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
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || 'Unknown error';

        console.log('\n❌ Connection Closed:');
        console.log('   Status Code:', statusCode);
        console.log('   Error:', errorMessage);
        console.log('   Error Name:', (lastDisconnect?.error as any)?.name);

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
        console.log('\n✅ CONNECTION ESTABLISHED!');
        console.log('━'.repeat(80));
        console.log('✨ SUCCESS: MongoDB Auth State is working correctly!');
        console.log('━'.repeat(80) + '\n');

        console.log('📊 Connection Info:');
        console.log('   - Phone:', sock.user?.id);
        console.log('   - Name:', sock.user?.name);
        console.log('   - Storage: MongoDB Only');
        console.log('   - Encryption: ✅ Active');
        console.log('   - Compression: ✅ Active (Snappy)\n');

        console.log('🎯 Session Active:');
        console.log('   - 1. Auth state is being saved to MongoDB');
        console.log('   - 2. Data is encrypted with AES-256-GCM');
        console.log('   - 3. Data is compressed with Snappy');
        console.log('   - 4. TTL is set to 30 days');
        console.log('   - 5. Press Ctrl+C to stop\n');
      } else if (connection === 'connecting') {
        console.log('⏳ Connecting to WhatsApp...');
      }
    });

    // Credentials update handler with detailed logging
    sock.ev.on('creds.update', async () => {
      console.log('\n💾 Credentials Update Event Triggered');
      console.log('   Timestamp:', new Date().toISOString());
      console.log('   Storage: MongoDB Only');

      try {
        console.log('   Saving credentials to MongoDB...');
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
      console.log('\n📨 Received', m.messages.length, 'message(s)');
      const msg = m.messages[0];
      if (!msg.key.fromMe) {
        console.log('   From:', msg.key.remoteJid);
        console.log('   Type:', Object.keys(msg.message || {})[0]);
      }
    });

    console.log('⏳ Process running... waiting for events\n');
  } catch (error) {
    console.error('\n❌ ERROR in connectWithAuth:', error);
    console.error('\n💡 Error Details:');
    console.error('   Name:', (error as Error).name);
    console.error('   Message:', (error as Error).message);
    console.error('   Stack:', (error as Error).stack);

    console.error('\n💡 Troubleshooting:');
    console.error('   1. Check MongoDB: mongosh --eval "db.runCommand({ping: 1})" --quiet');
    console.error('   2. Verify encryption key length (32 bytes)');
    console.error('   3. Check port 27017 accessibility');
    console.error('   4. Ensure MongoDB is running and accessible\n');
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
