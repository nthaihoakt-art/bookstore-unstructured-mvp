# Bookstore — Mở rộng ứng dụng Web Quản lý Nhà sách với NoSQL

Dự án mở rộng ứng dụng quản lý nhà sách (Bookstore MVP) từ kiến trúc đơn lẻ SQLite sang kiến trúc đa cơ sở dữ liệu, tích hợp thêm **MongoDB** (dữ liệu tài liệu linh hoạt) và **Redis** (tốc độ cao, TTL tự động).

---

## Kiến trúc hệ thống

```
┌───────────────────────────────────────────┐
│        Bookstore App  (Node.js + Express) │
├──────────────┬──────────────┬─────────────┤
│   SQLite     │   MongoDB    │    Redis    │
│  (RDBMS)     │ (Document DB)│(Key-Value)  │
│ 13 bảng gốc  │ feedbacks    │ Cart HASH   │
│ users, books │ bookRecomm.  │ OTP STRING  │
│ orders, kho  │ Aggregation  │ Cache       │
│              │ Pipeline     │ Leaderboard │
└──────────────┴──────────────┴─────────────┘
```

---

## Khởi động nhanh

### Yêu cầu: Node.js >= 20, Docker Desktop, MongoDB chạy cục bộ

```bash
# 1. Cài đặt thư viện
npm install

# 2. Sao chép file cấu hình
copy .env.example .env

# 3. Khởi động Redis qua Docker
docker run -d --name bookstore-redis -p 6379:6379 redis:7-alpine

# 4. Khởi tạo dữ liệu mẫu NoSQL
npm run setup:all

# 5. Chạy server tích hợp NoSQL
npm run dev:mongo
```

Mở trình duyệt: **http://localhost:4000**

---

## Tài khoản kiểm thử

| Vai trò | Email | Mật khẩu | Giao diện |
| :--- | :--- | :--- | :--- |
| Quản trị viên | `admin@bookstore.local` | `admin123` | http://localhost:4000 |
| Quản lý nhà sách | `manager@bookstore.local` | `admin123` | http://localhost:4000 |
| Nhân viên bán hàng | `sales@bookstore.local` | `admin123` | http://localhost:4000 |
| Nhân viên kho | `warehouse@bookstore.local` | `admin123` | http://localhost:4000 |
| Khách hàng vãng lai | Dùng OTP | Không có mật khẩu | http://localhost:4000/customer.html |

---

## Tính năng NoSQL mở rộng

### MongoDB — Collection feedbacks
- CRUD đầy đủ: 7 API endpoints (GET, POST, PATCH, DELETE)
- Aggregation Pipeline: thống kê phân bố cảm xúc (positive/negative/neutral)
- Tích hợp AI phân tích cảm xúc tự động khi khách gửi đánh giá
- Tự động đánh dấu `isFeatured` cho đánh giá xuất sắc
- 3 compound indexes tối ưu hóa truy vấn

### MongoDB — Collection bookRecommendations
- Lưu gợi ý sách liên quan theo từng cuốn
- Hỗ trợ `similarBooks` (điểm tương đồng, lý do) và `frequentlyBoughtTogether`
- 4 API endpoints (GET, POST, DELETE)

### Redis — 4 nhóm key
| Nhóm | Cấu trúc | TTL | Mục đích |
| :--- | :--- | :--- | :--- |
| `cart:{sessionId}` | HASH | 24 giờ | Giỏ hàng tạm thời |
| `otp:{email}` | STRING | 5 phút | Mã xác thực OTP |
| `cache:books:hot` | STRING | 1 giờ | Bộ đệm sách hot |
| `leaderboard:books:{YYYY-MM}` | SORTED SET | 60 ngày | Bảng xếp hạng bán chạy |

---

## Tính năng gốc (SQLite)

- Đăng nhập JWT, RBAC theo vai trò admin/manager/sales/warehouse
- CRUD sách, khách hàng, nhà cung cấp, tài liệu
- Tạo đơn hàng nhiều dòng sản phẩm, tự trừ tồn kho
- Upload tài liệu PDF/DOCX/TXT/ảnh, OCR bằng Tesseract.js
- Tìm kiếm toàn văn bằng SQLite FTS5
- Xuất CSV cho books, customers, orders, inventory, documents
- Audit log thao tác quan trọng

---

## Kiểm thử hệ thống

Xem hướng dẫn đầy đủ tại Cai_dat_&_Kiem_thu gồm 23 test cases bao phủ:
- Kiểm thử trên giao diện trình duyệt (UI)
- Kiểm thử qua dòng lệnh cURL
- Test case lỗi (negative testing)
- Bảng tổng hợp kết quả kiểm thử

---

## Cấu trúc thư mục

```
src/
  server_mongo.js        ← Entry point tích hợp toàn bộ (MongoDB + Redis)
  server.js              ← Server gốc chỉ dùng SQLite
  redis-client.js        ← Kết nối Redis, health check
  cart-service.js        ← Giỏ hàng (HASH + TTL 24h)
  otp-service.js         ← OTP (STRING + TTL 5 phút + cooldown)
  cache-service.js       ← Cache (STRING) + Leaderboard (ZSET)
  db.js                  ← Schema SQLite, seed data, FTS index
scripts/
  setup-redis.js         ← Seed dữ liệu mẫu Redis
  setup-mongo-feedback.js ← Seed feedbacks + bookRecommendations
public/
  customer.html          ← Giao diện khách hàng (OTP, giỏ hàng)
  app.js                 ← Giao diện admin SPA
bookstore.db             ← SQLite database (tự tạo khi chạy lần đầu)
```

---

## Biến môi trường (.env)

```
PORT=4000
JWT_SECRET=your_secret_key_here
MONGODB_URI=mongodb://127.0.0.1:27017/bookstore_migrated
REDIS_URL=redis://127.0.0.1:6379
```

---
