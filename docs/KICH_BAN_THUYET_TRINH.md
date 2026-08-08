# KỊCH BẢN THUYẾT TRINH & QUAY VIDEO DEMO
## DỰ ÁN: QUẢN TRỊ DỮ LIỆU PHI CẤU TRÚC NHÀ SÁCH (NOSQL)

> **Hướng dẫn quay video:**
> - Kịch bản được trình bày rõ ràng với 2 nhãn chỉ dẫn: **[Thao tác / Quay màn hình]** và **[Lời thoại / Đọc code]**.
> - Ngôn ngữ thuần Việt, tự nhiên, rõ ràng, tốc độ vừa phải, phong cách tự tin, chuyên nghiệp.

---

## 🎬 MỞ ĐẦU (INTRO - 1 PHÚT)

* **[Quay màn hình]**: Hiển thị trang chủ ứng dụng nhà sách tại `http://localhost:4000` và màn hình VS Code chứa cây thư mục dự án.
* **[Lời thoại]**:
  > "Xin chào cô! Hôm nay em xin trình bày video demo đồ áp môn học **Quản trị Dữ liệu NoSQL**.
  > Dự án của em là **Mở rộng ứng dụng Web Quản lý Nhà sách với kiến trúc Đa cơ sở dữ liệu (Polyglot Persistence)**.
  > Hệ thống lấy **SQLite** làm cơ sở dữ liệu quan hệ nền tảng đảm bảo giao dịch nghiệp vụ chuẩn xác, sau đó mở rộng tích hợp **MongoDB** cho dữ liệu tài liệu linh hoạt và **Redis** cho bộ nhớ đệm tốc độ cao.
  > Sau đây, em xin phép đi vào chi tiết cấu trúc dự án, các thành phần dữ liệu và demo luồng tương tác thực tế của ứng dụng."

---

## 🗂️ PHẦN 0. CẤU TRÚC THƯ MỤC DỰ ÁN (30 GIÂY)

* **[Quay màn hình]**: Mở VS Code, thu gọn cây thư mục `bookstore-unstructured-mvp/` để nhìn tổng thể.
* **[Lời thoại]**:
  > "Đầu tiên, em xin giới thiệu nhanh cấu trúc thư mục của dự án:"

```
bookstore-unstructured-mvp/
│
├── src/                       ← Mã nguồn xử lý hệ thống máy chủ
│   ├── server_mongo.js        ← Tệp máy chủ chính (kết nối MongoDB, Redis và SQLite)
│   ├── server.js              ← Tệp máy chủ gốc dùng SQLite
│   ├── db.js                  ← Khai báo cấu trúc SQLite và tìm kiếm văn bản toàn văn
│   ├── cache-service.js       ← Xử lý Bộ nhớ đệm và Bảng xếp hạng bán chạy
│   ├── cart-service.js        ← Xử lý Giỏ hàng tạm thời (thời hạn 24 giờ)
│   ├── otp-service.js         ← Xử lý Mã xác thực OTP đăng nhập (thời hạn 5 phút)
│   ├── redis-client.js        ← Kết nối và kiểm tra trạng thái máy chủ Redis
│   └── ai-service.js          ← Phân tích cảm xúc AI, Trợ lý tư vấn và Nhận diện chữ từ ảnh
│
├── public/                    ← Giao diện ứng dụng người dùng
│   ├── index.html             ← Trang chủ Quản trị viên
│   ├── customer.html          ← Giao diện dành cho Khách hàng
│   ├── product.html           ← Trang chi tiết sản phẩm sách
│   ├── app.js                 ← Xử lý giao diện trang quản trị
│   └── customer-app.js        ← Xử lý giao diện trang khách hàng
│
├── scripts/                   ← Kịch bản tạo dữ liệu mẫu
│   ├── seed-realistic-data.js ← Tạo dữ liệu mẫu ban đầu cho SQLite
│   ├── migrate-to-mongodb.js  ← Chuyển đổi dữ liệu sang MongoDB
│   ├── setup-mongo-feedback.js← Tạo dữ liệu mẫu cho Phản hồi và Gợi ý sách
│   └── setup-redis.js         ← Tạo dữ liệu mẫu ban đầu cho Redis
│
├── uploads/                   ← Thư mục chứa hình ảnh đính kèm và tài liệu
├── bookstore.db               ← Tập tin cơ sở dữ liệu SQLite
└── .env                       ← Tập tin cấu hình biến môi trường và khóa API
```

  > "Dự án được phân chia rõ ràng: thư mục `src/` chứa toàn bộ mã nguồn xử lý phía máy chủ, `public/` quản lý các trang giao diện người dùng, và `scripts/` chứa các kịch bản khởi tạo dữ liệu cho cả 3 hệ cơ sở dữ liệu."

