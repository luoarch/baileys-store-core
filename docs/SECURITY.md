# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Security Features

### Cryptographic Security

- **AES-256-GCM encryption** with authenticated encryption
- **Configurable logging** - Debug logs only in development with explicit flags
- **Data sanitization** - Removed sensitive data (keyId, nonce hex, key previews) from logs
- **Input validation** - Ciphertext size validation (minimum 16 bytes for auth tag)
- **Buffer normalization** - Unified handling of Buffer, Uint8Array, JSON, and Base64 formats
- **Production safety** - Prevents temporary keys in production environment
- **Constants-based cryptography** - Documented values for all cryptographic parameters

### Security Best Practices

- No hardcoded keys or secrets
- Environment-based configuration
- Secure key rotation support
- Type-safe cryptographic operations
- Comprehensive input validation

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: **luoarch@protonmail.com**

You should receive a response within 48 hours. If for some reason you do not,
please follow up via email to ensure we received your original message.

Please include the following information:

- Type of issue (e.g. buffer overflow, SQL injection, XSS, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

## Response Process

We are committed to the following response targets:

- **Initial response:** Within 48 hours
- **Confirmation of the issue:** Within 5 business days
- **Resolution timeframe:** Varies depending on complexity

## Disclosure Policy

We follow a coordinated disclosure process:

1. Security report received and acknowledged
2. Issue validated and severity assessed
3. Fix developed for all supported versions
4. Reporter notified before public disclosure
5. Security advisory published on GitHub
6. Fix released and announced publicly

## Security Advisories

Published security advisories can be found at:
https://github.com/luoarch/baileys-store-core/security/advisories

## Preferred Languages

We prefer all communications to be in English or Portuguese (Brazil).

Thank you for helping keep @baileys-store/core and its users safe! 🔒
