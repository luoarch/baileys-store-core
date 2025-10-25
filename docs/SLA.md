# Service Level Objectives (SLOs)

Este documento define os Service Level Objectives (SLOs) e Service Level Indicators (SLIs) para o `@luoarch/baileys-store-core`.

## Visão Geral

**SLA Geral:** 99.95% availability (4.38 horas de downtime por ano)

**Escopo:**
- Operações de leitura (GET)
- Operações de escrita (SET, DELETE)
- Operações de sincronização (credential updates)

**Excluído do SLA:**
- Operações de backup/restore
- Manutenção agendada (janela: 2-6 AM UTC)
- Falhas de infraestrutura do cliente (Redis/MongoDB downtime)

---

## SLI: Disponibilidade (Availability)

**Fórmula:**
```
Availability = (Total Requests - Failed Requests) / Total Requests
Failed Requests = requests com HTTP 5xx ou timeout > 5s
```

**SLO:** 99.95% availability (error budget: 0.05%)

**Período de Medição:** Rolling window de 30 dias

**Métricas Prometheus:**
```promql
# Availability rate
sum(rate(http_requests_total{status=~"2.."}[5m])) 
/ sum(rate(http_requests_total[5m]))
```

**Error Budget Período:**
- Por mês: 21.6 minutos de erro aceitável
- Por dia: 43.2 segundos de erro aceitável

**Alerting:**
- **Critical**: Availability < 99.5% (metade do error budget consumido)
- **Warning**: Availability < 99.9%

---

## SLI: Latência (Latency)

### Read Operations (Cache Hit)

**SLO:** p99 latency < 20ms

**Métricas:**
- p50 (median): < 5ms
- p95: < 10ms
- p99: < 20ms

**Prometheus Query:**
```promql
histogram_quantile(0.99, rate(store_operation_duration_seconds_bucket{operation="get",cache_hit="true"}[5m]))
```

**Observações:**
- Cache hit rate target: > 80%
- Inclui: Redis lookup, deserialization, decryption
- Exclui: Network latency (cliente → servidor)

### Read Operations (Cache Miss)

**SLO:** p99 latency < 100ms

**Métricas:**
- p50 (median): < 50ms
- p95: < 80ms
- p99: < 100ms

**Observações:**
- Cache miss penalty: ~80ms adicional (MongoDB lookup)
- Inclui: Redis miss + MongoDB query + cache warm

### Write Operations

**SLO:** p99 latency < 50ms

**Métricas:**
- p50 (median): < 20ms
- p95: < 40ms
- p99: < 50ms

**Observações:**
- Modo sync: Redis + MongoDB (maior latência)
- Modo async (write-behind): Apenas Redis (~10ms)
- Exclui: Outbox processing time (background)

**Alerting:**
- **Critical**: p99 > 200ms por 5 minutos consecutivos
- **Warning**: p99 > 100ms por 2 minutos

---

## SLI: Durabilidade (Durability)

**SLO:** 99.99% data durability (1 perda aceitável em 10,000 writes)

**Definição:**
- Dados escritos com sucesso não são perdidos
- Inclui: Redis crash, MongoDB crash, pod restart
- RPO (Recovery Point Objective): < 1 segundo (async mode)

**Métricas:**
```promql
# Data loss count
store_write_durability_total{status="lost"} / store_write_total
```

**Proteções:**
- ✅ MongoDB WAL (Write-Ahead Logging)
- ✅ Redis AOF (Append-Only File)
- ✅ Replication (MongoDB replica set, Redis Sentinel)
- ✅ Outbox reconciliation (< 1s)

**Alerting:**
- **Critical**: Qualquer detecção de data loss
- **Warning**: Durability < 99.9%

---

## SLI: Consistência (Consistency)

### Strong Consistency (Sync Mode)

**SLO:** 100% consistency garantida

**Definição:**
- Todas reads refletem writes imediatamente
- Sem staleness possível
- Trade-off: Maior latência (p99 ~50ms)

### Eventual Consistency (Async Mode)

**SLO:** RPO < 1 segundo

**Definição:**
- Redis e MongoDB podem divergir por até 1 segundo
- Reconciliated via outbox pattern
- Outbox lag p95: < 5 segundos

**Métricas:**
```promql
# Outbox lag
histogram_quantile(0.95, rate(outbox_processing_duration_seconds_bucket[5m]))
```

---

## SLI: Throughput

**SLO:** Suportar 1000 operations/segundo por pod

**Métricas:**
- Target: 1000 ops/sec (balanced read/write)
- Peak capacity: 2000 ops/sec (read-heavy)
- Burst capacity: 5000 ops/sec por 30 segundos

**Cálculo de Capacidade:**
```
Required Pods = Peak OPS / 1000
```

**Autoscaling Triggers:**
- CPU > 70% por 5 minutos → Scale up
- OPS > 800/sec por 2 minutos → Scale up
- OPS < 200/sec por 15 minutos → Scale down

