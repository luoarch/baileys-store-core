/**
 * @baileys-store/core - Diagnostic Engine
 *
 * Unified diagnostic system that aggregates health checks from multiple monitors.
 * Provides actionable recommendations for session health issues.
 *
 * @since 1.1.0
 */

import type { SessionId } from '../types/index.js';
import type { RotationMonitor, RotationStatus } from '../monitoring/rotation-monitor.js';
import type {
  ConnectionHealthTracker,
  ConnectionHealth,
} from '../monitoring/connection-tracker.js';
import type { SessionRateLimiter, RateLimitStatus } from '../rate-limit/rate-limiter.js';

/**
 * Diagnostic check status.
 */
export type DiagnosticStatus = 'OK' | 'WARNING' | 'CRITICAL';

/**
 * Individual check result.
 */
export interface CheckResult {
  /** Check name */
  name: string;
  /** Check status */
  status: DiagnosticStatus;
  /** Human-readable message */
  message: string;
  /** Additional data */
  data?: Record<string, unknown>;
}

/**
 * Complete diagnostic report for a session.
 */
export interface DiagnosticReport {
  /** Session identifier */
  sessionId: SessionId;
  /** Report timestamp */
  timestamp: Date;
  /** Overall status (worst of all checks) */
  overallStatus: DiagnosticStatus;
  /** Individual check results */
  checks: {
    rotationRate: CheckResult;
    connectionHealth: CheckResult;
    rateLimitStatus: CheckResult;
  };
  /** Actionable recommendations */
  recommendations: string[];
}

/**
 * Configuration for the diagnostic engine.
 */
export interface DiagnosticEngineConfig {
  /** Enable automatic recommendations */
  enableRecommendations?: boolean;
}

/**
 * Default diagnostic engine configuration.
 */
export const DEFAULT_DIAGNOSTIC_ENGINE_CONFIG: Required<DiagnosticEngineConfig> = {
  enableRecommendations: true,
};

/**
 * Unified diagnostic engine that aggregates health checks.
 *
 * Composes multiple monitoring components to provide a comprehensive
 * health assessment and actionable recommendations.
 *
 * @example
 * ```typescript
 * const engine = new DiagnosticEngine({
 *   rotationMonitor,
 *   connectionTracker,
 *   rateLimiter,
 * });
 *
 * const report = engine.diagnose(sessionId);
 * if (report.overallStatus === 'CRITICAL') {
 *   logger.error('Session health critical', { recommendations: report.recommendations });
 * }
 * ```
 */
export class DiagnosticEngine {
  private readonly rotationMonitor?: RotationMonitor;
  private readonly connectionTracker?: ConnectionHealthTracker;
  private readonly rateLimiter?: SessionRateLimiter;
  private readonly config: Required<DiagnosticEngineConfig>;

  constructor(
    components: {
      rotationMonitor?: RotationMonitor;
      connectionTracker?: ConnectionHealthTracker;
      rateLimiter?: SessionRateLimiter;
    },
    config: DiagnosticEngineConfig = {},
  ) {
    this.rotationMonitor = components.rotationMonitor;
    this.connectionTracker = components.connectionTracker;
    this.rateLimiter = components.rateLimiter;
    this.config = { ...DEFAULT_DIAGNOSTIC_ENGINE_CONFIG, ...config };
  }

  /**
   * Performs a comprehensive diagnostic check for a session.
   *
   * @param sessionId - Session identifier
   * @returns Complete diagnostic report
   */
  diagnose(sessionId: SessionId): DiagnosticReport {
    const timestamp = new Date();
    const recommendations: string[] = [];

    const rotationCheck = this.checkRotation(sessionId);
    const connectionCheck = this.checkConnection(sessionId);
    const rateLimitCheck = this.checkRateLimit(sessionId);

    if (this.config.enableRecommendations) {
      recommendations.push(
        ...this.generateRecommendations(rotationCheck, connectionCheck, rateLimitCheck),
      );
    }

    const overallStatus = this.determineOverallStatus([
      rotationCheck.status,
      connectionCheck.status,
      rateLimitCheck.status,
    ]);

    return {
      sessionId,
      timestamp,
      overallStatus,
      checks: {
        rotationRate: rotationCheck,
        connectionHealth: connectionCheck,
        rateLimitStatus: rateLimitCheck,
      },
      recommendations,
    };
  }

  /**
   * Performs a quick health check without full diagnostics.
   *
   * @param sessionId - Session identifier
   * @returns Overall status
   */
  quickCheck(sessionId: SessionId): DiagnosticStatus {
    const statuses: DiagnosticStatus[] = [];

    if (this.rotationMonitor) {
      const status = this.rotationMonitor.getStatus(sessionId);
      if (status?.status === 'ANOMALY') {
        statuses.push('CRITICAL');
      } else if (status?.status === 'WARNING') {
        statuses.push('WARNING');
      } else {
        statuses.push('OK');
      }
    }

    if (this.connectionTracker) {
      const health = this.connectionTracker.checkHealth(sessionId);
      if (health.status === 'DISCONNECTED') {
        statuses.push('CRITICAL');
      } else if (health.status === 'DEGRADED') {
        statuses.push('WARNING');
      } else {
        statuses.push('OK');
      }
    }

    return this.determineOverallStatus(statuses);
  }

  /**
   * Checks if a session requires immediate attention.
   *
   * @param sessionId - Session identifier
   * @returns true if session has critical issues
   */
  requiresAttention(sessionId: SessionId): boolean {
    return this.quickCheck(sessionId) === 'CRITICAL';
  }

