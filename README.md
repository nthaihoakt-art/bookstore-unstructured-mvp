# Bookstore Unstructured Data MVP

MVP quản lý nhà sách có hỗ trợ dữ liệu phi cấu trúc: sách, khách hàng, đơn hàng, kho, nhà cung cấp, upload tài liệu PDF/DOCX/TXT/ảnh, trích xuất text cơ bản và tìm kiếm toàn văn bằng SQLite FTS5.

## Chạy thử

```bash
npm install
npm start
```

Mở: http://localhost:4000

Tài khoản demo:

- Quản trị viên: `admin@bookstore.local` / `Admin123!`
- Quản lý nhà sách: `manager@bookstore.local` / `Manager123!`
- Nhân viên bán hàng: `sales@bookstore.local` / `Sales123!`
- Nhân viên kho: `warehouse@bookstore.local` / `Warehouse123!`
- Kế toán: `accountant@bookstore.local` / `Accountant123!`
- Nhân viên tài liệu: `documents@bookstore.local` / `Documents123!`

## Chức năng đã có trong MVP

- Đăng nhập JWT, RBAC theo vai trò admin/manager/sales/warehouse/accountant/document_staff.
- CRUD sách, khách hàng, nhà cung cấp, tài liệu; cập nhật trạng thái/xóa đơn hàng.
- Màn hình chi tiết sách, khách hàng, đơn hàng, nhà cung cấp, tài liệu, phiếu kho.
- Tạo đơn hàng nhiều dòng sản phẩm, tự trừ tồn kho.
- Tạo phiếu nhập/xuất/điều chỉnh kho nhiều dòng với mã phiếu riêng.
- Gắn tài liệu/chứng từ trực tiếp vào phiếu kho.
- Nhập/xuất/điều chỉnh tồn kho và xem lịch sử kho.
- Upload tài liệu phi cấu trúc với metadata key/value, liên kết entity.
- Preview ảnh/PDF/TXT/DOCX text, download file.
- Trích xuất text từ TXT, PDF, DOCX và OCR ảnh bằng Tesseract.js.
- File upload hardening cơ bản: MIME whitelist, magic-number validation, checksum SHA-256, phát hiện file trùng qua metadata, không expose thư mục uploads tĩnh.
- Full-text search trên sách và nội dung tài liệu đã trích xuất.
- Dashboard tổng quan, sách sắp hết hàng, top sách, thống kê loại tài liệu.
- Quản lý user/role/permission matrix bằng checkbox trên UI.
- Hủy đơn hàng có hoàn tồn kho; hủy phiếu kho có giao dịch đảo tồn.
- Export CSV cho books, customers, orders, inventory, documents, inventory slips.
- Audit log thao tác quan trọng.
- Data scope theo ownership cho đơn hàng, khách hàng và tài liệu.

## Kiểm thử nhanh

Chạy server ở terminal 1:

```bash
npm start
```

Terminal 2:

```bash
npm run smoke
npm run flow:test
npm run hardening:test
npm run rbac:test
npm run scope:test
npm run e2e:roles
```

## Deploy demo

Xem hướng dẫn chi tiết trong [`DEPLOY.md`](./DEPLOY.md).

Bản demo môn học có thể deploy kèm `bookstore.db` và `uploads/` vì toàn bộ dữ liệu là dữ liệu giả. Không commit `.env`; khi deploy cần set `JWT_SECRET`.

## Cấu trúc

```text
src/db.js          schema SQLite, seed data, FTS index
src/server.js      REST API + static UI
public/            giao diện quản trị MVP
uploads/           file upload local
bookstore.db       database SQLite tạo tự động
```

## Giới hạn hiện tại / bước tiếp theo

- UI đang là admin SPA tối giản bằng vanilla JS để MVP chạy nhanh; có thể nâng cấp React/Next.js.
- OCR đang chạy đồng bộ khi upload/reprocess; khi dữ liệu lớn nên chuyển sang job queue nền.
- Search đang dùng SQLite FTS5; khi dữ liệu lớn có thể thay bằng OpenSearch/Meilisearch.
- File storage local; khi triển khai thực tế nên chuyển S3-compatible storage và signed URL.
- Hardening đã có mức cơ bản; môi trường production vẫn nên thêm virus scanning/quarantine.
- Cần bổ sung test tự động đầy đủ hơn, migration versioning chính quy, export Excel/PDF nâng cao.
