/**
 * Rotation Monitor Tests
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  RotationMonitor,
  DEFAULT_ROTATION_MONITOR_CONFIG,
} from '../../monitoring/rotation-monitor.js';

describe('RotationMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('constructor', () => {
    it('should use default config', () => {
      const monitor = new RotationMonitor();
      const config = monitor.getConfig();

      expect(config.thresholdPerMinute).toBe(DEFAULT_ROTATION_MONITOR_CONFIG.thresholdPerMinute);
    });

    it('should accept custom config', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 5 });
      expect(monitor.getConfig().thresholdPerMinute).toBe(5);
    });
  });

  describe('recordRotation', () => {
    it('should return NORMAL for first rotation', () => {
      const monitor = new RotationMonitor();
      const status = monitor.recordRotation('session-1');

      expect(status.status).toBe('NORMAL');
      expect(status.rate).toBe(1);
      expect(status.sessionId).toBe('session-1');
    });

    it('should track multiple rotations', () => {
      const monitor = new RotationMonitor();

      monitor.recordRotation('session-1');
      monitor.recordRotation('session-1');
      const status = monitor.recordRotation('session-1');

      expect(status.rate).toBe(3);
    });

    it('should return WARNING when approaching threshold', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 10 });

      for (let i = 0; i < 8; i++) {
        monitor.recordRotation('session-1');
      }

      const status = monitor.recordRotation('session-1');
      expect(status.status).toBe('WARNING');
    });

    it('should return ANOMALY when threshold exceeded', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 10 });

      for (let i = 0; i < 11; i++) {
        monitor.recordRotation('session-1');
      }

      const status = monitor.recordRotation('session-1');
      expect(status.status).toBe('ANOMALY');
      expect(status.rate).toBeGreaterThan(10);
    });

    it('should reset rate after window expires', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 10, windowMs: 60000 });

      for (let i = 0; i < 10; i++) {
        monitor.recordRotation('session-1');
      }

      vi.advanceTimersByTime(61000);

      const status = monitor.recordRotation('session-1');
      expect(status.status).toBe('NORMAL');
      expect(status.rate).toBe(1);
    });
  });

  describe('getStatus', () => {
    it('should return null for unknown session', () => {
      const monitor = new RotationMonitor();
      expect(monitor.getStatus('unknown')).toBeNull();
    });

    it('should return current status without recording', () => {
      const monitor = new RotationMonitor();
      monitor.recordRotation('session-1');
      monitor.recordRotation('session-1');

      const status = monitor.getStatus('session-1');
      expect(status?.rate).toBe(2);

      const statusAgain = monitor.getStatus('session-1');
      expect(statusAgain?.rate).toBe(2);
    });

    it('should return WARNING status when approaching threshold', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 10 });

      for (let i = 0; i < 8; i++) {
        monitor.recordRotation('session-warn');
      }

      const status = monitor.getStatus('session-warn');
      expect(status?.status).toBe('WARNING');
      expect(status?.rate).toBe(8);
    });

    it('should return ANOMALY status when threshold exceeded', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 10 });

      for (let i = 0; i < 12; i++) {
        monitor.recordRotation('session-anomaly');
      }

      const status = monitor.getStatus('session-anomaly');
      expect(status?.status).toBe('ANOMALY');
    });
  });

  describe('getStats', () => {
    it('should return null for unknown session', () => {
      const monitor = new RotationMonitor();
      expect(monitor.getStats('unknown')).toBeNull();
    });

    it('should return detailed statistics', () => {
      const monitor = new RotationMonitor();

      monitor.recordRotation('session-1');
      vi.advanceTimersByTime(1000);
      monitor.recordRotation('session-1');

      const stats = monitor.getStats('session-1');
      expect(stats?.totalRotations).toBe(2);
      expect(stats?.recentRotations).toBe(2);
      expect(stats?.anomalyDetected).toBe(false);
    });

    it('should track anomaly detection', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 3 });

      for (let i = 0; i < 5; i++) {
        monitor.recordRotation('session-1');
      }

      const stats = monitor.getStats('session-1');
      expect(stats?.anomalyDetected).toBe(true);
    });
  });

  describe('hasAnomaly', () => {
    it('should return false for normal session', () => {
      const monitor = new RotationMonitor();
      monitor.recordRotation('session-1');
      expect(monitor.hasAnomaly('session-1')).toBe(false);
    });

    it('should return true for anomalous session', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 3 });

      for (let i = 0; i < 5; i++) {
        monitor.recordRotation('session-1');
      }

      expect(monitor.hasAnomaly('session-1')).toBe(true);
    });
  });

  describe('onAnomaly listener', () => {
    it('should notify on anomaly', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 3 });
      const listener = vi.fn();

      monitor.onAnomaly(listener);

      for (let i = 0; i < 5; i++) {
        monitor.recordRotation('session-1');
      }

      expect(listener).toHaveBeenCalled();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ANOMALY',
          sessionId: 'session-1',
        }),
      );
    });

    it('should support unsubscribe', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 3 });
      const listener = vi.fn();

      const unsubscribe = monitor.onAnomaly(listener);
      unsubscribe();

      for (let i = 0; i < 5; i++) {
        monitor.recordRotation('session-1');
      }

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should reset session data', () => {
      const monitor = new RotationMonitor();
      monitor.recordRotation('session-1');

      expect(monitor.getStats('session-1')).not.toBeNull();

      monitor.reset('session-1');
      expect(monitor.getStats('session-1')).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all sessions', () => {
      const monitor = new RotationMonitor();
      monitor.recordRotation('session-1');
      monitor.recordRotation('session-2');

      monitor.clear();

      expect(monitor.getStats('session-1')).toBeNull();
      expect(monitor.getStats('session-2')).toBeNull();
    });
  });

  describe('getAggregateStats', () => {
    it('should return aggregate statistics', () => {
      const monitor = new RotationMonitor({ thresholdPerMinute: 5 });

      monitor.recordRotation('session-1');
      monitor.recordRotation('session-1');
      monitor.recordRotation('session-2');

      for (let i = 0; i < 6; i++) {
        monitor.recordRotation('session-3');
      }

      const stats = monitor.getAggregateStats();
      expect(stats.trackedSessions).toBe(3);
      expect(stats.sessionsWithAnomalies).toBe(1);
      expect(stats.totalRotationsRecorded).toBe(9);
    });
  });
});
