const Database = require('c:/Users/Admin/.openclaw/workspace/1/bookstore-unstructured-mvp/node_modules/better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'bookstore.db');
const db = new Database(dbPath);

console.log("=== SQL PLAYGROUND ===");
const query = process.argv[2];
if (!query) {
  console.log("Cách dùng: node scripts/sql-playground.js \"CÂU_LỆNH_SQL\"");
  console.log("Ví dụ: node scripts/sql-playground.js \"SELECT id, code, title, sale_price FROM books LIMIT 3\"");
  process.exit(0);
}

try {
  const result = db.prepare(query).all();
  console.table(result);
} catch (e) {
  console.error("Lỗi:", e.message);
} finally {
  db.close();
}
