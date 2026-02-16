/**
 * Diagnostic Engine Tests
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

import { DiagnosticEngine } from '../../diagnostics/diagnostic-engine.js';
import { RotationMonitor } from '../../monitoring/rotation-monitor.js';
import { ConnectionHealthTracker } from '../../monitoring/connection-tracker.js';
import { SessionRateLimiter } from '../../rate-limit/rate-limiter.js';

describe('DiagnosticEngine', () => {
  let rotationMonitor: RotationMonitor;
  let connectionTracker: ConnectionHealthTracker;
  let rateLimiter: SessionRateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    rotationMonitor = new RotationMonitor({ thresholdPerMinute: 10 });
    connectionTracker = new ConnectionHealthTracker({ silenceThresholdMs: 5000 });
    rateLimiter = new SessionRateLimiter({ maxMessagesPerMinute: 12, jitterRangeMs: [0, 0] });
  });

  describe('diagnose', () => {
    it('should return OK status for healthy session', () => {
      const engine = new DiagnosticEngine({
        rotationMonitor,
        connectionTracker,
        rateLimiter,
      });

      connectionTracker.recordActivity('session-1');
      rotationMonitor.recordRotation('session-1');

      const report = engine.diagnose('session-1');

      expect(report.overallStatus).toBe('OK');
      expect(report.sessionId).toBe('session-1');
      expect(report.recommendations).toHaveLength(0);
    });

    it('should detect rotation anomaly', () => {
      const engine = new DiagnosticEngine({ rotationMonitor });

      for (let i = 0; i < 15; i++) {
        rotationMonitor.recordRotation('session-1');
      }

      const report = engine.diagnose('session-1');

      expect(report.overallStatus).toBe('CRITICAL');
      expect(report.checks.rotationRate.status).toBe('CRITICAL');
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('should detect connection degradation', () => {
      const engine = new DiagnosticEngine({ connectionTracker });

      connectionTracker.recordActivity('session-1');
      vi.advanceTimersByTime(6000);

      const report = engine.diagnose('session-1');

      expect(report.checks.connectionHealth.status).toBe('WARNING');
    });

    it('should detect disconnected session', () => {
      const engine = new DiagnosticEngine({ connectionTracker });

      connectionTracker.recordDisconnect('session-1');

      const report = engine.diagnose('session-1');

      expect(report.overallStatus).toBe('CRITICAL');
      expect(report.checks.connectionHealth.status).toBe('CRITICAL');
    });

    it('should work with partial components', () => {
      const engine = new DiagnosticEngine({ rotationMonitor });

      const report = engine.diagnose('session-1');

      expect(report.checks.connectionHealth.status).toBe('OK');
      expect(report.checks.connectionHealth.message).toBe('Connection tracker not configured');
    });

    it('should work with no components', () => {
      const engine = new DiagnosticEngine({});

      const report = engine.diagnose('session-1');

      expect(report.overallStatus).toBe('OK');
    });
  });

  describe('quickCheck', () => {
    it('should return OK for healthy session', () => {
      const engine = new DiagnosticEngine({
        rotationMonitor,
        connectionTracker,
      });

      connectionTracker.recordActivity('session-1');

      expect(engine.quickCheck('session-1')).toBe('OK');
    });

    it('should return CRITICAL for anomalous rotation', () => {
      const engine = new DiagnosticEngine({ rotationMonitor });

      for (let i = 0; i < 15; i++) {
        rotationMonitor.recordRotation('session-1');
      }

      expect(engine.quickCheck('session-1')).toBe('CRITICAL');
    });

    it('should return WARNING for degraded connection', () => {
      const engine = new DiagnosticEngine({ connectionTracker });

      connectionTracker.recordActivity('session-1');
      vi.advanceTimersByTime(6000);

      expect(engine.quickCheck('session-1')).toBe('WARNING');
    });

    it('should return WARNING for rotation WARNING status', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 10 });
      const engine = new DiagnosticEngine({ rotationMonitor: monitor });

      // Create 8 rotations to trigger WARNING (80% of threshold)
      for (let i = 0; i < 8; i++) {
        monitor.recordRotation('session-warn');
      }

      expect(engine.quickCheck('session-warn')).toBe('WARNING');
    });
  });

  describe('requiresAttention', () => {
    it('should return false for healthy session', () => {
      const engine = new DiagnosticEngine({ connectionTracker });

      connectionTracker.recordActivity('session-1');

      expect(engine.requiresAttention('session-1')).toBe(false);
    });

    it('should return true for critical session', () => {
      const engine = new DiagnosticEngine({ connectionTracker });

      connectionTracker.recordDisconnect('session-1');

      expect(engine.requiresAttention('session-1')).toBe(true);
    });
  });

  describe('getSessionsRequiringAttention', () => {
    it('should return disconnected sessions', () => {
      const engine = new DiagnosticEngine({ connectionTracker });

      connectionTracker.recordActivity('healthy-1');
      connectionTracker.recordDisconnect('disconnected-1');

      const sessions = engine.getSessionsRequiringAttention();

      expect(sessions).toContain('disconnected-1');
    });

    it('should check rotation monitor for anomalies', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 3 });
      const engine = new DiagnosticEngine({
        rotationMonitor: monitor,
        connectionTracker,
      });

      // Create anomaly in rotation monitor
      for (let i = 0; i < 5; i++) {
        monitor.recordRotation('session-anomaly');
      }

      connectionTracker.recordDisconnect('session-dc');

      const sessions = engine.getSessionsRequiringAttention();

      expect(sessions).toContain('session-dc');
    });
  });

  describe('recommendations', () => {
    it('should generate recommendations for critical issues', () => {
      const engine = new DiagnosticEngine({
        rotationMonitor,
        connectionTracker,
      });

      for (let i = 0; i < 15; i++) {
        rotationMonitor.recordRotation('session-1');
      }
      connectionTracker.recordDisconnect('session-1');

      const report = engine.diagnose('session-1');

      expect(report.recommendations.length).toBeGreaterThanOrEqual(2);
      expect(report.recommendations.some((r) => r.includes('CRITICAL'))).toBe(true);
    });

    it('should generate WARNING recommendation for rotation', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 10 });
      const engine = new DiagnosticEngine({ rotationMonitor: monitor });

      for (let i = 0; i < 8; i++) {
        monitor.recordRotation('session-warn');
      }

      const report = engine.diagnose('session-warn');

      expect(report.checks.rotationRate.status).toBe('WARNING');
      expect(
        report.recommendations.some((r) => r.includes('WARNING') && r.includes('rotation')),
      ).toBe(true);
    });

    it('should generate WARNING recommendation for connection with PING', () => {
      const tracker = new ConnectionHealthTracker({
        silenceThresholdMs: 1000,
        disconnectThresholdMs: 5000,
      });
      const engine = new DiagnosticEngine({ connectionTracker: tracker });

      tracker.recordActivity('session-ping');
      vi.advanceTimersByTime(2000);

      const report = engine.diagnose('session-ping');

      expect(report.checks.connectionHealth.status).toBe('WARNING');
      expect(report.recommendations.some((r) => r.includes('ping') || r.includes('PING'))).toBe(
        true,
      );
    });

    it('should generate WARNING recommendation for rate limit', () => {
      const limiter = new SessionRateLimiter({
        maxMessagesPerMinute: 5,
        jitterRangeMs: [0, 0],
        enabled: true,
      });
      const engine = new DiagnosticEngine({ rateLimiter: limiter });

      for (let i = 0; i < 4; i++) {
        limiter.canAcquire('session-rate');
      }

      const report = engine.diagnose('session-rate');

      expect(report.checks.rateLimitStatus.status).toBe('WARNING');
      expect(report.recommendations.some((r) => r.includes('rate limit'))).toBe(true);
    });

    it('should disable recommendations when configured', () => {
      const engine = new DiagnosticEngine({ connectionTracker }, { enableRecommendations: false });

      connectionTracker.recordDisconnect('session-1');

      const report = engine.diagnose('session-1');

      expect(report.recommendations).toHaveLength(0);
    });
  });

  describe('rate limit checks', () => {
    it('should detect rate limit status', () => {
      const engine = new DiagnosticEngine({ rateLimiter });

      const report = engine.diagnose('session-1');

      expect(report.checks.rateLimitStatus.status).toBe('OK');
      expect(report.checks.rateLimitStatus.message).toContain('Tokens');
    });

    it('should detect low tokens warning status', () => {
      const limiter = new SessionRateLimiter({
        maxMessagesPerMinute: 2,
        jitterRangeMs: [0, 0],
        enabled: true,
      });
      const engine = new DiagnosticEngine({ rateLimiter: limiter });

      // After canAcquire, we should have 2 tokens (initial) - note: canAcquire doesn't consume
      // With maxMessagesPerMinute=2, tokensRemaining will be 2 after first check
      // Since tokensRemaining < 3, should trigger WARNING
      const report = engine.diagnose('low-tokens-session');

      expect(report.checks.rateLimitStatus.status).toBe('WARNING');
      expect(report.checks.rateLimitStatus.message).toContain('Low tokens');
    });
  });

  describe('connection RECONNECTING status', () => {
    it('should detect RECONNECTING connection status', () => {
      const engine = new DiagnosticEngine({ connectionTracker });

      connectionTracker.recordReconnectAttempt('reconnecting-session');

      const report = engine.diagnose('reconnecting-session');

      expect(report.checks.connectionHealth.status).toBe('WARNING');
      expect(report.checks.connectionHealth.message).toContain('reconnecting');
    });
  });
});
