# Architecture Decision Records (ADRs)

Este documento registra decisões arquiteturais importantes tomadas durante o desenvolvimento do `@luoarch/baileys-store-core`.

## ADR-001: Hybrid Storage Pattern (Redis + MongoDB)

**Status:** ✅ Accepted  
**Data:** Outubro 2025  
**Contexto:** Baileys sessions precisam de baixa latência para operações frequentes (< 10ms) e persistência durável para recovery de desastres. O WhatsApp Multi-Device requer acesso ultra-rápido a keys de criptografia para operações de S/M.

**Decisão:**  
Implementar hybrid storage combinando Redis (hot cache in-memory) com MongoDB (cold storage persistente).

- **Redis**: Armazena dados críticos em memória para acesso sub-milissegundo
- **MongoDB**: Persiste todos os dados com garantias ACID e TTL automático
- **Estratégia**: Write-through para operações críticas (creds, keys) e write-behind para appState

**Consequências Positivas:**
- ✅ Latência p99 < 20ms em cache hits (vs ~100ms MongoDB direto)
- ✅ Durabilidade garantida (MongoDB replica set)
- ✅ Escalabilidade horizontal (Redis Cluster + MongoDB Sharding)
- ✅ Circuit breaker permite degradação graceful (Redis-only mode)

**Trade-offs:**
- ⚠️ Complexidade adicional: 2 sistemas para gerenciar
- ⚠️ Consistência eventual em modo async (RPO < 1s aceitável)
- ⚠️ Custos operacionais maiores (Redis + MongoDB)

**Alternativas Consideradas:**

| Alternativa | Por que não foi escolhida |
|------------|---------------------------|
| **Redis-only** | Sem persistência durável, risco de perda total de dados |
| **MongoDB-only** | Latência muito alta (p99 ~100ms) inaceitável para operações críticas |
| **PostgreSQL** | Overhead para operações key-value, performance inferior ao MongoDB |
| **Cassandra** | Complexidade excessiva para este caso de uso |

**Métricas de Sucesso:**
- Cache hit rate > 80%
- p99 latency < 20ms (cache hit)
- Durabilidade 99.99% (MongoDB)

---

## ADR-002: Transactional Outbox Pattern

**Status:** ✅ Accepted  
**Data:** Outubro 2025  
**Contexto:** No modo write-behind (async), precisamos garantir que dados escritos no Redis sejam eventualmente persistidos no MongoDB mesmo após falhas.

**Decisão:**  
Implementar Transactional Outbox Pattern com reconciliation worker.

**Arquitetura:**
1. Operação write adiciona evento ao Redis SET (outbox)
2. Redis write é confirmado imediatamente (low latency)
3. Background worker processa outbox e persiste no MongoDB
4. Evento removido da outbox após persistência confirmada
5. Reconciliation job verifica outbox a cada 60s para eventos órfãos

**Consequências Positivas:**
- ✅ Garantia de eventual consistency (no-publish, no-duplicate)
- ✅ Recovery automático de falhas (reconciliation)
- ✅ Baixa latência mantida (Redis immediate)
- ✅ Compatível com múltiplos workers (idempotência)

**Trade-offs:**
- ⚠️ Complexidade adicional: Worker, reconciliation, dedup
- ⚠️ Janela de inconsistência (p99 < 1s) em caso de falha
- ⚠️ Espaço adicional: Outbox storage (~1KB por evento)

**Alternativas Consideradas:**

| Alternativa | Por que não foi escolhida |
|------------|---------------------------|
| **Two-Phase Commit (2PC)** | Bloqueante, latência alta, não adequado para alta carga |
| **Saga Pattern** | Complexidade excessiva para este caso de uso |
| **Event Sourcing** | Over-engineering, não necessário para este domínio |
| **Publish-Subscribe** | Dependência externa (Kafka, etc) adiciona custos |

**Métricas de Sucesso:**
- Outbox processamento p99 < 1s
- Outbox lag < 5s (p95)
- Zero data loss em testes de stress

---

## ADR-003: AES-256-GCM vs XSalsa20-Poly1305 (secretbox)

**Status:** ✅ Accepted  
**Data:** Outubro 2025  
**Contexto:** Necessidade de criptografar dados sensíveis (keys, creds) antes de persistir. Duas opções principais: AES-256-GCM (padrão NIST) e XSalsa20-Poly1305 (TweetNaCl).