  /**
   * Gets all sessions that require attention.
   *
   * @returns Array of session IDs with critical issues
   */
  getSessionsRequiringAttention(): SessionId[] {
    const sessions: SessionId[] = [];

    if (this.rotationMonitor) {
      const stats = this.rotationMonitor.getAggregateStats();
      if (stats.sessionsWithAnomalies > 0) {
        // Note: Would need to iterate sessions, simplified here
      }
    }

    if (this.connectionTracker) {
      sessions.push(...this.connectionTracker.getSessionsByState('DISCONNECTED'));
      sessions.push(...this.connectionTracker.getSessionsByState('DEGRADED'));
    }

    return [...new Set(sessions)];
  }

  /**
   * Checks rotation health.
   */
  private checkRotation(sessionId: SessionId): CheckResult {
    if (!this.rotationMonitor) {
      return {
        name: 'rotation',
        status: 'OK',
        message: 'Rotation monitor not configured',
      };
    }

    const status: RotationStatus | null = this.rotationMonitor.getStatus(sessionId);

    if (!status) {
      return {
        name: 'rotation',
        status: 'OK',
        message: 'No rotation data available',
      };
    }

    if (status.status === 'ANOMALY') {
      return {
        name: 'rotation',
        status: 'CRITICAL',
        message: `Abnormal rotation rate: ${String(status.rate)}/min (threshold: ${String(status.threshold)})`,
        data: { rate: status.rate, threshold: status.threshold },
      };
    }

    if (status.status === 'WARNING') {
      return {
        name: 'rotation',
        status: 'WARNING',
        message: `Elevated rotation rate: ${String(status.rate)}/min (threshold: ${String(status.threshold)})`,
        data: { rate: status.rate, threshold: status.threshold },
      };
    }

    return {
      name: 'rotation',
      status: 'OK',
      message: `Rotation rate normal: ${String(status.rate)}/min`,
      data: { rate: status.rate },
    };
  }

  /**
   * Checks connection health.
   */
  private checkConnection(sessionId: SessionId): CheckResult {
    if (!this.connectionTracker) {
      return {
        name: 'connection',
        status: 'OK',
        message: 'Connection tracker not configured',
      };
    }

    const health: ConnectionHealth = this.connectionTracker.checkHealth(sessionId);

    if (health.status === 'DISCONNECTED') {
      return {
        name: 'connection',
        status: 'CRITICAL',
        message: `Session disconnected (silent for ${String(Math.round(health.silentMs / 1000))}s)`,
        data: { silentMs: health.silentMs, recommendation: health.recommendation },
      };
    }

    if (health.status === 'DEGRADED') {
      return {
        name: 'connection',
        status: 'WARNING',
        message: `Connection degraded (silent for ${String(Math.round(health.silentMs / 1000))}s)`,
        data: { silentMs: health.silentMs, recommendation: health.recommendation },
      };
    }

    if (health.status === 'RECONNECTING') {
      return {
        name: 'connection',
        status: 'WARNING',
        message: 'Session is reconnecting',
      };
    }

    return {
      name: 'connection',
      status: 'OK',
      message: 'Connection healthy',
      data: { silentMs: health.silentMs },
    };
  }

  /**
   * Checks rate limit status.
   */
  private checkRateLimit(sessionId: SessionId): CheckResult {
    if (!this.rateLimiter) {
      return {
        name: 'rateLimit',
        status: 'OK',
        message: 'Rate limiter not configured',
      };
    }

    const status: RateLimitStatus = this.rateLimiter.canAcquire(sessionId);

    if (!status.allowed) {
      return {
        name: 'rateLimit',
        status: 'WARNING',
        message: `Rate limited (wait ${String(Math.round(status.waitTimeMs))}ms)`,
        data: { waitTimeMs: status.waitTimeMs, tokensRemaining: status.tokensRemaining },
      };
    }

    if (status.tokensRemaining < 3) {
      return {
        name: 'rateLimit',
        status: 'WARNING',
        message: `Low tokens remaining: ${String(status.tokensRemaining)}`,
        data: { tokensRemaining: status.tokensRemaining },
      };
    }

    return {
      name: 'rateLimit',
      status: 'OK',
      message: `Tokens available: ${String(status.tokensRemaining)}`,
      data: { tokensRemaining: status.tokensRemaining },
    };
  }

  /**
   * Generates recommendations based on check results.
   */
  private generateRecommendations(
    rotation: CheckResult,
    connection: CheckResult,
    rateLimit: CheckResult,
  ): string[] {
    const recommendations: string[] = [];

    if (rotation.status === 'CRITICAL') {
      recommendations.push(
        'CRITICAL: Abnormal session rotation detected. This may indicate a compromised session or protocol issue. Consider recreating the session.',
      );
    } else if (rotation.status === 'WARNING') {
      recommendations.push(
        'WARNING: Elevated session rotation. Monitor closely for potential issues.',
      );
    }

    if (connection.status === 'CRITICAL') {
      recommendations.push(
        'CRITICAL: Session appears disconnected. Initiate reconnection procedure.',
      );
    } else if (connection.status === 'WARNING') {
      const data = connection.data as { recommendation?: string } | undefined;
      if (data?.recommendation === 'PING') {
        recommendations.push(
          'WARNING: Connection may be stale. Send a presence update or ping to verify.',
        );
      }
    }

    if (rateLimit.status === 'WARNING') {
      recommendations.push(
        'WARNING: Approaching rate limit. Slow down message sending to avoid WhatsApp restrictions.',
      );
    }

    return recommendations;
  }

  /**
   * Determines overall status from individual statuses.
   */
  private determineOverallStatus(statuses: DiagnosticStatus[]): DiagnosticStatus {
    if (statuses.includes('CRITICAL')) {
      return 'CRITICAL';
    }
    if (statuses.includes('WARNING')) {
      return 'WARNING';
    }
    return 'OK';
  }
}
