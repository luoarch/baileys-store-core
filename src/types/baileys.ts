/**
 * @baileys-store/core - Baileys Type Safety Layer
 *
 * Strong typing for Baileys v7.0+ authentication state
 * Ensures 100% type safety across the entire auth pipeline
 */

import type { AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys';

/**
 * Type-safe key pair structure
 * Ensures private and public keys are real Buffers
 */
export interface TypedKeyPair {
  private: Buffer;
  public: Buffer;
}

/**
 * Type-safe authentication credentials
 * Uses AuthenticationCreds as base without extending to avoid conflicts
 */
export type TypedAuthenticationCreds = Omit<
  AuthenticationCreds,
  'noiseKey' | 'pairingEphemeralKeyPair' | 'signedIdentityKey' | 'signedPreKey'
> & {
  // Override with strict Buffer types
  noiseKey: TypedKeyPair;
  pairingEphemeralKeyPair: TypedKeyPair;
  signedIdentityKey: TypedKeyPair;
  signedPreKey: {
    keyId: number;
    keyPair: TypedKeyPair;
    signature: Buffer;
  };
};

/**
 * Type-safe signal keys storage
 * Maps signal key types to their respective data structures
 */
export interface TypedSignalKeyStore {
  'pre-key': Record<
    string,
    {
      keyId: number;
      keyPair: {
        private: Buffer;
        public: Buffer;
      };
    }
  >;
  session: Record<
    string,
    {
      registrationId: number;
      currentRatchet: {
        ephemeralKeyPair: {
          pubKey: Buffer;
          privKey: Buffer;
        };
        lastRemoteEphemeralKey: Buffer;
        previousCounter: number;
        rootKey: Buffer;
      };
      indexInfo: {
        baseKey: Buffer;
        baseKeyType: number;
        closed: number;
        used: number;
        created: number;
        remoteIdentityKey: Buffer;
      };
      oldRatchetList: {
        added: number;
        ephemeralKey: Buffer;
      }[];
    }
  >;
  'sender-key': Record<
    string,
    Record<
      string,
      {
        chainKey: Buffer;
        iteration: number;
        messageKeys: {
          iteration: number;
          seed: Buffer;
        }[];
      }
    >
  >;
  'app-state-sync-key': Record<
    string,
    {
      keyData: Buffer;
      fingerprint: {
        rawId: number;
        currentIndex: number;
        deviceIndexes: number[];
      };
      timestamp: number;
    }
  >;
  'app-state-sync-version': Record<
    string,
    {
      version: number;
      hash: Buffer;
      indexValueMap: Record<
        string,
        {
          valueMac: Buffer;
        }
      >;
    }
  >;
  'sender-key-memory': Record<string, Buffer>;
}

/**
 * Type guard to validate Buffer objects
 */
export function isValidBuffer(value: unknown): value is Buffer {
  return Buffer.isBuffer(value);
}

/**
 * Type guard to validate key pair objects
 */
export function isValidKeyPair(value: unknown): value is TypedKeyPair {
  if (typeof value !== 'object' || value === null) return false;

  const keyPair = value as Record<string, unknown>;
  return (
    'private' in keyPair &&
    'public' in keyPair &&
    isValidBuffer(keyPair.private) &&
    isValidBuffer(keyPair.public)
  );
}

/**
 * Type guard to validate authentication credentials
 */
export function isValidAuthCreds(value: unknown): value is TypedAuthenticationCreds {
  if (typeof value !== 'object' || value === null) return false;

  const creds = value as Record<string, unknown>;

  // Check required fields
  if (!isValidKeyPair(creds.noiseKey)) return false;
  if (!isValidKeyPair(creds.signedIdentityKey)) return false;
  if (typeof creds.advSecretKey !== 'string') return false;

  // Check signedPreKey structure
  const signedPreKey = creds.signedPreKey as Record<string, unknown>;
  if (
    typeof signedPreKey.keyId !== 'number' ||
    !isValidKeyPair(signedPreKey.keyPair) ||
    !isValidBuffer(signedPreKey.signature)
  ) {
    return false;
  }

  // Check pairingEphemeralKeyPair (required in Baileys v7+)
  if (!isValidKeyPair(creds.pairingEphemeralKeyPair)) return false;

  return true;
}

/**
 * Deep type assertion for nested Buffer objects
 * RC.6 Fix: Ensures all Buffers are real Buffer instances
 */
export function assertBufferTypes(obj: unknown, path = 'root'): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'object') {
    // Check if it's a Buffer-like object that wasn't converted
    if ('type' in obj && (obj as Record<string, unknown>).type === 'Buffer' && 'data' in obj) {
      throw new TypeError(
        `Found unconverted Buffer-like object at ${path}. ` +
          `This indicates a serialization bug in the codec layer.`,
      );
    }

    // Recursively check nested objects
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        assertBufferTypes(item, `${path}[${String(index)}]`);
      });
    } else {
      for (const [key, value] of Object.entries(obj)) {
        assertBufferTypes(value, `${path}.${key}`);
      }
    }
  }
}

/**
 * Type-safe signal data type mapping
 * Ensures compile-time safety for all signal operations
 */
export type StrictSignalDataTypeMap = {
  [K in keyof SignalDataTypeMap]: SignalDataTypeMap[K];
};

/**
 * Export Baileys types for convenience
 */
export type { AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys';
