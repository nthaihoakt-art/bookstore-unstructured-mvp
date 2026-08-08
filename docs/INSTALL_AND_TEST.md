# HƯỚNG DẪN CÀI ĐẶT VÀ KIỂM THỬ HỆ THỐNG

Tài liệu hướng dẫn cài đặt môi trường, khởi tạo dữ liệu mẫu và thực hiện các kịch bản kiểm thử (giao diện trình duyệt và dòng lệnh cURL) cho hệ thống quản lý nhà sách tích hợp SQLite, MongoDB và Redis.

---

## 1. YÊU CẦU TIỀN ĐỀ

| Phần mềm | Phiên bản tối thiểu | Mục đích |
| :--- | :--- | :--- |
| Node.js | 20.x trở lên | Chạy máy chủ ứng dụng |
| npm | Đi kèm Node.js | Quản lý gói thư viện |
| Docker Desktop | Bất kỳ | Chạy Redis trong container |
| MongoDB Community + Compass | 6.x trở lên | CSDL tài liệu NoSQL và giao diện xem data |
| Git Bash / PowerShell | Bất kỳ | Chạy lệnh cURL |

---

## 2. CÀI ĐẶT

### Bước 2.1. Cài đặt các gói phụ thuộc

```bash
npm install
```

### Bước 2.2. Thiết lập biến môi trường

```bash
copy .env.example .env
```

Kiểm tra các giá trị trong `.env`:

```
PORT=4000
JWT_SECRET=your_secret_key_here
MONGODB_URI=mongodb://127.0.0.1:27017/bookstore_migrated
REDIS_URL=redis://127.0.0.1:6379
```

### Bước 2.3. Khởi động Redis bằng Docker

```bash
docker run -d --name bookstore-redis -p 6379:6379 redis:7-alpine
docker ps
```

Cột STATUS phải hiển thị `Up` cho container `bookstore-redis`.

### Bước 2.4. Đảm bảo MongoDB đang chạy

```powershell
Get-Service MongoDB          # Kiểm tra trạng thái
Start-Service MongoDB        # Khởi động nếu Stopped
```

---

## 3. KHỞI TẠO DỮ LIỆU MẪU

```bash
npm run setup:all            # Hoặc chạy riêng từng bước:
npm run setup:redis          # Tạo giỏ hàng mẫu, OTP, cache và Leaderboard trong Redis
npm run setup:mongo          # Tạo collection feedbacks và bookRecommendations trong MongoDB
```

---

## 4. KHỞI ĐỘNG HỆ THỐNG

```bash
npm run dev:mongo
```

Khi khởi động thành công, terminal hiển thị:

```
Bookstore MongoDB MVP running: http://localhost:4000
[Redis] ✅ Kết nối thành công: redis://127.0.0.1:6379
Connected to MongoDB Atlas: undefined
Database indexes synchronized.
```

Truy cập **http://localhost:4000** để xác nhận giao diện tải lên.

---

## 5. TÀI KHOẢN KIỂM THỬ

| Vai trò | Email | Mật khẩu | Giao diện |
| :--- | :--- | :--- | :--- |
| Quản trị viên (Admin) | `admin@bookstore.local` | `admin123` | http://localhost:4000 |
| Khách hàng (mật khẩu) | `customer@test.local` | `customer123` | http://localhost:4000/customer.html |
| Khách hàng (OTP) | Bất kỳ email tồn tại | Mã OTP từ log server | http://localhost:4000/customer.html |

---

## 6. KỊCH BẢN KIỂM THỬ TRÊN GIAO DIỆN ỨNG DỤNG

### 6.1. Kiểm thử OTP — Giao diện Khách hàng

**Môi trường:** Trình duyệt → http://localhost:4000/customer.html

**Bước thực hiện:**

1. Bấm **"Đăng nhập"** → chọn **"Đăng Nhập Nhanh Bằng Mã OTP"**
2. Nhập email (ví dụ: `customer@test.local`) → bấm **"Gửi Mã OTP"**
3. Lấy mã OTP 6 chữ số từ log terminal server
4. Nhập mã vào ô **"Mã OTP 6 chữ số"** → bấm **"Xác Nhận OTP & Đăng Nhập"**

