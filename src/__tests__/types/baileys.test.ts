/**
 * @baileys-store/core - Type Guards Tests
 *
 * Test type validation functions for Baileys data structures
 */

import { describe, it, expect } from 'vitest';
import {
  isValidBuffer,
  isValidKeyPair,
  isValidAuthCreds,
  assertBufferTypes,
  type TypedKeyPair,
  type TypedAuthenticationCreds,
} from '../../types/baileys.js';

describe('Type Guards', () => {
  describe('isValidBuffer', () => {
    it('should return true for valid Buffer', () => {
      const buffer = Buffer.from('test');
      expect(isValidBuffer(buffer)).toBe(true);
    });

    it('should return false for Buffer-like object', () => {
      const bufferLike = { type: 'Buffer', data: [1, 2, 3] };
      expect(isValidBuffer(bufferLike)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidBuffer(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidBuffer(undefined)).toBe(false);
    });

    it('should return false for string', () => {
      expect(isValidBuffer('test')).toBe(false);
    });

    it('should return false for array', () => {
      expect(isValidBuffer([1, 2, 3])).toBe(false);
    });

    it('should return false for plain object', () => {
      expect(isValidBuffer({})).toBe(false);
    });
  });

  describe('isValidKeyPair', () => {
    it('should return true for valid KeyPair', () => {
      const keyPair: TypedKeyPair = {
        private: Buffer.from('private-key'),
        public: Buffer.from('public-key'),
      };
      expect(isValidKeyPair(keyPair)).toBe(true);
    });

    it('should return false for KeyPair with Buffer-like objects', () => {
      const keyPair = {
        private: { type: 'Buffer', data: [1, 2, 3] },
        public: { type: 'Buffer', data: [4, 5, 6] },
      };
      expect(isValidKeyPair(keyPair)).toBe(false);
    });

    it('should return false for incomplete KeyPair (missing public)', () => {
      const keyPair = {
        private: Buffer.from('private-key'),
      };
      expect(isValidKeyPair(keyPair)).toBe(false);
    });

    it('should return false for incomplete KeyPair (missing private)', () => {
      const keyPair = {
        public: Buffer.from('public-key'),
      };
      expect(isValidKeyPair(keyPair)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidKeyPair(null)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(isValidKeyPair('not-a-keypair')).toBe(false);
    });
  });

  describe('isValidAuthCreds', () => {
    it('should return true for valid AuthenticationCreds', () => {
      const creds: TypedAuthenticationCreds = {
        noiseKey: {
          private: Buffer.from('noise-private'),
          public: Buffer.from('noise-public'),
        },
        pairingEphemeralKeyPair: {
          private: Buffer.from('pairing-private'),
          public: Buffer.from('pairing-public'),
        },
        signedIdentityKey: {
          private: Buffer.from('identity-private'),
          public: Buffer.from('identity-public'),
        },
        signedPreKey: {
          keyId: 1,
          keyPair: {
            private: Buffer.from('prekey-private'),
            public: Buffer.from('prekey-public'),
          },
          signature: Buffer.from('signature'),
        },
        registrationId: 12345,
        advSecretKey: 'adv-secret',
        processedHistoryMessages: [],
        nextPreKeyId: 1,
        firstUnuploadedPreKeyId: 1,
        accountSyncCounter: 0,
        accountSettings: {
          unarchiveChats: false,
        },
        platform: 'web',
        lastAccountSyncTimestamp: Date.now(),
        myAppStateKeyId: 'key-id',
      } as any;

      expect(isValidAuthCreds(creds)).toBe(true);
    });

    it('should return false for creds with Buffer-like noiseKey', () => {
      const creds = {
        noiseKey: {
          private: { type: 'Buffer', data: [1, 2, 3] },
          public: Buffer.from('noise-public'),
        },
        pairingEphemeralKeyPair: {
          private: Buffer.from('pairing-private'),
          public: Buffer.from('pairing-public'),
        },
        signedIdentityKey: {
          private: Buffer.from('identity-private'),
          public: Buffer.from('identity-public'),
        },
        signedPreKey: {
          keyId: 1,
          keyPair: {
            private: Buffer.from('prekey-private'),
            public: Buffer.from('prekey-public'),
          },
          signature: Buffer.from('signature'),
        },
      };

      expect(isValidAuthCreds(creds)).toBe(false);
    });

    it('should return false for creds with invalid signedPreKey signature', () => {
      const creds = {
        noiseKey: {
          private: Buffer.from('noise-private'),
          public: Buffer.from('noise-public'),
        },
        pairingEphemeralKeyPair: {
          private: Buffer.from('pairing-private'),
          public: Buffer.from('pairing-public'),
        },
        signedIdentityKey: {
          private: Buffer.from('identity-private'),
          public: Buffer.from('identity-public'),
        },
        signedPreKey: {
          keyId: 1,
          keyPair: {
            private: Buffer.from('prekey-private'),
            public: Buffer.from('prekey-public'),
          },
          signature: { type: 'Buffer', data: [1, 2, 3] },
        },
      };

      expect(isValidAuthCreds(creds)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isValidAuthCreds(null)).toBe(false);
    });

    it('should return false for incomplete creds', () => {
      const creds = {
        noiseKey: {
          private: Buffer.from('noise-private'),
          public: Buffer.from('noise-public'),
        },
      };

      expect(isValidAuthCreds(creds)).toBe(false);
    });
  });

  describe('assertBufferTypes', () => {
    it('should not throw for valid Buffer structures', () => {
      const obj = {
        key: Buffer.from('test'),
        nested: {
          buffer: Buffer.from('nested'),
        },
      };

      expect(() => {
        assertBufferTypes(obj, 'test');
      }).not.toThrow();
    });

    it('should throw for Buffer-like objects', () => {
      const obj = {
        key: { type: 'Buffer', data: [1, 2, 3] },
      };

      expect(() => {
        assertBufferTypes(obj, 'test');
      }).toThrow('Found unconverted Buffer-like object at test.key');
    });

    it('should throw for nested Buffer-like objects', () => {
      const obj = {
        nested: {
          deep: {
            buffer: { type: 'Buffer', data: [1, 2, 3] },
          },
        },
      };

      expect(() => {
        assertBufferTypes(obj, 'root');
      }).toThrow('Found unconverted Buffer-like object at root.nested.deep.buffer');
    });

    it('should not throw for null', () => {
      expect(() => {
        assertBufferTypes(null, 'test');
      }).not.toThrow();
    });

    it('should not throw for undefined', () => {
      expect(() => {
        assertBufferTypes(undefined, 'test');
      }).not.toThrow();
    });

    it('should not throw for arrays with Buffers', () => {
      const obj = {
        buffers: [Buffer.from('test1'), Buffer.from('test2')],
      };

      expect(() => {
        assertBufferTypes(obj, 'test');
      }).not.toThrow();
    });

    it('should throw for arrays with Buffer-like objects', () => {
      const obj = {
        buffers: [{ type: 'Buffer', data: [1, 2, 3] }],
      };

      expect(() => {
        assertBufferTypes(obj, 'test');
      }).toThrow();
    });
  });
});
