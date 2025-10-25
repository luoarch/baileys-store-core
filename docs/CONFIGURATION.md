# Guia de Configuração

Guia completo de configuração do `@baileys-store/core` com validação Zod, presets e exemplos.

## Índice

- [Visão Geral](#visão-geral)
- [Estrutura de Configuração](#estrutura-de-configuração)
- [Presets](#presets)
- [Validação](#validação)
- [Configuração Avançada](#configuração-avançada)
- [Troubleshooting](#troubleshooting)

## Visão Geral

O `@baileys-store/core` usa **Zod** para validação de configuração em tempo de execução, garantindo type-safety e mensagens de erro acionáveis.

### Características

- ✅ Validação em tempo de execução com Zod
- ✅ Schemas type-safe com TypeScript
- ✅ Mensagens de erro acionáveis
- ✅ Performance scoring (0-100)
- ✅ Security warnings automáticos
- ✅ 3 presets otimizados (Development, Production, Testing)

## Estrutura de Configuração

### Campos Obrigatórios

```typescript
interface HybridStoreConfig {
  // Conexões
  mongoUrl: string;              // MongoDB connection string
  mongoDatabase: string;         // Nome do banco de dados
  mongoCollection: string;       // Nome da coleção
  redisUrl?: string;             // Redis connection string (opcional)

  // Configurações
  ttl: TtlConfig;                // Time-to-live
  resilience: ResilienceConfig;  // Retry e timeouts
  security: SecurityConfig;      // Criptografia
  observability: ObservabilityConfig; // Métricas
}
```

### TTL Configuration

```typescript
interface TtlConfig {
  defaultTtl: number;    // TTL padrão (segundos), min: 1
  credsTtl: number;      // TTL para credenciais (segundos), min: 1
  keysTtl: number;       // TTL para chaves (segundos), min: 1
  lockTtl: number;       // TTL para locks distribuídos (segundos), min: 1
}
```

**Valores recomendados:**
- Development: `defaultTtl: 300` (5 minutos)
- Production: `defaultTtl: 3600` (1 hora)
- Testing: `defaultTtl: 30` (30 segundos)

### Resilience Configuration

```typescript
interface ResilienceConfig {
  operationTimeout: number;  // Timeout de operação (ms), 100-60000
  maxRetries: number;        // Máximo de retries, 0-10
  retryBaseDelay: number;    // Delay base para backoff (ms), >= 0
  retryMultiplier: number;   // Multiplicador exponencial, >= 1
}
```

**Valores recomendados:**
- Development: `operationTimeout: 10000` (10s)
- Production: `operationTimeout: 5000` (5s)
- Testing: `operationTimeout: 2000` (2s)

### Security Configuration

```typescript
interface SecurityConfig {
  enableEncryption: boolean;           // Habilitar criptografia
  enableCompression: boolean;          // Habilitar compressão
  encryptionAlgorithm: 'aes-256-gcm' | 'secretbox';
  compressionAlgorithm: 'snappy' | 'gzip' | 'lz4';
  keyRotationDays: number;             // Rotação de chaves (dias), min: 1
  enableDebugLogging: boolean;         // Debug logging
  environment: 'development' | 'production' | 'test';
}
```

**Recomendações:**
- Production: `enableEncryption: true` com `masterKey`
- Development: `enableEncryption: false` para debug
- Key rotation: 90-180 dias para produção

### Observability Configuration

```typescript
interface ObservabilityConfig {
  enableMetrics: boolean;      // Métricas Prometheus
  enableTracing: boolean;      // OpenTelemetry (futuro)
  enableDetailedLogs: boolean; // Logs detalhados
  metricsInterval: number;     // Intervalo de coleta (ms), min: 1000
}
```

## Presets

Três presets testados estão disponíveis:

### 1. DEVELOPMENT

**Uso:** Desenvolvimento local e debug

```typescript
import { createHybridConfigFromPreset } from '@baileys-store/core';

const config = createHybridConfigFromPreset('DEVELOPMENT', {
  mongoUrl: 'mongodb://localhost:27017',
  mongoDatabase: 'whatsapp_dev',
  mongoCollection: 'sessions',
  masterKey: process.env.DEV_MASTER_KEY, // Opcional em dev
});
```

**Características:**
- TTLs curtos (5 minutos) para desenvolvimento rápido
- Timeouts longos (10s) para debug
- Encryption desabilitado (facilita debug)
- Logs detalhados habilitados
- Metrics habilitados

**Performance Score:** ~60/100 (otimizado para desenvolvimento)

### 2. PRODUCTION

**Uso:** Ambiente de produção

```typescript
import { createHybridConfigFromPreset } from '@baileys-store/core';

const config = createHybridConfigFromPreset('PRODUCTION', {
  mongoUrl: process.env.MONGO_URL!,
  mongoDatabase: 'whatsapp_prod',
  mongoCollection: 'sessions',
  redisUrl: process.env.REDIS_URL,
  masterKey: process.env.MASTER_KEY!, // Obrigatório
});
```

**Características:**
- TTLs otimizados (1 hora default, 7 dias para creds/keys)
- Timeouts agressivos (5s)
- Encryption obrigatório (AES-256-GCM)
- Compression habilitada (Snappy)
- Logs mínimos (WARN level)
- Key rotation: 90 dias

**Performance Score:** 95/100 (otimizado para produção)

### 3. TESTING

**Uso:** Testes automatizados

```typescript
import { createHybridConfigFromPreset } from '@baileys-store/core';

const config = createHybridConfigFromPreset('TESTING', {
  mongoUrl: 'mongodb://localhost:27017',
  mongoDatabase: 'test',
  mongoCollection: 'sessions',
});
```

**Características:**
- TTLs curtíssimos (30 segundos)
- Timeouts rápidos (2s) para falha rápida
- Encryption desabilitado
- Metrics desabilitados
- Logs desabilitados

**Performance Score:** ~70/100 (otimizado para velocidade)

## Validação

### Validação Básica

```typescript
import { validateAndReportConfig } from '@baileys-store/core/validation';

const config = { /* ... */ };

const report = validateAndReportConfig(config);

if (!report.valid) {
  console.error('Configuração inválida:');
  report.errors?.forEach(error => {
    console.error(`- ${error.path}: ${error.message}`);
    if (error.suggestedFix) {
      console.error(`  Sugestão: ${error.suggestedFix}`);
    }
  });
  process.exit(1);
}
```

### Relatório Completo

```typescript
const report = validateAndReportConfig(config);

// Performance Score (0-100)
console.log(`Performance Score: ${report.performanceScore}/100`);

// Security Warnings
if (report.securityWarnings?.length) {
  console.warn('Security Warnings:');
  report.securityWarnings.forEach(warning => console.warn(`- ${warning}`));
}

// Optimization Warnings
if (report.warnings?.length) {
  console.warn('Optimization Suggestions:');
  report.warnings.forEach(warning => console.warn(`- ${warning}`));
}
```

### Exemplo de Erro

```
Configuração inválida:
- ttl.defaultTtl: defaultTtl must be at least 1 second
  Sugestão: Use a value >= 1 second (e.g., 300 for 5 minutes)
- security.masterKey: masterKey is required when encryption is enabled
  Sugestão: Provide a 64-character hexadecimal master key: openssl rand -hex 32

Performance Score: 45/100
Security Warnings:
- ⚠️  No masterKey provided - using default test key (INSECURE)
```

## Configuração Avançada

### Override de Presets

```typescript
import { PRODUCTION } from '@baileys-store/core/config/presets';

const customConfig = {
  ...PRODUCTION,
  ttl: {
    ...PRODUCTION.ttl,
    defaultTtl: 7200, // 2 horas (override)
  },
  resilience: {
    ...PRODUCTION.resilience,
    maxRetries: 5, // Mais retries
  },
};
```

### Configuração Personalizada

```typescript
import { HybridStoreConfigSchema } from '@baileys-store/core/validation';

const customConfig = {
  mongoUrl: 'mongodb://localhost:27017',
  mongoDatabase: 'custom_db',
  mongoCollection: 'custom_collection',
  ttl: {
    defaultTtl: 3600,
    credsTtl: 604800,
    keysTtl: 604800,
    lockTtl: 5,
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
    enableDebugLogging: false,
    environment: 'production',
  },
  observability: {
    enableMetrics: true,
    enableTracing: false,
    enableDetailedLogs: false,
    metricsInterval: 60000,
  },
  masterKey: process.env.MASTER_KEY,
};

// Validar com Zod
const result = HybridStoreConfigSchema.safeParse(customConfig);
if (!result.success) {
  console.error('Validation failed:', result.error.errors);
  throw new Error('Invalid configuration');
}

const validatedConfig = result.data;
```

## Troubleshooting

### Erro: "masterKey is required when encryption is enabled"

**Causa:** Criptografia habilitada sem master key.

**Solução:**
```bash
# Gerar master key segura
openssl rand -hex 32

# Adicionar ao .env
MASTER_KEY=<gerada-key>
```

```typescript
const config = createHybridConfigFromPreset('PRODUCTION', {
  // ...
  masterKey: process.env.MASTER_KEY!, // Use a key gerada
});
```

### Performance Score Baixo (< 70)

**Causas comuns:**
- TTLs muito curtos (< 300s)
- Retries excessivos (> 5)
- Compression desabilitada em produção

**Soluções:**
```typescript
const config = {
  ttl: {
    defaultTtl: 3600, // Aumentar para 1 hora
  },
  resilience: {
    maxRetries: 3, // Reduzir para 3
  },
  security: {
    enableCompression: true, // Habilitar
  },
};
```

### Security Warning: "Key rotation period > 1 year"

**Causa:** Rotação de chave configurada para mais de 365 dias.

**Solução:**
```typescript
security: {
  keyRotationDays: 90, // Reduzir para 90 dias
}
```

### Validation Error: "operationTimeout should not exceed 60s"

**Causa:** Timeout configurado acima de 60 segundos.

**Solução:**
```typescript
resilience: {
  operationTimeout: 5000, // Reduzir para 5 segundos
}
```

## Referências

- [Zod Documentation](https://zod.dev/)
- [Error Codes](./ERROR_CODES.md)
- [Architecture Decisions](../ARCHITECTURE.md)
- [Performance Benchmarks](../PAPER.md)

