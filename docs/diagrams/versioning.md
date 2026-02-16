# Versioning Strategy

Estratégia de versionamento para compatibilidade e migration de dados.

## Version Schema

```mermaid
graph LR
    subgraph "Version Components"
        Major[Major<br/>Breaking Changes<br/>1.0.0]
        Minor[Minor<br/>New Features<br/>1.1.0]
        Patch[Patch<br/>Bug Fixes<br/>1.1.1]
    end
```

## Data Schema Versioning

### Schema Evolution

```mermaid
flowchart TD
    V1[Schema v1<br/>Plain JSON]
    V2[Schema v2<br/>+ Encryption]
    V3[Schema v3<br/>+ Compression]

    V1 --> Migration1[Migration Path 1→2]
    V2 --> Migration2[Migration Path 2→3]

    Migration1 --> V2
    Migration2 --> V3
```

### Document Structure

```typescript
interface VersionedDocument {
  _id: string; // MongoDB _id
  sessionId: string; // Baileys session ID
  version: number; // Optimistic locking version
  schemaVersion: number; // Data schema version (v1, v2, v3)
  data: EncryptedSnapshot; // Encrypted auth snapshot
  metadata: {
    createdAt: number;
    updatedAt: number;
    ttl: number;
  };
}
```

## Migration Strategy

### On-Read Migration

```mermaid
sequenceDiagram
    participant Client
    participant HybridStore
    participant MongoDB
    participant Migrator

    Client->>HybridStore: get(sessionId)
    HybridStore->>MongoDB: findOne({ sessionId })
    MongoDB-->>HybridStore: Document (schema v2)

    HybridStore->>Migrator: Check schema version

    alt Schema Outdated
        Migrator->>Migrator: Migrate v2 → v3
        Migrator->>MongoDB: Update with v3
        Migrator-->>HybridStore: Migrated document
    else Schema Current
        Migrator-->>HybridStore: Document (no migration)
    end

    HybridStore-->>Client: AuthSnapshot
```

### Migration Paths

```typescript
// Migration from v1 to v2 (add encryption)
async function migrateV1ToV2(v1Doc: V1Document): Promise<V2Document> {
  const encrypted = await codec.encrypt(v1Doc.data, masterKey);
  return {
    ...v1Doc,
    schemaVersion: 2,
    data: encrypted,
    metadata: {
      ...v1Doc.metadata,
      migratedAt: Date.now(),
    },
  };
}

// Migration from v2 to v3 (add compression)
async function migrateV2ToV3(v2Doc: V2Document): Promise<V3Document> {
  const compressed = await compress(v2Doc.data);
  return {
    ...v2Doc,
    schemaVersion: 3,
    data: compressed,
    metadata: {
      ...v2Doc.metadata,
      migratedAt: Date.now(),
    },
  };
}
```

## Forward and Backward Compatibility

```mermaid
graph TB
    Current[Current Schema<br/>v3]
    Future[Future Schema<br/>v4]
    Past[Past Schema<br/>v2]

    Current -->|Forward Compatible| Future
    Current -->|Backward Compatible| Past

    Future -.Extension Fields Only.-> Current
    Current -.Optional Fields.-> Past
```

## Version Locking

### Optimistic Locking

```mermaid
sequenceDiagram
    participant C1 as Client 1
    participant C2 as Client 2
    participant Store

    C1->>Store: get(A) → version=5
    C2->>Store: get(A) → version=5

    C1->>Store: set(A, data, version=5)
    Store->>Store: Check: version == 5
    Store-->>C1: Success (version=6)

    C2->>Store: set(A, data, version=5)
    Store->>Store: Check: version == 6 (stale!)
    Store-->>C2: VersionMismatchError

    C2->>Store: get(A) → version=6
    C2->>Store: set(A, data, version=6) ✅
```

## Compatibility Matrix

| Operation         | v1→v2           | v2→v3           | v3→v4           |
| ----------------- | --------------- | --------------- | --------------- |
| **Read**          | ✅ Auto-migrate | ✅ Auto-migrate | ✅ Auto-migrate |
| **Write**         | ✅ Compatible   | ✅ Compatible   | ✅ Compatible   |
| **Backward Read** | ⚠️ Manual       | ⚠️ Manual       | ✅ Compatible   |

## API Versioning

### Semver Strategy

- **MAJOR**: Breaking changes (require code updates)
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Breaking Changes

```typescript
// v1.0.0
function createHybridStore(config: HybridConfigV1): HybridStore;
interface HybridConfigV1 {
  redisUrl: string;
}

// v2.0.0 (BREAKING)
function createHybridStore(config: HybridConfigV2): HybridStoreV2;
interface HybridConfigV2 {
  storage: { redisUrl: string; mongoUrl: string };
}
```

## Rollback Strategy

```mermaid
flowchart TD
    Deploy[Deploy v2.0.0]
    Deploy --> Monitor{Health<br/>OK?}

    Monitor -->|Yes| Success[Success ✅]
    Monitor -->|No| Rollback[Rollback to v1.0.0]

    Rollback --> DataRevert[Data Schema Revert]
    DataRevert --> OldAPI[Revert to Old API]
    OldAPI --> Success
```

---

**Related Documentation:**

- [Architecture](./architecture.md)
- [Error Codes](../ERROR_CODES.md)
