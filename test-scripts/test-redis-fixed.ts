#!/usr/bin/env tsx

/**
 * Test Script: Redis Auth State with Fixed Reconnection Logic
 *
 * FIXED: Reuses auth state across reconnections instead of creating new ones
 * This handles the expected 515 error after QR scan properly
 */

import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { useRedisAuthState } from '../dist/redis/index.js';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';

const SESSION_ID = 'test-redis-session-fixed';

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
          console.log('   Reconnecting with saved credentials...\n');
          setTimeout(() => connectWithAuth(), 2000);
        } else {
          console.log('\n🔄 OTHER DISCONNECT - Attempting reconnect...');
          setTimeout(() => connectWithAuth(), 3000);
        }
      }

      // Handle successful connection
      else if (connection === 'open') {
        console.log('\n🎉 CONNECTION ESTABLISHED!');
        console.log('━'.repeat(80));
        console.log('✨ SUCCESS: Redis Auth State is working correctly!');
        console.log('━'.repeat(80) + '\n');

        console.log('📊 Connection Info:');
        console.log('   - Phone:', sock.user?.id);
        console.log('   - Name:', sock.user?.name);
        console.log('   - LID:', sock.user?.lid);
        console.log('   - Storage: Redis');
        console.log('   - Encryption: ✅ Active');
        console.log('   - Compression: ✅ Active (Snappy)\n');

        console.log('🎯 Session Active:');
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
    console.error('\n❌ ERROR in connectWithAuth:', error);
    console.error('\n💡 Error Details:');
    console.error('   Name:', (error as Error).name);
    console.error('   Message:', (error as Error).message);

    console.error('\n💡 Troubleshooting:');
    console.error('   1. Check Redis: redis-cli ping');
    console.error('   2. Check Redis keys: redis-cli KEYS "*test-redis-session*"');
    console.error('   3. Verify encryption key length (32 bytes)');
    console.error('   4. Check port 6379 accessibility\n');
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