---

## 📁 PHẦN 1. KIẾN TRÚC DỮ LIỆU & PHÂN HỆ QUẢN TRỊ ADMIN

### 1.1. Kiến trúc Đa cơ sở dữ liệu & 14 Collections MongoDB (Hình 1)
* **[Quay màn hình]**: 
  1. Mở file `src/db.js` trong VS Code (hoặc giao diện xem dữ liệu SQLite).
  2. Mở **MongoDB Compass**, kết nối vào cơ sở dữ liệu `bookstore_migrated`, hiển thị danh sách 14 collections. Rê chuột qua từng collection khi thuyết minh.
* **[Đọc code / Mở file]**: 
  - Mở `src/db.js` (dòng 13–155 & dòng 197): Chỉ vào câu lệnh khởi tạo 13 bảng quan hệ SQLite và chỉ mục tìm kiếm văn bản toàn văn `search_index`.
  - Mở `src/server_mongo.js` (dòng 63–240): Chỉ vào các định nghĩa mô hình dữ liệu (Mongoose Schemas & Models) của MongoDB.

* **[Lời thoại]**:
  > "Về kiến trúc lưu trữ dữ liệu của hệ thống:
  > 
  > 1. **Cơ sở dữ liệu Quan hệ SQLite (`bookstore.db`)**: Lưu trữ các bảng nghiệp vụ cốt lõi (như tài khoản, danh mục sách, khách hàng, nhà cung cấp, đơn hàng...) nhằm đảm bảo tính toàn vẹn giao dịch và hỗ trợ tính năng tìm kiếm văn bản toàn văn.
  > 
  > 2. **Cơ sở dữ liệu Tài liệu MongoDB (`bookstore_migrated`)**: Được mở rộng để quản lý dữ liệu linh hoạt thông qua 14 tập hợp (collections) tài liệu:"

  * **auditlogs**: Nhật ký kiểm vết lưu lại chi tiết toàn bộ các thao tác chỉnh sửa, xóa và truy cập của người dùng hệ thống.
  * **bookrecommendations**: Lưu trữ thông tin gợi ý các đầu sách liên quan và danh sách sách thường được mua kèm cùng nhau.
  * **books**: Quản lý danh mục sản phẩm sách, giá niêm yết, thông tin tác giả và số lượng tồn kho thực tế.
  * **customers**: Lưu trữ hồ sơ thông tin cá nhân, phân loại nhóm thành viên và lịch sử giao dịch của khách hàng.
  * **documents**: Lưu trữ thông tin tài liệu đính kèm, tệp tin số hóa và dữ liệu OCR trích xuất tự động.
  * **feedbacks**: Lưu phản hồi, đánh giá từ khách hàng kèm kết quả phân tích cảm xúc (Sentiment Analysis) tự động bằng AI.
  * **inventoryslips**: Quản lý các phiếu nhập kho, xuất kho và điều chỉnh kiểm kê hàng tồn của nhà sách.
  * **orders**: Lưu trữ thông tin chi tiết các đơn hàng, trạng thái thanh toán và danh sách sản phẩm người dùng mua.
  * **reports**: Lưu trữ các dữ liệu báo cáo thống kê doanh thu và chỉ số kinh doanh tổng hợp định kỳ.
  * **reviews**: Lưu giữ các đánh giá nhận xét và điểm số bình chọn chi tiết của người đọc dành cho từng cuốn sách.
  * **roles**: Định nghĩa danh sách các vai trò người dùng và bảng phân quyền chi tiết cho từng phân hệ chức năng.
  * **suppliers**: Quản lý thông tin chi tiết các nhà cung cấp sách và lịch sử đánh giá mức độ uy tín.
  * **systemlogs**: Ghi nhận nhật ký kỹ thuật, sự kiện hệ thống và các cảnh báo lỗi vận hành máy chủ.
  * **users**: Quản lý danh sách tài khoản người dùng nội bộ gồm quản trị viên và nhân viên vận hành hệ thống.

