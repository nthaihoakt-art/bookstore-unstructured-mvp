# Kế hoạch triển khai theo giai đoạn

## Giai đoạn 1 - MVP chạy được ✅

Mục tiêu: có ứng dụng nội bộ để quản lý lõi nghiệp vụ và chứng minh pipeline dữ liệu phi cấu trúc.

Đã triển khai:

- Backend Express REST API.
- SQLite database với các bảng lõi: users, roles, books, authors, categories, publishers, customers, suppliers, orders, order_items, inventory_transactions, documents, reviews, audit_logs.
- SQLite FTS5 search_index cho sách và tài liệu.
- Upload file local với giới hạn MIME và dung lượng 20MB.
- Extract text từ TXT/PDF/DOCX.
- Dashboard, sách, khách hàng, đơn hàng, kho, nhà cung cấp, tài liệu, search, audit log.
- UI admin tối giản.

## Giai đoạn 2 - Hoàn thiện nghiệp vụ ✅

Đã làm thêm:

- CRUD update/delete cho khách hàng, nhà cung cấp, tài liệu; cập nhật trạng thái/xóa đơn hàng.
- Trang chi tiết sách/khách hàng/đơn hàng/nhà cung cấp/tài liệu/phiếu kho.
- Tạo đơn hàng nhiều dòng sản phẩm trên UI.
- Phiếu nhập kho/xuất kho/điều chỉnh có mã phiếu riêng và nhiều dòng hàng.
- Gắn tài liệu/chứng từ trực tiếp vào phiếu kho.
- Xem lịch sử kho toàn hệ thống.
- Preview PDF/image trong UI.
- Tách document_metadata thành bảng key/value linh hoạt.
- OCR ảnh bằng Tesseract.js.
- Quản lý user/role cơ bản từ UI.
- Export CSV cho books/customers/orders/inventory/documents/slips.

Còn lại:

- Permission matrix cơ bản trên UI đã có.
- Hủy đơn hàng hoàn tồn kho và hủy phiếu kho đảo tồn đã có.
- File upload hardening cơ bản đã có: magic-number validation, checksum, duplicate metadata, API-auth preview/download.

Còn lại sau MVP:

- Export Excel/PDF; hiện ưu tiên CSV để nhẹ và chạy local ổn định.
- Validation frontend rõ ràng hơn.

## Giai đoạn 3 - Dữ liệu phi cấu trúc nâng cao

- Job queue xử lý file nền, trạng thái queued/processing/failed/done.
- Deduplicate file nâng cao bằng hash; hiện đã lưu checksum và metadata duplicateOf ở mức MVP.
- Virus scanning/quarantine trước khi cho preview/download.
- Chuyển file storage sang S3-compatible storage.
- Thay SQLite FTS bằng Meilisearch/OpenSearch nếu dữ liệu lớn.

## Giai đoạn 4 - AI và phân tích

- Gợi ý sách liên quan dựa trên tag/mô tả/lịch sử mua.
- Tự phân loại tài liệu.
- Tóm tắt mô tả sách/PDF/hợp đồng.
- Phân tích sentiment phản hồi khách hàng.
- Chat nội bộ hỏi đáp trên kho tài liệu nhà sách.
