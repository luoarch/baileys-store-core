# @luoarch/baileys-store-core

> **Release Candidate**: Currently at v1.0.0-rc.5. Stable v1.0.0 coming soon!
> **Feedback Welcome**: [GitHub Discussions](https://github.com/luoarch/baileys-store-core/discussions)

Production-grade authentication state management for Baileys v7.0+ with Redis, MongoDB, and hybrid storage

[![npm RC](https://img.shields.io/npm/v/@luoarch/baileys-store-core/next.svg?label=rc&color=orange)](https://www.npmjs.com/package/@luoarch/baileys-store-core)
[![npm stable](https://img.shields.io/npm/v/@luoarch/baileys-store-core.svg?label=stable&color=lightgrey)](https://www.npmjs.com/package/@luoarch/baileys-store-core)
[![Build Status](https://github.com/luoarch/baileys-store-core/workflows/CI/badge.svg)](https://github.com/luoarch/baileys-store-core/actions)
[![codecov](https://codecov.io/gh/luoarch/baileys-store-core/branch/main/graph/badge.svg?token=YOUR_TOKEN)](https://codecov.io/gh/luoarch/baileys-store-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.18659706.svg)](https://doi.org/10.5281/zenodo.18659706)

## Features

- **Baileys v7.0.0-rc.9 Compatible** - Fixes critical serialization bugs
- **Hybrid Storage** - Redis (hot cache) + MongoDB (cold storage)
- **Production-Ready** - Circuit breaker, outbox pattern, mutex concurrency control
- **Rate Limiting** - WhatsApp ban prevention with token bucket algorithm (12 msg/min threshold)
- **Session Monitoring** - Rotation anomaly detection and connection health tracking
- **LID Mapping Cache** - Redis-backed LID/PN identity resolution cache
- **Diagnostic Engine** - Unified health diagnostics with actionable recommendations
- **Prometheus Metrics** - 25+ thread-safe metrics for observability
- **Type-Safe** - Strong Buffer typing, prevents RC.6 serialization errors
- **High Performance** - < 5ms read latency (Redis), async MongoDB writes
- **Fault Tolerant** - Graceful degradation, partial failure compensation
- **Tree-Shakeable** - Granular exports, only import what you need
- **Well-Tested** - 796 tests (unit + integration + E2E), 97%+ coverage
- **Config Presets** - Development, Production, and Testing configurations out of the box
- **Well-Documented** - ADRs, SLA, Research documentation

## Installation

### Release Candidate (Recommended)

```bash
# Install both packages (required)
npm install @whiskeysockets/baileys@latest @luoarch/baileys-store-core@1.0.0-rc.5

# Or with Yarn
yarn add @whiskeysockets/baileys@latest @luoarch/baileys-store-core@1.0.0-rc.5
```

### Stable Version (Coming Soon)

```bash
# After stable release
npm install @whiskeysockets/baileys@latest @luoarch/baileys-store-core

# Or with Yarn
yarn add @whiskeysockets/baileys@latest @luoarch/baileys-store-core
```

> **Important:** You must install both `@whiskeysockets/baileys` and `@luoarch/baileys-store-core` as this library is a peer dependency of Baileys.

### Hybrid Storage with Config Presets (Recommended)

```typescript
import { makeWASocket } from '@whiskeysockets/baileys';
import {
  useHybridAuthState,
  createHybridConfigFromPreset,
} from '@luoarch/baileys-store-core/hybrid';

// Use PRODUCTION preset with minimal configuration
const config = createHybridConfigFromPreset('PRODUCTION', {
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
  mongoDatabase: 'whatsapp',
  mongoCollection: 'auth',
  masterKey: process.env.BAILEYS_MASTER_KEY, // 64-char hex key
});

const { state, saveCreds, store } = await useHybridAuthState({
  sessionId: 'my-session',
  hybrid: config,
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

### Rate Limiting (WhatsApp Ban Prevention)

Protect your sessions from WhatsApp automation detection with built-in rate limiting:

```typescript
import { SessionRateLimiter } from '@luoarch/baileys-store-core';

const limiter = new SessionRateLimiter({
  maxMessagesPerMinute: 12, // Validated threshold from community research
  coldContactMultiplier: 0.33, // 4 msg/min for new contacts
  jitterRangeMs: [500, 1500], // Human-like random delays
  warmupPeriodDays: 10, // Gradual ramp-up for new numbers
  enabled: true,
});

// Before sending a message
const status = await limiter.acquire(sessionId, { isColdContact: false });

if (status.allowed) {
  await sendMessage();
  console.log(`Tokens remaining: ${status.tokensRemaining}`);
}
```

**Rate Limit Thresholds** (validated by community research):

| Scenario            | Threshold       | Source                                         |
| ------------------- | --------------- | ---------------------------------------------- |
| General messages    | 12 msg/min      | [WhatsApp Risk Control](https://www.a2c.chat/) |
| Cold contacts       | 4 msg/min       | Empirical data                                 |
| New number (warmup) | 20 contacts/day | [GREEN-API](https://green-api.com/en/blog/)    |

### Session Rotation Monitor

Detect abnormal Signal session rotation that correlates with WhatsApp bans ([GitHub #2340](https://github.com/WhiskeySockets/Baileys/issues/2340)):

```typescript
import { RotationMonitor } from '@luoarch/baileys-store-core';

const monitor = new RotationMonitor({
  thresholdPerMinute: 10, // Anomaly threshold
  windowMs: 60000, // 1 minute window
});

// Record rotation events from Baileys
socket.ev.on('messaging-history.set', () => {
  const status = monitor.recordRotation(sessionId);

  if (status.status === 'ANOMALY') {
    console.warn(`Session rotation anomaly detected: ${status.rate}/min`);
    // Take action: pause session, alert, etc.
  }
});

// Subscribe to anomaly notifications
monitor.onAnomaly((status) => {
  alertOps(`Session ${status.sessionId} rotation rate: ${status.rate}/min`);
});
```

### Connection Health Tracker

Monitor connection health and detect false "online" status ([GitHub #2302](https://github.com/WhiskeySockets/Baileys/issues/2302), [#2337](https://github.com/WhiskeySockets/Baileys/issues/2337)):

```typescript
import { ConnectionHealthTracker } from '@luoarch/baileys-store-core';

const tracker = new ConnectionHealthTracker({
  silenceThresholdMs: 300000, // 5 minutes
  disconnectThresholdMs: 600000, // 10 minutes
});

// Record activity from socket events
socket.ev.on('messages.upsert', () => {
  tracker.recordActivity(sessionId);
});

// Check connection health
const health = tracker.checkHealth(sessionId);

if (health.status === 'DEGRADED') {
  console.log(`Silent for ${health.silentMs}ms, recommendation: ${health.recommendation}`);
  // PING the connection
}

if (health.status === 'DISCONNECTED') {
  // Trigger reconnection
}

// Get sessions by state
const disconnected = tracker.getSessionsByState('DISCONNECTED');
const reconnecting = tracker.getSessionsByState('RECONNECTING');
```

### LID Mapping Cache

Cache LID (Local Identifier) to PN (Phone Number) mappings for reliable identity resolution ([GitHub #2263](https://github.com/WhiskeySockets/Baileys/issues/2263)):

```typescript
import { LIDMappingCache } from '@luoarch/baileys-store-core';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);
const lidCache = new LIDMappingCache(redis, {
  lidKeyPrefix: 'baileys:lid:',
  pnKeyPrefix: 'baileys:pn:',
  ttlSeconds: 86400 * 30, // 30 days
  enableTimestamps: true,
});

// Store mappings (bidirectional)
await lidCache.storeMapping(lid, phoneNumber);

// Batch store from Baileys lid-mapping.update event
socket.ev.on('lid-mapping.update', async (mappings) => {
  const entries = Object.entries(mappings).map(([lid, pn]) => ({ lid, pn }));
  await lidCache.storeMappings(entries);
});

// Resolve LID to phone number
const pn = await lidCache.getPNForLID('12345678@lid');

// Resolve phone number to LID
const lid = await lidCache.getLIDForPN('5511999999999@s.whatsapp.net');

// Batch resolution
const results = await lidCache.batchGetPNForLIDs(['lid1', 'lid2', 'lid3']);
```

### Diagnostic Engine

Unified diagnostics aggregating all monitors with actionable recommendations:

```typescript
import {
  DiagnosticEngine,
  RotationMonitor,
  ConnectionHealthTracker,
  SessionRateLimiter,
} from '@luoarch/baileys-store-core';

const engine = new DiagnosticEngine({
  rotationMonitor: new RotationMonitor(),
  connectionTracker: new ConnectionHealthTracker(),
  rateLimiter: new SessionRateLimiter(),
});

// Full diagnostic report
const report = engine.diagnose(sessionId);

console.log('Overall Status:', report.overallStatus); // OK | WARNING | CRITICAL
console.log('Checks:', report.checks);
console.log('Recommendations:', report.recommendations);

// Quick health check
const status = engine.quickCheck(sessionId); // OK | WARNING | CRITICAL

// Get all sessions needing attention
const problemSessions = engine.getSessionsRequiringAttention();
```

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

**Available Metrics (25+):**

| Metric                                            | Type      | Description                                              |
| ------------------------------------------------- | --------- | -------------------------------------------------------- |
| `baileys_store_redis_hits_total`                  | Counter   | Redis cache hits                                         |
| `baileys_store_redis_misses_total`                | Counter   | Redis cache misses                                       |
| `baileys_store_mongo_fallbacks_total`             | Counter   | MongoDB fallback reads                                   |
| `baileys_store_circuit_breaker_open_total`        | Counter   | Circuit breaker activations                              |
| `baileys_store_outbox_reconciler_latency_seconds` | Histogram | Outbox reconciliation latency                            |
| `baileys_rate_limit_wait_total`                   | Counter   | Rate limit waits                                         |
| `baileys_rate_limit_tokens`                       | Gauge     | Available rate limit tokens                              |
| `baileys_rotation_anomaly_total`                  | Counter   | Rotation anomalies detected                              |
| `baileys_rotation_rate`                           | Gauge     | Current rotation rate per session                        |
| `baileys_connection_state`                        | Gauge     | Connection state (0=disconnected, 1=degraded, 2=healthy) |
| `baileys_connection_silence_seconds`              | Gauge     | Time since last activity                                 |
| `baileys_reconnection_attempts_total`             | Counter   | Reconnection attempts                                    |
| `baileys_reconnection_success_total`              | Counter   | Successful reconnections                                 |
| `baileys_lid_mapping_cache_hits_total`            | Counter   | LID cache hits                                           |
| `baileys_lid_mapping_cache_misses_total`          | Counter   | LID cache misses                                         |
| `baileys_lid_mappings_stored_total`               | Counter   | LID mappings stored                                      |
| `baileys_diagnostic_checks_total`                 | Counter   | Diagnostic checks performed                              |
| `baileys_diagnostic_recommendations`              | Gauge     | Active recommendations count                             |

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

### RateLimitConfig

| Field                   | Type             | Default     | Description                           |
| ----------------------- | ---------------- | ----------- | ------------------------------------- |
| `maxMessagesPerMinute`  | number           | 12          | Max messages per minute               |
| `coldContactMultiplier` | number           | 0.33        | Rate multiplier for cold contacts     |
| `jitterRangeMs`         | [number, number] | [500, 1500] | Random delay range (ms)               |
| `warmupPeriodDays`      | number           | 10          | Warmup period for new sessions (days) |
| `enabled`               | boolean          | true        | Enable rate limiting                  |

### MonitoringConfig

| Field                        | Type    | Default | Description                            |
| ---------------------------- | ------- | ------- | -------------------------------------- |
| `rotationThresholdPerMinute` | number  | 10      | Rotation anomaly threshold             |
| `silenceThresholdMs`         | number  | 300000  | Silence threshold for degradation (ms) |
| `disconnectThresholdMs`      | number  | 600000  | Silence threshold for disconnect (ms)  |
| `enabled`                    | boolean | true    | Enable monitoring                      |

## Config Presets

Pre-configured presets for different environments:

### DEVELOPMENT

- Short TTLs (5 minutes) for rapid iteration
- Long timeouts (10s) for debugging
- Detailed logging enabled
- Encryption disabled
- Rate limiting disabled
- High rotation threshold (100/min)

### PRODUCTION

- Optimized TTLs (1 hour default, 7 days for creds/keys)
- Aggressive timeouts (5s)
- Encryption mandatory (AES-256-GCM)
- Minimal logging
- Rate limiting enabled (12 msg/min)
- Rotation threshold (10/min) from [GitHub #2340](https://github.com/WhiskeySockets/Baileys/issues/2340)

### TESTING

- Very short TTLs (30s) for quick tests
- Fast timeouts (2s)
- Encryption disabled
- Metrics disabled
- Rate limiting disabled

```typescript
import { createHybridConfigFromPreset } from '@luoarch/baileys-store-core';

// Use PRODUCTION preset
const config = createHybridConfigFromPreset('PRODUCTION', {
  mongoUrl: process.env.MONGO_URL!,
  mongoDatabase: 'whatsapp',
  mongoCollection: 'sessions',
  masterKey: process.env.BAILEYS_MASTER_KEY!,
});
```

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

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Architecture Decision Records (ADRs) documenting key design decisions
- **[docs/SLA.md](./docs/SLA.md)** - Service Level Objectives (SLOs) and metrics
- **[docs/RESEARCH.md](./docs/RESEARCH.md)** - Research contributions and academic context
- **[docs/PAPER.md](./docs/PAPER.md)** - Full academic paper
- **[docs/LOAD_TESTING.md](./docs/LOAD_TESTING.md)** - Load testing guide with k6
- **[ROADMAP.md](./ROADMAP.md)** - Development roadmap and milestones

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

### WhatsApp Account Ban

**Cause:** Automation detected due to high message rate or abnormal session rotation.

**Fix:** Use the built-in `SessionRateLimiter` with conservative thresholds:

- Enable rate limiting with 12 msg/min threshold
- Use cold contact multiplier (0.33) for new contacts
- Enable warmup period for new numbers
- Monitor session rotation with `RotationMonitor`

### Session Rotation Anomaly

**Cause:** [GitHub #2340](https://github.com/WhiskeySockets/Baileys/issues/2340) - Aggressive session rotation correlates with bans.

**Fix:** Use `RotationMonitor` to detect anomalies and pause sessions exceeding 10 rotations/minute.

### False "Online" Status

**Cause:** [GitHub #2302](https://github.com/WhiskeySockets/Baileys/issues/2302) - Connection appears online but is actually disconnected.

**Fix:** Use `ConnectionHealthTracker` to detect silent connections and trigger proactive reconnection.

## Monorepo Configuration

Add to your workspace `package.json`:

```json
{
  "workspaces": ["packages/*"],
  "resolutions": {
    "@luoarch/baileys-store-core": "1.0.0-rc.5"
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

### Monitoring Classes

- `SessionRateLimiter` - Token bucket rate limiter
- `RotationMonitor` - Session rotation anomaly detection
- `ConnectionHealthTracker` - Connection health monitoring
- `LIDMappingCache` - LID/PN identity cache
- `DiagnosticEngine` - Unified diagnostics

## Node.js Support Policy

This package supports **Active LTS versions** of Node.js:

| Version      | Status     | Support Until |
| ------------ | ---------- | ------------- |
| Node.js 20.x | Active LTS | 2026-04-30    |
| Node.js 22.x | Current    | 2027-04-30    |

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

Current coverage: **97%+** (796 tests)

We maintain high test coverage with:

- Unit tests for core logic
- Integration tests with real Redis + MongoDB
- E2E tests simulating Baileys workflows
- Edge case tests based on community bug reports

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
  version = {1.0.0-rc.5}
}
```

Full academic paper: [docs/PAPER.md](./docs/PAPER.md)

---

**Made with love for the Baileys community**
