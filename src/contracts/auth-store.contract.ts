/**
 * Contract Schema - AuthStore Interface Boundary
 *
 * Define a forma canonica dos dados que cruzam a fronteira do AuthStore.
 * Qualquer mudanca aqui DEVE ser documentada em CHANGELOG.md.
 */
import { z } from 'zod';

// Versioned wrapper contract
export const VersionedResultSchema = z.object({
  version: z.number().int().nonnegative(),
  updatedAt: z.date(),
  success: z.boolean(),
});

// Error response contract (para validar que erros seguem o padrao)
export const StoreErrorSchema = z.object({
  name: z.enum(['VersionMismatchError', 'StorageError', 'TimeoutError', 'EncryptionError']),
  message: z.string(),
});

// Contract version (bump on breaking changes)
export const CONTRACT_VERSION = '1.0.0';

// Inferred types
export type VersionedResult = z.infer<typeof VersionedResultSchema>;
export type StoreError = z.infer<typeof StoreErrorSchema>;