---

### 1.2. Phân hệ Quản trị Admin & 13 Menu Chức năng (Hình 2)
* **[Quay màn hình]**: Đăng nhập tài khoản `admin@bookstore.local` / `admin123` tại `http://localhost:4000`. Mở thanh menu bên trái, lần lượt rê chuột qua từng mục chức năng.
* **[Lời thoại]**:
  > "Đi kèm với cơ sở dữ liệu là Phân hệ Quản trị Admin với 13 chức năng quản lý chuyên biệt:"

  * **Tổng quan quản trị hệ thống**: Màn hình hiển thị biểu đồ doanh thu, số lượng đơn hàng và chỉ số vận hành chính.
  * **Sách**: Quản lý danh mục sản phẩm sách, thêm mới, chỉnh sửa thông tin và tra cứu tồn kho.
  * **Khách hàng**: Danh sách khách hàng, phân loại nhóm người mua và theo dõi lịch sử mua sắm.
  * **Đơn hàng**: Danh sách đơn hàng, cập nhật trạng thái xử lý và duyệt hoàn thành đơn.
  * **Kho sách**: Theo dõi biến động hàng tồn và tạo phiếu nhập/xuất kho.
  * **Nhà cung cấp**: Quản lý danh sách đối tác cung cấp sách và xếp hạng uy tín.
  * **Tài liệu**: Tải lên tài liệu, trích xuất văn bản từ hình ảnh và liên kết dữ liệu.
  * **Phản hồi**: Xem phản hồi từ khách hàng, duyệt đánh giá và theo dõi kết quả phân tích cảm xúc AI.
  * **AI Assistant**: Trợ lý trí tuệ nhân tạo hỗ trợ truy vấn nhanh dữ liệu và gợi ý xử lý.
  * **Tìm kiếm**: Công cụ tra cứu tìm kiếm toàn văn sản phẩm, khách hàng và đơn hàng.
  * **Báo cáo**: Báo cáo thống kê chi tiết doanh số và tồn kho.
  * **Nhân viên & phân quyền**: Quản lý tài khoản nhân viên và phân quyền truy cập theo vai trò.
  * **Nhật ký hoạt động**: Tra cứu lịch sử thao tác của các tài khoản để đảm bảo tính minh bạch.

---

## 🔄 PHẦN 2. DEMO LUỒNG NGHIỆP VỤ THỰC TẾ (KHÁCH HÀNG ↔ ADMIN)

### 2.1. Khách hàng Đăng nhập OTP & Đặt hàng (Bộ nhớ đệm Redis)
* **[Quay màn hình]**: 
  1. Mở trang khách hàng tại `http://localhost:4000/customer.html`.
  2. Bấm **"Đăng nhập"** -> Nhập email `customer@test.local` -> Bấm **"Gửi Mã OTP"**.
  3. Mở cửa sổ Dòng lệnh (Terminal) xem mã OTP: `[OTP] customer@test.local -> xxxxxx`.
  4. Nhập mã OTP 6 số -> Bấm **"Xác Nhận OTP"**.
  5. Kéo xuống chọn sách *Mắt Biếc* -> Bấm **"Thêm vào giỏ"**.
  6. Bấm **"Tiến Hành Đặt Hàng"** (Checkout).

