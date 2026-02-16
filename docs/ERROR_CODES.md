# Error Codes Catalog

Catálogo completo de códigos de erro do baileys-store-core com estratégias de recuperação.

## Visão Geral

Este documento cataloga todos os erros possíveis retornados pela biblioteca, organizados por domínio (Storage, Encryption, Validation, Resilience).

### Estrutura de um Erro

```typescript
interface Error {
  name: string;
  message: string;
  metadata: {
    code: ErrorCode;
    domain: ErrorDomain;
    severity: ErrorSeverity;
    retryable: boolean;
    statusCode?: number;
    documentationUrl: string;
  };
  cause?: Error;
}
```

## Tabela de Erros

| Error Code                  | Domain     | Severity    | Retryable | HTTP | Descrição                      |
| --------------------------- | ---------- | ----------- | --------- | ---- | ------------------------------ |
| `ERR_STORAGE_REDIS`         | STORAGE    | DEGRADED    | ✅        | 503  | Redis indisponível             |
| `ERR_STORAGE_MONGO`         | STORAGE    | CRITICAL    | ✅        | 503  | MongoDB indisponível           |
| `ERR_STORAGE_HYBRID`        | STORAGE    | DEGRADED    | ✅        | 503  | Ambas as stores falharam       |
| `ERR_VERSION_MISMATCH`      | STORAGE    | CRITICAL    | ❌        | 409  | Conflito de versão otimista    |
| `ERR_ENCRYPTION_FAILED`     | ENCRYPTION | CRITICAL    | ❌        | 500  | Falha na criptografia          |
| `ERR_DECRYPTION_FAILED`     | ENCRYPTION | CRITICAL    | ❌        | 500  | Falha na descriptografia       |
| `ERR_INVALID_KEY`           | ENCRYPTION | CRITICAL    | ❌        | 401  | Chave de criptografia inválida |
| `ERR_KEY_ROTATION_REQUIRED` | ENCRYPTION | DEGRADED    | ❌        | 403  | Rotação de chave necessária    |
| `ERR_INVALID_CONFIG`        | VALIDATION | CRITICAL    | ❌        | 400  | Configuração inválida          |
| `ERR_INVALID_SESSION_ID`    | VALIDATION | RECOVERABLE | ❌        | 400  | ID de sessão inválido          |
| `ERR_TIMEOUT`               | RESILIENCE | RECOVERABLE | ✅        | 408  | Timeout da operação            |
| `ERR_CIRCUIT_BREAKER_OPEN`  | RESILIENCE | DEGRADED    | ✅        | 503  | Circuit breaker aberto         |
| `ERR_MAX_RETRIES_EXCEEDED`  | RESILIENCE | CRITICAL    | ❌        | 503  | Máximo de retries excedido     |

---

## Storage Errors

### ERR_STORAGE_REDIS

**Quando ocorre:** Redis está indisponível ou não responde.

**Severidade:** DEGRADED (sistema funciona parcialmente)

**Recuperação Recomendada:**

```typescript
try {
  await store.get(sessionId);
} catch (error) {
  if (error.metadata.code === 'ERR_STORAGE_REDIS') {
    // Fallback para MongoDB
    const data = await mongoStore.get(sessionId);
    console.warn('Redis unavailable, using MongoDB fallback');
  }
}
```

**Ação:** Verificar conectividade com Redis, verificar redis-server status.

