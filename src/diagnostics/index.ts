/**
 * @baileys-store/core - Diagnostics
 *
 * Unified diagnostic system for session health monitoring.
 *
 * @since 1.1.0
 */

export { DiagnosticEngine, DEFAULT_DIAGNOSTIC_ENGINE_CONFIG } from './diagnostic-engine.js';
export type {
  DiagnosticStatus,
  CheckResult,
  DiagnosticReport,
  DiagnosticEngineConfig,
} from './diagnostic-engine.js';
