# Test Scripts - @baileys-store/core

Comprehensive test scripts to validate all storage adapters with real WhatsApp connections.

## Prerequisites

1. **Build the library**:

   ```bash
   yarn build
   ```

2. **Start required services**:

   For Redis test:

   ```bash
   redis-server
   ```

   For MongoDB test:

   ```bash
   mongod --dbpath /path/to/data
   ```

   For Hybrid test (both):

   ```bash
   redis-server
   mongod --dbpath /path/to/data
   ```

3. **Optional - Set encryption key**:
   ```bash
   export MASTER_ENCRYPTION_KEY="your-32-byte-encryption-key-here"
   ```

## Running Tests

### Test 1: Redis Adapter

```bash
yarn tsx test-scripts/test-redis-detailed.ts
```

**What it tests**:

- ✅ Redis connection
- ✅ Authentication state storage
- ✅ AES-256-GCM encryption
- ✅ Snappy compression
- ✅ TTL management
- ✅ QR code generation
- ✅ Connection persistence
- ✅ Credentials auto-save

**Expected output**:

1. Initialization logs
2. QR code displayed in terminal
3. Scan QR with WhatsApp
4. Connection success message
5. Credentials saved to Redis

**Verify**:

```bash
redis-cli KEYS "baileys:auth:*"
redis-cli GET "baileys:auth:test-redis-session:meta"
```

### Test 2: MongoDB Adapter

```bash
yarn tsx test-scripts/test-mongodb-detailed.ts
```

**What it tests**:

- ✅ MongoDB connection
- ✅ Document storage
- ✅ AES-256-GCM encryption
- ✅ Snappy compression
- ✅ TTL indexes
- ✅ Optimistic locking
- ✅ QR code generation
- ✅ Connection persistence

**Expected output**:

1. Initialization logs
2. QR code displayed
3. Connection success
4. Data saved to MongoDB

**Verify**:

```bash
mongosh baileys_test
db.auth_sessions.find().pretty()
```

### Test 3: Hybrid Adapter (Redis + MongoDB)

```bash
yarn tsx test-scripts/test-hybrid-detailed.ts
```

**What it tests**:

- ✅ Redis hot cache
- ✅ MongoDB cold storage
- ✅ Read-through caching
- ✅ Write-behind pattern (direct mode)
- ✅ Dual encryption
- ✅ Data synchronization
- ✅ Failover handling
- ✅ QR code generation

**Expected output**:

1. Both Redis and MongoDB connections
2. QR code displayed
3. Connection success
4. Data written to both stores

**Verify both stores**:

```bash
# Redis
redis-cli KEYS "baileys:auth:*"

# MongoDB
mongosh baileys_test --eval "db.auth_sessions.find().pretty()"
```

## Test Results Interpretation

### ✅ Success Indicators

1. **QR Code Display**: QR code appears in terminal
2. **Connection Open**: `✅ Connection established!` message
3. **Credentials Saved**: `✅ Credentials saved successfully` after each update
4. **No Errors**: No red error messages in console
5. **Data Persistence**: Data visible in Redis/MongoDB

### ❌ Common Issues

#### Issue: Redis connection refused

```
💡 Solution:
  1. Start Redis: redis-server
  2. Check port: redis-cli ping
  3. Verify config: redis-cli INFO server
```

#### Issue: MongoDB connection failed

```
💡 Solution:
  1. Start MongoDB: mongod
  2. Check connection: mongosh
  3. Verify port 27017 is open
```

#### Issue: Encryption key missing

```
💡 Solution:
  Export key: export MASTER_ENCRYPTION_KEY="..."
  Or use default test key (automatic)
```

#### Issue: QR code not appearing

```
💡 Solution:
  1. Check terminal supports UTF-8
  2. Verify @whiskeysockets/baileys is installed
  3. Check qrcode-terminal is installed
```

## Advanced Testing

### Test with Custom Configuration

Create your own test script:

```typescript
import { useHybridAuthState } from '@baileys-store/core/hybrid';

const { state, saveCreds } = await useHybridAuthState({
  hybrid: {
    redisUrl: 'redis://custom-host:6379',
    mongoUrl: 'mongodb://custom-host:27017',
    mongoDatabase: 'my_database',
    mongoCollection: 'my_collection',
    enableWriteBehind: false,
    ttl: {
      session: 86400 * 7, // 7 days
      keys: 86400, // 1 day
    },
    security: {
      enableEncryption: true,
      enableCompression: true,
      keyRotationDays: 30,
    },
    masterKey: 'your-secure-key-here',
  },
  sessionId: 'custom-session-id',
});
```

### Performance Testing

Monitor performance metrics:

```bash
# Redis memory usage
redis-cli INFO memory

# MongoDB collection stats
mongosh baileys_test --eval "db.auth_sessions.stats()"

# Document size
mongosh baileys_test --eval "db.auth_sessions.find().forEach(d => print(Object.bsonsize(d)))"
```

### Load Testing

Test multiple concurrent sessions:

```typescript
// Create multiple sessions simultaneously
const sessions = ['session-1', 'session-2', 'session-3'];
const promises = sessions.map((id) =>
  useHybridAuthState({
    hybrid: {
      /* config */
    },
    sessionId: id,
  }),
);

await Promise.all(promises);
```

## Cleanup

After testing, clean up test data:

```bash
# Redis
redis-cli FLUSHDB

# MongoDB
mongosh baileys_test --eval "db.auth_sessions.deleteMany({})"
```

## Troubleshooting

### Enable Debug Logging

Set environment variable:

```bash
export DEBUG=baileys:*
yarn tsx test-scripts/test-hybrid-detailed.ts
```

### Check Service Health

```bash
# Redis
redis-cli ping
redis-cli INFO server

# MongoDB
mongosh --eval "db.adminCommand('ping')"
mongosh --eval "db.runCommand({serverStatus: 1})"
```

### Verify Encryption

Check that stored data is encrypted:

```bash
# Redis - should see encrypted binary data
redis-cli --raw GET "baileys:auth:test-session:creds"

# MongoDB - should see encrypted BinData
mongosh baileys_test --eval "db.auth_sessions.findOne()"
```

## Next Steps

After successful validation:

1. ✅ All adapters working correctly
2. ✅ Encryption and compression verified
3. ✅ Data persistence confirmed
4. ✅ Ready for production use

Now you can:

- Integrate into your application
- Configure production credentials
- Enable queue integration (BullMQ/Kafka)
- Set up monitoring and alerts
- Deploy to production environment
