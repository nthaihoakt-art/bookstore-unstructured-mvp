'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// src/redis-client.js
// Khởi tạo kết nối Redis cho Bookstore MVP
// Sử dụng ioredis - hỗ trợ TTL, HASH, ZSET, String
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let redisClient = null;
let isConnected = false;

function createClient() {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 2,
    retryStrategy(times) {
      if (times > 3) {
        console.warn('[Redis] Không kết nối được sau 3 lần thử — chạy không có Redis.');
        return null; // dừng retry
      }
      return Math.min(times * 500, 2000);
    },
    lazyConnect: true,
  });

  client.on('connect', () => {
    isConnected = true;
    console.log('[Redis] ✅ Kết nối thành công:', REDIS_URL.replace(/:[^:@]+@/, ':***@'));
  });

  client.on('error', (err) => {
    if (isConnected) {
      console.error('[Redis] ❌ Lỗi kết nối:', err.message);
    }
    isConnected = false;
  });

  client.on('close', () => {
    isConnected = false;
  });

  return client;
}

async function connectRedis() {
  try {
    redisClient = createClient();
    await redisClient.connect();
    return true;
  } catch (err) {
    console.warn('[Redis] Bỏ qua Redis (không kết nối được):', err.message);
    isConnected = false;
    return false;
  }
}

function getClient() {
  return redisClient;
}

function isRedisActive() {
  return isConnected && redisClient !== null && redisClient.status === 'ready';
}

async function ping() {
  if (!isRedisActive()) return false;
  try {
    const result = await redisClient.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

async function getRedisInfo() {
  if (!isRedisActive()) return null;
  try {
    const info = await redisClient.info('memory');
    const keys = await redisClient.dbsize();
    const memMatch = info.match(/used_memory_human:(.+)/);
    const peakMatch = info.match(/used_memory_peak_human:(.+)/);
    return {
      connected: true,
      url: REDIS_URL.replace(/:[^:@]+@/, ':***@'),
      totalKeys: keys,
      usedMemory: memMatch ? memMatch[1].trim() : 'N/A',
      peakMemory: peakMatch ? peakMatch[1].trim() : 'N/A',
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

module.exports = { connectRedis, getClient, isRedisActive, ping, getRedisInfo };
