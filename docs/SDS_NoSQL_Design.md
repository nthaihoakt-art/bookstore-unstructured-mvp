# SDS — Thiết kế Hệ thống NoSQL
## Dự án: Bookstore Unstructured MVP

---

## 1. Thiết kế Redis Key Schema

### 1.1 Nhóm Key #1 — Giỏ hàng (HASH)

```
Key:    cart:{sessionId}
Type:   HASH
TTL:    86400 giây (24 giờ)

Fields:
  {bookId}:qty    → số lượng (string số nguyên)
  {bookId}:price  → đơn giá (string số thực)
  {bookId}:title  → tên sách
  {bookId}:cover  → đường dẫn ảnh bìa

Ví dụ:
  cart:abc-123  →  HASH
    "1:qty"   = "2"
    "1:price" = "88000"
    "1:title" = "Mắt biếc"
    "1:cover" = "/uploads/mat-biec.jpg"
    "3:qty"   = "1"
    "3:price" = "72000"
    "3:title" = "Tôi thấy hoa vàng..."

Lý do chọn HASH:
  - Cập nhật từng trường riêng lẻ (HSET) hiệu quả hơn ghi lại toàn bộ JSON
  - O(1) cho GET/SET từng field
  - Hỗ trợ HDEL để xóa 1 sách mà không cần đọc lại toàn bộ
```

### 1.2 Nhóm Key #2 — OTP (STRING)

```
Key:    otp:{email}
Type:   STRING
TTL:    300 giây (5 phút)
Value:  "123456" (6 chữ số)

Key:    otp_cd:{email}
Type:   STRING
TTL:    60 giây (cooldown giữa các lần gửi)
Value:  "1"

Ví dụ:
  otp:mai@gmail.com     = "847291"   TTL=247s
  otp_cd:mai@gmail.com  = "1"        TTL=13s

Lý do dùng STRING + SET EX:
  - Atomic operation: set value và TTL trong 1 lệnh
  - Tự động xóa sau 5 phút (không cần cleanup)
  - DEL sau khi verify thành công (tránh replay attack)
```

### 1.3 Nhóm Key #3 — Cache (STRING)

```
Key:    cache:books:hot
Type:   STRING (JSON array)
TTL:    3600 giây (1 giờ)

Key:    cache:search:{query_hash}
Type:   STRING (JSON object)
TTL:    300 giây (5 phút)

Key:    cache:book:{id}
Type:   STRING (JSON object)
TTL:    600 giây (10 phút)

Key:    cache:stats:{type}
Type:   STRING (JSON object)
TTL:    1800 giây (30 phút)

Chiến lược Cache-Aside:
  1. Request đến → kiểm tra Redis
  2. HIT:  trả về dữ liệu từ Redis (source: "redis_cache")
  3. MISS: query MongoDB/SQLite → lưu vào Redis → trả về (source: "mongodb")
  4. Invalidate: khi dữ liệu thay đổi → DEL keys liên quan
```

### 1.4 Nhóm Key #4 — Leaderboard (SORTED SET)

```
Key:    leaderboard:books:{YYYY-MM}
Type:   ZSET (Sorted Set)
TTL:    5184000 giây (60 ngày)
Score:  tổng số lượng đã bán (tăng dần)
Member: "{bookId}:{bookTitle}"

Ví dụ (tháng 2026-07):
  leaderboard:books:2026-07
    "1:Mắt biếc"           score=142
    "2:Đắc Nhân Tâm"       score=98
    "3:Tôi thấy hoa vàng"  score=87
    ...

Lệnh quan trọng:
  ZINCRBY leaderboard:books:2026-07 5 "1:Mắt biếc"  → cộng 5 khi bán
  ZREVRANGEBYSCORE ... WITHSCORES LIMIT 0 10          → top 10
  ZREVRANK leaderboard:books:2026-07 "1:Mắt biếc"    → rank của 1 sách

Lý do dùng ZSET:
  - O(log N) cho ZINCRBY và ZREVRANK
  - Tự động sắp xếp theo score
  - Hỗ trợ phân trang với LIMIT
  - TTL 60 ngày: giữ lịch sử đủ dài, tự động dọn dẹp
```

---

## 2. Thiết kế MongoDB Schema Mới

### 2.1 Collection: `feedbacks`

