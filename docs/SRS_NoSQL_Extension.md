# SRS — Đặc tả Yêu cầu Bổ sung NoSQL
## Dự án: Bookstore Unstructured MVP — Mở rộng tích hợp Redis

**Phiên bản:** 2.0  
**Ngày:** 2026-07-16  
**Nhóm:** Đồ án môn Quản trị Cơ sở Dữ liệu Phi cấu trúc

---

## 1. Tổng quan hệ thống

### 1.1 Mô tả
Mở rộng ứng dụng web quản lý nhà sách (Bookstore MVP) bằng cách tích hợp thêm hệ CSDL NoSQL **Redis** (Key-Value Store) bên cạnh **MongoDB Atlas** đã có. Ứng dụng vẫn giữ nguyên **SQLite** (RDBMS) làm nguồn dữ liệu gốc.

### 1.2 Kiến trúc đa CSDL

| Hệ CSDL | Loại | Vai trò |
|---------|------|---------|
| SQLite | RDBMS | Dữ liệu nghiệp vụ chính (users, books, orders, inventory) |
| MongoDB Atlas | Document NoSQL | Tài liệu linh hoạt, full-text search, AI classification, Audit log |
| **Redis** | **Key-Value NoSQL** | **Giỏ hàng tạm, OTP, Cache, Leaderboard** |

---

## 2. Yêu cầu chức năng mới (Redis)

### UC-R01: Giỏ hàng tạm (Shopping Cart)
- **Tác nhân:** Khách hàng (chưa đăng nhập)
- **Mô tả:** Khách thêm sách vào giỏ hàng tạm dựa trên session. Giỏ hàng tự xóa sau 24 giờ không hoạt động.
- **Luồng chính:**
  1. Khách mở trang sách, nhấn "Thêm vào giỏ"
  2. Hệ thống sinh `sessionId` (UUID) lưu trong localStorage
  3. Sách được lưu vào Redis HASH `cart:{sessionId}` với TTL=86400s
  4. Khách xem giỏ hàng, có thể thay đổi số lượng hoặc xóa
  5. Khách checkout → hệ thống tạo đơn hàng trong MongoDB → xóa giỏ Redis

### UC-R02: OTP Đăng nhập Khách hàng
- **Tác nhân:** Khách hàng
- **Mô tả:** Khách đặt hàng online bằng email + mã OTP 6 số thay vì tạo tài khoản
- **Luồng chính:**
  1. Khách nhập email → hệ thống tạo OTP 6 số, lưu Redis `otp:{email}` TTL=300s
  2. OTP hiển thị trong console (demo) / gửi email (production)
  3. Khách nhập OTP → hệ thống xác thực → trả JWT token 2h
  4. Cooldown 60s giữa các lần gửi OTP (key `otp_cd:{email}`)

### UC-R03: Cache Sách Hot
- **Tác nhân:** Hệ thống
- **Mô tả:** Cache danh sách sách bán chạy và kết quả tìm kiếm để giảm tải MongoDB
- **Chiến lược:** Cache-aside (check cache → miss → query DB → write cache)
- **TTL:** Sách hot=3600s, search=300s, chi tiết sách=600s

### UC-R04: Leaderboard Sách Bán Chạy
- **Tác nhân:** Admin, Khách hàng
- **Mô tả:** Bảng xếp hạng sách theo số lượng bán mỗi tháng, cập nhật real-time
- **Cấu trúc:** Redis Sorted Set `leaderboard:books:{YYYY-MM}`
- **Cập nhật:** Mỗi lần checkout thành công → `ZINCRBY` tăng điểm

---

## 3. Yêu cầu chức năng mới (MongoDB)

### UC-M01: Feedback/Đánh giá Sách (CRUD đầy đủ)
- **Tác nhân:** Khách hàng (tạo), Admin (quản lý)
- **Collection:** `feedbacks`
- **Tính năng:** Gửi đánh giá → AI sentiment analysis → auto-feature/urgent

### UC-M02: Gợi ý Sách (BookRecommendations)
- **Tác nhân:** Hệ thống, Admin
- **Collection:** `bookrecommendations`  
- **Tính năng:** Sách tương tự + Mua kèm thường xuyên

---

## 4. Yêu cầu phi chức năng

| STT | Yêu cầu | Mức độ |
|-----|---------|--------|
| NFR-01 | Redis TTL: OTP≤300s, Cart≤86400s | Bắt buộc |
| NFR-02 | Ứng dụng vẫn hoạt động khi Redis down (graceful degradation) | Bắt buộc |
| NFR-03 | Response time GET cart < 50ms (Redis) vs < 200ms (DB) | Tốt hơn |
| NFR-04 | OTP 6 số ngẫu nhiên an toàn (không đoán được) | Bắt buộc |
| NFR-05 | Leaderboard update real-time khi có đơn hàng mới | Bắt buộc |

---

## 5. API Endpoints Mới

### Redis — Cart (6 endpoints)
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/cart/:sessionId` | Lấy giỏ hàng |
| GET | `/api/cart/:sessionId/count` | Đếm số sản phẩm |
| POST | `/api/cart/:sessionId/add` | Thêm sách |
| PUT | `/api/cart/:sessionId/item/:bookId` | Cập nhật số lượng |
| DELETE | `/api/cart/:sessionId/item/:bookId` | Xóa sách khỏi giỏ |
| DELETE | `/api/cart/:sessionId` | Xóa toàn bộ giỏ |
| POST | `/api/cart/:sessionId/checkout` | Checkout → tạo đơn hàng |

### Redis — OTP (2 endpoints)
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/customer/send-otp` | Gửi OTP |
| POST | `/api/customer/verify-otp` | Xác thực OTP |

### Redis — Leaderboard (2 endpoints)
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/leaderboard/books` | Top 10 bán chạy |
| GET | `/api/leaderboard/books/:bookId/rank` | Rank của 1 sách |

### Redis — Cache (1 endpoint demo)
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/cache/hot-books` | Sách hot (cache-aside demo) |

### MongoDB — Feedback (7 endpoints)
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/feedbacks` | Danh sách (admin, có filter) |
| GET | `/api/feedbacks/stats` | Thống kê sentiment |
| GET | `/api/feedbacks/book/:bookId` | Feedback theo sách |
| POST | `/api/feedbacks` | Gửi đánh giá mới |
| PATCH | `/api/feedbacks/:id/status` | Cập nhật trạng thái |
| POST | `/api/feedbacks/:id/feature` | Toggle nổi bật |
| DELETE | `/api/feedbacks/:id` | Xóa (admin) |

### MongoDB — Recommendations (4 endpoints)
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/recommendations/:bookId` | Gợi ý theo sách |
| GET | `/api/recommendations` | Tất cả (admin) |
| POST | `/api/recommendations` | Tạo/cập nhật |
| DELETE | `/api/recommendations/:bookId` | Xóa |