**Kết quả mong đợi:**
- Thông báo **"Đăng nhập OTP thành công!"** và tên tài khoản hiển thị trên thanh điều hướng
- Thẻ **Hồ sơ khách hàng** hiển thị thông tin cá nhân và phân khúc thành viên
- **Redis** (`bookstore-redis`): key `otp:customer@test.local` tồn tại trong quá trình chờ OTP, tự xóa sau khi xác thực thành công

---

### 6.2. Kiểm thử Giỏ hàng — Giao diện Khách hàng

**Môi trường:** Trình duyệt → http://localhost:4000/customer.html

**Bước thực hiện:**

1. Kéo xuống **Danh mục sách**, chọn một cuốn sách
2. Ở trang chi tiết, tích **"Mua kèm cuốn này"** → bấm **"Thêm vào giỏ"**
3. Đăng nhập tài khoản khách hàng → bấm **"Tiến Hành Đặt Hàng"** → xác nhận OK

**Kết quả mong đợi:**
- Thông báo **"Đặt hàng thành công! Mã đơn: ORD-MAU-xxx"**
- Giỏ hàng tự động xóa trống sau khi đặt hàng
- **Redis** (`bookstore-redis`): key `cart:<sessionId>` tồn tại khi có sách trong giỏ, tự xóa sau checkout; key `leaderboard:books:YYYY-MM` cập nhật điểm số sách
- **MongoDB Compass** → collection `orders`: xuất hiện document đơn hàng mới với `orderCode: "ORD-MAU-xxx"` và danh sách `items`

---

### 6.3. Kiểm thử Phân hệ Admin — Feedback

**Môi trường:** Trình duyệt → http://localhost:4000

**Bước thực hiện:**

1. Đăng nhập `admin@bookstore.local` / `admin123`
2. Mở mục **Phản hồi** → chọn bộ lọc **Sentiment = positive**
3. Chọn một phản hồi → bấm đổi trạng thái thành **"Đã duyệt"**

**Kết quả mong đợi:**
- Danh sách lọc đúng theo sentiment
- **MongoDB Compass** → collection `feedbacks`: field `status` của document tương ứng cập nhật thành `reviewed`

---

### 6.4. Kiểm thử Quản lý Đơn hàng Admin

**Môi trường:** Trình duyệt → http://localhost:4000 (tài khoản Admin)

**Bước thực hiện:**

1. Mở mục **Đơn hàng** → bấm **Sửa**, chọn trạng thái mới và nhập ghi chú → lưu
2. Bấm **Xem** để kiểm tra panel chi tiết đơn hàng
3. Mở form **Tạo đơn hàng**, chọn khách hàng và danh sách sách cần tạo đơn

**Kết quả mong đợi:**
- Trạng thái và ghi chú cập nhật thành công ở cả danh sách và chi tiết
- Khi Admin sửa trạng thái đơn hàng thành **"completed" (Hoàn thành)**:
  - **Redis** (`bookstore-redis`): key `leaderboard:books:YYYY-MM` tự động cập nhật điểm số bán sách
  - **MongoDB** (`books` collection): số lượng tồn kho `stockQuantity` của các đầu sách trong đơn tự động trừ tương ứng
- Đơn hàng mới tạo được cấp mã `ORD-MAU-xxx`; trạng thái không hợp lệ bị từ chối
- **MongoDB Compass** → collection `orders`: field `status` và `notes` cập nhật đúng; document đơn mới xuất hiện với `orderCode`, `items`, `total`
- **MongoDB Compass** → collection `auditlogs`: ghi nhận hành động `update_status` với thông tin người thực hiện

---

### 6.5. Kiểm thử Kho sách, Nhà cung cấp và Khách hàng Admin

**Môi trường:** Trình duyệt → http://localhost:4000 (tài khoản Admin)

**Bước thực hiện:**

1. Mở mục **Kho sách** → tạo phiếu kho mới (chọn nhà cung cấp và danh sách sách)
2. Mở mục **Nhà cung cấp** và **Khách hàng** để xem danh sách
3. Đăng ký tài khoản khách hàng mới tại http://localhost:4000/customer.html → quay lại Admin kiểm tra mục **Khách hàng**

**Kết quả mong đợi:**
- Dữ liệu kho sách, nhà cung cấp và khách hàng tải đầy đủ
- Tài khoản khách hàng mới xuất hiện ngay trong danh sách Admin
- **MongoDB Compass** → collection `customers`: document khách hàng mới xuất hiện với `email` và `fullName` chính xác
- **MongoDB Compass** → collection `inventoryslips`: document phiếu kho mới xuất hiện với danh sách `items` và `supplierId`
- **SQLite** (`bookstore.db`): bảng `inventory_transactions` ghi nhận giao dịch nhập/xuất kho tương ứng

