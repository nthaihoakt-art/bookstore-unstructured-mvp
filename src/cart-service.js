'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// src/cart-service.js
// Quản lý giỏ hàng tạm bằng Redis HASH
// Key: cart:{sessionId}  TTL: 86400s (24 giờ)
// ─────────────────────────────────────────────────────────────────────────────
const { getClient, isRedisActive } = require('./redis-client');

const CART_TTL = 86400; // 24 giờ (giây)
const KEY_PREFIX = 'cart:';

function cartKey(sessionId) {
  return `${KEY_PREFIX}${sessionId}`;
}

/**
 * Lấy toàn bộ giỏ hàng của một session
 * @returns {Array} danh sách items [{bookId, title, price, qty, cover}]
 */
async function getCart(sessionId) {
  if (!isRedisActive()) return { items: [], total: 0, sessionId };
  const client = getClient();
  const key = cartKey(sessionId);
  const raw = await client.hgetall(key);
  if (!raw || Object.keys(raw).length === 0) return { items: [], total: 0, sessionId };

  // raw = { "1:qty": "2", "1:price": "88000", "1:title": "Mắt biếc", "1:cover": "..." }
  const bookIds = new Set();
  for (const field of Object.keys(raw)) {
    const bookId = field.split(':')[0];
    bookIds.add(bookId);
  }

  const items = [];
  for (const bookId of bookIds) {
    const qty = parseInt(raw[`${bookId}:qty`] || '0', 10);
    const price = parseFloat(raw[`${bookId}:price`] || '0');
    if (qty > 0) {
      items.push({
        bookId: parseInt(bookId, 10),
        title: raw[`${bookId}:title`] || '',
        price,
        qty,
        cover: raw[`${bookId}:cover`] || null,
        subtotal: price * qty,
      });
    }
  }

  const total = items.reduce((s, i) => s + i.subtotal, 0);
  return { items, total, sessionId, ttl: await client.ttl(key) };
}

/**
 * Thêm sách vào giỏ hàng. Nếu sách đã có thì tăng số lượng.
 */
async function addToCart(sessionId, book, qty = 1) {
  if (!isRedisActive()) throw new Error('Redis không khả dụng');
  const client = getClient();
  const key = cartKey(sessionId);
  const bookId = String(book.id);

  // Lấy qty hiện tại
  const currentQty = parseInt((await client.hget(key, `${bookId}:qty`)) || '0', 10);
  const newQty = currentQty + qty;

  const pipeline = client.pipeline();
  pipeline.hset(key,
    `${bookId}:qty`, String(newQty),
    `${bookId}:price`, String(book.salePrice || book.sale_price || 0),
    `${bookId}:title`, book.title || '',
    `${bookId}:cover`, book.cover || ''
  );
  pipeline.expire(key, CART_TTL);
  await pipeline.exec();

  return getCart(sessionId);
}

/**
 * Cập nhật số lượng sách trong giỏ. qty=0 => xóa khỏi giỏ.
 */
async function updateCartItem(sessionId, bookId, qty) {
  if (!isRedisActive()) throw new Error('Redis không khả dụng');
  const client = getClient();
  const key = cartKey(sessionId);
  const id = String(bookId);

  if (qty <= 0) {
    // Xóa tất cả field của book này
    const fields = [`${id}:qty`, `${id}:price`, `${id}:title`, `${id}:cover`];
    await client.hdel(key, ...fields);
  } else {
    await client.hset(key, `${id}:qty`, String(qty));
    await client.expire(key, CART_TTL);
  }
  return getCart(sessionId);
}

/**
 * Xóa một sách khỏi giỏ
 */
async function removeFromCart(sessionId, bookId) {
  return updateCartItem(sessionId, bookId, 0);
}

/**
 * Xóa toàn bộ giỏ hàng (sau khi checkout)
 */
async function clearCart(sessionId) {
  if (!isRedisActive()) return;
  const client = getClient();
  await client.del(cartKey(sessionId));
}

/**
 * Lấy số lượng sách trong giỏ (badge counter)
 */
async function getCartCount(sessionId) {
  if (!isRedisActive()) return 0;
  const cart = await getCart(sessionId);
  return cart.items.reduce((s, i) => s + i.qty, 0);
}

module.exports = { getCart, addToCart, updateCartItem, removeFromCart, clearCart, getCartCount };
