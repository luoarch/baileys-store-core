/**
 * @baileys-store/core - Load Testing with k6
 *
 * Este script testa a escalabilidade do baileys-store-core sob carga
 * Requer: k6 instalado (https://k6.io/docs/getting-started/installation/)
 *
 * Execute: k6 run k6-load-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const getLatency = new Trend('get_latency');
const setLatency = new Trend('set_latency');
const deleteLatency = new Trend('delete_latency');

// Configuração de cenários de teste
export const options = {
  stages: [
    // Ramp-up: 0 a 50 VUs em 30s
    { duration: '30s', target: 50 },
    // Stable: 50 VUs por 2 minutos
    { duration: '2m', target: 50 },
    // Ramp-up: 50 a 100 VUs em 30s
    { duration: '30s', target: 100 },
    // Stable: 100 VUs por 2 minutos
    { duration: '2m', target: 100 },
    // Ramp-up: 100 a 200 VUs em 30s (carga máxima)
    { duration: '30s', target: 200 },
    // Stable: 200 VUs por 2 minutos
    { duration: '2m', target: 200 },
    // Cool-down: 200 a 0 VUs em 30s
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // 95% das requisições devem completar em menos de 200ms
    http_req_duration: ['p(95)<200'],
    // 99% das requisições devem completar em menos de 500ms
    http_req_duration: ['p(99)<500'],
    // Taxa de erro < 1%
    errors: ['rate<0.01'],
  },
};

// URL do servidor de teste (será configurado dinamicamente)
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Função para gerar ID de sessão único
function generateSessionId() {
  return `load-test-${__VU}-${__ITER}-${Date.now()}`;
}

// Função para gerar dados de teste
function generateTestData() {
  return {
    creds: {
      me: {
        id: `${__VU}@load-test.com`,
        name: `Load Test User ${__VU}`,
      },
      registrationId: Math.floor(Math.random() * 9999),
      noisKey: {
        public: Buffer.from('test-public-key').toString('base64'),
        private: Buffer.from('test-private-key').toString('base64'),
      },
    },
    keys: {
      'pre-key-1': {
        public: Buffer.from('test-pre-key-public').toString('base64'),
        private: Buffer.from('test-pre-key-private').toString('base64'),
      },
    },
  };
}

export default function () {
  const sessionId = generateSessionId();
  const testData = generateTestData();

  // Teste 1: SET operation
  group('Set Operation', () => {
    const startTime = Date.now();
    const res = http.post(`${BASE_URL}/api/sessions/${sessionId}`, JSON.stringify(testData), {
      headers: { 'Content-Type': 'application/json' },
    });

    setLatency.add(Date.now() - startTime);

    const success = check(res, {
      'set status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    });

    errorRate.add(!success);
  });

  sleep(0.5);

  // Teste 2: GET operation
  group('Get Operation', () => {
    const startTime = Date.now();
    const res = http.get(`${BASE_URL}/api/sessions/${sessionId}`);

    getLatency.add(Date.now() - startTime);

    const success = check(res, {
      'get status is 200': (r) => r.status === 200,
      'response contains creds': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.creds && body.creds.me;
        } catch (e) {
          return false;
        }
      },
    });

    errorRate.add(!success);
  });

  sleep(0.5);

  // Teste 3: DELETE operation
  group('Delete Operation', () => {
    const startTime = Date.now();
    const res = http.del(`${BASE_URL}/api/sessions/${sessionId}`);

    deleteLatency.add(Date.now() - startTime);

    const success = check(res, {
      'delete status is 200 or 204': (r) => r.status === 200 || r.status === 204,
    });

    errorRate.add(!success);
  });

  sleep(1);
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    metrics: {
      http_req_duration: {
        avg: data.metrics.http_req_duration.values.avg,
        min: data.metrics.http_req_duration.values.min,
        max: data.metrics.http_req_duration.values.max,
        p95: data.metrics.http_req_duration.values['p(95)'],
        p99: data.metrics.http_req_duration.values['p(99)'],
      },
      http_reqs: {
        total: data.metrics.http_reqs.values.count,
        rate: data.metrics.http_reqs.values.rate,
      },
      errors: {
        rate: data.metrics.errors.values.rate,
        count: data.metrics.errors.values.passes,
      },
      vus: {
        max: data.metrics.vus_max.values.value,
        current: data.metrics.vus.values.value,
      },
    },
    thresholds: data.thresholds,
  };

  console.log('\n📊 Load Test Summary:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Total Requests: ${summary.metrics.http_reqs.total}`);
  console.log(`Request Rate: ${summary.metrics.http_reqs.rate.toFixed(2)} req/s`);
  console.log(`Error Rate: ${(summary.metrics.errors.rate * 100).toFixed(2)}%`);
  console.log(`Max VUs: ${summary.metrics.vus.max}`);
  console.log('\n⏱️  Latency:');
  console.log(`  Avg: ${summary.metrics.http_req_duration.avg.toFixed(2)}ms`);
  console.log(`  Min: ${summary.metrics.http_req_duration.min.toFixed(2)}ms`);
  console.log(`  Max: ${summary.metrics.http_req_duration.max.toFixed(2)}ms`);
  console.log(`  p95: ${summary.metrics.http_req_duration.p95.toFixed(2)}ms`);
  console.log(`  p99: ${summary.metrics.http_req_duration.p99.toFixed(2)}ms`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  return { stdout: JSON.stringify(summary, null, 2) };
}