---

## 7. KỊCH BẢN KIỂM THỬ QUA DÒNG LỆNH (cURL)

> Chạy tất cả lệnh trong Git Bash hoặc PowerShell.

---

### 7.1. Phân hệ Giỏ hàng (Redis HASH)

**TC-01. Thêm sách vào giỏ:**
```bash
curl -X POST http://localhost:4000/api/cart/session-test-001/add \
  -H "Content-Type: application/json" \
  -d "{\"bookId\": 1, \"qty\": 2}"
```
Kết quả mong đợi — HTTP 200, `total: 176000`.
**Redis**: `HGETALL cart:session-test-001` → thấy trường `item:1` chứa thông tin sách ID 1.

**TC-02. Xem giỏ hàng:**
```bash
curl http://localhost:4000/api/cart/session-test-001
```
Kết quả mong đợi — HTTP 200, đúng thông tin giỏ hàng vừa thêm.

**TC-03. Cập nhật số lượng:**
```bash
curl -X PUT http://localhost:4000/api/cart/session-test-001/item/1 \
  -H "Content-Type: application/json" \
  -d "{\"qty\": 5}"
```
Kết quả mong đợi — HTTP 200, `total: 440000`.

**TC-04. Xóa sản phẩm khỏi giỏ:**
```bash
curl -X DELETE http://localhost:4000/api/cart/session-test-001/item/1
```
Kết quả mong đợi — HTTP 200, `items: []`, `total: 0`.

**TC-05. Checkout đơn hàng:**
```bash
# Bước 1: Thêm lại sách
curl -X POST http://localhost:4000/api/cart/session-test-001/add \
  -H "Content-Type: application/json" \
  -d "{\"bookId\": 1, \"qty\": 3}"

# Bước 2: Checkout
curl -X POST http://localhost:4000/api/cart/session-test-001/checkout \
  -H "Content-Type: application/json" \
  -d "{\"customerName\": \"Nguyen Van A\", \"customerEmail\": \"nva@test.local\", \"paymentMethod\": \"cash\"}"
```
Kết quả mong đợi — HTTP 200, `orderCode: "ORD-MAU-xxx"`, `total: 264000`.
Sau checkout: giỏ hàng trống (kiểm tra lại bằng TC-02).
**Redis**: key `cart:session-test-001` đã bị xóa.
**MongoDB Compass** → collection `orders`: đơn hàng mới xuất hiện.

**TC-06 [Negative]. Checkout giỏ trống:**
```bash
curl -X POST http://localhost:4000/api/cart/session-empty-999/checkout \
  -H "Content-Type: application/json" \
  -d "{\"customerName\": \"Test\"}"
```
Kết quả mong đợi — HTTP 400: `{"error": "Giỏ hàng trống"}`.

**TC-07 [Negative]. Thêm sách không tồn tại:**
```bash
curl -X POST http://localhost:4000/api/cart/session-test-001/add \
  -H "Content-Type: application/json" \
  -d "{\"bookId\": 99999, \"qty\": 1}"
```
Kết quả mong đợi — HTTP 404: `{"error": "Không tìm thấy sách"}`.

---

### 7.2. Phân hệ OTP (Redis STRING)

**TC-08. Gửi mã OTP:**
```bash
curl -X POST http://localhost:4000/api/customer/send-otp \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"customer@test.local\"}"
```
Kết quả mong đợi — HTTP 200: `{"ok": true, "expiresIn": 300}`.
**Redis**: `TTL otp:customer@test.local` → trả về giá trị ≤ 300 giây.
Lấy mã OTP từ log terminal: `[OTP] customer@test.local → 847291`.

**TC-09. Xác thực OTP đúng:**
```bash
curl -X POST http://localhost:4000/api/customer/verify-otp \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"customer@test.local\", \"otp\": \"847291\"}"
```
Kết quả mong đợi — HTTP 200: `{"ok": true, "token": "eyJ..."}`.
Sao chép `token` dùng cho các test case cần xác thực.
**Redis**: sau xác thực, key `otp:customer@test.local` đã bị xóa.

