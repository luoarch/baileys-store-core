#!/usr/bin/env tsx

/**
 * Test Script: Hybrid Auth State (Consolidated)
 *
 * Tests the Hybrid adapter (Redis + MongoDB) with structured logging,
 * auto-cleanup, and automatic reconnection after pairing
 */

import { config } from 'dotenv';
config();

import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { useHybridAuthState } from '../dist/hybrid/index.js';
import { ConsoleStructuredLogger, LogLevel } from '../dist/index.js';
import { withContext } from '../dist/index.js';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';

const SESSION_ID = 'test-hybrid-session';
const MAX_RECONNECTS = 3;

// Initialize logger
const logger = new ConsoleStructuredLogger('development', { level: LogLevel.DEBUG });

// Global state to reuse across reconnections
let globalAuthState: any = null;
let reconnectAttempts = 0;

/**
 * Auto-cleanup Redis and MongoDB data before test
 */
async function autoCleanup(): Promise<void> {
  logger.info('Iniciando auto-cleanup', { adapter: 'hybrid', sessionId: SESSION_ID });

  try {
    // Cleanup Redis
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    const redisKeys = await redis.keys(`baileys:auth:${SESSION_ID}*`);

    if (redisKeys.length > 0) {
      await redis.del(...redisKeys);
      logger.debug('Redis limpo', {
        keysDeleted: redisKeys.length,
        sessionId: SESSION_ID,
      });
    }

    await redis.quit();

    // Cleanup MongoDB
    const mongoClient = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
    await mongoClient.connect();

    const db = mongoClient.db('baileys_test');
    const collection = db.collection('auth_sessions');

    const mongoResult = await collection.deleteMany({ sessionId: SESSION_ID });
    logger.debug('MongoDB limpo', {
      documentsDeleted: mongoResult.deletedCount,
      sessionId: SESSION_ID,
    });

    await mongoClient.close();
    logger.info('Auto-cleanup concluído', { adapter: 'hybrid', sessionId: SESSION_ID });
  } catch (error) {
    logger.warn('Auto-cleanup falhou (continuando)', { error, sessionId: SESSION_ID });
  }
}

/**
 * Connect with Hybrid auth state
 */
async function connectWithAuth(): Promise<void> {
  logger.info('Iniciando conexão Hybrid', { sessionId: SESSION_ID });

  try {
    // Initialize auth state only once
    if (!globalAuthState) {
      logger.info('Inicializando auth state', { adapter: 'hybrid', sessionId: SESSION_ID });

      globalAuthState = await useHybridAuthState({
        hybrid: {
          redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
          mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
          mongoDatabase: 'baileys_test',
          mongoCollection: 'auth_sessions',
          enableWriteBehind: false, // Direct writes for testing
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
          security: {
            enableEncryption: true,
            enableCompression: true,
            encryptionAlgorithm: 'aes-256-gcm',
            compressionAlgorithm: 'snappy',
            keyRotationDays: 90,
          },
          observability: {
            enableMetrics: true,
            enableTracing: false,
            enableDetailedLogs: true,
            metricsInterval: 60000,
          },
          masterKey: process.env.BAILEYS_MASTER_KEY || 'test-key-32-bytes-long-string!!',
        },
        sessionId: SESSION_ID,
      });

      logger.info('Auth state inicializado', {
        adapter: 'hybrid',
        sessionId: SESSION_ID,
        encryption: true,
        compression: true,
        redis: true,
        mongodb: true,
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
          storage: 'hybrid',
          sessionId: SESSION_ID,
        });

        reconnectAttempts = 0;

        console.log('\n' + '━'.repeat(80));
        console.log('✨ SUCESSO: Hybrid Auth State está funcionando corretamente!');
        console.log('━'.repeat(80) + '\n');
        console.log('📊 Informações da Conexão:');
        console.log(`   - Phone: ${sock.user?.id}`);
        console.log(`   - Name: ${sock.user?.name}`);
        console.log(`   - Storage: Hybrid (Redis + MongoDB)`);
        console.log(`   - Hot Cache: Redis ⚡`);
        console.log(`   - Cold Storage: MongoDB 💾`);
        console.log(`   - Encryption: ✅ Active (AES-256-GCM)`);
        console.log(`   - Compression: ✅ Active (Snappy)\n`);
        console.log('🎯 Fluxo de Dados:');
        console.log('   Read Path:  Redis (hot) → MongoDB (cold) → Cache warming');
        console.log('   Write Path: Redis (sync) + MongoDB (direct)\n');
        console.log('🔍 Próximos Passos:');
        console.log('   1. Verifique Redis: redis-cli KEYS "baileys:auth:*"');
        console.log(
          '   2. Verifique MongoDB: mongosh baileys_test --eval "db.auth_sessions.find()"',
        );
        console.log('   3. Ambos devem ter os mesmos dados criptografados');
        console.log('   4. Pressione Ctrl+C para parar\n');
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
        logger.debug('Escrevendo em Redis (hot cache)...', { sessionId: SESSION_ID });
        logger.debug('Escrevendo em MongoDB (cold storage)...', { sessionId: SESSION_ID });

        const startTime = Date.now();
        await saveCreds();
        const duration = Date.now() - startTime;

        logger.info('Credenciais salvas em ambos os stores', {
          sessionId: SESSION_ID,
          duration,
          storage: 'hybrid',
          redis: true,
          mongodb: true,
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
    console.error('   1. Verifique Redis: redis-cli ping');
    console.error('   2. Verifique MongoDB: mongosh --eval "db.runCommand({ping: 1})"');
    console.error('   3. Verifique conexões Redis e MongoDB');
    console.error('   4. Verifique logs acima para detalhes\n');
    process.exit(1);
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TEST: Hybrid Auth State (Consolidated)');
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
