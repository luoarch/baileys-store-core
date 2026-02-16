/**
 * @baileys-store/core - Session Rotation Monitor
 *
 * Monitors Signal session rotation frequency to detect anomalies.
 * Abnormal rotation rates correlate with WhatsApp account bans.
 *
 * @see https://github.com/WhiskeySockets/Baileys/issues/2340
 * @since 1.1.0
 */

import { LRUCache } from 'lru-cache';

import type { SessionId } from '../types/index.js';

/**
 * Threshold validated from GitHub issue #2340 correlation with bans.
 * Normal rotation: ~1x per conversation (signed prekey monthly).
 * Anomaly: "many times per minute" causes bans.
 */
const DEFAULT_ROTATION_THRESHOLD_PER_MINUTE = 10;

/**
 * Configuration for rotation monitoring.
 */
export interface RotationMonitorConfig {
  /** Maximum rotations per minute before flagging anomaly */
  thresholdPerMinute: number;
  /** Maximum number of sessions to track (LRU eviction) */
  maxSessions?: number;
  /** Window size in ms for counting rotations (default: 60000) */
  windowMs?: number;
}

/**
 * Rotation status returned after recording.
 */
export interface RotationStatus {
  /** Status of the rotation rate */
  status: 'NORMAL' | 'WARNING' | 'ANOMALY';
  /** Current rotation rate per minute */
  rate: number;
  /** Configured threshold */
  threshold: number;
  /** Session identifier */
  sessionId: SessionId;
  /** Timestamp of this check */
  timestamp: Date;
}

/**
 * Rotation statistics for a session.
 */
export interface RotationStats {
  /** Total rotations recorded */
  totalRotations: number;
  /** Rotations in current window */
  recentRotations: number;
  /** Time of first rotation */
  firstSeen: Date;
  /** Time of most recent rotation */
  lastSeen: Date;
  /** Current rate per minute */
  currentRate: number;
  /** Whether anomaly was ever detected */
  anomalyDetected: boolean;
}

/**
 * Default rotation monitor configuration.
 */
export const DEFAULT_ROTATION_MONITOR_CONFIG: RotationMonitorConfig = {
  thresholdPerMinute: DEFAULT_ROTATION_THRESHOLD_PER_MINUTE,
  maxSessions: 10000,
  windowMs: 60000,
};

/**
 * Session rotation data stored per session.
 */
interface SessionRotationData {
  timestamps: number[];
  totalRotations: number;
  firstSeen: number;
  anomalyDetected: boolean;
}

/**
 * Monitors Signal session rotation frequency to detect anomalies.
 *
 * Tracks rotation events per session and alerts when the rate exceeds
 * the configured threshold, which correlates with WhatsApp account bans.
 *
 * @example
 * ```typescript
 * const monitor = new RotationMonitor({ thresholdPerMinute: 10 });
 *
 * // Record rotation event from Baileys
 * const status = monitor.recordRotation(sessionId);
 * if (status.status === 'ANOMALY') {
 *   logger.warn('Abnormal rotation rate detected', { sessionId, rate: status.rate });
 * }
 * ```
 */
export class RotationMonitor {
  private readonly rotationData: LRUCache<SessionId, SessionRotationData>;
  private readonly config: RotationMonitorConfig;
  private readonly listeners: Set<(status: RotationStatus) => void>;

  constructor(config: Partial<RotationMonitorConfig> = {}) {
    this.config = { ...DEFAULT_ROTATION_MONITOR_CONFIG, ...config };

    this.rotationData = new LRUCache<SessionId, SessionRotationData>({
      max: this.config.maxSessions ?? 10000,
      ttl: 24 * 60 * 60 * 1000,
    });

    this.listeners = new Set();
  }

