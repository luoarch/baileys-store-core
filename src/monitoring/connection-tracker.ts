/**
 * @baileys-store/core - Connection Health Tracker
 *
 * Tracks connection health by monitoring activity timestamps.
 * Detects false "online" status (GitHub #2302) and socket timeouts (#2337).
 *
 * @see https://github.com/WhiskeySockets/Baileys/issues/2302
 * @see https://github.com/WhiskeySockets/Baileys/issues/2337
 * @since 1.1.0
 */

import { LRUCache } from 'lru-cache';

import type { SessionId } from '../types/index.js';

/**
 * Connection health states.
 */
export type ConnectionState = 'HEALTHY' | 'DEGRADED' | 'DISCONNECTED' | 'RECONNECTING';

/**
 * Configuration for connection health tracking.
 */
export interface ConnectionTrackerConfig {
  /** Silence threshold before considering connection degraded (ms) */
  silenceThresholdMs: number;
  /** Silence threshold before considering connection disconnected (ms) */
  disconnectThresholdMs: number;
  /** Maximum number of sessions to track (LRU eviction) */
  maxSessions?: number;
  /** Enable automatic health checks on getHealth calls */
  autoCheck?: boolean;
}

/**
 * Connection health status returned from health checks.
 */
export interface ConnectionHealth {
  /** Current health status */
  status: ConnectionState;
  /** Time since last activity (ms) */
  silentMs: number;
  /** Recommendation for action */
  recommendation: 'NONE' | 'PING' | 'RECONNECT';
  /** Session identifier */
  sessionId: SessionId;
  /** Timestamp of this check */
  timestamp: Date;
}

/**
 * Session connection data stored per session.
 */
export interface SessionConnectionData {
  /** Last activity timestamp */
  lastActivity: number;
  /** Current state */
  state: ConnectionState;
  /** Last state change timestamp */
  stateChangedAt: number;
  /** Total reconnection attempts */
  reconnectAttempts: number;
  /** Successful reconnections */
  successfulReconnects: number;
}

/**
 * Default connection tracker configuration.
 */
export const DEFAULT_CONNECTION_TRACKER_CONFIG: Required<ConnectionTrackerConfig> = {
  silenceThresholdMs: 300000,
  disconnectThresholdMs: 600000,
  maxSessions: 10000,
  autoCheck: true,
};

/**
 * Tracks connection health by monitoring activity timestamps.
 *
 * WhatsApp connections can appear "online" while actually being disconnected.
 * This tracker monitors activity patterns to detect false online status and
 * recommend remedial actions.
 *
 * @example
 * ```typescript
 * const tracker = new ConnectionHealthTracker({ silenceThresholdMs: 300000 });
 *
 * // Record activity from Baileys events
 * tracker.recordActivity(sessionId);
 *
 * // Check connection health
 * const health = tracker.checkHealth(sessionId);
 * if (health.status === 'DEGRADED') {
 *   await sock.sendPresenceUpdate('available');
 * }
 * ```
 */
export class ConnectionHealthTracker {
  private readonly connections: LRUCache<SessionId, SessionConnectionData>;
  private readonly config: Required<ConnectionTrackerConfig>;
  private readonly listeners: Set<(health: ConnectionHealth) => void>;

  constructor(config: Partial<ConnectionTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONNECTION_TRACKER_CONFIG, ...config };

    this.connections = new LRUCache<SessionId, SessionConnectionData>({
      max: this.config.maxSessions,
      ttl: 24 * 60 * 60 * 1000,
    });

