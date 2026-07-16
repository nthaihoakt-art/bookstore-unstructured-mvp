'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// src/cache-service.js
// Cache dữ liệu truy cập nhanh + Leaderboard sách bán chạy
// Cache:       STRING + TTL
// Leaderboard: ZSET (Sorted Set) theo tháng
// ─────────────────────────────────────────────────────────────────────────────
const { getClient, isRedisActive } = require('./redis-client');

// TTL constants (giây)
const TTL = {
  HOT_BOOKS: 3600,    // 1 giờ
  SEARCH: 300,        // 5 phút
  BOOK_DETAIL: 600,   // 10 phút
  STATS: 1800,        // 30 phút
};

// ─── CACHE HELPERS ─────────────────────────────────────────────

function cacheKey(...parts) {
  return `cache:${parts.join(':')}`;
}

/**
 * Lấy giá trị từ cache. Trả về null nếu miss hoặc Redis không khả dụng.
 */
async function cacheGet(key) {
  if (!isRedisActive()) return null;
  try {
    const val = await getClient().get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

/**
 * Lưu giá trị vào cache với TTL.
 */
async function cacheSet(key, value, ttl = TTL.HOT_BOOKS) {
  if (!isRedisActive()) return;
  try {
    await getClient().set(key, JSON.stringify(value), 'EX', ttl);
  } catch (err) {
    console.warn('[Cache] Lỗi ghi cache:', err.message);
  }
}

/**
 * Xóa cache theo pattern (dùng khi dữ liệu thay đổi)
 */
async function cacheInvalidate(pattern) {
  if (!isRedisActive()) return;
  try {
    const client = getClient();
    const keys = await client.keys(pattern);
    if (keys.length > 0) await client.del(...keys);
  } catch (err) {
    console.warn('[Cache] Lỗi xóa cache:', err.message);
  }
}

// ─── LEADERBOARD (SORTED SET) ──────────────────────────────────

function leaderboardKey(month) {
  // month: 'YYYY-MM' hoặc tháng hiện tại
  const m = month || new Date().toISOString().slice(0, 7);
  return `leaderboard:books:${m}`;
}

/**
 * Cộng điểm bán cho sách trong Leaderboard (gọi khi tạo đơn hàng)
 * @param {Array} items - [{bookId, bookTitle, quantity}]
 * @param {string} month - 'YYYY-MM'
 */
async function incrementLeaderboard(items, month) {
  if (!isRedisActive() || !items || items.length === 0) return;
  try {
    const client = getClient();
    const key = leaderboardKey(month);
    const pipeline = client.pipeline();

    for (const item of items) {
      const member = `${item.bookId}:${(item.bookTitle || '').replace(/:/g, '_')}`;
      pipeline.zincrby(key, item.quantity, member);
    }
    // Leaderboard tháng hiện tại lưu 60 ngày
    pipeline.expire(key, 60 * 24 * 3600);
    await pipeline.exec();
  } catch (err) {
    console.warn('[Leaderboard] Lỗi cập nhật:', err.message);
  }
}

/**
 * Lấy top N sách bán chạy theo tháng (mặc định tháng hiện tại)
 * @returns {Array} [{rank, bookId, bookTitle, totalSold}]
 */
async function getLeaderboard(month, topN = 10) {
  if (!isRedisActive()) return [];
  try {
    const client = getClient();
    const key = leaderboardKey(month);
    // ZREVRANGEBYSCORE để lấy cao nhất trước
    const results = await client.zrevrangebyscore(key, '+inf', '-inf', 'WITHSCORES', 'LIMIT', 0, topN);

    const leaderboard = [];
    for (let i = 0; i < results.length; i += 2) {
      const member = results[i];
      const score = parseInt(results[i + 1], 10);
      const colonIdx = member.indexOf(':');
      const bookId = parseInt(member.substring(0, colonIdx), 10);
      const bookTitle = member.substring(colonIdx + 1).replace(/_/g, ':');
      leaderboard.push({
        rank: Math.floor(i / 2) + 1,
        bookId,
        bookTitle,
        totalSold: score,
      });
    }
    return leaderboard;
  } catch (err) {
    console.warn('[Leaderboard] Lỗi đọc:', err.message);
    return [];
  }
}

/**
 * Lấy rank của một cuốn sách trong Leaderboard tháng
 */
async function getBookRank(bookId, bookTitle, month) {
  if (!isRedisActive()) return null;
  try {
    const client = getClient();
    const key = leaderboardKey(month);
    const member = `${bookId}:${(bookTitle || '').replace(/:/g, '_')}`;
    const rank = await client.zrevrank(key, member);
    const score = await client.zscore(key, member);
    return rank !== null ? { rank: rank + 1, totalSold: parseInt(score || '0', 10) } : null;
  } catch {
    return null;
  }
}

/**
 * Lấy danh sách các tháng có dữ liệu leaderboard
 */
async function getLeaderboardMonths() {
  if (!isRedisActive()) return [];
  try {
    const keys = await getClient().keys('leaderboard:books:*');
    return keys.map(k => k.replace('leaderboard:books:', '')).sort().reverse();
  } catch {
    return [];
  }
}

module.exports = {
  cacheGet,
  cacheSet,
  cacheInvalidate,
  cacheKey,
  TTL,
  incrementLeaderboard,
  getLeaderboard,
  getBookRank,
  getLeaderboardMonths,
};
