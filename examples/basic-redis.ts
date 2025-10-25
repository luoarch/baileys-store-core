/**
 * @baileys-store/core - Exemplo Básico com Redis
 *
 * Demonstra o uso do useRedisAuthState como drop-in replacement
 * para useMultiFileAuthState do Baileys
 *
 * Pré-requisitos:
 * - Redis rodando em localhost:6379
 * - yarn install
 *
 * Execução:
 * ```bash
 * tsx examples/basic-redis.ts
 * ```
 */

import { makeWASocket, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { useRedisAuthState } from '../src/redis/use-redis-auth-state.js';
import qrcode from 'qrcode-terminal';

async function main() {
  console.log('🚀 Baileys Store - Exemplo Básico com Redis\n');

  // 1. Criar auth state usando Redis
  console.log('[1/4] Criando auth state...');
  const { state, saveCreds } = await useRedisAuthState({
    redis: {
      host: 'localhost',
      port: 6379,
      // password: 'sua-senha', // Se necessário
    },
    sessionId: 'example-session-redis',

    // Opcionais
    enableEncryption: false, // Para desenvolvimento
    enableCompression: false, // Para desenvolvimento
    ttl: 86400, // 24 horas
  });
  console.log('  ✅ Auth state criado\n');

  // 2. Buscar versão do Baileys
  console.log('[2/4] Buscando versão do WhatsApp Web...');
  const { version } = await fetchLatestBaileysVersion();
  console.log(`  ✅ Versão: ${version.join('.')}\n`);

  // 3. Criar socket Baileys
  console.log('[3/4] Criando socket Baileys...');
  const socket = makeWASocket({
    version,
    auth: state, // ✅ Auth state do Redis!
    printQRInTerminal: false, // Deprecated no v7.0
    syncFullHistory: false,
  });
  console.log('  ✅ Socket criado\n');

  // 4. Configurar event handlers
  console.log('[4/4] Configurando event handlers...\n');

  // Handler para eventos de conexão
  socket.ev.process(async (events) => {
    // Conexão atualizada
    if (events['connection.update']) {
      const update = events['connection.update'];
      const { connection, lastDisconnect, qr } = update;

      // QR Code
      if (qr) {
        console.log('📱 Escaneie o QR Code:\n');
        qrcode.generate(qr, { small: true });
        console.log('\n');
      }

      // Conectado
      if (connection === 'open') {
        console.log('✅ Conectado ao WhatsApp!');
        console.log(`📱 Número: ${state.creds.me?.id || 'N/A'}`);
      }

      // Desconectado
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;

        console.log('❌ Conexão fechada. Reconectar?', shouldReconnect);

        if (shouldReconnect) {
          console.log('🔄 Reconectando em 3s...');
          setTimeout(() => main(), 3000);
        }
      }
    }

    // Credenciais atualizadas - SALVAR NO REDIS!
    if (events['creds.update']) {
      console.log('💾 Salvando credenciais no Redis...');
      await saveCreds();
      console.log('  ✅ Credenciais salvas!');
    }

    // Mensagens recebidas
    if (events['messages.upsert']) {
      const { messages, type } = events['messages.upsert'];

      for (const msg of messages) {
        if (type === 'notify' && !msg.key.fromMe) {
          const from = msg.key.remoteJid;
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

          if (text) {
            console.log(`📩 Mensagem de ${from}: ${text}`);

            // Responder (exemplo)
            if (text.toLowerCase() === 'ping') {
              await socket.sendMessage(from!, {
                text: '🏓 Pong! (Usando Redis Storage)',
              });
              console.log(`  ✅ Resposta enviada!`);
            }
          }
        }
      }
    }
  });

  console.log('⏳ Aguardando conexão...\n');
}

// Executar
main().catch((error) => {
  console.error('❌ Erro:', error);
  process.exit(1);
});