```json
{
  "_id": Number,
  "bookId": Number,
  "bookTitle": "Mắt biếc",
  "customerId": Number | null,
  "customerName": "Trần Thị Mai",
  "email": "mai@gmail.com",
  "rating": 5,
  "comment": "Sách hay, giao nhanh...",
  "tags": ["hay", "giao nhanh"],
  "sentiment": "positive",
  "score": 0.94,
  "isFeatured": true,
  "status": "reviewed",
  "helpful": 12,
  "createdAt": ISODate
}
```

**Indexes:**
```javascript
{ bookId: 1, createdAt: -1 }   // Truy vấn theo sách
{ sentiment: 1, rating: -1 }   // Lọc sentiment
{ isFeatured: -1, createdAt: -1 } // Hiển thị nổi bật trước
{ createdAt: 1 } expireAfterSeconds=63072000  // TTL 2 năm
```

**Aggregation thống kê:**
```javascript
// Phân bố sentiment
db.feedbacks.aggregate([
  { $group: { _id: "$sentiment", count: { $sum: 1 }, avgRating: { $avg: "$rating" } } },
  { $sort: { count: -1 } }
])

// Top sách có nhiều đánh giá nhất
db.feedbacks.aggregate([
  { $group: { _id: "$bookId", bookTitle: { $first: "$bookTitle" },
              count: { $sum: 1 }, avgRating: { $avg: "$rating" } } },
  { $sort: { count: -1 } }, { $limit: 5 }
])
```

### 2.2 Collection: `bookrecommendations`

```json
{
  "_id": ObjectId,
  "bookId": 1,
  "bookTitle": "Mắt biếc",
  "similarBooks": [
    { "bookId": 3, "bookTitle": "Tôi thấy hoa vàng...", "score": 0.95, "reason": "Cùng tác giả" },
    { "bookId": 4, "bookTitle": "Dế Mèn Phiêu Lưu Ký", "score": 0.72, "reason": "Cùng thể loại" }
  ],
  "frequentlyBoughtTogether": [3, 2, 5],
  "updatedAt": ISODate
}
```

**Index:** `{ bookId: 1 }` unique

---

## 3. Luồng dữ liệu — Checkout với Redis + MongoDB

```
Khách hàng                Redis                MongoDB
     │                      │                    │
     │── POST /cart/add ────►│ HSET cart:abc ...  │
     │                      │ EXPIRE 86400        │
     │── POST /cart/checkout►│ HGETALL cart:abc   │
     │                      │◄── items[]          │
     │                                ──── INSERT Order ──►│
     │                                            │◄── saved
     │                      │── ZINCRBY ldrbd ───►│
     │                      │── DEL cart:abc      │
     │                      │── DEL cache:stats:* │
     │◄── { orderCode, total }                    │
```

---

## 4. So sánh hiệu năng — Cache vs Non-Cache

| Tình huống | Không cache | Có Redis Cache |
|-----------|------------|----------------|
| GET /api/cache/hot-books (lần 1) | ~80ms (MongoDB) | ~80ms + ghi cache |
| GET /api/cache/hot-books (lần 2+) | ~80ms | **~2ms** |
| GET /api/leaderboard/books | ~5ms (Redis ZSET) | ~5ms |
| POST /api/cart/add | — | ~3ms (HSET) |
| OTP verify | — | ~1ms (GET + DEL) |

---

## 5. Cài đặt & Chạy

```bash
# 1. Cài Redis (Docker)
docker run -d --name bookstore-redis -p 6379:6379 redis:7-alpine

# 2. Cấu hình .env
REDIS_URL=redis://127.0.0.1:6379

# 3. Seed dữ liệu mẫu
node scripts/setup-redis.js
node scripts/setup-mongo-feedback.js

# 4. Chạy ứng dụng
npm run dev:mongo

# 5. Kiểm tra Redis health
curl http://localhost:4000/api/redis/health \
  -H "Authorization: Bearer <admin_token>"
```

---

## 6. Bảng đối chiếu yêu cầu đồ án

| Yêu cầu | MongoDB | Redis |
|---------|---------|-------|
| ≥ 2 collection/nhóm key | ✅ 11 collections (+ 2 mới) | ✅ 4 nhóm key |
| Dữ liệu mẫu | ✅ setup-mongo-feedback.js | ✅ setup-redis.js |
| CRUD đầy đủ | ✅ Feedback: 7 endpoints | ✅ Cart: 7 endpoints |
| Lọc/thống kê | ✅ Aggregation pipeline | ✅ ZREVRANGEBYSCORE |
| TTL | ✅ AuditLog 90 ngày | ✅ OTP=5p, Cart=24h |
| Tính năng đặc trưng | ✅ Full-text, AI, K-Means | ✅ Leaderboard, Session |
