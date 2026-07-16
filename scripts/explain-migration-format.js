const Database = require('c:/Users/Admin/.openclaw/workspace/1/bookstore-unstructured-mvp/node_modules/better-sqlite3');
const path = require('path');

// Connect SQLite
const dbPath = path.join(__dirname, '..', 'bookstore.db');
const db = new Database(dbPath);

console.log("======================================================================");
console.log("  MÔ PHỎNG DẠNG DỮ LIỆU: TRƯỚC (SQLITE) vs SAU KHI ĐỒNG BỘ (MONGODB)");
console.log("======================================================================");

// --- 1. MÔ PHỎNG SÁCH (BOOKS) ---
console.log("\n--- THÀNH PHẦN 1: DỮ LIỆU SÁCH (BOOKS) ---");

// Lấy 1 cuốn sách mẫu từ SQLite và JOIN với danh mục/nhà xuất bản
const sqlBook = db.prepare(`
  SELECT b.id, b.code, b.title, b.isbn, b.sale_price, b.stock_quantity,
         c.name AS category_name, p.name AS publisher_name
  FROM books b
  LEFT JOIN categories c ON b.category_id = c.id
  LEFT JOIN publishers p ON b.publisher_id = p.id
  LIMIT 1
`).get();

console.log("\n[DẠNG 1] Trong SQLite (Dữ liệu quan hệ chia tách ra nhiều bảng):");
console.log("Bảng 'books' chỉ chứa ID liên kết (category_id, publisher_id):");
console.log(JSON.stringify({
  id: sqlBook.id,
  code: sqlBook.code,
  title: sqlBook.title,
  category_id: 1, // Liên kết khóa ngoại đến bảng categories
  publisher_id: 1, // Liên kết khóa ngoại đến bảng publishers
  sale_price: sqlBook.sale_price,
  stock_quantity: sqlBook.stock_quantity
}, null, 2));

console.log("\n[DẠNG 2] Sau khi xử lý để đẩy lên MongoDB (NoSQL Document - Phi cấu trúc):");
console.log("Nhúng trực tiếp tên danh mục và nhà xuất bản vào trong một Document duy nhất:");
console.log(JSON.stringify({
  _id: "6a1ff506fbf5d8da90c99a1d", // Tự động tạo ObjectId độc nhất
  code: sqlBook.code,
  title: sqlBook.title,
  category: sqlBook.category_name, // Nhúng trực tiếp chữ (denormalized)
  publisher: sqlBook.publisher_name, // Nhúng trực tiếp chữ (denormalized)
  salePrice: sqlBook.sale_price,
  stockQuantity: sqlBook.stock_quantity,
  tags: ["văn học", "bán chạy", "kinh điển"] // Chuyển đổi mảng từ dạng chuỗi text trong SQL
}, null, 2));


// --- 2. MÔ PHỎNG ĐƠN HÀNG (ORDERS & ITEMS) ---
console.log("\n======================================================================");
console.log("--- THÀNH PHẦN 2: ĐƠN HÀNG (ORDERS & ORDER ITEMS) ---");

// Lấy 1 đơn hàng và các mặt hàng của nó trong SQLite
const sqlOrder = db.prepare(`SELECT * FROM orders LIMIT 1`).get();
const sqlItems = db.prepare(`
  SELECT oi.*, b.title AS book_title 
  FROM order_items oi
  JOIN books b ON oi.book_id = b.id
  WHERE oi.order_id = ?
`).all(sqlOrder.id);

console.log("\n[DẠNG 1] Trong SQLite (Lưu tách biệt thành 2 bảng Orders và Order_items):");
console.log("Bảng 'orders' (Thông tin chung):");
console.log(JSON.stringify(sqlOrder, null, 2));
console.log("Bảng 'order_items' (Các dòng sản phẩm liên kết qua order_id):");
console.table(sqlItems.map(i => ({ id: i.id, book_title: i.book_title, quantity: i.quantity, unit_price: i.unit_price, total: i.total })));

console.log("\n[DẠNG 2] Sau khi biến đổi đẩy lên MongoDB (NoSQL Document):");
console.log("Nhúng mảng 'items' làm thuộc tính con trực tiếp nằm TRONG document Đơn hàng:");
console.log(JSON.stringify({
  _id: "6a1ff52afbf5d8da90c99b2c",
  orderCode: sqlOrder.order_code,
  customerName: sqlOrder.customer_name || "Khách vãng lai",
  total: sqlOrder.total,
  status: sqlOrder.status,
  items: sqlItems.map(i => ({
    bookId: "6a1ff506fbf5d8da90c99a" + i.book_id, // Chuyển đổi ID số sang ObjectId
    bookCode: "BOOK-00" + i.book_id,
    bookTitle: i.book_title,
    quantity: i.quantity,
    unitPrice: i.unit_price,
    total: i.total
  })),
  createdAt: sqlOrder.created_at
}, null, 2));

console.log("\n======================================================================");
console.log("  => KẾT LUẬN:");
console.log("  1. SQL (SQLite): Chia nhỏ dữ liệu thành nhiều bảng, truy vấn cần kết hợp (JOIN).");
console.log("  2. NoSQL (MongoDB): Gom dữ liệu liên quan vào 1 Document, truy vấn nhanh và trực tiếp.");
console.log("======================================================================");

db.close();