* **[Đọc code / Mở file]**:
  - Mở `src/otp-service.js` (dòng 32–54): Chỉ vào hàm `createOTP` lưu mã OTP dạng chuỗi vào Redis (`STRING`) với thời hạn tự hủy 5 phút (`TTL = 300s`) và thời gian chờ gửi lại 60 giây.
  - Mở `src/cart-service.js` (dòng 20–75): Chỉ vào hàm `addToCart` & `getCart` lưu thông tin giỏ hàng vào Redis (`HASH`) với thời hạn 24 giờ (`TTL = 86400s`).

* **[Lời thoại]**:
  > "Ở luồng Khách hàng, người dùng đăng nhập nhanh bằng mã OTP mà không cần nhớ mật khẩu. Mã OTP 6 số được tự động khởi tạo và lưu tạm trong Redis với thời gian hết hạn là 5 phút.
  > Khi chọn mua sách, giỏ hàng được lưu tạm trong Redis. Ngay khi khách hàng bấm Đặt hàng, hệ thống sẽ tự động dọn dẹp giỏ hàng tạm thời và tạo đơn hàng mới vào cơ sở dữ liệu."

---

### 2.2. Admin Duyệt Đơn hàng & Tự động Cập nhật Tồn kho (MongoDB + Redis)
* **[Quay màn hình]**:
  1. Chuyển sang trang Quản trị Admin `http://localhost:4000`.
  2. Mở mục **"Đơn hàng"**, thấy đơn hàng vừa đặt ở trạng thái chờ xử lý (`paid`).
  3. Bấm **"Sửa"** -> Đổi trạng thái sang **"Hoàn thành"** (`completed`) -> Bấm Lưu.
  4. Mở mục **"Sách"** kiểm tra số lượng tồn kho của cuốn sách đã tự động bị trừ.

* **[Đọc code / Mở file]**: Mở `src/server_mongo.js` (dòng 1238–1270): Chỉ vào đường dẫn `PATCH /api/orders/:id` tự động trừ tồn kho sách (`Book.findById`) và gọi `cacheService.incrementLeaderboard` tăng điểm bán chạy trên Redis.

* **[Lời thoại]**:
  > "Đơn hàng mới tạo sẽ xuất hiện ngay tại trang Quản trị. Khi quản trị viên duyệt đơn hàng sang trạng thái **Hoàn thành**, hệ thống sẽ tự động trừ số lượng tồn kho của cuốn sách trong MongoDB, đồng thời cộng điểm số bán ra vào Bảng xếp hạng sách bán chạy thời gian thực trên Redis."

---

### 2.3. Đánh giá Phản hồi, Phân tích cảm xúc AI & Chăm sóc Khách hàng
* **[Quay màn hình]**:
  1. Trên trang Quản trị Admin, mở mục **"Phản hồi"**.
  2. Thấy bản ghi đánh giá tiêu cực của khách hàng *Vũ Đức Huy* với nhãn cảm xúc **Tiêu cực** (`negative`) và trạng thái **Cần xử lý gấp** (`urgent`).
  3. Bấm xem chi tiết phản hồi để mở 2 hình ảnh đính kèm chụp sách bị hư hỏng, rách gáy.
  4. Bấm chuyển trạng thái phản hồi sang **"Đã duyệt"**.

* **[Đọc code / Mở file]**: Mở `src/ai-service.js` (dòng 358–390): Chỉ vào hàm `analyzeFeedbackSentiment` sử dụng AI để tự động phân loại cảm xúc phản hồi (tiêu cực, tích cực, trung tính).

* **[Lời thoại]**:
  > "Khi khách hàng gửi đánh giá kèm hình ảnh sản phẩm hư hỏng, hệ thống sẽ sử dụng Trí tuệ nhân tạo (AI) để phân tích nội dung nhận xét và tự động gắn nhãn cảm xúc.
  > Phản hồi tiêu cực kèm 2 ảnh sách bị rách gáy được AI nhận diện và đánh dấu cần xử lý gấp. Nhân viên quản trị có thể mở xem trực tiếp hình ảnh hư hỏng lưu từ MongoDB, chuyển trạng thái đã duyệt và chủ động lấy thông tin liên hệ để gọi điện hoặc gửi email hỗ trợ khách hàng kịp thời."