**Decisão:**  
Suportar ambos os algoritmos, defaultando para **secretbox** (XSalsa20-Poly1305).

**Justificativa:**
- **Baileys v7 usa TweetNaCl nativamente** (compatibilidade total)
- **Zero dependencies extras** (TweetNaCl já incluído)
- **Velocidade superior** (~2x mais rápido que AES-GCM em benchmarks Node.js)
- **Navegadores**: TweetNaCl funciona em browser (paths futuros)

**Consequências Positivas:**
- ✅ Compatibilidade 100% com Baileys keys
- ✅ Performance superior (menor CPU overhead)
- ✅ Flexibilidade: AES-256-GCM disponível para compliance requirements

**Trade-offs:**
- ⚠️ AES-256-GCM não é default (segurança "ferroviária")
- ⚠️ Complexidade adicional: Suporte a 2 algoritmos
- ⚠️ Testes mais complexos (2 codecs)

**Alternativas Consideradas:**

| Alternativa | Por que não foi escolhida |
|------------|---------------------------|
| **AES-256-GCM only** | Incompatível com Baileys internal keys, overhead desnecessário |
| **ChaCha20-Poly1305** | Similar ao XSalsa20, mas TweetNaCl já otimizado |
| **Sem criptografia** | Inseguro para dados em produção (keys, creds) |

**Configuração:**
```typescript
security: {
  enableEncryption: true,
  encryptionAlgorithm: 'secretbox' | 'aes-256-gcm',
  masterKey: '<64-hex-chars>',
  keyRotationDays: 90,
}
```

**Métricas de Sucesso:**
- Encryption overhead < 5ms (p99)
- Key rotation transparente (< 10ms)
- Zero regressões de compatibilidade com Baileys

---

## ADR-004: Circuit Breaker Configuration

**Status:** ✅ Accepted  
**Data:** Outubro 2025  
**Contexto:** MongoDB pode ficar indisponível por múltiplas razões (manutenção agendada, rede instável, OOM, etc). Precisamos degradar gracefully sem impactar operações críticas.

**Decisão:**  
Implementar Circuit Breaker usando Opossum com configuração agressiva.

**Configuração:**
- **Error threshold**: 50% (após 5 de 10 requests falharem)
- **Timeout**: 30 segundos (volta para half-open)
- **Reset timeout**: 30 segundos antes de tentar novamente
- **Monitoring**: Métricas Prometheus (open/closed/half-open transitions)

**Estados:**
1. **Closed**: Normal operation, requests passam para MongoDB
2. **Open**: MongoDB considerado down, todas requests bloqueadas (Redis-only mode)
3. **Half-Open**: Probing phase (1 request testado)

**Consequências Positivas:**
- ✅ Degradation gracefully (Redis-only mode mantém operação)
- ✅ Recuperação automática após MongoDB voltar
- ✅ Proteção contra cascading failures
- ✅ Observabilidade completa (Prometheus metrics)

**Trade-offs:**
- ⚠️ Janela de possível inconsistência (MongoDB down)
- ⚠️ Pode abrir prematuramente com falso positivo (50% threshold)
- ⚠️ Write operations bloqueadas quando open (trade-off por segurança)

**Alternativas Consideradas:**

| Alternativa | Por que não foi escolhida |
|------------|---------------------------|
| **Retry infinito** | Cascading failure, latency spikes |
| **Fail-fast sem retry** | Pior UX, perda de durabilidade |
| **Exponential backoff** | Não resolve problema de MongoDB down |
| **Health checks periódicos** | Overhead adicional, latência de detecção |

**Métricas de Sucesso:**
- Circuit breaker false positives < 5%
- Recovery time < 30s após MongoDB back online
- Availability 99.95% mesmo com MongoDB intermittent failures

**Código de Exemplo:**
```typescript
this.mongoCircuitBreaker = new CircuitBreaker(mongoOperation, {
  errorThresholdPercentage: 50,
  timeout: 30000,
  resetTimeout: 30000,
  enabled: true,
});
```

---

## ADR-005: Capacity Planning Strategy

**Status:** ✅ Accepted  
**Data:** Outubro 2025  
**Contexto:** Escalar de 1 sessão (desenvolvimento) para 10k+ sessões (produção) requer planejamento de infraestrutura.

