# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0-rc.5] - 2026-02-16

### Added

- **Rate Limiting**: Token bucket rate limiter for WhatsApp ban prevention
  - 12 msg/min threshold (validated by community research)
  - Cold contact multiplier (0.33 = 4 msg/min)
  - Human-like jitter delays (500-1500ms)
  - Warmup period for new numbers (10 days)
  - Session metadata tracking

- **Session Rotation Monitor**: Detects abnormal Signal session rotation
  - Threshold-based anomaly detection (10 rotations/minute)
  - Sliding window tracking
  - Event listener support (`onAnomaly`)
  - Addresses [GitHub #2340](https://github.com/WhiskeySockets/Baileys/issues/2340)

- **Connection Health Tracker**: Monitors connection health status
  - Silence threshold detection (DEGRADED after 5 min)
  - Disconnect threshold detection (DISCONNECTED after 10 min)
  - Reconnection attempt tracking
  - State-based session filtering
  - Addresses [GitHub #2302](https://github.com/WhiskeySockets/Baileys/issues/2302), [#2337](https://github.com/WhiskeySockets/Baileys/issues/2337)

- **LID Mapping Cache**: Redis-backed LID/PN identity resolution
  - Bidirectional mapping (LID ↔ PN)
  - Batch operations with pipeline
  - TTL support with optional timestamps
  - Addresses [GitHub #2263](https://github.com/WhiskeySockets/Baileys/issues/2263)

- **Diagnostic Engine**: Unified health diagnostics
  - Aggregates all monitors (rotation, connection, rate limit)
  - Overall status (OK | WARNING | CRITICAL)
  - Actionable recommendations
  - Session attention detection

- **12 New Prometheus Metrics**:
  - `baileys_rate_limit_wait_total` - Rate limit waits
  - `baileys_rate_limit_tokens` - Available tokens gauge
  - `baileys_rotation_anomaly_total` - Anomalies detected
  - `baileys_rotation_rate` - Current rotation rate
  - `baileys_connection_state` - Connection state gauge
  - `baileys_connection_silence_seconds` - Silence duration
  - `baileys_reconnection_attempts_total` - Reconnection attempts
  - `baileys_reconnection_success_total` - Successful reconnections
  - `baileys_lid_mapping_cache_hits_total` - LID cache hits
  - `baileys_lid_mapping_cache_misses_total` - LID cache misses
  - `baileys_lid_mappings_stored_total` - Mappings stored
  - `baileys_diagnostic_checks_total` - Diagnostic checks

- **Config Presets**: Extended with rate limiting and monitoring configs
  - `RateLimitConfig` interface
  - `MonitoringConfig` interface
  - DEVELOPMENT/PRODUCTION/TESTING presets updated

### Changed

- Test suite expanded from 652 to 796 tests
- Code coverage improved to 97%+ (from 94%)
- Updated to Baileys v7.0.0-rc.9 compatibility

### Security

- Rate limiting prevents WhatsApp automation detection bans
- Rotation monitoring prevents session abuse patterns

## [1.0.0-rc.4] - 2026-02-16

### Fixed

- **MongoDB**: Re-enabled optimistic locking version checking (was disabled)
- **Redis**: Replaced `Promise.all()` with pipeline for atomic batch writes
- **Hybrid**: Fixed TOCTOU race condition in cache warming with Redis WATCH
- **Hybrid**: Fixed mutex memory leak with LRU cache (max 10k sessions, 30 min TTL)
- **Outbox**: Fixed deduplication using HSETNX instead of HSET
- **Outbox**: Added batch reconciliation with p-limit concurrency control
- **Outbox**: Added dead letter queue (DLQ) for failed entries

### Added

- `lru-cache` dependency for mutex memory management
- `p-limit` dependency for reconciliation concurrency control
- `getDeadLetterEntries()` and `getDeadLetterSize()` methods in OutboxManager

### Changed

- `reconcile()` now returns `Promise<number>` (count of successfully processed entries)

## [1.0.0-rc.3] - 2026-02-15

### Added

- Full test suite expansion (52 → 652 tests)
- Batch operations (`batchGet`, `batchDelete`)
- Enhanced health checks with component status
- Correlation ID propagation via AsyncLocalStorage
- Load testing with k6 (docs/LOAD_TESTING.md)
- Mutation testing with Stryker (54% score)

### Changed

- Coverage improved to 96.3% lines, 80.42% branches

## [1.0.0-rc.2] - 2025-01-25

### 🔧 Fixes

#### Packaging Improvements

- **Fixed Husky execution on install**: Script `prepare` now checks for `.git` directory before running Husky, preventing execution when the package is installed from npm
- **Updated Husky hooks**: Removed deprecated `#!/usr/bin/env sh` and `. "$(dirname -- "$0")/_/husky.sh"` lines from pre-commit and commit-msg hooks
- **Updated prepare script**: Fixed to work with Husky v9 by using `npx husky` instead of deprecated `.install()` method
- **Removed auto-dependency**: Cleaned up self-reference in dependencies that could cause installation loops
- **Removed duplicate dependencies**: Eliminated duplicate `@hapi/boom` entry in devDependencies

#### Code Quality

- **Better error messages**: Improved error handling in prepare script
- **Cleaner dependencies**: Removed unnecessary packages (`install`, `npm`) from dependencies

### 📦 Installation

```bash
npm install @luoarch/baileys-store-core@1.0.0-rc.2
# or
yarn add @luoarch/baileys-store-core@1.0.0-rc.2
```

**Breaking Changes:** None

**Migration from 1.0.0-rc.1:** Automatic - no code changes required

## [1.0.0-rc.1] - 2025-01-25

### 🎉 First Release Candidate

This is the first release candidate for v1.0.0. We're seeking community feedback before the stable release.

#### Features

- ✅ Hybrid storage architecture (Redis + MongoDB)
- ✅ Circuit breaker resilience with Opossum
- ✅ Transactional outbox pattern for dual-write consistency
- ✅ Thread-safe Prometheus metrics
- ✅ Deep Buffer Revival algorithm for Baileys v7.0+ compatibility
- ✅ Mutex-based concurrency control
- ✅ Comprehensive test suite (49 tests: unit + integration + E2E)
- ✅ **Enhanced CryptoService security** with configurable logging and validation

#### Security Improvements

- ✅ **Configurable logging** - Debug logs only in development with explicit flags
- ✅ **Data sanitization** - Removed sensitive data (keyId, nonce hex, key previews) from logs
- ✅ **Input validation** - Added ciphertext size validation (minimum 16 bytes for auth tag)
- ✅ **Buffer normalization** - Unified handling of Buffer, Uint8Array, JSON, and Base64 formats
- ✅ **Production safety** - Prevents temporary keys in production environment
- ✅ **Constants-based** - Eliminated magic numbers with documented cryptographic constants

#### Known Limitations

- MongoDB versions < 5.0 not tested
- Redis Cluster support experimental
- Performance benchmarks on single-node only

#### Feedback Requested

- Production deployment testing
- Multi-region MongoDB/Redis setups
- Edge case scenarios with Baileys v7.0+
- Performance metrics in your environment

**Breaking Changes:** None (first release)

**Migration Guide:** N/A (first release)

### How to Test

```
npm install @luoarch/baileys-store-core@next
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for reporting issues.

---

## [1.0.0] - 2025-01-25

### Added

- **Hybrid Storage**: Redis (hot cache) + MongoDB (cold storage) with automatic synchronization
- **Circuit Breaker**: Automatic MongoDB degradation on high error rates
- **Transactional Outbox**: Ensures dual-write consistency with reconciliation
- **Prometheus Metrics**: 13 thread-safe metrics for observability
- **Type-Safe Buffer Handling**: Fixes Baileys RC.6 serialization bugs
- **Redis Support**: Standalone Redis authentication state store
- **MongoDB Support**: Standalone MongoDB authentication state store
- **Encryption & Compression**: AES-256-GCM/Secretbox + Snappy/Gzip
- **Production Resilience**: Timeouts, retries, exponential backoff
- **Tree-Shakeable**: Granular exports for optimal bundle size

### Security

- Provenance attestation for supply chain verification
- Strict TypeScript mode with zero `any` in production code
- CodeQL security scanning
- npm audit in CI/CD pipeline

[1.0.0]: https://github.com/luoarch/baileys-store-core/releases/tag/v1.0.0
