# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0-rc.1] - 2025-10-23

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

## [1.0.0] - 2025-10-24

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
