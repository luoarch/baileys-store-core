#!/usr/bin/env tsx

/**
 * Test Script: Redis Auth State (Consolidated)
 *
 * Tests the Redis adapter with structured logging, auto-cleanup,
 * and automatic reconnection after pairing
 */

import { config } from 'dotenv';
config();

import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { useRedisAuthState } from '../dist/redis/index.js';
import { ConsoleStructuredLogger, LogLevel } from '../dist/index.js';
import { withContext } from '../dist/index.js';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import Redis from 'ioredis';

const SESSION_ID = 'test-redis-session';
const MAX_RECONNECTS = 3;

// Initialize logger
const logger = new ConsoleStructuredLogger('development', { level: LogLevel.DEBUG });

// Global state to reuse across reconnections
let globalAuthState: any = null;
let reconnectAttempts = 0;

/**
 * Auto-cleanup Redis data before test
 */
async function autoCleanup(): Promise<void> {
  logger.info('Iniciando auto-cleanup', { adapter: 'redis', sessionId: SESSION_ID });

  try {
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    const keys = await redis.keys(`baileys:auth:${SESSION_ID}*`);

    if (keys.length > 0) {
      await redis.del(...keys);
      logger.debug('Redis limpo', { keysDeleted: keys.length, sessionId: SESSION_ID });
    } else {
      logger.debug('Nenhuma chave para limpar', { sessionId: SESSION_ID });
    }

    await redis.quit();
    logger.info('Auto-cleanup concluído', { adapter: 'redis', sessionId: SESSION_ID });
  } catch (error) {
    logger.warn('Auto-cleanup falhou (continuando)', {
      sessionId: SESSION_ID,
      error: error as Error,
    });
  }
}

/**
 * Connect with Redis auth state
 */
async function connectWithAuth(): Promise<void> {
  logger.info('Iniciando conexão Redis', { sessionId: SESSION_ID });

  try {
    // Initialize auth state only once
    if (!globalAuthState) {
      logger.info('Inicializando auth state', { adapter: 'redis', sessionId: SESSION_ID });

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
        masterKey: process.env.BAILEYS_MASTER_KEY || 'test-key-32-bytes-long-string!!',
      });

      logger.info('Auth state inicializado', {
        adapter: 'redis',
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
          storage: 'redis',
          sessionId: SESSION_ID,
        });

        reconnectAttempts = 0;

        console.log('\n' + '━'.repeat(80));
        console.log('✨ SUCESSO: Redis Auth State está funcionando corretamente!');
        console.log('━'.repeat(80) + '\n');
        console.log('📊 Informações da Conexão:');
        console.log(`   - Phone: ${sock.user?.id}`);
        console.log(`   - Name: ${sock.user?.name}`);
        console.log(`   - Storage: Redis`);
        console.log(`   - Encryption: ✅ Active`);
        console.log(`   - Compression: ✅ Active (Snappy)\n`);
        console.log('🎯 Próximos Passos:');
        console.log('   1. Auth state sendo salvo no Redis');
        console.log('   2. Dados criptografados com AES-256-GCM');
        console.log('   3. Dados comprimidos com Snappy');
        console.log('   4. TTL configurado para 30 dias');
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
          storage: 'redis',
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
    console.error('   2. Verifique conexão Redis: redis-cli -h localhost -p 6379');
    console.error('   3. Verifique firewall port 6379');
    console.error('   4. Verifique logs acima para detalhes\n');
    process.exit(1);
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TEST: Redis Auth State (Consolidated)');
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
