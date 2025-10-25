import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'redis/index': 'src/redis/index.ts',
    'mongodb/index': 'src/mongodb/index.ts',
    'hybrid/index': 'src/hybrid/index.ts',
    'types/index': 'src/types/index.ts',
    'storage/index': 'src/storage/index.ts',
    'crypto/index': 'src/crypto/index.ts',
    'metrics/index': 'src/metrics/index.ts',
  },
  format: ['esm', 'cjs'], // ✅ Dual package
  dts: {
    resolve: true,
  },
  sourcemap: true,
  clean: true,
  splitting: false,
  minify: true, // ✅ Reduz 30-40%
  treeshake: true,
  target: 'node20',
  outDir: 'dist',
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
      dts: format === 'cjs' ? '.d.cts' : '.d.ts', // ✅ Types para CJS
    };
  },
  external: [
    '@whiskeysockets/baileys',
    'ioredis',
    'mongodb',
    'tweetnacl',
    '@napi-rs/snappy',
    'prom-client',
    'zod',
  ],
});