---

## ⚡ PHẦN 3. DEMO CÁC TÍNH NĂNG NÂNG CAO & HIỆU NĂNG

### 3.1. Demo Kiểm thử Hiệu năng Bộ nhớ đệm Redis (Tăng tốc nhanh hơn 40 lần)
* **[Quay màn hình]**:
  1. Mở cửa sổ Dòng lệnh Terminal (PowerShell hoặc CMD / Git Bash).
  2. **Cách 1 (Nếu dùng PowerShell)**:
     - Lần 1 (Cache Miss): `Measure-Command { Invoke-WebRequest http://localhost:4000/api/cache/hot-books -UseBasicParsing } | Select-Object TotalMilliseconds`
       -> Thời gian từ MongoDB khoảng: **~120ms**.
     - Lần 2 (Cache Hit): `Measure-Command { Invoke-WebRequest http://localhost:4000/api/cache/hot-books -UseBasicParsing } | Select-Object TotalMilliseconds`
       -> Thời gian từ Redis Cache khoảng: **~3ms**.
  3. **Cách 2 (Nếu dùng CMD / Git Bash / curl.exe)**:
     - Lần 1: `curl.exe -w "\nThời gian: %{time_total}s\n" http://localhost:4000/api/cache/hot-books`
     - Lần 2: `curl.exe -w "\nThời gian: %{time_total}s\n" http://localhost:4000/api/cache/hot-books`

* **[Đọc code / Mở file]**: Mở `src/cache-service.js` (dòng 15–60): Chỉ vào cơ chế kiểm tra bộ nhớ đệm `cacheGet` (Cache-Aside) có thời hạn `TTL = 3600s`.

* **[Lời thoại]**:
  > "Để kiểm chứng hiệu năng của Redis, em thực hiện đo tốc độ phản hồi qua Dòng lệnh. Ở lần truy vấn đầu tiên khi dữ liệu được lấy từ MongoDB, thời gian xử lý là khoảng 120ms. Tuy nhiên từ lần truy vấn thứ hai, dữ liệu được lấy trực tiếp từ bộ nhớ đệm Redis chỉ mất 3ms — nhanh hơn tới 40 lần, giúp tối ưu hiệu năng và giảm tải đáng kể cho hệ thống."

---

### 3.2. Demo Nhận diện Văn bản OCR từ Hình ảnh (Tesseract.js)
* **[Quay màn hình]**:
  1. Trên trang Quản trị Admin, mở mục **"Tài liệu"**.
  2. Bấm **"Tải lên tài liệu"**, chọn tệp hình ảnh hóa đơn hoặc trang sách.
  3. Hệ thống tiến hành trích xuất chữ tự động và hiển thị kết quả văn bản nhận diện được.

* **[Đọc code / Mở file]**: Mở `src/server_mongo.js` (dòng 3650–3710): Chỉ vào đoạn mã tích hợp công cụ nhận diện chữ `Tesseract.js` (`createWorker`) xử lý tài liệu đính kèm.

* **[Lời thoại]**:
  > "Trong phân hệ Quản lý Tài liệu, hệ thống tích hợp công cụ nhận diện chữ từ hình ảnh để tự động trích xuất nội dung văn bản từ các hóa đơn, tài liệu đính kèm. Nội dung này được lưu vào MongoDB để hỗ trợ tìm kiếm dễ dàng."

---

### 3.3. Demo Trợ lý Trí tuệ nhân tạo AI Assistant
* **[Quay màn hình]**:
  1. Trên trang Quản trị Admin, mở mục **"AI Assistant"**.
  2. Gõ câu hỏi: *"Sapiens là gì?"* -> AI phản hồi thông tin tóm tắt nội dung cuốn sách.
  3. Gõ câu lệnh: *"Nhập thêm 10 cuốn Sapiens"* -> AI tự động nhận diện yêu cầu nhập kho và đề xuất xác nhận.

