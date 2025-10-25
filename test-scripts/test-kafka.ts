#!/usr/bin/env tsx

/**
 * Test Script: Hybrid Auth State with Kafka (Consolidated)
 *
 * Tests the Hybrid adapter with Kafka write-behind, structured logging,
 * auto-cleanup, and automatic reconnection after pairing
 */

import { config } from 'dotenv';
config();

import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import { useHybridAuthState } from '../dist/hybrid/index.js';
import { ConsoleStructuredLogger, LogLevel } from '../dist/index.js';
import { withContext } from '../dist/index.js';
import type { QueueAdapter } from '../dist/types/index.js';
import { Kafka } from 'kafkajs';
import qrcode from 'qrcode-terminal';
import { Boom } from '@hapi/boom';
import { MongoClient } from 'mongodb';
import Redis from 'ioredis';

const SESSION_ID = 'test-kafka-session';
const MAX_RECONNECTS = 3;

// Initialize logger
const logger = new ConsoleStructuredLogger('development', { level: LogLevel.DEBUG });

// Global state to reuse across reconnections
let globalAuthState: any = null;
let reconnectAttempts = 0;
let kafkaProducer: any = null;
let kafkaConsumer: any = null;
let mongoStore: any = null;

/**
 * Kafka QueueAdapter implementation
 */
class KafkaQueueAdapter implements QueueAdapter {
  private producer: any;
  private logger: ConsoleStructuredLogger;

  constructor(kafka: Kafka, logger: ConsoleStructuredLogger) {
    this.producer = kafka.producer();
    this.logger = logger;
  }

  async connect(): Promise<void> {
    await this.producer.connect();
    this.logger.info('Kafka producer conectado', {});
  }

  async add(jobName: string, data: any, options?: any): Promise<void> {
    try {
      await this.producer.send({
        topic: 'baileys-auth-persist',
        messages: [
          {
            key: data.sessionId || 'default',
            value: JSON.stringify({
              jobName,
              data,
              options,
              timestamp: Date.now(),
            }),
          },
        ],
      });

      this.logger.debug('Mensagem enviada ao Kafka', {
        topic: 'baileys-auth-persist',
        jobName,
        sessionId: data.sessionId,
      });
    } catch (error) {
      this.logger.error('Erro ao enviar mensagem ao Kafka', error as Error, {
        jobName,
        sessionId: data.sessionId,
      });
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.producer.disconnect();
    this.logger.info('Kafka producer desconectado', {});
  }
}

/**
 * Auto-cleanup Redis, MongoDB and Kafka data before test
 */
async function autoCleanup(): Promise<void> {
  logger.info('Iniciando auto-cleanup', { adapter: 'hybrid-kafka', sessionId: SESSION_ID });

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
    logger.info('Auto-cleanup concluído', { adapter: 'hybrid-kafka', sessionId: SESSION_ID });
  } catch (error) {
    logger.warn('Auto-cleanup falhou (continuando)', { error, sessionId: SESSION_ID });
  }
}

/**
 * Connect with Hybrid + Kafka auth state
 */
