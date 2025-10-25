#!/usr/bin/env tsx

// Load .env file
import { config } from 'dotenv';
config();

import { MongoClient } from 'mongodb';
import Redis from 'ioredis';

console.log(`
================================================================================
🧹 Database Cleanup Script
================================================================================

This script will clean all test data from Redis and MongoDB
================================================================================
`);

async function cleanupDatabases() {
  let mongoClient: MongoClient | null = null;
  let redisClient: Redis | null = null;

  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    mongoClient = new MongoClient(process.env.MONGO_URL || 'mongodb://localhost:27017');
    await mongoClient.connect();

    const db = mongoClient.db('baileys_test');
    const collection = db.collection('auth_sessions');

    // Clear all documents
    const mongoResult = await collection.deleteMany({});
    console.log(`✅ MongoDB: Deleted ${mongoResult.deletedCount} documents`);

    // Connect to Redis
    console.log('🔌 Connecting to Redis...');
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

    // Get all keys matching our pattern
    const keys = await redisClient.keys('*qr-test-session*');
    if (keys.length > 0) {
      await redisClient.del(...keys);
      console.log(`✅ Redis: Deleted ${keys.length} keys`);
    } else {
      console.log('✅ Redis: No keys to delete');
    }

    console.log('\n🎉 Database cleanup completed successfully!');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  } finally {
    // Close connections
    if (mongoClient) {
      await mongoClient.close();
      console.log('🔌 MongoDB connection closed');
    }
    if (redisClient) {
      await redisClient.quit();
      console.log('🔌 Redis connection closed');
    }
  }
}

cleanupDatabases();
