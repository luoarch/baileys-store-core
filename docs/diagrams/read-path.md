# Read Path - Cache Hit vs Miss

Diagrama de sequência detalhado do fluxo de leitura no Hybrid Storage.

## Sequence Diagram - Cache Hit (Fast Path)

```mermaid
sequenceDiagram
    participant Client
    participant HybridStore
    participant Redis
    participant MongoDB
    participant Metrics

    Client->>HybridStore: get(sessionId)
    HybridStore->>Redis: GET baileys:session:{id}

    alt Cache Hit
        Redis-->>HybridStore: Versioned<AuthSnapshot>
        HybridStore->>Metrics: Record cache hit
        HybridStore-->>Client: Return data (p99 < 20ms)
    end
```

## Sequence Diagram - Cache Miss (Cold Path)

```mermaid
sequenceDiagram
    participant Client
    participant HybridStore
    participant Redis
    participant MongoDB
    participant Metrics

    Client->>HybridStore: get(sessionId)
    HybridStore->>Redis: GET baileys:session:{id}

    alt Cache Miss
        Redis-->>HybridStore: null
        HybridStore->>Metrics: Record cache miss
        HybridStore->>MongoDB: findOne({ sessionId })

        alt Document Found
            MongoDB-->>HybridStore: Document
            HybridStore->>Redis: SET (cache warm)
            HybridStore-->>Client: Return data (p99 < 100ms)
        else Document Not Found
            MongoDB-->>HybridStore: null
            HybridStore-->>Client: null (not found)
        end
    end
```

## Combined Flow Diagram

```mermaid
flowchart TD
    Start[Client Request] --> Hybrid[HybridStore.get]
    Hybrid --> CheckRedis{Check Redis}

    CheckRedis -->|Hit| ReturnHit[Return from Cache<br/>~5ms p50]
    CheckRedis -->|Miss| QueryMongo[Query MongoDB]

    QueryMongo --> Found{Document<br/>Exists?}
    Found -->|Yes| WarmCache[Cache Warming]
    WarmCache --> ReturnMiss[Return from MongoDB<br/>~50ms p50]
    Found -->|No| ReturnNull[Return null]

    ReturnHit --> MetricsHit[Record: cache hit]
    ReturnMiss --> MetricsMiss[Record: cache miss]
    ReturnNull --> MetricsMiss

    MetricsHit --> End[End]
    MetricsMiss --> End

    style ReturnHit fill:#90EE90
    style ReturnMiss fill:#FFB347
    style ReturnNull fill:#FFCCCB
```

## Performance Characteristics

### Cache Hit (80%+ of requests)

- **p50**: < 5ms
- **p95**: < 10ms
- **p99**: < 20ms
- **Operation**: Redis GET only

### Cache Miss (~20% of requests)

- **p50**: ~50ms
- **p95**: ~80ms
- **p99**: < 100ms
- **Operations**: Redis GET + MongoDB findOne + cache warm

### Cache Warming Strategy

```typescript
// Automatic cache warming on miss
const data = await mongoStore.get(sessionId);
if (data) {
  await redisStore.set(sessionId, data, defaultTtl);
}
```

## Impact of Cache Hit Rate

| Cache Hit Rate | Avg Latency | p99 Latency | Throughput |
| -------------- | ----------- | ----------- | ---------- |
| 50%            | 35ms        | 70ms        | 500 ops/s  |
| 70%            | 25ms        | 50ms        | 700 ops/s  |
| 80%            | 18ms        | 40ms        | 1000 ops/s |
| 90%            | 12ms        | 25ms        | 1200 ops/s |
| 95%            | 8ms         | 20ms        | 1500 ops/s |

**Target**: 80%+ cache hit rate for optimal performance.

## Circuit Breaker Integration

When MongoDB circuit breaker is OPEN:

- Cache hit path: ✅ Works normally
- Cache miss path: ⚠️ Returns cached data from Redis (potentially stale)

This allows graceful degradation with Redis-only mode.

---

**Próximos Diagramas:**

- [Write Path](./write-path.md)
- [Circuit Breaker States](./circuit-breaker.md)
- [Data Consistency Model](./data-consistency.md)