  /**
   * Records a session rotation event and checks for anomalies.
   *
   * @param sessionId - Session identifier
   * @returns Status indicating if rotation rate is normal or anomalous
   */
  recordRotation(sessionId: SessionId): RotationStatus {
    const now = Date.now();
    const windowMs = this.config.windowMs ?? 60000;

    let data = this.rotationData.get(sessionId);

    data ??= {
      timestamps: [],
      totalRotations: 0,
      firstSeen: now,
      anomalyDetected: false,
    };

    const recentTimestamps = data.timestamps.filter((t) => now - t < windowMs);
    recentTimestamps.push(now);

    data.timestamps = recentTimestamps;
    data.totalRotations++;

    const rate = recentTimestamps.length;
    let status: 'NORMAL' | 'WARNING' | 'ANOMALY' = 'NORMAL';

    if (rate > this.config.thresholdPerMinute) {
      status = 'ANOMALY';
      data.anomalyDetected = true;
    } else if (rate > this.config.thresholdPerMinute * 0.7) {
      status = 'WARNING';
    }

    this.rotationData.set(sessionId, data);

    const result: RotationStatus = {
      status,
      rate,
      threshold: this.config.thresholdPerMinute,
      sessionId,
      timestamp: new Date(now),
    };

    if (status !== 'NORMAL') {
      this.notifyListeners(result);
    }

    return result;
  }

  /**
   * Gets the current rotation status for a session without recording.
   *
   * @param sessionId - Session identifier
   * @returns Current status or null if no data exists
   */
  getStatus(sessionId: SessionId): RotationStatus | null {
    const data = this.rotationData.get(sessionId);

    if (!data) {
      return null;
    }

    const now = Date.now();
    const windowMs = this.config.windowMs ?? 60000;
    const recentTimestamps = data.timestamps.filter((t) => now - t < windowMs);
    const rate = recentTimestamps.length;

    let status: 'NORMAL' | 'WARNING' | 'ANOMALY' = 'NORMAL';

    if (rate > this.config.thresholdPerMinute) {
      status = 'ANOMALY';
    } else if (rate > this.config.thresholdPerMinute * 0.7) {
      status = 'WARNING';
    }

    return {
      status,
      rate,
      threshold: this.config.thresholdPerMinute,
      sessionId,
      timestamp: new Date(now),
    };
  }

  /**
   * Gets detailed statistics for a session.
   *
   * @param sessionId - Session identifier
   * @returns Rotation statistics or null if no data exists
   */
  getStats(sessionId: SessionId): RotationStats | null {
    const data = this.rotationData.get(sessionId);

    if (!data) {
      return null;
    }

    const now = Date.now();
    const windowMs = this.config.windowMs ?? 60000;
    const recentTimestamps = data.timestamps.filter((t) => now - t < windowMs);

    return {
      totalRotations: data.totalRotations,
      recentRotations: recentTimestamps.length,
      firstSeen: new Date(data.firstSeen),
      lastSeen: new Date(data.timestamps[data.timestamps.length - 1] ?? data.firstSeen),
      currentRate: recentTimestamps.length,
      anomalyDetected: data.anomalyDetected,
    };
  }

  /**
   * Checks if a session has exceeded the rotation threshold.
   *
   * @param sessionId - Session identifier
   * @returns true if anomaly detected
   */
  hasAnomaly(sessionId: SessionId): boolean {
    const status = this.getStatus(sessionId);
    return status?.status === 'ANOMALY';
  }

  /**
   * Resets rotation data for a session.
   *
   * @param sessionId - Session identifier
   */
  reset(sessionId: SessionId): void {
    this.rotationData.delete(sessionId);
  }

  /**
   * Clears all rotation data.
   */
  clear(): void {
    this.rotationData.clear();
  }

  /**
   * Registers a listener for anomaly events.
   *
   * @param listener - Callback function
   * @returns Unsubscribe function
   */
  onAnomaly(listener: (status: RotationStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Returns the current configuration.
   */
  getConfig(): Readonly<RotationMonitorConfig> {
    return { ...this.config };
  }

  /**
   * Returns aggregate statistics.
   */
  getAggregateStats(): {
    trackedSessions: number;
    sessionsWithAnomalies: number;
    totalRotationsRecorded: number;
  } {
    let totalRotations = 0;
    let anomalyCount = 0;

    this.rotationData.forEach((data) => {
      totalRotations += data.totalRotations;
      if (data.anomalyDetected) {
        anomalyCount++;
      }
    });

    return {
      trackedSessions: this.rotationData.size,
      sessionsWithAnomalies: anomalyCount,
      totalRotationsRecorded: totalRotations,
    };
  }

  /**
   * Notifies all listeners of an anomaly.
   */
  private notifyListeners(status: RotationStatus): void {
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch {
        // Ignore listener errors
      }
    }
  }
}