async function connectWithAuth(): Promise<void> {
  logger.info('Iniciando conexão Hybrid com Kafka', { sessionId: SESSION_ID });

  try {
    // Initialize auth state only once
    if (!globalAuthState) {
      logger.info('Inicializando auth state com Kafka', {
        adapter: 'hybrid-kafka',
        sessionId: SESSION_ID,
      });

      // Create Kafka client
      const kafka = new Kafka({
        clientId: 'baileys-hybrid-auth-test',
        brokers: ['localhost:9092'],
        retry: {
          initialRetryTime: 100,
          retries: 3,
          multiplier: 2,
        },
      });

      // Create Kafka adapter
      const kafkaAdapter = new KafkaQueueAdapter(kafka, logger);
      await kafkaAdapter.connect();

      // Initialize Kafka consumer for write-behind processing
      kafkaConsumer = kafka.consumer({ groupId: 'baileys-test-group' });
      await kafkaConsumer.connect();
      await kafkaConsumer.subscribe({ topic: 'baileys-auth-persist', fromBeginning: false });

      await kafkaConsumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            const payload = JSON.parse(message.value?.toString() || '{}');
            const { data } = payload;

            logger.debug('Processando mensagem do Kafka', {
              topic,
              partition,
              offset: message.offset,
              sessionId: data.sessionId,
            });

            // Log successful processing
            logger.info('Write-behind processado via Kafka', {
              sessionId: data.sessionId,
              version: data.version,
              offset: message.offset,
            });
          } catch (error) {
            logger.error('Erro ao processar mensagem do Kafka', error as Error, {
              topic,
              partition,
              offset: message.offset,
            });
          }
        },
      });

      globalAuthState = await useHybridAuthState({
        hybrid: {
          redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
          mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
          mongoDatabase: 'baileys_test',
          mongoCollection: 'auth_sessions',
          enableWriteBehind: true, // Enable async writes via Kafka
          queue: kafkaAdapter, // Inject Kafka adapter for write-behind
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

      logger.info('Auth state inicializado com Kafka', {
        adapter: 'hybrid-kafka',
        sessionId: SESSION_ID,
        encryption: true,
        compression: true,
        redis: true,
        mongodb: true,
        kafka: true,
        writeBehind: true,
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
          storage: 'hybrid-kafka',
          sessionId: SESSION_ID,
        });

        reconnectAttempts = 0;

        console.log('\n' + '━'.repeat(80));
        console.log('✨ SUCESSO: Hybrid Auth State com Kafka está funcionando!');
        console.log('━'.repeat(80) + '\n');
        console.log('📊 Informações da Conexão:');
        console.log(`   - Phone: ${sock.user?.id}`);
        console.log(`   - Name: ${sock.user?.name}`);
        console.log(`   - Storage: Hybrid (Redis + MongoDB + Kafka)`);
        console.log(`   - Hot Cache: Redis ⚡`);
        console.log(`   - Cold Storage: MongoDB 💾`);
        console.log(`   - Write-Behind: Kafka 📨`);
        console.log(`   - Encryption: ✅ Active (AES-256-GCM)`);
        console.log(`   - Compression: ✅ Active (Snappy)\n`);
        console.log('🎯 Fluxo de Dados com Kafka:');
        console.log('   Read Path:  Redis (hot) → MongoDB (cold) → Cache warming');
        console.log('   Write Path: Redis (sync) → Kafka (async) → MongoDB (write-behind)\n');
        console.log('🔍 Próximos Passos:');
        console.log('   1. Verifique Redis: redis-cli KEYS "baileys:auth:*"');
        console.log('   2. Verifique Kafka: kafka-console-consumer --topic baileys-auth-persist');
        console.log(
          '   3. Verifique MongoDB: mongosh baileys_test --eval "db.auth_sessions.find()"',
        );
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
        logger.debug('Enviando para Kafka (write-behind)...', { sessionId: SESSION_ID });

        const startTime = Date.now();
        await saveCreds();
        const duration = Date.now() - startTime;

        logger.info('Credenciais salvas com Kafka write-behind', {
          sessionId: SESSION_ID,
          duration,
          storage: 'hybrid-kafka',
          redis: true,
          kafka: true,
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
    console.error('   3. Verifique Kafka: kafka-console-producer --topic test');
    console.error('   4. Verifique logs acima para detalhes\n');
    process.exit(1);
  }
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TEST: Hybrid Auth State com Kafka Write-Behind');
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
process.on('SIGINT', async () => {
  logger.info('Processo interrompido pelo usuário', { sessionId: SESSION_ID });

  // Cleanup Kafka connections
  if (kafkaProducer) {
    await kafkaProducer.disconnect();
  }
  if (kafkaConsumer) {
    await kafkaConsumer.disconnect();
  }

  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Processo terminado', { sessionId: SESSION_ID });

  // Cleanup Kafka connections
  if (kafkaProducer) {
    await kafkaProducer.disconnect();
  }
  if (kafkaConsumer) {
    await kafkaConsumer.disconnect();
  }

  process.exit(0);
});

// Start
main().catch((error) => {
  logger.error('Erro fatal', error);
  process.exit(1);
});