**Documentação:** Ver [Hybrid Storage Architecture](../ARCHITECTURE.md#adr-001)

---

### ERR_STORAGE_MONGO

**Quando ocorre:** MongoDB está indisponível ou não responde.

**Severidade:** CRITICAL (falha total do componente)

**Recuperação Recomendada:**

```typescript
try {
  await store.set(sessionId, patch);
} catch (error) {
  if (error.metadata.code === 'ERR_STORAGE_MONGO') {
    // Operação será persistida via outbox async
    console.warn('MongoDB unavailable, using outbox pattern');
  }
}
```

**Ação:** Verificar MongoDB server status, circuit breaker state.

**Documentação:** Ver [Circuit Breaker States](./diagrams/circuit-breaker.md)

---

### ERR_STORAGE_HYBRID

**Quando ocorre:** Tanto Redis quanto MongoDB falharam.

**Severidade:** DEGRADED

**Recuperação Recomendada:**

```typescript
try {
  await store.get(sessionId);
} catch (error) {
  if (error.metadata.code === 'ERR_STORAGE_HYBRID') {
    // Último recurso: retornar erro ou usar cache local
    throw new Error('All storage backends unavailable');
  }
}
```

**Ação:** Verificar infraestrutura completa, alertar equipe SRE.

---

### ERR_VERSION_MISMATCH

**Quando ocorre:** Tentativa de write com versão desatualizada (concurrent write).

**Severidade:** CRITICAL

**Recuperação Recomendada:**

```typescript
let attempts = 0;
while (attempts < 3) {
  try {
    const current = await store.get(sessionId);
    await store.set(sessionId, patch, current.version);
    break;
  } catch (error) {
    if (error.metadata.code === 'ERR_VERSION_MISMATCH') {
      attempts++;
      await new Promise((r) => setTimeout(r, 100 * attempts));
    } else {
      throw error;
    }
  }
}
```

**Ação:** Implementar retry com fresh version (read-modify-write pattern).

---

## Encryption Errors

### ERR_ENCRYPTION_FAILED

**Quando ocorre:** Falha ao criptografar dados (chave inválida, algoritmo não suportado).

**Severidade:** CRITICAL

**Recuperação Recomendada:**

```typescript
// Não há recovery automático para falhas de criptografia
if (error.metadata.code === 'ERR_ENCRYPTION_FAILED') {
  // Log e alert para admin
  logger.error('Encryption failed - check master key');
  // Failsafe: não persistir dados sensíveis
  throw error;
}
```

**Ação:** Verificar `BAILEYS_MASTER_KEY`, verificar algoritmos suportados.

---

### ERR_DECRYPTION_FAILED

**Quando ocorre:** Falha ao descriptografar dados (chave incorreta, dados corrompidos).

**Severidade:** CRITICAL

**Recuperação Recomendada:**

```typescript
// Não há recovery automático
if (error.metadata.code === 'ERR_DECRYPTION_FAILED') {
  // Possível rotação de chave necessária
  logger.error('Decryption failed - possible key rotation required');
  throw error;
}
```

**Ação:** Verificar chave de criptografia, verificar integridade dos dados.

---

### ERR_INVALID_KEY

**Quando ocorre:** Chave de criptografia malformada ou ausente.

**Severidade:** CRITICAL

**Recuperação:** Nenhuma (configuração inválida).

**Ação:** Configurar `BAILEYS_MASTER_KEY` corretamente.

---

### ERR_KEY_ROTATION_REQUIRED

**Quando ocorre:** Chave de criptografia expirada (key rotation policy).

**Severidade:** DEGRADED

**Recuperação Recomendada:**

```typescript
if (error.metadata.code === 'ERR_KEY_ROTATION_REQUIRED') {
  // Trigger key rotation workflow
  await rotateMasterKey();
}
```

**Ação:** Executar procedimento de rotação de chaves.

---

## Validation Errors

### ERR_INVALID_CONFIG

**Quando ocorre:** Configuração inválida (validação Zod falhou).

**Severidade:** CRITICAL

**Recuperação:** Nenhuma (configuração deve ser corrigida).

**Exemplo:**

```typescript
// Config inválido
const config = {
  redisUrl: 'invalid-url',
  ttl: { defaultTtl: -1 }, // TTL negativo inválido
};

// Validação com Zod falha
const result = ConfigSchema.safeParse(config);
if (!result.success) {
  // Retorna ERR_INVALID_CONFIG com detalhes
}
```

**Ação:** Corrigir configuração conforme schema.

---

### ERR_INVALID_SESSION_ID

**Quando ocorre:** Session ID malformado ou vazio.

**Severidade:** RECOVERABLE

**Recuperação:** Corrigir input do usuário.

---

## Resilience Errors

### ERR_TIMEOUT

**Quando ocorre:** Operação excedeu o timeout configurado.

**Severidade:** RECOVERABLE

**Recuperação Recomendada:**

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.metadata.code === 'ERR_TIMEOUT' && i < maxAttempts - 1) {
        const delay = getRetryDelay(error.metadata.code, i);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

**Ação:** Implementar retry com exponential backoff.

---

### ERR_CIRCUIT_BREAKER_OPEN

**Quando ocorre:** Circuit breaker está aberto (MongoDB falhando).

**Severidade:** DEGRADED

**Recuperação Recomendada:**

```typescript
if (error.metadata.code === 'ERR_CIRCUIT_BREAKER_OPEN') {
  // Modo degradado: operar apenas com Redis
  const cachedData = await redisStore.get(sessionId);
  if (cachedData) {
    return cachedData; // Retornar dados potencialmente stale
  }
  throw new Error('Circuit breaker open and no cached data');
}
```

**Ação:** Aguardar recuperação automática (30s timeout), verificar MongoDB health.

**Documentação:** Ver [Circuit Breaker States](./diagrams/circuit-breaker.md)

---

### ERR_MAX_RETRIES_EXCEEDED

**Quando ocorre:** Número máximo de tentativas excedido.

**Severidade:** CRITICAL

**Recuperação:** Nenhuma (requer intervenção manual).

**Ação:** Verificar infraestrutura, verificar logs de erro.

---

## Estratégias de Retry

### Retry com Exponential Backoff

```typescript
import { getRetryDelay, isRetryable } from '@luoarch/baileys-store-core/errors';

async function retryOperation<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error.metadata.code)) {
        throw error; // Não retryable
      }

      if (attempt === maxAttempts - 1) {
        throw error; // Última tentativa
      }

      const delay = getRetryDelay(error.metadata.code, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Should not reach here');
}
```

## Monitoring e Alerting

### Métricas Prometheus

```promql
# Erro rate por tipo
rate(baileys_errors_total[5m]) by (code)

# Erro rate por severidade
rate(baileys_errors_total[5m]) by (severity)

# Retry success rate
rate(baileys_retries_success_total[5m]) / rate(baileys_retries_total[5m])
```

### Alertas Recomendados

- **Warning:** `ERR_TIMEOUT` rate > 10% for 5min
- **Critical:** `ERR_CIRCUIT_BREAKER_OPEN` for > 60s
- **Critical:** `ERR_MAX_RETRIES_EXCEEDED` > 0

---

**Referências:**

- [Architecture Decision Records](../ARCHITECTURE.md)
- [Circuit Breaker States](./diagrams/circuit-breaker.md)
- [Data Consistency Model](./diagrams/data-consistency.md)
