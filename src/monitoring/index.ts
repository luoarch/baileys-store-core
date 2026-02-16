/**
 * @baileys-store/core - Monitoring
 *
 * Session rotation and connection health monitoring.
 *
 * @since 1.1.0
 */

export { RotationMonitor, DEFAULT_ROTATION_MONITOR_CONFIG } from './rotation-monitor.js';
export type { RotationMonitorConfig, RotationStatus, RotationStats } from './rotation-monitor.js';

export {
  ConnectionHealthTracker,
  DEFAULT_CONNECTION_TRACKER_CONFIG,
} from './connection-tracker.js';
export type {
  ConnectionState,
  ConnectionTrackerConfig,
  ConnectionHealth,
  SessionConnectionData,
} from './connection-tracker.js';