**TC-10 [Negative]. OTP sai:**
```bash
curl -X POST http://localhost:4000/api/customer/verify-otp \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"customer@test.local\", \"otp\": \"000000\"}"
```
Kết quả mong đợi — HTTP 401: `{"error": "Mã OTP không đúng hoặc đã hết hạn"}`.

**TC-11 [Negative]. Cooldown 60 giây:**

Gửi lại TC-08 trong vòng 60 giây kể từ lần đầu.
Kết quả mong đợi — HTTP 429: `{"error": "Vui lòng chờ 55s trước khi gửi lại", "retryAfter": 55}`.
**Redis**: key `otp_cooldown:customer@test.local` tồn tại với TTL còn lại.

---

### 7.3. Phân hệ Leaderboard và Cache (Redis ZSET & STRING)

**TC-12. Lấy bảng xếp hạng sách bán chạy:**
```bash
curl http://localhost:4000/api/leaderboard/books
```
Kết quả mong đợi — HTTP 200, mảng `leaderboard` có `rank`, `bookId`, `bookTitle`, `score`.
**Redis**: `ZREVRANGEBYSCORE leaderboard:books:YYYY-MM +inf -inf WITHSCORES LIMIT 0 10` → thấy top 10 sách và điểm số.

**TC-13. Xem hạng một cuốn sách:**
```bash
curl http://localhost:4000/api/leaderboard/books/1/rank
```
Kết quả mong đợi — HTTP 200, trả về thứ hạng và điểm số sách ID 1.

**TC-14. Cache Miss → Cache Hit:**
```bash
# Lần 1 (Cache Miss):
curl http://localhost:4000/api/cache/hot-books

# Lần 2 (Cache Hit — chạy ngay sau):
curl http://localhost:4000/api/cache/hot-books

# Đo thời gian phản hồi:
curl -w "\nThời gian: %{time_total}s\n" http://localhost:4000/api/cache/hot-books
```
Kết quả mong đợi — Lần 1: `"source": "mongodb"`, thời gian ~120ms. Lần 2: `"source": "redis_cache"`, thời gian ~3ms (nhanh hơn khoảng 40 lần).
**Redis**: `EXISTS cache:books:hot` → `1` sau lần gọi đầu tiên.

---

### 7.4. Phân hệ Feedback MongoDB

**TC-15. Gửi đánh giá tích cực:**
```bash
curl -X POST http://localhost:4000/api/feedbacks \
  -H "Content-Type: application/json" \
  -d "{\"bookId\": 1, \"customerName\": \"Le Van B\", \"customerEmail\": \"lvb@test.local\", \"rating\": 5, \"content\": \"Sach rat hay va y nghia, toi rat thich cach tac gia xay dung nhan vat\"}"
```
Kết quả mong đợi — HTTP 201, `"sentiment": "positive"`, `"status": "new"`.
**MongoDB Compass** → collection `feedbacks`: document mới với `sentiment: "positive"`, `isFeatured: true`.

**TC-16. Gửi đánh giá tiêu cực (auto-urgent):**
```bash
curl -X POST http://localhost:4000/api/feedbacks \
  -H "Content-Type: application/json" \
  -d "{\"bookId\": 2, \"customerName\": \"Tran Thi C\", \"rating\": 1, \"content\": \"Sach kem chat luong, in an loi nhieu, that vong\"}"
```
Kết quả mong đợi — HTTP 201, `"sentiment": "negative"`, `"status": "urgent"`.
**MongoDB Compass** → collection `feedbacks`: document mới với `status: "urgent"`.

**TC-17. Xem feedback công khai theo sách:**
```bash
curl "http://localhost:4000/api/feedbacks/book/1"
```
Kết quả mong đợi — HTTP 200, danh sách feedback của sách ID 1 kèm `avgRating`.

**TC-18 [Negative]. Thiếu trường bắt buộc:**
```bash
curl -X POST http://localhost:4000/api/feedbacks \
  -H "Content-Type: application/json" \
  -d "{\"bookId\": 1, \"customerName\": \"Test\"}"
```
Kết quả mong đợi — HTTP 400: `{"error": "Thiếu thông tin bắt buộc: bookId, customerName, rating, content"}`.

---

### 7.5. Phân hệ Gợi ý sách MongoDB

**TC-19. Lấy gợi ý sách liên quan:**
```bash
curl http://localhost:4000/api/recommendations/1
```
Kết quả mong đợi — HTTP 200, danh sách sách liên quan đến sách ID 1.
**MongoDB Compass** → collection `bookrecommendations`: tìm document có `bookId: 1`.