**Decisão:**  
Estabelecer path incremental de scaling com checkpoints claros.

**Fases de Scaling:**

### Fase 1: Single Instance (0-100 sessions)
- **Config**: Single Redis + Single MongoDB
- **Node.js**: 1 pod (512Mi memory, 500m CPU)
- **Redis**: 1 instance (128MB memory)
- **MongoDB**: 1 replica (1GB memory)
- **Custo estimado**: $20-40/mês (cloud managed)

### Fase 2: High Availability (100-1000 sessions)
- **Config**: Redis Sentinel (3 nodes) + MongoDB Replica Set (3 nodes)
- **Node.js**: 2-3 pods (HPA baseado em CPU 70%)
- **Redis**: 3 instances (256MB cada)
- **MongoDB**: 3 replicas (2GB cada, primary + 2 secondaries)
- **Custo estimado**: $150-250/mês

### Fase 3: Horizontal Scaling (1000-5000 sessions)
- **Config**: Redis Cluster (6+ nodes) + MongoDB Sharded Cluster
- **Node.js**: 5-10 pods (auto-scaling, max 20 pods)
- **Redis**: 6+ nodes (512MB-1GB cada, sharded)
- **MongoDB**: 2-3 shards, replica set por shard (4GB each)
- **Custo estimado**: $500-800/mês

### Fase 4: Enterprise Scale (5000+ sessions)
- **Config**: Redis Cluster (12+ nodes) + MongoDB Multi-shard + Geo-distributed
- **Node.js**: 10-20 pods
- **Redis**: 12+ nodes (multi-region)
- **MongoDB**: 3+ shards, replicated across regions
- **Custo estimado**: $1500-3000/mês

**Consequências Positivas:**
- ✅ Path claro e incremental (upgrade gradual)
- ✅ Custos scale com revenue (pode começar barato)
- ✅ Sem necessidade de re-architect antes de 10k sessions
- ✅ Checkpoints definidos facilitam decision-making

**Trade-offs:**
- ⚠️ Necessário reconfigurar em checkpoints (downtime planejado)
- ⚠️ Complexidade aumenta progressivamente (mais moving parts)
- ⚠️ Custos não lineares (fase 3 é ~5x da fase 1)

**Alternativas Consideradas:**

| Alternativa | Por que não foi escolhida |
|------------|---------------------------|
| **Sharding desde fase 1** | Over-engineering, custo desnecessário |
| **Vertical scaling only** | Limites físicos, não escalável além de 8 cores/64GB |
| **Kubernetes native (StatefulSets)** | Complexidade excessiva para início |

**Monitoring & Alerting:**
- **Memória Redis**: Alerta se > 80% utilizada
- **Disk MongoDB**: Alerta se > 75% utilizado
- **Latência p99**: Alerta se > 100ms
- **Cache hit rate**: Alerta se < 75%

**Automatic Scaling Triggers:**
- **Pods**: CPU > 70% por 5min → scale up
- **Pods**: CPU < 30% por 15min → scale down
- **Redis**: Memory > 80% → Adicionar node (manual)
- **MongoDB**: Disk > 80% → Increase storage (manual)

---

## Como Adicionar Novos ADRs

Ao adicionar um novo ADR:

1. Copiar template abaixo
2. Preencher com decisão e contexto
3. Adicionar à lista acima (ordenado por data)
4. Atualizar este documento

**Template:**
```markdown
## ADR-XXX: [Título Curto]

**Status:** 🚧 Proposed | ✅ Accepted | ❌ Rejected  
**Data:** [Data]  
**Contexto:** [Por que está tomando esta decisão?]

**Decisão:**  
[O que decidiu?]

**Consequências Positivas:**
- ✅ [Benefício 1]
- ✅ [Benefício 2]

**Trade-offs:**
- ⚠️ [Desvantagem/custo]

**Alternativas Consideradas:**
| Alternativa | Por que não foi escolhida |
|------------|---------------------------|
| [Alt 1] | [Motivo] |
| [Alt 2] | [Motivo] |
```

---

**Referências:**
- [ADR Template by Thoughtworks](https://www.thoughtworks.com/radar/techniques/lightweight-architecture-decision-records)
- [Documenting Architecture Decisions - Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
