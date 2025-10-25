# Performance Benchmarks

Este documento descreve os benchmarks de performance do `@baileys-store/core` e os targets de latência/throughput para operações críticas.

## Target de Performance

### Operações Individuais

| Operação | Condição | Target p99 | Status |
|---|---|---|---|
| `get()` | Cache hit | < 20ms | ⏳ Pendente |
| `get()` | Cache miss | < 100ms | ⏳ Pendente |
| `set()` | Sync mode | < 30ms | ⏳ Pendente |
| `set()` | Async mode (queue) | < 5ms | ⏳ Pendente |
| `delete()` | - | < 25ms | ⏳ Pendente |

### Operações em Lote

| Operação | Batch Size | Target p99 | Status |
|---|---|---|---|
| `batchGet()` | 100 sessions | < 200ms | ⏳ Pendente |
| `batchGet()` | 500 sessions | < 1000ms | ⏳ Pendente |
| `batchGet()` | 1000 sessions | < 2000ms | ⏳ Pendente |
| `batchDelete()` | 100 sessions | < 500ms | ⏳ Pendente |

### Circuit Breaker

| Métrica | Target | Status |
|---|---|---|
| Circuit breaker open → half-open | < 30s | ✅ Implementado |
| Circuit breaker half-open → closed | < 5s | ✅ Implementado |
| Degraded mode latency impact | < 10% | ⏳ Pendente |

## Setup de Benchmarking

### Requisitos

- Redis 6.0+
- MongoDB 4.4+
- Node.js 20+

### Executar Benchmarks

```bash
# Executar todos os benchmarks
yarn test:benchmark

# Executar benchmark específico
yarn test src/__tests__/performance/benchmark.test.ts
```

## Resultados Esperados

### Cache Hit Performance

**Target**: p99 < 20ms

Operações com cache hit devem ser extremamente rápidas, utilizando apenas Redis in-memory.

### Cache Miss Performance

**Target**: p99 < 100ms

Cache miss envolve:
1. Redis miss
2. MongoDB query
3. Cache warming (async)

### Batch Get Performance

**Target**: Linear scaling com número de sessões

Com 1000 sessões:
- 80% cache hit: p99 < 500ms
- 50% cache hit: p99 < 1500ms
- 0% cache hit: p99 < 2000ms

### Batch Delete Performance

**Target**: p99 < 500ms para 100 sessions

Batch delete é otimizado com paralelismo e ignora erros individuais.

## Observações

- Benchmarks devem ser executados em ambiente isolado
- Resultados podem variar com carga do sistema
- Targets são para operações não-concorrentes
- Em produção com múltiplas requisições simultâneas, latência pode aumentar

## Próximos Passos

- [ ] Implementar benchmarks reais
- [ ] Adicionar CI job para executar benchmarks
- [ ] Documentar resultados históricos
- [ ] Adicionar alertas para degradação de performance
