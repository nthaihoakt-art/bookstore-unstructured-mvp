const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'bookstore.db'));
db.pragma('foreign_keys = ON');

defaultSchema();
seed();

function defaultSchema() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT
  );
  CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    description TEXT
  );
  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL,
    permission_id INTEGER NOT NULL,
    PRIMARY KEY(role_id, permission_id),
    FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role_id INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(role_id) REFERENCES roles(id)
  );
  CREATE TABLE IF NOT EXISTS authors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS publishers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    author_id INTEGER,
    category_id INTEGER,
    publisher_id INTEGER,
    isbn TEXT,
    published_year INTEGER,
    pages INTEGER,
    language TEXT DEFAULT 'vi',
    import_price REAL DEFAULT 0,
    sale_price REAL NOT NULL DEFAULT 0,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    cover_document_id INTEGER,
    description TEXT,
    excerpt TEXT,
    tags TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(author_id) REFERENCES authors(id),
    FOREIGN KEY(category_id) REFERENCES categories(id),
    FOREIGN KEY(publisher_id) REFERENCES publishers(id)
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    type TEXT DEFAULT 'retail',
    notes TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_name TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    notes TEXT,
    rating INTEGER DEFAULT 3,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT NOT NULL UNIQUE,
    customer_id INTEGER,
    status TEXT NOT NULL DEFAULT 'new',
    payment_method TEXT DEFAULT 'cash',
    subtotal REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    notes TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES customers(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    total REAL NOT NULL,
    FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY(book_id) REFERENCES books(id)
  );
  CREATE TABLE IF NOT EXISTS inventory_slips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slip_code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    supplier_id INTEGER,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    cancelled_at TEXT,
    cancelled_by INTEGER,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY(cancelled_by) REFERENCES users(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS inventory_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slip_id INTEGER,
    book_id INTEGER NOT NULL,
    supplier_id INTEGER,
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_cost REAL DEFAULT 0,
    note TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(slip_id) REFERENCES inventory_slips(id) ON DELETE SET NULL,
    FOREIGN KEY(book_id) REFERENCES books(id),
    FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    checksum TEXT,
    doc_type TEXT NOT NULL DEFAULT 'internal',
    entity_type TEXT,
    entity_id INTEGER,
    title TEXT,
    notes TEXT,
    tags TEXT DEFAULT '[]',
    is_important INTEGER NOT NULL DEFAULT 0,
    extracted_text TEXT,
    ocr_status TEXT NOT NULL DEFAULT 'not_required',
    processing_error TEXT,
    uploaded_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(uploaded_by) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS document_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    meta_key TEXT NOT NULL,
    meta_value TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
    UNIQUE(document_id, meta_key)
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER,
    customer_id INTEGER,
    rating INTEGER NOT NULL DEFAULT 5,
    content TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(book_id) REFERENCES books(id),
    FOREIGN KEY(customer_id) REFERENCES customers(id)
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(entity_type, entity_id UNINDEXED, title, body, tags);
  CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
  CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn);
  CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
  CREATE INDEX IF NOT EXISTS idx_orders_code ON orders(order_code);
  CREATE INDEX IF NOT EXISTS idx_inventory_slips_code ON inventory_slips(slip_code);
  CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_document_metadata_key ON document_metadata(meta_key, meta_value);
  `);
  migrate();
}

function migrate() {
  const documentColumns = db.prepare('PRAGMA table_info(documents)').all().map(c => c.name);
  if (!documentColumns.includes('ocr_status')) db.exec("ALTER TABLE documents ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'not_required'");
  if (!documentColumns.includes('processing_error')) db.exec('ALTER TABLE documents ADD COLUMN processing_error TEXT');
  if (!documentColumns.includes('updated_at')) db.exec('ALTER TABLE documents ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
  if (!documentColumns.includes('checksum')) db.exec('ALTER TABLE documents ADD COLUMN checksum TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_documents_checksum ON documents(checksum)');
  const orderColumns = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!orderColumns.includes('created_by')) db.exec('ALTER TABLE orders ADD COLUMN created_by INTEGER REFERENCES users(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by)');
  const customerColumns = db.prepare('PRAGMA table_info(customers)').all().map(c => c.name);
  if (!customerColumns.includes('created_by')) db.exec('ALTER TABLE customers ADD COLUMN created_by INTEGER REFERENCES users(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_customers_created_by ON customers(created_by)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by)');
    const inventoryColumns = db.prepare('PRAGMA table_info(inventory_transactions)').all().map(c => c.name);
  if (!inventoryColumns.includes('slip_id')) db.exec('ALTER TABLE inventory_transactions ADD COLUMN slip_id INTEGER REFERENCES inventory_slips(id) ON DELETE SET NULL');
  const slipColumns = db.prepare('PRAGMA table_info(inventory_slips)').all().map(c => c.name);
  if (!slipColumns.includes('status')) db.exec("ALTER TABLE inventory_slips ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  if (!slipColumns.includes('cancelled_at')) db.exec('ALTER TABLE inventory_slips ADD COLUMN cancelled_at TEXT');
  if (!slipColumns.includes('cancelled_by')) db.exec('ALTER TABLE inventory_slips ADD COLUMN cancelled_by INTEGER REFERENCES users(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_transactions_slip ON inventory_transactions(slip_id)');
}

function seed() {
  const roleCount = db.prepare('SELECT COUNT(*) c FROM roles').get().c;
  if (!roleCount) {
    const insertRole = db.prepare('INSERT INTO roles(name, description) VALUES (?, ?)');
    ['admin','manager','sales','warehouse'].forEach(r => insertRole.run(r, r));
  }
  const permissionCount = db.prepare('SELECT COUNT(*) c FROM permissions').get().c;
  if (!permissionCount) {
    const insertPermission = db.prepare('INSERT INTO permissions(code, description) VALUES (?, ?)');
    ['books.manage','customers.manage','orders.manage','inventory.manage','suppliers.manage','documents.manage','reports.view','users.manage','audit.view'].forEach(p => insertPermission.run(p, p));
    const roles = db.prepare('SELECT * FROM roles').all();
    const perms = db.prepare('SELECT * FROM permissions').all();
    const grant = db.prepare('INSERT OR IGNORE INTO role_permissions(role_id, permission_id) VALUES (?, ?)');
    roles.forEach(role => perms.forEach(permission => {
      const allowed = role.name === 'admin' ||
        (role.name === 'manager' && !['users.manage'].includes(permission.code)) ||
        (role.name === 'sales' && ['books.manage','customers.manage','orders.manage','documents.manage'].includes(permission.code)) ||
        (role.name === 'warehouse' && ['books.manage','inventory.manage','suppliers.manage','documents.manage'].includes(permission.code));
      if (allowed) grant.run(role.id, permission.id);
    }));
  }
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (!userCount) {
    const adminRole = db.prepare('SELECT id FROM roles WHERE name=?').get('admin').id;
    db.prepare('INSERT INTO users(full_name,email,password_hash,role_id) VALUES (?,?,?,?)')
      .run('Quản trị viên', 'admin@bookstore.local', bcrypt.hashSync('admin123', 10), adminRole);
  }
  const bookCount = db.prepare('SELECT COUNT(*) c FROM books').get().c;
  if (!bookCount) {
    const authorId = upsertName('authors', 'Nguyễn Nhật Ánh');
    const catId = upsertName('categories', 'Văn học');
    const pubId = upsertName('publishers', 'NXB Trẻ');
    db.prepare(`INSERT INTO books(id,code,title,author_id,category_id,publisher_id,isbn,published_year,pages,import_price,sale_price,stock_quantity,description,tags)
      VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('BOOK-001','Mắt biếc',authorId,catId,pubId,'9786041000001',2019,300,55000,88000,25,'Tiểu thuyết nổi tiếng về tuổi học trò, tình yêu và ký ức làng quê.','["bán chạy","tiểu thuyết"]');
    rebuildBookIndex(1);
  }
}

