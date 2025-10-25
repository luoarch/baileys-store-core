// MongoDB initialization script for baileys-store
// Creates database, collections, and indexes

const DB_NAME = 'whatsapp';
const COLLECTION = 'auth';

// Switch to the target database
db = db.getSiblingDB(DB_NAME);

// Create the auth collection
db.createCollection(COLLECTION);

// Create indexes for optimal performance
print('Creating indexes for ' + COLLECTION + ' collection...');

// TTL index on expiresAt
db[COLLECTION].createIndex(
  { expiresAt: 1 },
  {
    name: 'expiresAt_ttl_idx',
    expireAfterSeconds: 0,
  },
);

// Index on updatedAt for analytics queries
db[COLLECTION].createIndex({ updatedAt: -1 }, { name: 'updatedAt_idx' });

// Index on fencingToken (sparse, for active sessions)
db[COLLECTION].createIndex(
  { fencingToken: 1 },
  {
    name: 'fencingToken_idx',
    sparse: true,
  },
);

// Index on version for optimistic locking
db[COLLECTION].createIndex(
  { version: 1 },
  {
    name: 'version_idx',
    sparse: true,
  },
);

// Create a sample document for testing
db[COLLECTION].insertOne({
  _id: 'test-session',
  version: 1,
  creds: 'sample-credentials',
  keys: {},
  fencingToken: 1,
  updatedAt: new Date(),
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
});

print('MongoDB initialization completed successfully!');
print('Database: ' + DB_NAME);
print('Collection: ' + COLLECTION);
print('Indexes created: expiresAt_ttl_idx, updatedAt_idx, fencingToken_idx, version_idx');
print('Sample document inserted: test-session');