---

## SLI: Error Rate

**SLO:** Error rate < 0.1% (1 erro por 1000 requests)

**Error Rate por Categoria:**

| Categoria | SLA | Classificação |
|-----------|-----|--------------|
| Timeout | < 0.05% | CRITICAL |
| Circuit Breaker Open | < 0.02% | CRITICAL |
| Validation Error | < 0.03% | WARNING |
| Internal Error | < 0.001% | CRITICAL |

**Fórmula:**
```promql
# Error rate
sum(rate(store_operation_total{status="error"}[5m])) 
/ sum(rate(store_operation_total[5m]))
```

**Alerting:**
- **Critical**: Error rate > 1% por 2 minutos
- **Warning**: Error rate > 0.5% por 5 minutos

---

## SLI: Circuit Breaker Health

**SLO:** Circuit breaker open time < 30s

**Configuração:**
- Error threshold: 50% failures
- Timeout: 30s (volta para half-open)
- Max consecutive failures: 5

**Métricas:**
```promql
# Circuit breaker state duration
store_circuit_breaker_state_duration_seconds{state="open"}
```

**Alerting:**
- **Critical**: Circuit breaker aberto > 60s
- **Warning**: Circuit breaker aberto > 30s

**Degraded Mode:**
- Operação continua apenas com Redis
- Durability reduzida (sem MongoDB)
- Latência mantida (< 20ms)

---

## SLI: Recovery Time (RTO)

**Recovery Time Objective (RTO):** < 30 segundos

**Cenários:**

| Cenário | RTO Target | Real |
|---------|-----------|------|
| Redis restart | 5s | ~3s |
| MongoDB restart | 30s | ~15-20s |
| Pod crash (K8s) | 15s | ~10-12s |
| Circuit breaker recovery | 30s | ~25s |
| Failover (HA) | 10s | ~5-8s |

**Definição:**
- Tempo desde falha até operação normal
- Inclui: Detection time + recovery time
- Exclui: Manutenção agendada

---

## SLI: Cache Performance

**Cache Hit Rate SLO:** > 80%

**Métricas:**
```promql
# Cache hit rate
sum(rate(store_cache_operations_total{result="hit"}[5m])) 
/ sum(rate(store_cache_operations_total[5m]))
```

**Fatores que Afetam Hit Rate:**
- TTL configuração (TTL curto → menor hit rate)
- Memory pressure (eviction prematura)
- Access patterns (temporal locality)

**Alerting:**
- **Warning**: Hit rate < 75%
- **Critical**: Hit rate < 60%

---

## SLI: Observability Coverage

**Logging Coverage:** 100% de operações críticas

**Log Levels:**
- ERROR: Todas falhas (stack trace incluído)
- WARN: Degradation, circuit breaker events
- INFO: Operações importantes (creds update, etc)
- DEBUG: Operações normais (cache hit/miss)

**Metrics Coverage:**
- ✅ 13 métricas Prometheus
- ✅ Histogramas para latência (p50, p95, p99)
- ✅ Counters para operações e erros
- ✅ Gauges para circuit breaker state

**Tracing Coverage:**
- Opcional (não incluído no SLA)
- Suporte a OpenTelemetry (futuro)

---

## Medição e Reporte

### Dashboard Principal

**Grafana Dashboard:** `baileys-store-core-main`

**Painéis Críticos:**
1. Availability (last 30d)
2. Latency (p99, 1h window)
3. Error rate (last 24h)
4. Circuit breaker status
5. Cache hit rate
6. Throughput (ops/sec)

### Alerting

**PagerDuty / Slack:**
- Critical: Email + SMS + PagerDuty
- Warning: Slack + Email

**Runbooks:**
- Cada alerta possui runbook em `docs/runbooks/`

### Reportes

**SLO Report:** Mensal
- Disponibilidade vs target
- Error budget consumido
- Trend analysis

---

## Conformidade com SLA

### Penalidades (se aplicável)

**Nível de Service Tier:**

| Availability | Impacto |
|--------------|---------|
| > 99.95% | ✅ SLA atendido |
| 99.90% - 99.95% | ⚠️ Warning (credits 10%) |
| 99.50% - 99.90% | ⚠️ Service credit 25% |
| < 99.50% | ❌ Service credit 50% |

### Exclusões

**Ocorrências que não contam contra SLA:**
- Manutenção agendada (pré-anunciada > 7 dias)
- Force majeure (datacenter offline)
- Ações do cliente (config incorreto, falta de quota)
- DDoS ou ataque cibernético

---

## Melhoria Contínua

**Review Mensal:**
- Análise de incidentes
- Ajuste de SLOs baseado em realidade
- Identificação de gargalos

**Targets Futuros (Q1 2026):**
- p99 latency < 10ms (cache hit)
- Availability > 99.99%
- RPO < 500ms

---

**Última Atualização:** Outubro 2025  
**Próxima Review:** Novembro 2025
