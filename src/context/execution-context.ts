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
export function withContext<T>(context: Partial<ExecutionContext>, fn: () => T): T {
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

/**
 * Run function with specific correlation ID
 *
 * @param correlationId - Correlation ID to use
 * @param fn - Function to execute
 * @returns Result of function execution
 *
 * @example
 * ```typescript
 * const result = await withCorrelationId('req-123', async () => {
 *   // All async operations in this function will have correlationId='req-123'
 *   const data = await store.get('session1');
 *   return data;
 * });
 * ```
 */
export function withCorrelationId<T>(correlationId: string, fn: () => T): T {
  return withContext({ correlationId }, fn);
}

/**
 * Set metadata in current context
 *
 * @param metadata - Key-value pairs to add to context
 *
 * @example
 * ```typescript
 * setContextMetadata({
 *   userId: 'user-123',
 *   sessionId: 'session-456'
 * });
 * ```
 */
export function setContextMetadata(metadata: Record<string, string>): void {
  const context = getContext();
  if (context) {
    context.metadata = {
      ...context.metadata,
      ...metadata,
    };
  }
}

/**
 * Get metadata from current context
 *
 * @param key - Metadata key
 * @returns Metadata value or undefined
 *
 * @example
 * ```typescript
 * const userId = getContextMetadata('userId');
 * ```
 */
export function getContextMetadata(key: string): string | undefined {
  const context = getContext();
  return context?.metadata?.[key];
}

/**
 * Check if current context has correlation ID
 *
 * @returns Whether correlation ID is present
 */
export function hasCorrelationId(): boolean {
  return getCorrelationId() !== undefined;
}
