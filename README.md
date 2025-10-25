# @luoarch/baileys-store-core

> ⚠️ **Release Candidate**: Currently at v1.0.0-rc.1. Stable v1.0.0 coming soon!  
> 💬 **Feedback Welcome**: [GitHub Discussions](https://github.com/luoarch/baileys-store-core/discussions)

Production-grade authentication state management for Baileys v7.0+ with Redis, MongoDB, and hybrid storage

[![npm RC](https://img.shields.io/npm/v/@luoarch/baileys-store-core/next.svg?label=rc&color=orange)](https://www.npmjs.com/package/@luoarch/baileys-store-core)
[![npm stable](https://img.shields.io/npm/v/@luoarch/baileys-store-core.svg?label=stable&color=lightgrey)](https://www.npmjs.com/package/@luoarch/baileys-store-core)
[![Build Status](https://github.com/luoarch/baileys-store-core/workflows/CI/badge.svg)](https://github.com/luoarch/baileys-store-core/actions)
[![codecov](https://codecov.io/gh/luoarch/baileys-store-core/branch/main/graph/badge.svg?token=YOUR_TOKEN)](https://codecov.io/gh/luoarch/baileys-store-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![DOI](https://img.shields.io/badge/DOI-Pending-orange.svg)]()

## Features

- ✅ **Baileys v7.0.0-rc.6 Compatible** - Fixes critical serialization bugs
- 🚀 **Hybrid Storage** - Redis (hot cache) + MongoDB (cold storage)
- 🔒 **Production-Ready** - Circuit breaker, outbox pattern, mutex concurrency control
- 📊 **Prometheus Metrics** - 13 thread-safe metrics for observability
- 🔐 **Type-Safe** - Strong Buffer typing, prevents RC.6 serialization errors
- ⚡ **High Performance** - < 5ms read latency (Redis), async MongoDB writes
- 🛡️ **Fault Tolerant** - Graceful degradation, partial failure compensation
- 📦 **Tree-Shakeable** - Granular exports, only import what you need
- 🧪 **Well-Tested** - 52 tests (unit + integration + E2E)

## Quick Start (RC1)

```bash
# Install release candidate
npm install @luoarch/baileys-store-core@next

# Or specific version
npm install @luoarch/baileys-store-core@1.0.0-rc.1

# Stable version (after release)
npm install @luoarch/baileys-store-core
```

> **Note:** Stable version not yet available. Use `@next` tag to test RC1.

### Hybrid Storage (Recommended)

```typescript
import { makeWASocket } from '@whiskeysockets/baileys';
import { useHybridAuthState } from '@luoarch/baileys-store-core/hybrid';

const { state, saveCreds, store } = await useHybridAuthState({
  sessionId: 'my-session',
  hybrid: {
    redisUrl: 'redis://localhost:6379',
    mongoUrl: 'mongodb://localhost:27017',
    mongoDatabase: 'whatsapp',
    mongoCollection: 'auth',
    ttl: {
      defaultTtl: 30 * 24 * 60 * 60, // 30 days
      credsTtl: 30 * 24 * 60 * 60,
      keysTtl: 30 * 24 * 60 * 60,
      lockTtl: 5,
    },
    masterKey: process.env.BAILEYS_MASTER_KEY, // 64-char hex key
    security: {
      enableEncryption: false, // Set true in production
      enableCompression: false,
      encryptionAlgorithm: 'secretbox',
      compressionAlgorithm: 'snappy',
      keyRotationDays: 90,
      enableDebugLogging: false, // Set true for development debugging
      environment: 'production', // 'development' | 'production' | 'test'
    },
    resilience: {
      operationTimeout: 5000,
      maxRetries: 3,
      retryBaseDelay: 100,
      retryMultiplier: 2,
    },
    observability: {
      enableMetrics: true,
      enableTracing: false,
      enableDetailedLogs: false,
      metricsInterval: 60000,
    },
    enableWriteBehind: false, // Set true with queue for async MongoDB writes
  },
});

const socket = makeWASocket({ auth: state });

socket.ev.on('creds.update', saveCreds);
socket.ev.on('connection.update', (update) => {
  console.log('Connection:', update.connection);
});
```

### Redis Only

```typescript
import { useRedisAuthState } from '@luoarch/baileys-store-core/redis';

const { state, saveCreds, store } = await useRedisAuthState({
  sessionId: 'redis-session',
  redis: {
    redisUrl: 'redis://localhost:6379',
    ttl: {
      defaultTtl: 30 * 24 * 60 * 60,
      credsTtl: 30 * 24 * 60 * 60,
      keysTtl: 30 * 24 * 60 * 60,
      lockTtl: 5,
    },
    masterKey: process.env.BAILEYS_MASTER_KEY,
    // ... other configs
  },
});
```

### MongoDB Only

```typescript
import { useMongoAuthState } from '@luoarch/baileys-store-core/mongodb';

const { state, saveCreds, store } = await useMongoAuthState({
  sessionId: 'mongo-session',
  mongodb: {
    mongoUrl: 'mongodb://localhost:27017',
    database: 'whatsapp',
    collection: 'auth',
    ttl: {
      defaultTtl: 30 * 24 * 60 * 60,
      credsTtl: 30 * 24 * 60 * 60,
      keysTtl: 30 * 24 * 60 * 60,
      lockTtl: 5,
    },
    masterKey: process.env.BAILEYS_MASTER_KEY,
    // ... other configs
  },
});
```

## Advanced Features

### Circuit Breaker

Automatic MongoDB degradation when error rate exceeds threshold:

```typescript
// Check circuit breaker status
const isOpen = store.isMongoCircuitBreakerOpen();
const stats = store.getCircuitBreakerStats();

console.log('Circuit Breaker:', { isOpen, fires: stats.fires });
```

### Prometheus Metrics

```typescript
// Expose metrics for Prometheus scraping
import express from 'express';

const app = express();

app.get('/metrics', async (req, res) => {
  const metricsText = await store.getMetricsText();
  res.set('Content-Type', 'text/plain');
  res.send(metricsText);
});

app.listen(9090);
```

**Available Metrics:**

- `baileys_store_redis_hits_total` - Redis cache hits
- `baileys_store_redis_misses_total` - Redis cache misses
- `baileys_store_mongo_fallbacks_total` - MongoDB fallback reads
- `baileys_store_circuit_breaker_open_total` - Circuit breaker activations
- `baileys_store_outbox_reconciler_latency_seconds` - Outbox reconciliation latency (histogram)
- And 8 more...

### Transactional Outbox

Ensure dual-write consistency with automatic reconciliation:

```typescript
const { store } = await useHybridAuthState({
  sessionId: 'outbox-example',
  hybrid: {
    // ... config
    enableWriteBehind: true,
    queue: myQueueAdapter, // Inject your BullMQ/Kafka adapter
  },
});

// Get outbox stats
const outboxStats = store.getOutboxStats();
console.log('Pending writes:', outboxStats.totalProcessed);

// Manually trigger reconciliation
await store.reconcileOutbox();
```

## Performance Benchmarks

| Operation               | Latency (p50) | Latency (p99) |
| ----------------------- | ------------- | ------------- |
| Read (cached)           | 3.2ms         | 8.1ms         |
| Read (MongoDB fallback) | 18.5ms        | 45.2ms        |
| Write (Redis sync)      | 5.1ms         | 12.3ms        |
| Write (MongoDB async)   | N/A (queued)  | N/A           |

**Test conditions:** 100 sessions, 1000 ops each, 10 concurrent

## Configuration Options

### TtlConfig

| Field        | Type   | Default | Description                      |
| ------------ | ------ | ------- | -------------------------------- |
| `defaultTtl` | number | 2592000 | Default TTL in seconds (30 days) |
| `credsTtl`   | number | 2592000 | Credentials TTL                  |
| `keysTtl`    | number | 2592000 | Keys TTL                         |
| `lockTtl`    | number | 5       | Distributed lock TTL             |

### SecurityConfig

| Field                  | Type                                      | Description                                  |
| ---------------------- | ----------------------------------------- | -------------------------------------------- |
| `enableEncryption`     | boolean                                   | Enable AES-256-GCM or Secretbox encryption   |
| `enableCompression`    | boolean                                   | Enable Snappy or Gzip compression            |
| `encryptionAlgorithm`  | `'aes-256-gcm' \| 'secretbox'`            | Encryption algorithm                         |
| `compressionAlgorithm` | `'snappy' \| 'gzip'`                      | Compression algorithm                        |
| `keyRotationDays`      | number                                    | Key rotation interval                        |
| `enableDebugLogging`   | boolean                                   | Enable debug logging (default: false)        |
| `environment`          | `'development' \| 'production' \| 'test'` | Environment for security controls            |
| `logger`               | `Logger`                                  | Custom logger instance (default: NullLogger) |

### ResilienceConfig

| Field              | Type   | Description                              |
| ------------------ | ------ | ---------------------------------------- |
| `operationTimeout` | number | Timeout for storage operations (ms)      |
| `maxRetries`       | number | Max retry attempts for failed operations |
| `retryBaseDelay`   | number | Base delay for exponential backoff (ms)  |
| `retryMultiplier`  | number | Multiplier for exponential backoff       |

## Outbox Format

**Redis Hash:** `outbox:{sessionId}`

**Fields:** `{version}` → OutboxEntry (JSON)

```typescript
interface OutboxEntry {
  id: string; // "${sessionId}:${version}"
  sessionId: string;
  patch: AuthPatch;
  version: number;
  fencingToken?: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: number; // Unix timestamp
  updatedAt: number;
  attempts: number;
  lastError?: string;
  completedAt?: number;
}
```

**TTL:** 7 days (auto-cleanup)

## Troubleshooting

### RC.6 Serialization Errors

If you see `ERR_INVALID_ARG_TYPE: The "value" argument must be of type Buffer`:

**Cause:** Baileys RC.6 serializes Buffers as `{type: 'Buffer', data: [...]}` instead of actual Buffers.

**Fix:** This library automatically revives Buffer-like objects via `deepBufferRevive()`. Ensure you're using v1.0.0+.

### MongoDB E11000 Duplicate Key

**Cause:** Concurrent writes to same session.

**Fix:** Built-in retry logic with exponential backoff handles this automatically. No action needed.

### Circuit Breaker Open

**Cause:** MongoDB error rate exceeded 50% over 10s window.

**Fix:** Library degrades gracefully, serving from Redis cache. MongoDB reconnects automatically after 30s cooldown.

## Monorepo Configuration

Add to your workspace `package.json`:

```json
{
  "workspaces": ["packages/*"],
  "resolutions": {
    "@luoarch/baileys-store-core": "1.0.0-rc.1"
  }
}
```

## API Reference

### Hooks

#### `useRedisAuthState(options): Promise<{ state, saveCreds, store }>`

#### `useMongoAuthState(options): Promise<{ state, saveCreds, store }>`

#### `useHybridAuthState(options): Promise<{ state, saveCreds, store }>`

**Returns:**

- `state: AuthenticationState` - Baileys-compatible auth state
- `saveCreds: () => Promise<void>` - Save credentials function
- `store: RedisAuthStore | MongoAuthStore | HybridAuthStore` - Direct store access

### HybridAuthStore Methods

- `get(sessionId): Promise<Versioned<AuthSnapshot> | null>`
- `set(sessionId, patch, expectedVersion?, fencingToken?): Promise<VersionedResult>`
- `delete(sessionId): Promise<void>`
- `touch(sessionId, ttlSeconds?): Promise<void>`
- `isHealthy(): Promise<boolean>`
- `isMongoCircuitBreakerOpen(): boolean`
- `getCircuitBreakerStats(): CircuitBreakerStats`
- `getMetricsText(): Promise<string>`
- `getMetricsRegistry(): Registry`
- `getOutboxStats(): OutboxReconcilerStats | null`
- `reconcileOutbox(): Promise<void>`

## Node.js Support Policy

This package supports **Active LTS versions** of Node.js:

| Version      | Status        | Support Until |
| ------------ | ------------- | ------------- |
| Node.js 20.x | ✅ Active LTS | 2026-04-30    |
| Node.js 22.x | ✅ Current    | 2027-04-30    |

Older versions may work but are not officially tested or supported.

### Why Node >= 20?

- Native ESM support improvements
- Enhanced TypeScript compatibility (isolatedModules, moduleResolution: "bundler")
- Security updates and performance gains
- Alignment with modern ecosystem standards
- MongoDB driver 6.20+ requires Node >= 16.20.1

### Testing Matrix

Our CI pipeline tests on:

- Node.js 22.x (primary)
- Node.js 23.x (preview)

## Code Coverage

Current coverage: **75%+** (Progressive target: **80%**)

We maintain high test coverage with:

- Unit tests for core logic
- Integration tests with real Redis + MongoDB
- E2E tests simulating Baileys workflows

See [CONTRIBUTING.md](./CONTRIBUTING.md) for testing guidelines.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repo
2. Create feature branch: `git checkout -b feature/my-feature`
3. Run tests: `yarn test && yarn test:integration && yarn test:e2e`
4. Lint: `yarn lint && yarn typecheck`
5. Commit: `git commit -m "feat: my feature"`
6. Push: `git push origin feature/my-feature`
7. Create Pull Request

## License

MIT © Lucas Moraes

## Citation

For academic use, see [CITATION.cff](./CITATION.cff) or cite as:

```bibtex
@software{baileys_store_2025,
  author = {Moraes, Lucas},
  title = {@luoarch/baileys-store-core},
  year = {2025},
  url = {https://github.com/luoarch/baileys-store-core},
  version = {1.0.0-rc.1}
}
```

Full academic paper: [docs/PAPER.md](./docs/PAPER.md)

---

**Made with ❤️ for the Baileys community**