function upsertName(table, name) {
  const row = db.prepare(`SELECT id FROM ${table} WHERE name=?`).get(name);
  if (row) return row.id;
  return db.prepare(`INSERT INTO ${table}(name) VALUES (?)`).run(name).lastInsertRowid;
}

function audit(userId, action, entityType, entityId, details = {}) {
  db.prepare('INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)')
    .run(userId || null, action, entityType, entityId || null, JSON.stringify(details));
}

function rebuildBookIndex(bookId) {
  const b = db.prepare(`SELECT b.*, a.name author, c.name category, p.name publisher FROM books b
    LEFT JOIN authors a ON a.id=b.author_id LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN publishers p ON p.id=b.publisher_id WHERE b.id=?`).get(bookId);
  if (!b) return;
  db.prepare('DELETE FROM search_index WHERE entity_type=? AND entity_id=?').run('book', bookId);
  db.prepare('INSERT INTO search_index(entity_type, entity_id, title, body, tags) VALUES (?,?,?,?,?)')
    .run('book', bookId, b.title, [b.code,b.isbn,b.author,b.category,b.publisher,b.description,b.excerpt].filter(Boolean).join(' '), b.tags || '');
}

function rebuildDocumentIndex(docId) {
  const d = db.prepare('SELECT * FROM documents WHERE id=?').get(docId);
  if (!d) return;
  db.prepare('DELETE FROM search_index WHERE entity_type=? AND entity_id=?').run('document', docId);
  const metadata = db.prepare('SELECT meta_key, meta_value FROM document_metadata WHERE document_id=?').all(docId)
    .map(m => `${m.meta_key}: ${m.meta_value || ''}`).join(' ');
  db.prepare('INSERT INTO search_index(entity_type, entity_id, title, body, tags) VALUES (?,?,?,?,?)')
    .run('document', docId, d.title || d.original_name, [d.doc_type,d.notes,d.extracted_text,metadata].filter(Boolean).join(' '), d.tags || '');
}

function setDocumentMetadata(documentId, metadata = {}) {
  const stmt = db.prepare('INSERT INTO document_metadata(document_id, meta_key, meta_value) VALUES (?,?,?) ON CONFLICT(document_id, meta_key) DO UPDATE SET meta_value=excluded.meta_value');
  Object.entries(metadata).forEach(([key, value]) => {
    if (key && value !== undefined && value !== null && String(value).trim() !== '') stmt.run(documentId, key, String(value));
  });
}

module.exports = { db, audit, upsertName, rebuildBookIndex, rebuildDocumentIndex, setDocumentMetadata };

