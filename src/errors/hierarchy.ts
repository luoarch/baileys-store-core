/**
 * Error Hierarchy - Centralized error classification system
 * 
 * This module defines the complete error taxonomy for baileys-store-core,
 * including error codes, domains, severity levels, and metadata.
 */

export enum ErrorDomain {
  STORAGE = 'STORAGE',
  ENCRYPTION = 'ENCRYPTION',
  VALIDATION = 'VALIDATION',
  RESILIENCE = 'RESILIENCE',
}

export enum ErrorSeverity {
  RECOVERABLE = 'recoverable',   // Pode tentar retry
  DEGRADED = 'degraded',          // Sistema funciona parcialmente
  CRITICAL = 'critical',           // Falha total do componente
}

export enum ErrorCode {
  // Storage errors (STORAGE domain)
  ERR_STORAGE_REDIS = 'ERR_STORAGE_REDIS',
  ERR_STORAGE_MONGO = 'ERR_STORAGE_MONGO',
  ERR_STORAGE_HYBRID = 'ERR_STORAGE_HYBRID',
  ERR_VERSION_MISMATCH = 'ERR_VERSION_MISMATCH',
  
  // Encryption errors (ENCRYPTION domain)
  ERR_ENCRYPTION_FAILED = 'ERR_ENCRYPTION_FAILED',
  ERR_DECRYPTION_FAILED = 'ERR_DECRYPTION_FAILED',
  ERR_INVALID_KEY = 'ERR_INVALID_KEY',
  ERR_KEY_ROTATION_REQUIRED = 'ERR_KEY_ROTATION_REQUIRED',
  
  // Validation errors (VALIDATION domain)
  ERR_INVALID_CONFIG = 'ERR_INVALID_CONFIG',
  ERR_INVALID_SESSION_ID = 'ERR_INVALID_SESSION_ID',
  
  // Resilience errors (RESILIENCE domain)
  ERR_TIMEOUT = 'ERR_TIMEOUT',
  ERR_CIRCUIT_BREAKER_OPEN = 'ERR_CIRCUIT_BREAKER_OPEN',
  ERR_MAX_RETRIES_EXCEEDED = 'ERR_MAX_RETRIES_EXCEEDED',
}

export interface ErrorMetadata {
  code: ErrorCode;
  domain: ErrorDomain;
  severity: ErrorSeverity;
  retryable: boolean;
  statusCode?: number;
  documentationUrl: string;
}

/**
 * Get error metadata for a given error code
 */
export function getErrorMetadata(code: ErrorCode): ErrorMetadata {
  const baseUrl = 'https://github.com/luoarch/baileys-store-core/blob/main/docs/ERROR_CODES.md';
  
  const metadataMap: Record<ErrorCode, Partial<ErrorMetadata>> = {
    // Storage errors
    [ErrorCode.ERR_STORAGE_REDIS]: {
      domain: ErrorDomain.STORAGE,
      severity: ErrorSeverity.DEGRADED,
      retryable: true,
      statusCode: 503,
    },
    [ErrorCode.ERR_STORAGE_MONGO]: {
      domain: ErrorDomain.STORAGE,
      severity: ErrorSeverity.CRITICAL,
      retryable: true,
      statusCode: 503,
    },
    [ErrorCode.ERR_STORAGE_HYBRID]: {
      domain: ErrorDomain.STORAGE,
      severity: ErrorSeverity.DEGRADED,
      retryable: true,
      statusCode: 503,
    },
    [ErrorCode.ERR_VERSION_MISMATCH]: {
      domain: ErrorDomain.STORAGE,
      severity: ErrorSeverity.CRITICAL,
      retryable: false,
      statusCode: 409,
    },
    
    // Encryption errors
    [ErrorCode.ERR_ENCRYPTION_FAILED]: {
      domain: ErrorDomain.ENCRYPTION,
      severity: ErrorSeverity.CRITICAL,
      retryable: false,
      statusCode: 500,
    },
    [ErrorCode.ERR_DECRYPTION_FAILED]: {
      domain: ErrorDomain.ENCRYPTION,
      severity: ErrorSeverity.CRITICAL,
      retryable: false,
      statusCode: 500,
    },
    [ErrorCode.ERR_INVALID_KEY]: {
      domain: ErrorDomain.ENCRYPTION,
      severity: ErrorSeverity.CRITICAL,
      retryable: false,
      statusCode: 401,
    },
    [ErrorCode.ERR_KEY_ROTATION_REQUIRED]: {
      domain: ErrorDomain.ENCRYPTION,
      severity: ErrorSeverity.DEGRADED,
      retryable: false,
      statusCode: 403,
    },
    
    // Validation errors
    [ErrorCode.ERR_INVALID_CONFIG]: {
      domain: ErrorDomain.VALIDATION,
      severity: ErrorSeverity.CRITICAL,
      retryable: false,
      statusCode: 400,
    },
    [ErrorCode.ERR_INVALID_SESSION_ID]: {
      domain: ErrorDomain.VALIDATION,
      severity: ErrorSeverity.RECOVERABLE,
      retryable: false,
      statusCode: 400,
    },
    
    // Resilience errors
    [ErrorCode.ERR_TIMEOUT]: {
      domain: ErrorDomain.RESILIENCE,
      severity: ErrorSeverity.RECOVERABLE,
      retryable: true,
      statusCode: 408,
    },
    [ErrorCode.ERR_CIRCUIT_BREAKER_OPEN]: {
      domain: ErrorDomain.RESILIENCE,
      severity: ErrorSeverity.DEGRADED,
      retryable: true,
      statusCode: 503,
    },
    [ErrorCode.ERR_MAX_RETRIES_EXCEEDED]: {
      domain: ErrorDomain.RESILIENCE,
      severity: ErrorSeverity.CRITICAL,
      retryable: false,
      statusCode: 503,
    },
  };
  
  const partial = metadataMap[code];
  if (!partial) {
    throw new Error(`No metadata defined for error code: ${code}`);
  }
  
  return {
    code,
    ...partial,
    documentationUrl: `${baseUrl}#${code.toLowerCase()}`,
  } as ErrorMetadata;
}

/**
 * Check if an error code is retryable
 */
export function isRetryable(code: ErrorCode): boolean {
  return getErrorMetadata(code).retryable;
}

/**
 * Get recommended retry delay in milliseconds for a given error code
 */
export function getRetryDelay(code: ErrorCode, attempt: number, baseDelayMs = 100): number {
  if (!isRetryable(code)) {
    return 0;
  }
  
  // Exponential backoff with jitter
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
  return Math.floor(exponentialDelay + jitter);
}
