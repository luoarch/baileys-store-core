/**
 * Connection Health Tracker Tests
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  ConnectionHealthTracker,
  DEFAULT_CONNECTION_TRACKER_CONFIG,
} from '../../monitoring/connection-tracker.js';

describe('ConnectionHealthTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('constructor', () => {
    it('should use default config', () => {
      const tracker = new ConnectionHealthTracker();
      const config = tracker.getConfig();

      expect(config.silenceThresholdMs).toBe(DEFAULT_CONNECTION_TRACKER_CONFIG.silenceThresholdMs);
      expect(config.disconnectThresholdMs).toBe(
        DEFAULT_CONNECTION_TRACKER_CONFIG.disconnectThresholdMs,
      );
    });

    it('should accept custom config', () => {
      const tracker = new ConnectionHealthTracker({ silenceThresholdMs: 60000 });
      expect(tracker.getConfig().silenceThresholdMs).toBe(60000);
    });
  });

  describe('recordActivity', () => {
    it('should create new session as healthy', () => {
      const tracker = new ConnectionHealthTracker();
      tracker.recordActivity('session-1');

      const health = tracker.checkHealth('session-1');
      expect(health.status).toBe('HEALTHY');
    });

    it('should update existing session', () => {
      const tracker = new ConnectionHealthTracker({ silenceThresholdMs: 5000 });
      tracker.recordActivity('session-1');

      vi.advanceTimersByTime(6000);
      expect(tracker.checkHealth('session-1').status).toBe('DEGRADED');

      tracker.recordActivity('session-1');
      expect(tracker.checkHealth('session-1').status).toBe('HEALTHY');
    });
  });

  describe('checkHealth', () => {
    it('should return DISCONNECTED for unknown session', () => {
      const tracker = new ConnectionHealthTracker();
      const health = tracker.checkHealth('unknown');

      expect(health.status).toBe('DISCONNECTED');
      expect(health.recommendation).toBe('RECONNECT');
    });

    it('should return HEALTHY within silence threshold', () => {
      const tracker = new ConnectionHealthTracker({ silenceThresholdMs: 5000 });
      tracker.recordActivity('session-1');

      vi.advanceTimersByTime(3000);
      const health = tracker.checkHealth('session-1');

      expect(health.status).toBe('HEALTHY');
      expect(health.recommendation).toBe('NONE');
    });

    it('should return DEGRADED after silence threshold', () => {
      const tracker = new ConnectionHealthTracker({
        silenceThresholdMs: 5000,
        disconnectThresholdMs: 10000,
      });
      tracker.recordActivity('session-1');

      vi.advanceTimersByTime(6000);
      const health = tracker.checkHealth('session-1');

      expect(health.status).toBe('DEGRADED');
      expect(health.recommendation).toBe('PING');
      expect(health.silentMs).toBeGreaterThanOrEqual(6000);
    });

    it('should return DISCONNECTED after disconnect threshold', () => {
      const tracker = new ConnectionHealthTracker({
        silenceThresholdMs: 5000,
        disconnectThresholdMs: 10000,
      });
      tracker.recordActivity('session-1');

      vi.advanceTimersByTime(11000);
      const health = tracker.checkHealth('session-1');

      expect(health.status).toBe('DISCONNECTED');
      expect(health.recommendation).toBe('RECONNECT');
    });
  });

  describe('recordReconnectAttempt', () => {
    it('should track reconnect attempts', () => {
      const tracker = new ConnectionHealthTracker();

      tracker.recordReconnectAttempt('session-1');
      tracker.recordReconnectAttempt('session-1');

      const data = tracker.getConnectionData('session-1');
      expect(data?.state).toBe('RECONNECTING');
      expect(data?.reconnectAttempts).toBe(2);
    });

    it('should return RECONNECTING status', () => {
      const tracker = new ConnectionHealthTracker();
      tracker.recordReconnectAttempt('session-1');

      const health = tracker.checkHealth('session-1');
      expect(health.status).toBe('RECONNECTING');
    });
  });

  describe('recordDisconnect', () => {
    it('should mark session as disconnected', () => {
      const tracker = new ConnectionHealthTracker();
      tracker.recordActivity('session-1');
      tracker.recordDisconnect('session-1');

      const health = tracker.checkHealth('session-1');
      expect(health.status).toBe('DISCONNECTED');
    });
  });

  describe('successful reconnection tracking', () => {
    it('should track successful reconnects', () => {
      const tracker = new ConnectionHealthTracker();

      tracker.recordReconnectAttempt('session-1');
      tracker.recordActivity('session-1');

      const data = tracker.getConnectionData('session-1');
      expect(data?.successfulReconnects).toBe(1);
    });
  });

  describe('isHealthy', () => {
    it('should return true for healthy session', () => {
      const tracker = new ConnectionHealthTracker();
      tracker.recordActivity('session-1');

      expect(tracker.isHealthy('session-1')).toBe(true);
    });

    it('should return false for degraded session', () => {
      const tracker = new ConnectionHealthTracker({ silenceThresholdMs: 1000 });
      tracker.recordActivity('session-1');

      vi.advanceTimersByTime(2000);
      expect(tracker.isHealthy('session-1')).toBe(false);
    });
  });

  describe('getState', () => {
    it('should return null for unknown session', () => {
      const tracker = new ConnectionHealthTracker();
      expect(tracker.getState('unknown')).toBeNull();
    });

    it('should return current state', () => {
      const tracker = new ConnectionHealthTracker();
      tracker.recordActivity('session-1');

      expect(tracker.getState('session-1')).toBe('HEALTHY');
    });
  });

  describe('getSessionsByState', () => {
    it('should filter sessions by state', () => {
      const tracker = new ConnectionHealthTracker({ silenceThresholdMs: 1000, autoCheck: true });

      tracker.recordActivity('healthy-1');
      tracker.recordActivity('healthy-2');
      tracker.recordDisconnect('disconnected-1');

      expect(tracker.getSessionsByState('HEALTHY')).toHaveLength(2);
      expect(tracker.getSessionsByState('DISCONNECTED')).toHaveLength(1);
    });
  });

  describe('onHealthChange listener', () => {
    it('should notify on health degradation', () => {
      const tracker = new ConnectionHealthTracker({
        silenceThresholdMs: 1000,
        autoCheck: true,
      });
      const listener = vi.fn();

      tracker.onHealthChange(listener);
      tracker.recordActivity('session-1');

      vi.advanceTimersByTime(2000);
      tracker.checkHealth('session-1');

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'DEGRADED',
          sessionId: 'session-1',
        }),
      );
    });

    it('should support unsubscribe', () => {
      const tracker = new ConnectionHealthTracker({ silenceThresholdMs: 1000 });
      const listener = vi.fn();

      const unsubscribe = tracker.onHealthChange(listener);
      unsubscribe();

      tracker.recordActivity('session-1');
      vi.advanceTimersByTime(2000);
      tracker.checkHealth('session-1');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should reset session data', () => {
      const tracker = new ConnectionHealthTracker();
      tracker.recordActivity('session-1');

      expect(tracker.getConnectionData('session-1')).not.toBeNull();

      tracker.reset('session-1');
      expect(tracker.getConnectionData('session-1')).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all sessions', () => {
      const tracker = new ConnectionHealthTracker();
      tracker.recordActivity('session-1');
      tracker.recordActivity('session-2');

      tracker.clear();

      expect(tracker.getStats().totalSessions).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return aggregate statistics', () => {
      const tracker = new ConnectionHealthTracker();

      tracker.recordActivity('healthy-1');
      tracker.recordActivity('healthy-2');
      tracker.recordDisconnect('disconnected-1');
      tracker.recordReconnectAttempt('reconnecting-1');

      const stats = tracker.getStats();
      expect(stats.totalSessions).toBe(4);
      expect(stats.healthy).toBe(2);
      expect(stats.disconnected).toBe(1);
      expect(stats.reconnecting).toBe(1);
    });

    it('should count DEGRADED sessions in stats', () => {
      const tracker = new ConnectionHealthTracker({
        silenceThresholdMs: 1000,
        disconnectThresholdMs: 5000,
        autoCheck: true,
      });

      tracker.recordActivity('degraded-1');
      vi.advanceTimersByTime(2000);
      tracker.checkHealth('degraded-1');

      const stats = tracker.getStats();
      expect(stats.degraded).toBe(1);
    });
  });

  describe('recordReconnectAttempt edge cases', () => {
    it('should update stateChangedAt when transitioning to RECONNECTING', () => {
      const tracker = new ConnectionHealthTracker();

      tracker.recordActivity('session-1');
      const initialData = tracker.getConnectionData('session-1');
      const initialStateChangedAt = initialData?.stateChangedAt;

      vi.advanceTimersByTime(100);

      tracker.recordReconnectAttempt('session-1');
      const updatedData = tracker.getConnectionData('session-1');

      expect(updatedData?.state).toBe('RECONNECTING');
      expect(updatedData?.stateChangedAt).toBeGreaterThan(initialStateChangedAt ?? 0);
    });

    it('should not update stateChangedAt when already RECONNECTING', () => {
      const tracker = new ConnectionHealthTracker();

      tracker.recordReconnectAttempt('session-1');
      const data1 = tracker.getConnectionData('session-1');
      const stateChangedAt1 = data1?.stateChangedAt;

      vi.advanceTimersByTime(100);

      tracker.recordReconnectAttempt('session-1');
      const data2 = tracker.getConnectionData('session-1');

      expect(data2?.stateChangedAt).toBe(stateChangedAt1);
      expect(data2?.reconnectAttempts).toBe(2);
    });
  });

  describe('listener error handling', () => {
    it('should not crash when listener throws', () => {
      const tracker = new ConnectionHealthTracker({ silenceThresholdMs: 1000, autoCheck: true });
      const errorListener = vi.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });

      tracker.onHealthChange(errorListener);
      tracker.recordActivity('session-1');

      vi.advanceTimersByTime(2000);

      expect(() => tracker.checkHealth('session-1')).not.toThrow();
    });
  });
});