    this.listeners = new Set();
  }

  /**
   * Records activity for a session, updating its last-seen timestamp.
   *
   * @param sessionId - Session identifier
   */
  recordActivity(sessionId: SessionId): void {
    const now = Date.now();
    let data = this.connections.get(sessionId);

    if (!data) {
      data = {
        lastActivity: now,
        state: 'HEALTHY',
        stateChangedAt: now,
        reconnectAttempts: 0,
        successfulReconnects: 0,
      };
    } else {
      const previousState = data.state;
      data.lastActivity = now;
      data.state = 'HEALTHY';

      if (previousState !== 'HEALTHY') {
        data.stateChangedAt = now;
        if (previousState === 'RECONNECTING') {
          data.successfulReconnects++;
        }
      }
    }

    this.connections.set(sessionId, data);
  }

  /**
   * Records a reconnection attempt for a session.
   *
   * @param sessionId - Session identifier
   */
  recordReconnectAttempt(sessionId: SessionId): void {
    const now = Date.now();
    let data = this.connections.get(sessionId);

    if (!data) {
      data = {
        lastActivity: 0,
        state: 'RECONNECTING',
        stateChangedAt: now,
        reconnectAttempts: 1,
        successfulReconnects: 0,
      };
    } else {
      if (data.state !== 'RECONNECTING') {
        data.stateChangedAt = now;
      }
      data.state = 'RECONNECTING';
      data.reconnectAttempts++;
    }

    this.connections.set(sessionId, data);
  }

  /**
   * Records a disconnection for a session.
   *
   * @param sessionId - Session identifier
   */
  recordDisconnect(sessionId: SessionId): void {
    const now = Date.now();
    let data = this.connections.get(sessionId);

    if (!data) {
      data = {
        lastActivity: 0,
        state: 'DISCONNECTED',
        stateChangedAt: now,
        reconnectAttempts: 0,
        successfulReconnects: 0,
      };
    } else {
      if (data.state !== 'DISCONNECTED') {
        data.stateChangedAt = now;
      }
      data.state = 'DISCONNECTED';
    }

    this.connections.set(sessionId, data);
  }

  /**
   * Checks the health of a session based on activity patterns.
   *
   * @param sessionId - Session identifier
   * @returns Health status with recommendation if degraded
   */
  checkHealth(sessionId: SessionId): ConnectionHealth {
    const now = Date.now();
    const data = this.connections.get(sessionId);

    if (!data) {
      return {
        status: 'DISCONNECTED',
        silentMs: Number.MAX_SAFE_INTEGER,
        recommendation: 'RECONNECT',
        sessionId,
        timestamp: new Date(now),
      };
    }

    if (data.state === 'DISCONNECTED') {
      return {
        status: 'DISCONNECTED',
        silentMs: now - data.lastActivity,
        recommendation: 'RECONNECT',
        sessionId,
        timestamp: new Date(now),
      };
    }

    if (data.state === 'RECONNECTING') {
      return {
        status: 'RECONNECTING',
        silentMs: now - data.lastActivity,
        recommendation: 'NONE',
        sessionId,
        timestamp: new Date(now),
      };
    }

    const silentMs = now - data.lastActivity;
    let status: ConnectionState = 'HEALTHY';
    let recommendation: 'NONE' | 'PING' | 'RECONNECT' = 'NONE';

    if (silentMs > this.config.disconnectThresholdMs) {
      status = 'DISCONNECTED';
      recommendation = 'RECONNECT';
    } else if (silentMs > this.config.silenceThresholdMs) {
      status = 'DEGRADED';
      recommendation = 'PING';
    }

    if (this.config.autoCheck && status !== data.state) {
      data.state = status;
      data.stateChangedAt = now;
      this.connections.set(sessionId, data);
    }

    const health: ConnectionHealth = {
      status,
      silentMs,
      recommendation,
      sessionId,
      timestamp: new Date(now),
    };

    if (status !== 'HEALTHY') {
      this.notifyListeners(health);
    }

    return health;
  }

  /**
   * Gets connection data for a session.
   *
   * @param sessionId - Session identifier
   * @returns Connection data or null if not found
   */
  getConnectionData(sessionId: SessionId): SessionConnectionData | null {
    return this.connections.get(sessionId) ?? null;
  }

  /**
   * Gets the current state of a session.
   *
   * @param sessionId - Session identifier
   * @returns Connection state or null if not tracked
   */
  getState(sessionId: SessionId): ConnectionState | null {
    const data = this.connections.get(sessionId);
    return data?.state ?? null;
  }

  /**
   * Checks if a session is healthy.
   *
   * @param sessionId - Session identifier
   * @returns true if session is healthy
   */
  isHealthy(sessionId: SessionId): boolean {
    const health = this.checkHealth(sessionId);
    return health.status === 'HEALTHY';
  }

  /**
   * Resets connection data for a session.
   *
   * @param sessionId - Session identifier
   */
  reset(sessionId: SessionId): void {
    this.connections.delete(sessionId);
  }

  /**
   * Clears all connection data.
   */
  clear(): void {
    this.connections.clear();
  }

  /**
   * Registers a listener for health change events.
   *
   * @param listener - Callback function
   * @returns Unsubscribe function
   */
  onHealthChange(listener: (health: ConnectionHealth) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Gets all sessions in a specific state.
   *
   * @param state - State to filter by
   * @returns Array of session IDs
   */
  getSessionsByState(state: ConnectionState): SessionId[] {
    const sessions: SessionId[] = [];

    this.connections.forEach((data, sessionId) => {
      if (data.state === state) {
        sessions.push(sessionId);
      }
    });

    return sessions;
  }

  /**
   * Gets aggregate statistics.
   */
  getStats(): {
    totalSessions: number;
    healthy: number;
    degraded: number;
    disconnected: number;
    reconnecting: number;
    totalReconnectAttempts: number;
    successfulReconnects: number;
  } {
    let healthy = 0;
    let degraded = 0;
    let disconnected = 0;
    let reconnecting = 0;
    let totalReconnectAttempts = 0;
    let successfulReconnects = 0;

    this.connections.forEach((data) => {
      switch (data.state) {
        case 'HEALTHY':
          healthy++;
          break;
        case 'DEGRADED':
          degraded++;
          break;
        case 'DISCONNECTED':
          disconnected++;
          break;
        case 'RECONNECTING':
          reconnecting++;
          break;
      }
      totalReconnectAttempts += data.reconnectAttempts;
      successfulReconnects += data.successfulReconnects;
    });

    return {
      totalSessions: this.connections.size,
      healthy,
      degraded,
      disconnected,
      reconnecting,
      totalReconnectAttempts,
      successfulReconnects,
    };
  }

  /**
   * Returns the current configuration.
   */
  getConfig(): Readonly<Required<ConnectionTrackerConfig>> {
    return { ...this.config };
  }

  /**
   * Notifies all listeners of a health change.
   */
  private notifyListeners(health: ConnectionHealth): void {
    for (const listener of this.listeners) {
      try {
        listener(health);
      } catch {
        // Ignore listener errors
      }
    }
  }
}
