# Data Consistency Model

Modelo de consistência de dados com strong consistency opcional e eventual consistency padrão.

## Consistency Levels

```mermaid
graph TB
    subgraph "Consistency Spectrum"
        Strong[Strong Consistency<br/>Sync Mode]
        Eventual[Eventual Consistency<br/>Async Mode]
    end

    Strong --> StrongDesc[All replicas<br/>immediately consistent<br/>~50ms latency]
    Eventual --> EventualDesc[Replicas converge<br/>over time<br/>~5ms latency<br/>RPO < 1s]
```

## Consistency Model Comparison

```mermaid
flowchart LR
    Write[Client Write] --> Redis[Redis<br/>Strong Consistent]
    Redis --> Sync{Sync or<br/>Async?}
    Sync -->|Sync Mode<br/>Strong| Mongo[MongoDB<br/>Strong Consistent]
    Sync -->|Async Mode<br/>Eventual| Queue[Outbox Queue]
    Queue --> Worker[Background Worker]
    Worker --> Mongo

    Read[Client Read] --> CacheCheck{Cache Hit?}
    CacheCheck -->|Yes| Redis
    CacheCheck -->|No| Mongo
    Mongo -.Cache Warming.-> Redis
```

## Trade-offs

| Aspect          | Sync Mode (Strong) | Async Mode (Eventual) |
| --------------- | ------------------ | --------------------- |
| **Latency**     | ~50ms p99          | ~5ms p99              |
| **Consistency** | Strong (ACID)      | Eventual (RPO < 1s)   |
| **Throughput**  | 500 ops/s          | 2000+ ops/s           |
| **Durability**  | Immediate          | Delayed (< 1s)        |
| **Use Case**    | Critical writes    | High-frequency writes |

## Read Consistency

### Read-Your-Writes Guarantee

```mermaid
sequenceDiagram
    participant Client
    participant Redis
    participant MongoDB

    Client->>Redis: Write A (version 1)
    Redis-->>Client: ACK

    Client->>Redis: Read A
    Redis-->>Client: A (version 1) ✅

    Note over Client: Read-Your-Writes: Always sees own writes
```

### Monotonic Reads

- Same client will never see older data after seeing newer data
- Achieved via version-based snapshot isolation

## Write Consistency

### Sync Mode - Strong Consistency

```typescript
// Atomic two-phase write
async set(sessionId, patch, version) {
  // Phase 1: Check version
  const current = await mongo.get(sessionId);
  if (current.version !== version) {
    throw new VersionMismatchError();
  }

  // Phase 2: Write to both stores atomically
  await redis.set(sessionId, { ...current, ...patch, version: version + 1 });
  await mongo.set(sessionId, { ...current, ...patch, version: version + 1 });

  return { version: version + 1 };
}
```

### Async Mode - Eventual Consistency

```typescript
// Write-behind with outbox
async set(sessionId, patch, version) {
  // Phase 1: Immediate write to Redis
  await redis.set(sessionId, { ...current, ...patch, version: version + 1 });

  // Phase 2: Queue for async MongoDB persistence
  await outbox.add({
    sessionId,
    patch,
    version: version + 1,
  });

  return { version: version + 1 }; // Immediate ACK
}
```

## Conflict Resolution

### Optimistic Locking

```mermaid
sequenceDiagram
    participant C1 as Client 1
    participant C2 as Client 2
    participant Store

    C1->>Store: set(A, v=5)
    C2->>Store: set(A, v=5)

    Store->>Store: Check version 5
    Store-->>C1: Success (v=6)

    Store->>Store: Check version 5 (now 6)
    Store-->>C2: VersionMismatchError

    C2->>Store: get(A) → v=6
    C2->>Store: set(A, v=6) ✅
```

## Replication Lag Window

```mermaid
timeline
    title Eventual Consistency Window (RPO < 1s)

    T0 : Write to Redis
         : ACK to Client ✅

    T1 (< 100ms) : Background worker picks up outbox entry

    T2 (< 200ms) : Write to MongoDB

    T3 (< 500ms) : Outbox entry cleared

    T4 (< 1000ms) : Consistency window closes
                   : RPO = 1s (99th percentile)
```

## Fallback and Degradation

### MongoDB Unavailable (Circuit Breaker OPEN)

```mermaid
flowchart TD
    Write[Client Write] --> Redis[Write to Redis ✅]
    Redis --> Outbox[Add to Outbox]
    Outbox --> Queue[Queue for Retry]
    Queue -.MongoDB Recovers.-> Mongo[Write to MongoDB]

    Write2[Client Read] --> Redis2[Read from Redis]
    Redis2 --> Stale{Potentially<br/>Stale Data}

    Stale --> Accept[Accept Stale Data<br/>⚠️ Degraded Mode]
```

### Consistency Guarantees by Mode

| Mode             | Read Consistency    | Write Durability  | Recovery  |
| ---------------- | ------------------- | ----------------- | --------- |
| **Normal**       | Strong              | Immediate         | Full      |
| **MongoDB Down** | Eventual (stale OK) | Eventual (outbox) | Automatic |
| **Redis Down**   | From MongoDB        | To MongoDB        | Full      |

## Monitoring Consistency

### Key Metrics

```
# Replication lag
baileys_outbox_lag_seconds{quantile="0.99"} 0.95

# Consistency violations
baileys_version_mismatch_errors_total 42

# Read consistency
baileys_read_consistency{mode="strong"} 95%  # % reads from MongoDB
baileys_read_consistency{mode="eventual"} 5% # % reads from Redis only
```

---

**Próximos Diagramas:**

- [Versioning Strategy](./versioning.md)