* **[Đọc code / Mở file]**: Mở `src/ai-service.js` (dòng 80–133 & 245–345): Chỉ vào hàm `chatWithContext` (hỏi đáp tài liệu) và `parseBookIntent` (phân tích câu lệnh nhập kho).

* **[Lời thoại]**:
  > "Bên cạnh đó, Trợ lý AI Assistant hỗ trợ trả lời các thắc mắc nghiệp vụ dựa trên kho tài liệu của nhà sách, đồng thời tự động phân tích các câu lệnh của người dùng như 'nhập thêm 10 cuốn Sapiens' để đưa ra đề xuất điều chỉnh tồn kho nhanh chóng."

---

## 📊 PHẦN 4. TRUY VẤN DỮ LIỆU TRỰC TIẾP TRÊN MÁY CHỦ

### 4.1. Truy vấn MongoDB (qua `mongosh` hoặc MongoDB Compass Shell)

* **[Quay màn hình]**: Mở cửa sổ truy vấn **mongosh** trong ứng dụng MongoDB Compass. Thực thi lần lượt các câu lệnh kiểm tra dữ liệu thực tế.

* **[Lời thoại]**:
  > "Sau đây em xin minh họa các câu lệnh truy vấn dữ liệu trực tiếp trên MongoDB:"

```javascript
// Chọn cơ sở dữ liệu
use bookstore_migrated

// 1. Xem danh sách 5 cuốn sách và số lượng tồn kho hiện tại
db.books.find({}, { title: 1, stockQuantity: 1, salePrice: 1 }).limit(5)

// 2. Tìm các đơn hàng đã được Admin xác nhận hoàn thành
db.orders.find({ status: "completed" })

// 3. Tra cứu các phản hồi tích cực được AI tự động gán nhãn Tích cực
db.feedbacks.find({ sentiment: "positive" })

// 4. Xem 5 nhật ký thao tác mới nhất của người dùng
db.auditlogs.find().sort({ createdAt: -1 }).limit(5)
```

---

### 4.2. Truy vấn Redis (qua Dòng lệnh redis-cli)

* **[Quay màn hình]**: Mở cửa sổ Dòng lệnh Terminal, kết nối vào Redis CLI bằng lệnh `docker exec -it bookstore-redis redis-cli`. Thực thi các câu lệnh kiểm tra.

* **[Lời thoại]**:
  > "Và cuối cùng là các thao tác kiểm tra dữ liệu lưu trong bộ nhớ đệm Redis:"

```redis
# 1. Kiểm tra tất cả các khóa (keys) hiện có trong Redis
KEYS *

# 2. Xem chi tiết Giỏ hàng tạm thời của khách hàng
HGETALL cart:<sessionId>

# 3. Xem mã OTP đăng nhập và thời gian hết hạn còn lại
GET otp:<email>
TTL otp:<email>

# 4. Xem Bảng xếp hạng sách bán chạy trong tháng
ZREVRANGE leaderboard:books:<YYYY-MM> 0 -1 WITHSCORES
```

---

## 🎯 PHẦN 5. KẾT THÚC (OUTRO - 30 GIÂY)

* **[Quay màn hình]**: Chuyển về màn hình Tổng quan Quản trị hiển thị các biểu đồ thống kê.
* **[Lời thoại]**:
  > "Thông qua việc tích hợp đa cơ sở dữ liệu MongoDB và Redis bên cạnh SQLite truyền thống, hệ thống Nhà sách không chỉ đảm bảo tính toàn vẹn dữ liệu nghiệp vụ mà còn tối ưu hóa tốc độ truy xuất, hỗ trợ xử lý dữ liệu phi cấu trúc linh hoạt và tích hợp các tính năng AI hiện đại.
  > Em xin cảm ơn cô và các bạn đã theo dõi phần trình bày video demo của em!"
