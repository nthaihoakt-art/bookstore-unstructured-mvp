const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(root, {recursive:true});
const docs = {
  'sample-doc-1.txt':'Hóa đơn nhập hàng NXB Trẻ 05-2026\nDanh mục: Mắt biếc, Tôi thấy hoa vàng trên cỏ xanh, Lịch sử Việt Nam bằng tranh.\nTổng số lượng: 120 quyển. Trạng thái: đã đối chiếu kho.',
  'sample-doc-2.txt':'Hợp đồng cung ứng NXB Kim Đồng\nĐiều khoản: chiết khấu theo quý, đổi trả sách lỗi in trong 14 ngày, ưu tiên sách thiếu nhi bán chạy.',
  'sample-doc-3.txt':'Ảnh bìa Mắt biếc - bản mô tả text thay cho file ảnh mẫu. Dùng để kiểm tra liên kết tài liệu với sách.',
  'sample-doc-4.txt':'Ghi chú kiểm kê cuối tháng: kệ kỹ năng sống cần bổ sung nhãn giá; Clean Code và Design Patterns sắp hết hàng.',
  'sample-doc-5.txt':'Phản hồi khách hàng Nguyễn Minh Anh: khu thiếu nhi dễ tìm, mong có thêm sách tiếng Anh cho học sinh cấp hai.',
  'sample-doc-6.txt':'Mô tả sách Atomic Habits: hướng dẫn xây dựng thói quen nhỏ, phù hợp khách hàng quan tâm phát triển bản thân.'
};
for (const [name, content] of Object.entries(docs)) fs.writeFileSync(path.join(root, name), content, 'utf8');
console.log('Đã tạo file tài liệu mẫu trong uploads/');
