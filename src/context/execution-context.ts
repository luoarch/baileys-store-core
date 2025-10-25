/**
 * Execution Context - Context propagation using AsyncLocalStorage
 * 
 * Provides automatic context propagation for:
 * - Correlation IDs
 * - Request IDs
 * - User IDs
 * - Session IDs
 * 
 * Ensures context is available across async boundaries.
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface ExecutionContext {
  correlationId: string;
  requestId: string;
  userId?: string;
  sessionId?: string;
  startTime: number;
  environment: 'development' | 'production' | 'test';
  metadata?: Record<string, string>;
}

export const executionContext = new AsyncLocalStorage<ExecutionContext>();

/**
 * Get current execution context
 */
export function getContext(): ExecutionContext | undefined {
  return executionContext.getStore();
}

/**
 * Run function with execution context
 */
export function withContext<T>(
  context: Partial<ExecutionContext>,
  fn: () => T
): T {
  const fullContext: ExecutionContext = {
    correlationId: context.correlationId ?? randomUUID(),
    requestId: context.requestId ?? generateRequestId(),
    startTime: Date.now(),
    environment: context.environment ?? 'production',
    ...context,
  };
  
  return executionContext.run(fullContext, fn);
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2);
  return timestamp.toString() + '-' + random;
}

/**
 * Get correlation ID from current context
 */
export function getCorrelationId(): string | undefined {
  const context = getContext();
  return context?.correlationId;
}

/**
 * Get request ID from current context
 */
export function getRequestId(): string | undefined {
  const context = getContext();
  return context?.requestId;
}

/**
 * Get operation duration in milliseconds
 */
export function getOperationDuration(): number | undefined {
  const context = getContext();
  if (context) {
    return Date.now() - context.startTime;
  }
  return undefined;
}