---

### 7.6. Kiểm thử Redis Health Check

**TC-23. Kiểm tra trạng thái kết nối Redis:**
```bash
curl http://localhost:4000/api/redis/health
```
Kết quả mong đợi — HTTP 200, trả về trạng thái kết nối và thống kê memory, ví dụ:
```json
{ "status": "ok", "connected": true, "memoryUsed": "856.00K" }
```

---

### 7.7. Kiểm thử Admin qua cURL (JWT token)


**Bước 1 — Lấy token Admin và lưu vào biến:**
```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@bookstore.local", "password": "admin123"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['token'])")

echo $TOKEN   # Xác nhận token đã được lưu
```
Kết quả mong đợi — in ra chuỗi `eyJ...` (JWT token).

> **Nếu không có python:** Sao chép thủ công giá trị `token` từ JSON trả về và gán: `TOKEN="eyJ..."`

**TC-20. Thống kê Feedback (Aggregation Pipeline):**
```bash
curl -g http://localhost:4000/api/feedbacks/stats \
  -H "Authorization: Bearer $TOKEN"
```
Kết quả mong đợi — HTTP 200, trả về `total`, `avgRating`, `sentimentBreakdown`, `topBooksWithFeedback`.

**TC-21. Lọc Feedback theo Sentiment:**
```bash
curl -g "http://localhost:4000/api/feedbacks?sentiment=positive&limit=5" \
  -H "Authorization: Bearer $TOKEN"
```
Kết quả mong đợi — HTTP 200, chỉ trả về feedback `sentiment = positive`, tối đa 5 mục.

**TC-22 [Negative]. Truy cập không có token:**
```bash
curl http://localhost:4000/api/feedbacks/stats
```
Kết quả mong đợi — HTTP 401 hoặc 403.


---

## 8. BẢNG TỔNG HỢP KẾT QUẢ KIỂM THỬ

| Mã TC | Phân hệ | Mô tả | HTTP mong đợi | Kết quả thực tế | Đạt/Không |
| :--- | :--- | :--- | :---: | :--- | :---: |
| TC-01 | Cart / Redis | Thêm sách vào giỏ | 200 | | |
| TC-02 | Cart / Redis | Xem giỏ hàng | 200 | | |
| TC-03 | Cart / Redis | Cập nhật số lượng | 200 | | |
| TC-04 | Cart / Redis | Xóa sản phẩm khỏi giỏ | 200 | | |
| TC-05 | Cart / Redis | Checkout tạo đơn hàng | 200 | | |
| TC-06 | Cart / Redis | [Negative] Checkout giỏ trống | 400 | | |
| TC-07 | Cart / Redis | [Negative] Thêm sách không tồn tại | 404 | | |
| TC-08 | OTP / Redis | Gửi mã OTP | 200 | | |
| TC-09 | OTP / Redis | Xác thực OTP đúng | 200 | | |
| TC-10 | OTP / Redis | [Negative] OTP sai | 401 | | |
| TC-11 | OTP / Redis | [Negative] Cooldown 60s | 429 | | |
| TC-12 | Leaderboard / Redis | Lấy bảng xếp hạng Top 10 | 200 | | |
| TC-13 | Leaderboard / Redis | Xem rank một cuốn sách | 200 | | |
| TC-14 | Cache / Redis | Cache Miss → Cache Hit | 200 | | |
| TC-15 | Feedback / MongoDB | Gửi đánh giá tích cực | 201 | | |
| TC-16 | Feedback / MongoDB | Gửi đánh giá tiêu cực (auto-urgent) | 201 | | |
| TC-17 | Feedback / MongoDB | Xem feedback công khai theo sách | 200 | | |
| TC-18 | Feedback / MongoDB | [Negative] Thiếu trường bắt buộc | 400 | | |
| TC-19 | Recommendations / MongoDB | Xem gợi ý sách liên quan | 200 | | |
| TC-20 | Admin / MongoDB | Thống kê Aggregation Pipeline | 200 | | |
| TC-21 | Admin / MongoDB | Lọc Feedback theo Sentiment | 200 | | |
| TC-22 | Admin / Phân quyền | [Negative] Không có token | 401/403 | | |
| TC-23 | Health / Redis | Kiểm tra trạng thái kết nối Redis | 200 | | |
