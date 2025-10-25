/**
 * Test Script: MongoDB Auth State with Detailed Logging
 *
 * This script tests the MongoDB adapter with comprehensive logging
 */

import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { useMongoAuthState } from '../dist/mongodb/index.js';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';

const SESSION_ID = 'test-mongodb-session';

async function testMongoAuthState() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TEST: MongoDB Auth State');
  console.log('='.repeat(80) + '\n');

  console.log('📋 Configuration:');
  console.log('  - Storage: MongoDB (localhost:27017)');
  console.log('  - Database: baileys_test');
  console.log('  - Collection: auth_sessions');
  console.log('  - Session ID:', SESSION_ID);
  console.log('  - Encryption: Enabled');
  console.log('  - Compression: Enabled (Snappy)');
  console.log('  - TTL: 30 days\n');

  try {
    console.log('🔧 Initializing MongoDB Auth State...');
    const { state, saveCreds } = await useMongoAuthState({
      mongodb: {
        mongoUrl: 'mongodb://localhost:27017',
        databaseName: 'baileys_test',
        collectionName: 'auth_sessions',
        ttl: {
          session: 2592000, // 30 days
          keys: 604800, // 7 days
        },
      },
      sessionId: SESSION_ID,
      enableEncryption: true,
      enableCompression: true,
      masterKey: process.env.MASTER_ENCRYPTION_KEY || 'test-key-32-bytes-long-string!!',
    });

    console.log('✅ MongoDB Auth State initialized successfully\n');

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
          setTimeout(() => testMongoAuthState(), 3000);
        } else {
          console.log('   ⛔ Logged out - not reconnecting\n');
          process.exit(0);
        }
      } else if (connection === 'open') {
        console.log('✅ Connection established!\n');
        console.log('━'.repeat(80));
        console.log('✨ SUCCESS: MongoDB Auth State is working correctly!');
        console.log('━'.repeat(80) + '\n');

        console.log('📊 Connection Info:');
        console.log('   - Phone:', sock.user?.id);
        console.log('   - Name:', sock.user?.name);
        console.log('   - Storage: MongoDB');
        console.log('   - Database: baileys_test');
        console.log('   - Encryption: ✅ Active');
        console.log('   - Compression: ✅ Active (Snappy)\n');

        console.log('🎯 Next Steps:');
        console.log('   1. Auth state is being saved to MongoDB');
        console.log('   2. Data is encrypted with AES-256-GCM');
        console.log('   3. Data is compressed with Snappy');
        console.log('   4. Document has TTL index for auto-cleanup');
        console.log('   5. Press Ctrl+C to stop\n');
      }
    });

    sock.ev.on('creds.update', async () => {
      console.log('💾 Credentials updated - saving to MongoDB...');
      await saveCreds();
      console.log('✅ Credentials saved successfully\n');
    });

    sock.ev.on('messages.upsert', async (m) => {
      console.log('📨 Received', m.messages.length, 'message(s)');
    });

    console.log('⏳ Process running... waiting for events\n');
  } catch (error) {
    console.error('\n❌ ERROR:', error);
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Make sure MongoDB is running: mongosh --eval "db.adminCommand(\'ping\')"');
    console.error('   2. Check MongoDB connection: mongosh mongodb://localhost:27017');
    console.error('   3. Verify no firewall blocking port 27017');
    console.error('   4. Check error details above\n');
    process.exit(1);
  }
}

testMongoAuthState().catch(console.error);

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  process.exit(0);
});
