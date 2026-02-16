#!/usr/bin/env tsx

/**
 * Test Script: MongoDB Auth State (Consolidated)
 *
 * Tests the MongoDB adapter with structured logging, auto-cleanup,
 * and automatic reconnection after pairing
 */

import { config } from 'dotenv';
config();

import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { useMongoAuthState } from '../dist/mongodb/index.js';
import { ConsoleStructuredLogger, LogLevel } from '../dist/index.js';
import { withContext } from '../dist/index.js';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import { MongoClient } from 'mongodb';

const SESSION_ID = 'test-mongodb-session';
const MAX_RECONNECTS = 3;

// Initialize logger
const logger = new ConsoleStructuredLogger('development', { level: LogLevel.DEBUG });

// Global state to reuse across reconnections
let globalAuthState: any = null;
let reconnectAttempts = 0;

/**
 * Auto-cleanup MongoDB data before test
 */
async function autoCleanup(): Promise<void> {
  logger.info('Iniciando auto-cleanup', { adapter: 'mongodb', sessionId: SESSION_ID });

  try {
    const mongoClient = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
    await mongoClient.connect();

    const db = mongoClient.db('baileys_test');
    const collection = db.collection('auth_sessions');

    const result = await collection.deleteMany({ sessionId: SESSION_ID });
    logger.debug('MongoDB limpo', {
      documentsDeleted: result.deletedCount,
      sessionId: SESSION_ID,
    });

    await mongoClient.close();
    logger.info('Auto-cleanup concluído', { adapter: 'mongodb', sessionId: SESSION_ID });
  } catch (error) {
    logger.warn('Auto-cleanup falhou (continuando)', { error, sessionId: SESSION_ID });
  }
}

/**
 * Connect with MongoDB auth state
 */
