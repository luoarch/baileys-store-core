# Load Testing Guide - @baileys-store/core

## Visão Geral

Este documento descreve como executar testes de carga para validar a escalabilidade e performance do `@baileys-store/core` usando k6.

## Requisitos

1. **k6** instalado (https://k6.io/docs/getting-started/installation/)
2. **Redis** e **MongoDB** rodando localmente ou via Docker
3. Servidor de teste rodando (ver `examples/production-setup.ts`)

## Instalação do k6

### macOS

```bash
brew install k6
```

### Linux

```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

### Windows

```powershell
choco install k6
```

### Docker

```bash
docker pull grafana/k6
```

## Configuração do Ambiente de Teste

### 1. Iniciar Serviços de Dependência

```bash
# Usando Docker Compose
cd examples/production-setup
docker-compose up -d

# Ou iniciar manualmente
redis-server
mongod
```

### 2. Iniciar Servidor de Teste

```bash
# Configurar variáveis de ambiente
export REDIS_URL="redis://localhost:6379"
export MONGO_URL="mongodb://localhost:27017"
export BAILEYS_MASTER_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

# Iniciar servidor
tsx examples/production-setup.ts
```

## Executando Testes de Carga

### Teste Básico (Ramp-up Gradual)

```bash
k6 run k6-load-test.js
```

### Teste com Configuração Customizada

```bash
# Modificar BASE_URL
BASE_URL=http://localhost:3001 k6 run k6-load-test.js

# Modificar duração dos estágios (variáveis de ambiente)
RAMP_DURATION=10s STABLE_DURATION=1m k6 run k6-load-test.js
```

### Teste Stress (Alta Carga)

```bash
# 1000 VUs em 30s, manter por 30s
k6 run --vus 1000 --duration 30s k6-load-test.js
```

## Interpretando Resultados

### Métricas Principais

| Métrica                | Descrição                            | Target       |
| ---------------------- | ------------------------------------ | ------------ |
| **http_req_duration**  | Latência total das requisições       | p95 < 200ms  |
| **http_reqs**          | Taxa de requisições por segundo      | > 1000 req/s |
| **errors**             | Taxa de erros                        | < 1%         |
| **vus**                | Virtual Users (usuários simultâneos) | 0 a 200      |
| **iteration_duration** | Tempo para completar uma iteração    | < 2s         |

### Resultado de Exemplo

```
📊 Load Test Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Requests: 45,234
Request Rate: 251.30 req/s
Error Rate: 0.00%
Max VUs: 200

⏱️  Latency:
  Avg: 45.23ms
  Min: 12.34ms
  Max: 234.56ms
  p95: 89.45ms
  p99: 145.67ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Análise

- **Latência p95 < 200ms**: ✅ Excelente performance
- **Latência p99 < 500ms**: ✅ Performance aceitável
- **Error Rate < 1%**: ✅ Sistema estável
- **Request Rate > 1000 req/s**: ✅ Alta throughput

## Cenários de Teste

### Cenário 1: Ramp-up Gradual

Testa comportamento sob carga crescente gradualmente.

**Duração**: ~8 minutos

- 0 → 50 VUs em 30s
- 50 VUs por 2min
- 50 → 100 VUs em 30s
- 100 VUs por 2min
- 100 → 200 VUs em 30s
- 200 VUs por 2min
- 200 → 0 VUs em 30s

### Cenário 2: Spike Test

Testa comportamento sob carga súbita.

**Duração**: ~1 minuto

```bash
k6 run --vus 0 --stage 0s:0,10s:200,40s:200,50s:0 k6-load-test.js
```

### Cenário 3: Stress Test

Testa limites do sistema.

**Duração**: ~5 minutos

```bash
k6 run --vus 0 --stage 0s:0,30s:500,270s:500,300s:0 k6-load-test.js
```

## Monitoramento Durante Testes

### Métricas do Sistema

```bash
# CPU e Memória
top

# Network I/O
iftop

# Disk I/O
iostat -x 1
```

### Métricas Redis

```bash
redis-cli info stats
redis-cli MONITOR
```

### Métricas MongoDB

```bash
mongosh --eval "db.serverStatus()"
mongosh --eval "db.currentOp()"
```

## Troubleshooting

### Erro: Connection Refused

**Causa**: Servidor não está rodando ou porta incorreta.

**Solução**:

```bash
# Verificar se servidor está ativo
curl http://localhost:3000/health

# Iniciar servidor
tsx examples/production-setup.ts
```

### Latência Alta (p95 > 500ms)

**Causa**: Redis ou MongoDB sob carga.

**Solução**:

1. Verificar recursos disponíveis
2. Aumentar timeouts no config
3. Verificar conexões ativas do Redis/MongoDB
4. Considerar sharding ou clustering

### Taxa de Erro Alta (> 5%)

**Causa**: Sistema sob stress excessivo ou configuração incorreta.

**Solução**:

1. Verificar logs do servidor
2. Reduzir carga inicial (menos VUs)
3. Aumentar timeouts
4. Verificar circuit breaker status

### Memory Leaks

**Causa**: Conexões não fechadas ou cache crescendo indefinidamente.

**Solução**:

1. Monitorar uso de memória ao longo do tempo
2. Verificar TTLs configurados
3. Verificar cleanup de sessões expiradas
4. Usar `--max-old-space-size` para Node.js

## Integração com CI/CD

### GitHub Actions

```yaml
- name: Install k6
  run: |
    sudo gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
    sudo apt-key add -
    echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
    sudo apt-get update
    sudo apt-get install k6

- name: Run Load Tests
  run: k6 run k6-load-test.js
  env:
    BASE_URL: http://localhost:3000
```

## Próximos Passos

- [ ] Adicionar testes de carga para batch operations
- [ ] Testar comportamento com circuit breaker aberto
- [ ] Testar recovery após falhas
- [ ] Integrar com Grafana para visualização de métricas
- [ ] Adicionar testes de carga no CI/CD
