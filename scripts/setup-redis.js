'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// scripts/setup-redis.js
// Seed dữ liệu mẫu vào Redis để demo đồ án
// Chạy: node scripts/setup-redis.js
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

async function main() {
  const client = new Redis(REDIS_URL);
  console.log('\n🚀 Bắt đầu seed dữ liệu Redis...\n');

  try {
    await client.ping();
    console.log('✅ Kết nối Redis thành công:', REDIS_URL);
  } catch (err) {
    console.error('❌ Không kết nối được Redis:', err.message);
    console.error('👉 Hãy chạy Redis trước: docker run -d --name bookstore-redis -p 6379:6379 redis:7-alpine');
    process.exit(1);
  }

  // ── 1. Seed Giỏ hàng mẫu ──────────────────────────────────────────────────
  console.log('\n📦 [1/4] Seed giỏ hàng mẫu (cart HASH)...');

  const cart1Key = 'cart:demo-session-001';
  await client.hset(cart1Key,
    '1:qty', '2',
    '1:price', '88000',
    '1:title', 'Mắt biếc',
    '1:cover', '/uploads/mat-biec-cover.jpg',
    '3:qty', '1',
    '3:price', '72000',
    '3:title', 'Tôi thấy hoa vàng trên cỏ xanh',
    '3:cover', '/uploads/hoa-vang-cover.jpg'
  );
  await client.expire(cart1Key, 86400);
  console.log(`   ✓ cart:demo-session-001 — 2 sách, TTL=86400s`);

  const cart2Key = 'cart:demo-session-002';
  await client.hset(cart2Key,
    '2:qty', '1',
    '2:price', '95000',
    '2:title', 'Đắc Nhân Tâm',
    '2:cover', '/uploads/dac-nhan-tam.jpg',
    '5:qty', '3',
    '5:price', '45000',
    '5:title', 'Nhà Giả Kim',
    '5:cover', '/uploads/nha-gia-kim.jpg'
  );
  await client.expire(cart2Key, 86400);
  console.log(`   ✓ cart:demo-session-002 — 2 sách, TTL=86400s`);

  // ── 2. Seed OTP mẫu ───────────────────────────────────────────────────────
  console.log('\n🔑 [2/4] Seed OTP mẫu (STRING)...');
  await client.set('otp:demo@bookstore.local', '123456', 'EX', 300);
  console.log('   ✓ otp:demo@bookstore.local = 123456, TTL=300s');

  // ── 3. Seed Cache sách hot ────────────────────────────────────────────────
  console.log('\n🗄️  [3/4] Seed cache sách bán chạy (STRING)...');
  const hotBooks = [
    { id: 1, code: 'BOOK-001', title: 'Mắt biếc', author: 'Nguyễn Nhật Ánh', salePrice: 88000, stockQuantity: 25 },
    { id: 2, code: 'BOOK-002', title: 'Đắc Nhân Tâm', author: 'Dale Carnegie', salePrice: 95000, stockQuantity: 40 },
    { id: 3, code: 'BOOK-003', title: 'Tôi thấy hoa vàng trên cỏ xanh', author: 'Nguyễn Nhật Ánh', salePrice: 72000, stockQuantity: 15 },
  ];
  await client.set('cache:books:hot', JSON.stringify(hotBooks), 'EX', 3600);
  console.log('   ✓ cache:books:hot — 3 cuốn, TTL=3600s');

  await client.set('cache:stats:revenue', JSON.stringify({ totalRevenue: 15420000, totalOrders: 87, avgOrderValue: 177241 }), 'EX', 1800);
  console.log('   ✓ cache:stats:revenue — thống kê doanh thu, TTL=1800s');

  // ── 4. Seed Leaderboard ───────────────────────────────────────────────────
  console.log('\n🏆 [4/4] Seed Leaderboard sách bán chạy (ZSET)...');
  const month = new Date().toISOString().slice(0, 7);
  const lbKey = `leaderboard:books:${month}`;

  const leaderboardData = [
    ['1:Mắt biếc', 142],
    ['2:Đắc Nhân Tâm', 98],
    ['3:Tôi thấy hoa vàng trên cỏ xanh', 87],
    ['4:Dế Mèn Phiêu Lưu Ký', 65],
    ['5:Nhà Giả Kim', 54],
    ['6:Số Đỏ', 43],
    ['7:Lão Hạc', 38],
    ['8:Chí Phèo', 31],
    ['9:Truyện Kiều', 28],
    ['10:Nam Quốc Sơn Hà', 15],
    ['13:1984', 22],
    ['11:Tô Tâm', 18],
    ['12:Süa Và Mật', 12],
  ];

  for (const [member, score] of leaderboardData) {
    await client.zadd(lbKey, score, member);
  }
  await client.expire(lbKey, 60 * 24 * 3600);
  console.log(`   ✓ leaderboard:books:${month} — top 10 sách, TTL=60 ngày`);

  // Tháng trước
  const lastMonth = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().slice(0, 7);
  const lbKeyLast = `leaderboard:books:${lastMonth}`;
  await client.zadd(lbKeyLast, 210, '1:Mắt biếc');
  await client.zadd(lbKeyLast, 175, '2:Đắc Nhân Tâm');
  await client.zadd(lbKeyLast, 130, '5:Nhà Giả Kim');
  await client.expire(lbKeyLast, 60 * 24 * 3600);
  console.log(`   ✓ leaderboard:books:${lastMonth} — top 3 tháng trước`);

  // ── Thống kê kết quả ──────────────────────────────────────────────────────
  const totalKeys = await client.dbsize();
  const info = await client.info('memory');
  const memMatch = info.match(/used_memory_human:(.+)/);
  const usedMem = memMatch ? memMatch[1].trim() : 'N/A';

  console.log('\n─────────────────────────────────────────────');
  console.log('✅ SEED REDIS HOÀN TẤT');
  console.log(`   Total keys: ${totalKeys}`);
  console.log(`   Memory used: ${usedMem}`);
  console.log('\n📋 Danh sách keys đã tạo:');
  const keys = await client.keys('*');
  for (const k of keys.sort()) {
    const ttl = await client.ttl(k);
    const type = await client.type(k);
    console.log(`   [${type.toUpperCase().padEnd(6)}] ${k}  TTL=${ttl}s`);
  }
  console.log('─────────────────────────────────────────────\n');

  await client.quit();
}

main().catch(err => {
  console.error('❌ Lỗi:', err.message);
  process.exit(1);
});