async function connectWithAuth(): Promise<void> {
  logger.info('Iniciando conexão MongoDB', { sessionId: SESSION_ID });

  try {
    // Initialize auth state only once
    if (!globalAuthState) {
      logger.info('Inicializando auth state', { adapter: 'mongodb', sessionId: SESSION_ID });

      globalAuthState = await useMongoAuthState({
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
            operationTimeout: 5000,
            maxRetries: 3,
            retryBaseDelay: 100,
            retryMultiplier: 2,
          },
        },
        sessionId: SESSION_ID,
        enableEncryption: true,
        enableCompression: true,
        masterKey: process.env.BAILEYS_MASTER_KEY || 'test-key-32-bytes-long-string!!',
      });

      logger.info('Auth state inicializado', {
        adapter: 'mongodb',
        sessionId: SESSION_ID,
        encryption: true,
        compression: true,
      });
    } else {
      logger.info('Reutilizando auth state existente', { sessionId: SESSION_ID });
    }

    const { state, saveCreds } = globalAuthState;

    // Debug auth state
    logger.debug('Auth state analysis', {
      hasCredentials: !!state.creds,
      isRegistered: state.creds?.registered,
      hasMe: !!state.creds?.me,
      meId: state.creds?.me?.id || 'Not set',
    });

    logger.info('Criando socket Baileys', { sessionId: SESSION_ID });

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['@baileys-store/core', 'Chrome', '1.0.0'],
      connectTimeoutMs: 90_000,
      qrTimeout: 90_000,
    });

    logger.info('Socket criado', { sessionId: SESSION_ID });

    let qrDisplayed = false;

    // Connection update handler
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      const statusCode = lastDisconnect ? (lastDisconnect.error as Boom)?.output?.statusCode : null;

      logger.debug('Connection update', {
        connection,
        hasQR: !!qr,
        hasDisconnect: !!lastDisconnect,
        statusCode,
        sessionId: SESSION_ID,
      });

      // Handle QR code
      if (qr && !qrDisplayed) {
        console.log('\n' + '─'.repeat(80));
        console.log('📱 QR CODE - Escaneie com WhatsApp');
        console.log('─'.repeat(80));
        qrcode.generate(qr, { small: true });
        console.log('─'.repeat(80) + '\n');

        logger.info('QR Code gerado - escaneie com WhatsApp', {
          sessionId: SESSION_ID,
          timeout: 90000,
        });

        qrDisplayed = true;
      }

      // Handle connection close
      if (connection === 'close') {
        const errorMessage = lastDisconnect?.error?.message || 'Unknown error';
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn('Conexão fechada', {
          sessionId: SESSION_ID,
          statusCode,
          errorMessage,
          shouldReconnect,
        });

        if (statusCode === DisconnectReason.loggedOut) {
          logger.info('Logout completo - encerrando', { sessionId: SESSION_ID });
          process.exit(0);
        } else if (statusCode === DisconnectReason.restartRequired) {
          logger.info('Restart requerido (esperado após QR scan)', {
            sessionId: SESSION_ID,
            reconnectAttempts: reconnectAttempts + 1,
          });

          if (reconnectAttempts < MAX_RECONNECTS) {
            reconnectAttempts++;
            setTimeout(() => connectWithAuth(), 2000);
          } else {
            logger.error('Máximo de reconexões atingido', undefined, { sessionId: SESSION_ID });
            process.exit(1);
          }
        } else if (shouldReconnect && reconnectAttempts < MAX_RECONNECTS) {
          reconnectAttempts++;
          logger.info('Reconectando', {
            sessionId: SESSION_ID,
            attempt: reconnectAttempts,
            maxAttempts: MAX_RECONNECTS,
          });
          setTimeout(() => connectWithAuth(), 3000);
        }
      }

      // Handle successful connection
      else if (connection === 'open') {
        logger.info('Conexão estabelecida com sucesso', {
          phone: sock.user?.id,
          name: sock.user?.name,
          storage: 'mongodb',
          sessionId: SESSION_ID,
        });

        reconnectAttempts = 0;

        console.log('\n' + '━'.repeat(80));
        console.log('✨ SUCESSO: MongoDB Auth State está funcionando corretamente!');
        console.log('━'.repeat(80) + '\n');
        console.log('📊 Informações da Conexão:');
        console.log(`   - Phone: ${sock.user?.id}`);
        console.log(`   - Name: ${sock.user?.name}`);
        console.log(`   - Storage: MongoDB`);
        console.log(`   - Encryption: ✅ Active`);
        console.log(`   - Compression: ✅ Active (Snappy)\n`);
        console.log('🎯 Próximos Passos:');
        console.log('   1. Auth state sendo salvo no MongoDB');
        console.log('   2. Dados criptografados com AES-256-GCM');
        console.log('   3. Dados comprimidos com Snappy');
        console.log('   4. TTL index configurado para 30 dias');
        console.log('   5. Pressione Ctrl+C para parar\n');
      }

      // Handle connecting state
      else if (connection === 'connecting') {
        logger.debug('Conectando...', { sessionId: SESSION_ID });
      }
    });

    // Credentials update handler
    sock.ev.on('creds.update', async () => {
      logger.debug('Evento de atualização de credenciais', { sessionId: SESSION_ID });

      try {
        const startTime = Date.now();
        await saveCreds();
        const duration = Date.now() - startTime;

        logger.info('Credenciais salvas', {
          sessionId: SESSION_ID,
          duration,
          storage: 'mongodb',
        });
      } catch (error) {
        logger.error('Erro ao salvar credenciais', error as Error, { sessionId: SESSION_ID });
        throw error;
      }
    });

    // Messages handler (for testing)
    sock.ev.on('messages.upsert', async (m) => {
      logger.debug('Mensagens recebidas', {
        messageCount: m.messages.length,
        sessionId: SESSION_ID,
      });
    });
  } catch (error) {
    logger.error('Erro em connectWithAuth', error as Error, { sessionId: SESSION_ID });
    console.error('\n💡 Troubleshooting:');
    console.error('   1. Verifique MongoDB: mongosh --eval "db.runCommand({ping: 1})"');
    console.error('   2. Verifique conexão MongoDB: mongosh mongodb://localhost:27017');
    console.error('   3. Verifique firewall port 27017');
    console.error('   4. Verifique logs acima para detalhes\n');
    process.exit(1);
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TEST: MongoDB Auth State (Consolidated)');
  console.log('='.repeat(80) + '\n');

  try {
    // Auto-cleanup before test
    await autoCleanup();

    // Run with context
    await withContext({ sessionId: SESSION_ID }, async () => {
      await connectWithAuth();
    });
  } catch (error) {
    logger.error('Erro fatal no teste', error as Error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Processo interrompido pelo usuário', { sessionId: SESSION_ID });
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Processo terminado', { sessionId: SESSION_ID });
  process.exit(0);
});

// Start
main().catch((error) => {
  logger.error('Erro fatal', error);
  process.exit(1);
});
